import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiFout, zetFetch, apiVerzoek, apiJson, bewaarMetVersie } from '../public/js/kern/api.js';

afterEach(() => zetFetch(null));

// Nep-fetch: antwoorden in volgorde; onthoudt de aanroepen.
function nepFetch(...antwoorden) {
  const aanroepen = [];
  const fn = async (pad, init) => {
    aanroepen.push({ pad, init });
    const a = antwoorden.shift();
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => { if (a.json === undefined) throw new Error('geen json'); return a.json; } };
  };
  fn.aanroepen = aanroepen;
  return fn;
}

test('apiVerzoek: 200 geeft ok, status en data', async () => {
  zetFetch(nepFetch({ status: 200, json: { a: 1 } }));
  assert.deepEqual(await apiVerzoek('/api/x'), { ok: true, status: 200, data: { a: 1 } });
});

test('apiVerzoek: 500 zonder leesbaar antwoord geeft data { error: "HTTP 500" }', async () => {
  zetFetch(nepFetch({ status: 500 }));
  assert.deepEqual(await apiVerzoek('/api/x'), { ok: false, status: 500, data: { error: 'HTTP 500' } });
});

test('apiVerzoek: bij !ok blijft het JSON-antwoord beschikbaar', async () => {
  zetFetch(nepFetch({ status: 400, json: { error: 'kapot' } }));
  assert.deepEqual(await apiVerzoek('/api/x'), { ok: false, status: 400, data: { error: 'kapot' } });
});

test('apiVerzoek: netwerkfout gooit', async () => {
  zetFetch(nepFetch(new TypeError('Failed to fetch')));
  await assert.rejects(apiVerzoek('/api/x'), /Failed to fetch/);
});

test('apiVerzoek: body wordt JSON met Content-Type, zonder body geen Content-Type', async () => {
  const f = nepFetch({ status: 200, json: {} }, { status: 200, json: {} }, { status: 200, json: {} });
  zetFetch(f);
  await apiVerzoek('/api/x', { methode: 'POST', body: { a: [1] } });
  assert.deepEqual(f.aanroepen[0], { pad: '/api/x', init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":[1]}' } });
  await apiVerzoek('/api/x', { methode: 'DELETE' });
  assert.deepEqual(f.aanroepen[1].init, { method: 'DELETE' });
  await apiVerzoek('/api/x');
  assert.equal(f.aanroepen[2].init, undefined); // GET zonder opties: fetch(pad), zoals voorheen
});

test('apiJson: geeft data; !ok gooit ApiFout met "HTTP <status>"', async () => {
  zetFetch(nepFetch({ status: 200, json: { b: 2 } }, { status: 404, json: { error: 'weg' } }));
  assert.deepEqual(await apiJson('/api/x'), { b: 2 });
  await assert.rejects(apiJson('/api/x'), (e) => e instanceof ApiFout && e.message === 'HTTP 404' && e.status === 404 && e.data.error === 'weg');
});

const voegSamen = (server, lokaal) => ({ ...server, ...lokaal });

test('bewaarMetVersie: 200 geeft de nieuwe versie en stuurt { versie, [veld] }', async () => {
  const f = nepFetch({ status: 200, json: { versie: 4 } });
  zetFetch(f);
  const r = await bewaarMetVersie({ pad: '/api/kb', veld: 'items', versie: 3, waarde: { t1: 1 } });
  assert.deepEqual(r, { ok: true, versie: 4, waarde: { t1: 1 } });
  assert.deepEqual(JSON.parse(f.aanroepen[0].init.body), { versie: 3, items: { t1: 1 } });
  assert.equal(f.aanroepen[0].init.method, 'PUT');
});

test('bewaarMetVersie: 409 met voegSamen bewaart opnieuw met de server-versie', async () => {
  const f = nepFetch(
    { status: 409, json: { data: { versie: 5, items: { t2: 'collega' } } } },
    { status: 200, json: { versie: 6 } });
  zetFetch(f);
  const r = await bewaarMetVersie({ pad: '/api/kb', veld: 'items', versie: 0, waarde: { t1: 'ik' }, voegSamen });
  assert.deepEqual(r, { ok: true, versie: 6, waarde: { t2: 'collega', t1: 'ik' } });
  assert.deepEqual(JSON.parse(f.aanroepen[1].init.body), { versie: 5, items: { t2: 'collega', t1: 'ik' } });
});

test('bewaarMetVersie: 409 zonder voegSamen geeft reden conflict met de serverstand', async () => {
  zetFetch(nepFetch({ status: 409, json: { data: { versie: 5, items: { t2: 'collega' } } } }));
  const r = await bewaarMetVersie({ pad: '/api/kb', veld: 'items', versie: 0, waarde: { t1: 'ik' } });
  assert.deepEqual(r, { ok: false, reden: 'conflict', status: 409, versie: 5, waarde: { t2: 'collega' }, laatsteServer: { t2: 'collega' }, laatsteVersie: 5 });
});

test('bewaarMetVersie: 409 gevolgd door 409 geeft conflict met de laatste stand', async () => {
  zetFetch(nepFetch(
    { status: 409, json: { data: { versie: 5, items: { t2: 'a' } } } },
    { status: 409, json: { data: { versie: 7, items: { t3: 'b' } } } }));
  const r = await bewaarMetVersie({ pad: '/api/kb', veld: 'items', versie: 0, waarde: { t1: 'ik' }, voegSamen });
  assert.equal(r.ok, false);
  assert.equal(r.reden, 'conflict');
  // Laatst bekende stand = de samengevoegde waarde op de eerste server-versie (zoals de huidige klantbeschikbaarheid-flow).
  assert.deepEqual(r.waarde, { t2: 'a', t1: 'ik' });
  assert.equal(r.versie, 5);
  // Plus de stand uit het LAATSTE 409-antwoord (voor K12).
  assert.deepEqual(r.laatsteServer, { t3: 'b' });
  assert.equal(r.laatsteVersie, 7);
});

test('bewaarMetVersie: 409 zonder leesbare serverstand is reden http, geen lege serverstand', async () => {
  zetFetch(nepFetch({ status: 409 }));
  const r = await bewaarMetVersie({ pad: '/api/kb', veld: 'items', versie: 3, waarde: { t1: 1 }, voegSamen });
  assert.deepEqual(r, { ok: false, reden: 'http', status: 409, versie: 3, waarde: { t1: 1 } });
});

test('bewaarMetVersie: gooiende voegSamen geeft reden samenvoegen en doet geen tweede PUT', async () => {
  const f = nepFetch({ status: 409, json: { data: { versie: 5, items: {} } } });
  zetFetch(f);
  const r = await bewaarMetVersie({ pad: '/api/kb', veld: 'items', versie: 3, waarde: { t1: 1 }, voegSamen: () => { throw new Error('kapot'); } });
  assert.deepEqual(r, { ok: false, reden: 'samenvoegen', versie: 3, waarde: { t1: 1 } });
  assert.equal(f.aanroepen.length, 1);
});

test('bewaarMetVersie: 500 geeft reden http met status; stand blijft ongewijzigd', async () => {
  zetFetch(nepFetch({ status: 500 }));
  const r = await bewaarMetVersie({ pad: '/api/kb', veld: 'items', versie: 3, waarde: { t1: 1 } });
  assert.deepEqual(r, { ok: false, reden: 'http', status: 500, versie: 3, waarde: { t1: 1 } });
});

test('bewaarMetVersie: gooiende fetch geeft reden netwerk', async () => {
  zetFetch(nepFetch(new TypeError('offline')));
  const r = await bewaarMetVersie({ pad: '/api/kb', veld: 'items', versie: 3, waarde: { t1: 1 } });
  assert.deepEqual(r, { ok: false, reden: 'netwerk', versie: 3, waarde: { t1: 1 } });
});
