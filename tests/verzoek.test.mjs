import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kop, leesCookie } from '../netlify/lib/verzoek.js';

test('kop: v2 Request, hoofdletterongevoelig', () => {
  const req = new Request('http://x/', { headers: { 'X-Blitz-Test': '1' } });
  assert.equal(kop(req, 'x-blitz-test'), '1');
  assert.equal(kop(req, 'X-Blitz-Test'), '1');
  assert.equal(kop(req, 'x-bestaat-niet'), undefined);
});

test('kop: v1-event, hoofdletterongevoelig', () => {
  assert.equal(kop({ headers: { 'X-Blitz-Test': '1' } }, 'x-blitz-test'), '1');
  assert.equal(kop({ headers: { 'x-blitz-test': '1' } }, 'X-Blitz-Test'), '1');
  assert.equal(kop({ headers: {} }, 'x-blitz-test'), undefined);
  assert.equal(kop({}, 'x-blitz-test'), undefined);
});

test('leesCookie: haalt de waarde uit een cookiekop (Request en event)', () => {
  const kopWaarde = 'a=1; blitz_sessie=abc.def; b=2';
  const req = new Request('http://x/', { headers: { cookie: kopWaarde } });
  assert.equal(leesCookie(req, 'blitz_sessie'), 'abc.def');
  assert.equal(leesCookie({ headers: { Cookie: kopWaarde } }, 'blitz_sessie'), 'abc.def');
  assert.equal(leesCookie(req, 'ontbreekt'), undefined);
});

test('leesCookie: zonder cookiekop undefined; naam is exact (geen deelmatch)', () => {
  assert.equal(leesCookie(new Request('http://x/'), 'blitz_sessie'), undefined);
  assert.equal(leesCookie({ headers: {} }, 'blitz_sessie'), undefined);
  assert.equal(leesCookie({ headers: { cookie: 'x_blitz_sessie=nee' } }, 'blitz_sessie'), undefined);
});

test('leesCookie: waarde met = blijft heel', () => {
  assert.equal(leesCookie({ headers: { cookie: 'blitz_sessie=a=b.c' } }, 'blitz_sessie'), 'a=b.c');
});
