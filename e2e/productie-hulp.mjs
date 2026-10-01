// Productiemodus-e2e (etappe 5a, D4-D6): de app zonder `?test`, met een volledig gestubde backend.
// Specs in e2e/productie/ importeren `test` en `expect` uit dit bestand (NIET uit helpers.mjs en
// niet uit @playwright/test). Dit is het strengste vangnet van de suite, want hier loopt de
// echte Zoho-code van de app; elke fout in dit bestand kan een echte Zoho-, TomTom- of mailaanroep
// betekenen. De zes sloten:
//   1. de statische server (e2e/statische-server.mjs) heeft geen backend: elk /api-pad geeft 599;
//   2. het host-vangnet van stubExtern (alles buiten 127.0.0.1/localhost:3338 en de CDN-lijst: afgebroken);
//   3. per-pad stubs (stubExtern) + de catch-all 599 voor al het andere (`verzoeken.onverwacht`);
//   4. de schrijfpaden-whitelist per test (`verwachtSchrijven`): elk niet-GET verzoek naar de eigen server (ook buiten /api) buiten de lijst faalt;
//   5. `isToegestaan` (vangnet-regels.mjs) als extra route met voorrang: CDN enkel GET/HEAD, geen Zoho/TomTom/mail;
//   6. WebSocket-slot (context.routeWebSocket): elke verbinding faalt de test.
// Lekmeldingen zijn niet te wissen vanuit een gewone spec: de waarnemer staat in productie-waarnemer.mjs en enkel
// de zelftest (e2e/productie/zelftest-hulp.mjs) mag hem importeren (afgedwongen door tests/e2e-import-guard.test.mjs).
import { test as basis, expect } from '@playwright/test';
import {
  stubExtern, standaardStub, verzamelVerzoeken, TE_PLANNEN, VASTE_NU, TOEGESTANE_CONSOLERUIS,
} from './helpers.mjs';
import { waarnemer, strengVangnet, zetWebSocketSlot, alleenLezen, origineelVan } from './productie-waarnemer.mjs';

export { expect, VASTE_NU };

// Schrijfverzoeken die de app bij elke start zelf doet (POST /api/planning-sinds vraagt wachttijden op).
export const OPSTART_SCHRIJVEN = ['/api/planning-sinds'];

const PER_VERZOEKEN = new WeakMap(); // verzoeken -> schrijfpaden (array)

// `verzoeken` is de alleen-lezen weergave (of het origineel); de whitelist hangt aan het origineel.
function schrijfpadenVan(verzoeken) {
  let o;
  try { o = origineelVan(verzoeken); } catch { o = verzoeken; }
  if (!PER_VERZOEKEN.has(o)) PER_VERZOEKEN.set(o, []);
  return PER_VERZOEKEN.get(o);
}

// Per test een whitelist van niet-GET /api-paden: `'/api/plan'` of `'POST /api/plan'`.
export function verwachtSchrijven(verzoeken, paden) {
  schrijfpadenVan(verzoeken).push(...paden);
}

// Niet-GET verzoeken naar de eigen server die niet op de whitelist staan (als 'METHODE /pad').
export function ongemeldeSchrijfverzoeken(alle, paden) {
  const toegestaan = new Set(paden);
  return alle
    .filter(r => r.methode !== 'GET' && !toegestaan.has(r.pad) && !toegestaan.has(`${r.methode} ${r.pad}`))
    .map(r => `${r.methode} ${r.pad}`);
}

// Opent de app zonder ?test. `technieker`: 'all' | 'Tim' | 'Roel' (bepaalt de verwachte wachtrijtelling).
export async function startAppProductie(page, { rol = 'coordinator', technieker = 'all', overschrijf, vasteKlok = false } = {}) {
  await page.addInitScript(({ rol, technieker }) => {
    if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
    const zet = (k, v) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); };
    if (rol !== null) zet('blitz_rol', rol);
    zet('blitz_active_person', technieker);
    zet('blitz_theme', 'dark');
  }, { rol, technieker });
  await page.clock.install({ time: new Date(VASTE_NU) });
  const verzoeken = await stubExtern(page, { overschrijf });
  // Strenge route NA stubExtern: voorrang boven diens host-vangnet (dat o.a. POST naar een CDN doorlaat).
  await strengVangnet(page.context(), verzoeken, { metStubs: true });
  await page.goto('/'); // bewust zonder ?test
  if (vasteKlok) await page.clock.setFixedTime(new Date(VASTE_NU));
  await expect(page.locator('#cnt-tickets')).toHaveText(String(TE_PLANNEN[technieker] ?? 0));
  return alleenLezen(verzoeken);
}

// Nep-Zoho: de zes Zoho-gebonden eindpunten met opname van elk verzoek en een instelbaar antwoord.
//   const z = zohoStubs();  startAppProductie(page, { overschrijf: z.overschrijf });
//   z.opnames.plan -> [{ methode, body, query }];  z.zetAntwoord('plan', { status: 500, json: {...} })
// `antwoord` is een { status, json } of een functie ({ methode, body, query, pad }) => { status, json }.
export const ZOHO_EINDPUNTEN = ['plan', 'plan-datum', 'propose', 'voorstel-status', 'annuleer', 'optimize'];
export function zohoStubs() {
  const opnames = {};
  const antwoorden = {};
  const overschrijf = {};
  for (const naam of ZOHO_EINDPUNTEN) {
    opnames[naam] = [];
    antwoorden[naam] = standaardStub(naam); // elke oproep van standaardStub geeft een verse, stateful stub
    overschrijf[naam] = async (arg) => {
      opnames[naam].push({ methode: arg.methode, body: arg.body, query: Object.fromEntries(arg.query) });
      const a = antwoorden[naam];
      return typeof a === 'function' ? a(arg) : a;
    };
  }
  return {
    overschrijf,
    opnames,
    zetAntwoord(naam, antwoord) {
      if (!(naam in antwoorden)) throw new Error(`geen Zoho-stub met naam ${naam}`);
      antwoorden[naam] = antwoord;
    },
  };
}

// ── test met automatische controles (minstens zo streng als helpers.mjs) ──────
export const test = basis.extend({
  verzoeken: async ({ page }, use) => {
    const verzoeken = verzamelVerzoeken(page);
    waarnemer(page.context());
    await zetWebSocketSlot(page.context());
    // Lagere laag: ook als een test de app opent zonder startAppProductie, verlaat niets de eigen server.
    await strengVangnet(page.context(), verzoeken, { metStubs: false });
    await use(alleenLezen(verzoeken)); // specs zien enkel een alleen-lezen weergave
  },
  toegestaneSchrijfpaden: async ({ verzoeken }, use) => {
    await use(schrijfpadenVan(verzoeken)); // de whitelist vul je enkel via verwachtSchrijven
  },
  consoleFouten: async ({ page }, use) => {
    const fouten = [];
    const voegToe = (tekst) => {
      if (TOEGESTANE_CONSOLERUIS.some(r => r.patroon.test(tekst))) return;
      fouten.push(tekst);
    };
    const context = page.context();
    context.on('console', m => { if (m.type() === 'error') voegToe(`console.error: ${m.text()} (${m.location().url})`); });
    context.on('weberror', w => voegToe(`pageerror: ${w.error().message}`));
    context.on('requestfailed', r => voegToe(`requestfailed: ${r.url()} (${r.failure()?.errorText})`));
    context.on('response', r => {
      if (r.status() >= 400 && r.status() !== 599) voegToe(`HTTP ${r.status()}: ${r.url()}`);
    });
    await use(alleenLezen(fouten)); // specs zien enkel een alleen-lezen weergave
  },
  productieVangnet: [async ({ page, verzoeken: verzoekenWeergave, toegestaneSchrijfpaden, consoleFouten: consoleFoutenWeergave }, use) => {
    await use();
    // Het vangnet leest de muteerbare originelen, nooit de weergaven die specs kregen.
    const verzoeken = origineelVan(verzoekenWeergave);
    const consoleFouten = origineelVan(consoleFoutenWeergave);
    const w = waarnemer(page.context());
    expect(verzoeken.buitenHost, 'verzoeken naar een niet-toegestane externe host (afgebroken)').toEqual([]);
    expect(w.ongeoorloofd, 'verzoeken die isToegestaan weigert').toEqual([]);
    expect(w.websockets, 'WebSocket-verbindingen (de app gebruikt er geen)').toEqual([]);
    expect(w.testSignalen, 'testmodus-signalen (?test of X-Blitz-Test) in productiemodus').toEqual([]);
    expect(verzoeken.onverwacht, 'niet-gestubde /api-verzoeken').toEqual([]);
    const metHeader = verzoeken.alle.filter(r => r.headers['x-blitz-test'] !== null).map(r => `${r.methode} ${r.pad}`);
    expect(metHeader, 'X-Blitz-Test-header op een /api-verzoek').toEqual([]);
    // De waarnemer ziet alle niet-GET verzoeken naar de eigen server, ook buiten /api.
    const ongemeld = ongemeldeSchrijfverzoeken(w.schrijven, toegestaneSchrijfpaden);
    expect(ongemeld, 'schrijfverzoeken buiten de whitelist (verwachtSchrijven)').toEqual([]);
    for (const p of page.context().pages()) {
      expect(new URL(p.url(), 'http://x').searchParams.has('test'), `?test in de URL van ${p.url()}`).toBe(false);
    }
    expect(consoleFouten, 'consolefouten').toEqual([]);
  }, { auto: true }],
});
