// Productiemodus-e2e (etappe 5a, D4-D6): de app zonder `?test`, met een volledig gestubde backend.
// Specs in e2e/productie/ importeren `test` en `expect` uit dit bestand (NIET uit helpers.mjs en
// niet uit @playwright/test). Dit is het strengste vangnet van de suite, want hier loopt de
// echte Zoho-code van de app (planning, voorstel, annuleren, rapport verzenden); elke fout in dit bestand kan een echte Zoho-, TomTom- of mailaanroep
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
  stubExtern, standaardStub, authIkStub, verzamelVerzoeken, TE_PLANNEN, VASTE_NU, TOEGESTANE_CONSOLERUIS, opslagStub, TICKETS_STUB,
} from './helpers.mjs';
import { waarnemer, strengVangnet, zetWebSocketSlot, alleenLezen, origineelVan } from './productie-waarnemer.mjs';

// opslagStub: een stateful stub (GET + PUT met versie) voor specs die de opslag vooraf vullen (productiespecs importeren enkel hieruit).
// TICKETS_STUB: de tickets die de stub levert (kern/testdata.js vanaf VASTE_NU); specs leiden er hun verwachtingen uit af.
export { expect, VASTE_NU, opslagStub, TICKETS_STUB };

// Schrijfverzoeken die de app bij elke start zelf doet (POST /api/planning-sinds vraagt wachttijden op).
export const OPSTART_SCHRIJVEN = ['/api/planning-sinds'];

// Gedeelde hulpen voor de productiespecs.
const OPENSTAAND = new WeakMap(); // page -> Set van lopende verzoeken (gevuld door de `verzoeken`-fixture)
function volgOpenstaand(page) {
  const open = new Set();
  OPENSTAAND.set(page, open);
  page.on('request', r => open.add(r));
  page.on('requestfinished', r => open.delete(r));
  page.on('requestfailed', r => open.delete(r));
}
// Wacht tot alles gezet is (debounces, laatste antwoorden) vóórdat een schrijflijst gelezen wordt, zodat een extra
// verzoek dat na de toast binnenkomt de test laat falen: twee rondes van klok voorbij elke debounce, microtask-flush
// en wachten tot er geen verzoek meer openstaat. Niet `waitForLoadState('networkidle')`: dat komt nooit meer zodra
// het annuleervenster (srcdoc-iframe `#annuleer-frame`) genavigeerd heeft zonder dat er daarna nog een verzoek volgt.
export async function settle(page) {
  for (let ronde = 0; ronde < 2; ronde++) {
    await page.clock.runFor(2000);
    await page.evaluate(() => Promise.resolve());
    await expect.poll(() => OPENSTAAND.get(page)?.size ?? 0, { timeout: 10000 }).toBe(0);
  }
}
// I1 (mailcontrole): na een "niet verzonden" wacht de app tot 30 s na de start en controleert dan nog één keer. De nepklok loopt ook in
// echte tijd door, dus een vaste sprong kan de timer missen; hier springt hij in stappen tot de tweede controle er is.
export async function laatMailControleHerhalen(page, z, aantal = 2) {
  await expect.poll(async () => { await page.clock.runFor(2000); return z.opnames['mail-check'].length; }, { timeout: 20000, intervals: [50] }).toBe(aantal);
  await page.evaluate(() => Promise.resolve());
}
// De query van een mail-check-verzoek met het (variabele) aantal verstreken ms als 'N': de client stuurt enkel de verstreken tijd, geen klok.
export const mailCheckQuery = (o) => ({ ...o.query, verlopenMs: /^\d+$/.test(o.query.verlopenMs) ? 'N' : o.query.verlopenMs });
// Opent de Kalender-tab en laat de eenmalige hertekening (index.html: setTimeout(activeerKalender, 0) onder de nepklok)
// meteen lopen, zodat één gewone klik daarna niet door een hertekening wordt weggegooid.
export async function openKalender(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.clock.runFor(1);
}
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

const PER_HTTPFOUT = new WeakMap(); // verzoeken -> [{ pad, status, gezien }]

// Per test een toegelaten HTTP-foutantwoord: exact dit pad met exakt deze status. Het vangnet negeert dan
// enkel die combinatie (response-melding en de "Failed to load resource"-console.error van de browser) en
// faalt in afterEach als de verwachte fout NIET voorkwam. Elke andere status >= 400 blijft een consolefout.
export function verwachtHttpFout(verzoeken, fouten) {
  let o;
  try { o = origineelVan(verzoeken); } catch { o = verzoeken; }
  if (!PER_HTTPFOUT.has(o)) PER_HTTPFOUT.set(o, []);
  for (const f of fouten) PER_HTTPFOUT.get(o).push({ pad: f.pad, status: f.status, gezien: false });
}

const PER_NETFOUT = new WeakMap(); // verzoeken -> [{ pad, methode, requestfailed, console }]
const EIGEN_ORIGIN = 'http://localhost:3338';

// Per test een toegelaten netwerkfout (afgebroken of mislukt verzoek, bv. via zetAntwoord(naam, { afbreken: 'failed' })):
// precies een `requestfailed` naar de eigen server (origin + pad, optioneel `methode`) en de bijbehorende
// "Failed to load resource: net::ERR_*"-regel van de browser. Elke tweede keer, een andere origin of een ander pad blijft
// een consolefout. De test faalt in afterEach als de verwachte fout uitblijft.
export function verwachtNetwerkFout(verzoeken, fouten) {
  let o;
  try { o = origineelVan(verzoeken); } catch { o = verzoeken; }
  if (!PER_NETFOUT.has(o)) PER_NETFOUT.set(o, []);
  for (const f of fouten) {
    if (typeof f?.pad !== 'string' || !f.pad.startsWith('/')) throw new Error('verwachtNetwerkFout: pad moet een pad zijn dat met / begint');
    PER_NETFOUT.get(o).push({ pad: f.pad, methode: f.methode ?? null, requestfailed: false, console: false });
  }
}

// Service worker-tests (e2e/sw-hulp.mjs): zolang de browser offline staat, probeert een netwerk-eerst service worker eerst het netwerk en
// valt daarna terug op de cache; die SW-pogingen naar de eigen server falen met ERR_INTERNET_DISCONNECTED. Na `staaOfflineSwFoutenToe`
// (aangeroepen door de offline-schakelaar van de fixture) zijn precies die mislukte SW-verzoeken geen lek: GET, van de service worker,
// naar de eigen server, met die ene foutcode. Mislukte verzoeken van de pagina zelf of naar een andere host blijven fouten.
const OFFLINE_SW = new WeakSet(); // verzoeken (origineel)
export function staaOfflineSwFoutenToe(verzoeken) {
  let o;
  try { o = origineelVan(verzoeken); } catch { o = verzoeken; }
  OFFLINE_SW.add(o);
}

// Intrekken zodra de browser weer online is: daarna is een mislukt SW-verzoek weer gewoon een fout.
export function herroepOfflineSwFoutenToe(verzoeken) {
  let o;
  try { o = origineelVan(verzoeken); } catch { o = verzoeken; }
  OFFLINE_SW.delete(o);
}

const PER_CONSOOL = new WeakMap(); // verzoeken -> [{ tekst, gezien }]

// Per test een toegelaten console.error van de app zelf (bv. 'Beschikbaarheid opslaan mislukt: TypeError: ...'): `tekst` is
// een niet-lege string (exacte gelijkheid met de volledige consoletekst) of een RegExp die niet leeg en niet alles matcht
// (voor een variabel deel). Elke verwachting dekt precies een melding (de eerste die past); een tweede, andere of
// ontbrekende melding faalt de test. Elke andere console.error blijft een fout.
export function verwachtConsoleFout(verzoeken, fouten) {
  let o;
  try { o = origineelVan(verzoeken); } catch { o = verzoeken; }
  for (const f of fouten) {
    const t = f?.tekst;
    const geldig = (typeof t === 'string' && t.length > 0)
      || (t instanceof RegExp && !t.test('') && !t.test('\u0000 qjzx onzin 0123') && !t.test('console.error'));
    if (!geldig) throw new Error('verwachtConsoleFout: `tekst` moet een niet-lege string of een niet-alles-matchende RegExp zijn');
  }
  if (!PER_CONSOOL.has(o)) PER_CONSOOL.set(o, []);
  for (const f of fouten) PER_CONSOOL.get(o).push({ tekst: f.tekst, gezien: false });
}

// Niet-GET verzoeken naar de eigen server die niet op de whitelist staan (als 'METHODE /pad').
export function ongemeldeSchrijfverzoeken(alle, paden) {
  const toegestaan = new Set(paden);
  return alle
    .filter(r => r.methode !== 'GET' && !toegestaan.has(r.pad) && !toegestaan.has(`${r.methode} ${r.pad}`))
    .map(r => `${r.methode} ${r.pad}`);
}

// Opent de app zonder ?test. `technieker`: 'all' | 'Tim' | 'Roel' (bepaalt de verwachte wachtrijtelling).
// `klok: false` laat de echte klok lopen (enkel voor tests die geen page.clock nodig hebben); standaard staat de nepklok aan.
export async function startAppProductie(page, { rol = 'coordinator', technieker = 'all', overschrijf, vasteKlok = false, klok = true, voorNavigatie, loginRol = 'beheerder' } = {}) {
  await page.addInitScript(({ rol, technieker }) => {
    if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
    const zet = (k, v) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); };
    if (rol !== null) zet('blitz_rol', rol);
    zet('blitz_active_person', technieker);
    // Het toestel is al van de teststub-gebruiker (kern/eigenaar.js wist anders de persoon hierboven); eenmalig per tabblad, zodat een
    // uitlog (die de markering weghaalt) na een herlaad niet meteen weer ongedaan wordt gemaakt.
    if (!sessionStorage.getItem('__test_eigenaar')) { sessionStorage.setItem('__test_eigenaar', '1'); zet('blitz_eigenaar', 'u-test'); }
    zet('blitz_theme', 'dark');
  }, { rol, technieker });
  if (klok) await page.clock.install({ time: new Date(VASTE_NU) });
  const verzoeken = await stubExtern(page, { overschrijf: { 'auth-ik': authIkStub(loginRol), ...overschrijf } });
  // Strenge route NA stubExtern: voorrang boven diens host-vangnet (dat o.a. POST naar een CDN doorlaat).
  await strengVangnet(page.context(), verzoeken, { metStubs: true });
  // Haak voor e2e/sw-hulp.mjs: registreert (na de sloten, dus met voorrang erboven) enkel regels die een verzoek vertragen of
  // laten hangen (en daarna `route.fallback()` doen) of de eigen sw.js vervangen; nooit iets wat naar buiten gaat.
  if (voorNavigatie) await voorNavigatie(page.context());
  await page.goto('/'); // bewust zonder ?test
  if (vasteKlok && klok) await page.clock.setFixedTime(new Date(VASTE_NU));
  await expect(page.locator('#cnt-tickets')).toHaveText(String(TE_PLANNEN[technieker] ?? 0));
  return alleenLezen(verzoeken);
}

// Nep-backend voor de schrijvende eindpunten, met opname van elk verzoek en een instelbaar antwoord. Zoho/mail: plan, plan-datum,
// propose, annuleer, send-rapport. TomTom: optimize. Netlify Blobs (geen Zoho): voorstel-status, rapport-verzonden en rapport-archief.
//   const z = zohoStubs();  startAppProductie(page, { overschrijf: z.overschrijf });
//   z.opnames.plan -> [{ methode, body, query }];  z.zetAntwoord('plan', { status: 500, json: {...} })
// `antwoord` is een { status, json } of een functie ({ methode, body, query, pad }) => { status, json }.
export const ZOHO_EINDPUNTEN = ['plan', 'plan-datum', 'propose', 'voorstel-status', 'annuleer', 'optimize', 'send-rapport', 'rapport-verzonden', 'rapport-archief', 'mail-check'];
// Redenen van netlify/lib/annulatie.js (REDENEN, zonder klantzin); dit bestand mag geen netlify/-code importeren.
const ANNULEER_REDENEN = [
  { code: 'ziek', label: 'Technieker ziek of onbeschikbaar' },
  { code: 'onderdelen', label: 'Onderdelen niet op tijd geleverd' },
  { code: 'klant', label: 'Klant vroeg om te verzetten' },
  { code: 'weer', label: 'Weersomstandigheden' },
  { code: 'fout', label: 'Dubbele of foute planning' },
  { code: 'andere', label: 'Andere' },
];
const TIJDSLOT_RE = /^([01]\d|2[0-3]):[0-5]\d–([01]\d|2[0-3]):[0-5]\d$/;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;

// Opties: `register` = beginstand van het voorstelregister ({ versie, status }); het register is stateful en
// volgt netlify/lib/voorstelregister.js (versiecontrole met 409 + serverVersie, reset, tijdslot enkel als geldig,
// DELETE ?ticketId=). Een geslaagde echte annulering wist het register zoals annuleer.js (wisVoorstel).
// Bewust NIET nagebootst: de numerieke ticketId-validatie van de echte functies (de fixtures gebruiken 'p1').
//   z.register()            -> huidige stand van het register (kopie)
//   z.forceerConflicten(n)  -> de volgende n POST /api/voorstel-status geven 409 (en het register schuift één versie op)
export function zohoStubs({ register, rapporten } = {}) {
  const opnames = {};
  const antwoorden = {};
  const overschrijf = {};
  let reg = structuredClone(register ?? { versie: 0, status: {} });
  let conflicten = 0;
  // Rapportarchief (etappe 5b): stateful zoals rapport-archief.js (GET) en rapport-verzonden.js (POST met versiecontrole).
  let archief = structuredClone(rapporten ?? { versie: 0, rapports: [] });
  const conflict409 = () => ({ status: 409, json: { error: 'Register ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: reg.versie } });
  for (const naam of ZOHO_EINDPUNTEN) {
    opnames[naam] = [];
    antwoorden[naam] = standaardStub(naam); // elke oproep van standaardStub geeft een verse, stateful stub
    // Antwoordvormen van de echte functies (tests/server-plan.test.mjs): plan -> { success, ticketId, date },
    // plan-datum -> { ok, interventieDatum }.
    if (naam === 'plan') antwoorden[naam] = ({ body }) => ({ status: 200, json: { success: true, ticketId: body?.ticketId, date: body?.date ?? null } });
    if (naam === 'plan-datum') antwoorden[naam] = ({ body }) => ({ status: 200, json: { ok: true, interventieDatum: body?.utcInterventieDatum } });
    // propose.js: succes -> { success, ticketId, interventieDatum, appointmentTime, emailSent, fouten, ontvangers }.
    // Standaard: één ontvanger (contact) die de mail kreeg; tests zetten een eigen antwoord voor andere gevallen.
    if (naam === 'propose') {
      antwoorden[naam] = ({ body }) => ({
        status: 200,
        json: {
          success: true, ticketId: body?.ticketId, interventieDatum: body?.utcInterventieDatum, appointmentTime: body?.time,
          emailSent: { contact: true, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'],
        },
      });
    }
    // voorstel-status.js + lib/voorstelregister.js.
    if (naam === 'voorstel-status') {
      antwoorden[naam] = ({ methode, body, query }) => {
        if (methode === 'GET') return { status: 200, json: structuredClone(reg) };
        if (methode === 'DELETE') {
          const status = { ...reg.status };
          delete status[query.get('ticketId')];
          reg = { versie: reg.versie + 1, status };
          return { status: 200, json: { ok: true, versie: reg.versie } };
        }
        if (conflicten > 0) { conflicten--; reg = { ...reg, versie: reg.versie + 1 }; return conflict409(); }
        if (typeof body?.versie === 'number' && body.versie !== reg.versie) return conflict409();
        const slot = (typeof body.tijdslot === 'string' && TIJDSLOT_RE.test(body.tijdslot) && typeof body.tijdslotDatum === 'string' && DATUM_RE.test(body.tijdslotDatum))
          ? { tijdslot: body.tijdslot, tijdslotDatum: body.tijdslotDatum } : {};
        const entry = body.reset === true ? {} : { ...(reg.status[body.ticketId] || {}) };
        for (const d of body.doelgroepen) entry[d] = body.tijdstip;
        Object.assign(entry, slot);
        reg = { versie: reg.versie + 1, status: { ...reg.status, [body.ticketId]: entry } };
        return { status: 200, json: { ok: true, versie: reg.versie } };
      };
    }
    // annuleer.js: GET -> { redenen }, POST { voorbeeld: true } -> { html }, POST echt -> { ok, emailSent, fouten }.
    if (naam === 'annuleer') {
      antwoorden[naam] = ({ methode, body }) => {
        if (methode === 'GET') return { status: 200, json: { redenen: structuredClone(ANNULEER_REDENEN) } };
        if (body?.voorbeeld === true) return { status: 200, json: { html: '<html><head></head><body><p>Nep-voorbeeld van de annulatiemail</p></body></html>' } };
        const status = { ...reg.status };
        delete status[body?.ticketId];
        reg = { versie: reg.versie + 1, status };
        return { status: 200, json: { ok: true, emailSent: { contact: body?.mailKlant === true, klant: false, installateur: false }, fouten: [] } };
      };
    }
    // send-rapport.js: preview -> { preview: true, ontvangers: [{ doelgroep, naam, email, html }] }; echt ->
    // { success, emailSent, fouten, statusUpdated, statusFout }. Standaard: enkel de contactpersoon.
    if (naam === 'send-rapport') {
      antwoorden[naam] = ({ body }) => body?.preview === true
        ? { status: 200, json: { preview: true, ontvangers: [{ doelgroep: 'contact', naam: 'Luc Wouters', email: 'luc@test.be', html: '<p>Nep-voorbeeld van de rapportmail</p>' }] } }
        : { status: 200, json: { success: true, emailSent: { contact: true, klant: false, installateur: false }, fouten: [], statusUpdated: true, statusFout: null } };
    }
    // mail-check.js (etappe 7, Q1; ENKEL GET, leest de uitgaande threads van een ticket): standaard "niet verzonden"; met `ontvangers` in de
    // query geeft hij per adres { verzonden: false, tijdstip: null }. Een spec zet een eigen antwoord met zetAntwoord('mail-check', ...).
    if (naam === 'mail-check') {
      antwoorden[naam] = ({ query }) => {
        const adressen = (query.get('ontvangers') || '').split(',').filter(Boolean);
        return {
          status: 200,
          json: {
            ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [],
            ...(adressen.length ? { ontvangers: Object.fromEntries(adressen.map(a => [a.toLowerCase(), { verzonden: false, tijdstip: null }])) } : {}),
          },
        };
      };
    }
    // rapport-archief: GET geeft de stand; andere methodes vallen terug op de standaardstub (versie + 1, geen opslag).
    if (naam === 'rapport-archief') {
      const standaard = antwoorden[naam];
      antwoorden[naam] = (arg) => {
        if (arg.methode !== 'GET') return standaard(arg);
        const id = arg.query.get('id');
        return { status: 200, json: id ? { versie: archief.versie, rapport: archief.rapports.find(r => r.id === id) || null } : structuredClone(archief) };
      };
    }
    // rapport-verzonden.js: 409 bij een verkeerde versie, 404 bij een onbekend rapport, anders versie + 1 en het veld gezet.
    if (naam === 'rapport-verzonden') {
      antwoorden[naam] = ({ body }) => {
        if (typeof body?.versie === 'number' && body.versie !== archief.versie) {
          return { status: 409, json: { error: 'Rapportarchief ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: archief.versie } };
        }
        const i = archief.rapports.findIndex(r => r.id === body?.id);
        if (i < 0) return { status: 404, json: { error: 'Rapport niet gevonden' } };
        const veld = body.doelgroep === 'contact' ? 'verzondenContact' : body.doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
        const rapports = [...archief.rapports];
        rapports[i] = { ...rapports[i], [veld]: body.tijdstip };
        archief = { versie: archief.versie + 1, rapports };
        return { status: 200, json: { ok: true, versie: archief.versie } };
      };
    }
    overschrijf[naam] = async (arg) => {
      opnames[naam].push({ methode: arg.methode, body: arg.body, query: Object.fromEntries(arg.query) });
      const a = antwoorden[naam];
      return typeof a === 'function' ? a(arg) : a;
    };
  }
  return {
    overschrijf,
    opnames,
    register: () => structuredClone(reg),
    archief: () => structuredClone(archief),
    forceerConflicten(n) { conflicten = n; },
    zetAntwoord(naam, antwoord) {
      if (!(naam in antwoorden)) throw new Error(`geen Zoho-stub met naam ${naam}`);
      antwoorden[naam] = antwoord;
    },
  };
}

// ── test met automatische controles (minstens zo streng als helpers.mjs) ──────
export const test = basis.extend({
  // Onafhankelijk van playwright.config.mjs: een service worker mag het vangnet niet omzeilen.
  serviceWorkers: ['block', { option: true }],
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
  consoleFouten: async ({ page, verzoeken: verzoekenWeergave }, use) => {
    const fouten = [];
    const voegToe = (tekst) => {
      if (TOEGESTANE_CONSOLERUIS.some(r => r.patroon.test(tekst))) return;
      fouten.push(tekst);
    };
    const toegelaten = () => PER_HTTPFOUT.get(origineelVan(verzoekenWeergave)) ?? [];
    const padVan = (u) => { try { return new URL(u).pathname; } catch { return null; } };
    // Zoek een toegelaten fout bij pad + status; markeert ze als gezien.
    const neemToegelaten = (url, status) => {
      const f = toegelaten().find(x => x.pad === padVan(url) && x.status === status);
      if (f) f.gezien = true;
      return !!f;
    };
    const toegelatenNet = () => PER_NETFOUT.get(origineelVan(verzoekenWeergave)) ?? [];
    const eigenUrl = (u) => { try { const x = new URL(u); return x.origin === EIGEN_ORIGIN ? x.pathname : null; } catch { return null; } };
    // soort: 'requestfailed' (met methode) of 'console'; elke verwachting dekt van elk soort een melding.
    const neemNetFout = (url, soort, methode) => {
      const pad = eigenUrl(url);
      if (pad === null) return false;
      const f = toegelatenNet().find(x => x.pad === pad && !x[soort] && (soort !== 'requestfailed' || !x.methode || x.methode === methode));
      if (f) f[soort] = true;
      return !!f;
    };
    const context = page.context();
    const offlineSwToegelaten = () => OFFLINE_SW.has(origineelVan(verzoekenWeergave));
    context.on('console', m => {
      if (m.type() !== 'error') return;
      if (offlineSwToegelaten() && /^Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(m.text()) && eigenUrl(m.location().url) !== null) return;
      if (/^Failed to load resource: net::ERR_\w+/.test(m.text()) && neemNetFout(m.location().url, 'console')) return;
      const eigen = (PER_CONSOOL.get(origineelVan(verzoekenWeergave)) ?? []).find(x => !x.gezien && (typeof x.tekst === 'string' ? m.text() === x.tekst : x.tekst.test(m.text())));
      if (eigen) { eigen.gezien = true; return; }
      const hit = /^Failed to load resource: the server responded with a status of (\d+)/.exec(m.text());
      if (hit && neemToegelaten(m.location().url, Number(hit[1]))) return;
      voegToe(`console.error: ${m.text()} (${m.location().url})`);
    });
    context.on('weberror', w => voegToe(`pageerror: ${w.error().message}`));
    context.on('requestfailed', r => {
      if (offlineSwToegelaten() && r.serviceWorker() && r.method() === 'GET' && eigenUrl(r.url()) !== null && /ERR_INTERNET_DISCONNECTED/.test(r.failure()?.errorText ?? '')) return;
      if (!neemNetFout(r.url(), 'requestfailed', r.method())) voegToe(`requestfailed: ${r.url()} (${r.failure()?.errorText})`);
    });
    context.on('response', r => {
      if (r.status() >= 400 && r.status() !== 599) {
        if (neemToegelaten(r.url(), r.status())) return;
        voegToe(`HTTP ${r.status()}: ${r.url()}`);
      }
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
    // Een toegelaten HTTP-fout moet echt voorgekomen zijn (anders test de test niets).
    const ontbrekend = (PER_HTTPFOUT.get(verzoeken) ?? []).filter(f => !f.gezien).map(f => `${f.status} ${f.pad}`);
    expect(ontbrekend, 'verwachte HTTP-fouten (verwachtHttpFout) die niet voorkwamen').toEqual([]);
    const netOntbrekend = (PER_NETFOUT.get(verzoeken) ?? []).filter(f => !f.requestfailed).map(f => f.pad);
    expect(netOntbrekend, 'verwachte netwerkfouten (verwachtNetwerkFout) die niet voorkwamen').toEqual([]);
    const consoolOntbrekend = (PER_CONSOOL.get(verzoeken) ?? []).filter(f => !f.gezien).map(f => String(f.tekst));
    expect(consoolOntbrekend, 'verwachte consolefouten (verwachtConsoleFout) die niet voorkwamen').toEqual([]);
  }, { auto: true }],
});
