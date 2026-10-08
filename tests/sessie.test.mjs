import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// sessie.js houdt module-toestand bij: elke test laadt een verse instantie.
let teller = 0;
async function nieuweSessie({ antwoorden = [], cache = null, zoek = '' } = {}) {
  const opslag = new Map();
  if (cache) opslag.set('blitz_sessie_cache', JSON.stringify(cache));
  let herladen = 0;
  const aanroepen = [];
  globalThis.localStorage = {
    getItem: k => (opslag.has(k) ? opslag.get(k) : null),
    setItem: (k, v) => { opslag.set(k, String(v)); },
    removeItem: k => { opslag.delete(k); },
  };
  globalThis.location = { search: zoek, reload: () => { herladen++; }, href: 'https://app.test/' };
  globalThis.fetch = async (pad, init) => {
    aanroepen.push({ pad, init });
    const a = antwoorden.shift();
    if (a instanceof Error) throw a;
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status });
  };
  const m = await import('../public/js/kern/sessie.js?v=' + (++teller));
  return { m, opslag, aanroepen, herladen: () => herladen };
}
const ok = (gebruiker, extra = {}) => ({
  status: 200,
  json: {
    gebruiker,
    rechten: { beheer: gebruiker.rol === 'beheerder', plannen: ['beheerder', 'planner'].includes(gebruiker.rol), alleSales: false },
    moetWachtwoordWijzigen: false,
    lokaleDev: false,
    ...extra,
  },
});
const planner = { id: 'u1', email: 'p@x.be', naam: 'Pia', rol: 'planner' };
const tim = { id: 'u2', email: 't@x.be', naam: 'Tim', rol: 'technieker', zohoNaam: 'Tim' };

beforeEach(() => { delete globalThis.document; });

test('200: huidigeGebruiker, cache en rechten worden bewaard', async () => {
  const { m, opslag } = await nieuweSessie({ antwoorden: [ok(planner)] });
  assert.equal(m.huidigeGebruiker(), null);
  const g = await m.laadSessie();
  assert.deepEqual(g, planner);
  assert.deepEqual(m.huidigeGebruiker(), planner);
  assert.deepEqual(JSON.parse(opslag.get('blitz_sessie_cache')), planner);
  assert.deepEqual(m.huidigeRechten(), { beheer: false, plannen: true, alleSales: false });
});

test('401: toonInloggen met setupNodig, daarna een tweede auth-ik; de cache van een vorige gebruiker is vervangen', async () => {
  const { m, aanroepen, opslag } = await nieuweSessie({ antwoorden: [{ status: 401, json: { code: 'niet-ingelogd', setupNodig: true } }, ok(planner)], cache: tim });
  const oproepen = [];
  m.zetInlogUi({ toonInloggen: async (o) => { oproepen.push(o); assert.equal(aanroepen.length, 1); } });
  const g = await m.laadSessie();
  assert.deepEqual(oproepen, [{ setupNodig: true }]);
  assert.equal(aanroepen.length, 2);
  assert.equal(aanroepen[1].pad, '/api/auth-ik');
  assert.deepEqual(g, planner);
  assert.deepEqual(JSON.parse(opslag.get('blitz_sessie_cache')), planner);
});

test('401 zonder geregistreerde inlog-UI: laadSessie gooit (geen eindeloze lus)', async () => {
  const { m, aanroepen } = await nieuweSessie({ antwoorden: [{ status: 401, json: { code: 'niet-ingelogd' } }] });
  await assert.rejects(m.laadSessie());
  assert.equal(aanroepen.length, 1);
});

test('twee gelijktijdige laadSessie(): één auth-ik en één toonInloggen', async () => {
  const { m, aanroepen } = await nieuweSessie({ antwoorden: [{ status: 401, json: { code: 'niet-ingelogd' } }, ok(planner)] });
  let n = 0;
  m.zetInlogUi({ toonInloggen: async (o) => { n++; assert.deepEqual(o, { setupNodig: false }); } });
  const [a, b] = await Promise.all([m.laadSessie(), m.laadSessie()]);
  assert.equal(n, 1);
  assert.equal(aanroepen.length, 2);
  assert.equal(a, b);
});

test('na afloop start een volgende laadSessie() weer een nieuw verzoek', async () => {
  const { m, aanroepen } = await nieuweSessie({ antwoorden: [ok(planner), ok(planner)] });
  await m.laadSessie();
  await m.laadSessie();
  assert.equal(aanroepen.length, 2);
});

test('moetWachtwoordWijzigen: toonWachtwoordWijzigen eerst, daarna opnieuw auth-ik', async () => {
  const { m, aanroepen } = await nieuweSessie({ antwoorden: [ok(planner, { moetWachtwoordWijzigen: true }), ok(planner)] });
  const volgorde = [];
  m.zetInlogUi({ toonWachtwoordWijzigen: async () => { volgorde.push('wijzigen'); assert.equal(aanroepen.length, 1); } });
  await m.laadSessie();
  assert.deepEqual(volgorde, ['wijzigen']);
  assert.equal(aanroepen.length, 2);
});

test('netwerkfout met cache: resolve met de cache-gebruiker, geen loginscherm', async () => {
  const { m } = await nieuweSessie({ antwoorden: [new TypeError('Failed to fetch')], cache: tim });
  m.zetInlogUi({ toonInloggen: async () => { assert.fail('geen loginscherm'); }, toonGeenVerbinding: async () => { assert.fail('geen verbinding-scherm'); } });
  const g = await m.laadSessie();
  assert.deepEqual(g, tim);
  assert.deepEqual(m.huidigeGebruiker(), tim);
  assert.deepEqual(m.huidigeRechten(), { beheer: false, plannen: false, alleSales: false });
});

test('netwerkfout zonder cache: toonGeenVerbinding; na "opnieuw proberen" volgt een nieuw verzoek', async () => {
  const { m, aanroepen } = await nieuweSessie({ antwoorden: [new TypeError('Failed to fetch'), ok(planner)] });
  let n = 0;
  m.zetInlogUi({ toonGeenVerbinding: async () => { n++; assert.equal(aanroepen.length, 1); } });
  const g = await m.laadSessie();
  assert.equal(n, 1);
  assert.deepEqual(g, planner);
});

test('503 opslag-storing: toast, geen loginscherm; met cache gewoon doorstarten', async () => {
  const { m } = await nieuweSessie({ antwoorden: [{ status: 503, json: { code: 'opslag-storing' } }], cache: planner });
  const el = { textContent: '', classList: { add() {}, remove() {} } };
  globalThis.document = { getElementById: () => el };
  m.zetInlogUi({ toonInloggen: async () => { assert.fail('geen loginscherm'); } });
  const g = await m.laadSessie();
  assert.deepEqual(g, planner);
  assert.match(el.textContent, /opnieuw/i);
});

test('503 opslag-storing zonder cache: toonGeenVerbinding (geen loginscherm)', async () => {
  const { m } = await nieuweSessie({ antwoorden: [{ status: 503, json: { code: 'opslag-storing' } }, ok(planner)] });
  let n = 0;
  m.zetInlogUi({ toonInloggen: async () => { assert.fail('geen loginscherm'); }, toonGeenVerbinding: async () => { n++; } });
  assert.deepEqual(await m.laadSessie(), planner);
  assert.equal(n, 1);
});

test('gebruikers-id wisselt t.o.v. de vorige in-memory gebruiker: pagina herladen', async () => {
  const { m, herladen } = await nieuweSessie({ antwoorden: [ok(planner), ok(tim), ok(tim)] });
  await m.laadSessie();
  assert.equal(herladen(), 0);
  await m.laadSessie(); // andere id
  assert.equal(herladen(), 1);
  await m.laadSessie(); // zelfde id
  assert.equal(herladen(), 1);
});

test('magSchrijvenVoor: technieker enkel eigen genormaliseerde zohoNaam; planner/beheerder altijd; sales nooit', async () => {
  const t = await nieuweSessie({ antwoorden: [ok(tim)] });
  assert.equal(t.m.magSchrijvenVoor('Tim'), false, 'nog niet ingelogd');
  await t.m.laadSessie();
  assert.equal(t.m.magSchrijvenVoor('tim '), true);
  assert.equal(t.m.magSchrijvenVoor('  TIM'), true);
  assert.equal(t.m.magSchrijvenVoor('Roel'), false);
  assert.equal(t.m.magSchrijvenVoor(''), false);
  assert.equal(t.m.magSchrijvenVoor(undefined), false);
  const zonderNaam = await nieuweSessie({ antwoorden: [ok({ ...tim, zohoNaam: undefined })] });
  await zonderNaam.m.laadSessie();
  assert.equal(zonderNaam.m.magSchrijvenVoor(''), false);
  const p = await nieuweSessie({ antwoorden: [ok(planner)] });
  await p.m.laadSessie();
  assert.equal(p.m.magSchrijvenVoor('Roel'), true);
  const b = await nieuweSessie({ antwoorden: [ok({ ...planner, rol: 'beheerder' })] });
  await b.m.laadSessie();
  assert.equal(b.m.magSchrijvenVoor('Roel'), true);
  const s = await nieuweSessie({ antwoorden: [ok({ id: 's', naam: 'S', email: 's@x.be', rol: 'sales' })] });
  await s.m.laadSessie();
  assert.equal(s.m.magSchrijvenVoor('Roel'), false);
});

test('heeftRol', async () => {
  const { m } = await nieuweSessie({ antwoorden: [ok(planner)] });
  assert.equal(m.heeftRol('planner'), false, 'nog niet ingelogd');
  await m.laadSessie();
  assert.equal(m.heeftRol('beheerder', 'planner'), true);
  assert.equal(m.heeftRol('beheerder'), false);
  assert.equal(m.heeftRol(), false);
});

test('afmelden: POST auth-uitloggen met X-Blitz, cache gewist, alle haken (ook na een worp) en herladen', async () => {
  const { m, aanroepen, opslag, herladen } = await nieuweSessie({ antwoorden: [ok(planner), { status: 200, json: { ok: true } }] });
  await m.laadSessie();
  const haken = [];
  m.registreerAfmeldHaak(() => { haken.push('a'); throw new Error('stuk'); });
  m.registreerAfmeldHaak(async () => { haken.push('b'); });
  await m.afmelden();
  assert.equal(aanroepen[1].pad, '/api/auth-uitloggen');
  assert.equal(aanroepen[1].init.method, 'POST');
  assert.equal(new Headers(aanroepen[1].init.headers).get('X-Blitz'), '1');
  assert.equal(opslag.has('blitz_sessie_cache'), false);
  assert.deepEqual(haken, ['a', 'b']);
  assert.equal(herladen(), 1);
});

test('afmelden: ook bij een netwerkfout wordt alles gewist en herladen', async () => {
  const { m, opslag, herladen } = await nieuweSessie({ antwoorden: [ok(planner), new TypeError('Failed to fetch')] });
  await m.laadSessie();
  await m.afmelden();
  assert.equal(opslag.has('blitz_sessie_cache'), false);
  assert.equal(herladen(), 1);
});

test('isLokaleDev: false vóór het eerste auth-ik, daarna de vlag', async () => {
  const a = await nieuweSessie({ antwoorden: [ok(planner, { lokaleDev: true })] });
  assert.equal(a.m.isLokaleDev(), false);
  await a.m.laadSessie();
  assert.equal(a.m.isLokaleDev(), true);
  const b = await nieuweSessie({ antwoorden: [ok(planner, { lokaleDev: false })] });
  await b.m.laadSessie();
  assert.equal(b.m.isLokaleDev(), false);
});

test('testRolVoorHeader: testmodus standaard beheerder; null na lokaleDev:false; null buiten testmodus; keuze uit localStorage', async () => {
  const a = await nieuweSessie({ zoek: '?test', antwoorden: [ok(planner, { lokaleDev: true }), ok(planner, { lokaleDev: false })] });
  assert.equal(a.m.testRolVoorHeader(), 'beheerder', 'vlag onbekend');
  await a.m.laadSessie();
  assert.equal(a.m.testRolVoorHeader(), 'beheerder', 'vlag true');
  a.opslag.set('blitz_test_rol', 'planner');
  assert.equal(a.m.testRolVoorHeader(), 'planner');
  a.opslag.set('blitz_test_rol', 'onzin');
  assert.equal(a.m.testRolVoorHeader(), 'beheerder', 'onbekende rol valt terug op de standaard');
  await a.m.laadSessie();
  assert.equal(a.m.testRolVoorHeader(), null, 'productie met ?test');
  const b = await nieuweSessie({ zoek: '', antwoorden: [] });
  assert.equal(b.m.testRolVoorHeader(), null, 'buiten testmodus');
});

test('meldOpslagStoring toont een toast en gooit nooit (ook zonder document)', async () => {
  const { m } = await nieuweSessie();
  m.meldOpslagStoring(); // geen document: geen worp
  const el = { textContent: '', classList: { add() {}, remove() {} } };
  globalThis.document = { getElementById: () => el };
  m.meldOpslagStoring();
  assert.match(el.textContent, /opnieuw/i);
});
