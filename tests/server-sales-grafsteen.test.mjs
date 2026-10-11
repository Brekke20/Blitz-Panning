import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { hashSleutel, hashVoor, maakGrafsteen, voegGrafsteenToe } from '../netlify/lib/sales-grafsteen.js';
import { voegSamen } from '../public/js/sales/herkenning.js';

const GEHEIM = 'test-geheim-0123456789';
const NU = '2026-10-09T09:00:00.000Z';
const marie = { id: 'l1', voornaam: 'Marie', naam: 'Janssens', email: 'Marie.Janssens@voorbeeld.test', gsm: '0471 23 45 67', postcode: '3640' };

test('maakGrafsteen: twee hashes (e-mail + gsm), geen leesbare persoonsgegevens', () => {
  const g = maakGrafsteen(marie, { gebruikerId: 'u1', nu: NU, geheim: GEHEIM });
  assert.equal(g.h.length, 2);
  assert.ok(g.h.every(h => /^[0-9a-f]{32}$/.test(h)));
  assert.equal(g.op, NU);
  const tekst = JSON.stringify(g);
  assert.ok(!tekst.includes('Marie') && !tekst.includes('Janssens') && !tekst.includes('@') && !tekst.includes('471'));
  assert.deepEqual(Object.keys(g).sort(), ['h', 'op']);
});

test('maakGrafsteen: op blijft een ISO-string (ook bij Date of getal als nu)', () => {
  assert.equal(maakGrafsteen(marie, { gebruikerId: 'u1', nu: new Date(NU), geheim: GEHEIM }).op, NU);
  assert.equal(maakGrafsteen(marie, { gebruikerId: 'u1', nu: Date.parse(NU), geheim: GEHEIM }).op, NU);
});

test('dezelfde lead bij een andere verkoper geeft andere hashes', () => {
  const a = maakGrafsteen(marie, { gebruikerId: 'u1', nu: NU, geheim: GEHEIM });
  const b = maakGrafsteen(marie, { gebruikerId: 'u2', nu: NU, geheim: GEHEIM });
  assert.ok(a.h.every(h => !b.h.includes(h)));
});

test('deterministisch met een vast geheim; een ander geheim geeft andere hashes', () => {
  const a = maakGrafsteen(marie, { gebruikerId: 'u1', nu: NU, geheim: GEHEIM });
  assert.deepEqual(maakGrafsteen(marie, { gebruikerId: 'u1', nu: NU, geheim: GEHEIM }).h, a.h);
  const c = maakGrafsteen(marie, { gebruikerId: 'u1', nu: NU, geheim: 'ander-geheim-9876543210' });
  assert.ok(a.h.every(h => !c.h.includes(h)));
});

test('hashSleutel is HMAC-SHA256 met afgeleide sleutel over `<gebruikerId>|<sleutel>`, geen platte SHA-256', () => {
  const K = createHmac('sha256', GEHEIM).update('blitz-sales-grafsteen-v1').digest();
  const verwacht = createHmac('sha256', K).update('u1|e:marie.janssens@voorbeeld.test').digest('hex').slice(0, 32);
  assert.equal(hashSleutel('e:marie.janssens@voorbeeld.test', 'u1', GEHEIM), verwacht);
  const plat = createHash('sha256').update('e:marie.janssens@voorbeeld.test').digest('hex').slice(0, 32);
  assert.notEqual(hashSleutel('e:marie.janssens@voorbeeld.test', 'u1', GEHEIM), plat);
  assert.notEqual(hashSleutel('e:marie.janssens@voorbeeld.test', 'u1', GEHEIM), createHash('sha256').update('u1|e:marie.janssens@voorbeeld.test').digest('hex').slice(0, 32));
});

test('zonder geheim: hashSleutel gooit, maakGrafsteen geeft null', () => {
  for (const geheim of [undefined, '', null]) {
    assert.throws(() => hashSleutel('e:x', 'u1', geheim));
    assert.equal(maakGrafsteen(marie, { gebruikerId: 'u1', nu: NU, geheim }), null);
  }
  assert.throws(() => hashVoor('u1', undefined)('e:x'));
});

test('enkel naam + voornaam + postcode: één hash (n:-sleutel); zonder naam/e-mail/gsm: null', () => {
  const g = maakGrafsteen({ id: 'l2', voornaam: 'Tom', naam: 'Peeters', postcode: '3500' }, { gebruikerId: 'u1', nu: NU, geheim: GEHEIM });
  assert.equal(g.h.length, 1);
  assert.equal(maakGrafsteen({ id: 'l3', postcode: '3500', straat: 'Dorpsstraat' }, { gebruikerId: 'u1', nu: NU, geheim: GEHEIM }), null);
  assert.equal(maakGrafsteen({ id: 'l4', gsm: '+32000000' }, { gebruikerId: 'u1', nu: NU, geheim: GEHEIM }), null);
});

test('voegGrafsteenToe: overlap samenvoegen (h-vereniging, nieuwste op), anders toevoegen; invoer niet gemuteerd', () => {
  const lijst = [{ h: ['a', 'b'], op: '2026-01-01T00:00:00.000Z' }, { h: ['x'], op: '2026-02-01T00:00:00.000Z' }];
  const kopie = structuredClone(lijst);
  const r = voegGrafsteenToe(lijst, { h: ['b', 'c'], op: '2026-05-01T00:00:00.000Z' });
  assert.deepEqual(lijst, kopie);
  assert.equal(r.length, 2);
  const samen = r.find(g => g.h.includes('a'));
  assert.deepEqual([...samen.h].sort(), ['a', 'b', 'c']);
  assert.equal(samen.op, '2026-05-01T00:00:00.000Z');
  const nieuw = voegGrafsteenToe(lijst, { h: ['z'], op: '2026-05-01T00:00:00.000Z' });
  assert.equal(nieuw.length, 3);
  // een oudere nieuwe op wint niet van de bestaande
  assert.equal(voegGrafsteenToe(lijst, { h: ['a'], op: '2025-01-01T00:00:00.000Z' }).find(g => g.h.includes('a')).op, '2026-01-01T00:00:00.000Z');
  // null (geen geheim / geen sleutels) laat de lijst ongewijzigd
  assert.deepEqual(voegGrafsteenToe(lijst, null), lijst);
  assert.deepEqual(voegGrafsteenToe(undefined, { h: ['q'], op: NU }), [{ h: ['q'], op: NU }]);
});

test('voegGrafsteenToe: een nieuwe steen die twee bestaande overbrugt voegt ze alle drie samen', () => {
  const r = voegGrafsteenToe([{ h: ['a'], op: '2026-01-01T00:00:00.000Z' }, { h: ['b'], op: '2026-01-02T00:00:00.000Z' }], { h: ['a', 'b'], op: NU });
  assert.equal(r.length, 1);
  assert.deepEqual([...r[0].h].sort(), ['a', 'b']);
});

test('hashVoor + voegSamen: een eerder verwijderde lead wordt herkend (e-mail, enkel gsm, n:-sleutel)', () => {
  const hash = hashVoor('u1', GEHEIM);
  let grafstenen = [];
  for (const l of [marie, { id: 'l2', voornaam: 'Tom', naam: 'Peeters', postcode: '3500' }]) {
    grafstenen = voegGrafsteenToe(grafstenen, maakGrafsteen(l, { gebruikerId: 'u1', nu: NU, geheim: GEHEIM }));
  }
  let teller = 0;
  const opties = { nu: NU, nieuwId: () => 'n' + (++teller), grafstenen, hash };
  const r = voegSamen([], [
    { voornaam: 'Marie', naam: 'Janssens', gsm: '+32 471 23 45 67', postcode: '3640' }, // enkel op gsm
    { voornaam: 'Tom', naam: 'Peeters', postcode: '3500' },                              // n:-sleutel
    { voornaam: 'Nieuw', naam: 'Iemand', email: 'nieuw@voorbeeld.test', postcode: '3600' },
  ], opties);
  assert.equal(r.samenvatting.eerderVerwijderd, 2);
  assert.equal(r.leads.filter(l => l.eerderVerwijderd).length, 2);
  assert.equal(r.leads[0].eerderVerwijderd.op, NU);
  // een andere verkoper (andere hashes) herkent ze niet
  const andere = voegSamen([], [{ voornaam: 'Tom', naam: 'Peeters', postcode: '3500' }], { ...opties, hash: hashVoor('u2', GEHEIM) });
  assert.equal(andere.samenvatting.eerderVerwijderd, 0);
});

test('maakGrafsteen: ongeldige nu geeft geen RangeError maar de huidige tijd als ISO-string', () => {
  for (const nu of ['geen-datum', undefined, NaN, {}]) {
    const voor = Date.now();
    const g = maakGrafsteen(marie, { gebruikerId: 'u1', nu, geheim: GEHEIM });
    assert.equal(g.h.length, 2);
    assert.match(g.op, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Date.parse(g.op) >= voor - 1 && Date.parse(g.op) <= Date.now() + 1);
  }
});
