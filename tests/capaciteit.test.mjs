process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blokkeerMinuten, capaciteitVoorDag, volgendeBeschikbareDag, capaciteitsKop,
} from '../public/js/schermen/capaciteit.js';

// ── blokkeerMinuten (werkdag 08:00–17:00 = 480–1020) ──
const blok = (from, to) => ({ from, to });

test('blokkeerMinuten: één interval', () => {
  assert.equal(blokkeerMinuten([blok('10:00', '11:30')], 480, 1020), 90);
});

test('blokkeerMinuten: overlappende intervallen tellen niet dubbel', () => {
  assert.equal(blokkeerMinuten([blok('10:00', '12:00'), blok('11:00', '13:00')], 480, 1020), 180);
});

test('blokkeerMinuten: interval binnen een ander voegt niets toe', () => {
  assert.equal(blokkeerMinuten([blok('09:00', '15:00'), blok('10:00', '11:00')], 480, 1020), 360);
});

test('blokkeerMinuten: ongesorteerde invoer geeft hetzelfde resultaat', () => {
  assert.equal(blokkeerMinuten([blok('13:00', '14:00'), blok('09:00', '10:00')], 480, 1020), 120);
});

test('blokkeerMinuten: buiten de werkdag wordt geknipt', () => {
  // 06:00–09:00 knipt tot 08:00–09:00 (60); 16:00–20:00 knipt tot 16:00–17:00 (60)
  assert.equal(blokkeerMinuten([blok('06:00', '09:00'), blok('16:00', '20:00')], 480, 1020), 120);
});

test('blokkeerMinuten: volledig buiten de werkdag telt niet', () => {
  assert.equal(blokkeerMinuten([blok('05:00', '07:00'), blok('18:00', '20:00')], 480, 1020), 0);
});

test('blokkeerMinuten: leeg of ontbrekend = 0', () => {
  assert.equal(blokkeerMinuten([], 480, 1020), 0);
  assert.equal(blokkeerMinuten(undefined, 480, 1020), 0);
});

// ── capaciteitVoorDag ──
const basis = {
  datum: '2026-10-06', isFeestdag: false, vanTijd: '08:00', totTijd: '17:00',
  duurMinuten: 120, maxPerDag: 4, dagBlokkering: false, rangeUitzonderingen: [],
};

test('capaciteitVoorDag: 08:00–17:00, duur 120 + 30 reistijd, maxPerDag 4 = 3', () => {
  assert.equal(capaciteitVoorDag(basis), 3); // 540 / 150 = 3,6 -> 3
});

test('capaciteitVoorDag: maxPerDag 2 begrenst', () => {
  assert.equal(capaciteitVoorDag({ ...basis, maxPerDag: 2 }), 2);
});

test('capaciteitVoorDag: reistijd is een parameter (standaard 30)', () => {
  assert.equal(capaciteitVoorDag({ ...basis, travelMin: 60 }), 3); // 540 / 180
  assert.equal(capaciteitVoorDag({ ...basis, travelMin: 120 }), 2); // 540 / 240 = 2,25
});

test('capaciteitVoorDag: feestdag en hele-dag-blokkering = 0', () => {
  assert.equal(capaciteitVoorDag({ ...basis, isFeestdag: true }), 0);
  assert.equal(capaciteitVoorDag({ ...basis, dagBlokkering: true }), 0);
});

test('capaciteitVoorDag: kortere werkdag 10:00–17:00 = 420 / 150 = 2', () => {
  assert.equal(capaciteitVoorDag({ ...basis, vanTijd: '10:00' }), 2);
});

test('capaciteitVoorDag: tijdvak-blokkering laat 120 min over (120 / 150) = 0', () => {
  assert.equal(capaciteitVoorDag({ ...basis, rangeUitzonderingen: [blok('08:00', '15:00')] }), 0);
});

test('capaciteitVoorDag: tijdvak-blokkering van 90 min: 450 / 150 = 3', () => {
  assert.equal(capaciteitVoorDag({ ...basis, rangeUitzonderingen: [blok('12:00', '13:30')] }), 3);
});

test('capaciteitVoorDag: blokkering groter dan de werkdag geeft 0, nooit negatief', () => {
  assert.equal(capaciteitVoorDag({ ...basis, rangeUitzonderingen: [blok('00:00', '23:59')] }), 0);
});

// ── volgendeBeschikbareDag ──
// 2026-10-05 is een maandag.
const nu = new Date(2026, 9, 5, 10, 0);
const werkdagen = [1, 2, 3, 4, 5];
const vrij = () => 3;
const niets = () => 0;

test('volgendeBeschikbareDag: vandaag vrij = vandaag', () => {
  assert.equal(volgendeBeschikbareDag('2026-10-05', { nu, werkdagen, capaciteitVan: vrij, reedsGepland: niets }), '2026-10-05');
});

test('volgendeBeschikbareDag: vandaag vol = morgen', () => {
  const reedsGepland = d => (d === '2026-10-05' ? 3 : 0);
  assert.equal(volgendeBeschikbareDag('2026-10-05', { nu, werkdagen, capaciteitVan: vrij, reedsGepland }), '2026-10-06');
});

test('volgendeBeschikbareDag: weekend wordt overgeslagen', () => {
  // vrijdag 9 oktober vol: zaterdag en zondag zijn geen werkdag, dus maandag 12
  const reedsGepland = d => (d === '2026-10-09' ? 3 : 0);
  assert.equal(volgendeBeschikbareDag('2026-10-09', { nu, werkdagen, capaciteitVan: vrij, reedsGepland }), '2026-10-12');
});

test('volgendeBeschikbareDag: geen vrije dag in 60 dagen = null', () => {
  assert.equal(volgendeBeschikbareDag('2026-10-05', { nu, werkdagen, capaciteitVan: niets, reedsGepland: niets }), null);
});

test('volgendeBeschikbareDag: een datum in het verleden wordt overgeslagen', () => {
  assert.equal(volgendeBeschikbareDag('2026-10-01', { nu, werkdagen, capaciteitVan: vrij, reedsGepland: niets }), '2026-10-05');
});

test('volgendeBeschikbareDag: reedsGepland groter dan capaciteit telt als vol', () => {
  const reedsGepland = d => (d === '2026-10-05' ? 5 : 0);
  assert.equal(volgendeBeschikbareDag('2026-10-05', { nu, werkdagen, capaciteitVan: vrij, reedsGepland }), '2026-10-06');
});

// ── capaciteitsKop ──
test('capaciteitsKop: 1/3 stops · ±2.5u', () => {
  assert.deepEqual(capaciteitsKop({ aantal: 1, cap: 3, duurMinuten: 120, travelMin: 30 }), { label: '1/3 stops · ±2.5u', vol: false });
});

test('capaciteitsKop: 3/3 is vol', () => {
  assert.deepEqual(capaciteitsKop({ aantal: 3, cap: 3, duurMinuten: 120, travelMin: 30 }), { label: '3/3 stops · ±7.5u', vol: true });
});

test('capaciteitsKop: 0/0 is vol', () => {
  assert.deepEqual(capaciteitsKop({ aantal: 0, cap: 0, duurMinuten: 120, travelMin: 30 }), { label: '0/0 stops · ±0u', vol: true });
});
