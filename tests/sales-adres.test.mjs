import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ontleedAdres, adresSoort, adresTekstVoorGeocoding, plaatsLabel } from '../public/js/sales/adres.js';

test('ontleedAdres: enkel postcode', () => {
  assert.deepEqual(ontleedAdres('3640'), { soort: 'postcode', postcode: '3640' });
  assert.deepEqual(ontleedAdres(' 3640 '), { soort: 'postcode', postcode: '3640' });
});

test('ontleedAdres: postcode met gemeente', () => {
  assert.deepEqual(ontleedAdres('3500 Hasselt'), { soort: 'postcode', postcode: '3500', gemeente: 'Hasselt' });
});

test('ontleedAdres: volledig adres', () => {
  assert.deepEqual(ontleedAdres('Dorpsstraat 12, 3640 Kinrooi'),
    { soort: 'adres', straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', gemeente: 'Kinrooi' });
  assert.equal(ontleedAdres('Kerkstraat 5 bus 2, 3500 Hasselt').huisnr, '5 bus 2');
  const fr = ontleedAdres('Rue de Namur 5A, 5000 Namur');
  assert.equal(fr.straat, 'Rue de Namur');
  assert.equal(fr.huisnr, '5A');
  assert.equal(fr.postcode, '5000');
});

test('ontleedAdres: onbruikbare tekst wordt nakijken', () => {
  assert.deepEqual(ontleedAdres('bij de molen'), { soort: 'nakijken', adresTekst: 'bij de molen' });
  assert.deepEqual(ontleedAdres(''), { soort: 'nakijken', adresTekst: '' });
  assert.deepEqual(ontleedAdres(null), { soort: 'nakijken', adresTekst: '' });
  assert.deepEqual(ontleedAdres(undefined), { soort: 'nakijken', adresTekst: '' });
  assert.deepEqual(ontleedAdres('12345'), { soort: 'nakijken', adresTekst: '12345' });
  assert.deepEqual(ontleedAdres('123'), { soort: 'nakijken', adresTekst: '123' });
});

test('adresSoort', () => {
  assert.equal(adresSoort({ postcode: '3640', locatie: { bron: 'postcode' } }), 'postcode');
  assert.equal(adresSoort({ postcode: '3640' }), 'postcode');
  assert.equal(adresSoort({ straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', locatie: { bron: 'adres' } }), 'volledig');
  assert.equal(adresSoort({ adresTekst: 'bij de molen' }), 'nakijken');
  assert.equal(adresSoort({ straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', locatie: { bron: 'postcode' } }), 'nakijken');
  assert.equal(adresSoort({ straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', locatie: null }), 'nakijken');
  assert.equal(adresSoort({}), 'nakijken');
});

test('adresTekstVoorGeocoding', () => {
  assert.equal(adresTekstVoorGeocoding({ straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', gemeente: 'Kinrooi' }), 'Dorpsstraat 12, 3640 Kinrooi');
  assert.equal(adresTekstVoorGeocoding({ straat: 'Dorpsstraat', huisnr: '12', postcode: '3640' }), 'Dorpsstraat 12, 3640');
  assert.equal(adresTekstVoorGeocoding({ postcode: '3640', gemeente: 'Kinrooi' }), null);
  assert.equal(adresTekstVoorGeocoding({ straat: 'Dorpsstraat', postcode: '3640' }), null);
  assert.equal(adresTekstVoorGeocoding({}), null);
});

test('plaatsLabel', () => {
  assert.equal(plaatsLabel({ postcode: '3640', gemeente: 'Kinrooi' }), 'Kinrooi (3640)');
  assert.equal(plaatsLabel({ postcode: '3640' }), '3640');
  assert.equal(plaatsLabel({}), '');
});
