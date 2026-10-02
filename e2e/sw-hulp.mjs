// Service worker-e2e (etappe 7, Task 5, N14/N15/N21): de app met een ECHTE service worker (`serviceWorkers: 'allow'`) en dezelfde
// sloten als de productiemodus. Specs in e2e/sw/ importeren `test` en `expect` uit dit bestand (NIET uit helpers.mjs, niet uit
// productie-hulp.mjs en niet uit @playwright/test) en bedienen offline-modus, verkeersregels en de SW-bestanden enkel via de
// `sw`-fixture. Dit bestand is het enige waar `serviceWorkers` en `setOffline` voorkomen (afgedwongen door de importguard).
//
// Alle sloten van productie-hulp.mjs blijven gelden en zien ook service worker-verkeer (context.route en context.on('request')
// melden verzoeken van de SW): host-toelatingslijst (enkel localhost:3338 en de twee CDN's), alle /api gestubd (599 voor al het
// andere), geen testmodus-signalen, schrijfpaden-whitelist, WebSocket-slot. Daarbovenop:
//   7. de SW-waarnemer (sw-waarnemer.mjs): een verzoek van de SW zelf naar /api, een niet-GET of een host buiten de eigen server,
//      de twee CDN's en de Google Fonts-hosts laat de test falen;
//   8. het project `sw` in playwright.config.mjs zet `--host-resolver-rules`: de browser lost buiten localhost en de CDN's geen
//      enkele naam op, ook niet als een route zou ontbreken.
// De verkeersregels (hangVoor, vertraag, breekAf) en de vervanging van sw.js registreren hun route NA de sloten (dus met voorrang erboven),
// maar eindigen altijd op `route.fallback()`, laten een verzoek hangen of breken het af; ze laten dus nooit iets naar buiten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as basis, expect, startAppProductie, verwachtSchrijven, verwachtNetwerkFout, staaOfflineSwFoutenToe, OPSTART_SCHRIJVEN } from './productie-hulp.mjs';
import { swWaarnemer, toestaOudeSw } from './sw-waarnemer.mjs';

export { expect, verwachtSchrijven, verwachtNetwerkFout, OPSTART_SCHRIJVEN };

const MAP = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(MAP, '..', 'public');
const EIGEN_HOSTS = ['localhost:3338', '127.0.0.1:3338'];
const PROBE_MAP = '/__sw-probe/';
const PROBE_PAD = `${PROBE_MAP}sw.js`;
const MEET_PAD = '/__sw-meet.js';

// Meet-omhulsel: laadt de ECHTE public/sw.js (importScripts) en noteert enkel hoe lang de SW over elk navigatie-antwoord deed. Het wordt
// geregistreerd als /__sw-meet.js?navTimeout=<ms>; `self.location.search` is dan dat van het omhulsel, dus sw.js leest de time-out zelf.
// Waarom: Playwright houdt elke evaluate/goto/event van een pagina met een nog niet afgeronde navigatie vast, dus de tijd tot het
// antwoord is aan die kant niet te meten; de SW zelf (worker.evaluate) is wel bereikbaar.
const MEET_SCRIPT = `
self.__navAntwoorden = [];
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  const t0 = Date.now();
  const orig = e.respondWith.bind(e);
  e.respondWith = (p) => {
    orig(p);
    Promise.resolve(p).then(() => self.__navAntwoorden.push({ ms: Date.now() - t0 }), () => self.__navAntwoorden.push({ ms: Date.now() - t0, fout: true }));
  };
});
importScripts('/sw.js');
`;

// Een kleine SW die enkel op een bericht een fetch doet (om te bewijzen dat ook een fetch IN de service worker geblokkeerd wordt).
const PROBE_SCRIPT = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  const poort = e.ports[0];
  e.waitUntil((async () => {
    try { await fetch(e.data.url, { mode: 'no-cors' }); poort.postMessage({ geslaagd: true }); }
    catch (err) { poort.postMessage({ geslaagd: false, fout: String(err && err.name) }); }
  })());
});
`;

// ── Constanten uit public/sw.js (de bron van waarheid; specs lezen ze hier) ──
const swBron = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
function lijstUitSw(naam) {
  const m = swBron.match(new RegExp('const ' + naam + ' = \\[([^\\]]*)\\]'));
  if (!m) throw new Error(`${naam} niet gevonden in public/sw.js`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}
function tekstUitSw(naam) {
  const m = swBron.match(new RegExp('const ' + naam + " = '([^']+)'"));
  if (!m) throw new Error(`${naam} niet gevonden in public/sw.js`);
  return m[1];
}
export const SHELL = lijstUitSw('SHELL');
export const CDN_VAST = lijstUitSw('CDN_VAST');
export const CACHE_NAME = tekstUitSw('CACHE_NAME');
export const EXTERN_CACHE = tekstUitSw('EXTERN_CACHE');
// De bevroren kopie van de service worker van main (v25), voor het updatepad (N4).
const OUDE_SW = fs.readFileSync(path.join(MAP, 'fixtures', 'sw-v25-main.js'), 'utf8');

const pasPatroon = (patroon, u) => (typeof patroon === 'string'
  ? (patroon.startsWith('/') ? u.pathname === patroon : u.href.includes(patroon))
  : patroon.test(u.href));

// ── De fixtures ───────────────────────────────────────────────────────────────
export const test = basis.extend({
  // Overschrijft het slot 'block' van productie-hulp.mjs: enkel dit bestand zet de service worker aan.
  serviceWorkers: ['allow', { option: true }],
  // `sw`: de API voor de specs. Auto: de afterEach-controle (de SW-waarnemer) draait bij elke sw-test.
  sw: [async ({ page, verzoeken }, use) => {
    const context = page.context();
    const waarnemer = swWaarnemer(context);
    const extraPaginas = []; // tabbladen van navigeerInNieuwTabblad
    const gehangen = []; // routes die door hangVoor vastgehouden worden
    const regels = []; // { patroon, soort: 'hang' | 'vertraag' | 'breek', ms }
    let swModus = 'echt'; // 'echt' | 'oud' (de bevroren main-SW wordt als /sw.js geleverd)

    // Eén route, geregistreerd na de sloten (via de haak van startAppProductie). Geeft nooit zelf iets door naar buiten.
    async function installeerRoute(ctx) {
      await ctx.route(u => /^https?:$/.test(u.protocol), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const eigen = EIGEN_HOSTS.includes(u.host);
        if (eigen && req.method() === 'GET' && u.pathname === '/sw.js' && swModus === 'oud') {
          return route.fulfill({ status: 200, contentType: 'application/javascript', body: OUDE_SW });
        }
        if (eigen && req.method() === 'GET' && u.pathname === MEET_PAD) {
          return route.fulfill({ status: 200, contentType: 'application/javascript', body: MEET_SCRIPT });
        }
        if (eigen && req.method() === 'GET' && u.pathname === PROBE_PAD) {
          return route.fulfill({ status: 200, contentType: 'application/javascript', body: PROBE_SCRIPT });
        }
        // De regels gelden enkel voor het netwerk zoals de service worker het ziet: een verzoek van de pagina zelf (ook de navigatie, die
        // Playwright onderschept vóór ze de SW bereikt) wordt niet vertraagd, anders zou de test de SW-logica niet meer meten.
        // `breekAf` geldt voor elk verzoek (een verbroken verbinding), ook van de pagina; het sluit enkel af.
        const regel = regels.find(r => pasPatroon(r.patroon, u) && (r.soort === 'breek' || req.serviceWorker()));
        if (regel?.soort === 'hang') { gehangen.push(route); return; } // blijft hangen tot herstel() of het einde van de test
        if (regel?.soort === 'breek') return route.abort('failed'); // een verbroken verbinding
        if (regel?.soort === 'vertraag') await new Promise(res => setTimeout(res, regel.ms));
        return route.fallback();
      });
    }

    const warm = async () => {
      // Wacht tot de SW actief is en de pagina bestuurt (na activate neemt clients.claim() de pagina over).
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
    };

    const api = {
      // Opent de app (productiemodus, echte klok) met de SW aan; wacht op registratie, activatie en een controlerende SW na een herlading.
      async start(opties = {}) {
        verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
        await startAppProductie(page, { klok: false, ...opties, voorNavigatie: installeerRoute });
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
        await page.waitForLoadState('load'); // geen lopend verzoek meer (een herlading zou het afbreken: requestfailed)
        await page.reload();
        await expect(page.locator('#cnt-tickets')).toHaveText(/\d+/);
        await warm();
      },
      // Verkeersregels voor het netwerk van de service worker (enkel verzoeken van de SW zelf; ze eindigen op fallback, hangen of breken af).
      hangVoor(patroon) { regels.push({ patroon, soort: 'hang' }); },
      vertraag(patroon, ms) { regels.push({ patroon, soort: 'vertraag', ms }); },
      breekAf(patroon) { regels.push({ patroon, soort: 'breek' }); },
      // Heft alle regels op en laat de vastgehouden verzoeken alsnog hun gewone weg volgen (via de sloten: eigen server of CDN).
      async herstel() {
        regels.length = 0;
        for (const r of gehangen.splice(0)) await r.fallback().catch(() => {});
      },
      // Offline-schakelaar. Offline probeert de netwerk-eerst SW eerst het netwerk (mislukt met ERR_INTERNET_DISCONNECTED) en valt dan terug
      // op de cache: die SW-pogingen zijn toegelaten (zie staaOfflineSwFoutenToe); al het andere dat faalt blijft een fout.
      async zetOffline(aan) {
        if (aan) staaOfflineSwFoutenToe(verzoeken);
        await context.setOffline(aan);
      },
      // Registreert de echte SW via het meet-omhulsel (zie MEET_SCRIPT), met ?navTimeout=<ms> als `ms` gegeven is (enkel de tests zetten dat;
      // zonder `ms` geldt de standaard van sw.js), en wacht tot hij de pagina bestuurt.
      async registreerSwMetNavTimeout(ms) {
        const adres = ms === undefined ? MEET_PAD : `${MEET_PAD}?navTimeout=${ms}`;
        await page.evaluate(async (a) => {
          const reg = await navigator.serviceWorker.register(a, { updateViaCache: 'none' });
          await new Promise((res) => {
            const w = reg.installing || reg.waiting || reg.active;
            if (w.state === 'activated') return res();
            w.addEventListener('statechange', () => { if (w.state === 'activated') res(); });
          });
        }, adres);
        await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''), { timeout: 15000 }).toContain('__sw-meet.js');
      },
      // Start een navigatie naar '/' in een NIEUW tabblad (zelfde context, dezelfde SW) zonder erop te wachten, en geeft dat tabblad terug.
      async startNavigatie() {
        const pagina = await context.newPage();
        extraPaginas.push(pagina);
        pagina.goto('/', { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
        return pagina;
      },
      // Wacht (echte tijd, hoogstens `maxMs`) tot de meet-SW een navigatie beantwoord heeft; geeft { ms } (de tijd die de SW over dat antwoord
      // deed, vanaf het fetch-event) of null.
      async navigatieAntwoord(maxMs) {
        const einde = Date.now() + maxMs;
        while (Date.now() < einde) {
          const w = context.serviceWorkers().filter(x => x.url().includes(MEET_PAD)).at(-1);
          const lijst = w ? await w.evaluate(() => self.__navAntwoorden).catch(() => []) : [];
          if (lijst.length > 0) return lijst[0];
          await new Promise(res => setTimeout(res, 50));
        }
        return null;
      },
      // Updatepad (N4): /sw.js levert de bevroren main-SW (oud) of weer de echte (nieuw).
      serveerOudeSw() { swModus = 'oud'; toestaOudeSw(context); },
      serveerNieuweSw() { swModus = 'echt'; },
      async updateSw() {
        await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
      },
      // Cache-inhoud (alle URL's per cache) en SW-verzoeken, als kopie (specs kunnen er niets aan wissen).
      async cacheInhoud() {
        return page.evaluate(async () => {
          const uit = {};
          for (const naam of await caches.keys()) uit[naam] = (await (await caches.open(naam)).keys()).map(r => new URL(r.url).pathname + (new URL(r.url).host === location.host ? '' : '@' + new URL(r.url).host));
          return uit;
        });
      },
      async cacheUrls() {
        return page.evaluate(async () => {
          const uit = {};
          for (const naam of await caches.keys()) uit[naam] = (await (await caches.open(naam)).keys()).map(r => r.url);
          return uit;
        });
      },
      // Laadt '/' in een NIEUW tabblad (zelfde context, dus dezelfde service worker) en meet in dat tabblad zelf (Navigation Timing, echte
      // tijd, in ms vanaf het begin van de navigatie) wanneer het antwoord binnenkwam: `responseStart` is het moment waarop de SW zijn
      // antwoord gaf (een cachekopie na de navigatie-time-out, anders pas het netwerkantwoord). Niet op `page` zelf: Playwright houdt
      // elke evaluate/goto op een pagina met een nog niet afgeronde navigatie vast.
      async laadInNieuwTabblad() {
        const pagina = await context.newPage();
        extraPaginas.push(pagina);
        await pagina.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        const tijden = await pagina.evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0];
          return { responseStart: Math.round(n.responseStart), domContentLoaded: Math.round(n.domContentLoadedEventEnd), bestuurd: !!navigator.serviceWorker.controller };
        });
        return { pagina, ...tijden };
      },
      swVerzoeken: () => waarnemer.verzoeken.map(r => ({ ...r })),
      // Een /api-aanroep vanuit de pagina; geeft { status, tekst } of { fout } (nooit een gegooide fout).
      async apiAanroep(pad) {
        return page.evaluate(async (p) => {
          try { const r = await fetch(p); return { status: r.status, tekst: await r.text() }; } catch (e) { return { fout: String(e && e.name) }; }
        }, pad);
      },
      // Probes voor de zelftest: een fetch vanuit de pagina of vanuit een SW. Geven { geslaagd, fout } en gooien nooit.
      async probeUitPagina(url) {
        return page.evaluate(async (u) => {
          try { await fetch(u, { mode: 'no-cors' }); return { geslaagd: true }; } catch (e) { return { geslaagd: false, fout: String(e && e.name) }; }
        }, url);
      },
      async probeUitSw(url) {
        await page.evaluate(async ({ pad, scope }) => {
          const reg = await navigator.serviceWorker.register(pad, { scope });
          await new Promise((res) => {
            const w = reg.installing || reg.waiting || reg.active;
            if (w.state === 'activated') return res();
            w.addEventListener('statechange', () => { if (w.state === 'activated') res(); });
          });
        }, { pad: PROBE_PAD, scope: PROBE_MAP });
        return page.evaluate(async ({ pad, doel }) => {
          const reg = await navigator.serviceWorker.getRegistration(pad.replace(/sw\.js$/, ''));
          const kanaal = new MessageChannel();
          const antwoord = new Promise(res => { kanaal.port1.onmessage = (e) => res(e.data); });
          reg.active.postMessage({ url: doel }, [kanaal.port2]);
          return antwoord;
        }, { pad: PROBE_PAD, doel: url });
      },
    };

    await use(api);

    // Vastgehouden verzoeken (hangVoor) laten doorlopen: een nooit beantwoorde navigatie houdt het sluiten van de pagina op.
    await api.herstel();
    for (const p of extraPaginas) await p.close().catch(() => {});

    // afterEach: de SW zelf heeft zich aan de regels gehouden (productie-hulp controleert de rest, ook voor SW-verkeer).
    expect(waarnemer.overtredingen, 'verzoeken van de service worker buiten de regels (/api, niet-GET, vreemde host)').toEqual([]);
  }, { auto: true }],
});
