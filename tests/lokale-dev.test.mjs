// tests/lokale-dev.test.mjs — netlify/lib/lokale-dev.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isLokaleDev, TESTGEBRUIKERS } from '../netlify/lib/lokale-dev.js';

test('isLokaleDev: enkel BLITZ_LOKALE_DEV=1 zonder Netlify-runtimevariabelen', () => {
  assert.equal(isLokaleDev({}), false);
  assert.equal(isLokaleDev({ BLITZ_LOKALE_DEV: '1' }), true);
  assert.equal(isLokaleDev({ BLITZ_LOKALE_DEV: '1', NETLIFY: 'true' }), false);
  assert.equal(isLokaleDev({ BLITZ_LOKALE_DEV: '1', AWS_LAMBDA_FUNCTION_NAME: 'x' }), false);
  assert.equal(isLokaleDev({ BLITZ_LOKALE_DEV: '1', LAMBDA_TASK_ROOT: '/var' }), false);
  assert.equal(isLokaleDev({ NETLIFY_DEV: 'true' }), false);
  assert.equal(isLokaleDev({ BLITZ_LOKALE_DEV: 'true' }), false);
  assert.equal(isLokaleDev({ BLITZ_LOKALE_DEV: '1', NETLIFY_DEV: 'true' }), true, 'NETLIFY_DEV telt niet mee');
});

test('isLokaleDev: een lege maar gezette Netlify-variabele telt als runtime (fail-closed)', () => {
  assert.equal(isLokaleDev({ BLITZ_LOKALE_DEV: '1', NETLIFY: '' }), false);
});

test('isLokaleDev: ongeldige env faalt dicht', () => {
  assert.equal(isLokaleDev(null), false);
  assert.equal(isLokaleDev('x'), false);
});

test('TESTGEBRUIKERS: vier rollen, id gelijk aan de sleutel, geen geheime velden', () => {
  assert.deepEqual(Object.keys(TESTGEBRUIKERS), ['test-beheerder', 'test-planner', 'test-technieker', 'test-sales']);
  for (const [sleutel, g] of Object.entries(TESTGEBRUIKERS)) {
    assert.equal(g.id, sleutel);
    assert.equal(g.rol, sleutel.replace('test-', ''));
    assert.ok(g.email && g.naam);
    assert.ok(!('wachtwoordHash' in g) && !('sessieVersie' in g));
  }
  assert.equal(TESTGEBRUIKERS['test-technieker'].zohoNaam, 'Tim');
  assert.equal(TESTGEBRUIKERS['test-sales'].salesNaam, 'Test Verkoper');
  assert.equal(TESTGEBRUIKERS['test-sales'].magAlleSales, false);
});
