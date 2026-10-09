import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gemiddeldeDuur, opTijd, berekenTijd } from '../netlify/lib/dashboard/tijd.js';

let teller = 0;
// Een genormaliseerd Rapport (vorm uit gemeenschappelijk.js) met de velden die tijd.js leest.
const rap = (extra = {}) => ({
  id: `r${++teller}`, datum: '2026-10-05', technieker: 'Tim', type: 'Single', interventieType: 'Interventie',
  werktijdMin: 60, werktijdOnbetrouwbaar: false, aanrijtijdMin: null, start: '', oorzaken: [],
  geplandTijdslot: null, ...extra,
});
const bevatNaN = v => (typeof v === 'number' ? Number.isNaN(v) : v && typeof v === 'object' ? Object.values(v).some(bevatNaN) : false);
const slot = { van: '08:30', tot: '11:30' };

test('gemiddelde duur over interventies; bezoektype bevat ook installaties', () => {
  const lijst = [rap({ werktijdMin: 60 }), rap({ werktijdMin: 120 }), rap({ interventieType: 'Installatie', werktijdMin: 180 })];
  assert.equal(gemiddeldeDuur(lijst), 90);
  const t = berekenTijd(lijst);
  const inst = t.duurPer.bezoektype.find(r => r.sleutel === 'Installatie');
  assert.deepEqual(inst, { sleutel: 'Installatie', label: 'Installatie', n: 1, gemMin: 180 });
  assert.equal(t.duurPer.bezoektype.find(r => r.sleutel === 'Interventie').gemMin, 90);
});

test('duurPer laadpaal en technieker, aflopend op n', () => {
  const t = berekenTijd([
    rap({ type: 'Single', technieker: 'Tim', werktijdMin: 60 }),
    rap({ type: 'Dual 1', technieker: 'Roel', werktijdMin: 30 }),
    rap({ type: 'Dual 1', technieker: 'Tim', werktijdMin: 90 }),
  ]);
  assert.deepEqual(t.duurPer.laadpaal.map(r => [r.sleutel, r.n, r.gemMin]), [['Dual 1', 2, 60], ['Single', 1, 60]]);
  assert.deepEqual(t.duurPer.technieker.map(r => [r.sleutel, r.n, r.gemMin]), [['Tim', 2, 75], ['Roel', 1, 30]]);
});

test('werktijd [RF2]: middernacht telt mee, 25 u valt buiten het gemiddelde en in de dekking', () => {
  const nacht = rap({ werktijdMin: 240 });
  const onbetrouwbaar = rap({ werktijdMin: null, werktijdOnbetrouwbaar: true });
  const zonder = rap({ werktijdMin: null });
  assert.equal(gemiddeldeDuur([nacht, onbetrouwbaar]), 240);
  const t = berekenTijd([nacht, onbetrouwbaar, zonder]);
  assert.equal(t.dekking.duurOnbetrouwbaar, 1);
  assert.equal(t.dekking.metDuur, 1);
  assert.equal(t.dekking.rapporten, 3);
});

test('opTijd: drie categorieen, grenzen inclusief', () => {
  const mk = start => rap({ geplandTijdslot: slot, start });
  const r = opTijd([mk('08:29'), mk('08:30'), mk('11:30'), mk('11:31')]);
  assert.equal(r.n, 4);
  assert.equal(r.teVroeg, 1);
  assert.equal(r.opTijd, 2);
  assert.equal(r.teLaat, 1);
  assert.equal(r.teVroeg + r.opTijd + r.teLaat, r.n);
  assert.equal(r.pct, 50);
  assert.deepEqual(opTijd([mk('08:29')]), { n: 1, teVroeg: 1, opTijd: 0, teLaat: 0, pct: 0 });
  assert.deepEqual(opTijd([mk('11:30')]), { n: 1, teVroeg: 0, opTijd: 1, teLaat: 0, pct: 100 });
  assert.deepEqual(opTijd([mk('11:31')]), { n: 1, teVroeg: 0, opTijd: 0, teLaat: 1, pct: 0 });
});

test('opTijd: 2 van 3 op tijd is 66.7; zonder slot of zonder geldige start telt niet in n', () => {
  const lijst = [
    rap({ geplandTijdslot: slot, start: '09:00', technieker: 'Tim' }),
    rap({ geplandTijdslot: slot, start: '10:00', technieker: 'Tim' }),
    rap({ geplandTijdslot: slot, start: '12:00', technieker: 'Roel' }),
    rap({ technieker: 'Roel', start: '09:00' }),
    rap({ geplandTijdslot: slot, start: '' }),
    rap({ geplandTijdslot: slot, start: 'ochtend' }),
  ];
  const r = opTijd(lijst);
  assert.equal(r.n, 3);
  assert.equal(r.pct, 66.7);
  const t = berekenTijd(lijst);
  assert.deepEqual(t.opTijdTotaal, r);
  assert.equal(t.dekking.metSlot, 3);
  assert.equal(t.dekking.zonderSlot, 3);
  assert.deepEqual(t.opTijdPerTechnieker, [
    { technieker: 'Tim', n: 2, teVroeg: 0, opTijd: 2, teLaat: 0, pct: 100 },
    { technieker: 'Roel', n: 1, teVroeg: 0, opTijd: 0, teLaat: 1, pct: 0 },
  ]);
});

test('lege lijst [RF1]: geen NaN, alles leeg', () => {
  assert.equal(gemiddeldeDuur([]), null);
  assert.deepEqual(opTijd([]), { n: 0, teVroeg: 0, opTijd: 0, teLaat: 0, pct: null });
  const t = berekenTijd([]);
  assert.deepEqual(t.duurPer, { laadpaal: [], oorzaak: [], technieker: [], bezoektype: [] });
  assert.deepEqual(t.opTijdPerTechnieker, []);
  assert.deepEqual(t.opTijdTotaal, { n: 0, teVroeg: 0, opTijd: 0, teLaat: 0, pct: null });
  assert.deepEqual(t.rijtijdPerDag, []);
  assert.deepEqual(t.perDagPerTechnieker, { datums: [], techniekers: [], waarden: {} });
  assert.deepEqual(t.dekking, { rapporten: 0, metDuur: 0, duurOnbetrouwbaar: 0, metSlot: 0, zonderSlot: 0, metAanrijtijd: 0 });
  assert.equal(bevatNaN(t), false);
});

test('rapport met twee oorzaken telt in beide rijen', () => {
  const t = berekenTijd([rap({ oorzaken: ['Software', 'Kabel'], werktijdMin: 60 }), rap({ oorzaken: ['Kabel'], werktijdMin: 120 })]);
  const kabel = t.duurPer.oorzaak.find(r => r.sleutel === 'Kabel');
  const soft = t.duurPer.oorzaak.find(r => r.sleutel === 'Software');
  assert.deepEqual([kabel.n, kabel.gemMin], [2, 90]);
  assert.deepEqual([soft.n, soft.gemMin], [1, 60]);
});

test('rijtijdPerDag negeert ontbrekende aanrijtijd maar telt de werktijd', () => {
  const t = berekenTijd([
    rap({ datum: '2026-10-06', werktijdMin: 60, aanrijtijdMin: 20 }),
    rap({ datum: '2026-10-06', werktijdMin: 30, aanrijtijdMin: null }),
    rap({ datum: '2026-10-05', werktijdMin: 45, aanrijtijdMin: null }),
  ]);
  assert.deepEqual(t.rijtijdPerDag, [
    { datum: '2026-10-05', aanrijtijdMin: 0, werktijdMin: 45, n: 1 },
    { datum: '2026-10-06', aanrijtijdMin: 20, werktijdMin: 90, n: 2 },
  ]);
  assert.equal(t.dekking.metAanrijtijd, 1);
});

test('perDagPerTechnieker: techniekers in volgorde van eerste voorkomen, dagen oplopend', () => {
  const t = berekenTijd([
    rap({ datum: '2026-10-07', technieker: 'Roel' }),
    rap({ datum: '2026-10-05', technieker: 'Tim' }),
    rap({ datum: '2026-10-05', technieker: 'Tim' }),
    rap({ datum: '2026-10-07', technieker: 'Tim' }),
  ]);
  assert.deepEqual(t.perDagPerTechnieker.techniekers, ['Roel', 'Tim']);
  assert.deepEqual(t.perDagPerTechnieker.datums, ['2026-10-05', '2026-10-07']);
  assert.deepEqual(t.perDagPerTechnieker.waarden, { Roel: { '2026-10-07': 1 }, Tim: { '2026-10-05': 2, '2026-10-07': 1 } });
});

test('[fix] technieker __proto__ vervuilt niets', () => {
  const t = berekenTijd([rap({ technieker: '__proto__' })]);
  assert.deepEqual(Object.keys(t.perDagPerTechnieker.waarden), ['__proto__']);
  assert.equal(Object.getPrototypeOf(t.perDagPerTechnieker.waarden), Object.prototype);
  assert.equal({}['2026-10-05'], undefined);
});
