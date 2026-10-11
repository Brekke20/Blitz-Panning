// tests/omgeving.test.mjs — kern/omgeving.js (TEST_MODE uit de querystring)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

let teller = 0;
async function laadMet(search) {
  const oud = Object.getOwnPropertyDescriptor(globalThis, 'location');
  if (search === undefined) delete globalThis.location;
  else Object.defineProperty(globalThis, 'location', { value: { search }, configurable: true, writable: true });
  try {
    return await import('../public/js/kern/omgeving.js?v=' + (++teller));
  } finally {
    if (oud) Object.defineProperty(globalThis, 'location', oud); else delete globalThis.location;
  }
}

test('TEST_MODE true met ?test', async () => {
  assert.equal((await laadMet('?test')).TEST_MODE, true);
});
test('TEST_MODE true met ?x=1&test=1', async () => {
  assert.equal((await laadMet('?x=1&test=1')).TEST_MODE, true);
});
test('TEST_MODE false zonder test-parameter', async () => {
  assert.equal((await laadMet('?x=1')).TEST_MODE, false);
  assert.equal((await laadMet('')).TEST_MODE, false);
});
test('TEST_MODE false zonder location (node)', async () => {
  assert.equal((await laadMet(undefined)).TEST_MODE, false);
});
