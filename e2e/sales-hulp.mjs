// Hulp voor de e2e-specs van de sales-planner (Task 13). De stubs gebruiken de ECHTE handlers uit netlify/functions/ met een in-memory
// store (tests/nep-blobs.mjs), de loginomzeiling `maakAuth({ vasteGebruiker })` (slaat sessie en CSRF over, houdt de rolcontrole) en
// de header X-Blitz-Test: 1 (testmodus: nepcoordinaten, nooit TomTom of Zoho). Een e2e-stub krijgt enkel { methode, body, query, pad } en
// moet { status, json } teruggeven; daarom bouwen we hier zelf het Request en zetten we de Response om.
import { startApp, expect, VASTE_NU } from './helpers.mjs';
import { maakNepStore } from '../tests/nep-blobs.mjs';
import { maakAuth } from '../netlify/lib/auth.js';
import { maakHandler as maakSales } from '../netlify/functions/sales.js';
import { maakHandler as maakSalesImport } from '../netlify/functions/sales-import.js';
import { maakHandler as maakPostcode } from '../netlify/functions/postcode.js';
import { maakHandler as maakInstellingen } from '../netlify/functions/instellingen.js';
import { maakHandler as maakGebruikers } from '../netlify/functions/gebruikers.js';

export const SALES_GEBRUIKER = Object.freeze({
  id: 'u-test', email: 'verkoper@test.be', naam: 'Test Verkoper', rol: 'sales', salesNaam: 'Test Verkoper', magAlleSales: false, actief: true,
});
export const BEHEERDER = Object.freeze({ id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder', actief: true });

// De overige actieve verkopers voor de verkoperkeuze (de ingelogde gebruiker komt er zelf bij als hij sales is).
export const ANDERE_VERKOPERS = Object.freeze([
  { id: 'u-bea', email: 'bea@test.be', naam: 'Bea Verkoper', rol: 'sales', salesNaam: 'Bea V.', magAlleSales: false, actief: true },
  { id: 'u-carl', email: 'carl@test.be', naam: 'Carl Verkoper', rol: 'sales', salesNaam: 'Carl V.', magAlleSales: false, actief: true },
]);

// De API-paden van de ticket- en planningschermen: die geven voor sales een 403 en mogen dus nooit aangeroepen worden.
export const VERBODEN_PADEN_SALES = Object.freeze([
  '/api/tickets', '/api/afspraken', '/api/availability', '/api/klantbeschikbaarheid', '/api/rapport-archief', '/api/inventaris',
  '/api/prijzen', '/api/planning-sinds', '/api/drukte', '/api/voorstel-status', '/api/matrix', '/api/optimize', '/api/route',
]);

const GEEN_LIJST = Symbol('geen-lijst');

/** Bouwt de backend: { stubs, echt, test }. `echt` = store met de gebruikers, `test` = store met de sales-blobs en de instellingen. */
export function maakSalesBackend({ gebruiker = SALES_GEBRUIKER, leads = [], blokken = [], instellingen = null, verkopers = GEEN_LIJST, blobs = {} } = {}) {
  const lijst = verkopers === GEEN_LIJST ? [...(gebruiker.rol === 'sales' ? [gebruiker] : []), ...ANDERE_VERKOPERS] : verkopers;
  const alle = [gebruiker, ...lijst.filter(v => v.id !== gebruiker.id)];
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers: alle } });
  const begin = { ...blobs };
  if (gebruiker.rol === 'sales' && !begin[`sales/${gebruiker.id}`]) begin[`sales/${gebruiker.id}`] = { versie: 1, leads, blokken, grafstenen: [] };
  if (instellingen) begin.instellingen = { versie: 1, perGebruiker: { [gebruiker.id]: instellingen } };
  const test = maakNepStore(begin);
  const getStore = (opties) => (opties.name === 'blitz-data' ? echt : test);
  const auth = maakAuth({ vasteGebruiker: gebruiker });
  const nu = () => Date.parse(VASTE_NU);
  const geenFetch = () => { throw new Error('e2e: geen echte netwerkaanroep (TomTom/Zoho) in de sales-stubs'); };
  const gemeenschappelijk = { getStore, auth, nu };
  const metSleutels = { ...gemeenschappelijk, fetch: geenFetch, sleutel: () => 'NEP', geheim: () => 'e2e-geheim-0123456789' };
  const handlers = {
    sales: maakSales(metSleutels),
    'sales-import': maakSalesImport(metSleutels),
    postcode: maakPostcode(metSleutels),
    instellingen: maakInstellingen(gemeenschappelijk),
    gebruikers: maakGebruikers(gemeenschappelijk),
  };
  const stubs = {};
  for (const [naam, handler] of Object.entries(handlers)) {
    stubs[naam] = async ({ methode, body, query, pad }) => {
      const q = query?.toString() ?? '';
      const heeftBody = body !== null && body !== undefined && methode !== 'GET' && methode !== 'DELETE';
      const req = new Request(`http://localhost${pad}${q ? '?' + q : ''}`, {
        method: methode,
        headers: { 'content-type': 'application/json', 'x-blitz-test': '1', 'x-blitz': '1' },
        body: heeftBody ? JSON.stringify(body) : undefined,
      });
      const res = await handler(req, {});
      const tekst = await res.text();
      return { status: res.status, json: tekst ? JSON.parse(tekst) : null };
    };
  }
  return { stubs, echt, test };
}

/** De handlerkaart voor `startApp({ overschrijf })`: sales, sales-import, postcode, instellingen en gebruikers. */
export function salesStubs(opties) { return maakSalesBackend(opties).stubs; }

// Het antwoord van GET /api/auth-ik voor deze gebruiker (de stub van helpers.mjs geeft altijd alleSales = beheer).
export function authIkVoor(gebruiker) {
  const { actief: _actief, ...publiek } = gebruiker;
  const beheer = gebruiker.rol === 'beheerder';
  return () => ({
    status: 200,
    json: {
      gebruiker: publiek,
      rechten: { beheer, plannen: beheer, alleSales: beheer || gebruiker.magAlleSales === true },
      moetWachtwoordWijzigen: false,
      lokaleDev: false,
    },
  });
}

/**
 * Start de app als sales-gebruiker (of als beheerder met `gebruiker: BEHEERDER`) tegen de echte sales-handlers en wacht op de eerste sales-tab.
 * Geeft de backend terug ({ stubs, echt, test }) voor tests die de opgeslagen blobs willen nalezen.
 */
export async function startSalesApp(page, { gebruiker = SALES_GEBRUIKER, overschrijf = {}, leads, blokken, instellingen, verkopers, blobs, ...rest } = {}) {
  const backend = maakSalesBackend({ gebruiker, leads, blokken, instellingen, verkopers, blobs });
  await startApp(page, {
    loginRol: gebruiker.rol,
    overschrijf: { 'auth-ik': authIkVoor(gebruiker), ...backend.stubs, ...overschrijf },
    ...rest,
  });
  const eersteTab = gebruiker.rol === 'beheerder' ? 'Sales' : 'Leads';
  await expect(page.getByRole('tab', { name: eersteTab, exact: true })).toBeVisible();
  return backend;
}

// Een bewust uitgelokte HTTP-fout (503/403/409) staat in de vangnetlijst als "HTTP n: url" en als "Failed to load resource": haal beide weg.
export async function verwachtFout(consoleFouten, pad, status, aantal = 2) {
  const isDeze = (f) => f.includes(pad) && f.includes(String(status));
  await expect.poll(() => consoleFouten.filter(isDeze).length).toBeGreaterThanOrEqual(aantal);
  for (let i = consoleFouten.length - 1; i >= 0; i--) if (isDeze(consoleFouten[i])) consoleFouten.splice(i, 1);
}
