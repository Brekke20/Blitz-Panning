import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIJDLIMIETEN, limietVoor, installeerFetchTimeout } from '../public/js/kern/netwerk.js';

test('limietVoor: standaard, lang en fotoUpload per pad en methode (ook query en trailing slash)', () => {
  assert.equal(limietVoor('/api/tickets'), 20000);
  assert.equal(limietVoor('/api/plan', 'POST'), 20000);
  assert.equal(limietVoor('/api/rapport-archief'), 20000);
  for (const n of ['propose', 'send-rapport', 'annuleer', 'rapport', 'planning-sinds', 'planning-export']) {
    assert.equal(limietVoor('/api/' + n, 'POST'), 35000, n);
  }
  assert.equal(limietVoor('/api/planning-sinds?t=5'), 35000);
  assert.equal(limietVoor('/api/annuleer/'), 35000);
  assert.equal(limietVoor('/api/fotos', 'PUT'), 60000);
  assert.equal(limietVoor('/api/fotos?ticket=t1', 'put'), 60000);
  assert.equal(limietVoor('/api/fotos', 'GET'), 20000);
  assert.deepEqual(TIJDLIMIETEN, { standaard: 20000, lang: 35000, fotoUpload: 60000 });
});

// Nep-doel: fetch die pas antwoordt wanneer de test dat vraagt, en op abort rejects met de reden (zoals Chromium).
function nepDoel(origin = 'https://app.test') {
  const aanroepen = [];
  const doel = { location: { href: origin + '/', origin } };
  doel.fetch = (invoer, init) => {
    const a = { invoer, init, los: null };
    aanroepen.push(a);
    return new Promise((ok, fout) => {
      a.los = ok;
      if (init?.signal?.aborted) return fout(init.signal.reason);
      init?.signal?.addEventListener('abort', () => fout(init.signal.reason));
    });
  };
  const oorspronkelijk = doel.fetch;
  return { doel, aanroepen, oorspronkelijk };
}
function nepTimers() {
  const t = { lijst: [], gewist: [] };
  t.setTimeoutFn = (f, ms) => { t.lijst.push({ f, ms }); return t.lijst.length - 1; };
  t.clearTimeoutFn = (id) => { t.gewist.push(id); };
  return t;
}
const opstellen = (origin) => {
  const n = nepDoel(origin);
  const t = nepTimers();
  const herstel = installeerFetchTimeout(n.doel, { setTimeoutFn: t.setTimeoutFn, clearTimeoutFn: t.clearTimeoutFn });
  return { ...n, t, herstel };
};

test('geen /api/: CDN, tegels, fonts, data: en andere origin gaan onaangeroerd door', () => {
  const { doel, aanroepen, t } = opstellen();
  for (const u of ['https://cdn.jsdelivr.net/npm/exceljs.js', 'https://tile.test/1/2/3.png', 'https://fonts.gstatic.com/x.woff2', 'data:text/plain,hi', 'https://andere.test/api/tickets', '/js/app.js']) {
    const init = { method: 'GET' };
    doel.fetch(u, init);
    assert.equal(aanroepen.at(-1).invoer, u);
    assert.equal(aanroepen.at(-1).init, init, u);
  }
  assert.equal(t.lijst.length, 0);
});

test('een snel antwoord: timer opgeruimd en antwoord ongewijzigd', async () => {
  const { doel, aanroepen, t } = opstellen();
  const p = doel.fetch('/api/tickets');
  assert.equal(t.lijst.length, 1);
  assert.equal(t.lijst[0].ms, 20000);
  const antwoord = { ok: true };
  aanroepen[0].los(antwoord);
  assert.equal(await p, antwoord);
  assert.deepEqual(t.gewist, [0]);
});

test('limiet verstreken: TimeoutError en signal aborted; init blijft verder gelijk', async () => {
  const { doel, aanroepen, t } = opstellen();
  const p = doel.fetch('/api/annuleer', { method: 'POST', body: '{}' });
  const gelijk = assert.rejects(p, (e) => e instanceof DOMException && e.name === 'TimeoutError' && /35 s/.test(e.message));
  assert.equal(t.lijst[0].ms, 35000);
  t.lijst[0].f();
  await gelijk;
  assert.equal(aanroepen[0].init.signal.aborted, true);
  assert.equal(aanroepen[0].init.method, 'POST');
  assert.equal(aanroepen[0].init.body, '{}');
  assert.equal(t.gewist.length, 1); // ook bij een fout opgeruimd
});

test('een meegegeven signal wint en wordt niet vervangen (eerder of later aborted)', async () => {
  const { doel, aanroepen, t } = opstellen();
  const c = new AbortController();
  const init = { signal: c.signal };
  const p = doel.fetch('/api/rapport-archief', init);
  assert.equal(aanroepen[0].init, init);
  assert.equal(t.lijst.length, 0);
  c.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  const c2 = new AbortController(); c2.abort();
  const p2 = doel.fetch('/api/plan', { signal: c2.signal });
  assert.equal(aanroepen[1].init.signal, c2.signal);
  await assert.rejects(p2);
  assert.equal(t.lijst.length, 0);
});

test('Request en URL als invoer; absolute same-origin url telt mee', () => {
  const { doel, aanroepen, t } = opstellen();
  doel.fetch(new Request('https://app.test/api/send-rapport', { method: 'POST', body: '{}' }));
  assert.equal(t.lijst.at(-1).ms, 35000);
  doel.fetch(new URL('https://app.test/api/tickets'));
  assert.equal(t.lijst.at(-1).ms, 20000);
  doel.fetch('https://app.test/api/plan');
  assert.equal(t.lijst.at(-1).ms, 20000);
  assert.equal(aanroepen.length, 3);
  assert.ok(aanroepen.every(a => a.init.signal instanceof AbortSignal));
});

test('PUT /api/fotos krijgt 60 s (ook via Request)', () => {
  const { doel, t } = opstellen();
  doel.fetch('/api/fotos', { method: 'PUT', body: '{}' });
  assert.equal(t.lijst.at(-1).ms, 60000);
  doel.fetch(new Request('https://app.test/api/fotos', { method: 'PUT', body: '{}' }));
  assert.equal(t.lijst.at(-1).ms, 60000);
  doel.fetch('/api/fotos?ticket=t1');
  assert.equal(t.lijst.at(-1).ms, 20000);
});

test('de herstelfunctie zet de oorspronkelijke fetch terug', () => {
  const { doel, oorspronkelijk, herstel } = opstellen();
  assert.notEqual(doel.fetch, oorspronkelijk);
  herstel();
  assert.equal(doel.fetch, oorspronkelijk);
});

// Fix-ronde 1: een TypeError uit fetch krijgt vanFetch (voor leesFout), ook zonder /api en met eigen signal; andere fouten niet.
test('een TypeError uit fetch wordt getagd met vanFetch; andere fouten blijven ongemerkt', async () => {
  const doel = { location: { href: 'https://app.test/', origin: 'https://app.test' } };
  doel.fetch = (u) => Promise.reject(u.includes('boem') ? new RangeError('boem') : new TypeError('Failed to fetch'));
  installeerFetchTimeout(doel, { setTimeoutFn: () => 1, clearTimeoutFn: () => {} });
  for (const [u, init] of [['/api/tickets'], ['https://cdn.test/x.js'], ['/api/outbox', { signal: new AbortController().signal }]]) {
    const e = await doel.fetch(u, init).catch((x) => x);
    assert.ok(e instanceof TypeError && e.vanFetch === true, u);
  }
  const r = await doel.fetch('/api/boem').catch((x) => x);
  assert.equal(r.vanFetch, undefined);
});
