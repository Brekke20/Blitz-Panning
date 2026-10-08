// tests/auth.test.mjs — netlify/lib/auth.js (sessiecontrole, testrol, service-sleutel)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { maakNepStore } from './nep-blobs.mjs';
import { ondertekenToken } from '../netlify/lib/sessie-token.js';
import {
  ROLLEN, maakAuth, vereisGebruiker, weigeringV1, weigeringV2, zetAuthVoorTests,
} from '../netlify/lib/auth.js';

const GEHEIM = 'testgeheim-testgeheim';
const NU_MS = 1_800_000_000_000;
const NU_S = Math.floor(NU_MS / 1000);
const nu = () => NU_MS;

const GEBRUIKERS = [
  { id: 'u-beheer', email: 'beheer@blitz.be', naam: 'Beheerder', rol: 'beheerder', actief: true, sessieVersie: 3, wachtwoordHash: 'geheim-hash' },
  { id: 'u-plan', email: 'plan@blitz.be', naam: 'Planner', rol: 'planner', actief: true, sessieVersie: 1 },
  { id: 'u-blok', email: 'blok@blitz.be', naam: 'Geblokkeerd', rol: 'planner', actief: false, sessieVersie: 1 },
  { id: 'u-wacht', email: 'wacht@blitz.be', naam: 'Nieuw', rol: 'planner', actief: true, sessieVersie: 1, moetWachtwoordWijzigen: true },
  { id: 'u-tech', email: 'tech@blitz.be', naam: 'Tech', rol: 'technieker', zohoNaam: 'Tim', actief: true, sessieVersie: 1 },
];

function opzet({ env = { SESSIE_GEHEIM: GEHEIM }, gebruikers = GEBRUIKERS } = {}) {
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers } });
  const test = maakNepStore({ gebruikers: { versie: 1, gebruikers: [] } });
  const namen = [];
  const getStore = ({ name }) => { namen.push(name); return name === 'blitz-data' ? echt : test; };
  return { auth: maakAuth({ getStore, env, nu }), echt, test, namen };
}

const token = (uid, sv, exp = NU_S + 1000, geheim = GEHEIM) => ondertekenToken({ uid, sv, exp }, geheim);
const verzoek = (headers = {}, methode = 'GET') => ({ httpMethod: methode, headers });
const metCookie = (t, extra = {}, methode = 'GET') => verzoek({ cookie: `blitz_sessie=${t}`, ...extra }, methode);

test('ROLLEN', () => {
  assert.deepEqual(ROLLEN, ['beheerder', 'planner', 'technieker', 'sales']);
});

test('geldige cookie -> ok met publieke gebruiker (geen hash, geen sessieVersie)', async () => {
  const { auth } = opzet();
  const r = await auth.vereisGebruiker(metCookie(token('u-beheer', 3)));
  assert.equal(r.ok, true);
  assert.deepEqual(r.gebruiker, { id: 'u-beheer', email: 'beheer@blitz.be', naam: 'Beheerder', rol: 'beheerder' });
  assert.ok(!JSON.stringify(r).includes('geheim-hash'));
});

test('werkt ook met een v2-Request', async () => {
  const { auth } = opzet();
  const req = new Request('https://x.test/api/a', { headers: { cookie: `blitz_sessie=${token('u-plan', 1)}` } });
  assert.equal((await auth.vereisGebruiker(req)).ok, true);
});

test('geen cookie -> 401 niet-ingelogd', async () => {
  const { auth } = opzet();
  const r = await auth.vereisGebruiker(verzoek());
  assert.deepEqual([r.ok, r.status, r.code], [false, 401, 'niet-ingelogd']);
  assert.equal(typeof r.fout, 'string');
});

test('vervallen token, verkeerde handtekening, rommel -> 401', async () => {
  const { auth } = opzet();
  for (const t of [token('u-plan', 1, NU_S - 1), token('u-plan', 1, NU_S + 1000, 'ander-geheim'), 'rommel', '']) {
    const r = await auth.vereisGebruiker(metCookie(t));
    assert.deepEqual([r.ok, r.status, r.code], [false, 401, 'niet-ingelogd']);
  }
});

test('sessieVersie verhoogd na uitgifte -> 401 (blokkeren werkt meteen)', async () => {
  const { auth } = opzet();
  const r = await auth.vereisGebruiker(metCookie(token('u-beheer', 2)));
  assert.equal(r.status, 401);
});

test('inactieve of verwijderde gebruiker met geldig token -> 401', async () => {
  const { auth } = opzet();
  assert.equal((await auth.vereisGebruiker(metCookie(token('u-blok', 1)))).status, 401);
  assert.equal((await auth.vereisGebruiker(metCookie(token('u-weg', 1)))).status, 401);
});

test('gebruiker zonder actief:true wordt geweigerd', async () => {
  const { auth } = opzet({ gebruikers: [{ id: 'u-x', email: 'x@b.be', naam: 'X', rol: 'planner', sessieVersie: 1 }] });
  assert.equal((await auth.vereisGebruiker(metCookie(token('u-x', 1)))).status, 401);
});

test('rollen: planner op beheerder-route -> 403 geen-recht; toegelaten rol ok', async () => {
  const { auth } = opzet();
  const r = await auth.vereisGebruiker(metCookie(token('u-plan', 1)), { rollen: ['beheerder'] });
  assert.deepEqual([r.ok, r.status, r.code], [false, 403, 'geen-recht']);
  assert.equal((await auth.vereisGebruiker(metCookie(token('u-plan', 1)), { rollen: ['beheerder', 'planner'] })).ok, true);
  assert.equal((await auth.vereisGebruiker(metCookie(token('u-plan', 1)), { rollen: [] })).ok, true);
});

test('rollen die geen array is faalt dicht', async () => {
  const { auth } = opzet();
  const r = await auth.vereisGebruiker(metCookie(token('u-plan', 1)), { rollen: 'planner' });
  assert.deepEqual([r.ok, r.status], [false, 403]);
});

test('schrijven zonder X-Blitz -> 403 csrf; met X-Blitz: 1 ok; andere waarde faalt', async () => {
  const { auth } = opzet();
  const t = token('u-plan', 1);
  const zonder = await auth.vereisGebruiker(metCookie(t, {}, 'POST'), { schrijven: true });
  assert.deepEqual([zonder.ok, zonder.status, zonder.code], [false, 403, 'csrf']);
  assert.equal((await auth.vereisGebruiker(metCookie(t, { 'X-Blitz': '1' }, 'POST'), { schrijven: true })).ok, true);
  assert.equal((await auth.vereisGebruiker(metCookie(t, { 'x-blitz': 'true' }, 'POST'), { schrijven: true })).status, 403);
  // zonder schrijven:true is de header niet nodig
  assert.equal((await auth.vereisGebruiker(metCookie(t, {}, 'GET'))).ok, true);
});

test('moetWachtwoordWijzigen -> 403 wachtwoord-wijzigen; met ookBijWijzigen ok', async () => {
  const { auth } = opzet();
  const t = token('u-wacht', 1);
  const r = await auth.vereisGebruiker(metCookie(t));
  assert.deepEqual([r.ok, r.status, r.code], [false, 403, 'wachtwoord-wijzigen']);
  assert.equal((await auth.vereisGebruiker(metCookie(t), { ookBijWijzigen: true })).ok, true);
});

test('volgorde: wachtwoord-wijzigen gaat voor geen-recht, geen-recht voor csrf', async () => {
  const { auth } = opzet();
  const a = await auth.vereisGebruiker(metCookie(token('u-wacht', 1), {}, 'POST'), { rollen: ['beheerder'], schrijven: true });
  assert.equal(a.code, 'wachtwoord-wijzigen');
  const b = await auth.vereisGebruiker(metCookie(token('u-plan', 1), {}, 'POST'), { rollen: ['beheerder'], schrijven: true });
  assert.equal(b.code, 'geen-recht');
});

test('SESSIE_GEHEIM leeg of ontbrekend -> 401, nooit een uitzondering', async () => {
  for (const env of [{ SESSIE_GEHEIM: '' }, {}]) {
    const { auth } = opzet({ env });
    const r = await auth.vereisGebruiker(metCookie(token('u-plan', 1)));
    assert.deepEqual([r.ok, r.status, r.code], [false, 401, 'niet-ingelogd']);
  }
});

test('storefout bij gebruikers lezen -> 503 opslag-storing (nooit ok), zonder lek', async () => {
  const kapot = { async get() { throw new Error('geheim-detail-van-blobs'); } };
  const auth = maakAuth({ getStore: () => kapot, env: { SESSIE_GEHEIM: GEHEIM }, nu });
  const r = await auth.vereisGebruiker(metCookie(token('u-plan', 1)));
  assert.deepEqual([r.ok, r.status, r.code], [false, 503, 'opslag-storing']);
  assert.equal(typeof r.fout, 'string');
  assert.ok(!JSON.stringify(r).includes('geheim-detail'));
});

test('getStore die gooit (sync of async) -> 503 opslag-storing', async () => {
  for (const getStore of [() => { throw new Error('x'); }, async () => { throw new Error('x'); }]) {
    const auth = maakAuth({ getStore, env: { SESSIE_GEHEIM: GEHEIM }, nu });
    const r = await auth.vereisGebruiker(metCookie(token('u-plan', 1)));
    assert.deepEqual([r.ok, r.status, r.code], [false, 503, 'opslag-storing']);
  }
});

test('opslagstoring maskeert geen ongeldige sessie: slecht token blijft 401 zonder de store te raken', async () => {
  const auth = maakAuth({ getStore: () => { throw new Error('x'); }, env: { SESSIE_GEHEIM: GEHEIM }, nu });
  assert.equal((await auth.vereisGebruiker(metCookie('rommel'))).status, 401);
  assert.equal((await auth.vereisGebruiker(verzoek())).status, 401);
});

// ---- Testrol (Review Focus 1) ----
const testRol = (rol, extra = {}) => verzoek({ 'X-Blitz-Test': '1', 'X-Blitz-Test-Rol': rol, ...extra });

test('testrol: zonder lokale dev (env leeg, NETLIFY_DEV, Netlify-runtime) -> 401', async () => {
  for (const env of [{}, { NETLIFY_DEV: 'true' }, { BLITZ_LOKALE_DEV: '1', AWS_LAMBDA_FUNCTION_NAME: 'f' },
    { BLITZ_LOKALE_DEV: '1', NETLIFY: 'true' }, { BLITZ_LOKALE_DEV: '1', LAMBDA_TASK_ROOT: '/var/task' },
    { SESSIE_GEHEIM: GEHEIM, BLITZ_LOKALE_DEV: 'true' }]) {
    const { auth } = opzet({ env });
    const r = await auth.vereisGebruiker(testRol('beheerder'));
    assert.deepEqual([r.ok, r.status], [false, 401], JSON.stringify(env));
  }
});

test('testrol: lokale dev -> testgebruiker, ook zonder SESSIE_GEHEIM', async () => {
  const { auth } = opzet({ env: { BLITZ_LOKALE_DEV: '1' } });
  const r = await auth.vereisGebruiker(testRol('beheerder'));
  assert.equal(r.ok, true);
  assert.equal(r.gebruiker.id, 'test-beheerder');
  assert.equal(r.gebruiker.rol, 'beheerder');
  for (const rol of ROLLEN) assert.equal((await auth.vereisGebruiker(testRol(rol))).gebruiker.id, `test-${rol}`);
});

test('testrol: geretourneerde gebruiker is een kopie (mutatie lekt niet)', async () => {
  const { auth } = opzet({ env: { BLITZ_LOKALE_DEV: '1' } });
  const r = await auth.vereisGebruiker(testRol('planner'));
  r.gebruiker.rol = 'beheerder';
  assert.equal((await auth.vereisGebruiker(testRol('planner'))).gebruiker.rol, 'planner');
});

test('testrol: zonder X-Blitz-Test header, onbekende rol of prototype-naam -> 401', async () => {
  const { auth } = opzet({ env: { BLITZ_LOKALE_DEV: '1', SESSIE_GEHEIM: GEHEIM } });
  assert.equal((await auth.vereisGebruiker(verzoek({ 'X-Blitz-Test-Rol': 'beheerder' }))).status, 401);
  assert.equal((await auth.vereisGebruiker(testRol('root'))).status, 401);
  assert.equal((await auth.vereisGebruiker(testRol('constructor'))).status, 401);
  assert.equal((await auth.vereisGebruiker(testRol(''))).status, 401);
});

test('testrol: X-Blitz-Test-Rol zonder X-Blitz-Test maar met geldige cookie -> cookie telt', async () => {
  const { auth } = opzet({ env: { BLITZ_LOKALE_DEV: '1', SESSIE_GEHEIM: GEHEIM } });
  const r = await auth.vereisGebruiker(metCookie(token('u-plan', 1), { 'X-Blitz-Test-Rol': 'beheerder' }));
  assert.equal(r.gebruiker.id, 'u-plan');
});

test('testrol: rollen- en csrf-controle gelden ook voor de testrol', async () => {
  const { auth } = opzet({ env: { BLITZ_LOKALE_DEV: '1' } });
  const r1 = await auth.vereisGebruiker(testRol('planner'), { rollen: ['beheerder'] });
  assert.deepEqual([r1.status, r1.code], [403, 'geen-recht']);
  const r2 = await auth.vereisGebruiker(verzoek({ 'X-Blitz-Test': '1', 'X-Blitz-Test-Rol': 'planner' }, 'POST'), { schrijven: true });
  assert.deepEqual([r2.status, r2.code], [403, 'csrf']);
  const r3 = await auth.vereisGebruiker(verzoek({ 'X-Blitz-Test': '1', 'X-Blitz-Test-Rol': 'planner', 'X-Blitz': '1' }, 'POST'), { schrijven: true });
  assert.equal(r3.ok, true);
});

test('productie: testmodus zonder echte sessie -> 401, met echte sessie ok', async () => {
  const { auth } = opzet({ env: { SESSIE_GEHEIM: GEHEIM, NETLIFY: 'true' } });
  assert.equal((await auth.vereisGebruiker(testRol('beheerder'))).status, 401);
  const r = await auth.vereisGebruiker(metCookie(token('u-plan', 1), { 'X-Blitz-Test': '1', 'X-Blitz-Test-Rol': 'beheerder' }));
  assert.equal(r.gebruiker.id, 'u-plan');
});

// ---- Service-sleutel ----
const envSleutel = { SESSIE_GEHEIM: GEHEIM, PLANNING_EXPORT_API_KEY: 'geheim' };
const metSleutel = (bearer, methode = 'GET') => verzoek({ Authorization: bearer }, methode);

test('service-sleutel: GET met juiste sleutel en service:true -> planner-pseudogebruiker', async () => {
  const { auth } = opzet({ env: envSleutel });
  const r = await auth.vereisGebruiker(metSleutel('Bearer geheim'), { service: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.gebruiker, { id: 'service-planning-export', rol: 'planner', naam: 'planning-export', email: '' });
});

test('service-sleutel: POST, verkeerde sleutel, zonder service:true -> 401', async () => {
  const { auth } = opzet({ env: envSleutel });
  assert.equal((await auth.vereisGebruiker(metSleutel('Bearer geheim', 'POST'), { service: true })).status, 401);
  assert.equal((await auth.vereisGebruiker(metSleutel('Bearer geheim'), { service: false })).status, 401);
  assert.equal((await auth.vereisGebruiker(metSleutel('Bearer fout'), { service: true })).status, 401);
  assert.equal((await auth.vereisGebruiker(metSleutel('Bearer geheimx'), { service: true })).status, 401);
  assert.equal((await auth.vereisGebruiker(metSleutel('geheim'), { service: true })).status, 401);
});

test('service-sleutel: schrijven:true wordt geweigerd en rollen worden gerespecteerd', async () => {
  const { auth } = opzet({ env: envSleutel });
  assert.equal((await auth.vereisGebruiker(metSleutel('Bearer geheim'), { service: true, schrijven: true })).ok, false);
  const r = await auth.vereisGebruiker(metSleutel('Bearer geheim'), { service: true, rollen: ['beheerder'] });
  assert.deepEqual([r.status, r.code], [403, 'geen-recht']);
});

test('service-sleutel: lege sleutel in de omgeving en header "Bearer " -> 401', async () => {
  for (const env of [{ SESSIE_GEHEIM: GEHEIM, PLANNING_EXPORT_API_KEY: '' }, { SESSIE_GEHEIM: GEHEIM }]) {
    const { auth } = opzet({ env });
    for (const h of ['Bearer ', 'Bearer', '']) {
      assert.equal((await auth.vereisGebruiker(metSleutel(h), { service: true })).status, 401, `${JSON.stringify(env)} ${h}`);
    }
  }
});

test('service-sleutel heeft SESSIE_GEHEIM niet nodig', async () => {
  const { auth } = opzet({ env: { PLANNING_EXPORT_API_KEY: 'geheim' } });
  assert.equal((await auth.vereisGebruiker(metSleutel('Bearer geheim'), { service: true })).ok, true);
});

// ---- Echte store ----
test('testverzoek leest gebruikers uit blitz-data, nooit uit blitz-data-test', async () => {
  const { auth, namen } = opzet();
  const r = await auth.vereisGebruiker(metCookie(token('u-plan', 1), { 'X-Blitz-Test': '1' }));
  assert.equal(r.ok, true, 'de gebruiker staat enkel in de echte store');
  assert.ok(namen.length > 0);
  assert.ok(namen.every(n => n === 'blitz-data'), JSON.stringify(namen));
});

test('getStore krijgt consistency strong', async () => {
  const opties = [];
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers: GEBRUIKERS } });
  const auth = maakAuth({ getStore: o => { opties.push(o); return echt; }, env: { SESSIE_GEHEIM: GEHEIM }, nu });
  await auth.vereisGebruiker(metCookie(token('u-plan', 1)));
  assert.deepEqual(opties[0], { name: 'blitz-data', consistency: 'strong' });
});

test('geen cookie: de store wordt niet eens geraakt', async () => {
  const { auth, namen } = opzet();
  await auth.vereisGebruiker(verzoek());
  assert.equal(namen.length, 0);
});

// ---- vasteGebruiker ----
test('vasteGebruiker: slaat sessie, wachtwoord-wijzigen en csrf over, houdt de rollencontrole', async () => {
  const vast = { id: 'v', email: 'v@b.be', naam: 'Vast', rol: 'planner' };
  const auth = maakAuth({ getStore: () => { throw new Error('mag niet'); }, env: {}, nu, vasteGebruiker: vast });
  assert.equal((await auth.vereisGebruiker(verzoek({}, 'POST'), { schrijven: true })).gebruiker.id, 'v');
  const r = await auth.vereisGebruiker(verzoek(), { rollen: ['beheerder'] });
  assert.deepEqual([r.status, r.code], [403, 'geen-recht']);
});

test('vasteGebruiker is onmogelijk in een Netlify-runtime: maakAuth gooit en een later gezette runtime-variabele negeert hem', async () => {
  const vast = { id: 'v', email: '', naam: 'Vast', rol: 'beheerder' };
  for (const runtime of [{ NETLIFY: 'true' }, { AWS_LAMBDA_FUNCTION_NAME: 'f' }, { LAMBDA_TASK_ROOT: '/var/task' }, { NETLIFY: '' }]) {
    assert.throws(() => maakAuth({ env: runtime, vasteGebruiker: vast }), /Netlify/i, JSON.stringify(runtime));
  }
  // Variabele verschijnt pas na het maken: de vaste gebruiker wordt dan niet meer gebruikt (echte controle, geen cookie: 401).
  const env = {};
  const auth = maakAuth({ getStore: () => { throw new Error('mag niet'); }, env, nu, vasteGebruiker: vast });
  assert.equal((await auth.vereisGebruiker(verzoek())).ok, true);
  env.NETLIFY = 'true';
  const r = await auth.vereisGebruiker(verzoek());
  assert.deepEqual([r.ok, r.status, r.code], [false, 401, 'niet-ingelogd']);
});

// ---- zetAuthVoorTests, weigering ----
test('zetAuthVoorTests: vervangt de standaardinstantie en null herstelt', async () => {
  try {
    zetAuthVoorTests({ vasteGebruiker: { id: 'v', email: '', naam: 'V', rol: 'beheerder' } });
    assert.equal((await vereisGebruiker(verzoek())).gebruiker.id, 'v');
  } finally { zetAuthVoorTests(null); }
  const r = await vereisGebruiker(verzoek());
  assert.equal(r.status, 401);
});

test('zetAuthVoorTests gooit in een Netlify-runtime', () => {
  for (const v of ['NETLIFY', 'AWS_LAMBDA_FUNCTION_NAME', 'LAMBDA_TASK_ROOT']) {
    const oud = process.env[v];
    process.env[v] = v === 'NETLIFY' ? 'true' : 'x';
    try { assert.throws(() => zetAuthVoorTests({ vasteGebruiker: null }), /Netlify/i, v); }
    finally { if (oud === undefined) delete process.env[v]; else process.env[v] = oud; }
  }
});

test('weigeringV1 en weigeringV2: status, CORS en body { error, code }', async () => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const res = { ok: false, status: 403, fout: 'Geen recht.', code: 'geen-recht' };
  const v1 = weigeringV1(res, cors);
  assert.equal(v1.statusCode, 403);
  assert.equal(v1.headers['Access-Control-Allow-Origin'], '*');
  assert.deepEqual(JSON.parse(v1.body), { error: 'Geen recht.', code: 'geen-recht' });
  const v2 = weigeringV2({ ok: false, status: 401, fout: 'Niet ingelogd.', code: 'niet-ingelogd' }, { 'Access-Control-Allow-Origin': '*' });
  assert.equal(v2.status, 401);
  assert.equal(v2.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await v2.json(), { error: 'Niet ingelogd.', code: 'niet-ingelogd' });
  const storing = { ok: false, status: 503, fout: 'Opslag weg.', code: 'opslag-storing' };
  assert.equal(weigeringV1(storing, cors).statusCode, 503);
  assert.deepEqual(JSON.parse(weigeringV1(storing, cors).body), { error: 'Opslag weg.', code: 'opslag-storing' });
  const s2 = weigeringV2(storing, cors);
  assert.equal(s2.status, 503);
  assert.deepEqual(await s2.json(), { error: 'Opslag weg.', code: 'opslag-storing' });
});

// Statische controle: de testseams (en dus de login-omzeiling) bestaan enkel in auth.js en in tests/.
for (const term of ['zetAuthVoorTests', 'vasteGebruiker']) {
  test(`${term} komt nergens onder netlify/ of public/ voor behalve netlify/lib/auth.js`, () => {
    const wortel = join(import.meta.dirname, '..');
    const gevonden = [];
    const loop = dir => {
      for (const naam of readdirSync(dir)) {
        if (naam === 'node_modules') continue;
        const pad = join(dir, naam);
        if (statSync(pad).isDirectory()) { loop(pad); continue; }
        if (!/\.(js|mjs|html|css|json|toml)$/.test(naam)) continue;
        if (readFileSync(pad, 'utf8').includes(term)) gevonden.push(relative(wortel, pad).split(sep).join('/'));
      }
    };
    loop(join(wortel, 'netlify'));
    loop(join(wortel, 'public'));
    assert.deepEqual(gevonden, ['netlify/lib/auth.js']);
  });
}
