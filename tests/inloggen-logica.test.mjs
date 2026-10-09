process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  valideerInlog, valideerNieuwWachtwoord, valideerSetup, valideerHerstel, loginFoutTekst, formatHerstelcodes,
} from '../public/js/schermen/inloggen-logica.js';

const wachtwoord = (n) => 'a'.repeat(n);

test('valideerInlog: e-mail moet een @ bevatten en wachtwoord mag niet leeg zijn', () => {
  assert.ok(valideerInlog({ email: 'a', wachtwoord: 'x' }).fout);
  assert.ok(valideerInlog({ email: '', wachtwoord: 'x' }).fout);
  assert.ok(valideerInlog({ email: 'a@b.be', wachtwoord: '' }).fout);
  assert.ok(valideerInlog({}).fout);
  assert.deepEqual(valideerInlog({ email: '  a@b.be ', wachtwoord: 'x' }), { waarden: { email: 'a@b.be', wachtwoord: 'x' } });
});

test('valideerInlog: het wachtwoord wordt niet getrimd', () => {
  assert.equal(valideerInlog({ email: 'a@b.be', wachtwoord: ' x ' }).waarden.wachtwoord, ' x ');
});

test('valideerNieuwWachtwoord: lengte 10..200, anders dan huidig, herhaling gelijk', () => {
  const basis = { huidig: 'oud-wachtwoord', nieuw: wachtwoord(10), herhaal: wachtwoord(10) };
  assert.ok(valideerNieuwWachtwoord({ ...basis, nieuw: wachtwoord(9), herhaal: wachtwoord(9) }).fout);
  assert.ok(valideerNieuwWachtwoord({ ...basis, nieuw: wachtwoord(201), herhaal: wachtwoord(201) }).fout);
  assert.ok(valideerNieuwWachtwoord({ huidig: wachtwoord(12), nieuw: wachtwoord(12), herhaal: wachtwoord(12) }).fout);
  assert.ok(valideerNieuwWachtwoord({ ...basis, herhaal: wachtwoord(11) }).fout);
  assert.ok(valideerNieuwWachtwoord({ ...basis, huidig: '' }).fout);
  assert.ok(valideerNieuwWachtwoord({ ...basis, nieuw: ' '.repeat(10), herhaal: ' '.repeat(10) }).fout);
  assert.deepEqual(valideerNieuwWachtwoord(basis), { waarden: { huidig: 'oud-wachtwoord', nieuw: wachtwoord(10) } });
  assert.ok(valideerNieuwWachtwoord({ ...basis, nieuw: wachtwoord(200), herhaal: wachtwoord(200) }).waarden);
});

test('valideerSetup: alle velden verplicht, e-mail met @, wachtwoord 10..200 en gelijke herhaling', () => {
  const goed = { setupCode: 'code', email: 'b@x.be', naam: 'Brent', wachtwoord: wachtwoord(10), herhaal: wachtwoord(10) };
  assert.deepEqual(valideerSetup(goed), { waarden: { setupCode: 'code', email: 'b@x.be', naam: 'Brent', wachtwoord: wachtwoord(10) } });
  assert.ok(valideerSetup({ ...goed, setupCode: '' }).fout);
  assert.ok(valideerSetup({ ...goed, email: 'b' }).fout);
  assert.ok(valideerSetup({ ...goed, naam: '  ' }).fout);
  assert.ok(valideerSetup({ ...goed, wachtwoord: wachtwoord(9), herhaal: wachtwoord(9) }).fout);
  assert.ok(valideerSetup({ ...goed, wachtwoord: wachtwoord(201), herhaal: wachtwoord(201) }).fout);
  assert.ok(valideerSetup({ ...goed, herhaal: wachtwoord(11) }).fout);
});

test('valideerHerstel: e-mail, bewijs, nieuw wachtwoord 10..200 en gelijke herhaling', () => {
  const goed = { email: ' B@x.be ', bewijs: ' ABCD-EFGH ', nieuw: wachtwoord(10), herhaal: wachtwoord(10) };
  assert.deepEqual(valideerHerstel(goed), { waarden: { email: 'B@x.be', bewijs: 'ABCD-EFGH', nieuwWachtwoord: wachtwoord(10) } });
  assert.ok(valideerHerstel({ ...goed, email: 'zonder-apenstaart' }).fout);
  assert.ok(valideerHerstel({ ...goed, bewijs: '   ' }).fout);
  assert.ok(valideerHerstel({ ...goed, bewijs: '' }).fout);
  assert.ok(valideerHerstel({ ...goed, nieuw: wachtwoord(9), herhaal: wachtwoord(9) }).fout);
  assert.ok(valideerHerstel({ ...goed, nieuw: wachtwoord(201), herhaal: wachtwoord(201) }).fout);
  assert.ok(valideerHerstel({ ...goed, herhaal: wachtwoord(11) }).fout);
});

test('loginFoutTekst: 401 is generiek en exact', () => {
  assert.equal(loginFoutTekst(401), 'Onjuist e-mailadres of wachtwoord');
  assert.equal(loginFoutTekst(401, { error: 'Onbekend adres bestaat niet' }), 'Onjuist e-mailadres of wachtwoord');
});

test('loginFoutTekst: 429 toont het tijdstip in Brusselse tijd', () => {
  assert.equal(loginFoutTekst(429, { opnieuwOp: '2026-10-08T14:30:00.000Z' }), 'Te veel pogingen. Probeer opnieuw om 16:30.');
  assert.equal(loginFoutTekst(429, { opnieuwOp: '2026-01-08T14:05:00.000Z' }), 'Te veel pogingen. Probeer opnieuw om 15:05.');
  assert.match(loginFoutTekst(429, {}), /^Te veel pogingen\./);
  assert.match(loginFoutTekst(429, { opnieuwOp: 'onzin' }), /^Te veel pogingen\./);
});

test('loginFoutTekst: overige statussen', () => {
  assert.equal(loginFoutTekst(500), 'Inloggen mislukt');
  assert.equal(loginFoutTekst(undefined), 'Inloggen mislukt');
});

test('formatHerstelcodes: 10 regels, elke code zichtbaar', () => {
  const codes = Array.from({ length: 10 }, (_, i) => `ABC${i}-DEF${i}`);
  const regels = formatHerstelcodes(codes).split('\n');
  assert.equal(regels.length, 10);
  codes.forEach((c, i) => assert.ok(regels[i].includes(c)));
  assert.equal(formatHerstelcodes(undefined), '');
});
