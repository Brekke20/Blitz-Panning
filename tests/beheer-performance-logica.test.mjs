import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, TEGELS, periodeVoorPreset, maakQuery, verschil, formatDuur, formatEuro,
  kleurSlotVoor, opTijdVerdeling, tegelHtml, filterRijHtml,
} from '../public/js/schermen/beheer-performance-logica.js';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';

const tegel = sleutel => TEGELS.find(t => t.sleutel === sleutel);

test('PRESETS en TEGELS: vaste volgorde en gedrag', () => {
  assert.deepEqual(PRESETS.map(p => p.id), ['deze-maand', 'vorige-maand', 'kwartaal', 'jaar', 'zelf']);
  assert.deepEqual(TEGELS.map(t => t.sleutel), ['interventies', 'gemDuurMin', 'opTijd', 'firstTimeFix', 'herhaalbezoeken', 'onderdelenWaarde']);
  assert.equal(tegel('opTijd').label, '% op tijd (alle bezoeken)');
  assert.equal(tegel('gemDuurMin').omhoogIsGoed, false);
});

test('[RF5] periodeVoorPreset: lopende periodes lopen tot en met vandaag, vorige maand volledig', () => {
  const nu = new Date('2026-10-08T10:00:00+02:00');
  assert.deepEqual(periodeVoorPreset('deze-maand', nu), { van: '2026-10-01', tot: '2026-10-08' });
  assert.deepEqual(periodeVoorPreset('vorige-maand', nu), { van: '2026-09-01', tot: '2026-09-30' });
  assert.deepEqual(periodeVoorPreset('kwartaal', nu), { van: '2026-10-01', tot: '2026-10-08' });
  assert.deepEqual(periodeVoorPreset('jaar', nu), { van: '2026-01-01', tot: '2026-10-08' });
});

test('periodeVoorPreset: kwartaalgrenzen, vorige maand in januari, schrikkeljaar', () => {
  assert.deepEqual(periodeVoorPreset('kwartaal', new Date('2026-05-20T12:00:00+02:00')), { van: '2026-04-01', tot: '2026-05-20' });
  assert.deepEqual(periodeVoorPreset('kwartaal', new Date('2026-02-03T12:00:00+01:00')), { van: '2026-01-01', tot: '2026-02-03' });
  assert.deepEqual(periodeVoorPreset('vorige-maand', new Date('2026-01-15T12:00:00+01:00')), { van: '2025-12-01', tot: '2025-12-31' });
  assert.deepEqual(periodeVoorPreset('vorige-maand', new Date('2028-03-10T12:00:00+01:00')), { van: '2028-02-01', tot: '2028-02-29' });
});

test('periodeVoorPreset: datum is die van Brussel, ook rond middernacht, maandgrens en jaargrens', () => {
  // 22:30 UTC op 30/9 = 00:30 in Brussel op 1/10
  assert.deepEqual(periodeVoorPreset('deze-maand', new Date('2026-09-30T22:30:00Z')), { van: '2026-10-01', tot: '2026-10-01' });
  assert.deepEqual(periodeVoorPreset('deze-maand', new Date('2026-09-30T21:30:00Z')), { van: '2026-09-01', tot: '2026-09-30' });
  // 31 december 23:30 Brussel vs. 1 januari 00:30 Brussel
  assert.deepEqual(periodeVoorPreset('jaar', new Date('2026-12-31T23:30:00+01:00')), { van: '2026-01-01', tot: '2026-12-31' });
  assert.deepEqual(periodeVoorPreset('jaar', new Date('2026-12-31T23:30:00Z')), { van: '2027-01-01', tot: '2027-01-01' });
  assert.deepEqual(periodeVoorPreset('vorige-maand', new Date('2026-12-31T23:30:00Z')), { van: '2026-12-01', tot: '2026-12-31' });
});

test('periodeVoorPreset: zomertijdwissels (2026-03-29 en 2026-10-25) geven de juiste dag', () => {
  assert.equal(periodeVoorPreset('deze-maand', new Date('2026-03-28T23:30:00Z')).tot, '2026-03-29'); // 00:30 CET
  assert.equal(periodeVoorPreset('deze-maand', new Date('2026-03-29T01:30:00Z')).tot, '2026-03-29'); // 03:30 CEST
  assert.equal(periodeVoorPreset('deze-maand', new Date('2026-03-29T22:30:00Z')).tot, '2026-03-30');
  assert.equal(periodeVoorPreset('deze-maand', new Date('2026-10-24T22:30:00Z')).tot, '2026-10-25'); // 00:30 CEST
  assert.equal(periodeVoorPreset('deze-maand', new Date('2026-10-25T01:30:00Z')).tot, '2026-10-25'); // 02:30 CET (herhaald uur)
  assert.equal(periodeVoorPreset('deze-maand', new Date('2026-10-25T23:30:00Z')).tot, '2026-10-26');
});

test('periodeVoorPreset: zelf kiezen geeft de eigen datums terug, onbekend valt terug op deze maand', () => {
  const nu = new Date('2026-10-08T10:00:00+02:00');
  assert.deepEqual(periodeVoorPreset('zelf', nu, { van: '2026-08-05', tot: '2026-08-20' }), { van: '2026-08-05', tot: '2026-08-20' });
  assert.deepEqual(periodeVoorPreset('zelf', nu), { van: '2026-10-01', tot: '2026-10-08' });
  assert.deepEqual(periodeVoorPreset('zelf', nu, { van: 'morgen', tot: '' }), { van: '2026-10-01', tot: '2026-10-08' });
  assert.deepEqual(periodeVoorPreset('onzin', nu), { van: '2026-10-01', tot: '2026-10-08' });
});

test('maakQuery: encodeURIComponent, lege filters weggelaten', () => {
  const q = maakQuery({ van: '2026-10-01', tot: '2026-10-08', technieker: 'Tim & Co', type: '', herhaalDagen: 90 });
  assert.equal(q, '?van=2026-10-01&tot=2026-10-08&technieker=Tim%20%26%20Co&herhaal=90');
  assert.ok(!q.includes('type='));
  assert.equal(maakQuery({}), '');
});

test('verschil: ringen in procentpunten, aantallen in procent, richting en goed/slecht', () => {
  assert.deepEqual(verschil(80, 70, true), { tekst: '↑ 10 pt', richting: 'op', goed: true });
  assert.deepEqual(verschil(66.5, 70, true), { tekst: '↓ 3,5 pt', richting: 'neer', goed: false });
  assert.deepEqual(verschil(60, 70, false), { tekst: '↓ 14,3 %', richting: 'neer', goed: true }); // duur lager = goed
  assert.deepEqual(verschil(112, 100, null), { tekst: '↑ 12 %', richting: 'op', goed: null });
  assert.deepEqual(verschil(9, 4, false), { tekst: '↑ 125 %', richting: 'op', goed: false });
  assert.deepEqual(verschil(70, 70, true), { tekst: '= 0', richting: 'gelijk', goed: null });
});

test('verschil: geen vergelijking zonder (bruikbare) vorige waarde', () => {
  const geen = { tekst: '—', richting: 'geen', goed: null };
  assert.deepEqual(verschil(5, 0, null), geen);
  assert.deepEqual(verschil(5, null, null), geen);
  assert.deepEqual(verschil(null, 5, null), geen);
  assert.deepEqual(verschil(undefined, undefined, true), geen);
  assert.deepEqual(verschil(NaN, 3, false), geen);
  // een ring mag wel van 0 % vergeleken worden
  assert.deepEqual(verschil(10, 0, true), { tekst: '↑ 10 pt', richting: 'op', goed: true });
});

test('formatDuur', () => {
  assert.equal(formatDuur(90), '1u30');
  assert.equal(formatDuur(45), '45 min');
  assert.equal(formatDuur(60), '1u00');
  assert.equal(formatDuur(125.4), '2u05');
  assert.equal(formatDuur(0), '0 min');
  assert.equal(formatDuur(null), '—');
  assert.equal(formatDuur(undefined), '—');
  assert.equal(formatDuur(NaN), '—');
});

test('formatEuro: nl-BE, geen decimalen vanaf 1000', () => {
  assert.equal(formatEuro(1840.4), '€ 1.840');
  assert.equal(formatEuro(12.5), '€ 12,50');
  assert.equal(formatEuro(0), '€ 0,00');
  assert.equal(formatEuro(1234567), '€ 1.234.567');
  assert.equal(formatEuro(null), '—');
  assert.equal(formatEuro(NaN), '—');
});

test('kleurSlotVoor: stabiel op volgorde in de lijst, daarna overige', () => {
  assert.equal(kleurSlotVoor('Roel', ['Tim', 'Roel']), 2);
  const acht = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.equal(kleurSlotVoor('g', acht), 7);
  assert.equal(kleurSlotVoor('h', acht), 'overige');
  assert.equal(kleurSlotVoor('onbekend', acht), 'overige');
  assert.equal(kleurSlotVoor('x', undefined), 'overige');
});

test('opTijdVerdeling', () => {
  assert.equal(opTijdVerdeling({ teVroeg: 2, opTijd: 9, teLaat: 1 }), '2 te vroeg · 9 op tijd · 1 te laat');
  assert.equal(opTijdVerdeling({ teVroeg: 0, opTijd: 3, teLaat: 0 }), '0 te vroeg · 3 op tijd · 0 te laat');
  assert.equal(opTijdVerdeling(null), '');
  assert.equal(opTijdVerdeling(undefined), '');
  assert.equal(opTijdVerdeling({}), '');
});

test('tegelHtml: ring-tegel op tijd toont koptekst, status, verdeling en verschilpijl met woord', () => {
  const huidig = { opTijd: { pct: 92, n: 12, teVroeg: 2, opTijd: 9, teLaat: 1 } };
  const vorige = { opTijd: { pct: 80, n: 10, teVroeg: 1, opTijd: 8, teLaat: 1 } };
  const h = tegelHtml(tegel('opTijd'), huidig, vorige, STANDAARD_GRENZEN);
  assert.match(h, /<h3[^>]*>% op tijd \(alle bezoeken\)<\/h3>/);
  assert.ok(h.includes('ring--goed'));
  assert.ok(h.includes('Op doel'));
  assert.ok(h.includes('2 te vroeg · 9 op tijd · 1 te laat'));
  assert.ok(h.includes('↑ 12 pt'));
  assert.ok(h.includes('beter'));
});

test('tegelHtml: 70 % op tijd is slecht, geen gegevens bij pct null', () => {
  const slecht = tegelHtml(tegel('opTijd'), { opTijd: { pct: 70, n: 10, teVroeg: 1, opTijd: 7, teLaat: 2 } }, {}, STANDAARD_GRENZEN);
  assert.ok(slecht.includes('ring--slecht'));
  const leeg = tegelHtml(tegel('opTijd'), { opTijd: { pct: null, n: 0, teVroeg: 0, opTijd: 0, teLaat: 0 } }, {}, STANDAARD_GRENZEN);
  assert.ok(leeg.includes('geen gegevens'));
  assert.ok(!leeg.includes('Op doel'));
  assert.match(leeg, /<h3[^>]*>% op tijd/); // koptekst ook zonder gegevens
  // zonder vorige periode geen pijl
  assert.ok(!slecht.includes('↑') && !slecht.includes('↓'));
});

test('tegelHtml: first-time-fix gebruikt statusVoor met de meegegeven grenzen', () => {
  const huidig = { firstTimeFix: { pct: 70, n: 10 } };
  assert.ok(tegelHtml(tegel('firstTimeFix'), huidig, {}, STANDAARD_GRENZEN).includes('ring--aandacht'));
  const ruim = { ...STANDAARD_GRENZEN, firstTimeFix: { groen: 60, oranje: 40, richting: 'hoog' } };
  assert.ok(tegelHtml(tegel('firstTimeFix'), huidig, {}, ruim).includes('ring--goed'));
  assert.match(tegelHtml(tegel('firstTimeFix'), huidig, {}, ruim), /<h3[^>]*>First-time-fix<\/h3>/);
});

test('tegelHtml: getal-tegels met duur, euro, aantal; lagere duur is goed', () => {
  const duur = tegelHtml(tegel('gemDuurMin'), { gemDuurMin: { waarde: 90, n: 4 } }, { gemDuurMin: { waarde: 120, n: 5 } }, STANDAARD_GRENZEN);
  assert.ok(duur.includes('1u30'));
  assert.ok(duur.includes('↓ 25 %'));
  assert.ok(duur.includes('tegel-verschil--goed'));
  const euro = tegelHtml(tegel('onderdelenWaarde'), { onderdelenWaarde: { waarde: 1840 } }, { onderdelenWaarde: { waarde: 0 } }, STANDAARD_GRENZEN);
  assert.ok(euro.includes('€ 1.840'));
  assert.ok(euro.includes('—')); // vorige 0 -> geen vergelijking
  const aantal = tegelHtml(tegel('interventies'), { interventies: { n: 12 } }, { interventies: { n: 10 } }, STANDAARD_GRENZEN);
  assert.ok(aantal.includes('>12<'));
  assert.ok(aantal.includes('↑ 20 %'));
  assert.ok(!aantal.includes('tegel-verschil--goed') && !aantal.includes('tegel-verschil--slecht')); // neutraal
});

test('tegelHtml: ontbrekende waarde of kern geeft geen gegevens, nooit NaN of undefined', () => {
  for (const t of TEGELS) {
    for (const h of [tegelHtml(t, undefined, undefined, STANDAARD_GRENZEN), tegelHtml(t, {}, {}, STANDAARD_GRENZEN)]) {
      assert.ok(h.includes('geen gegevens'), t.sleutel);
      assert.ok(!/NaN|undefined|null/.test(h), t.sleutel);
    }
  }
  const nul = tegelHtml(tegel('gemDuurMin'), { gemDuurMin: { waarde: null, n: 0 } }, {}, STANDAARD_GRENZEN);
  assert.ok(nul.includes('geen gegevens'));
});

test('tegelHtml: een telling van 0 is een waarde, geen ontbrekend gegeven', () => {
  const h = tegelHtml(tegel('herhaalbezoeken'), { herhaalbezoeken: { aantal: 0 } }, {}, STANDAARD_GRENZEN);
  assert.ok(h.includes('>0<'));
  assert.ok(!h.includes('geen gegevens'));
});

test('tegelHtml: tekst uit het label wordt ge-escaped', () => {
  const h = tegelHtml({ ...tegel('interventies'), label: '<b>x</b>' }, { interventies: { n: 1 } }, {}, STANDAARD_GRENZEN);
  assert.ok(!h.includes('<b>x</b>'));
  assert.ok(h.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('[RF4] filterRijHtml: opties en waarden worden ge-escaped, geselecteerde keuzes staan aan', () => {
  const h = filterRijHtml({
    filters: { preset: 'vorige-maand', van: '2026-09-01', tot: '2026-09-30', technieker: 'Roel', type: 'Installatie', herhaalDagen: 90 },
    opties: { techniekers: ['Tim', '<script>x</script>', 'Roel'], types: ['Interventie', 'Installatie'] },
  });
  assert.ok(!h.includes('<script>'));
  assert.ok(h.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.match(h, /<option value="Roel" selected>/);
  assert.match(h, /<option value="Installatie" selected>/);
  assert.match(h, /<option value="90" selected>/);
  for (const p of PRESETS) assert.ok(h.includes(p.label), p.label);
  assert.match(h, /data-arg="vorige-maand"[^>]*aria-pressed="true"/);
  assert.ok(h.includes('value="2026-09-01"') && h.includes('value="2026-09-30"'));
  assert.equal((h.match(/<div class="filterrij"/g) || []).length, 1);
});

test('filterRijHtml: zonder opties of filters nog steeds een geldige rij', () => {
  const h = filterRijHtml({ filters: {}, opties: {} });
  assert.ok(h.includes('Alle techniekers') && h.includes('Alle types'));
  assert.ok(!/undefined|NaN/.test(h));
});
