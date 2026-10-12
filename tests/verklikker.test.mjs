// tests/verklikker.test.mjs — kern/verklikker.js: de ringbuffer van sjLog (puur; startVerklikker raakt de DOM en wordt hier niet gestart).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sjLog, sjRecent, stackSamenvatting, renderFoutPayload, meldRenderFout, wisRenderFoutMeldingen } from '../public/js/kern/verklikker.js';

const STACK = `TypeError: Cannot read properties of null (reading 'id')
    at http://localhost:3338/js/rapport-archief.js:95:34
    at Array.some (<anonymous>)
    at renderRapportArchief (http://localhost:3338/js/rapport-archief.js:95:21)
    at Module.renderKalender (http://localhost:3338/js/schermen/kalender.js:595:30)
    at laadRapportArchief.render (https://blitz.example/js/rapport-archief.js?v=2:36:20)`;

test('stackSamenvatting houdt enkel functienamen en regelnummers over (geen host, geen query)', () => {
  const s = stackSamenvatting(STACK);
  assert.match(s, /renderRapportArchief@rapport-archief\.js:95/);
  assert.match(s, /renderKalender@kalender\.js:595/);
  assert.ok(!/http|localhost|example|\?v=/.test(s), s);
  assert.equal(stackSamenvatting(undefined), '');
});

test('meldRenderFout stuurt één keer per plaats, met melding en stack, en niets in testmodus', () => {
  wisRenderFoutMeldingen();
  const err = Object.assign(new TypeError("Cannot read properties of null (reading 'id')"), { stack: STACK });
  const verstuurd = [];
  const verstuur = (p) => verstuurd.push(p);
  assert.equal(meldRenderFout('rapport-archief', err, { testmodus: true, verstuur }), null);
  assert.equal(verstuurd.length, 0);
  const p = meldRenderFout('rapport-archief', err, { testmodus: false, verstuur });
  assert.equal(p.soort, 'render-fout');
  assert.equal(p.stap, 'render-fout:rapport-archief');
  assert.match(p.fout, /reading 'id'/);
  assert.match(p.fout, /rapport-archief\.js:95/);
  assert.equal(meldRenderFout('rapport-archief', err, { testmodus: false, verstuur }), null); // tweede keer: niets
  assert.equal(verstuurd.length, 1);
  assert.ok(renderFoutPayload('x', err).fout.length <= 480);
  wisRenderFoutMeldingen();
});

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
