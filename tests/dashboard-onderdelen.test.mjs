import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waardeTotaal, berekenOnderdelen } from '../netlify/lib/dashboard/onderdelen.js';
import { normaliseerRapport } from '../netlify/lib/dashboard/gemeenschappelijk.js';

let teller = 0;
const onderdeel = (extra = {}) => ({ sleutel: 'led', naam: 'LED-module', aantal: 1, prijs: 8, prijsBron: 'rapport', ...extra });
// Een genormaliseerd Rapport (vorm uit gemeenschappelijk.js) met de velden die onderdelen.js leest.
const rap = (onderdelen, extra = {}) => ({
  id: `r${++teller}`, datum: '2026-10-05', technieker: 'Tim', type: 'Single', onderdelen, ...extra,
});
const bevatNaN = v => (typeof v === 'number' ? Number.isNaN(v) : v && typeof v === 'object' ? Object.values(v).some(bevatNaN) : false);

test('top10: aantallen en waarde over rapporten heen', () => {
  const t = berekenOnderdelen([rap([onderdeel({ aantal: 2 })]), rap([onderdeel({ aantal: 1 })])]);
  assert.deepEqual(t.top10[0], { sleutel: 'led', naam: 'LED-module', aantal: 3, waarde: 24, rapporten: 2 });
  assert.deepEqual(waardeTotaal([rap([onderdeel({ aantal: 2 })]), rap([onderdeel({ aantal: 1 })])]), { waarde: 24, aantal: 3, zonderPrijs: 0 });
});

test('prijsBron geen telt 0 en komt in de dekking', () => {
  const lijst = [rap([onderdeel({ sleutel: 'x', naam: 'Onbekend ding', prijs: 0, prijsBron: 'geen', aantal: 2 }), onderdeel()])];
  assert.deepEqual(waardeTotaal(lijst), { waarde: 8, aantal: 3, zonderPrijs: 1 });
  const t = berekenOnderdelen(lijst);
  assert.equal(t.dekking.zonderPrijs, 1);
  assert.equal(t.dekking.metOnderdelen, 1);
  assert.equal(t.dekking.rapporten, 1);
});

test('niet-factureerbare onderdelen tellen mee', () => {
  const lijst = [rap([onderdeel({ sleutel: 'gratis', naam: 'Kleinmateriaal', prijs: 0, prijsBron: 'prijslijst', factureerbaar: false })])];
  const t = berekenOnderdelen(lijst);
  assert.equal(t.top10.length, 1);
  assert.equal(t.top10[0].aantal, 1);
});

test('vrije regels met verschillende spaties en hoofdletters vormen een groep', () => {
  const raw = naam => normaliseerRapport({
    id: naam, datum: '2026-10-05', technieker: 'Tim',
    rapportData: { onderdelen: [{ id: 'vrij-1', naam, prijs: '5', aantal: 1 }] },
  });
  const t = berekenOnderdelen([raw(' Zekering '), raw('zekering')]);
  assert.equal(t.top10.length, 1);
  assert.equal(t.top10[0].sleutel, 'zekering');
  assert.equal(t.top10[0].aantal, 2);
  assert.equal(t.top10[0].waarde, 10);
});

test('naam van een groep is de meest voorkomende naam', () => {
  const t = berekenOnderdelen([
    rap([onderdeel({ naam: 'LED module' })]), rap([onderdeel({ naam: 'LED-module' })]), rap([onderdeel({ naam: 'LED-module' })]),
  ]);
  assert.equal(t.top10[0].naam, 'LED-module');
});

test('top10 is begrensd op 10 en aflopend op aantal, dan waarde', () => {
  const regels = [];
  for (let i = 0; i < 12; i++) regels.push(onderdeel({ sleutel: `o${i}`, naam: `Onderdeel ${i}`, aantal: 1, prijs: i }));
  regels.push(onderdeel({ sleutel: 'veel', naam: 'Veel', aantal: 5, prijs: 1 }));
  const t = berekenOnderdelen([rap(regels)]);
  assert.equal(t.top10.length, 10);
  assert.equal(t.top10[0].sleutel, 'veel');
  assert.equal(t.top10[1].sleutel, 'o11'); // gelijk aantal: hoogste waarde eerst
  assert.ok(t.top10.every((o, i) => i === 0 || t.top10[i - 1].aantal > o.aantal || (t.top10[i - 1].aantal === o.aantal && t.top10[i - 1].waarde >= o.waarde)));
});

test('perMaand: maanden oplopend en aaneensluitend, ook als een maand leeg is', () => {
  const t = berekenOnderdelen([
    rap([onderdeel({ aantal: 2 })], { datum: '2026-10-03', technieker: 'Roel', type: 'Dual 1' }),
    rap([onderdeel({ aantal: 1 })], { datum: '2026-08-20', technieker: 'Tim', type: 'Single' }),
  ]);
  const m = t.perMaand;
  assert.deepEqual(m.maanden, ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(m.totaal, {
    '2026-08': { aantal: 1, waarde: 8 }, '2026-09': { aantal: 0, waarde: 0 }, '2026-10': { aantal: 2, waarde: 16 },
  });
  assert.deepEqual(m.perTechnieker.Roel['2026-10'], { aantal: 2, waarde: 16 });
  assert.deepEqual(m.perTechnieker.Roel['2026-08'], { aantal: 0, waarde: 0 });
  assert.deepEqual(m.perType.Single['2026-08'], { aantal: 1, waarde: 8 });
});

test('maandgrens over een jaarwissel blijft aaneensluitend', () => {
  const t = berekenOnderdelen([rap([onderdeel()], { datum: '2025-11-30' }), rap([onderdeel()], { datum: '2026-02-01' })]);
  assert.deepEqual(t.perMaand.maanden, ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('lege lijst [RF1]', () => {
  assert.deepEqual(waardeTotaal([]), { waarde: 0, aantal: 0, zonderPrijs: 0 });
  const t = berekenOnderdelen([]);
  assert.deepEqual(t.top10, []);
  assert.deepEqual(t.perMaand, { maanden: [], perTechnieker: {}, perType: {}, totaal: {} });
  assert.deepEqual(t.dekking, { rapporten: 0, metOnderdelen: 0, zonderPrijs: 0 });
  assert.equal(bevatNaN(t), false);
});

test('rapport zonder onderdelen telt in de maanden en de dekking, niet in de top', () => {
  const t = berekenOnderdelen([rap([]), rap([onderdeel()])]);
  assert.equal(t.dekking.rapporten, 2);
  assert.equal(t.dekking.metOnderdelen, 1);
  assert.equal(t.top10.length, 1);
});

test('[fix] technieker en type __proto__ vervuilen niets', () => {
  const t = berekenOnderdelen([rap([onderdeel()], { technieker: '__proto__', type: '__proto__' })]);
  assert.deepEqual(Object.keys(t.perMaand.perTechnieker), ['__proto__']);
  assert.deepEqual(Object.keys(t.perMaand.perType), ['__proto__']);
  assert.equal(Object.getPrototypeOf(t.perMaand.perType), Object.prototype);
  assert.equal({}['2026-10'], undefined);
});
