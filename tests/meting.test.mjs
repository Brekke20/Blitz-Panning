// netlify/lib/meting.js: Server-Timing-kop en meetregel (S1). Deterministisch: een nepklok die enkel
// verspringt als de test dat zegt. Nooit echte netwerkaanroepen.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  maakMeting, huidigeMeting, meetOptioneel, meetZoho, metingActief, zetMetingVoorTests, herstelKoudVoorTests,
  startVerzoekMeting, draaiMetMeting,
} from '../netlify/lib/meting.js';
import { zetEnv } from './nep-fetch.mjs';

afterEach(() => { zetMetingVoorTests(null); herstelKoudVoorTests(); });

function klok(begin = 1000) {
  const k = { t: begin, nu: () => k.t, loop: ms => { k.t += ms; } };
  return k;
}
const GEEN_KOUD = () => 0;

test('kop(): exact de verwachte tekst (auth, blobs-auth, kern, zoho met n en max, zoho-token, koud, totaal)', async () => {
  const k = klok();
  const m = maakMeting({ nu: k.nu, koud: GEEN_KOUD });
  await m.meet('auth', async () => {
    await m.meet('blobs-auth', async () => k.loop(398));
    k.loop(14);
  });
  await m.meet('kern', async () => {
    await m.zoho(async () => { k.loop(120); return {}; }, { token: true });
    await Promise.all([
      m.zoho(async () => { k.loop(0); return {}; }),
      m.zoho(async () => ({})),
    ]);
    k.loop(5000);
  });
  m.sluit();
  assert.equal(
    m.kop(),
    'auth;dur=412, blobs-auth;dur=398, kern;dur=5120, zoho;dur=120;desc="n=3 max=2", zoho-token;dur=120, koud;dur=0, totaal;dur=5532',
  );
});

test('kop(): zonder Zoho-aanroep geen zoho en zoho-token; onbekende onderdelen ontbreken (geen auth bij open rijen)', async () => {
  const k = klok();
  const m = maakMeting({ nu: k.nu, koud: GEEN_KOUD });
  await m.meet('kern', async () => k.loop(40));
  m.sluit();
  assert.equal(m.kop(), 'kern;dur=40, koud;dur=0, totaal;dur=40');
});

test('kop(): zoho-token is 0 als het token uit de cache kwam (alleen een gewone Zoho-aanroep)', async () => {
  const k = klok();
  const m = maakMeting({ nu: k.nu, koud: GEEN_KOUD });
  await m.zoho(async () => { k.loop(310); return {}; });
  m.sluit();
  assert.equal(m.kop(), 'zoho;dur=310;desc="n=1 max=1", zoho-token;dur=0, koud;dur=0, totaal;dur=310');
});

test('meet(): telt ook bij een uitzondering en laat die ongewijzigd door', async () => {
  const k = klok();
  const m = maakMeting({ nu: k.nu, koud: GEEN_KOUD });
  const fout = new Error('boem');
  await assert.rejects(() => m.meet('kern', async () => { k.loop(7); throw fout; }), e => e === fout);
  await assert.rejects(() => m.meet('auth', () => { throw fout; }), e => e === fout); // synchroon gooiende functie
  m.sluit();
  assert.equal(m.kop(), 'auth;dur=0, kern;dur=7, koud;dur=0, totaal;dur=7');
});

test('koud: enkel bij de eerste meting van de instantie, daarna 0', () => {
  const eerste = maakMeting({ nu: klok().nu, uptimeMs: () => 5321.4 });
  const tweede = maakMeting({ nu: klok().nu, uptimeMs: () => 9999 });
  eerste.sluit(); tweede.sluit();
  assert.equal(eerste.kop(), 'koud;dur=5321, totaal;dur=0');
  assert.equal(tweede.kop(), 'koud;dur=0, totaal;dur=0');
  assert.equal(eerste.logObject({ f: 'x', m: 'GET', s: 200 }).koud, 5321);
  assert.equal(tweede.logObject({ f: 'x', m: 'GET', s: 200 }).koud, 0);
});

test('een gooiende klok of uptime laat het resultaat van meet() ongemoeid en kop() gooit nooit', async () => {
  const kapot = maakMeting({ nu: () => { throw new Error('klok stuk'); }, uptimeMs: () => { throw new Error('uptime stuk'); } });
  assert.equal(await kapot.meet('kern', async () => 42), 42);
  assert.equal(await kapot.zoho(async () => 'antwoord'), 'antwoord');
  kapot.sluit();
  assert.doesNotThrow(() => kapot.kop());
  assert.equal(typeof kapot.kop(), 'string');
  assert.doesNotThrow(() => kapot.logObject({ f: 'x', m: 'GET', s: 200 }));
  const nan = maakMeting({ nu: () => NaN, koud: GEEN_KOUD });
  assert.equal(await nan.meet('kern', async () => 'ok'), 'ok');
  assert.doesNotThrow(() => nan.kop());
});

test('tel() telt op; ongeldige waarden worden genegeerd', () => {
  const m = maakMeting({ nu: klok().nu, koud: GEEN_KOUD });
  m.tel('kern', 10); m.tel('kern', 5.4); m.tel('kern', NaN); m.tel('kern', -3); m.tel('kern', 'x');
  m.sluit();
  assert.equal(m.kop(), 'kern;dur=15, koud;dur=0, totaal;dur=0');
});

test('zoho(): leest de limietkoppen enkel als getal en negeert al het andere', async () => {
  const m = maakMeting({ nu: klok().nu, koud: GEEN_KOUD });
  const met = (rest, gewicht) => ({ headers: new Headers({ 'X-Rate-Limit-Remaining-v3': rest, 'X-Rate-Limit-Request-Weight-v3': gewicht }) });
  await m.zoho(async () => met('2998', '3'));
  await m.zoho(async () => met('kan@x.be', '<script>')); // geen getal: niet overnemen
  await m.zoho(async () => ({}));                          // geen koppen: niets
  await m.zoho(async () => ({ headers: null }));
  m.sluit();
  const l = m.logObject({ f: 'tickets', m: 'GET', s: 200 });
  assert.equal(l.zohoRest, 2998);
  assert.equal(l.zohoGewicht, 3);
  assert.equal(l.zn, 4);
});

test('zoho(): gooit de fetch, dan telt de aanroep mee en komt dezelfde fout terug', async () => {
  const k = klok();
  const m = maakMeting({ nu: k.nu, koud: GEEN_KOUD });
  const fout = new Error('netwerk');
  await assert.rejects(() => m.zoho(async () => { k.loop(30); throw fout; }), e => e === fout);
  m.sluit();
  const l = m.logObject({ f: 'x', m: 'GET', s: 500 });
  assert.equal(l.zn, 1);
  assert.equal(l.zoho, 30);
});

test('logObject(): vaste sleutels, geen persoonsgegevens, onbekende onderdelen null', async () => {
  const k = klok();
  const m = maakMeting({ nu: k.nu, koud: GEEN_KOUD, regio: () => 'eu-west-1' });
  await m.meet('auth', async () => { await m.meet('blobs-auth', async () => k.loop(11)); k.loop(1); });
  m.sluit();
  const l = m.logObject({ f: 'prijzen', m: 'get', s: 401 });
  assert.deepEqual(l, {
    f: 'prijzen', m: 'GET', s: 401, auth: 12, blobsAuth: 11, kern: null, zoho: 0, zn: 0, zohoToken: 0, zohoMax: 0,
    koud: 0, regio: 'eu-west-1', zohoRest: null, zohoGewicht: null, totaal: 12,
  });
  // een rare methode, functienaam, status of regio komt niet ongefilterd in het log
  assert.equal(m.logObject({ f: 'x', m: 'GET /?a=b@c.be', s: 200 }).m, 'ANDERE');
  assert.equal(m.logObject({ f: 'a b@c.be', m: 'GET', s: 200 }).f, 'onbekend');
  assert.equal(m.logObject({ f: 'x', m: 'GET', s: 'rood' }).s, null);
  const vreemd = maakMeting({ nu: klok().nu, koud: GEEN_KOUD, regio: () => 'iemand@x.be' });
  assert.equal(vreemd.logObject({ f: 'x', m: 'GET', s: 200 }).regio, 'onbekend');
});

// ---- AsyncLocalStorage ----
test('huidigeMeting(): per verzoek een eigen meting, ook voor dieper gelegen code en naast elkaar lopende verzoeken', async () => {
  assert.equal(huidigeMeting(), null);
  const a = maakMeting({ nu: klok().nu, koud: GEEN_KOUD });
  const b = maakMeting({ nu: klok().nu, koud: GEEN_KOUD });
  const tik = () => new Promise(r => setImmediate(r));
  const antwoord = () => ({ status: 200, headers: new Headers() });
  const gezien = [];
  const oud = console.log; console.log = () => {};
  try { await Promise.all([
    draaiMetMeting(a, { f: 'x', methode: 'GET' }, async () => { await tik(); gezien.push(['a', huidigeMeting() === a]); return antwoord(); }, 'v2'),
    draaiMetMeting(b, { f: 'x', methode: 'GET' }, async () => {
      gezien.push(['b', huidigeMeting() === b]); await tik(); gezien.push(['b2', huidigeMeting() === b]); return antwoord();
    }, 'v2'),
  ]); } finally { console.log = oud; }
  assert.deepEqual(gezien.sort((x, y) => x[0].localeCompare(y[0])), [['a', true], ['b', true], ['b2', true]]);
  assert.equal(huidigeMeting(), null);
});

test('meetOptioneel() en meetZoho() zijn zonder meting een gewone doorgave', async () => {
  assert.equal(await meetOptioneel('auth', async () => 'x'), 'x');
  assert.equal(await meetZoho(async () => 'y'), 'y');
  const fout = new Error('z');
  await assert.rejects(() => meetOptioneel('auth', async () => { throw fout; }), e => e === fout);
});

// ---- schakelaar ----
test('metingActief(): uit buiten een Netlify-runtime, aan erin; de testseam zet hem aan en gooit in een runtime', () => {
  const herstel = zetEnv({ NETLIFY: undefined, AWS_LAMBDA_FUNCTION_NAME: undefined, LAMBDA_TASK_ROOT: undefined });
  try {
    assert.equal(metingActief(), false);
    assert.equal(startVerzoekMeting(), null);
    zetMetingVoorTests(true);
    assert.equal(metingActief(), true);
    assert.notEqual(startVerzoekMeting(), null);
    zetMetingVoorTests(null);
    assert.equal(metingActief(), false);
    process.env.NETLIFY = 'true';
    assert.equal(metingActief(), true);
    assert.notEqual(startVerzoekMeting(), null);
    assert.throws(() => zetMetingVoorTests(true), /Netlify-runtime/);
    assert.throws(() => zetMetingVoorTests(null), /Netlify-runtime/);
  } finally {
    herstel();
  }
});

// ---- draaiMetMeting: kop en log ----
test('draaiMetMeting(): kop alleen voor een ingelogde gebruiker; log altijd; een onveranderlijk antwoord geeft geen fout', async () => {
  const logs = [];
  const oud = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const v2 = (ingelogd, res) => {
      const m = maakMeting({ nu: klok().nu, koud: GEEN_KOUD });
      return draaiMetMeting(m, { f: 'prijzen', methode: 'GET' }, async () => { if (ingelogd) huidigeMeting().zetIngelogd(); return res; }, 'v2');
    };
    const met = await v2(true, new Response('{}', { status: 200 }));
    assert.match(met.headers.get('Server-Timing'), /totaal;dur=0/);
    const zonder = await v2(false, new Response('{}', { status: 401 }));
    assert.equal(zonder.headers.get('Server-Timing'), null);
    const vast = Response.error(); // onveranderlijke koppen
    assert.equal(await v2(true, vast), vast);
    assert.equal(logs.length, 3);
    assert.ok(logs.every(r => r.startsWith('[meting] {')));
  } finally {
    console.log = oud;
  }
});

test('draaiMetMeting(): v1 geeft een kopie met de kop en laat het origineel ongemoeid; een gooiende functie wordt gelogd en gegooid', async () => {
  const logs = [];
  const oud = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const origineel = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' };
    const m = maakMeting({ nu: klok().nu, koud: GEEN_KOUD });
    const uit = await draaiMetMeting(m, { f: 'prijzen', methode: 'GET' }, async () => { huidigeMeting().zetIngelogd(); return origineel; }, 'v1');
    assert.deepEqual(origineel.headers, { 'Content-Type': 'application/json' });
    assert.notEqual(uit, origineel);
    assert.equal(uit.statusCode, 200);
    assert.equal(uit.body, '{}');
    assert.match(uit.headers['Server-Timing'], /totaal;dur=0/);
    assert.equal(uit.headers['Content-Type'], 'application/json');

    const fout = new Error('kern stuk');
    const m2 = maakMeting({ nu: klok().nu, koud: GEEN_KOUD });
    await assert.rejects(() => draaiMetMeting(m2, { f: 'prijzen', methode: 'GET' }, async () => { throw fout; }, 'v1'), e => e === fout);
    assert.equal(logs.length, 2);
    assert.match(logs[1], /"s":null/);
  } finally {
    console.log = oud;
  }
});

test('draaiMetMeting(): een gooiende console.log verandert het antwoord niet', async () => {
  const oud = console.log; console.log = () => { throw new Error('log stuk'); };
  try {
    const res = new Response('{}', { status: 200 });
    const m = maakMeting({ nu: klok().nu, koud: GEEN_KOUD });
    assert.equal(await draaiMetMeting(m, { f: 'x', methode: 'GET' }, async () => res, 'v2'), res);
  } finally {
    console.log = oud;
  }
});
