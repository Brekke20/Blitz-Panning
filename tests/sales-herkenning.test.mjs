import { test } from 'node:test';
import assert from 'node:assert/strict';
import { herkenningssleutels, voegSamen } from '../public/js/sales/herkenning.js';

const NU = '2026-10-08T12:00:00.000Z';
const BRON = { verantwoordelijke: 'Test Verkoper', geexporteerdOp: '2026-10-08T10:24:18.039Z' };
const teller = () => { let i = 0; return () => 'id-' + (++i); };
const imp = (o = {}) => ({ voornaam: null, naam: null, gsm: null, email: null, postcode: null, gemeente: null,
  straat: null, huisnr: null, adresTekst: null, ...o });
const voeg = (bestaande, nieuwe, extra = {}) => voegSamen(bestaande, nieuwe, { nu: NU, nieuwId: teller(), bronExport: BRON, ...extra });
const hash = (s) => 'H' + s;

const marie = () => imp({ voornaam: 'Marie', naam: 'Janssens', gsm: '+32 478 12 34 56', email: 'marie@voorbeeld.test', postcode: '3640' });

test('herkenningssleutels: e-mail en gsm', () => {
  assert.deepEqual(herkenningssleutels({ email: ' Marie@Voorbeeld.TEST ', gsm: '0478/12.34.56', naam: 'Janssens' }),
    ['e:marie@voorbeeld.test', 'g:32478123456']);
  assert.deepEqual(herkenningssleutels({ email: 'a@b.test' }), ['e:a@b.test']);
  assert.deepEqual(herkenningssleutels({ gsm: '+32 478 12 34 56' }), ['g:32478123456']);
});

test('herkenningssleutels: placeholder-gsm telt niet, dan naamsleutel', () => {
  assert.deepEqual(herkenningssleutels({ voornaam: 'An', naam: 'Claes', gsm: '+32000000', postcode: '3500' }), ['n:an|claes|3500']);
  assert.deepEqual(herkenningssleutels({ voornaam: ' An ', naam: 'CLAES', email: 'geen-mail' }), ['n:an|claes|']);
});

test('herkenningssleutels: zonder bruikbare gegevens geen sleutels', () => {
  assert.deepEqual(herkenningssleutels({}), []);
  assert.deepEqual(herkenningssleutels({ gsm: '+32000000' }), []);
});

test('zelfde e-mail met andere hoofdletters en spaties is al aanwezig', () => {
  const eerste = voeg([], [marie()]);
  const r = voeg(eerste.leads, [imp({ naam: 'Janssens', email: '  MARIE@Voorbeeld.test ' })]);
  assert.equal(r.leads.length, 1);
  assert.equal(r.toegevoegd.length, 0);
  assert.deepEqual(r.samenvatting, { nieuw: 0, alAanwezig: 1, adresNakijken: 0, eerderVerwijderd: 0 });
});

test('zelfde gsm in andere schrijfwijze is al aanwezig', () => {
  const bestaande = voeg([], [imp({ naam: 'Peeters', gsm: '+32 478 12 34 56' })]).leads;
  const r = voeg(bestaande, [imp({ naam: 'Peeters', gsm: '0478123456' })]);
  assert.equal(r.leads.length, 1);
  assert.equal(r.samenvatting.alAanwezig, 1);
});

test('placeholder-gsm herkent niemand: twee verschillende leads blijven twee', () => {
  const r = voeg([], [
    imp({ voornaam: 'An', naam: 'Claes', gsm: '+32000000', email: 'an@voorbeeld.test' }),
    imp({ voornaam: 'Tom', naam: 'Peeters', gsm: '+32000000', email: 'tom@voorbeeld.test' }),
  ]);
  assert.equal(r.leads.length, 2);
  assert.equal(r.samenvatting.nieuw, 2);
  const r2 = voeg(r.leads, [imp({ voornaam: 'Lies', naam: 'Maes', gsm: '+32000000' })]);
  assert.equal(r2.leads.length, 3);
});

test('zonder e-mail en gsm: naam + voornaam + postcode herkent', () => {
  const bestaande = voeg([], [imp({ voornaam: 'An', naam: 'Claes', postcode: '3500' })]).leads;
  const zelfde = voeg(bestaande, [imp({ voornaam: ' an ', naam: 'CLAES', postcode: '3500', gsm: '+32000000' })]);
  assert.equal(zelfde.leads.length, 1);
  assert.equal(zelfde.samenvatting.alAanwezig, 1);
  const andere = voeg(bestaande, [imp({ voornaam: 'An', naam: 'Claes', postcode: '3600' })]);
  assert.equal(andere.leads.length, 2);
  assert.equal(andere.samenvatting.nieuw, 1);
});

test('dubbele lead binnen hetzelfde bestand geeft een nieuwe', () => {
  const r = voeg([], [marie(), imp({ naam: 'Janssens', email: 'MARIE@voorbeeld.test' }), imp({ voornaam: 'M', gsm: '0478123456' })]);
  assert.equal(r.leads.length, 1);
  assert.deepEqual(r.samenvatting, { nieuw: 1, alAanwezig: 2, adresNakijken: 0, eerderVerwijderd: 0 });
});

test('nieuwe lead heeft het volledige datamodel', () => {
  const r = voeg([], [marie()]);
  assert.deepEqual(r.leads[0], {
    id: 'id-1', voornaam: 'Marie', naam: 'Janssens', gsm: '+32 478 12 34 56', email: 'marie@voorbeeld.test',
    postcode: '3640', gemeente: null, straat: null, huisnr: null, adresTekst: null, locatie: null,
    status: 'te-plannen', bezoeken: [], geimporteerdOp: NU, bronExport: BRON,
  });
  assert.deepEqual(r.toegevoegd, [r.leads[0]]);
  assert.ok(!('eerderVerwijderd' in r.leads[0]));
});

const bestaandeLead = (o = {}) => ({
  id: 'x1', voornaam: 'Marie', naam: 'Janssens', gsm: null, email: 'marie@voorbeeld.test', postcode: '3640', gemeente: null,
  straat: null, huisnr: null, adresTekst: null, locatie: { bron: 'postcode', lat: 51, lng: 5 }, status: 'bevestigd',
  bezoeken: [{ id: 'b1', datum: '2026-09-01' }], geimporteerdOp: '2026-09-30T08:00:00.000Z', bronExport: BRON,
  planning: { datum: '2026-10-12', uur: '10:00', vast: true }, notitie: 'bel vooraf', duurMin: 90, resultaat: { soort: 'offerte' }, ...o,
});

test('samenvoegen behoudt planning, status, notitie, duur, resultaat en bezoeken; vult lege gsm aan', () => {
  const b = bestaandeLead();
  const r = voeg([b], [imp({ voornaam: 'Marie', naam: 'Janssens', gsm: '0478 12 34 56', email: 'marie@voorbeeld.test', postcode: '3640' })]);
  assert.equal(r.leads.length, 1);
  const l = r.leads[0];
  assert.equal(l.gsm, '0478 12 34 56');
  assert.equal(l.status, 'bevestigd');
  assert.deepEqual(l.planning, b.planning);
  assert.equal(l.notitie, 'bel vooraf');
  assert.equal(l.duurMin, 90);
  assert.deepEqual(l.resultaat, { soort: 'offerte' });
  assert.deepEqual(l.bezoeken, b.bezoeken);
  assert.deepEqual(l.locatie, { bron: 'postcode', lat: 51, lng: 5 });
  assert.equal(l.id, 'x1');
});

test('samenvoegen overschrijft gevulde contactvelden niet', () => {
  const r = voeg([bestaandeLead({ gsm: '0499 99 99 99', voornaam: 'Marie' })],
    [imp({ voornaam: 'Mariette', naam: 'Jansen', gsm: '0478 12 34 56', email: 'marie@voorbeeld.test' })]);
  const l = r.leads[0];
  assert.equal(l.gsm, '0499 99 99 99');
  assert.equal(l.voornaam, 'Marie');
  assert.equal(l.naam, 'Janssens');
});

test('postcode-only wordt volledig adres: locatie null zodat opnieuw geocodeerd wordt', () => {
  const r = voeg([bestaandeLead()], [imp({ email: 'marie@voorbeeld.test', postcode: '3640', gemeente: 'Kinrooi',
    straat: 'Dorpsstraat', huisnr: '12' })]);
  const l = r.leads[0];
  assert.equal(l.straat, 'Dorpsstraat');
  assert.equal(l.huisnr, '12');
  assert.equal(l.gemeente, 'Kinrooi');
  assert.equal(l.postcode, '3640');
  assert.equal(l.locatie, null);
  assert.equal(l.status, 'bevestigd');
  assert.deepEqual(l.planning, { datum: '2026-10-12', uur: '10:00', vast: true });
});

test('een bestaand volledig adres wordt nooit door een postcode overschreven', () => {
  const volledig = bestaandeLead({ straat: 'Dorpsstraat', huisnr: '12', gemeente: 'Kinrooi', locatie: { bron: 'adres', lat: 51, lng: 5 } });
  const r1 = voeg([volledig], [imp({ email: 'marie@voorbeeld.test', postcode: '3500', gemeente: 'Hasselt' })]);
  assert.deepEqual(r1.leads[0], volledig);
  const r2 = voeg([volledig], [imp({ email: 'marie@voorbeeld.test', postcode: '3500', gemeente: 'Hasselt', straat: 'Kerkstraat', huisnr: '5' })]);
  assert.equal(r2.leads[0].straat, 'Dorpsstraat');
  assert.deepEqual(r2.leads[0].locatie, { bron: 'adres', lat: 51, lng: 5 });
});

test('een postcode-lead blijft ongewijzigd bij een postcode-import', () => {
  const b = bestaandeLead();
  const r = voeg([b], [imp({ email: 'marie@voorbeeld.test', postcode: '3640' })]);
  assert.deepEqual(r.leads[0], b);
});

test('lead die niet meer in de export staat blijft staan; invoer wordt niet gemuteerd', () => {
  const bestaande = [bestaandeLead(), bestaandeLead({ id: 'x2', email: 'tom@voorbeeld.test', naam: 'Peeters', voornaam: 'Tom' })];
  const nieuwe = [imp({ voornaam: 'Marie', naam: 'Janssens', gsm: '0478 12 34 56', email: 'marie@voorbeeld.test', postcode: '3640',
    straat: 'Dorpsstraat', huisnr: '12' }), imp({ voornaam: 'Lies', naam: 'Maes', email: 'lies@voorbeeld.test' })];
  const grafstenen = [{ h: ['Hx'], op: '2026-09-01T10:00:00.000Z' }];
  const vooB = structuredClone(bestaande), vooN = structuredClone(nieuwe), vooG = structuredClone(grafstenen);
  const r = voeg(bestaande, nieuwe, { grafstenen, hash });
  assert.deepEqual(bestaande, vooB);
  assert.deepEqual(nieuwe, vooN);
  assert.deepEqual(grafstenen, vooG);
  assert.equal(r.leads.length, 3);
  assert.ok(r.leads.some((l) => l.id === 'x2'));
  assert.notEqual(r.leads[0], bestaande[0]);
  assert.deepEqual(r.grafstenen, vooG);
});

test('samenvatting telt nakijken enkel onder de nieuwe leads', () => {
  const b = bestaandeLead();
  const r = voeg([b], [
    imp({ email: 'marie@voorbeeld.test', adresTekst: 'bij de molen' }), // al aanwezig: telt niet mee
    imp({ naam: 'Peeters', email: 'tom@voorbeeld.test', adresTekst: 'bij de molen' }),
    imp({ naam: 'Maes', email: 'lies@voorbeeld.test', postcode: '3500', straat: 'Kerkstraat', huisnr: '5', gemeente: 'Hasselt' }),
  ]);
  assert.deepEqual(r.samenvatting, { nieuw: 2, alAanwezig: 1, adresNakijken: 1, eerderVerwijderd: 0 });
  assert.equal(r.toegevoegd.length, 2);
  assert.equal(r.toegevoegd[1].geimporteerdOp, NU);
  assert.deepEqual(r.toegevoegd[1].bronExport, BRON);
});

test('lead zonder enig adres telt als adres nakijken', () => {
  const r = voeg([], [imp({ naam: 'Peeters', email: 'tom@voorbeeld.test' })]);
  assert.equal(r.samenvatting.adresNakijken, 1);
});

// --- Grafstenen (besluit a) ---

const OP = '2026-09-01T10:00:00.000Z';

test('grafsteen: terugkerende lead krijgt eerderVerwijderd en de grafsteen wordt verbruikt', () => {
  const r = voeg([], [imp({ naam: 'Janssens', email: 'MARIE@Voorbeeld.be', postcode: '3640' })],
    { hash, grafstenen: [{ h: ['He:marie@voorbeeld.be'], op: OP }] });
  assert.deepEqual(r.leads[0].eerderVerwijderd, { op: OP });
  assert.deepEqual(r.samenvatting, { nieuw: 1, alAanwezig: 0, adresNakijken: 0, eerderVerwijderd: 1 });
  assert.deepEqual(r.grafstenen, []);
});

test('grafsteen: overeenkomst enkel op gsm geeft ook het label', () => {
  const r = voeg([], [imp({ naam: 'Janssens', email: 'nieuw@voorbeeld.be', gsm: '0478 12 34 56', postcode: '3640' })],
    { hash, grafstenen: [{ h: ['He:oud@voorbeeld.be', 'Hg:32478123456'], op: OP }] });
  assert.deepEqual(r.leads[0].eerderVerwijderd, { op: OP });
  assert.equal(r.samenvatting.eerderVerwijderd, 1);
  assert.deepEqual(r.grafstenen, []);
});

test('grafsteen met e-mail en gsm wordt door een treffer verbruikt', () => {
  const g = { h: ['He:marie@voorbeeld.be', 'Hg:32478123456'], op: OP };
  const r = voeg([], [imp({ naam: 'Janssens', email: 'marie@voorbeeld.be', gsm: '0478 12 34 56' })], { hash, grafstenen: [g, { h: ['Hx'], op: OP }] });
  assert.equal(r.grafstenen.length, 1);
  assert.deepEqual(r.grafstenen[0].h, ['Hx']);
});

test('grafsteen zonder overeenkomst blijft staan en de lead krijgt geen label', () => {
  const g = { h: ['He:iemand-anders@voorbeeld.be'], op: OP };
  const r = voeg([], [imp({ naam: 'Janssens', email: 'marie@voorbeeld.be' })], { hash, grafstenen: [g] });
  assert.ok(!('eerderVerwijderd' in r.leads[0]));
  assert.equal(r.samenvatting.eerderVerwijderd, 0);
  assert.deepEqual(r.grafstenen, [g]);
});

test('grafsteen: lead die al in bestaande staat krijgt geen label en de grafsteen blijft', () => {
  const g = { h: ['He:marie@voorbeeld.test'], op: OP };
  const b = bestaandeLead();
  const r = voeg([b], [imp({ email: 'marie@voorbeeld.test' })], { hash, grafstenen: [g] });
  assert.ok(!('eerderVerwijderd' in r.leads[0]));
  assert.deepEqual(r.grafstenen, [g]);
  assert.equal(r.samenvatting.alAanwezig, 1);
});

test('grafsteen: een bestaand eerderVerwijderd-label blijft bij samenvoegen', () => {
  const b = bestaandeLead({ eerderVerwijderd: { op: OP } });
  const r = voeg([b], [imp({ email: 'marie@voorbeeld.test', gsm: '0478123456' })], { hash, grafstenen: [] });
  assert.deepEqual(r.leads[0].eerderVerwijderd, { op: OP });
});

test('grafstenen worden genegeerd zonder hash of zonder grafstenen', () => {
  const g = { h: ['He:marie@voorbeeld.be'], op: OP };
  const zonderHash = voeg([], [imp({ naam: 'Janssens', email: 'marie@voorbeeld.be' })], { grafstenen: [g] });
  assert.ok(!('eerderVerwijderd' in zonderHash.leads[0]));
  assert.deepEqual(zonderHash.grafstenen, [g]);
  const zonderGrafstenen = voeg([], [imp({ naam: 'Janssens', email: 'marie@voorbeeld.be' })], { hash });
  assert.ok(!('eerderVerwijderd' in zonderGrafstenen.leads[0]));
  assert.deepEqual(zonderGrafstenen.grafstenen, []);
});

test('grafsteen voor een lead zonder e-mail en gsm gebruikt de n-sleutel', () => {
  const r = voeg([], [imp({ voornaam: 'An', naam: 'Claes', postcode: '3500', gsm: '+32000000' })],
    { hash, grafstenen: [{ h: ['Hn:an|claes|3500'], op: OP }] });
  assert.deepEqual(r.leads[0].eerderVerwijderd, { op: OP });
});

test('het label bevat nooit meer dan { op }', () => {
  const r = voeg([], [imp({ naam: 'Janssens', email: 'marie@voorbeeld.be' })],
    { hash, grafstenen: [{ h: ['He:marie@voorbeeld.be'], op: OP, naam: 'Janssens', gsm: '0478123456' }] });
  assert.deepEqual(Object.keys(r.leads[0].eerderVerwijderd), ['op']);
});

test('dezelfde grafsteen wordt maar eenmaal verbruikt; tweede exemplaar in het bestand is al aanwezig', () => {
  const r = voeg([], [imp({ naam: 'Janssens', email: 'marie@voorbeeld.be' }), imp({ naam: 'Janssens', email: 'marie@voorbeeld.be' })],
    { hash, grafstenen: [{ h: ['He:marie@voorbeeld.be'], op: OP }] });
  assert.equal(r.leads.length, 1);
  assert.deepEqual(r.samenvatting, { nieuw: 1, alAanwezig: 1, adresNakijken: 1, eerderVerwijderd: 1 });
});
