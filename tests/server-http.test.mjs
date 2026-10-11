import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maakCors, CORS_V1, v1Json, v1Opties, v1Methode, v2Json, v2Opties, v2Methode,
} from '../netlify/lib/http.js';

const entries = o => Object.entries(o);

test('CORS_V1: bevroren en letterlijk', () => {
  assert.ok(Object.isFrozen(CORS_V1));
  assert.deepEqual(entries(CORS_V1), [
    ['Access-Control-Allow-Origin', '*'],
    ['Content-Type', 'application/json'],
  ]);
});

test('maakCors: sleutelvolgorde en optionele delen', () => {
  assert.deepEqual(entries(maakCors()), [['Access-Control-Allow-Origin', '*']]);
  assert.deepEqual(entries(maakCors({ origin: 'https://x.be' })), [['Access-Control-Allow-Origin', 'https://x.be']]);
  assert.deepEqual(entries(maakCors({ inhoudType: 'application/json', headers: 'H', methoden: 'M' })), [
    ['Access-Control-Allow-Origin', '*'],
    ['Access-Control-Allow-Methods', 'M'],
    ['Access-Control-Allow-Headers', 'H'],
    ['Content-Type', 'application/json'],
  ]);
});

test('maakCors: de drie bestaande v2-sets exact', () => {
  assert.deepEqual(entries(maakCors({ methoden: 'POST, OPTIONS', headers: 'Content-Type' })), [
    ['Access-Control-Allow-Origin', '*'],
    ['Access-Control-Allow-Methods', 'POST, OPTIONS'],
    ['Access-Control-Allow-Headers', 'Content-Type'],
  ]);
  assert.deepEqual(entries(maakCors({
    methoden: 'GET, POST, OPTIONS', headers: 'Content-Type, X-Blitz-Test', inhoudType: 'application/json',
  })), [
    ['Access-Control-Allow-Origin', '*'],
    ['Access-Control-Allow-Methods', 'GET, POST, OPTIONS'],
    ['Access-Control-Allow-Headers', 'Content-Type, X-Blitz-Test'],
    ['Content-Type', 'application/json'],
  ]);
  assert.deepEqual(entries(maakCors({
    methoden: 'POST, OPTIONS', headers: 'Content-Type, X-Blitz-Test', inhoudType: 'application/json',
  })), [
    ['Access-Control-Allow-Origin', '*'],
    ['Access-Control-Allow-Methods', 'POST, OPTIONS'],
    ['Access-Control-Allow-Headers', 'Content-Type, X-Blitz-Test'],
    ['Content-Type', 'application/json'],
  ]);
});

test('v1Json en v1Opties', () => {
  assert.deepEqual(v1Json(400, { error: 'x' }, CORS_V1),
    { statusCode: 400, headers: CORS_V1, body: '{"error":"x"}' });
  const o = v1Opties(CORS_V1);
  assert.deepEqual(o, { statusCode: 204, headers: CORS_V1 });
  assert.equal('body' in o, false);
});

test('v1Methode', () => {
  assert.deepEqual(v1Methode({ httpMethod: 'OPTIONS' }, ['POST'], CORS_V1), { statusCode: 204, headers: CORS_V1 });
  assert.equal(v1Methode({ httpMethod: 'POST' }, ['POST'], CORS_V1), null);
  assert.deepEqual(v1Methode({ httpMethod: 'GET' }, ['POST'], CORS_V1),
    { statusCode: 405, headers: CORS_V1, body: '{"error":"Method not allowed"}' });
});

test('v2Json: status, Content-Type toegevoegd, niet verdubbeld', async () => {
  const r = v2Json(201, { a: 1 }, maakCors({ methoden: 'POST, OPTIONS', headers: 'Content-Type' }));
  assert.equal(r.status, 201);
  assert.deepEqual(Object.fromEntries(r.headers), {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'content-type': 'application/json',
  });
  assert.deepEqual(await r.json(), { a: 1 });
  const r2 = v2Json(200, {}, maakCors({ inhoudType: 'application/json' }));
  assert.equal(r2.headers.get('content-type'), 'application/json');
});

test('v2Opties: 204 zonder body', async () => {
  const cors = maakCors({ methoden: 'POST, OPTIONS', headers: 'Content-Type' });
  const r = v2Opties(cors);
  assert.equal(r.status, 204);
  assert.equal(await r.text(), '');
  assert.equal(r.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});

test('v2Methode', async () => {
  const cors = maakCors({ methoden: 'POST, OPTIONS', headers: 'Content-Type', inhoudType: 'application/json' });
  const req = m => ({ method: m });
  assert.equal(v2Methode(req('OPTIONS'), ['POST'], cors).status, 204);
  assert.equal(v2Methode(req('POST'), ['POST'], cors), null);
  const r = v2Methode(req('GET'), ['POST'], cors);
  assert.equal(r.status, 405);
  assert.equal(await r.text(), 'Method Not Allowed');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('content-type'), 'application/json');
});

test('v1Json, v1Opties en v1Methode geven een verse kopie van de headers', () => {
  for (const r of [v1Json(200, {}, CORS_V1), v1Opties(CORS_V1), v1Methode({ httpMethod: 'GET' }, ['POST'], CORS_V1)]) {
    assert.notEqual(r.headers, CORS_V1);
    assert.deepEqual(entries(r.headers), entries(CORS_V1));
    r.headers['X-Test'] = '1';
  }
  assert.equal(CORS_V1['X-Test'], undefined);
});
