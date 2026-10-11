// tests/rapport-verzenden.test.mjs — syncOplossingNaarZoho (schermen/rapport-verzenden.js), W11.
// De functie zet de uitgevoerde acties van een rapport als oplossing op het Zoho-ticket (POST /api/comment). Alle verkeer loopt
// via een nep-fetch (tests/nep-fetch.mjs, geen echt netwerk). De testmodus-tak staat in rapport-verzenden-testmodus.test.mjs
// (TEST_MODE wordt bij het laden van de module vastgelegd, dus een eigen proces/bestand).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepFetch, metGlobaleFetch } from './nep-fetch.mjs';

// Minimale window/document-nep voor toast() en venster.js (die bij het laden naar window en document grijpt): enkel #toast bestaat.
const toastEl = { textContent: '', classList: { add() {}, remove() {} } };
globalThis.window = {};
globalThis.document = { getElementById: (id) => (id === 'toast' ? toastEl : null), addEventListener() {} };
const { syncOplossingNaarZoho } = await import('../public/js/schermen/rapport-verzenden.js');

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const PREFIX = '⚠ Oplossing kon niet automatisch bijgewerkt worden in Zoho: ';
async function roep(router, ...args) {
  toastEl.textContent = '';
  const nep = maakNepFetch(router);
  await metGlobaleFetch(nep.fn, () => syncOplossingNaarZoho(...args));
  return { calls: nep.calls, toast: toastEl.textContent };
}

test('geen ticketId: geen fetch en geen toast', async () => {
  for (const id of [undefined, null, '']) {
    const r = await roep(() => json({}), id, 'Voeding gecontroleerd');
    assert.deepEqual(r.calls, []);
    assert.equal(r.toast, '');
  }
});

test('lege of enkel-spaties inhoud: geen fetch en geen toast', async () => {
  for (const content of [undefined, null, '', '   \n\t ']) {
    const r = await roep(() => json({}), 'T1', content);
    assert.deepEqual(r.calls, []);
    assert.equal(r.toast, '');
  }
});

test('geslaagd: één POST /api/comment met exact { ticketId, content } en getrimde inhoud, geen toast', async () => {
  const r = await roep((url) => (url === '/api/comment' ? json({ ok: true }) : undefined), 'T1', '  Voeding gecontroleerd en controller herstart \n');
  assert.equal(r.calls.length, 1);
  const call = r.calls[0];
  assert.equal(call.url, '/api/comment');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.body), { ticketId: 'T1', content: 'Voeding gecontroleerd en controller herstart' });
  assert.deepEqual(Object.keys(JSON.parse(call.body)), ['ticketId', 'content']);
  assert.equal(r.toast, '');
});

test('antwoord met { error }: toast met de foutmelding, één verzoek', async () => {
  const r = await roep(() => json({ error: 'Zoho weigerde het' }, 502), 'T1', 'tekst');
  assert.equal(r.calls.length, 1);
  assert.equal(r.toast, PREFIX + 'Zoho weigerde het');
});

test('HTTP 500 met { error }: toast met de foutmelding', async () => {
  const r = await roep(() => json({ error: 'kapot' }, 500), 'T1', 'tekst');
  assert.equal(r.toast, PREFIX + 'kapot');
});

test('HUIDIG GEDRAG: HTTP 500 zonder { error } telt als gelukt (res.ok wordt niet gecontroleerd): geen toast', async () => {
  const r = await roep(() => json({}, 500), 'T1', 'tekst');
  assert.equal(r.calls.length, 1);
  assert.equal(r.toast, '');
});

test('leeg antwoord (geen JSON): toast met de parserfout, de functie gooit niet', async () => {
  const r = await roep(() => new Response('', { status: 200 }), 'T1', 'tekst');
  assert.equal(r.calls.length, 1);
  assert.ok(r.toast.startsWith(PREFIX), r.toast);
  assert.ok(r.toast.length > PREFIX.length, 'de foutmelding van de parser volgt op het voorvoegsel');
});

test('HTML-antwoord (bv. 502 van de gateway): toast met de parserfout', async () => {
  const r = await roep(() => new Response('<html>Bad Gateway</html>', { status: 502 }), 'T1', 'tekst');
  assert.ok(r.toast.startsWith(PREFIX), r.toast);
});

test('netwerkfout: toast met de foutmelding, de functie gooit niet', async () => {
  const r = await roep(() => { throw new Error('Failed to fetch'); }, 'T1', 'tekst');
  assert.equal(r.toast, PREFIX + 'Failed to fetch');
});
