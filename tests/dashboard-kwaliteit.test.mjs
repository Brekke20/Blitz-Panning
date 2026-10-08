import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstTimeFix, herhaalbezoeken, berekenKwaliteit } from '../netlify/lib/dashboard/kwaliteit.js';

let teller = 0;
// Een genormaliseerd Rapport (vorm uit gemeenschappelijk.js) met de velden die kwaliteit.js leest.
const rap = (extra = {}) => ({
  id: `r${++teller}`, datum: '2026-10-05', technieker: 'Tim', type: 'Single', interventieType: 'Interventie',
  ticketId: `t${teller}`, ticketNumber: `${1000 + teller}`, klant: 'Jan', adres: '', serienummer: '',
  hersteld: true, nieuwInter: false, oorzaken: [], ...extra,
});
const bevatNaN = v => (typeof v === 'number' ? Number.isNaN(v) : v && typeof v === 'object' ? Object.values(v).some(bevatNaN) : false);

test('first-time-fix: enkel hersteld en geen nieuwe interventie telt', () => {
  const r = firstTimeFix([
    rap({ hersteld: true, nieuwInter: false }),
    rap({ hersteld: true, nieuwInter: true }),
    rap({ hersteld: false, nieuwInter: false }),
    rap({ interventieType: 'Installatie', hersteld: true, nieuwInter: false }),
  ]);
  assert.deepEqual(r, { n: 3, ftf: 1, pct: 33.3 });
});

test('first-time-fix [RF1]: geen interventies geeft pct null', () => {
  assert.deepEqual(firstTimeFix([]), { n: 0, ftf: 0, pct: null });
  assert.deepEqual(firstTimeFix([rap({ interventieType: 'Installatie' })]), { n: 0, ftf: 0, pct: null });
});

test('herhaalbezoek: zelfde serienummer, 20 dagen eerder telt bij 30 en 90; 45 dagen alleen bij 90', () => {
  const nu = rap({ datum: '2026-10-21', serienummer: 'CH1', ticketId: 'tB' });
  const twintig = rap({ datum: '2026-10-01', serienummer: 'CH1', ticketId: 'tA' });
  assert.equal(herhaalbezoeken([twintig, nu], [nu], 30).length, 1);
  assert.equal(herhaalbezoeken([twintig, nu], [nu], 90).length, 1);
  const vijfenveertig = rap({ datum: '2026-09-06', serienummer: 'CH1', ticketId: 'tC' });
  assert.equal(herhaalbezoeken([vijfenveertig, nu], [nu], 30).length, 0);
  assert.equal(herhaalbezoeken([vijfenveertig, nu], [nu], 90).length, 1);
  const [h] = herhaalbezoeken([twintig, nu], [nu], 30);
  assert.deepEqual(h, {
    id: nu.id, ticketNumber: nu.ticketNumber, datum: '2026-10-21', vorigeId: twintig.id, vorigeDatum: '2026-10-01',
    dagen: 20, technieker: 'Tim', klant: 'Jan', sleutel: 'serie:CH1',
  });
});

test('herhaalbezoek [RF3]: zelfde dag of dubbele entry is nooit een herhaal', () => {
  const a = rap({ datum: '2026-10-05', serienummer: 'CH1', ticketId: 'tX' });
  const zelfdeDag = rap({ datum: '2026-10-05', serienummer: 'CH1', ticketId: 'tY' });
  assert.equal(herhaalbezoeken([a, zelfdeDag], [a, zelfdeDag], 30).length, 0);
  const dubbel = rap({ datum: '2026-10-05', serienummer: 'CH1', ticketId: 'tX' });
  assert.equal(herhaalbezoeken([a, dubbel], [a, dubbel], 30).length, 0);
  assert.equal(herhaalbezoeken([a], [a], 30).length, 0);
});

test('herhaalbezoek: adres als terugval, geen sleutel telt in de dekking', () => {
  const A = rap({ datum: '2026-10-01', adres: 'Antwerpseweg 50, 2440 Geel' });
  const B = rap({ datum: '2026-10-10', adres: 'antwerpseweg 50 2440 GEEL' });
  const [h] = herhaalbezoeken([A, B], [B], 30);
  assert.equal(h.vorigeId, A.id);
  assert.equal(h.sleutel, 'adres:antwerpseweg502440geel');
  // serienummer gaat voor: B heeft er een, A niet, dus geen match op adres
  const B2 = rap({ datum: '2026-10-10', serienummer: 'CH9', adres: 'Antwerpseweg 50, 2440 Geel' });
  assert.equal(herhaalbezoeken([A, B2], [B2], 30).length, 0);
  const leeg = rap({ datum: '2026-10-10', adres: 'Geel' });
  const k = berekenKwaliteit({ rapporten: [leeg], alle: [A, leeg] });
  assert.equal(k.herhaal.aantal, 0);
  assert.equal(k.dekking.herhaalZonderSleutel, 1);
});

test('herhaalbezoek: eerder rapport buiten de periode telt, maar moet een interventie zijn', () => {
  const eerder = rap({ datum: '2026-09-25', serienummer: 'CH1' });
  const installatie = rap({ datum: '2026-09-28', serienummer: 'CH1', interventieType: 'Installatie' });
  const nu = rap({ datum: '2026-10-02', serienummer: 'CH1' });
  const [h] = herhaalbezoeken([eerder, installatie, nu], [nu], 30);
  assert.equal(h.vorigeId, eerder.id);
  assert.equal(h.dagen, 7);
  assert.equal(herhaalbezoeken([installatie, nu], [nu], 30).length, 0);
});

test('berekenKwaliteit: per technieker en type, herhaal en dekking', () => {
  const eerder = rap({ datum: '2026-09-25', serienummer: 'CH1', technieker: 'Roel' });
  const nu = rap({ datum: '2026-10-02', serienummer: 'CH1', technieker: 'Tim', type: 'Dual 1', hersteld: false });
  const rest = rap({ datum: '2026-10-03', technieker: 'Tim', type: 'Dual 1' });
  const k = berekenKwaliteit({ rapporten: [nu, rest], alle: [eerder, nu, rest] });
  assert.deepEqual(k.ftfTotaal, { n: 2, ftf: 1, pct: 50 });
  assert.deepEqual(k.ftfPerTechnieker, [{ sleutel: 'Tim', label: 'Tim', n: 2, ftf: 1, pct: 50 }]);
  assert.deepEqual(k.ftfPerType, [{ sleutel: 'Dual 1', label: 'Dual 1', n: 2, ftf: 1, pct: 50 }]);
  assert.equal(k.herhaal.dagen, 30);
  assert.equal(k.herhaal.aantal, 1);
  assert.equal(k.herhaal.lijst.length, 1);
  assert.equal(k.dekking.interventies, 2);
});

test('berekenKwaliteit: herhaalDagen 90 en de lijst is begrensd op 200', () => {
  const alle = [];
  const sel = [];
  for (let i = 0; i < 205; i++) {
    const a = rap({ datum: '2026-07-01', serienummer: `S${i}` });
    const b = rap({ datum: '2026-07-10', serienummer: `S${i}` });
    alle.push(a, b); sel.push(b);
  }
  const k = berekenKwaliteit({ rapporten: sel, alle, herhaalDagen: 90 });
  assert.equal(k.herhaal.dagen, 90);
  assert.equal(k.herhaal.aantal, 205);
  assert.equal(k.herhaal.lijst.length, 200);
});

test('berekenKwaliteit [RF1]: lege lijst', () => {
  const k = berekenKwaliteit({ rapporten: [], alle: [] });
  assert.deepEqual(k.ftfTotaal, { n: 0, ftf: 0, pct: null });
  assert.deepEqual(k.ftfPerTechnieker, []);
  assert.deepEqual(k.ftfPerType, []);
  assert.deepEqual(k.herhaal, { dagen: 30, aantal: 0, lijst: [] });
  assert.deepEqual(k.topOorzaken, []);
  assert.equal(bevatNaN(k), false);
});

test('topOorzaken: sorteert op n, perType klopt, maximum 8', () => {
  const lijst = [
    rap({ type: 'Single', oorzaken: ['Kabel', 'Software'] }),
    rap({ type: 'Dual 1', oorzaken: ['Kabel'] }),
    rap({ type: 'Dual 1', oorzaken: ['Kabel', 'Kabel'] }), // dubbele vermelding telt eenmaal
  ];
  for (let i = 0; i < 9; i++) lijst.push(rap({ oorzaken: [`Rare ${i}`] }));
  const { topOorzaken } = berekenKwaliteit({ rapporten: lijst, alle: lijst });
  assert.equal(topOorzaken.length, 8);
  assert.deepEqual(topOorzaken[0], { oorzaak: 'Kabel', n: 3, perType: { Single: 1, 'Dual 1': 2 } });
  assert.equal(topOorzaken[1].oorzaak, 'Software');
  assert.ok(topOorzaken.every((o, i) => i === 0 || topOorzaken[i - 1].n >= o.n));
});

test('[fix] type __proto__ in topOorzaken vervuilt niets', () => {
  const lijst = [rap({ type: '__proto__', oorzaken: ['Kabel'] })];
  const { topOorzaken } = berekenKwaliteit({ rapporten: lijst, alle: lijst });
  assert.deepEqual(Object.keys(topOorzaken[0].perType), ['__proto__']);
  assert.equal(Object.getPrototypeOf(topOorzaken[0].perType), Object.prototype);
});
