// tests/server-planning-export-auth.test.mjs — planning-export stuurt zijn service-sleutel mee op de drie interne
// aanroepen (logins T12). De nep-fetch stuurt elke interne aanroep door de ECHTE wrapper van tickets,
// klantbeschikbaarheid en afspraken (met de echte rechtentabel en zonder sessie): met de sleutel 200, zonder 401.
process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, zetEnv } from './nep-fetch.mjs';
import { metGeenSessie } from './auth-hulp.mjs';
import { beveiligV1, beveiligV2 } from '../netlify/lib/beveiligd.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { v1Json } from '../netlify/lib/http.js';

const SLEUTEL = 'export-sleutel-voor-test';
const BASIS = 'https://blitz.example';
const NAMEN = ['tickets', 'klantbeschikbaarheid', 'afspraken'];
const BODY = { tickets: { tickets: [], pendingTickets: [], plannedTickets: [] }, klantbeschikbaarheid: { items: {} }, afspraken: { afspraken: [] } };

let herstelEnv;
test.beforeEach(() => { herstelEnv = zetEnv({ PLANNING_EXPORT_API_KEY: SLEUTEL, NETLIFY_BLOBS_CONTEXT: undefined }); });
test.afterEach(() => herstelEnv());

const kleineKoppen = h => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

// Router: stuurt /api/<naam> door de echte wrapper van die functie; onthoudt wat elke wrapper antwoordde.
function wrapperRouter(antwoorden, { laatSleutelWeg = null } = {}) {
  return async (url, opts = {}) => {
    const naam = NAMEN.find(n => url.endsWith(`/api/${n}`));
    if (!naam) return undefined;
    const koppen = kleineKoppen(opts.headers);
    if (laatSleutelWeg === naam) delete koppen.authorization;
    const wrapper = beveiligV1(naam, async () => v1Json(200, BODY[naam], {}));
    const res = await wrapper({ httpMethod: opts.method || 'GET', headers: koppen }, {});
    antwoorden[naam] = res.statusCode;
    return new Response(res.body, { status: res.statusCode, headers: { 'Content-Type': 'application/json' } });
  };
}

async function draaiExport(router) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers('planning-export');
  const res = await metGlobaleFetch(fn, () => mod.handler({
    httpMethod: 'GET', headers: { host: 'blitz.example', authorization: `Bearer ${SLEUTEL}` },
  }));
  return { res, calls };
}

test('rechtentabel: tickets, klantbeschikbaarheid en afspraken aanvaarden de service-sleutel', () => {
  for (const n of NAMEN) assert.equal(RECHTEN[n].service, true, n);
});

test('planning-export: de drie interne aanroepen dragen dezelfde sleutel en slagen door de wrappers (200)', async () => {
  const antwoorden = {};
  const { res, calls } = await metGeenSessie(() => draaiExport(wrapperRouter(antwoorden)));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), []);
  assert.deepEqual(calls.map(c => c.url), NAMEN.map(n => `${BASIS}/api/${n}`));
  for (const c of calls) assert.equal(c.method, 'GET');
  for (const c of calls) assert.equal(c.headers.Authorization, `Bearer ${SLEUTEL}`);
  assert.deepEqual(antwoorden, { tickets: 200, klantbeschikbaarheid: 200, afspraken: 200 });
});

test('de sleutel valt weg bij één interne aanroep: die wrapper antwoordt 401', async () => {
  for (const weg of NAMEN) {
    const antwoorden = {};
    const { res } = await metGeenSessie(() => draaiExport(wrapperRouter(antwoorden, { laatSleutelWeg: weg })));
    assert.equal(antwoorden[weg], 401, `${weg} zonder sleutel`);
    // tickets en afspraken zijn verplicht (500 bij een fout); klantbeschikbaarheid valt stil terug op de standaardduur.
    assert.equal(res.statusCode, weg === 'klantbeschikbaarheid' ? 200 : 500, weg);
  }
});

test('de service-sleutel geldt enkel voor GET: een schrijvende aanroep met de sleutel blijft geweigerd', async () => {
  await metGeenSessie(async () => {
    for (const [naam, methode] of [['afspraken', 'PUT'], ['klantbeschikbaarheid', 'PUT']]) {
      const wrapper = beveiligV2(naam, async () => new Response('{}'));
      const res = await wrapper(new Request(`${BASIS}/api/${naam}`, {
        method: methode, headers: { authorization: `Bearer ${SLEUTEL}`, 'x-blitz': '1', 'content-type': 'application/json' }, body: '{}',
      }), {});
      assert.equal(res.status, 401, `${methode} ${naam}`);
    }
  });
});

test('een foute sleutel op een interne aanroep geeft 401', async () => {
  await metGeenSessie(async () => {
    for (const naam of NAMEN) {
      const res = await beveiligV1(naam, async () => v1Json(200, {}, {}))({ httpMethod: 'GET', headers: { authorization: 'Bearer FOUT' } }, {});
      assert.equal(res.statusCode, 401, naam);
    }
  });
});
