import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CONFIRM_LINK_SECRET = 'test-geheim';
const { tekenLink, maakBevestigingsUrl, controleerLink, datumInBrussel, bevestigingsNotitie } =
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

test('datumInBrussel zomer en DST-overgangen', () => {
  assert.equal(datumInBrussel('2026-07-01T22:00:00.000Z'), '2026-07-02');
  assert.equal(datumInBrussel('2026-03-28T23:30:00.000Z'), '2026-03-29'); // winter (+1)
  assert.equal(datumInBrussel('2026-03-29T22:30:00.000Z'), '2026-03-30'); // zomer (+2)
});

test('regressie oud formaat: vaste hex-handtekening', () => {
  assert.equal(tekenLink('123', '2026-10-14', 9999999999), 'cc7e43fcb7c1533621c7d5c5801a59b06f8a53adc2cf82f7fdab2c7a0b1569ce');
});

test('bevestigingsNotitie met doelgroep en email', () => {
  assert.equal(
    bevestigingsNotitie({ date: '2026-10-14', doelgroep: 'klant', email: 'a@b.be', tijdstip: '1/10/2026 10:00', ip: '1.2.3.4' }),
    'Afspraak bevestigd voor 2026-10-14 door klant (a@b.be) via bevestigingslink op 1/10/2026 10:00 (Europe/Brussels). IP-adres: 1.2.3.4.');
});

test('bevestigingsNotitie zonder email', () => {
  assert.equal(
    bevestigingsNotitie({ date: '2026-10-14', doelgroep: 'installateur', email: '', tijdstip: 'T', ip: 'onbekend' }),
    'Afspraak bevestigd voor 2026-10-14 door installateur via bevestigingslink op T (Europe/Brussels). IP-adres: onbekend.');
});

test('bevestigingsNotitie oude link', () => {
  assert.equal(
    bevestigingsNotitie({ date: '2026-10-14', doelgroep: null, email: 'a@b.be', tijdstip: 'T', ip: 'x' }),
    'Afspraak bevestigd voor 2026-10-14 door onbekende ontvanger (oude link) via bevestigingslink op T (Europe/Brussels). IP-adres: x.');
});

test('bevestigingsNotitie escapet vrije velden', () => {
  const n = bevestigingsNotitie({ date: '2026-10-14', doelgroep: 'klant', email: '<b>x</b>@b.be', tijdstip: 'T', ip: '<i>' });
  assert.ok(!n.includes('<b>') && !n.includes('<i>'));
  assert.match(n, /&lt;b&gt;x&lt;\/b&gt;@b\.be/);
});
