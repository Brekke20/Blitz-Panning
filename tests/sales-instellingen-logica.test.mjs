import test from 'node:test';
import assert from 'node:assert/strict';
import { formulierWaarden, valideerSalesInstellingen, bouwBewaardObject } from '../public/js/schermen/sales-instellingen-logica.js';
import { SALES_STANDAARD } from '../public/js/schermen/sales-data.js';

// Verzonnen waarden (geen echte adressen van personen).
const invoer = (extra = {}) => ({ startlocatie: '', vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00', bezoekDuurMin: '60', ...extra });

test('formulierWaarden: de standaardinstellingen geven 08:00 / 17:00 / 16:00 / 60 en een leeg startadres', () => {
  assert.deepEqual(formulierWaarden(SALES_STANDAARD), { startlocatie: '', vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00', bezoekDuurMin: 60 });
});

test('formulierWaarden: een bewaard startadres en bewaarde waarden komen mee; onbekende velden niet', () => {
  const w = formulierWaarden({ ...SALES_STANDAARD, startlocatie: 'Dorpsstraat 12, 3640 Kinrooi', vanTijd: '09:00', bezoekDuurMin: 45, kaartStijl: 'donker', werkdagen: [1] });
  assert.deepEqual(w, { startlocatie: 'Dorpsstraat 12, 3640 Kinrooi', vanTijd: '09:00', totTijd: '17:00', laatsteStart: '16:00', bezoekDuurMin: 45 });
});

test('formulierWaarden: zonder instellingen (null) de standaard', () => {
  assert.equal(formulierWaarden(null).vanTijd, '08:00');
  assert.equal(formulierWaarden(undefined).bezoekDuurMin, 60);
});

test('valideerSalesInstellingen: een enkele postcode en een volledig adres zijn toegelaten, getrimd', () => {
  assert.equal(valideerSalesInstellingen(invoer({ startlocatie: '3640' })).waarden.startlocatie, '3640');
  assert.equal(valideerSalesInstellingen(invoer({ startlocatie: '  Dorpsstraat 12, 3640 Kinrooi ' })).waarden.startlocatie, 'Dorpsstraat 12, 3640 Kinrooi');
});

test('valideerSalesInstellingen: een leeg startadres is toegelaten en geeft geen startlocatie', () => {
  const r = valideerSalesInstellingen(invoer({ startlocatie: '   ' }));
  assert.equal(r.fout, undefined);
  assert.equal('startlocatie' in r.waarden, false);
});

test('valideerSalesInstellingen: geldige invoer geeft getallen en tijden terug', () => {
  const r = valideerSalesInstellingen(invoer({ vanTijd: '09:00', totTijd: '16:00', laatsteStart: '15:00', bezoekDuurMin: '45' }));
  assert.deepEqual(r, { waarden: { vanTijd: '09:00', totTijd: '16:00', laatsteStart: '15:00', bezoekDuurMin: 45 } });
});

test('valideerSalesInstellingen: begintijd na of gelijk aan eindtijd wordt geweigerd met de tekst van valideerVelden', () => {
  assert.equal(valideerSalesInstellingen(invoer({ vanTijd: '17:00', totTijd: '08:00' })).fout, '⚠ Begintijd moet voor eindtijd liggen');
  assert.equal(valideerSalesInstellingen(invoer({ vanTijd: '10:00', totTijd: '10:00', laatsteStart: '10:00' })).fout, '⚠ Begintijd moet voor eindtijd liggen');
});

test('valideerSalesInstellingen: laatste start buiten de werkuren wordt geweigerd', () => {
  assert.equal(valideerSalesInstellingen(invoer({ laatsteStart: '18:00' })).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
  assert.equal(valideerSalesInstellingen(invoer({ laatsteStart: '07:00' })).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
});

test('valideerSalesInstellingen: een ongeldig tijdstip (25:00) wordt geweigerd, per veld met de juiste naam', () => {
  assert.equal(valideerSalesInstellingen(invoer({ vanTijd: '25:00' })).fout, '⚠ Begintijd moet een tijdstip zijn (uu:mm)');
  assert.equal(valideerSalesInstellingen(invoer({ totTijd: '25:00' })).fout, '⚠ Eindtijd moet een tijdstip zijn (uu:mm)');
  assert.equal(valideerSalesInstellingen(invoer({ laatsteStart: '25:00' })).fout, '⚠ Laatste start moet een tijdstip zijn (uu:mm)');
});

test('valideerSalesInstellingen: lege werkuren worden geweigerd (anders bleef de oude waarde stilzwijgend staan)', () => {
  assert.equal(valideerSalesInstellingen(invoer({ vanTijd: '' })).fout, '⚠ Begintijd moet een tijdstip zijn (uu:mm)');
  assert.equal(valideerSalesInstellingen(invoer({ totTijd: '' })).fout, '⚠ Eindtijd moet een tijdstip zijn (uu:mm)');
});

test('valideerSalesInstellingen: een lege laatste start is altijd toegelaten (standaard = min(16:00, eindtijd))', () => {
  const r = valideerSalesInstellingen(invoer({ laatsteStart: '' }));
  assert.equal(r.fout, undefined);
  assert.equal('laatsteStart' in r.waarden, false);
  // werkuren die vóór 16:00 eindigen: de standaard laatste start valt dan op de eindtijd, geen weigering
  const vroeg = valideerSalesInstellingen(invoer({ totTijd: '15:00', laatsteStart: '' }));
  assert.equal(vroeg.fout, undefined);
  assert.deepEqual(vroeg.waarden, { vanTijd: '08:00', totTijd: '15:00', bezoekDuurMin: 60 });
  // werkuren die na 16:00 beginnen: ook geen weigering
  assert.equal(valideerSalesInstellingen(invoer({ vanTijd: '17:00', totTijd: '19:00', laatsteStart: '' })).fout, undefined);
  // een expliciete laatste start buiten de werkuren blijft geweigerd
  assert.equal(valideerSalesInstellingen(invoer({ totTijd: '15:00', laatsteStart: '16:00' })).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
});

test('formulierWaarden: zonder bewaarde laatste start is de voorinvulling min(16:00, eindtijd)', () => {
  assert.equal(formulierWaarden({ vanTijd: '08:00', totTijd: '15:00' }).laatsteStart, '15:00');
  assert.equal(formulierWaarden({ vanTijd: '08:00', totTijd: '18:00' }).laatsteStart, '16:00');
  assert.equal(formulierWaarden({ vanTijd: '08:00', totTijd: '15:00', laatsteStart: '14:00' }).laatsteStart, '14:00');
});

test('valideerSalesInstellingen: bezoekduur 4, 481, abc, 12.5 en een negatief getal worden geweigerd', () => {
  const tekst = '⚠ Bezoekduur moet tussen 5 en 480 minuten liggen';
  for (const v of ['4', '481', 'abc', '12.5', '-30', '1e2']) assert.equal(valideerSalesInstellingen(invoer({ bezoekDuurMin: v })).fout, tekst, v);
});

test('valideerSalesInstellingen: bezoekduur op de grenzen 5 en 480 is geldig; leeg is toegelaten (de standaard)', () => {
  assert.equal(valideerSalesInstellingen(invoer({ bezoekDuurMin: '5' })).waarden.bezoekDuurMin, 5);
  assert.equal(valideerSalesInstellingen(invoer({ bezoekDuurMin: '480' })).waarden.bezoekDuurMin, 480);
  const leeg = valideerSalesInstellingen(invoer({ bezoekDuurMin: '' }));
  assert.equal(leeg.fout, undefined);
  assert.equal('bezoekDuurMin' in leeg.waarden, false); // Number('') = 0 mag geen fout "tussen 5 en 480" geven
});

test('valideerSalesInstellingen: een startadres langer dan 200 tekens wordt geweigerd', () => {
  assert.equal(valideerSalesInstellingen(invoer({ startlocatie: 'x'.repeat(201) })).fout, '⚠ Startlocatie is te lang');
  assert.equal(valideerSalesInstellingen(invoer({ startlocatie: 'x'.repeat(200) })).fout, undefined);
});

test('valideerSalesInstellingen: invoer die geen object is geeft een fout', () => {
  assert.ok(valideerSalesInstellingen(null).fout);
});

test('bouwBewaardObject: behoudt onbekende sleutels uit ruw (kaartStijl, werkdagen) en overschrijft de bewerkte velden', () => {
  const ruw = { kaartStijl: 'donker', werkdagen: [1, 2, 3], vanTijd: '08:00', totTijd: '17:00', bezoekDuurMin: 60, maxReistijdMin: 30 };
  const i = invoer({ vanTijd: '09:00', totTijd: '16:00', laatsteStart: '15:00', bezoekDuurMin: '45', startlocatie: '3640' });
  const { waarden } = valideerSalesInstellingen(i);
  assert.deepEqual(bouwBewaardObject(ruw, waarden, i), {
    kaartStijl: 'donker', werkdagen: [1, 2, 3], maxReistijdMin: 30,
    vanTijd: '09:00', totTijd: '16:00', laatsteStart: '15:00', bezoekDuurMin: 45, startlocatie: '3640',
  });
});

test('bouwBewaardObject: verwijdert startlocatie, laatsteStart en bezoekDuurMin als de invoer ze leeg liet', () => {
  const ruw = { startlocatie: 'Oude straat 1, 3500 Hasselt', laatsteStart: '15:30', bezoekDuurMin: 90, kaartStijl: 'licht' };
  const i = invoer({ startlocatie: '  ', laatsteStart: '', bezoekDuurMin: '' });
  const { waarden } = valideerSalesInstellingen(i);
  const uit = bouwBewaardObject(ruw, waarden, i);
  assert.deepEqual(uit, { kaartStijl: 'licht', vanTijd: '08:00', totTijd: '17:00' });
  assert.equal('startlocatie' in uit, false);
});

test('bouwBewaardObject: muteert ruw en waarden niet; ruw null of undefined werkt', () => {
  const ruw = Object.freeze({ kaartStijl: 'donker', startlocatie: 'x' });
  const i = invoer({ startlocatie: '' });
  const { waarden } = valideerSalesInstellingen(i);
  Object.freeze(waarden);
  assert.deepEqual(bouwBewaardObject(ruw, waarden, i).kaartStijl, 'donker');
  assert.equal(bouwBewaardObject(null, waarden, i).vanTijd, '08:00');
  assert.equal(bouwBewaardObject(undefined, waarden, i).totTijd, '17:00');
});
