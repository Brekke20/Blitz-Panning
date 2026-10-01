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
  stubExtern, standaardStub, verzamelVerzoeken, TE_PLANNEN, VASTE_NU, TOEGESTANE_CONSOLERUIS, opslagStub,
} from './helpers.mjs';
import { waarnemer, strengVangnet, zetWebSocketSlot, alleenLezen, origineelVan } from './productie-waarnemer.mjs';

// opslagStub: een stateful stub (GET + PUT met versie) voor specs die de opslag vooraf vullen (productiespecs importeren enkel hieruit).
export { expect, VASTE_NU, opslagStub };

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
export function zohoStubs({ register } = {}) {
  const opnames = {};
  const antwoorden = {};
  const overschrijf = {};
  let reg = structuredClone(register ?? { versie: 0, status: {} });
  let conflicten = 0;
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
    forceerConflicten(n) { conflicten = n; },
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
    const context = page.context();
    context.on('console', m => {
      if (m.type() !== 'error') return;
      const hit = /^Failed to load resource: the server responded with a status of (\d+)/.exec(m.text());
      if (hit && neemToegelaten(m.location().url, Number(hit[1]))) return;
      voegToe(`console.error: ${m.text()} (${m.location().url})`);
    });
    context.on('weberror', w => voegToe(`pageerror: ${w.error().message}`));
    context.on('requestfailed', r => voegToe(`requestfailed: ${r.url()} (${r.failure()?.errorText})`));
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
  }, { auto: true }],
});
