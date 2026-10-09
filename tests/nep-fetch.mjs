// Testhelper voor de serverkant (etappe 6): nep-fetch met opname van elk uitgaand verzoek.
// Geen *.test.mjs, dus geen eigen testbestand. Nooit echte netwerkaanroepen (Z12).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zetAuthVoorTests } from '../netlify/lib/auth.js';
import { zetStandaard } from './auth-hulp.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));

// string | URLSearchParams | FormData | undefined -> vergelijkbare waarde
export function normaliseerBody(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return [...body.entries()].map(([naam, waarde]) =>
      typeof waarde === 'string'
        ? [naam, null, null, waarde]
        : [naam, waarde.name ?? null, waarde.type, waarde.size]);
  }
  return String(body);
}

const jsonAntwoord = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// router(url, opts) mag een Response teruggeven; token en /organizations hebben standaardantwoorden.
export function maakNepFetch(router = () => undefined) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', headers: { ...opts.headers }, body: normaliseerBody(opts.body) });
    const eigen = await router(u, opts);
    if (eigen !== undefined) return eigen;
    if (u.includes('oauth/v2/token')) return jsonAntwoord({ access_token: 'TOK' });
    if (u.endsWith('/organizations')) return jsonAntwoord({ data: [{ id: 'ORG1' }] });
    return jsonAntwoord({}, 404);
  };
  return { fn, calls };
}

// Zet globalThis.fetch tijdelijk en herstelt in finally.
export async function metGlobaleFetch(fn, werk) {
  const oud = globalThis.fetch;
  globalThis.fetch = fn;
  try { return await werk(); }
  finally { globalThis.fetch = oud; }
}

// Standaard gooit globalThis.fetch: geen echte verbindingen in tests (Z12).
globalThis.fetch = async (url) => {
  throw new Error('Echte fetch in test geblokkeerd: ' + String(url));
};

// Alle bestaande servertests lopen als ingelogde beheerder (de wrapper laat alles door); de rechten zelf worden
// in tests/server-beveiliging.test.mjs en per functie met metRol / metGeenSessie getest.
const STANDAARD_AUTH = { vasteGebruiker: { id: 'test-beheerder', email: 'b@test', naam: 'Test Beheerder', rol: 'beheerder' } };
zetAuthVoorTests(STANDAARD_AUTH);
zetStandaard(STANDAARD_AUTH); // metRol / metGeenSessie keren hierna terug naar deze standaard

let teller = 0;
export async function laadVers(naam) {
  const bestand = path.join(HIER, '..', 'netlify', 'functions', naam + '.js');
  return import(pathToFileURL(bestand).href + '?v=' + (++teller));
}

export function v1Event(methode, body, headers = {}) {
  return {
    httpMethod: methode,
    headers,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// Zet omgevingsvariabelen (undefined = verwijderen); geeft een herstelfunctie terug.
export function zetEnv(obj) {
  const oud = {};
  for (const k of Object.keys(obj)) {
    oud[k] = process.env[k];
    if (obj[k] === undefined) delete process.env[k]; else process.env[k] = obj[k];
  }
  return () => {
    for (const k of Object.keys(oud)) {
      if (oud[k] === undefined) delete process.env[k]; else process.env[k] = oud[k];
    }
  };
}
