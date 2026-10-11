// tests/feestdagen.test.mjs — kern/feestdagen.js: Belgische wettelijke feestdagen (handberekende cases).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { easterDate, getBelgianHolidays, getHolidayName } from '../public/js/kern/feestdagen.js';

test('easterDate: Pasen 2026 = 5 april, 2025 = 20 april, 2024 = 31 maart', () => {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(iso(easterDate(2026)), '2026-04-05');
  assert.equal(iso(easterDate(2025)), '2025-04-20');
  assert.equal(iso(easterDate(2024)), '2024-03-31');
});

test('getBelgianHolidays(2026): tien feestdagen met de juiste data', () => {
  const h = getBelgianHolidays(2026);
  assert.equal(Object.keys(h).length, 10);
  assert.deepEqual(h, {
    '2026-01-01': 'Nieuwjaar',
    '2026-04-06': 'Paasmaandag',
    '2026-05-01': 'Dag van de Arbeid',
    '2026-05-14': 'Hemelvaartsdag',
    '2026-05-25': 'Pinkstermaandag',
    '2026-07-21': 'Nationale Feestdag',
    '2026-08-15': 'O.L.V. Hemelvaart',
    '2026-11-01': 'Allerheiligen',
    '2026-11-11': 'Wapenstilstand',
    '2026-12-25': 'Kerstmis',
  });
});

test('getHolidayName: feestdag geeft de naam, een gewone dag null', () => {
  assert.equal(getHolidayName('2026-04-06'), 'Paasmaandag');
  assert.equal(getHolidayName('2026-05-14'), 'Hemelvaartsdag');
  assert.equal(getHolidayName('2026-12-25'), 'Kerstmis');
  assert.equal(getHolidayName('2026-10-05'), null);
  assert.equal(getHolidayName('2026-04-05'), null); // Paaszondag zelf is geen aparte feestdag
});

test('getHolidayName: ander jaar en herhaalde aanroep (cache per jaar) geven hetzelfde', () => {
  assert.equal(getHolidayName('2027-03-29'), 'Paasmaandag');
  assert.equal(getHolidayName('2027-03-29'), 'Paasmaandag');
  assert.equal(getHolidayName('2027-03-30'), null);
});
