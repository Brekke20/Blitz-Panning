// Beslislogica van de service worker (etappe 7, N3): zuivere eenheidstests met nep-caches, nep-fetch en nep-klok.
// Vaste lijn: /api en niet-GET worden NOOIT afgehandeld (null) en NOOIT bewaard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import strategie from '../public/sw-strategie.js';

const ORIGIN = 'https://app.test';
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const SHELL = ['/', '/index.html', '/js/app.js', '/css/app.css'];

const volUrl = (u) => (/^https?:/.test(u) ? u : ORIGIN + u);

function nepCaches(begin = {}) {
  const winkels = new Map();
  const maak = (naam) => {
    if (!winkels.has(naam)) winkels.set(naam, new Map());
    const m = winkels.get(naam);
    return {
      async match(sleutel) {
        const r = m.get(volUrl(typeof sleutel === 'string' ? sleutel : sleutel.url));
        return r ? r.clone() : undefined;
      },
      async put(sleutel, antw) { m.set(volUrl(typeof sleutel === 'string' ? sleutel : sleutel.url), antw); },
      async addAll(urls) {
        for (const u of urls) {
          const r = await caches.fetchFn(ORIGIN + u);
          if (!r.ok) throw new Error('addAll ' + u + ' ' + r.status);
          await this.put(u, r);
        }
      },
    };
  };
  const caches = {
    winkels,
    fetchFn: null,
    async open(n) { return maak(n); },
    async keys() { return [...winkels.keys()]; },
    async delete(n) { return winkels.delete(n); },
  };
  for (const [naam, items] of Object.entries(begin)) {
    maak(naam);
    for (const [u, tekst] of Object.entries(items)) winkels.get(naam).set(u, new Response(tekst));
  }
  return caches;
}

function bouw({ begin = {}, fetchFn, navTimeoutMs = 0, subTimeoutMs = 0, cacheModusMs = 60000, klok = { t: 0 }, wachters = [] } = {}) {
  const caches = nepCaches(begin);
  const ff = fetchFn || (async () => new Response('net'));
  caches.fetchFn = (...a) => ff(...a);
  const s = strategie.maakStrategie({
    cacheNaam: 'hoofd', externNaam: 'extern', shell: SHELL, cdnVast: [LEAFLET], fontHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
    eigenOrigin: ORIGIN, navTimeoutMs, subTimeoutMs, cacheModusMs, caches, fetchFn: (...a) => ff(...a),
    nu: () => klok.t,
    wacht: (ms) => new Promise((res) => wachters.push({ ms, res })),
  });
  return { s, caches, klok, wachters };
}
const req = (pad, extra = {}) => ({ url: volUrl(pad), method: 'GET', mode: 'no-cors', ...extra });
const nav = (pad) => req(pad, { mode: 'navigate' });
const tekst = async (p) => (await p).text();
const tick = () => new Promise((r) => setImmediate(r));

test('/api, niet-GET en onbekende hosts: null (nooit afgehandeld of bewaard)', () => {
  const { s, caches } = bouw();
  for (const r of [req('/api/tickets'), req('/api/'), req('/api'), nav('/api/planning'), req('/api/tickets?x=/index.html'),
    req('/js/app.js', { method: 'POST' }), req('/index.html', { method: 'PUT' }), req('/api/tickets', { method: 'POST' }),
    req('https://example.com/x.js'), req('https://evil.cdnjs.cloudflare.com.example/leaflet.min.js'),
    req('https://cdnjs.cloudflare.com/ajax/libs/ander/1.0/ander.min.js'), req('https://example.com/api/tickets')]) {
    assert.equal(s.behandel(r), null, r.method + ' ' + r.url);
  }
  assert.equal(caches.winkels.size, 0, 'er is niets geopend of bewaard');
});

test('shell: netwerk geslaagd geeft het netwerkantwoord en ververst de cache niet (N3e)', async () => {
  const { s, caches } = bouw({ begin: { hoofd: { [ORIGIN + '/js/app.js']: 'oud' } }, fetchFn: async () => new Response('nieuw') });
  assert.equal(await tekst(s.behandel(req('/js/app.js'))), 'nieuw');
  assert.equal(await tekst(caches.winkels.get('hoofd').get(ORIGIN + '/js/app.js')), 'oud');
});

test('shell: netwerkfout valt terug op de cache; navigatie met querystring op /index.html', async () => {
  const { s } = bouw({
    begin: { hoofd: { [ORIGIN + '/js/app.js']: 'cache-app', [ORIGIN + '/index.html']: 'cache-index' } },
    fetchFn: async () => { throw new TypeError('offline'); },
  });
  assert.equal(await tekst(s.behandel(req('/js/app.js'))), 'cache-app');
  assert.equal(await tekst(s.behandel(nav('/?x=1'))), 'cache-index');
  assert.equal(await tekst(s.behandel(nav('/onbekend/pad'))), 'cache-index');
});

test('shell: netwerkfout zonder cachekopie geeft de fout door', async () => {
  const { s } = bouw({ fetchFn: async () => { throw new TypeError('offline'); } });
  await assert.rejects(s.behandel(req('/js/app.js')), /offline/);
});

test('navigatie-time-out: na navTimeoutMs de cache en cacheModus; daarna cache-eerst, na cacheModusMs terug netwerk-eerst', async () => {
  const klok = { t: 1000 };
  let hangen = true; let calls = 0;
  const { s, wachters } = bouw({
    begin: { hoofd: { [ORIGIN + '/index.html']: 'cache-index', [ORIGIN + '/js/app.js']: 'cache-app' } },
    navTimeoutMs: 500, klok,
    fetchFn: async () => { calls++; return hangen ? new Promise(() => {}) : new Response('net'); },
  });
  const p = s.behandel(nav('/'));
  await tick();
  assert.equal(wachters.length, 1);
  assert.equal(wachters[0].ms, 500);
  wachters[0].res();
  assert.equal(await tekst(p), 'cache-index');
  const voor = calls;
  klok.t = 1000 + 59999;
  assert.equal(await tekst(s.behandel(req('/js/app.js'))), 'cache-app');
  assert.equal(calls, voor, 'in cacheModus geen netwerk');
  klok.t = 1000 + 60000; hangen = false;
  assert.equal(await tekst(s.behandel(req('/js/app.js'))), 'net');
});

test('cacheModus: ontbreekt de kopie, dan toch het netwerk', async () => {
  const klok = { t: 0 };
  const { s, wachters } = bouw({
    begin: { hoofd: { [ORIGIN + '/index.html']: 'cache-index' } }, navTimeoutMs: 100, klok,
    fetchFn: async (u) => ((u.url || String(u)).endsWith('/js/app.js') ? new Response('net-app') : new Promise(() => {})),
  });
  const p = s.behandel(nav('/')); await tick(); wachters[0].res(); await p;
  assert.equal(await tekst(s.behandel(req('/js/app.js'))), 'net-app');
});

test('navTimeoutMs = 0: een hangende fetch wacht, er wordt geen timer gezet', async () => {
  const { s, wachters } = bouw({ begin: { hoofd: { [ORIGIN + '/index.html']: 'cache-index' } }, fetchFn: () => new Promise(() => {}) });
  let klaar = false;
  s.behandel(nav('/')).then(() => { klaar = true; });
  await tick(); await tick();
  assert.equal(wachters.length, 0);
  assert.equal(klaar, false);
});

test('time-out zonder cachekopie: blijft op het netwerk wachten', async () => {
  let los;
  const { s, wachters } = bouw({ navTimeoutMs: 100, fetchFn: () => new Promise((r) => { los = r; }) });
  const p = s.behandel(nav('/')); await tick(); wachters[0].res(); await tick();
  los(new Response('laat'));
  assert.equal(await tekst(p), 'laat');
});

test('subTimeoutMs geldt voor submodules', async () => {
  const { s, wachters } = bouw({ begin: { hoofd: { [ORIGIN + '/js/app.js']: 'cache-app' } }, subTimeoutMs: 250, fetchFn: () => new Promise(() => {}) });
  const p = s.behandel(req('/js/app.js')); await tick();
  assert.equal(wachters[0].ms, 250);
  wachters[0].res();
  assert.equal(await tekst(p), 'cache-app');
});

test('CDN-URL: cache-eerst; ontbreekt hij, dan netwerk en bewaren in de externe cache', async () => {
  let calls = 0;
  const { s, caches } = bouw({ fetchFn: async () => { calls++; return new Response('lib'); } });
  assert.equal(await tekst(s.behandel(req(LEAFLET))), 'lib');
  assert.equal(calls, 1);
  assert.ok(caches.winkels.get('extern').has(LEAFLET));
  assert.equal(await tekst(s.behandel(req(LEAFLET))), 'lib');
  assert.equal(calls, 1, 'tweede keer uit de cache');
});

test('CDN-URL: een mislukt antwoord wordt niet bewaard', async () => {
  const { s, caches } = bouw({ fetchFn: async () => new Response('fout', { status: 503 }) });
  const r = await s.behandel(req(LEAFLET));
  assert.equal(r.status, 503);
  assert.equal(caches.winkels.get('extern')?.has(LEAFLET) ?? false, false);
});

test('fonts: stale-while-revalidate in de externe cache', async () => {
  const url = 'https://fonts.googleapis.com/css2?family=Inter';
  const { s, caches } = bouw({ begin: { extern: { [url]: 'oud' } }, fetchFn: async () => new Response('vers') });
  const wacht = [];
  assert.equal(await tekst(s.behandel(req(url), { waitUntil: (p) => wacht.push(p) })), 'oud');
  await Promise.all(wacht);
  assert.equal(await tekst(caches.winkels.get('extern').get(url)), 'vers');
});

test('fonts: zonder kopie het netwerk, en bewaren; font-bestanden van gstatic idem', async () => {
  const url = 'https://fonts.gstatic.com/s/inter/v1/a.woff2';
  const { s, caches } = bouw({ fetchFn: async () => new Response('font') });
  assert.equal(await tekst(s.behandel(req(url))), 'font');
  assert.ok(caches.winkels.get('extern').has(url));
});

test('fonts: netwerkfout met kopie geeft de kopie, zonder onafgehandelde afwijzing', async () => {
  const url = 'https://fonts.googleapis.com/css2?family=Inter';
  const { s } = bouw({ begin: { extern: { [url]: 'oud' } }, fetchFn: async () => { throw new TypeError('offline'); } });
  const wacht = [];
  assert.equal(await tekst(s.behandel(req(url), { waitUntil: (p) => wacht.push(p) })), 'oud');
  await Promise.all(wacht);
});

test('installeer: één 404 in de shell laat de installatie falen', async () => {
  const { s } = bouw({ fetchFn: async (u) => (String(u).endsWith('/js/app.js') ? new Response('x', { status: 404 }) : new Response('ok')) });
  await assert.rejects(s.installeer(), /addAll/);
});

test('installeer: een onbereikbare CDN laat de installatie slagen; bereikbare CDN wordt bewaard', async () => {
  const { s, caches } = bouw({ fetchFn: async (u) => { if (String(u) === LEAFLET) throw new TypeError('offline'); return new Response('ok'); } });
  await s.installeer();
  assert.ok(caches.winkels.get('hoofd').has(ORIGIN + '/js/app.js'));
  const b = bouw({ fetchFn: async () => new Response('ok') });
  await b.s.installeer();
  assert.ok(b.caches.winkels.get('extern').has(LEAFLET));
});

test('activeer: verwijdert caches die niet cacheNaam of externNaam heten', async () => {
  const { s, caches } = bouw({ begin: { hoofd: {}, extern: {}, 'blitz-planning-v24': {}, andere: {} } });
  await s.activeer();
  assert.deepEqual([...caches.winkels.keys()].sort(), ['extern', 'hoofd']);
});
