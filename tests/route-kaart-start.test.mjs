// tests/route-kaart-start.test.mjs — het startlocatie-icoon op de routekaart (optie F): welke punten, en het icoon zelf.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { startEindPunten, startIcoonHtml, START_ICOON_KLEUR, START_ICOON_KLASSE, START_ICOON_FORMAAT } from '../public/js/schermen/route-kaart.js';

test('startEindPunten: het eerste punt is de start; zonder terugkeer geen eindpunt', () => {
  const r = startEindPunten([[51.1, 4.9], [51.2, 5.0], [51.3, 5.1]]);
  assert.deepEqual(r, { start: [51.1, 4.9], eind: null });
});

test('startEindPunten: keert de route terug naar de start (binnen 150 m), dan is ook het laatste punt het eindpunt', () => {
  assert.deepEqual(startEindPunten([[51.1, 4.9], [51.2, 5.0], [51.1, 4.9]]), { start: [51.1, 4.9], eind: [51.1, 4.9] });
  // ~100 m verderop telt nog als terugkeer, ~1 km niet
  assert.ok(startEindPunten([[51.1, 4.9], [51.2, 5.0], [51.1009, 4.9]]).eind);
  assert.equal(startEindPunten([[51.1, 4.9], [51.2, 5.0], [51.109, 4.9]]).eind, null);
});

test('startEindPunten: lege of ongeldige polyline geeft niets; een polyline van één punt geeft enkel een start', () => {
  assert.deepEqual(startEindPunten([]), { start: null, eind: null });
  assert.deepEqual(startEindPunten(undefined), { start: null, eind: null });
  assert.deepEqual(startEindPunten([[NaN, 1], [1, 1]]), { start: null, eind: null });
  assert.deepEqual(startEindPunten([[51, 4]]), { start: [51, 4], eind: null });
});

test('het icoon: groen afgerond vierkant met wit randje en de Blitz-bliksem, inline SVG zonder externe verwijzing', () => {
  const html = startIcoonHtml();
  assert.ok(html.includes(START_ICOON_KLEUR));
  assert.equal(START_ICOON_KLEUR, '#1D9E75');
  assert.match(html, /border:2px solid #fff/);
  assert.match(html, /border-radius:\d+px/);
  assert.equal((html.match(/<line /g) || []).length, 2);
  assert.ok(!/https?:|url\(|<img|href=/.test(html.replace(/xmlns="[^"]*"/, '')));
  assert.ok(START_ICOON_FORMAAT > 24, 'groter dan een gewone stop');
  assert.equal(START_ICOON_KLASSE, 'route-start-marker');
});
