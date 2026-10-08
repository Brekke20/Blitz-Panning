import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lijnGrafiek } from '../public/js/kern/grafiek-lijn.js';

const DAGEN = ['2026-10-05', '2026-10-06', '2026-10-07'];
const reeks = (i, waarden, label = `Reeks ${i}`) => ({ sleutel: `r${i}`, label, slot: i, waarden });
const tel = (s, re) => (s.match(re) ?? []).length;
const paden = h => [...h.matchAll(/<path class="lijn"[^>]*>/g)].map(m => m[0]);

test('twee reeksen over 3 dagen -> twee paden van 2px met ronde join/cap', () => {
  const h = lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: [reeks(1, [10, 20, 30]), reeks(2, [5, 6, 7])] });
  const p = paden(h);
  assert.equal(p.length, 2);
  for (const x of p) {
    assert.ok(x.includes('stroke-width="2"') && x.includes('stroke-linejoin="round"') && x.includes('stroke-linecap="round"') && x.includes('fill="none"'));
  }
  assert.ok(p[0].includes('stroke="var(--viz-1)"') && p[1].includes('stroke="var(--viz-2)"'));
});

test('null in het midden onderbreekt de lijn: twee subpaden (M twee keer)', () => {
  const h = lijnGrafiek({ titel: 't', punten: ['a', 'b', 'c', 'd', 'e'], reeksen: [reeks(1, [1, 2, null, 4, 5])] });
  const d = paden(h)[0].match(/ d="([^"]+)"/)[1];
  assert.equal(tel(d, /M/g), 2);
  assert.ok(!d.includes('NaN'));
});

test('één punt: enkel een marker, geen pad', () => {
  const h = lijnGrafiek({ titel: 't', punten: ['2026-10-05'], reeksen: [reeks(1, [12])] });
  assert.equal(paden(h).length, 0);
  assert.equal(tel(h, /<circle class="lijn-marker"/g), 1);
  assert.ok(!h.includes('NaN'));
});

test('geïsoleerd punt tussen twee nulls krijgt een marker i.p.v. een onzichtbaar subpad', () => {
  const h = lijnGrafiek({ titel: 't', punten: ['a', 'b', 'c', 'd', 'e'], reeksen: [reeks(1, [1, 2, null, 4, null])] });
  const d = paden(h)[0].match(/ d="([^"]+)"/)[1];
  assert.equal(tel(d, /M/g), 1);
  assert.equal(tel(h, /<circle class="lijn-marker"/g), 1, 'isolerend punt (dag d) is tegelijk eindmarker');
});

test('eind-marker: r=4 met 2px oppervlakte-ring, kleur van het slot, op het laatste punt', () => {
  const h = lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: [reeks(1, [10, 20, 30]), reeks(2, [5, 6, 7])] });
  const m = [...h.matchAll(/<circle class="lijn-marker"[^>]*>/g)].map(x => x[0]);
  assert.equal(m.length, 2);
  for (const c of m) assert.ok(c.includes('r="4"') && c.includes('stroke="var(--surface)"') && c.includes('stroke-width="2"'));
  assert.ok(m[0].includes('fill="var(--viz-1)"') && m[1].includes('fill="var(--viz-2)"'));
});

test('één y-as: één set gridlijnen/ticks, geen dual-axis; nette afronding', () => {
  const h = lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: [reeks(1, [100, 250, 300]), reeks(2, [1, 2, 3])] });
  assert.equal(tel(h, /class="grid"/g), 4); // 0 / 100 / 200 / 300
  assert.equal(tel(h, /text-anchor="end"/g), 4 + 0);
  for (const t of ['>0<', '>100<', '>200<', '>300<']) assert.ok(h.includes(t), t);
});

test('eenheid verschijnt bij de as en in de tooltip', () => {
  const h = lijnGrafiek({ titel: 't', eenheid: 'min', punten: DAGEN, reeksen: [reeks(1, [10, 20, 30])] });
  assert.ok(h.includes('Reeks 1: 20 min'));
  assert.ok(h.includes('as-eenheid"') && h.includes('>min<'));
});

test('hit-stroken: per dag ≥ 24 breed, focusbaar, title met alle reeksen op die dag', () => {
  const h = lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: [reeks(1, [10, 20, 30]), reeks(2, [5, null, 7])] });
  const hits = [...h.matchAll(/<rect class="lijn-hit"[^>]*>([\s\S]*?)<\/rect>/g)];
  assert.equal(hits.length, 3);
  for (const m of hits) {
    assert.ok(Number(m[0].match(/width="([\d.]+)"/)[1]) >= 24);
    assert.ok(m[0].includes('tabindex="0"'));
  }
  assert.ok(hits[0][1].includes('Reeks 1: 10') && hits[0][1].includes('Reeks 2: 5'));
  assert.ok(hits[1][1].includes('Reeks 2: geen gegevens'));
  assert.ok(hits[0][1].includes('5 okt'));
});

test('alle waarden null of geen punten of geen reeksen -> leeg-bericht, geen crash', () => {
  assert.ok(lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: [reeks(1, [null, null, null])] }).includes('grafiek-leeg'));
  assert.ok(lijnGrafiek({ titel: 't', punten: [], reeksen: [reeks(1, [])] }).includes('grafiek-leeg'));
  assert.ok(lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: [] }).includes('grafiek-leeg'));
});

test('meer dan 4 reeksen -> RangeError', () => {
  const vijf = [1, 2, 3, 4, 5].map(i => reeks(i, [1, 2, 3]));
  assert.throws(() => lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: vijf }), RangeError);
  assert.doesNotThrow(() => lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: vijf.slice(0, 4) }));
});

test('eindlabels in tekstkleur, botsen niet bij gelijke eindwaarden; legende bij ≥ 2 reeksen', () => {
  const h = lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: [reeks(1, [1, 2, 3], 'Aanrijtijd'), reeks(2, [1, 2, 3], 'Werktijd')] });
  const labels = [...h.matchAll(/<text class="lijn-label" x="[\d.]+" y="([\d.]+)"[^>]*>(?:<title>[^<]*<\/title>)?([^<]+)<\/text>/g)];
  assert.equal(labels.length, 2);
  assert.ok(Math.abs(Number(labels[0][1]) - Number(labels[1][1])) >= 14);
  assert.ok(!/<text[^>]*var\(--viz/.test(h), 'tekst draagt nooit de reekskleur');
  assert.ok(h.includes('class="legende"'));
  assert.ok(!lijnGrafiek({ titel: 't', punten: DAGEN, reeksen: [reeks(1, [1, 2, 3])] }).includes('class="legende"'));
});

test('tabel-twin met dagen als rijen en reeksen als kolommen; null als streepje', () => {
  const h = lijnGrafiek({ titel: 'Rijtijd', punten: DAGEN, reeksen: [reeks(1, [10, null, 30])] });
  assert.ok(h.includes('<details class="tabel-twin">'));
  assert.ok(h.includes('<th scope="row">6 okt</th><td class="num">—</td>'));
  assert.ok(h.includes('<td class="num">30</td>'));
});

test('svg is een groep met aria-label (de hit-stroken zijn focusbaar)', () => {
  const h = lijnGrafiek({ titel: 'Rijtijd per dag', punten: DAGEN, reeksen: [reeks(1, [10, 20, 30])] });
  assert.ok(h.includes('role="group" aria-label="Rijtijd per dag"'));
});

test('[RF4] titel, reekslabels en punten ge-escaped overal; geen NaN of undefined', () => {
  const h = lijnGrafiek({ titel: '<u>t</u>', punten: ['<b>x</b>', 'y'], reeksen: [
    { sleutel: 'a', label: '<script>1</script>', slot: 1, waarden: [1, NaN] }, reeks(2, [undefined, 3])] });
  assert.ok(!h.includes('<script>') && !h.includes('<b>') && !h.includes('<u>'));
  assert.ok(h.includes('&lt;script&gt;1&lt;/script&gt;'));
  assert.ok(!h.includes('NaN') && !h.includes('undefined'));
});
