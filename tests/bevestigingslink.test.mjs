import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CONFIRM_LINK_SECRET = 'test-geheim';
const { tekenLink, maakBevestigingsUrl, controleerLink, datumInBrussel } =
  await import('../netlify/lib/bevestigingslink.js');

const nu = () => Math.floor(Date.now() / 1000);
const toekomst = () => nu() + 3600;

test('nieuw formaat geldig', () => {
  const exp = toekomst();
  const sig = tekenLink('123', '2026-10-14', exp, 'installateur');
  assert.deepEqual(
    controleerLink({ ticketId: '123', date: '2026-10-14', exp: String(exp), d: 'installateur', sig }),
    { geldig: true, doelgroep: 'installateur' });
});

test('oud formaat geldig', () => {
  const exp = toekomst();
  const sig = tekenLink('123', '2026-10-14', exp);
  assert.deepEqual(
    controleerLink({ ticketId: '123', date: '2026-10-14', exp: String(exp), sig }),
    { geldig: true, doelgroep: null });
});

test('d gewijzigd na ondertekenen', () => {
  const exp = toekomst();
  const sig = tekenLink('123', '2026-10-14', exp, 'klant');
  assert.equal(
    controleerLink({ ticketId: '123', date: '2026-10-14', exp: String(exp), d: 'installateur', sig }).geldig,
    false);
});

test('d toegevoegd aan oude link is ongeldig', () => {
  const exp = toekomst();
  const sig = tekenLink('123', '2026-10-14', exp);
  assert.equal(
    controleerLink({ ticketId: '123', date: '2026-10-14', exp: String(exp), d: 'klant', sig }).geldig,
    false);
});

test('onbekende doelgroep', () => {
  const exp = toekomst();
  const sig = tekenLink('123', '2026-10-14', exp, 'baas');
  assert.equal(
    controleerLink({ ticketId: '123', date: '2026-10-14', exp: String(exp), d: 'baas', sig }).geldig,
    false);
});

test('verlopen', () => {
  const exp = nu() - 10;
  const sig = tekenLink('123', '2026-10-14', exp, 'klant');
  assert.equal(
    controleerLink({ ticketId: '123', date: '2026-10-14', exp: String(exp), d: 'klant', sig }).geldig,
    false);
});

test('niet-numeriek ticketId', () => {
  const exp = toekomst();
  const sig = tekenLink('12a', '2026-10-14', exp, 'klant');
  assert.equal(
    controleerLink({ ticketId: '12a', date: '2026-10-14', exp: String(exp), d: 'klant', sig }).geldig,
    false);
});

test('ontbrekende velden', () => {
  assert.equal(controleerLink({ ticketId: '123', date: '', exp: '1', sig: 'x' }).geldig, false);
});

test('datumInBrussel', () => {
  assert.equal(datumInBrussel('2026-10-13T22:30:00.000Z'), '2026-10-14');
  assert.equal(datumInBrussel('2026-07-01T21:59:00.000Z'), '2026-07-01');
  assert.equal(datumInBrussel(''), null);
  assert.equal(datumInBrussel('onzin'), null);
});

test('maakBevestigingsUrl', () => {
  const exp = toekomst();
  const url = maakBevestigingsUrl({
    basis: 'https://x.test', ticketId: '123', date: '2026-10-14', exp, doelgroep: 'klant' });
  assert.ok(url.startsWith('https://x.test/api/confirm-afspraak?ticketId=123&date=2026-10-14'));
  assert.ok(url.includes('&d=klant&sig='));
  const sig = new URL(url).searchParams.get('sig');
  assert.equal(sig, tekenLink('123', '2026-10-14', exp, 'klant'));
});
