import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_TEKST, ringSvg, ringFiguur } from '../public/js/kern/grafiek-ring.js';

const OMTREK = 2 * Math.PI * 45;

test('ringSvg: role, aria-label, percentage in het midden en boog met de verwachte lengte', () => {
  const s = ringSvg({ pct: 87, status: 'goed', titel: 'Op tijd' });
  assert.match(s, /^<svg /);
  assert.ok(s.includes('role="img"'));
  assert.ok(s.includes('aria-label="Op tijd: 87 %"'));
  assert.ok(s.includes('>87%<'));
  assert.ok(s.includes('rotate(-90 50 50)'));
  assert.ok(s.includes('stroke-linecap="round"'));
  assert.ok(s.includes('viewBox="0 0 100 100"'));
  assert.ok(s.includes('width="96"') && s.includes('height="96"'));
  const m = s.match(/class="ring-boog"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/);
  assert.ok(m, 'boog met stroke-dasharray');
  assert.ok(Math.abs(Number(m[1]) - 0.87 * OMTREK) < 0.05, `lengte ${m[1]}`);
  assert.ok(Math.abs(Number(m[2]) - OMTREK) < 0.05);
  assert.ok(s.includes('class="ring-spoor"'));
});

test('ringSvg: afgeronde waarde in het midden, grootte instelbaar', () => {
  const s = ringSvg({ pct: 89.6, status: 'goed', titel: 'x', grootte: 64 });
  assert.ok(s.includes('>90%<'));
  assert.ok(s.includes('width="64"'));
});

test('ringSvg: pct null toont een streepje en tekent geen boog', () => {
  const s = ringSvg({ pct: null, status: null, titel: 'Op tijd' });
  assert.ok(s.includes('>—<'));
  assert.ok(!s.includes('ring-boog'));
  assert.ok(s.includes('aria-label="Op tijd: geen gegevens"'));
  assert.ok(s.includes('class="ring-spoor"'));
});

test('ringSvg: pct buiten 0-100 wordt begrensd, nooit NaN', () => {
  const hoog = ringSvg({ pct: 140, status: 'goed', titel: 'x' });
  assert.ok(hoog.includes('>100%<'));
  assert.ok(!hoog.includes('NaN'));
  const laag = ringSvg({ pct: -5, status: 'slecht', titel: 'x' });
  assert.ok(laag.includes('>0%<'));
  assert.ok(!laag.includes('NaN'));
  assert.ok(!laag.includes('ring-boog'), 'bij 0 % geen boog (een ronde dop zou een stip tekenen)');
  const nan = ringSvg({ pct: NaN, status: null, titel: 'x' });
  assert.ok(nan.includes('>—<') && !nan.includes('NaN'));
});

test('ringSvg [RF4]: titel wordt ge-escaped', () => {
  const s = ringSvg({ pct: 50, status: 'neutraal', titel: '<script>x</script>' });
  assert.ok(!s.includes('<script>'));
  assert.ok(s.includes('&lt;script&gt;x&lt;/script&gt;'));
});

test('ringSvg: onbekende status valt terug op neutraal, geen klasse-injectie', () => {
  const s = ringSvg({ pct: 50, status: 'x" onload="y', titel: 't' });
  assert.ok(!s.includes('onload'));
  assert.ok(s.includes('ring--neutraal'));
});

test('STATUS_TEKST heeft icoon en woord per status', () => {
  assert.deepEqual(STATUS_TEKST.goed, { icoon: '✓', woord: 'Op doel' });
  assert.deepEqual(STATUS_TEKST.aandacht, { icoon: '!', woord: 'Let op' });
  assert.deepEqual(STATUS_TEKST.slecht, { icoon: '✕', woord: 'Onder doel' });
});

test('ringFiguur: aandacht toont icoon en woord, klasse ring--aandacht', () => {
  const f = ringFiguur({ pct: 80, status: 'aandacht', titel: 'Op tijd' });
  assert.match(f, /^<figure class="ring ring--aandacht"/);
  assert.ok(f.includes('!'));
  assert.ok(f.includes('Let op'));
  assert.ok(f.includes('<figcaption'));
});

test('ringFiguur: goed en slecht tonen hun statusregel', () => {
  assert.ok(ringFiguur({ pct: 95, status: 'goed', titel: 't' }).includes('✓'));
  assert.ok(ringFiguur({ pct: 95, status: 'goed', titel: 't' }).includes('Op doel'));
  assert.ok(ringFiguur({ pct: 10, status: 'slecht', titel: 't' }).includes('✕'));
  assert.ok(ringFiguur({ pct: 10, status: 'slecht', titel: 't' }).includes('Onder doel'));
});

test('ringFiguur: neutraal heeft geen statusregel', () => {
  const f = ringFiguur({ pct: 50, status: 'neutraal', titel: 't', n: 5, noemer: 10 });
  assert.ok(f.includes('ring--neutraal'));
  assert.ok(!f.includes('ring-status'));
  assert.ok(!f.includes('Let op') && !f.includes('Op doel') && !f.includes('Onder doel'));
  assert.ok(f.includes('5 van 10'));
});

test('ringFiguur: n en noemer tonen "12 van 15"', () => {
  const f = ringFiguur({ pct: 80, status: 'aandacht', titel: 't', n: 12, noemer: 15 });
  assert.ok(f.includes('12 van 15'));
});

test('ringFiguur: pct null geeft "geen gegevens" en ring--geen, zonder statusregel', () => {
  const f = ringFiguur({ pct: null, status: null, titel: 't' });
  assert.ok(f.includes('geen gegevens'));
  assert.ok(f.includes('ring--geen'));
  assert.ok(!f.includes('ring-status'));
});

test('ringFiguur: sub staat in de figcaption en wordt ge-escaped [RF4]', () => {
  const f = ringFiguur({ pct: 75, status: 'aandacht', titel: 't', sub: '2 te vroeg · 1 te laat' });
  const cap = f.slice(f.indexOf('<figcaption'));
  assert.ok(cap.includes('2 te vroeg · 1 te laat'));
  const g = ringFiguur({ pct: 75, status: 'aandacht', titel: 't', sub: '<b>x</b>' });
  assert.ok(!g.includes('<b>x</b>'));
  assert.ok(g.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('M6: niet-eindige n of noemer geeft geen NaN in de figuur', () => {
  const f = ringFiguur({ pct: 50, status: 'neutraal', titel: 't', n: NaN, noemer: NaN });
  assert.ok(!f.includes('NaN'));
  const g = ringFiguur({ pct: 50, status: 'neutraal', titel: 't', n: 4, noemer: NaN });
  assert.ok(!g.includes('NaN') && g.includes('>4<'));
});
