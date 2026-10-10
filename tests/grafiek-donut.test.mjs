import { test } from 'node:test';
import assert from 'node:assert/strict';
import { donutSvg, donutLegende, donutFiguur } from '../public/js/kern/grafiek-donut.js';

const OMTREK = 2 * Math.PI * 45;
const seg = (i, label, waarde) => ({ sleutel: `s${i}`, label, waarde, slot: i });
const VIER = [seg(1, 'Offerte', 10), seg(2, 'Verkocht', 20), seg(3, 'Geen interesse', 30), seg(4, 'Opnieuw', 40)];
const bogen = s => [...s.matchAll(/<circle class="donut-boog"[^>]*>/g)].map(m => m[0]);
const lengte = c => Number(c.match(/stroke-dasharray="([\d.]+) /)[1]);

test('donutSvg: vier segmenten -> vier bogen met slot 1..4 in invoervolgorde', () => {
  const s = donutSvg({ segmenten: VIER, titel: 'Sales', midden: { groot: '100', klein: 'bezoeken' } });
  const b = bogen(s);
  assert.equal(b.length, 4);
  b.forEach((c, i) => assert.ok(c.includes(`stroke="var(--viz-${i + 1})"`), c));
  assert.ok(s.includes('rotate(-90 50 50)'));
  assert.ok(s.includes('viewBox="0 0 100 100"'));
  assert.ok(s.includes('width="96"'));
  assert.ok(s.includes('stroke-width="10"'));
  assert.ok(!s.includes('stroke-linecap="round"'), 'afgekapte uiteinden: de gap is exact 2px');
});

test('donutSvg: som van de dash-lengtes = omtrek − n×2 (2px gap per segment)', () => {
  const b = bogen(donutSvg({ segmenten: VIER, titel: 't', midden: { groot: '1', klein: 'x' } }));
  const som = b.reduce((s, c) => s + lengte(c), 0);
  assert.ok(Math.abs(som - (OMTREK - 4 * 2)) < 0.1, `som ${som}`);
  // aandelen blijven evenredig: 10/20/30/40 %
  assert.ok(Math.abs(lengte(b[3]) - (0.4 * OMTREK - 2)) < 0.05);
});

test('donutSvg: opeenvolgende bogen sluiten aan via dashoffset (begin op 12 uur, met de klok mee)', () => {
  const b = bogen(donutSvg({ segmenten: VIER, titel: 't', midden: { groot: '1', klein: 'x' } }));
  const offset = c => Number(c.match(/stroke-dashoffset="(-?[\d.]+)"/)[1]);
  assert.ok(Math.abs(offset(b[0]) + 1) < 0.01, 'eerste boog start 1px na 12 uur (halve gap)');
  assert.ok(Math.abs(offset(b[1]) - offset(b[0]) + 0.1 * OMTREK) < 0.05);
});

test('donutSvg: segment met waarde 0 krijgt geen boog', () => {
  const s = donutSvg({ segmenten: [seg(1, 'A', 10), seg(2, 'B', 0), seg(3, 'C', 5), seg(4, 'D', 5)], titel: 't', midden: { groot: '20', klein: 'x' } });
  assert.equal(bogen(s).length, 3);
  assert.ok(!s.includes('var(--viz-2)'));
});

test('donutSvg: midden toont groot en klein; aria-label bevat de waarden', () => {
  const s = donutSvg({ segmenten: VIER, titel: 'Sales-resultaten', midden: { groot: '48', klein: 'bezoeken' } });
  assert.ok(s.includes('>48<') && s.includes('>bezoeken<'));
  assert.ok(s.includes('role="img"'));
  assert.ok(s.includes('aria-label="Sales-resultaten: Offerte 10 (10 %), Verkocht 20 (20 %), Geen interesse 30 (30 %), Opnieuw 40 (40 %)"'));
});

test('donutSvg: totaal 0 -> neutrale lege ring met "geen gegevens", geen NaN', () => {
  const s = donutSvg({ segmenten: [seg(1, 'A', 0), seg(2, 'B', 0)], titel: 'Leeg', midden: { groot: '0', klein: 'x' } });
  assert.ok(s.includes('geen gegevens'));
  assert.equal(bogen(s).length, 0);
  assert.ok(s.includes('class="donut-spoor"'));
  assert.ok(!s.includes('NaN'));
  assert.ok(s.includes('aria-label="Leeg: geen gegevens"'));
});

test('donutSvg: onbruikbare waarden (NaN, negatief, ontbrekend) tellen als 0', () => {
  const s = donutSvg({ segmenten: [seg(1, 'A', NaN), seg(2, 'B', -4), seg(3, 'C', 5), { sleutel: 'd', label: 'D', slot: 4 }], titel: 't', midden: { groot: '5', klein: 'x' } });
  assert.equal(bogen(s).length, 1);
  assert.ok(!s.includes('NaN') && !s.includes('undefined'));
});

test('donutSvg: meer dan 6 segmenten -> RangeError', () => {
  const zeven = Array.from({ length: 7 }, (_, i) => seg(i + 1, `S${i}`, 1));
  assert.throws(() => donutSvg({ segmenten: zeven, titel: 't', midden: { groot: '7', klein: 'x' } }), RangeError);
  assert.throws(() => donutLegende(zeven), RangeError);
  assert.throws(() => donutFiguur({ segmenten: zeven, titel: 't', midden: { groot: '7', klein: 'x' } }), RangeError);
  assert.doesNotThrow(() => donutSvg({ segmenten: zeven.slice(0, 6), titel: 't', midden: { groot: '6', klein: 'x' } }));
});

test('donutLegende: rij per segment met kleurblokje, naam, aantal en % ("30 (30 %)"); 0-segment houdt zijn rij', () => {
  const l = donutLegende([...VIER, seg(5, 'Nul', 0)]);
  assert.match(l, /^<ul class="legende">/);
  assert.equal((l.match(/<li>/g) ?? []).length, 5);
  assert.ok(l.includes('30 (30 %)'));
  assert.ok(l.includes('0 (0 %)'));
  assert.ok(l.includes('swatch--1') && l.includes('swatch--4'));
});

test('donutLegende: totaal 0 -> rijen met 0 (0 %), geen NaN', () => {
  const l = donutLegende([seg(1, 'A', 0), seg(2, 'B', 0)]);
  assert.equal((l.match(/0 \(0 %\)/g) ?? []).length, 2);
  assert.ok(!l.includes('NaN'));
});

test('donutFiguur: svg + legende + tabel-twin', () => {
  const f = donutFiguur({ segmenten: VIER, titel: 'Sales', midden: { groot: '100', klein: 'bezoeken' } });
  assert.match(f, /^<figure class="donut">/);
  assert.ok(f.includes('<svg') && f.includes('class="legende"') && f.includes('<details class="tabel-twin">'));
  assert.ok(f.includes('<td class="num">30</td>'));
});

test('[RF4] label met HTML wordt ge-escaped in svg-aria-label, legende en tabel', () => {
  const f = donutFiguur({ segmenten: [seg(1, '<b>x</b>', 3), seg(2, 'ok', 1)], titel: '<u>t</u>', midden: { groot: '<i>4</i>', klein: '<s>b</s>' } });
  assert.ok(!f.includes('<b>') && !f.includes('<u>') && !f.includes('<i>') && !f.includes('<s>'));
  const delen = f.split('<ul class="legende">');
  assert.ok(delen[0].includes('aria-label="&lt;u&gt;t&lt;/u&gt;: &lt;b&gt;x&lt;/b&gt; 3 (75 %)'));
  assert.ok(delen[1].includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(f.split('<details')[1].includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('M1: spoor enkel bij totaal 0; de gaps tonen anders de oppervlaktekleur', () => {
  assert.ok(!donutSvg({ segmenten: VIER, titel: 't', midden: { groot: '1', klein: 'x' } }).includes('donut-spoor'));
  assert.ok(donutSvg({ segmenten: [seg(1, 'A', 0)], titel: 't', midden: { groot: '0', klein: 'x' } }).includes('donut-spoor'));
});

test('M6: segment zonder label geeft geen "undefined"', () => {
  const f = donutFiguur({ segmenten: [{ sleutel: 'a', waarde: 3, slot: 1 }, seg(2, 'B', 1)], titel: 't', midden: { groot: '4', klein: 'x' } });
  assert.ok(!f.includes('undefined'));
});
