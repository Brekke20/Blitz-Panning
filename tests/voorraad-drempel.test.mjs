// tests/voorraad-drempel.test.mjs — meldgrens van de wagenvoorraad (public/js/kern/voorraad-drempel.js)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { voorraadRegel, voorraadStatus, lageItems, meldTekst, startTekst, bijnaOpTekst, naRapportTekst } from '../public/js/kern/voorraad-drempel.js';

test('voorraadRegel: zelfde migratie als de server', () => {
  assert.deepEqual(voorraadRegel(undefined), { aantal: 0, gedempt: true, drempel: null });
  assert.deepEqual(voorraadRegel(3), { aantal: 3, gedempt: false, drempel: 0 });
  assert.deepEqual(voorraadRegel({ aantal: 0, gedempt: false }), { aantal: 0, gedempt: false, drempel: 0 });
  assert.deepEqual(voorraadRegel({ aantal: 2, gedempt: true }), { aantal: 2, gedempt: true, drempel: null });
  assert.deepEqual(voorraadRegel({ aantal: 2, gedempt: false, drempel: 2 }), { aantal: 2, gedempt: false, drempel: 2 });
  assert.deepEqual(voorraadRegel({ aantal: 2, gedempt: false, drempel: null }), { aantal: 2, gedempt: true, drempel: null });
});

test('voorraadStatus', () => {
  assert.equal(voorraadStatus({ aantal: 0, drempel: null }), 'uit');
  assert.equal(voorraadStatus({ aantal: 0, drempel: 0 }), 'op');
  assert.equal(voorraadStatus({ aantal: 0, drempel: 2 }), 'op');
  assert.equal(voorraadStatus({ aantal: 1, drempel: 0 }), 'ok');
  assert.equal(voorraadStatus({ aantal: 2, drempel: 2 }), 'bijna');
  assert.equal(voorraadStatus({ aantal: 3, drempel: 2 }), 'ok');
});

const CAT = [{ id: 'a', naam: 'Zekering' }, { id: 'b', naam: 'Energiemeter' }, { id: 'c', naam: 'Kabel' }, { id: 'd', naam: 'Nooit' }];

test('lageItems: op eerst, dan bijna; zonder regel of gedempt niets; filter op ids', () => {
  const stock = { a: { aantal: 1, gedempt: false, drempel: 1 }, b: { aantal: 1, gedempt: false, drempel: 2 }, c: { aantal: 0, gedempt: false } };
  assert.deepEqual(lageItems(stock, CAT).map(i => [i.id, i.status]), [['c', 'op'], ['b', 'bijna'], ['a', 'bijna']]);
  assert.deepEqual(lageItems(stock, CAT, ['b', 'd']).map(i => i.id), ['b']);
  assert.deepEqual(lageItems({}, CAT), []);
  assert.deepEqual(lageItems(undefined, CAT), []);
});

test('meldTekst en startTekst', () => {
  const i = (naam, status, aantal = 0) => ({ naam, status, aantal });
  assert.equal(meldTekst([i('Meter', 'bijna', 1)]), 'Meter (nog 1)');
  assert.equal(meldTekst([i('Kabel', 'op'), i('Meter', 'bijna', 1)]), 'Kabel (op) en Meter (nog 1)');
  assert.equal(meldTekst([i('A', 'op'), i('B', 'op'), i('C', 'op'), i('D', 'op')]), 'A (op), B (op), C (op) en 1 ander');
  assert.equal(startTekst([]), null);
  assert.equal(startTekst([i('A', 'bijna', 1)]), '⚠ Check je voorraad: 1 product bijna op');
  assert.equal(startTekst([i('A', 'op'), i('B', 'op')]), '⚠ Check je voorraad: 2 producten op');
  assert.equal(startTekst([i('A', 'op'), i('B', 'bijna', 1)]), '⚠ Check je voorraad: 2 producten bijna op of op');
});

test('na een rapport: eigen melding of toegevoegd aan de rapportmelding', () => {
  const laag = [{ naam: 'Energiemeter - Eastron SDM54-M', status: 'bijna', aantal: 1 }];
  assert.equal(bijnaOpTekst([]), null);
  assert.equal(bijnaOpTekst(laag), '⚠ Bijna op in je wagen: Energiemeter - Eastron SDM54-M (nog 1)');
  assert.equal(naRapportTekst('✓ Rapport verstuurd', []), '✓ Rapport verstuurd');
  assert.equal(naRapportTekst('✓ Rapport verstuurd', laag), '✓ Rapport verstuurd · ⚠ Bijna op in je wagen: Energiemeter - Eastron SDM54-M (nog 1)');
});
