// tests/verklikker.test.mjs — kern/verklikker.js: de ringbuffer van sjLog (puur; startVerklikker raakt de DOM en wordt hier niet gestart).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sjLog, sjRecent } from '../public/js/kern/verklikker.js';

test('sjLog bewaart stappen met tijdstip en wat, in volgorde', () => {
  const voor = Date.now();
  sjLog('a'); sjLog('b');
  const r = sjRecent().slice(-2);
  assert.deepEqual(r.map(x => x.wat), ['a', 'b']);
  assert.ok(r.every(x => x.t >= voor && x.t <= Date.now()));
});

test('sjLog houdt maximaal 15 stappen (de oudste valt weg)', () => {
  for (let i = 0; i < 40; i++) sjLog('s' + i);
  const r = sjRecent();
  assert.equal(r.length, 15);
  assert.equal(r[0].wat, 's25');
  assert.equal(r[14].wat, 's39');
});

test('sjRecent geeft een kopie: wijzigen ervan raakt de buffer niet', () => {
  sjRecent().length = 0;
  assert.equal(sjRecent().length, 15);
});
