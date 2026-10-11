// tests/rapport-verzenden-testmodus.test.mjs — syncOplossingNaarZoho in testmodus (?test): nooit een verzoek (W11).
// Eigen bestand (= eigen proces): TEST_MODE (kern/omgeving.js) wordt bij het laden uit location.search vastgelegd.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepFetch, metGlobaleFetch } from './nep-fetch.mjs';

globalThis.location = { search: '?test' };
const toastEl = { textContent: '', classList: { add() {}, remove() {} } };
globalThis.window = {};
globalThis.document = { getElementById: (id) => (id === 'toast' ? toastEl : null), addEventListener() {} };
const { syncOplossingNaarZoho } = await import('../public/js/schermen/rapport-verzenden.js');

test('TEST_MODE: geen fetch en geen toast, ook niet met ticket en inhoud', async () => {
  const nep = maakNepFetch(() => new Response('{}', { status: 200 }));
  await metGlobaleFetch(nep.fn, () => syncOplossingNaarZoho('T1', 'Voeding gecontroleerd'));
  assert.deepEqual(nep.calls, []);
  assert.equal(toastEl.textContent, '');
});
