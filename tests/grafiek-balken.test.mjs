import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balkenRijen, gestapeldeKolommen, gestapeldeBalken } from '../public/js/kern/grafiek-balken.js';
import { grafiekTabel } from '../public/js/kern/grafiek-tabel.js';
import { mooieTicks, formatGetal, beperkReeksen } from '../public/js/kern/grafiek-hulp.js';

const tel = (s, re) => (s.match(re) ?? []).length;
const rijRect = (html, i) => html.split('class="balk-rij"')[i + 1].match(/<rect [^>]*width="([^"]+)"/)[1];

// ---- grafiekTabel
test('grafiekTabel: details/summary, getallen rechts met tabular-nums-klasse, alles ge-escaped [RF4]', () => {
  const t = grafiekTabel({ titel: '<i>t</i>', kolommen: ['Naam <b>', 'Aantal'], rijen: [['<script>x</script>', 1840], ['b', null]] });
  assert.match(t, /^<details class="tabel-twin"><summary>Tabel<\/summary><table/);
  assert.ok(!t.includes('<script>') && !t.includes('<b>') && !t.includes('<i>'));
  assert.ok(t.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(t.includes('<td class="num">1.840</td>'));
  assert.ok(t.includes('<td class="num">—</td>'));
  assert.ok(t.includes('<th scope="col" class="num">Aantal</th>'));
});

// ---- hulpen
test('mooieTicks: 1840 -> 0 / 1.000 / 2.000; 0 -> 0 / 1; kleine en tussenwaarden', () => {
  const t = mooieTicks(1840);
  assert.deepEqual(t.ticks, [0, 1000, 2000]);
  assert.equal(t.top, 2000);
  assert.deepEqual(mooieTicks(0).ticks, [0, 1]);
  assert.deepEqual(mooieTicks(87).ticks, [0, 50, 100]);
  assert.deepEqual(mooieTicks(3).ticks, [0, 1, 2, 3]);
  assert.ok(mooieTicks(0.4).ticks.every(Number.isFinite));
  assert.equal(formatGetal(2000), '2.000');
});

test('beperkReeksen: negatieve en niet-eindige waarden worden 0, ontbrekende aangevuld', () => {
  const r = beperkReeksen([{ sleutel: 'a', label: 'A', slot: 1, waarden: [-3, NaN, 4] }], 7, 4);
  assert.deepEqual(r[0].waarden, [0, 0, 4, 0]);
});

// ---- balkenRijen
test('balkenRijen: 10 en 5 -> breedte 100 % en 50 %, waardetekst en tabel-twin', () => {
  const h = balkenRijen({ titel: 'Duur', eenheid: 'min', rijen: [{ label: 'A', waarde: 10 }, { label: 'B', waarde: 5 }] });
  assert.equal(rijRect(h, 0), '100%');
  assert.equal(rijRect(h, 1), '50%');
  assert.ok(h.includes('role="img"') && h.includes('height="16"'));
  assert.ok(h.includes('rx="4"'));
  assert.ok(h.includes('fill="var(--viz-1)"'));
  assert.ok(h.includes('10 min') && h.includes('5 min'));
  assert.ok(h.includes('<details class="tabel-twin">'));
});

test('balkenRijen: eigen tekst en slot; kleur volgt het meegegeven slot', () => {
  const h = balkenRijen({ titel: 't', slot: 3, rijen: [{ label: 'A', waarde: 4, tekst: '4 min (n=2)' }] });
  assert.ok(h.includes('4 min (n=2)'));
  assert.ok(h.includes('fill="var(--viz-3)"'));
});

test('balkenRijen: alle waarden 0 -> breedte 0, geen NaN', () => {
  const h = balkenRijen({ titel: 't', rijen: [{ label: 'A', waarde: 0 }, { label: 'B', waarde: 0 }] });
  assert.equal(rijRect(h, 0), '0%');
  assert.ok(!h.includes('NaN'));
});

test('balkenRijen [RF4]: label en titel ge-escaped; leeg -> bericht', () => {
  const h = balkenRijen({ titel: '<img src=x>', rijen: [{ label: '<script>alert(1)</script>', waarde: 3, tekst: '<b>3</b>' }] });
  assert.ok(!h.includes('<script>') && !h.includes('<img') && !h.includes('<b>3'));
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(balkenRijen({ titel: 't', rijen: [] }).includes('grafiek-leeg'));
});

// ---- gestapeldeKolommen
const reeks = (i, waarden) => ({ sleutel: `r${i}`, label: `Reeks ${i}`, slot: i, waarden });

test('gestapeldeKolommen: 9 reeksen -> 7 + Overige, slots niet hergebruikt', () => {
  const reeksen = Array.from({ length: 9 }, (_, i) => reeks(i + 1, [i + 1, 2]));
  const h = gestapeldeKolommen({ titel: 't', categorieen: ['a', 'b'], reeksen });
  const fills = [...h.matchAll(/class="seg"[^>]*fill="(var\(--viz-[^)]+\))"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(fills)], ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-overige)']);
  assert.equal(tel(h, /class="swatch swatch--/g), 8);
  assert.ok(h.includes('a · Overige: 17'), 'Overige = reeks 8 + 9 = 8 + 9');
  assert.ok(!h.includes('var(--viz-8)'), 'slot 8 niet apart getekend');
});

test('gestapeldeKolommen: waarde 0 tekent geen segment; elk segment heeft title en tabindex=0', () => {
  const h = gestapeldeKolommen({ titel: 't', eenheid: 'min', categorieen: ['mei', 'jun'], reeksen: [reeks(1, [10, 0]), reeks(2, [0, 0]), reeks(3, [5, 5])] });
  assert.equal(tel(h, /class="seg"/g), 3);
  assert.equal(tel(h, /class="seg"[^>]*tabindex="0"/g), 3);
  assert.ok(h.includes('<title>mei · Reeks 1: 10 min</title>'));
  assert.ok(h.includes('<title>jun · Reeks 3: 5 min</title>'));
});

test('gestapeldeKolommen: assticks 0 / 1.000 / 2.000 voor max 1840 (nl-BE), hairline gridlijnen', () => {
  const h = gestapeldeKolommen({ titel: 't', categorieen: ['a'], reeksen: [reeks(1, [1000]), reeks(2, [840])] });
  for (const t of ['>0<', '>1.000<', '>2.000<']) assert.ok(h.includes(t), t);
  assert.ok(!h.includes('>500<'));
  assert.equal(tel(h, /class="grid"/g), 3);
  assert.ok(h.includes('vector-effect="non-scaling-stroke"'));
});

test('gestapeldeKolommen: bovenste segment 4px afgerond, onderste (basis) vierkant; gap van 2px', () => {
  const h = gestapeldeKolommen({ titel: 't', categorieen: ['a'], reeksen: [reeks(1, [100]), reeks(2, [100])] });
  const ds = [...h.matchAll(/class="seg" d="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ds.length, 2);
  assert.ok(!ds[0].includes('A'), 'onderste segment vierkant');
  assert.ok(ds[1].includes('A4,4'), 'bovenste segment afgerond met r=4');
  const onder = ds[0].match(/^M[\d.]+,([\d.]+)H[\d.]+V([\d.]+)/); // M x,y H x+w V y+h: y = bovenkant onderste segment
  const boven = ds[1].match(/^M[\d.]+,([\d.]+)V/);                // M x,y+h: y+h = onderkant bovenste segment
  const gap = Number(onder[1]) - Number(boven[1]); // y groeit naar onder
  assert.ok(Math.abs(gap - 2) < 0.02, `gap ${gap}`);
});

test('gestapeldeKolommen: kolom ≤ 24px dik', () => {
  const h = gestapeldeKolommen({ titel: 't', categorieen: ['a'], reeksen: [reeks(1, [5])] });
  const d = h.match(/class="seg" d="([^"]+)"/)[1];
  const xs = [...d.matchAll(/[MH]([\d.]+)/g)].map(m => Number(m[1]));
  assert.ok(Math.max(...xs) - Math.min(...xs) <= 24.01);
});

test('gestapeldeKolommen: lege categorieen -> leeg-bericht zonder crash; ook zonder reeksen', () => {
  assert.ok(gestapeldeKolommen({ titel: 't', categorieen: [], reeksen: [] }).includes('grafiek-leeg'));
  assert.ok(gestapeldeKolommen({ titel: 't', categorieen: ['a'], reeksen: [] }).includes('grafiek-leeg'));
});

test('gestapeldeKolommen [RF4]: categorie, reekslabel en titel ge-escaped (svg, legende, tabel)', () => {
  const h = gestapeldeKolommen({ titel: '<u>t</u>', categorieen: ['<b>jan</b>'], reeksen: [
    { sleutel: 'a', label: '<script>1</script>', slot: 1, waarden: [3] }, { sleutel: 'b', label: 'ok', slot: 2, waarden: [1] }] });
  assert.ok(!h.includes('<script>') && !h.includes('<b>') && !h.includes('<u>'));
  assert.ok(h.includes('&lt;b&gt;jan&lt;/b&gt;'));
});

test('gestapeldeKolommen: niet-eindige waarden geven geen NaN; legende enkel bij meerdere reeksen', () => {
  const h = gestapeldeKolommen({ titel: 't', categorieen: ['a', 'b'], reeksen: [reeks(1, [NaN, undefined]), reeks(2, [3])] });
  assert.ok(!h.includes('NaN') && !h.includes('undefined'));
  assert.ok(h.includes('class="legende"'));
  assert.ok(!gestapeldeKolommen({ titel: 't', categorieen: ['a'], reeksen: [reeks(1, [3])] }).includes('class="legende"'));
});

test('gestapeldeKolommen: svg is een groep met aria-label, tabel-twin aanwezig', () => {
  const h = gestapeldeKolommen({ titel: 'Waarde per maand', categorieen: ['a'], reeksen: [reeks(1, [3])] });
  assert.ok(h.includes('role="group" aria-label="Waarde per maand"'));
  assert.ok(h.includes('<details class="tabel-twin">'));
});

// ---- gestapeldeBalken
test('gestapeldeBalken: segmenten per categorie, afgeronde rechterkant, titles, escaping', () => {
  const h = gestapeldeBalken({ titel: 'Top', categorieen: ['<b>x</b>', 'y'], reeksen: [reeks(1, [4, 0]), reeks(2, [6, 3])] });
  assert.equal(tel(h, /class="seg"/g), 3);
  assert.ok(!h.includes('<b>'));
  assert.ok(h.includes('&lt;b&gt;x&lt;/b&gt; · Reeks 2: 6'));
  const ds = [...h.matchAll(/class="seg" d="([^"]+)"/g)].map(m => m[1]);
  assert.ok(!ds[0].includes('A') && ds[1].includes('A4,4'));
  assert.ok(!h.includes('NaN'));
  assert.ok(gestapeldeBalken({ titel: 't', categorieen: [], reeksen: [] }).includes('grafiek-leeg'));
});

test('M2: het vierkante 4px-stompje enkel bij een balk van ≥ 3 %', () => {
  const klein = balkenRijen({ titel: 't', rijen: [{ label: 'A', waarde: 400 }, { label: 'B', waarde: 1 }] });
  const rijB = klein.split('class="balk-rij"')[2];
  assert.equal(tel(rijB, /<rect /g), 1, 'balk van 0,25 % blijft één rect (geen overdrijving)');
  const groot = balkenRijen({ titel: 't', rijen: [{ label: 'A', waarde: 400 }, { label: 'B', waarde: 40 }] });
  assert.equal(tel(groot.split('class="balk-rij"')[2], /<rect /g), 2);
});

test('M3: bij veel categorieën worden kolomlabels uitgedund i.p.v. tot 2-3 tekens ingekort', () => {
  const cats = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const h = gestapeldeKolommen({ titel: 't', categorieen: cats, reeksen: [reeks(1, cats.map(() => 3))] });
  const labels = [...h.matchAll(/<text class="as-tekst" x="[\d.]+" y="\d+" text-anchor="middle">(?:<title>[^<]*<\/title>)?([^<]*)<\/text>/g)].map(m => m[1]);
  assert.ok(labels.length < 30 && labels.length >= 5, `labels ${labels.length}`);
  assert.ok(labels.every(l => l.length >= 8), 'geen verminkte labels');
});
