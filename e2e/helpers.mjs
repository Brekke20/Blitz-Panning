// Hulpcode voor de e2e-suite: nep-backend, vaste klok, vangnetcontroles.
// Elke spec importeert `test` en `expect` uit dit bestand (niet uit @playwright/test), zodat de
// afterEach-controles (onverwachte/verboden verzoeken, consolefouten) voor elke test gelden.
import { test as basis, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { maakDummyData } from '../public/js/kern/testdata.js';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const fixture = (naam) => JSON.parse(fs.readFileSync(path.join(MAP, 'fixtures', naam), 'utf8'));
const FIX = {
  matrix: fixture('matrix.json'),
  route: fixture('route.json'),
  optimize: fixture('optimize.json'),
  drukte: fixture('drukte.json'),
  planningSinds: fixture('planning-sinds.json'),
};

export const VASTE_NU = '2026-10-05T09:00:00+02:00'; // maandag, Europe/Brussels

// De tickets-stub van de productiemodus: de dummy-data van de testmodus, berekend vanaf de vaste klok (D6).
export const TICKETS_STUB = maakDummyData(Date.parse(VASTE_NU));

// Paden die een test nooit mag aanroepen: schrijven naar Zoho of mailen (E12, W11).
export const VERBODEN_PADEN = [
  '/api/propose', '/api/annuleer', '/api/send-rapport', '/api/rapport',
  '/api/rapport-verzonden', '/api/plan', '/api/plan-datum', '/api/comment',
];

// Bekende, onschadelijke consoleruis. Precies en uitgelegd; leeg als het kan.
// Beide items komen uit Playwright zelf, niet uit de app: de app heeft een iframe met sandbox=""
// (#annuleer-frame, index.html:584) en Playwright injecteert zijn eigen scripts ook in die frames.
// Beperking (m2): Playwright geeft bij deze meldingen geen frame mee (pageerror) of enkel 'about:blank'
// (console), dus de patronen zijn niet tot dat ene iframe te beperken; ze bevatten wel de volledige tekst.
export const TOEGESTANE_CONSOLERUIS = [
  {
    patroon: /Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed/,
    reden: "serviceWorkers: 'block' (E7) leest navigator.serviceWorker ook in het sandbox-iframe #annuleer-frame; daar mag dat niet.",
  },
  {
    patroon: /^console\.error: Blocked script execution in 'about:blank' because the document's frame is sandboxed/,
    reden: "page.clock.install injecteert zijn script ook in het sandbox-iframe #annuleer-frame (sandbox=\"\", geen allow-scripts).",
  },
  {
    // Zelfde oorzaak, ander frame: het rapportvoorbeeld in de wizard (#rapport-preview-frame,
    // srcdoc met sandbox="allow-same-origin", rapport-wizard.js) krijgt het klokscript ook.
    patroon: /^console\.error: Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/,
    reden: "page.clock.install injecteert zijn script ook in het sandbox-iframe #rapport-preview-frame (sandbox zonder allow-scripts).",
  },
  {
    // De loginlaag (logins T15): een 400/401/403/409/429 op een /api/auth-*-eindpunt is hier het verwachte antwoord (foute login,
    // niet ingelogd, setup al gedaan, vergrendeld); de browser meldt het als HTTP-fout en als "Failed to load resource".
    patroon: /^(HTTP (400|401|403|409|429): http:\/\/localhost:3338\/api\/auth-[\w-]+|console\.error: Failed to load resource: the server responded with a status of (400|401|403|409|429) \([^)]*\) \(http:\/\/localhost:3338\/api\/auth-[\w-]+\))$/,
    reden: "De loginschermen krijgen op auth-login, auth-ik, auth-setup, auth-herstel en auth-wachtwoord bewust een 4xx; dat is de foutpaden-test, geen fout van de app.",
  },
  {
    // Leaflet annuleert tegels die nog laden zodra de kaart na een routeberekening inzoomt of tegels
    // verwijdert (img.src wordt leeggemaakt). De browser meldt dat als requestfailed ERR_ABORTED, ook al
    // is het een gestubde, niet-bestaande tegel; of het gebeurt hangt van de timing af (flaky zonder dit).
    patroon: /^requestfailed: https:\/\/(server\.arcgisonline\.com|[a-c]\.tile\.openstreetmap\.org)\/\S+ \(net::ERR_ABORTED\)$/,
    reden: "Leaflet breekt nog ladende kaarttegels zelf af bij in- en uitzoomen; alleen tegelhosts, alleen ERR_ABORTED.",
  },
];

// Hosts waarvan de app echt scripts/stijlen laadt (index.html:634-636). Al het andere naar buiten wordt
// afgebroken en laat de test falen. Tegels (arcgisonline, openstreetmap) en Google Fonts staan hier
// bewust NIET in: die worden gestubd, nooit echt opgehaald.
export const TOEGESTANE_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

// ── Verzoeken verzamelen ──────────────────────────────────────────────────────
// Per browsercontext (niet per pagina): ook pagina's die de app zelf opent (window.open) vallen eronder.
const PER_CONTEXT = new WeakMap();

export function verzamelVerzoeken(page) {
  const context = page.context();
  if (PER_CONTEXT.has(context)) return PER_CONTEXT.get(context);
  const v = {
    alle: [],
    onverwacht: [],
    buitenHost: [], // verzoeken naar een host buiten localhost:3338 en de CDN-allowlist (afgebroken)
    van(pad, methode) {
      return v.alle.filter(r => r.pad === pad && (!methode || r.methode === methode.toUpperCase()));
    },
    get verboden() {
      return v.alle.filter(r => VERBODEN_PADEN.includes(r.pad)).map(r => r.pad);
    },
  };
  context.on('request', (req) => {
    const u = new URL(req.url());
    if (!eigenApi(u)) return;
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const h = req.headers();
    v.alle.push({ methode: req.method(), pad: u.pathname, body, headers: { 'content-type': h['content-type'] ?? null, 'x-blitz-test': h['x-blitz-test'] ?? null } });
  });
  PER_CONTEXT.set(context, v);
  return v;
}

export function eigenApi(u) {
  return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname.startsWith('/api/');
}

// ── Nep-backend ───────────────────────────────────────────────────────────────
const json = (status, obj) => ({ status, json: obj });

// Opslag-eindpunt met optimistic locking zoals de echte functies: PUT/POST met een verkeerde versie
// geeft 409 + serverVersie + data; anders versie + 1.
function maakOpslag(leeg, veld) {
  let toestand = structuredClone(leeg);
  return {
    get: () => json(200, toestand),
    schrijf(body) {
      if (typeof body?.versie === 'number' && body.versie !== toestand.versie) {
        return json(409, { error: 'Versiematch mislukt', serverVersie: toestand.versie, data: toestand });
      }
      toestand = { ...toestand, versie: toestand.versie + 1, bijgewerkt: new Date().toISOString(), [veld]: body?.[veld] ?? toestand[veld] };
      return json(200, toestand);
    },
  };
}

// Voor tests die de opslag vooraf vullen: een stateful stub (GET + PUT) vanaf een eigen beginstand,
// bv. overschrijf: { availability: opslagStub({ versie: 1, exceptions: [...] }, 'exceptions') }.
export function opslagStub(begin, veld) {
  const opslag = maakOpslag(begin, veld);
  return ({ methode, body }) => methode === 'PUT' ? opslag.schrijf(body) : opslag.get();
}

// Het antwoord van GET /api/auth-ik voor een ingelogde gebruiker met de gegeven rol (logins T14): de loginlaag is in elke
// e2e-run al "voorbij", tenzij een test auth-ik zelf overschrijft (bv. 401 voor het inlogscherm).
// `gebruiker` overschrijft velden van de teruggegeven gebruiker (bv. { naam, zohoNaam }); een technieker is standaard Tim (de dummydata).
export function authIkStub(rol = 'beheerder', gebruiker = {}) {
  const beheer = rol === 'beheerder';
  const standaard = rol === 'technieker' ? { naam: 'Test Technieker', zohoNaam: 'Tim' } : { naam: 'Test Beheerder' };
  return () => json(200, {
    gebruiker: { id: 'u-test', email: 'b@test.be', ...standaard, rol, ...gebruiker },
    rechten: { beheer, plannen: beheer || rol === 'planner', alleSales: beheer },
    moetWachtwoordWijzigen: false,
    lokaleDev: false,
  });
}

function maakStandaardStubs() {
  const afspraken = maakOpslag({ versie: 0, afspraken: [] }, 'afspraken');
  const availability = maakOpslag({ versie: 0, exceptions: [] }, 'exceptions');
  const klant = maakOpslag({ versie: 0, items: {} }, 'items');
  let voorstel = { versie: 0, status: {} };
  let archief = { versie: 0, rapports: [] };
  let inventaris = { versie: 0, wagenvoorraad: {}, log: [] };
  let prijzen = { versie: 1, bijgewerkt: '2026-10-05T07:00:00.000Z', onderdelen: [], tarieven: [] };
  const fotos = {};

  const ok = () => json(200, { ok: true });

  return {
    matrix: ({ body }) => json(200, {
      results: (body?.destinations || []).map(() => ({ ...FIX.matrix.cel })),
    }),
    optimize: ({ body }) => {
      const stops = body?.stops || [];
      const { vertrek, stapLat, stapLon } = FIX.optimize;
      const locations = [vertrek, ...stops.map((_, i) => ({
        lat: +(vertrek.lat + (i + 1) * stapLat).toFixed(5),
        lon: +(vertrek.lon + (i + 1) * stapLon).toFixed(5),
      }))];
      return json(200, { locations, optimizedOrder: stops.map((_, i) => i) });
    },
    route: ({ body }) => {
      const wps = body?.waypoints || [];
      const benen = Math.max(0, wps.length - 1);
      const legs = Array.from({ length: benen }, () => ({ ...FIX.route.been, pointCount: 2 }));
      const som = (veld) => legs.reduce((t, l) => t + l[veld], 0);
      return json(200, {
        totalTravelTimeSeconds: som('travelTimeSeconds'),
        totalDistanceMeters: som('distanceMeters'),
        totalTrafficDelaySeconds: som('trafficDelaySeconds'),
        totalNoTrafficTravelTimeSeconds: som('noTrafficTravelTimeSeconds'),
        totalHistoricTrafficTravelTimeSeconds: som('historicTrafficTravelTimeSeconds'),
        arrivalTime: null,
        departureTime: body?.departAt || null,
        legs,
        sections: [],
        departAtUsed: body?.departAt || null,
        polyline: wps.map(w => [w.lat, w.lon]),
      });
    },
    drukte: () => json(200, structuredClone(FIX.drukte)),
    'planning-sinds': () => json(200, structuredClone(FIX.planningSinds)),
    // Enkel in de productiemodus (zonder ?test) aangeroepen; in ?test komen de tickets uit kern/testdata.js (zelfde bron).
    tickets: () => json(200, structuredClone(TICKETS_STUB)),

    afspraken: ({ methode, body }) => methode === 'PUT' ? afspraken.schrijf(body) : afspraken.get(),
    availability: ({ methode, body }) => methode === 'PUT' ? availability.schrijf(body) : availability.get(),
    klantbeschikbaarheid: ({ methode, body }) => methode === 'PUT' ? klant.schrijf(body) : klant.get(),
    'voorstel-status': ({ methode }) => {
      if (methode === 'GET') return json(200, voorstel);
      voorstel = { ...voorstel, versie: voorstel.versie + 1 };
      return json(200, { ok: true, versie: voorstel.versie });
    },
    'rapport-archief': ({ methode, query }) => {
      if (methode === 'GET') {
        const id = query.get('id');
        return id
          ? json(200, { versie: archief.versie, rapport: archief.rapports.find(r => r.id === id) || null })
          : json(200, archief);
      }
      archief = { ...archief, versie: archief.versie + 1 };
      return json(200, { ok: true, id: 'nep-rapport', versie: archief.versie });
    },
    inventaris: ({ methode }) => {
      if (methode !== 'GET') inventaris = { ...inventaris, versie: inventaris.versie + 1 };
      return json(200, inventaris);
    },
    prijzen: ({ methode, body }) => {
      if (methode === 'PUT') prijzen = { ...prijzen, ...body, versie: (body?.versie ?? prijzen.versie) + 1 };
      return json(200, prijzen);
    },
    fotos: ({ methode, query, body }) => {
      const id = methode === 'PUT' ? body?.ticketId : query.get('ticketId');
      const huidig = fotos[id] || { versie: 0, fotos: [] };
      if (methode === 'PUT') fotos[id] = { versie: huidig.versie + 1, fotos: body?.fotos || [] };
      return json(200, fotos[id] || huidig);
    },

    // Schrijf- en mail-eindpunten: neutraal succes. Aanroepen staan in `verzoeken.alle` en de
    // verboden paden laten de test falen.
    plan: ok, 'plan-datum': ok, propose: ok, annuleer: ok, comment: ok,
    'send-rapport': ok, rapport: ok, 'rapport-verzonden': ok, testdata: ok, 'client-log': ok,

    // Sessie (logins T14): standaard een ingelogde beheerder; auth-uitloggen is neutraal. Beide staan in geen enkele verbodenlijst.
    'auth-ik': authIkStub('beheerder'), 'auth-uitloggen': ok,
  };
}

// De standaard-stub van één eindpunt, voor tests die hem stateful willen omwikkelen
// (bv. eerste aanroep normaal, daarna een fout). Elke oproep geeft een verse stubset.
export function standaardStub(naam) {
  return maakStandaardStubs()[naam];
}

// 1x1 transparante PNG voor kaarttegels (geen verkeer naar tegelservers).
const LEGE_TEGEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

export async function stubExtern(page, { overschrijf = {} } = {}) {
  const verzoeken = verzamelVerzoeken(page);
  // Routes op de context, zodat ook door de app geopende pagina's (window.open) gestubd en bewaakt zijn.
  const context = page.context();

  // 0. Allerlaagste vangnet, ALLER-EERST geregistreerd: elk http(s)-verzoek naar een host die niet
  //    localhost:3338 en niet op de CDN-allowlist staat, wordt afgebroken en genoteerd. Latere routes
  //    (tegels, fonts, api) gaan hierboven voor; al het andere valt hier doorheen.
  await context.route(u => /^https?:$/.test(u.protocol), (route) => {
    const u = new URL(route.request().url());
    if (u.host === 'localhost:3338' || TOEGESTANE_HOSTS.includes(u.hostname)) return route.continue();
    verzoeken.buitenHost.push(u.href);
    return route.abort('blockedbyclient');
  });

  // Kaarttegels en lettertypen: niet echt ophalen (determinisme, geen verkeer naar derden).
  await context.route(u => u.hostname === 'server.arcgisonline.com' || /^[a-c]\.tile\.openstreetmap\.org$/.test(u.hostname), route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: LEGE_TEGEL }));
  await context.route(u => u.hostname === 'fonts.googleapis.com', route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' })); // niet-leeg: een leeg antwoord geeft bij een service worker een requestfailed ERR_ABORTED

  // 1. Catch-all EERST: Playwright kiest de laatst geregistreerde passende route, dus alles wat
  //    hieronder niet specifiek gestubd wordt, komt hier terecht.
  await context.route(u => eigenApi(u), (route) => {
    const u = new URL(route.request().url());
    verzoeken.onverwacht.push(u.pathname);
    return route.fulfill({ status: 599, contentType: 'application/json', body: JSON.stringify({ error: 'niet gestubd' }) });
  });

  // 2. Specifieke stubs (stateful per test).
  const stubs = { ...maakStandaardStubs(), ...overschrijf };
  for (const [naam, handler] of Object.entries(stubs)) {
    await context.route(u => eigenApi(u) && u.pathname === `/api/${naam}`, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      let body = null;
      try { body = req.postDataJSON(); } catch { body = null; }
      const antwoord = await handler({ methode: req.method(), body, query: u.searchParams, pad: u.pathname });
      // Netwerkfouten nabootsen (etappe 7): `{ afbreken: 'failed' }` breekt het verzoek af (de fetch gooit een TypeError),
      // `{ hangen: true }` beantwoordt het nooit (de browser blijft wachten; de context ruimt het bij het sluiten op).
      if (antwoord.afbreken !== undefined) return route.abort(antwoord.afbreken);
      if (antwoord.hangen === true) return;
      if (antwoord.raw !== undefined) return route.fulfill({ status: antwoord.status, contentType: 'text/html', body: antwoord.raw });
      return route.fulfill({
        status: antwoord.status,
        contentType: 'application/json',
        body: JSON.stringify(antwoord.json),
      });
    });
  }
  return verzoeken;
}

// Verwachte wachtrijtelling voor een technieker-filter (DUMMY_DATA: Tim 2, Roel 1 te plannen).
export const TE_PLANNEN = { all: 3, Tim: 2, Roel: 1 };

// `loginRol`: de rol die de auth-ik-stub teruggeeft (standaard 'beheerder'; los van `rol`, de oude rolkeuze in de app).
// `loginGebruiker`: velden van de ingelogde gebruiker in de auth-ik-stub (zie authIkStub). Een ingelogde technieker start op zijn eigen
// planning (zohoNaam, bij blitz_active_person 'all'); voor sales (geen wachtrij) of met wachtOpApp: false (een test die zelf
// de login afwerkt) wacht startApp niet op de tickets.
export async function startApp(page, { rol = 'coordinator', technieker = 'all', viewport, overschrijf, loginRol = 'beheerder', loginGebruiker = {}, wachtOpApp = true } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  // Alleen zetten als er nog niets staat: een test die in de app van persoon wisselt en herlaadt,
  // behoudt zo zijn keuze.
  await page.addInitScript(({ rol, technieker }) => {
    // Sandboxed iframes (bv. #annuleer-frame) hebben geen localStorage: enkel in het hoofdvenster.
    if (window !== window.top) return;
    const zet = (k, v) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); };
    if (rol !== null) zet('blitz_rol', rol); // rol: null = nog nooit gekozen (tablet-vraag)
    zet('blitz_active_person', technieker);
    // Het toestel is al van de teststub-gebruiker (kern/eigenaar.js wist anders de persoon hierboven); eenmalig per tabblad, zodat een
    // uitlog (die de markering weghaalt) na een herlaad niet meteen weer ongedaan wordt gemaakt.
    if (!sessionStorage.getItem('__test_eigenaar')) { sessionStorage.setItem('__test_eigenaar', '1'); zet('blitz_eigenaar', 'u-test'); }
    zet('blitz_theme', 'dark');
  }, { rol, technieker });
  // De tijd loopt door vanaf VASTE_NU (geen bevroren klok); gebruik page.clock.setFixedTime als een
  // test ooit op de minuut nauwkeurig moet zijn.
  await page.clock.install({ time: new Date(VASTE_NU) });
  await stubExtern(page, { overschrijf: { 'auth-ik': authIkStub(loginRol, loginGebruiker), ...overschrijf } });
  await page.goto('/?test');
  if (loginRol === 'sales' || wachtOpApp === false) return;
  const eigen = loginRol === 'technieker' && technieker === 'all' ? (loginGebruiker.zohoNaam ?? 'Tim') : technieker;
  await expect(page.locator('#cnt-tickets')).toHaveText(String(TE_PLANNEN[eigen] ?? 0));
}

// ── test met automatische controles ───────────────────────────────────────────
export const test = basis.extend({
  verzoeken: async ({ page }, use) => {
    await use(verzamelVerzoeken(page));
  },
  consoleFouten: async ({ page }, use) => {
    const fouten = [];
    const voegToe = (tekst) => {
      if (TOEGESTANE_CONSOLERUIS.some(r => r.patroon.test(tekst))) return;
      fouten.push(tekst);
    };
    // Op de context, zodat ook pagina's die de app opent meetellen.
    const context = page.context();
    context.on('console', m => { if (m.type() === 'error') voegToe(`console.error: ${m.text()} (${m.location().url})`); });
    context.on('weberror', w => voegToe(`pageerror: ${w.error().message}`));
    context.on('requestfailed', r => voegToe(`requestfailed: ${r.url()} (${r.failure()?.errorText})`));
    context.on('response', r => {
      // 599 is de eigen vangnetstatus; die loopt via `onverwacht`.
      if (r.status() >= 400 && r.status() !== 599) voegToe(`HTTP ${r.status()}: ${r.url()}`);
    });
    await use(fouten);
  },
  // Automatisch voor elke test: faalt bij onverwachte of verboden verzoeken en consolefouten.
  vangnet: [async ({ verzoeken, consoleFouten }, use) => {
    await use();
    expect(verzoeken.buitenHost, 'verzoeken naar een niet-toegestane externe host').toEqual([]);
    expect(verzoeken.onverwacht,'niet-gestubde /api-verzoeken').toEqual([]);
    expect(verzoeken.verboden, 'verboden /api-aanroepen (schrijven naar Zoho of mailen)').toEqual([]);
    expect(consoleFouten, 'consolefouten').toEqual([]);
  }, { auto: true }],
});

export { expect };
