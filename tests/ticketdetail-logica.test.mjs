// tests/ticketdetail-logica.test.mjs — pure detaillogica (handberekend)
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  tijdslotVoor, roundToNextQuarterStr, cleanTicketSubject, joinNL, meervoud,
  telNummer, bevestigdLabel, DOELGROEP_LABEL, heeftLopendVoorstel,
} from '../public/js/schermen/ticketdetail-logica.js';

const inst = { vanTijd: '08:00', totTijd: '17:00', tijdslotMinuten: 180 };

test('tijdslotVoor(540=09:00, 180): start = floor((540-30)/30)*30 = 510, eind 690', () => {
  assert.deepEqual(tijdslotVoor(540, 180, inst), { startMin: 510, endMin: 690, label: '08:30–11:30' });
});
test('tijdslotVoor: slotMinuten valt terug op instelling, dan op 180', () => {
  assert.equal(tijdslotVoor(540, undefined, { ...inst, tijdslotMinuten: 120 }).label, '08:30–10:30');
  assert.equal(tijdslotVoor(540, undefined, {}).label, '08:30–11:30');
  assert.throws(() => tijdslotVoor(540, 180), TypeError); // geen standaard: een vergeten settings-argument faalt luid
});
test('tijdslotVoor: vóór dagstart klemt start op dagStart (480)', () => {
  // 08:00 = 480; (480-30)=450 -> 420 -> max(480,420) = 480; eind 660
  assert.deepEqual(tijdslotVoor(480, 180, inst), { startMin: 480, endMin: 660, label: '08:00–11:00' });
});
test('tijdslotVoor: laat op de dag schuift het slot terug tot dagEind (1020)', () => {
  // 16:00 = 960: start 930, eind 1110 > 1020 -> eind 1020, start 840
  assert.deepEqual(tijdslotVoor(960, 180, inst), { startMin: 840, endMin: 1020, label: '14:00–17:00' });
});
test('tijdslotVoor: Gemeten — schatting buiten de werkdag volgt het blok (kan na dagEind liggen)', () => {
  // 18:00 = 1080: start 1050, eind 1230 > 1020 -> eind 1020, start 840; 1080 >= 1020 -> herberekend: start 1050, eind 1230
  assert.deepEqual(tijdslotVoor(1080, 180, inst), { startMin: 1050, endMin: 1230, label: '17:30–20:30' });
});
test('tijdslotVoor: Gemeten — te klein slot (30) rond een kwartier', () => {
  // 09:15 = 555: start floor(525/30)*30 = 510, eind 540; 555 >= 540 -> herberekend start 510, eind 540
  assert.deepEqual(tijdslotVoor(555, 30, inst), { startMin: 510, endMin: 540, label: '08:30–09:00' });
});

test('roundToNextQuarterStr: 09:00 / 09:01 / 23:50 / leeg / rommel', () => {
  assert.equal(roundToNextQuarterStr('09:00'), '09:00');
  assert.equal(roundToNextQuarterStr('09:01'), '09:15');
  assert.equal(roundToNextQuarterStr('09:46'), '10:00');
  assert.equal(roundToNextQuarterStr('23:50'), '00:00'); // uur-overloop wrapt
  assert.equal(roundToNextQuarterStr(''), '09:00');
  assert.equal(roundToNextQuarterStr(undefined), '09:00');
  assert.equal(roundToNextQuarterStr('xx:yy'), '09:00');
});

test('cleanTicketSubject: geneste prefixen, contactbericht en leeg', () => {
  assert.equal(cleanTicketSubject('RE: FW: Laadpaal defect'), 'Laadpaal defect');
  assert.equal(cleanTicketSubject('  aw : Re:  Storing '), 'Storing');
  assert.equal(cleanTicketSubject('Nieuw contactbericht van Jan Peeters'), 'uw laadstation');
  assert.equal(cleanTicketSubject('FW: Nieuw contactbericht van Jan'), 'uw laadstation');
  assert.equal(cleanTicketSubject(''), 'uw laadstation');
  assert.equal(cleanTicketSubject(null), 'uw laadstation');
  assert.equal(cleanTicketSubject('Retour defect'), 'Retour defect'); // "Re" zonder dubbelepunt blijft
});

test('joinNL: 0, 1, 2 en 3 items', () => {
  assert.equal(joinNL([]), '');
  assert.equal(joinNL(['a']), 'a');
  assert.equal(joinNL(['a', 'b']), 'a en b');
  assert.equal(joinNL(['a', 'b', 'c']), 'a, b en c');
});

test('meervoud', () => {
  assert.equal(meervoud(1, 'ticket', 'tickets'), '1 ticket');
  assert.equal(meervoud(0, 'ticket', 'tickets'), '0 tickets');
  assert.equal(meervoud(2, 'ticket', 'tickets'), '2 tickets');
});

test('telNummer: Belgische notatie, leeg', () => {
  assert.equal(telNummer('+32 (0)9 123 45 67'), '+3291234567');
  assert.equal(telNummer('09/123.45.67'), '091234567');
  assert.equal(telNummer(''), '');
  assert.equal(telNummer(null), '');
});

test('bevestigdLabel: alle bronnen', () => {
  assert.equal(bevestigdLabel(undefined), null);
  assert.equal(bevestigdLabel({}), null);
  assert.equal(bevestigdLabel({ bevestigd: { door: 'contact' } }), '✓ Bevestigd door contactpersoon');
  assert.equal(bevestigdLabel({ bevestigd: { door: 'klant' } }), '✓ Bevestigd door klant');
  assert.equal(bevestigdLabel({ bevestigd: { door: 'installateur' } }), '✓ Bevestigd door installateur');
  assert.equal(bevestigdLabel({ bevestigd: { door: null } }), '✓ Bevestigd');
  assert.equal(bevestigdLabel({ bevestigd: { door: 'onbekend' } }), '✓ Bevestigd');
});

test('heeftLopendVoorstel', () => {
  assert.equal(heeftLopendVoorstel(null), false);
  assert.equal(heeftLopendVoorstel({ id: 1, status: 'Wachten op bevestiging planning' }, { 1: { contact: true } }), true);
  assert.equal(heeftLopendVoorstel({ id: 1, status: 'Wachten op planning' }, { 1: { klant: true } }), false);
  assert.equal(heeftLopendVoorstel({ id: 1, status: 'Wachten op bevestiging planning' }, {}), false);
  assert.throws(() => heeftLopendVoorstel({ id: 1, status: 'Wachten op bevestiging planning' }), TypeError); // vergeten voorstelStatus faalt luid
  assert.equal(heeftLopendVoorstel({ id: 1, status: 'Geplande service' }, {}), true);
  assert.equal(heeftLopendVoorstel({ id: 1, status: 'Geplande support' }, {}), true);
  assert.equal(heeftLopendVoorstel({ id: 1, status: 'Open' }, { 1: { bevestigd: { door: 'klant' } } }), false);
});

test('DOELGROEP_LABEL: de drie ontvangersgroepen', () => {
  assert.deepEqual(DOELGROEP_LABEL, { contact: 'contactpersoon', klant: 'klant', installateur: 'installateur' });
});
