// tests/eigen.test.mjs — pure "eigen"-regels voor de technieker (netlify/lib/eigen.js)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isEigenNaam, eigenWijzigingen, filterRapportenVoor } from '../netlify/lib/eigen.js';

const tim = { id: 'u-tim', rol: 'technieker', zohoNaam: 'Tim' };
const planner = { id: 'u-p', rol: 'planner' };
const beheerder = { id: 'u-b', rol: 'beheerder' };
const sales = { id: 'u-s', rol: 'sales', salesNaam: 'Tim' };

test('isEigenNaam: technieker vergelijkt genormaliseerd', () => {
  assert.equal(isEigenNaam(tim, 'tim '), true);
  assert.equal(isEigenNaam(tim, 'Tim'), true);
  assert.equal(isEigenNaam({ ...tim, zohoNaam: 'Tim  Van   Dijk' }, ' tim van dijk'), true);
  assert.equal(isEigenNaam(tim, 'Roel'), false);
});

test('isEigenNaam: lege of ontbrekende naam is nooit eigen', () => {
  assert.equal(isEigenNaam(tim, ''), false);
  assert.equal(isEigenNaam(tim, '   '), false);
  assert.equal(isEigenNaam(tim, null), false);
  assert.equal(isEigenNaam(tim, undefined), false);
  assert.equal(isEigenNaam({ ...tim, zohoNaam: '' }, ''), false);
});

test('isEigenNaam: technieker zonder zohoNaam, sales, geen gebruiker', () => {
  assert.equal(isEigenNaam({ rol: 'technieker' }, 'Tim'), false);
  assert.equal(isEigenNaam({ rol: 'technieker' }, ''), false);
  assert.equal(isEigenNaam(sales, 'Tim'), false);
  assert.equal(isEigenNaam(null, 'Tim'), false);
});

test('isEigenNaam: planner en beheerder altijd', () => {
  assert.equal(isEigenNaam(planner, 'Roel'), true);
  assert.equal(isEigenNaam(planner, ''), true);
  assert.equal(isEigenNaam(beheerder, null), true);
});

const eigenaar = a => a.persoon;
const lijst = () => [
  { id: 'a1', titel: 'Tim 1', persoon: 'Tim' },
  { id: 'a2', titel: 'Roel 1', persoon: 'Roel' },
  { id: 'a3', titel: 'Globaal', persoon: null },
];
const opties = { eigenaar, gebruiker: tim };

test('eigenWijzigingen: ongewijzigde lijst is ok', () => {
  assert.deepEqual(eigenWijzigingen(lijst(), lijst(), opties), { ok: true });
});

test('eigenWijzigingen: sleutelvolgorde in een item maakt niets uit', () => {
  const nieuw = lijst();
  nieuw[1] = { persoon: 'Roel', titel: 'Roel 1', id: 'a2' };
  assert.deepEqual(eigenWijzigingen(lijst(), nieuw, opties), { ok: true });
});

test('eigenWijzigingen: eigen item toevoegen, wijzigen en verwijderen is ok', () => {
  const nieuw = lijst();
  nieuw.push({ id: 'a4', titel: 'Tim 2', persoon: 'tim ' });
  assert.deepEqual(eigenWijzigingen(lijst(), nieuw, opties), { ok: true });
  const gewijzigd = lijst(); gewijzigd[0] = { ...gewijzigd[0], titel: 'Anders' };
  assert.deepEqual(eigenWijzigingen(lijst(), gewijzigd, opties), { ok: true });
  assert.deepEqual(eigenWijzigingen(lijst(), lijst().slice(1), opties), { ok: true });
});

test('eigenWijzigingen: collega-item wijzigen geeft een reden', () => {
  const nieuw = lijst(); nieuw[1] = { ...nieuw[1], titel: 'Gekaapt' };
  const r = eigenWijzigingen(lijst(), nieuw, opties);
  assert.equal(r.ok, false);
  assert.equal(typeof r.reden, 'string');
  assert.ok(r.reden.length > 0);
});

test('eigenWijzigingen: collega-item toevoegen of verwijderen geeft een reden', () => {
  const plus = lijst(); plus.push({ id: 'a9', titel: 'Nep', persoon: 'Roel' });
  assert.equal(eigenWijzigingen(lijst(), plus, opties).ok, false);
  assert.equal(eigenWijzigingen(lijst(), lijst().filter(a => a.id !== 'a2'), opties).ok, false);
});

test('eigenWijzigingen: eigen item wijzigen terwijl een collega-item verdwijnt geeft een reden', () => {
  const nieuw = lijst().filter(a => a.id !== 'a2');
  nieuw[0] = { ...nieuw[0], titel: 'Anders' };
  assert.equal(eigenWijzigingen(lijst(), nieuw, opties).ok, false);
});

test('eigenWijzigingen: globaal item (persoon null) wijzigen, toevoegen of verwijderen geeft een reden', () => {
  const wijzig = lijst(); wijzig[2] = { ...wijzig[2], titel: 'X' };
  assert.equal(eigenWijzigingen(lijst(), wijzig, opties).ok, false);
  const plus = lijst(); plus.push({ id: 'a8', titel: 'Blokkade', persoon: null });
  assert.equal(eigenWijzigingen(lijst(), plus, opties).ok, false);
  assert.equal(eigenWijzigingen(lijst(), lijst().slice(0, 2), opties).ok, false);
});

test('eigenWijzigingen: een collega-item naar jezelf of een eigen item naar een collega verplaatsen mag niet', () => {
  const naarMij = lijst(); naarMij[1] = { ...naarMij[1], persoon: 'Tim' };
  assert.equal(eigenWijzigingen(lijst(), naarMij, opties).ok, false);
  const naarHem = lijst(); naarHem[0] = { ...naarHem[0], persoon: 'Roel' };
  assert.equal(eigenWijzigingen(lijst(), naarHem, opties).ok, false);
});

test('eigenWijzigingen: een dubbele id in de nieuwe lijst telt als toevoeging', () => {
  const nieuw = lijst(); nieuw.push({ id: 'a1', titel: 'Dubbel', persoon: 'Roel' });
  assert.equal(eigenWijzigingen(lijst(), nieuw, opties).ok, false);
});

test('eigenWijzigingen: andere sleutel', () => {
  const oud = [{ k: 1, persoon: 'Roel' }];
  assert.equal(eigenWijzigingen(oud, [{ k: 1, persoon: 'Roel' }], { ...opties, sleutel: 'k' }).ok, true);
  assert.equal(eigenWijzigingen(oud, [], { ...opties, sleutel: 'k' }).ok, false);
});

test('eigenWijzigingen: lege lijsten', () => {
  assert.deepEqual(eigenWijzigingen([], [], opties), { ok: true });
  assert.deepEqual(eigenWijzigingen(undefined, [], opties), { ok: true });
});

test('filterRapportenVoor: technieker ziet enkel eigen, anderen alles', () => {
  const r = [{ id: '1', technieker: 'Tim' }, { id: '2', technieker: 'Roel' }, { id: '3', technieker: '' }, { id: '4', technieker: ' tim' }];
  assert.deepEqual(filterRapportenVoor(tim, r).map(x => x.id), ['1', '4']);
  assert.equal(filterRapportenVoor(planner, r).length, 4);
  assert.equal(filterRapportenVoor(beheerder, r).length, 4);
  assert.deepEqual(filterRapportenVoor({ rol: 'technieker' }, r), []);
});
