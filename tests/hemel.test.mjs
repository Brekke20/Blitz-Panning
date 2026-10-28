// Open dag-stijl, taak 2: de hemel volgt het uur (puur deel: kern/hemel.js).
process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tijdstipVoor, TIJDSTIPPEN } from '../public/js/kern/hemel.js';

test('de vier tijdstippen', () => {
  assert.deepEqual([...TIJDSTIPPEN], ['ochtend', 'middag', 'avond', 'nacht']);
});

test('grenzen van de dagdelen (Europe/Brussels)', () => {
  const gevallen = [
    ['04:59', 'nacht'], ['05:00', 'ochtend'], ['09:59', 'ochtend'], ['10:00', 'middag'],
    ['16:59', 'middag'], ['17:00', 'avond'], ['20:59', 'avond'], ['21:00', 'nacht'],
    ['00:00', 'nacht'], ['23:59', 'nacht'],
  ];
  for (const [uur, verwacht] of gevallen) {
    assert.equal(tijdstipVoor(new Date(`2026-10-27T${uur}:00+01:00`)), verwacht, uur);
  }
});

test('zomertijd en wintertijd: het uur is dat van Brussel', () => {
  assert.equal(tijdstipVoor(new Date('2026-07-01T03:30:00Z')), 'ochtend'); // 05:30 CEST
  assert.equal(tijdstipVoor(new Date('2026-12-01T04:30:00Z')), 'ochtend'); // 05:30 CET
  assert.equal(tijdstipVoor(new Date('2026-07-01T02:59:00Z')), 'nacht'); // 04:59 CEST
  assert.equal(tijdstipVoor(new Date('2026-12-01T03:59:00Z')), 'nacht'); // 04:59 CET
});

test('onafhankelijk van de tijdzone van het proces', () => {
  const oud = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      assert.equal(tijdstipVoor(new Date('2026-07-01T03:30:00Z')), 'ochtend', tz);
      assert.equal(tijdstipVoor(new Date('2026-10-27T16:00:00Z')), 'avond', tz); // 17:00 CET
    }
  } finally { process.env.TZ = oud; }
});

// Vaste regels van de markup en de stijl (de e2e-spec bewijst het gedrag).
import { readFileSync } from 'node:fs';
const lees = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('#hemel is het eerste kind van de body en het stijlblad staat bij de andere stijlbladen', () => {
  const html = lees('../public/index.html');
  assert.match(html, /<body>\s*<div id="hemel" aria-hidden="true"><\/div>/);
  assert.ok(html.indexOf('/css/hemel.css') > html.indexOf('/css/base.css'), 'hemel.css na base.css (body doorzichtig wint)');
  assert.ok(html.indexOf('/css/hemel.css') < html.indexOf('rel="modulepreload"'), 'stijlblad vóór de modulepreloads');
});

test('de themakleur van de browser volgt de nieuwe achtergrond', () => {
  const html = lees('../public/index.html');
  assert.match(html, /name="theme-color" content="#0d1530"/);
  assert.match(html, /'light' \? '#e5eefa' : '#0d1530'/);
  assert.doesNotMatch(html, /#181e24|#f5f6f7/);
  assert.match(lees('../public/js/app.js'), /next === 'light' \? '#e5eefa' : '#0d1530'/);
});

test('hemel.css: vaste laag achter alles, weg bij een thema met achtergrond en in print', () => {
  const css = lees('../public/css/hemel.css');
  assert.match(css, /#hemel\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*z-index:\s*-2;[^}]*pointer-events:\s*none/);
  assert.match(css, /html\[data-event-achtergrond="ja"\] #hemel\s*\{\s*display:\s*none/);
  assert.match(css, /@media print\s*\{\s*#hemel\s*\{\s*display:\s*none/);
  for (const t of ['ochtend', 'middag', 'avond', 'nacht']) {
    assert.ok(css.includes(`html[data-hemel="${t}"] #hemel`), `donker ${t}`);
    assert.ok(css.includes(`html[data-theme="light"][data-hemel="${t}"] #hemel`), `licht ${t}`);
  }
});
