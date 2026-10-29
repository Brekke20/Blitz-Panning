// tests/server-beveiliging.test.mjs — alle functies achter de rechtentabel (logins T10)
// De wrapper wordt getoetst met de kern-spy (zetKernSpyVoorTests): geen Blobs- of Zoho-aanroep, en een
// weigering van de wrapper is nooit te verwarren met een 403/400 uit de functie zelf.
import { test, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { laadVers, v1Event, zetEnv } from './nep-fetch.mjs';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { RECHTEN, regelVoor } from '../netlify/lib/rechten.js';
import { zetKernSpyVoorTests, beveiligV1, beveiligV2 } from '../netlify/lib/beveiligd.js';
import { zetMetingVoorTests } from '../netlify/lib/meting.js';
import { maakNepStore } from './nep-blobs.mjs';
import { maakAuth } from '../netlify/lib/auth.js';
import { ondertekenToken } from '../netlify/lib/sessie-token.js';

const wortel = join(import.meta.dirname, '..');
const ROLLEN = ['beheerder', 'planner', 'technieker', 'sales'];
const METHODES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const OPEN_FUNCTIES = ['confirm-afspraak', 'planning-export', 'activiteit-opruimen', 'sales-opruimen', 'auth-login', 'auth-uitloggen', 'auth-setup', 'auth-herstel', 'rapport-verwerk-background', 'rapport-vangnet'];
const WRAPPER_FUNCTIES = Object.keys(RECHTEN).filter(n => !OPEN_FUNCTIES.includes(n));

afterEach(() => zetKernSpyVoorTests(null));

// Laadt een functie vers; v1 = { handler }, v2 = default export.
async function laad(naam) {
  const mod = await laadVers(naam);
  if (typeof mod.handler === 'function') return { v1: true, fn: mod.handler };
  assert.equal(typeof mod.default, 'function', `${naam}: geen handler en geen default`);
  return { v1: false, fn: mod.default };
}

const kopSet = { 'x-blitz': '1' };
function roep({ v1, fn }, naam, methode, headers = kopSet) {
  if (v1) return fn({ ...v1Event(methode, undefined, headers), path: `/api/${naam}`, queryStringParameters: {} }, {});
  return fn(new Request(`http://localhost/api/${naam}`, { method: methode, headers }), {});
}
async function ontleed({ v1 }, res) {
  const status = v1 ? res.statusCode : res.status;
  const tekst = v1 ? res.body : await res.text();
  let body;
  try { body = tekst ? JSON.parse(tekst) : undefined; } catch { body = tekst; }
  return { status, body };
}
const spyVoor = ({ v1 }, oproepen) => (a) => {
  oproepen.push(a);
  return v1 ? { statusCode: 200, headers: {}, body: '{}' } : new Response('{}', { status: 200 });
};

test('dekking: de rij-sleutels zijn bestanden in netlify/functions en omgekeerd', () => {
  const bestanden = readdirSync(join(wortel, 'netlify', 'functions'), { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.js')).map(d => d.name.replace(/\.js$/, ''));
  assert.deepEqual(Object.keys(RECHTEN).filter(n => !bestanden.includes(n)), []);
  assert.deepEqual(bestanden.filter(n => !Object.hasOwn(RECHTEN, n)), []);
});

for (const naam of WRAPPER_FUNCTIES) {
  const rij = RECHTEN[naam];
  const methodes = METHODES.filter(m => regelVoor(naam, m) !== undefined);
  const zonderRegel = METHODES.filter(m => regelVoor(naam, m) === undefined);

  test(`${naam}: zonder sessie 401 niet-ingelogd en de kern wordt niet aangeroepen`, async () => {
    const f = await laad(naam);
    for (const methode of methodes) {
      const oproepen = [];
      zetKernSpyVoorTests(spyVoor(f, oproepen));
      const r = await metGeenSessie(async () => ontleed(f, await roep(f, naam, methode)));
      assert.equal(r.status, 401, `${naam} ${methode}`);
      assert.equal(r.body.code, 'niet-ingelogd', `${naam} ${methode}`);
      assert.equal(oproepen.length, 0, `${naam} ${methode}: kern aangeroepen`);
    }
  });

  for (const metMetingAan of [false, true]) {
    test(`${naam}: per methode en rol precies de rijen uit de rechtentabel${metMetingAan ? ' (meting aan: zelfde uitkomst)' : ''}`, async () => {
      const f = await laad(naam);
      // De meting (S1) mag de beslissing nooit veranderen: dezelfde matrix, nu met de seam aan (logregels onderdrukt).
      const oudLog = console.log;
      if (metMetingAan) { zetMetingVoorTests(true); console.log = () => {}; }
      try {
      for (const methode of methodes) {
        const toegelaten = regelVoor(naam, methode);
        for (const rol of ROLLEN) {
          const oproepen = [];
          zetKernSpyVoorTests(spyVoor(f, oproepen));
          const r = await metRol(rol, async () => ontleed(f, await roep(f, naam, methode)));
          if (toegelaten.includes(rol)) {
            assert.equal(oproepen.length, 1, `${naam} ${methode} ${rol}: kern niet precies 1x aangeroepen`);
            assert.equal(oproepen[0].naam, naam);
            assert.equal(oproepen[0].methode, methode);
            assert.equal(oproepen[0].gebruiker.rol, rol);
            assert.equal(r.status, 200);
          } else {
            assert.equal(oproepen.length, 0, `${naam} ${methode} ${rol}: kern aangeroepen`);
            assert.equal(r.status, 403, `${naam} ${methode} ${rol}`);
            assert.equal(r.body.code, 'geen-recht', `${naam} ${methode} ${rol}`);
          }
        }
      }
      } finally {
        if (metMetingAan) { console.log = oudLog; zetMetingVoorTests(null); }
      }
    });
  }

  if (zonderRegel.length && !Object.hasOwn(rij, '*')) {
    test(`${naam}: een methode zonder regel krijgt 405 van de wrapper, zonder kern`, async () => {
      const f = await laad(naam);
      for (const methode of zonderRegel) {
        const oproepen = [];
        zetKernSpyVoorTests(spyVoor(f, oproepen));
        const r = await metRol('beheerder', async () => ontleed(f, await roep(f, naam, methode)));
        assert.equal(r.status, 405, `${naam} ${methode}`);
        assert.equal(oproepen.length, 0);
      }
    });
  }
}

test('OPTIONS op elke functie geeft 204 zonder login', async () => {
  // activiteit-opruimen, sales-opruimen en rapport-vangnet zijn geplande functies zonder methodecontrole: OPTIONS zou de taak zelf draaien;
  // rapport-verwerk-background is een achtergrondfunctie (altijd 202, eigen interne sleutel).
  for (const naam of Object.keys(RECHTEN).filter(n => !['activiteit-opruimen', 'sales-opruimen', 'rapport-vangnet', 'rapport-verwerk-background'].includes(n))) {
    const f = await laad(naam);
    const r = await metGeenSessie(async () => ontleed(f, await roep(f, naam, 'OPTIONS', {})));
    assert.equal(r.status, 204, `${naam} OPTIONS`);
  }
});

test('open functies: zonder sessie geen 401 niet-ingelogd van de wrapper', async () => {
  for (const naam of ['auth-login', 'auth-uitloggen', 'auth-setup', 'auth-herstel']) {
    // POST zonder X-Blitz: de eigen CSRF-controle van de functie (403 csrf), nooit de wrapper (geen store nodig)
    const f = await laad(naam);
    const r = await metGeenSessie(async () => ontleed(f, await roep(f, naam, 'POST', {})));
    assert.notEqual(r.body?.code, 'niet-ingelogd', naam);
    assert.equal(r.status, 403, naam);
    assert.equal(r.body?.code, 'csrf', naam);
  }
  // confirm-afspraak GET zonder parameters: eigen 400-pagina
  const c = await laad('confirm-afspraak');
  const rc = await metGeenSessie(async () => ontleed(c, await roep(c, 'confirm-afspraak', 'GET', {})));
  assert.equal(rc.status, 400);
  // planning-export: eigen API-sleutelcontrole, geen sessie-401 van de wrapper
  const p = await laad('planning-export');
  const rp = await metGeenSessie(async () => ontleed(p, await roep(p, 'planning-export', 'GET', {})));
  assert.equal(rp.status, 401);
  assert.equal(rp.body.error, 'Unauthorized');
  assert.equal(rp.body.code, undefined);
  // activiteit-opruimen: enkel de rij ('open'); aanroepen zou het echte log opruimen
  assert.equal(regelVoor('activiteit-opruimen', 'GET'), 'open');
});

test('de service-sleutel- en wijzig-vlaggen staan enkel waar bedoeld', () => {
  assert.deepEqual(Object.keys(RECHTEN).filter(n => RECHTEN[n].service === true).sort(), ['afspraken', 'klantbeschikbaarheid', 'tickets']); // T12: de drie interne aanroepen van planning-export
  assert.deepEqual(Object.keys(RECHTEN).filter(n => RECHTEN[n].ookBijWijzigen === true).sort(), ['auth-ik', 'auth-wachtwoord']);
});

// ---- S1: meting (Server-Timing-kop + [meting]-logregel); enkel actief met de seam of in een Netlify-runtime ----
const META_LOG = '[meting] ';
async function metMeting(werk) {
  zetMetingVoorTests(true);
  const regels = [];
  const oud = console.log;
  console.log = (...a) => regels.push(a.join(' '));
  try {
    const r = await werk();
    return { r, logs: regels.filter(l => l.startsWith(META_LOG)).map(l => JSON.parse(l.slice(META_LOG.length))), ruw: regels.filter(l => l.startsWith(META_LOG)) };
  } finally {
    console.log = oud;
    zetMetingVoorTests(null);
  }
}
const OK1 = () => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' });
const OK2 = () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
const v1Req = (methode, headers = kopSet) => ({ ...v1Event(methode, undefined, headers), path: '/api/prijzen', queryStringParameters: { geheim: 'zoek@x.be' } });
const v2Req = (methode, headers = kopSet) => new Request('http://localhost/api/prijzen?geheim=zoek@x.be', { method: methode, headers });
const KOP = /^auth;dur=\d+, kern;dur=\d+, koud;dur=\d+, totaal;dur=\d+$/;

test('meting aan: V1 en V2 ingelogd geven de Server-Timing-kop en één logregel zonder persoonsgegevens', async () => {
  const h1 = beveiligV1('prijzen', async () => OK1());
  const h2 = beveiligV2('prijzen', async () => OK2());
  const { r, logs, ruw } = await metMeting(() => metRol('beheerder', async () => [await h1(v1Req('GET'), {}), await h2(v2Req('GET'), {})]));
  assert.match(r[0].headers['Server-Timing'], KOP);
  assert.equal(r[0].headers['Content-Type'], 'application/json');
  assert.match(r[1].headers.get('server-timing'), KOP);
  assert.equal(logs.length, 2);
  for (const l of logs) {
    assert.deepEqual(Object.keys(l).sort(), ['auth', 'blobsAuth', 'f', 'kern', 'koud', 'm', 'regio', 's', 'totaal', 'zn', 'zoho', 'zohoGewicht', 'zohoMax', 'zohoRest', 'zohoToken'].sort());
    assert.equal(l.f, 'prijzen'); assert.equal(l.m, 'GET'); assert.equal(l.s, 200);
  }
  for (const verboden of ['test-beheerder', 'lokaal.test', 'Test Beheerder', 'zoek@x.be', 'geheim', 'x-blitz']) {
    assert.ok(!ruw.join('\n').includes(verboden), `logregel bevat "${verboden}"`);
  }
});

test('meting aan: geen kop op 401, 403, 503, 405, OPTIONS en open rijen, maar wel een logregel met de status', async () => {
  const h1 = beveiligV1('prijzen', async () => OK1());
  const h2 = beveiligV2('prijzen', async () => OK2());
  const tickets = beveiligV1('tickets', async () => OK1());
  const open = beveiligV1('confirm-afspraak', async () => OK1());
  const open2 = beveiligV2('confirm-afspraak', async () => OK2());
  const kopV1 = r => r.headers['Server-Timing'];
  const kopV2 = r => r.headers.get('server-timing');
  const geenRecht = ROLLEN.find(rol => !regelVoor('prijzen', 'PUT').includes(rol));
  const weigerAuth = status => ({ vereisGebruiker: async () => ({ ok: false, status, fout: 'x', code: status === 503 ? 'opslag-storing' : 'niet-ingelogd' }) });
  const w503 = beveiligV1('prijzen', async () => OK1(), { auth: weigerAuth(503) });
  const { r, logs } = await metMeting(async () => [
    await metGeenSessie(async () => [await h1(v1Req('GET'), {}), await h2(v2Req('GET'), {})]),         // 401
    await metRol(geenRecht, async () => [await h1(v1Req('PUT'), {}), await h2(v2Req('PUT'), {})]),     // 403
    await w503(v1Req('GET'), {}),                                                                       // 503
    await metRol('beheerder', async () => [await h1(v1Req('DELETE'), {}), await h2(v2Req('DELETE'), {})]), // 405
    await tickets(v1Req('OPTIONS', {}), {}),                                                             // 204 door de wrapper
    await open(v1Req('GET', {}), {}),                                                                    // 'open'-rij
    await open2(v2Req('GET', {}), {}),
  ]);
  const [a401, a403, a503, a405, opt, o1, o2] = r;
  assert.deepEqual([a401[0].statusCode, a401[1].status], [401, 401]);
  assert.deepEqual([a403[0].statusCode, a403[1].status], [403, 403]);
  assert.equal(a503.statusCode, 503);
  assert.deepEqual([a405[0].statusCode, a405[1].status], [405, 405]);
  assert.equal(opt.statusCode, 204);
  assert.deepEqual([o1.statusCode, o2.status], [200, 200]);
  for (const x of [a401[0], a403[0], a503, a405[0], opt, o1]) assert.equal(kopV1(x), undefined);
  for (const x of [a401[1], a403[1], a405[1], o2]) assert.equal(kopV2(x), null);
  assert.deepEqual(logs.map(l => l.s), [401, 401, 403, 403, 503, 405, 405, 204, 200, 200]);
  assert.deepEqual(logs.map(l => l.f), ['prijzen', 'prijzen', 'prijzen', 'prijzen', 'prijzen', 'prijzen', 'prijzen', 'tickets', 'confirm-afspraak', 'confirm-afspraak']);
  // een weigering heeft geen kern; een 'open'-rij heeft geen auth
  assert.ok(logs.slice(0, 7).every(l => l.kern === null));
  assert.ok(logs.slice(8).every(l => l.auth === null && typeof l.kern === 'number'));
});

test('meting uit (standaard): geen kop, geen logregel, antwoord byte-gelijk', async () => {
  const h1 = beveiligV1('prijzen', async () => OK1());
  const h2 = beveiligV2('prijzen', async () => OK2());
  const regels = [];
  const oud = console.log; console.log = (...a) => regels.push(a.join(' '));
  try {
    const [r1, r2] = await metRol('beheerder', async () => [await h1(v1Req('GET'), {}), await h2(v2Req('GET'), {})]);
    assert.deepEqual(r1, OK1());
    assert.deepEqual([...r2.headers.entries()], [['content-type', 'application/json']]);
    assert.deepEqual(regels, []);
  } finally {
    console.log = oud;
  }
});

test('meting aan: een V2-antwoord met onveranderlijke koppen en een gooiende kern blijven zoals zonder meting', async () => {
  const vast = Response.error();
  const h = beveiligV2('prijzen', async () => vast);
  const fout = new Error('kern stuk');
  const g = beveiligV2('prijzen', async () => { throw fout; });
  const { r, logs } = await metMeting(() => metRol('beheerder', async () => [
    await h(v2Req('GET'), {}),
    await g(v2Req('GET'), {}).then(() => null, e => e),
  ]));
  assert.equal(r[0], vast);
  assert.equal(r[1], fout);
  assert.equal(logs.length, 2);
  assert.equal(logs[1].s, null);
});

test('meting aan: met de echte sessiecontrole telt blobs-auth mee in auth', async () => {
  const GEHEIM = 'testgeheim-testgeheim';
  const store = maakNepStore({ gebruikers: { versie: 1, gebruikers: [{ id: 'u-bea', email: 'bea@blitz.test', naam: 'Bea', rol: 'beheerder', actief: true, sessieVersie: 1 }] } });
  const aanroepen = [];
  const auth = maakAuth({ getStore: opties => { aanroepen.push(opties); return store; }, env: { SESSIE_GEHEIM: GEHEIM } });
  const token = ondertekenToken({ uid: 'u-bea', sv: 1, exp: Math.floor(Date.now() / 1000) + 3600 }, GEHEIM);
  const h = beveiligV2('prijzen', async () => OK2(), { auth });
  const { r, logs } = await metMeting(() => h(v2Req('GET', { cookie: `blitz_sessie=${token}` }), {}));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('server-timing'), /^auth;dur=\d+, blobs-auth;dur=\d+, kern;dur=\d+, koud;dur=\d+, totaal;dur=\d+$/);
  assert.equal(typeof logs[0].blobsAuth, 'number');
  assert.ok(logs[0].blobsAuth <= logs[0].auth);
  assert.deepEqual(aanroepen, [{ name: 'blitz-data', consistency: 'strong' }]); // dezelfde Blobs-aanroepen als zonder meting
});

test('meting: de seam gooit in een Netlify-runtime (zoals zetKernSpyVoorTests)', () => {
  const herstel = zetEnv({ NETLIFY: 'true' });
  try { assert.throws(() => zetMetingVoorTests(true), /Netlify-runtime/); } finally { herstel(); }
});
