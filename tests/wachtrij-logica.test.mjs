process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wqNorm, wqZoekTekst, zoekWoorden, filterOpZoek, isOverdue, urgencyFactor, queueScore, sorteerWachtrij,
} from '../public/js/schermen/wachtrij-logica.js';

const nu = new Date(2026, 9, 5, 10, 0); // maandag 5 oktober 2026
const vandaag = '2026-10-05';
const nrs = lijst => lijst.map(t => t.id);

test('wqNorm: accenten weg, kleine letters, null wordt leeg', () => {
  assert.equal(wqNorm('Élan Ünïcode'), 'elan unicode');
  assert.equal(wqNorm(null), '');
  assert.equal(wqNorm(undefined), '');
  assert.equal(wqNorm(42), '42');
});

test('zoekWoorden: genormaliseerd, gesplitst op witruimte, leidende # weg, lege woorden weg', () => {
  assert.deepEqual(zoekWoorden('  #1234   Élan  '), ['1234', 'elan']);
  assert.deepEqual(zoekWoorden('##12 #'), ['12']);
  assert.deepEqual(zoekWoorden(''), []);
  assert.deepEqual(zoekWoorden(null), []);
});

test('wqZoekTekst: voegt de velden samen en normaliseert', () => {
  const t = { number: '1234', subject: 'Laadpaal Élan', account: 'ACME', assignee: 'Tim' };
  const h = wqZoekTekst(t);
  assert.ok(h.includes('1234') && h.includes('laadpaal elan') && h.includes('acme') && h.includes('tim'));
});

// ── filterOpZoek ──
const zoekTickets = [
  { id: 1, number: '1001', subject: 'Laadpaal Élan defect', account: 'ACME', regio: 'Gent' },
  { id: 2, number: '1002', subject: 'Installatie', account: 'Bouwbedrijf Jansen', regio: 'Antwerpen' },
  { id: 3, number: '1003', subject: 'Laadpaal storing', account: 'ACME', regio: 'Antwerpen' },
];

test('filterOpZoek: leeg zoekveld geeft de invoer terug', () => {
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, '')), [1, 2, 3]);
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, '   ')), [1, 2, 3]);
});

test('filterOpZoek: accent- en hoofdletterongevoelig', () => {
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, 'ELAN')), [1]);
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, 'élan')), [1]);
});

test('filterOpZoek: leidende # wordt genegeerd', () => {
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, '#1002')), [2]);
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, '##1003')), [3]);
});

test('filterOpZoek: een losse # zonder woord telt niet mee', () => {
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, '# acme')), [1, 3]);
});

test('filterOpZoek: meerdere woorden moeten allemaal voorkomen', () => {
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, 'acme antwerpen')), [3]);
  assert.deepEqual(nrs(filterOpZoek(zoekTickets, 'acme gent storing')), []);
});

test('filterOpZoek: muteert de invoer niet', () => {
  const kopie = [...zoekTickets];
  filterOpZoek(zoekTickets, 'acme');
  assert.deepEqual(zoekTickets, kopie);
});

// ── isOverdue ──
test('isOverdue: gisteren verlopen, vandaag en later niet, zonder datum niet', () => {
  assert.ok(isOverdue({ interventieDatum: '2026-10-04T10:00:00' }, vandaag));
  assert.ok(!isOverdue({ interventieDatum: '2026-10-05T10:00:00' }, vandaag));
  assert.ok(!isOverdue({ interventieDatum: '2026-10-06T10:00:00' }, vandaag));
  assert.ok(!isOverdue({}, vandaag));
  assert.ok(!isOverdue({ interventieDatum: null }, vandaag));
});

// ── urgencyFactor en queueScore ──
test('urgencyFactor: geen datum = 1; vandaag of verleden = 0,1; 1 dag = 1/7; 7+ dagen = 1', () => {
  assert.equal(urgencyFactor({}, nu), 1);
  assert.equal(urgencyFactor({ interventieDatum: '2026-10-05T09:00:00' }, nu), 0.1);
  assert.equal(urgencyFactor({ interventieDatum: '2026-10-01T09:00:00' }, nu), 0.1);
  assert.ok(Math.abs(urgencyFactor({ interventieDatum: '2026-10-06T09:00:00' }, nu) - 1 / 7) < 1e-12);
  assert.equal(urgencyFactor({ interventieDatum: '2026-10-12T09:00:00' }, nu), 1);
  assert.equal(urgencyFactor({ interventieDatum: '2026-11-30T09:00:00' }, nu), 1);
});

test('queueScore: high met datum over 7+ dagen = 1; low zonder datum = 6; onbekende prio = 9 x factor', () => {
  assert.equal(queueScore({ priority: 'High', interventieDatum: '2026-10-20T09:00:00' }, nu), 1);
  assert.equal(queueScore({ priority: 'low' }, nu), 6);
  assert.equal(queueScore({ priority: 'medium' }, nu), 3);
  assert.equal(queueScore({ priority: 'onbekend' }, nu), 9);
  assert.equal(queueScore({}, nu), 9);
  assert.equal(queueScore({ priority: 'zeldzaam', interventieDatum: '2026-10-05T09:00:00' }, nu), 9 * 0.1);
});

// ── sorteerWachtrij ──
const inv = { vandaag, nu };

test('sorteerWachtrij standaard: verlopen eerst, dan op score oplopend', () => {
  const lijst = [
    { id: 'laag', priority: 'low' },                                            // 6
    { id: 'hoog', priority: 'high' },                                           // 1
    { id: 'verlopen-laag', priority: 'low', interventieDatum: '2026-10-01T09:00:00' }, // verlopen
    { id: 'midden', priority: 'medium' },                                       // 3
  ];
  assert.deepEqual(nrs(sorteerWachtrij(lijst, 'standaard', inv)), ['verlopen-laag', 'hoog', 'midden', 'laag']);
});

test('sorteerWachtrij standaard: stabiel bij gelijke score', () => {
  const lijst = [{ id: 'a', priority: 'high' }, { id: 'b', priority: 'high' }, { id: 'c', priority: 'high' }];
  assert.deepEqual(nrs(sorteerWachtrij(lijst, 'standaard', inv)), ['a', 'b', 'c']);
});

test('sorteerWachtrij: onbekende modus valt terug op standaard', () => {
  const lijst = [{ id: 'laag', priority: 'low' }, { id: 'hoog', priority: 'high' }];
  assert.deepEqual(nrs(sorteerWachtrij(lijst, 'onzin', inv)), ['hoog', 'laag']);
});

test('sorteerWachtrij oudst en nieuwst: op createdTime, ontbrekende of ongeldige datum achteraan', () => {
  const lijst = [
    { id: 'zonder' },
    { id: 'nieuw', createdTime: '2026-10-03T10:00:00' },
    { id: 'ongeldig', createdTime: 'geen datum' },
    { id: 'oud', createdTime: '2026-09-01T10:00:00' },
  ];
  assert.deepEqual(nrs(sorteerWachtrij(lijst, 'oudst', inv)), ['oud', 'nieuw', 'zonder', 'ongeldig']);
  assert.deepEqual(nrs(sorteerWachtrij(lijst, 'nieuwst', inv)), ['nieuw', 'oud', 'zonder', 'ongeldig']);
});

test('sorteerWachtrij interventie: vroegste eerst, null achteraan', () => {
  const lijst = [
    { id: 'zonder' },
    { id: 'laat', interventieDatum: '2026-11-01T10:00:00' },
    { id: 'vroeg', interventieDatum: '2026-10-06T10:00:00' },
  ];
  assert.deepEqual(nrs(sorteerWachtrij(lijst, 'interventie', inv)), ['vroeg', 'laat', 'zonder']);
});

test('sorteerWachtrij: muteert de invoer niet en geeft een nieuwe array', () => {
  const lijst = [{ id: 'laag', priority: 'low' }, { id: 'hoog', priority: 'high' }];
  const kopie = [...lijst];
  const r = sorteerWachtrij(lijst, 'standaard', inv);
  assert.notEqual(r, lijst);
  assert.deepEqual(lijst, kopie);
});
