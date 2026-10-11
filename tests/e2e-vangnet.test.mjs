import test from 'node:test';
import assert from 'node:assert/strict';
import { isToegestaan, ZOHO_TOMTOM_MAIL_PATRONEN } from '../e2e/vangnet-regels.mjs';

const geweigerd = [
  ['GET', 'https://desk.zoho.eu/api/v1/tickets'],
  ['POST', 'https://accounts.zoho.eu/oauth/v2/token'],
  ['GET', 'https://www.zohoapis.eu/'],
  ['GET', 'https://api.tomtom.com/routing/1/calculateRoute/x'],
  ['POST', 'https://smtp.example.com'],
  ['GET', 'https://mail.google.com'],
  ['POST', 'https://127.0.0.1:3339/api/plan'],
  ['POST', 'http://127.0.0.1:3339/api/plan'],
  ['GET', 'http://localhost:3338.evil.com/'],
  ['GET', 'http://127.0.0.1:3338@evil.com/'],
  ['GET', 'https://127.0.0.1:3338/'],
  ['POST', 'https://cdnjs.cloudflare.com/x'],
  ['PUT', 'https://cdn.jsdelivr.net/npm/x'],
  ['GET', 'http://cdnjs.cloudflare.com/x'],
  ['GET', 'https://cdnjs.cloudflare.com.evil.com/x'],
  ['GET', 'https://example.com/'],
  ['GET', 'wss://example.com/'],
  ['GET', 'niet-een-url'],
];

for (const [methode, url] of geweigerd) {
  test(`geweigerd: ${methode} ${url}`, () => {
    const r = isToegestaan({ url, methode });
    assert.equal(r.ok, false, r.reden);
    assert.ok(r.reden.length > 0);
  });
}

const toegestaan = [
  ['POST', 'http://127.0.0.1:3338/api/plan'],
  ['GET', 'http://localhost:3338/'],
  ['PUT', 'http://localhost:3338/api/afspraken'],
  ['GET', 'https://cdnjs.cloudflare.com/ajax/libs/x.js'],
  ['HEAD', 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'],
  ['GET', 'data:text/plain,x'],
  ['GET', 'about:blank'],
];

for (const [methode, url] of toegestaan) {
  test(`toegestaan: ${methode} ${url}`, () => {
    assert.equal(isToegestaan({ url, methode }).ok, true);
  });
}

test('methode ontbreekt: behandeld als GET', () => {
  assert.equal(isToegestaan({ url: 'https://cdnjs.cloudflare.com/x' }).ok, true);
});

test('Zoho/TomTom/mail-reden wordt benoemd', () => {
  assert.match(isToegestaan({ url: 'https://desk.zoho.eu/x', methode: 'GET' }).reden, /Zoho\/TomTom\/mail/);
  assert.ok(ZOHO_TOMTOM_MAIL_PATRONEN.test('api.tomtom.com'));
});
