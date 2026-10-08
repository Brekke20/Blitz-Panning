import test from 'node:test';
import assert from 'node:assert/strict';
import { heeftRapportInhoud, haalRapportHtml, wisInhoudCache } from '../public/js/rapport-inhoud.js';

function nepFetch(antwoorden) {
  const calls = [];
  const f = async (url, opt) => {
    calls.push({ url, opt });
    if (antwoorden instanceof Error) throw antwoorden;
    return { ok: antwoorden.status === 200, status: antwoorden.status, json: async () => antwoorden.body };
  };
  f.calls = calls;
  return f;
}

test('heeftRapportInhoud: inline _html, inhoudBeschikbaar of geen van beide', () => {
  assert.equal(heeftRapportInhoud({ rapportData: { _html: '<p>x</p>' } }), true);
  assert.equal(heeftRapportInhoud({ inhoudBeschikbaar: true, rapportData: {} }), true);
  assert.equal(heeftRapportInhoud({ rapportData: {} }), false);
  assert.equal(heeftRapportInhoud({ inhoudBeschikbaar: false }), false);
  assert.equal(heeftRapportInhoud(null), false);
  assert.equal(heeftRapportInhoud(undefined), false);
});

test('haalRapportHtml: inline _html geeft geen fetch', async () => {
  const f = nepFetch({ status: 200, body: { html: 'nooit' } });
  const html = await haalRapportHtml({ id: 'a1', rapportData: { _html: '<p>inline</p>' } }, { fetch: f });
  assert.equal(html, '<p>inline</p>');
  assert.equal(f.calls.length, 0);
});

test('haalRapportHtml: een GET ?inhoud=<id>, tweede aanroep uit de cache', async () => {
  wisInhoudCache();
  const f = nepFetch({ status: 200, body: { id: 'b 2', html: '<p>server</p>' } });
  const r = { id: 'b 2', inhoudBeschikbaar: true };
  assert.equal(await haalRapportHtml(r, { fetch: f }), '<p>server</p>');
  assert.equal(await haalRapportHtml(r, { fetch: f }), '<p>server</p>');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/rapport-archief?inhoud=b%202');
});

test('haalRapportHtml: 404 geeft null (en wordt niet gecachet)', async () => {
  wisInhoudCache();
  const f = nepFetch({ status: 404, body: { error: 'x' } });
  assert.equal(await haalRapportHtml({ id: 'c3', inhoudBeschikbaar: true }, { fetch: f }), null);
  assert.equal(await haalRapportHtml({ id: 'c3', inhoudBeschikbaar: true }, { fetch: f }), null);
  assert.equal(f.calls.length, 2);
});

test('haalRapportHtml: fetch gooit geeft null; rapport zonder id geeft null', async () => {
  wisInhoudCache();
  const f = nepFetch(new Error('offline'));
  assert.equal(await haalRapportHtml({ id: 'd4', inhoudBeschikbaar: true }, { fetch: f }), null);
  assert.equal(await haalRapportHtml({ inhoudBeschikbaar: true }, { fetch: f }), null);
  assert.equal(await haalRapportHtml(null, { fetch: f }), null);
});

test('haalRapportHtml: antwoord zonder html-string geeft null', async () => {
  wisInhoudCache();
  const f = nepFetch({ status: 200, body: { id: 'e5' } });
  assert.equal(await haalRapportHtml({ id: 'e5', inhoudBeschikbaar: true }, { fetch: f }), null);
});
