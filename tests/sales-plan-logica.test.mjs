import test from 'node:test';
import assert from 'node:assert/strict';
import { redenTekst, bouwResultaatRegels, weekStartVan } from '../public/js/schermen/sales-plan-logica.js';
import { localISO } from '../public/js/kern/tijd.js';

test('redenTekst: gewone taal per reden van het brein', () => {
  assert.equal(redenTekst('geen-plaats', {}), 'Geen plaats meer deze week');
  assert.equal(redenTekst('klant-geblokkeerd', {}), 'Klant is niet beschikbaar op de vrije dagen');
  assert.equal(redenTekst('voorkeursdag-afstand', {}), 'Voorkeursdag botst qua afstand met een ander bezoek');
  assert.equal(redenTekst('voorkeursdag-vol', {}), 'Voorkeursdag is al vol');
  assert.equal(redenTekst('vast-uur-botst', {}), 'Vast uur botst met een andere afspraak');
  assert.equal(redenTekst('adres-niet-gevonden', {}), 'Adres niet gevonden');
});

test('redenTekst: te-ver noemt de maximale reistijd (standaard 45 min)', () => {
  assert.match(redenTekst('te-ver', {}), /meer dan 45 min/);
  assert.match(redenTekst('te-ver', { maxReistijdMin: 30 }), /meer dan 30 min/);
});

test('redenTekst: onbekende of ontbrekende reden valt terug op geen plaats', () => {
  assert.equal(redenTekst('iets-nieuws', {}), 'Geen plaats meer deze week');
  assert.equal(redenTekst(undefined), 'Geen plaats meer deze week');
});

const lead = (id, naam) => ({ id, voornaam: 'Marie', naam, status: 'te-plannen' });

test('bouwResultaatRegels: geplaatst, niet geplaatst en een reistijd-waarschuwing', () => {
  const leads = [lead('a', 'Janssens'), lead('b', 'Peeters')];
  const overzicht = {
    wijzigingen: [{ id: 'a', velden: { status: 'voorgesteld', planning: { datum: '2026-10-12', start: '09:30', vast: false } } }],
    geplaatst: 1,
    nietGepland: [{ leadId: 'b', reden: 'te-ver' }],
    waarschuwingen: [{ soort: 'reistijd-geschat', ticketIds: ['a', 'b'] }],
  };
  const r = bouwResultaatRegels({ overzicht, leads, opties: { maxReistijdMin: 40 } });
  assert.deepEqual(r.ingepland, [{ naam: 'Marie Janssens', datumLabel: 'ma 12 okt', start: '09:30' }]);
  assert.equal(r.nietIngepland.length, 1);
  assert.equal(r.nietIngepland[0].naam, 'Marie Peeters');
  assert.match(r.nietIngepland[0].tekst, /meer dan 40 min/);
  assert.deepEqual(r.waarschuwingen, ['Reistijd kon niet gecontroleerd worden voor Marie Janssens, Marie Peeters — kijk de route na']);
});

test('bouwResultaatRegels: een lead die terug op te-plannen gezet werd is niet ingepland', () => {
  const leads = [lead('a', 'Janssens')];
  const overzicht = { wijzigingen: [{ id: 'a', velden: { status: 'te-plannen', planning: null } }], geplaatst: 0, nietGepland: [], waarschuwingen: [] };
  const r = bouwResultaatRegels({ overzicht, leads });
  assert.deepEqual(r, { ingepland: [], nietIngepland: [], waarschuwingen: [] });
});

test('bouwResultaatRegels: locatie-onbekend, onbekende waarschuwing en onbekende lead', () => {
  const overzicht = {
    wijzigingen: [], geplaatst: 0,
    nietGepland: [{ leadId: 'weg', reden: 'geen-plaats' }],
    waarschuwingen: [{ soort: 'locatie-onbekend', ticketIds: [] }, { soort: 'iets-anders' }],
  };
  const r = bouwResultaatRegels({ overzicht, leads: [] });
  assert.deepEqual(r.waarschuwingen, ['Locatie van een bestaande afspraak onbekend — reistijdcontrole minder nauwkeurig']);
  assert.deepEqual(r.nietIngepland, [{ naam: 'Onbekende lead', tekst: 'Geen plaats meer deze week' }]);
});

test('bouwResultaatRegels: leeg overzicht', () => {
  assert.deepEqual(bouwResultaatRegels({ overzicht: {}, leads: [] }), { ingepland: [], nietIngepland: [], waarschuwingen: [] });
});

test('weekStartVan: maandag van de week (lokaal)', () => {
  const iso = (d) => localISO(weekStartVan(d));
  assert.equal(iso('2026-10-08'), '2026-10-05');   // donderdag
  assert.equal(iso('2026-10-05'), '2026-10-05');   // maandag zelf
  assert.equal(iso('2026-10-11'), '2026-10-05');   // zondag hoort bij de week ervoor
  assert.equal(iso('2026-11-01'), '2026-10-26');   // maandgrens
  const d = weekStartVan('2026-10-08');
  assert.ok(d instanceof Date);
  assert.equal(d.getHours(), 0);
});

test('bouwResultaatRegels: de reistijd-waarschuwing noemt het bezoek bij naam; bij meer dan drie "+n"', () => {
  const leads = ['a', 'b', 'c', 'd', 'e'].map((id) => lead(id, 'N' + id));
  const maak = (ids) => bouwResultaatRegels({ overzicht: { waarschuwingen: [{ soort: 'reistijd-geschat', ticketIds: ids }] }, leads }).waarschuwingen;
  assert.deepEqual(maak(['c']), ['Reistijd kon niet gecontroleerd worden voor Marie Nc — kijk de route na']);
  assert.deepEqual(maak(['a', 'b', 'c', 'd', 'e']), ['Reistijd kon niet gecontroleerd worden voor Marie Na, Marie Nb, Marie Nc +2 — kijk de route na']);
});
