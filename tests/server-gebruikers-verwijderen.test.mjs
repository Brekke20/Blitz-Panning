// tests/server-gebruikers-verwijderen.test.mjs — /api/gebruikers, actie 'verwijder': een GEBLOKKEERDE gebruiker definitief verwijderen
// (beheerder), met zijn instellingen en verkoperblob; nooit jezelf, nooit een actieve gebruiker, rapporten/archief blijven staan.
import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { hashWachtwoord } from '../netlify/lib/wachtwoord.js';
import { ondertekenToken } from '../netlify/lib/sessie-token.js';
import { maakAuth } from '../netlify/lib/auth.js';
import { maakHandler as maakGebruikers } from '../netlify/functions/gebruikers.js';
import { maakHandler as maakLogin } from '../netlify/functions/auth-login.js';
import { kanVerwijderen } from '../netlify/lib/gebruikers.js';
import { metRol, metGeenSessie } from './auth-hulp.mjs';

const GEHEIM = 'testgeheim-testgeheim';
const WW = 'JuistWachtwoord1';
const NU0 = Date.parse('2026-10-08T10:00:00.000Z');

let hash;
before(async () => { hash = await hashWachtwoord(WW); });

const lijst = () => [
  { id: 'u-bea', email: 'bea@blitz.test', naam: 'Bea', rol: 'beheerder', actief: true, sessieVersie: 4, wachtwoordHash: hash, herstelcodes: ['x'] },
  { id: 'u-bob', email: 'bob@blitz.test', naam: 'Bob', rol: 'beheerder', actief: false, sessieVersie: 2, wachtwoordHash: hash, herstelcodes: ['y'] },
  { id: 'u-jan', email: 'jan@blitz.test', naam: 'Jan', rol: 'planner', actief: true, sessieVersie: 1, wachtwoordHash: hash },
  { id: 'u-tim', email: 'tim@blitz.test', naam: 'Tim', rol: 'technieker', zohoNaam: 'Tim Z', actief: false, sessieVersie: 1, wachtwoordHash: hash },
  { id: 'u-sal', email: 'sal@blitz.test', naam: 'Sal', rol: 'sales', salesNaam: 'Sal V', actief: true, sessieVersie: 1, wachtwoordHash: hash },
  { id: 'u-uit', email: 'uit@blitz.test', naam: 'Uit', rol: 'sales', salesNaam: 'Uit V', actief: false, sessieVersie: 1, wachtwoordHash: hash },
];

const SALES_UIT = { versie: 3, leads: [{ id: 'l1', naam: 'Klant A' }], blokken: [{ id: 'b1' }], grafstenen: [] };
const SALES_SAL = { versie: 1, leads: [{ id: 'l2', naam: 'Klant B' }], blokken: [], grafstenen: [] };
const INSTELLINGEN = { versie: 5, perGebruiker: { 'u-uit': { duurMinuten: 30 }, 'u-sal': { duurMinuten: 45 } } };
const LOGIN_LAATST = { 'u-uit': '2026-10-01T08:00:00.000Z', 'u-sal': '2026-10-02T08:00:00.000Z' };
const OUD_LOG = { versie: 1, items: [{ op: '2026-10-01T09:00:00.000Z', gebruikerId: 'u-uit', naam: 'Uit', actie: 'foto-toegevoegd', onderwerp: 'T1', details: null }] };

function opzet({ gebruikers = lijst() } = {}) {
  const basis = {
    gebruikers: { versie: 1, gebruikers },
    'sales/u-uit': SALES_UIT, 'sales/u-sal': SALES_SAL, instellingen: INSTELLINGEN, 'login-laatst': LOGIN_LAATST,
    'activiteit/2026-10': OUD_LOG, 'rapport-archief/2026': { versie: 1, items: [{ id: 'r1', technieker: 'Uit' }] },
  };
  const echt = maakNepStore(basis);
  const test = maakNepStore({ 'sales/u-uit': SALES_UIT, instellingen: INSTELLINGEN });
  const getStore = opties => (opties.name === 'blitz-data' ? echt : test);
  const env = { SESSIE_GEHEIM: GEHEIM };
  const nu = () => NU0;
  const auth = maakAuth({ getStore, env, nu });
  return { echt, test, auth, getStore, env, nu, gebruikers: maakGebruikers({ getStore, env, nu, auth }), login: maakLogin({ getStore, env, nu }) };
}

const token = (uid, sv) => ondertekenToken({ uid, sv, exp: Math.floor(NU0 / 1000) + 3600 }, GEHEIM);
const als = (uid, sv) => ({ cookie: `blitz_sessie=${token(uid, sv)}` });
const BEA = () => als('u-bea', 4);
const verwijder = (id, headers = BEA(), extra = {}) => new Request('http://localhost/api/gebruikers', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers }, body: JSON.stringify({ actie: 'verwijder', id, ...extra }),
});
const opgeslagen = async echt => (await echt.get('gebruikers', { type: 'json' })).gebruikers;
const activiteit = async echt => (await echt.get('activiteit/2026-10', { type: 'json' }))?.items ?? [];

test('een geblokkeerde verkoper verwijderen: record, verkoperblob, instellingen en laatste login weg; rest blijft staan', async () => {
  const o = opzet();
  const res = await o.gebruikers(verwijder('u-uit'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, opgeruimd: true });

  assert.deepEqual((await opgeslagen(o.echt)).map(g => g.id), ['u-bea', 'u-bob', 'u-jan', 'u-tim', 'u-sal']);
  assert.equal(await o.echt.get('sales/u-uit', { type: 'json' }), null, 'verkoperblob weg');
  assert.deepEqual(await o.echt.get('sales/u-sal', { type: 'json' }), SALES_SAL, 'het blob van een andere verkoper blijft');
  const inst = await o.echt.get('instellingen', { type: 'json' });
  assert.deepEqual(Object.keys(inst.perGebruiker), ['u-sal']);
  assert.equal(inst.versie, 6);
  assert.deepEqual(await o.echt.get('login-laatst', { type: 'json' }), { 'u-sal': LOGIN_LAATST['u-sal'] });
  // ook de kopie in de testopslag (een ingeladen export / kopie van de instellingen)
  assert.equal(await o.test.get('sales/u-uit', { type: 'json' }), null);
  assert.deepEqual(Object.keys((await o.test.get('instellingen', { type: 'json' })).perGebruiker), ['u-sal']);
});

test('rapporten en archief worden niet aangeraakt; het log houdt zijn regels en krijgt gebruiker-verwijderd (naam en rol, geen wachtwoordgegevens)', async () => {
  const o = opzet();
  const archiefVoor = await o.echt.get('rapport-archief/2026', { type: 'text' });
  await o.gebruikers(verwijder('u-uit'));
  assert.equal(await o.echt.get('rapport-archief/2026', { type: 'text' }), archiefVoor);
  const log = await activiteit(o.echt);
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], OUD_LOG.items[0], 'bestaande regel blijft');
  assert.equal(log[1].actie, 'gebruiker-verwijderd');
  assert.equal(log[1].gebruikerId, 'u-bea');
  assert.equal(log[1].onderwerp, 'u-uit');
  assert.equal(log[1].details, 'Uit, rol sales');
  const tekst = JSON.stringify(log);
  for (const v of ['wachtwoordHash', 'scrypt$', 'herstelcodes', 'sessieVersie', WW]) assert.ok(!tekst.includes(v), v);
});

test('een geblokkeerde technieker en een geblokkeerde beheerder (er is nog een actieve) zijn te verwijderen', async () => {
  const o = opzet();
  assert.equal((await o.gebruikers(verwijder('u-tim'))).status, 200);
  assert.equal((await o.gebruikers(verwijder('u-bob'))).status, 200);
  assert.deepEqual((await opgeslagen(o.echt)).map(g => g.id), ['u-bea', 'u-jan', 'u-sal', 'u-uit']);
});

test('een actieve gebruiker verwijderen: 409 "blokkeer eerst" en er verandert niets', async () => {
  const o = opzet();
  const res = await o.gebruikers(verwijder('u-sal'));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Blokkeer deze gebruiker eerst/);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
  assert.deepEqual(await o.echt.get('sales/u-sal', { type: 'json' }), SALES_SAL);
  assert.equal((await activiteit(o.echt)).length, 1, 'geen logregel');
});

test('jezelf verwijderen: 409, ook als de eigen record (hypothetisch) geblokkeerd zou zijn', async () => {
  const o = opzet();
  const res = await o.gebruikers(verwijder('u-bea'));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /eigen account/);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
});

test('kanVerwijderen: geblokkeerd vereist, niet jezelf, altijd een actieve beheerder over', () => {
  const l = lijst();
  assert.equal(kanVerwijderen(l, 'u-uit', 'u-bea').ok, true);
  assert.equal(kanVerwijderen(l, 'u-sal', 'u-bea').ok, false);
  assert.equal(kanVerwijderen(l, 'u-bea', 'u-bea').ok, false);
  assert.equal(kanVerwijderen(l, 'u-onbekend', 'u-bea').status, 404);
  // de laatste actieve beheerder: een (geblokkeerde) beheerder verwijderen terwijl er geen enkele andere actieve beheerder is
  const zonder = [{ id: 'u-bob', rol: 'beheerder', actief: false }, { id: 'u-jan', rol: 'planner', actief: true }];
  const r = kanVerwijderen(zonder, 'u-bob', 'u-jan');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.fout, /actieve beheerder/);
  // de enige actieve beheerder zelf (actief): geweigerd omdat actief
  assert.equal(kanVerwijderen([{ id: 'u-bea', rol: 'beheerder', actief: true }, { id: 'u-uit', rol: 'sales', actief: false }], 'u-bea', 'u-uit').ok, false);
});

test('niet-beheerder: 403 (planner, technieker, sales met echte sessie) en niets verandert; zonder sessie 401; zonder X-Blitz 403 csrf', async () => {
  const o = opzet();
  for (const headers of [als('u-jan', 1), als('u-sal', 1)]) {
    assert.equal((await o.gebruikers(verwijder('u-uit', headers))).status, 403);
  }
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
  assert.deepEqual(await o.echt.get('sales/u-uit', { type: 'json' }), SALES_UIT);
  const h = maakGebruikers({ getStore: () => o.echt, env: { SESSIE_GEHEIM: GEHEIM }, nu: () => NU0 });
  for (const rol of ['planner', 'technieker', 'sales']) assert.equal((await metRol(rol, () => h(verwijder('u-uit', {})))).status, 403, rol);
  assert.equal((await metGeenSessie(() => h(verwijder('u-uit', {})))).status, 401);
  const csrf = await o.gebruikers(new Request('http://localhost/api/gebruikers', {
    method: 'POST', headers: { cookie: BEA().cookie }, body: JSON.stringify({ actie: 'verwijder', id: 'u-uit' }),
  }));
  assert.equal(csrf.status, 403);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
});

test('onbekende gebruiker: 404; id ontbreekt: 400', async () => {
  const o = opzet();
  assert.equal((await o.gebruikers(verwijder('u-bestaat-niet'))).status, 404);
  assert.equal((await o.gebruikers(verwijder(''))).status, 400);
  assert.equal((await o.gebruikers(verwijder(undefined))).status, 400);
});

test('de verwijderde gebruiker kan niet meer inloggen en zijn oude sessie werkt niet meer', async () => {
  const gebruikers = lijst();
  gebruikers[5] = { ...gebruikers[5], actief: true };
  gebruikers.push({ ...gebruikers[5], id: 'u-uit2', email: 'uit2@blitz.test', actief: false });
  const o = opzet({ gebruikers });
  assert.equal((await o.gebruikers(verwijder('u-uit2'))).status, 200);
  const login = await o.login(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-blitz': '1' }, body: JSON.stringify({ email: 'uit2@blitz.test', wachtwoord: WW }),
  }));
  assert.equal(login.status, 401);
  // een sessiecookie van die (nu verwijderde) gebruiker wordt niet meer aanvaard
  const lees = await o.gebruikers(new Request('http://localhost/api/gebruikers', { headers: als('u-uit2', 1) }));
  assert.equal(lees.status, 401);
});

test('opslag: een schrijfactie die niet blijft staan geeft 503 en niets wordt opgeruimd of gelogd', async () => {
  const o = opzet();
  const stuk = { ...o.echt, setJSON: async (k, v) => (k === 'gebruikers' ? undefined : o.echt.setJSON(k, v)) };
  const h = maakGebruikers({ getStore: () => stuk, env: o.env, nu: o.nu, auth: o.auth });
  const res = await h(verwijder('u-uit'));
  assert.equal(res.status, 503);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
  assert.deepEqual(await o.echt.get('sales/u-uit', { type: 'json' }), SALES_UIT);
  assert.equal((await activiteit(o.echt)).length, 1);
});

test('opruimen mislukt (verkoperblob niet te wissen): de gebruiker is weg, antwoord 200 met opgeruimd:false en de logregel staat er', async () => {
  const o = opzet();
  const echtStuk = { ...o.echt, delete: async (k) => { if (k.startsWith('sales/')) throw new Error('storing'); return o.echt.delete(k); } };
  const getStore = opties => (opties.name === 'blitz-data' ? echtStuk : o.test);
  const h = maakGebruikers({ getStore, env: o.env, nu: o.nu, auth: o.auth });
  const res = await h(verwijder('u-uit'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, opgeruimd: false });
  assert.ok(!(await opgeslagen(o.echt)).some(g => g.id === 'u-uit'));
  assert.ok((await activiteit(o.echt)).some(a => a.actie === 'gebruiker-verwijderd'));
});

test('dezelfde verwijdering twee keer: de tweede is 404 (geen dubbele logregel)', async () => {
  const o = opzet();
  assert.equal((await o.gebruikers(verwijder('u-uit'))).status, 200);
  assert.equal((await o.gebruikers(verwijder('u-uit'))).status, 404);
  assert.equal((await activiteit(o.echt)).filter(a => a.actie === 'gebruiker-verwijderd').length, 1);
});
