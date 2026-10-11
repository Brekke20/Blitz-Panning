import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LEADS, MAX_BYTES, normaliseerEmail, normaliseerGsm, zelfdeNaam, leesExport } from '../public/js/sales/import.js';

const voorbeeld = () => ({
  geexporteerdOp: '2026-10-08T10:24:18.039Z',
  verantwoordelijke: 'Test Verkoper',
  statussen: ['Nieuw', '1e contactpoging gedaan'],
  aantal: 3,
  leads: [
    { naam: 'Janssens', voornaam: 'Marie', gsm: '+32 470 12 34 56', email: 'marie@voorbeeld.test', adres: '3640' },
    { naam: 'Peeters', voornaam: 'Tom', gsm: '0478 12 34 56', email: 'tom@voorbeeld.test', adres: 'Dorpsstraat 5, 2830 Willebroek' },
    { naam: 'Claes', voornaam: 'An', gsm: '+32000000', email: 'An.Claes@Voorbeeld.TEST', adres: 'bij de molen' },
  ],
});

test('constanten', () => {
  assert.equal(MAX_LEADS, 500);
  assert.equal(MAX_BYTES, 2 * 1024 * 1024);
});

test('normaliseerGsm', () => {
  assert.equal(normaliseerGsm('+32 478 12 34 56'), '32478123456');
  assert.equal(normaliseerGsm('0478/12.34.56'), '32478123456');
  assert.equal(normaliseerGsm('0032478123456'), '32478123456');
  assert.equal(normaliseerGsm('+32 (0)478 12 34 56'), '32478123456');
  assert.equal(normaliseerGsm('+32000000'), null);
  assert.equal(normaliseerGsm('0000000000'), null);
  assert.equal(normaliseerGsm(''), null);
  assert.equal(normaliseerGsm(null), null);
  assert.equal(normaliseerGsm(undefined), null);
});

test('normaliseerEmail', () => {
  assert.equal(normaliseerEmail(' Marie@Voorbeeld.BE '), 'marie@voorbeeld.be');
  assert.equal(normaliseerEmail('geen-mail'), null);
  assert.equal(normaliseerEmail(''), null);
  assert.equal(normaliseerEmail(null), null);
});

test('zelfdeNaam', () => {
  assert.equal(zelfdeNaam('Janssens', ' janssens '), true);
  assert.equal(zelfdeNaam('Van Den Berg', 'van den  berg'), true);
  assert.equal(zelfdeNaam('Janssens', 'Peeters'), false);
  assert.equal(zelfdeNaam(null, null), false);
  assert.equal(zelfdeNaam('', null), false);
});

test('leesExport: voorbeeldformaat (object en JSON-string)', () => {
  for (const invoer of [voorbeeld(), JSON.stringify(voorbeeld())]) {
    const r = leesExport(invoer);
    assert.equal(r.ok, true);
    assert.equal(r.verantwoordelijke, 'Test Verkoper');
    assert.equal(r.geexporteerdOp, '2026-10-08T10:24:18.039Z');
    assert.deepEqual(r.statussen, ['Nieuw', '1e contactpoging gedaan']);
    assert.equal(r.aantal, 3);
    assert.equal(r.overgeslagen, 0);
    assert.equal(r.leads.length, 3);
  }
});

test('leesExport: leads krijgen genormaliseerde velden', () => {
  const [a, b, c] = leesExport(voorbeeld()).leads;
  assert.deepEqual(a, { voornaam: 'Marie', naam: 'Janssens', gsm: '+32 470 12 34 56', email: 'marie@voorbeeld.test',
    postcode: '3640', gemeente: null, straat: null, huisnr: null, adresTekst: null });
  assert.deepEqual(b, { voornaam: 'Tom', naam: 'Peeters', gsm: '0478 12 34 56', email: 'tom@voorbeeld.test',
    postcode: '2830', gemeente: 'Willebroek', straat: 'Dorpsstraat', huisnr: '5', adresTekst: null });
  assert.equal(c.email, 'an.claes@voorbeeld.test');
  assert.equal(c.gsm, '+32000000');
  assert.equal(c.adresTekst, 'bij de molen');
  assert.equal(c.postcode, null);
});

test('leesExport: ontbrekend adres geeft null-velden', () => {
  const r = leesExport({ leads: [{ naam: 'Janssens' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.leads[0], { voornaam: null, naam: 'Janssens', gsm: null, email: null,
    postcode: null, gemeente: null, straat: null, huisnr: null, adresTekst: null });
  assert.equal(r.verantwoordelijke, null);
  assert.equal(r.geexporteerdOp, null);
  assert.deepEqual(r.statussen, []);
  assert.equal(r.aantal, null);
});

test('leesExport: foutmeldingen', () => {
  assert.deepEqual(leesExport('geen json {'), { ok: false, fout: 'Het bestand is geen geldige JSON' });
  assert.deepEqual(leesExport({ leads: 'nee' }), { ok: false, fout: 'Geen geldige export: "leads" ontbreekt' });
  assert.deepEqual(leesExport({}), { ok: false, fout: 'Geen geldige export: "leads" ontbreekt' });
  assert.deepEqual(leesExport('5'), { ok: false, fout: 'Geen geldige export: "leads" ontbreekt' });
  assert.deepEqual(leesExport('null'), { ok: false, fout: 'Geen geldige export: "leads" ontbreekt' });
  const veel = { leads: Array.from({ length: 501 }, (_, i) => ({ naam: 'N' + i })) };
  assert.deepEqual(leesExport(veel), { ok: false, fout: 'Maximaal 500 leads per bestand' });
  const genoeg = { leads: Array.from({ length: 500 }, (_, i) => ({ naam: 'N' + i })) };
  assert.equal(leesExport(genoeg).ok, true);
  const groot = JSON.stringify({ leads: [{ naam: 'x'.repeat(2 * 1024 * 1024) }] });
  assert.deepEqual(leesExport(groot), { ok: false, fout: 'Het bestand is groter dan 2 MB' });
});

test('leesExport: groottecontrole telt bytes, niet tekens', () => {
  const tekst = '€'.repeat(Math.floor(MAX_BYTES / 3) + 10); // 3 bytes per teken, minder dan 2M tekens
  assert.ok(tekst.length < MAX_BYTES);
  assert.deepEqual(leesExport(tekst), { ok: false, fout: 'Het bestand is groter dan 2 MB' });
});

test('leesExport: onbruikbare leads tellen als overgeslagen', () => {
  const r = leesExport({ leads: [
    null, 'tekst', 42, [], {}, { adres: '3640' }, { naam: '  ', voornaam: '', gsm: null, email: '' },
    { naam: 'Janssens' }, { gsm: '0478123456' },
  ] });
  assert.equal(r.ok, true);
  assert.equal(r.overgeslagen, 7);
  assert.equal(r.leads.length, 2);
});

test('leesExport: lege leads-lijst is geldig', () => {
  const r = leesExport({ leads: [] });
  assert.equal(r.ok, true);
  assert.equal(r.leads.length, 0);
  assert.equal(r.overgeslagen, 0);
});

test('leesExport: velden worden op 200 tekens afgekapt', () => {
  const r = leesExport({ leads: [{ naam: 'x'.repeat(500), adres: 'y'.repeat(500) }] });
  assert.equal(r.leads[0].naam.length, 200);
  assert.equal(r.leads[0].adresTekst.length, 200);
});

test('leesExport: HTML blijft letterlijke tekst', () => {
  const r = leesExport({ leads: [{ naam: '<img src=x onerror=alert(1)>' }] });
  assert.equal(r.leads[0].naam, '<img src=x onerror=alert(1)>');
});

test('leesExport: de invoer wordt niet gewijzigd', () => {
  const invoer = voorbeeld();
  const kopie = structuredClone(invoer);
  leesExport(invoer);
  assert.deepEqual(invoer, kopie);
});
