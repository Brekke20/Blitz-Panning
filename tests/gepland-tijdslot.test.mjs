process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geplandTijdslotVoor, rapportTicketVelden, tijdslotVoor } from '../public/js/schermen/ticketdetail-logica.js';
import { stripZwareVelden } from '../netlify/lib/rapportlijst.js';

const SETTINGS = { tijdslotMinuten: 180, vanTijd: '08:00', totTijd: '17:00' };
const DATUM = '2026-10-07';

test('geplandTijdslotVoor: voorstel met passende datum geeft het voorgestelde slot (en-streepje)', () => {
  const r = geplandTijdslotVoor({
    voorstel: { tijdslot: '08:30–11:30', tijdslotDatum: DATUM }, datum: DATUM, planUur: '09:10', isLocal: false, settings: SETTINGS,
  });
  assert.deepEqual(r, { van: '08:30', tot: '11:30' });
});

test('geplandTijdslotVoor: voorstel voor een andere datum valt terug op planUur', () => {
  const r = geplandTijdslotVoor({
    voorstel: { tijdslot: '13:00–16:00', tijdslotDatum: '2026-10-08' }, datum: DATUM, planUur: '09:10', isLocal: false, settings: SETTINGS,
  });
  const slot = tijdslotVoor(9 * 60 + 10, undefined, SETTINGS);
  assert.deepEqual(r, { van: '08:30', tot: '11:30' });
  assert.equal(`${r.van}–${r.tot}`, slot.label);
});

test('geplandTijdslotVoor: zonder voorstel wel planUur', () => {
  const r = geplandTijdslotVoor({ voorstel: undefined, datum: DATUM, planUur: '09:10', isLocal: false, settings: SETTINGS });
  assert.deepEqual(r, { van: '08:30', tot: '11:30' });
});

test('geplandTijdslotVoor: lokale afspraak geeft null', () => {
  const r = geplandTijdslotVoor({
    voorstel: { tijdslot: '08:30–11:30', tijdslotDatum: DATUM }, datum: DATUM, planUur: '09:10', isLocal: true, settings: SETTINGS,
  });
  assert.equal(r, null);
});

test('geplandTijdslotVoor: niets bekend geeft null', () => {
  assert.equal(geplandTijdslotVoor({ voorstel: undefined, datum: DATUM, planUur: undefined, isLocal: false, settings: SETTINGS }), null);
  assert.equal(geplandTijdslotVoor({ voorstel: {}, datum: DATUM, planUur: '', isLocal: false, settings: SETTINGS }), null);
  assert.equal(geplandTijdslotVoor({ voorstel: null, datum: DATUM, planUur: null, isLocal: false, settings: SETTINGS }), null);
});

test('geplandTijdslotVoor: ongeldig tijdslot-formaat valt terug op planUur', () => {
  for (const tijdslot of ['ochtend', '8:30-11:30', '08:30-11:30', '08:30–', '']) {
    const r = geplandTijdslotVoor({ voorstel: { tijdslot, tijdslotDatum: DATUM }, datum: DATUM, planUur: '09:10', isLocal: false, settings: SETTINGS });
    assert.deepEqual(r, { van: '08:30', tot: '11:30' }, tijdslot);
  }
  // ongeldig formaat én geen planUur: null
  assert.equal(geplandTijdslotVoor({ voorstel: { tijdslot: 'ochtend', tijdslotDatum: DATUM }, datum: DATUM, planUur: undefined, isLocal: false, settings: SETTINGS }), null);
});

test('geplandTijdslotVoor: ongeldig planUur geeft null', () => {
  assert.equal(geplandTijdslotVoor({ voorstel: undefined, datum: DATUM, planUur: 'negen uur', isLocal: false, settings: SETTINGS }), null);
});

test('rapportTicketVelden: installateurAlLangsGeweest wordt Ja / Nee / leeg', () => {
  assert.equal(rapportTicketVelden({ installateurAlLangsGeweest: 'Ja' }).installateurAlLangsGeweest, 'Ja');
  assert.equal(rapportTicketVelden({ installateurAlLangsGeweest: 'JA' }).installateurAlLangsGeweest, 'Ja');
  assert.equal(rapportTicketVelden({ installateurAlLangsGeweest: ' nee ' }).installateurAlLangsGeweest, 'Nee');
  assert.equal(rapportTicketVelden({ installateurAlLangsGeweest: '' }).installateurAlLangsGeweest, '');
  assert.equal(rapportTicketVelden({ installateurAlLangsGeweest: '-Geen-' }).installateurAlLangsGeweest, '');
  assert.equal(rapportTicketVelden({ installateurAlLangsGeweest: 'misschien' }).installateurAlLangsGeweest, '');
  assert.equal(rapportTicketVelden({}).installateurAlLangsGeweest, '');
  assert.equal(rapportTicketVelden(undefined).installateurAlLangsGeweest, '');
});

test('rapportTicketVelden: partner en regio komen van het ticket, ontbrekend wordt leeg; installateur telt niet mee', () => {
  assert.deepEqual(
    rapportTicketVelden({ partner: 'Proxes', regio: 'Kempen', installateurAlLangsGeweest: 'Nee', account: 'Klant NV' }),
    { partner: 'Proxes', regio: 'Kempen', installateurAlLangsGeweest: 'Nee' });
  assert.deepEqual(rapportTicketVelden({}), { partner: '', regio: '', installateurAlLangsGeweest: '' });
  // R.installateur valt terug op account; dat mag het dashboardveld nooit beïnvloeden.
  assert.equal(rapportTicketVelden({ account: 'Klant NV', installateur: 'X' }).installateurAlLangsGeweest, '');
});

test('stripZwareVelden behoudt de vier nieuwe velden en laat fotos weg', () => {
  const r = stripZwareVelden({
    geplandTijdslot: { van: '08:30', tot: '11:30' }, partner: 'Proxes', regio: 'Kempen', installateurAlLangsGeweest: 'Ja', fotos: [{ id: 1 }],
  });
  assert.deepEqual(r, { geplandTijdslot: { van: '08:30', tot: '11:30' }, partner: 'Proxes', regio: 'Kempen', installateurAlLangsGeweest: 'Ja' });
});
