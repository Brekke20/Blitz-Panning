import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OORZAAK_GROEPEN, OORZAAK_LABELS, OORZAAK_FOUT, oudeWaarden, wisselOorzaak, verwijderOud,
  groepSamenvatting, standaardOpenGroep, valideerOorzaak, schoneLijst,
} from '../public/js/rapport-oorzaak.js';

const groep = id => OORZAAK_GROEPEN.find(g => g.id === id);

test('de lijst heeft 4 groepen en 14 unieke labels in de afgesproken volgorde', () => {
  assert.deepEqual(OORZAAK_GROEPEN.map(g => g.naam), ['Toestel', 'Communicatie en instellingen', 'Plaatsing en omgeving', 'Overig']);
  assert.deepEqual(OORZAAK_LABELS, [
    'Component defect', 'Laadkabel / socket', 'Software / firmware', 'Schade',
    'Verbinding / netwerk', 'OCPP / CPO', 'Configuratie / instellingen', 'Loadbalancing / EMS / sturing', 'RFID / autorisatie',
    'Installatiefout', 'Netaansluiting / stroomvoorziening', 'Gebruikersfout',
    'Geen defect gevonden', 'Andere',
  ]);
  assert.equal(new Set(OORZAAK_LABELS).size, 14);
});

test('oude waarden: Productfout en Configuratiefout zijn onbekend, Installatiefout en Andere niet', () => {
  assert.deepEqual(oudeWaarden(['Productfout', 'Installatiefout', 'Configuratiefout', 'Andere', 'Schade']), ['Productfout', 'Configuratiefout']);
  assert.deepEqual(oudeWaarden(undefined), []);
});

test('wisselen laat oude waarden staan en schrijft niets om', () => {
  const start = ['Productfout', 'Installatiefout'];
  assert.deepEqual(wisselOorzaak(start, 'Schade'), ['Productfout', 'Installatiefout', 'Schade']);
  assert.deepEqual(wisselOorzaak(start, 'Installatiefout'), ['Productfout']);
  assert.deepEqual(start, ['Productfout', 'Installatiefout']);
});

test('een oude waarde verwijderen kan, een waarde uit de lijst blijft staan', () => {
  assert.deepEqual(verwijderOud(['Productfout', 'Schade'], 'Productfout'), ['Schade']);
  assert.deepEqual(verwijderOud(['Productfout', 'Schade'], 'Schade'), ['Productfout', 'Schade']);
});

test('samenvatting per groep telt enkel de gekozen labels van die groep', () => {
  const gekozen = ['Schade', 'Component defect', 'Andere', 'Productfout'];
  assert.deepEqual(groepSamenvatting(gekozen, groep('toestel')), { aantal: 2, tekst: '2 gekozen', labels: 'Component defect, Schade' });
  assert.deepEqual(groepSamenvatting(gekozen, groep('communicatie')), { aantal: 0, tekst: '', labels: '' });
});

test('standaard open groep: de eerste met een keuze, anders de eerste', () => {
  assert.equal(standaardOpenGroep([]), 'toestel');
  assert.equal(standaardOpenGroep(['Productfout']), 'toestel');
  assert.equal(standaardOpenGroep(['Gebruikersfout', 'Andere']), 'plaatsing');
});

test('validatie: minstens één oorzaak; een oude waarde telt mee', () => {
  assert.equal(valideerOorzaak([]), OORZAAK_FOUT);
  assert.equal(valideerOorzaak(undefined), OORZAAK_FOUT);
  assert.equal(valideerOorzaak(['Productfout']), undefined);
  assert.equal(valideerOorzaak(['Schade']), undefined);
});

test('schoneLijst gooit rommel weg', () => {
  assert.deepEqual(schoneLijst(['a', '', 3, null, 'b']), ['a', 'b']);
  assert.deepEqual(schoneLijst('kapot'), []);
});
