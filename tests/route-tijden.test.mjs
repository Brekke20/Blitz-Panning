// tests/route-tijden.test.mjs — unit-tests voor schermen/route-tijden.js (pure laag van de Route-tab)
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  berekenAankomsten, aankomstPerTicket, fmtTijd, dagHeeftEenTechnieker, buitenDagklok,
  mergeMetAnkers, routeHandtekening, stopZonderTijdstip, drukteMagnitude, routeVertraging, haalDrukteDetail, DRUKTE_SEGMENT_METERS,
} from '../public/js/schermen/route-tijden.js';

const duur = (d) => (id) => d[id];
const opties = (extra = {}) => ({
  vanTijd: '08:00',
  duurVoor: duur({}),
  werktijdMin: (uur, einduur) => {
    const [a, b] = uur.split(':').map(Number), [c, d] = einduur.split(':').map(Number);
    return (c * 60 + d) - (a * 60 + b);
  },
  ...extra,
});
const tk = (id, extra = {}) => ({ kind: 'ticket', item: { ticket: { id }, ...extra }, uur: extra.uur });
const lok = (extra = {}) => ({ kind: 'local', item: { id: 'x', ...extra }, uur: extra.uur });

test('berekenAankomsten zonder legs: 30 min terugval + duur', () => {
  const r = berekenAankomsten([tk('a'), tk('b')], null, opties({ duurVoor: duur({ a: 120, b: 120 }) }));
  // 08:00 + 30 = 510; +120 = 630; +30 = 660
  assert.deepEqual(r.arrivalTimes, [510, 660]);
});

test('berekenAankomsten met legs en niet-geocodeerde stop: legIdx slaat de adresloze stop over', () => {
  const stops = [tk('a', { _lat: 1 }), tk('b'), tk('c', { _lat: 2 })];
  const legs = [{ travelTimeSeconds: 1200 }, { travelTimeSeconds: 600 }];
  const r = berekenAankomsten(stops, legs, opties({ duurVoor: duur({ a: 0, b: 0, c: 0 }) }));
  assert.equal(r.legIdx[0], 0); assert.equal(r.legIdx[1], undefined); assert.equal(r.legIdx[2], 1);
  // a: 480+20 = 500, +60 = 560; b (geen leg): +30 = 590, +60 = 650; c: +10 = 660
  assert.deepEqual(r.arrivalTimes, [500, 590, 660]);
});

test('berekenAankomsten: vast uur springt, volgende rekent vanaf dat uur + duur', () => {
  const stops = [tk('a', { uur: '13:00' }), tk('b')];
  const r = berekenAankomsten(stops, null, opties({ duurVoor: duur({ a: 90, b: 60 }) }));
  // a: 780, +90 = 870; b: +30 = 900
  assert.deepEqual(r.arrivalTimes, [780, 900]);
});

test('berekenAankomsten: lokale afspraak gebruikt werktijdMin, zonder einduur 60', () => {
  const stops = [
    lok({ uur: '09:00', einduur: '10:30' }),
    lok({ uur: '12:00' }),
    tk('t'),
  ];
  const r = berekenAankomsten(stops, null, opties({ duurVoor: duur({ t: 45 }) }));
  // 540, +90 = 630 -> 720 (vast uur), +60 = 780 -> ticket: +30 = 810
  assert.deepEqual(r.arrivalTimes, [540, 720, 810]);
});

test('berekenAankomsten: duurVoor 0/undefined geeft 60; vanTijd leeg valt terug op 08:00', () => {
  const r = berekenAankomsten([tk('a'), tk('b')], null, opties({ vanTijd: '', duurVoor: duur({ a: 0 }) }));
  // 480+30 = 510, +60 = 570, +30 = 600
  assert.deepEqual(r.arrivalTimes, [510, 600]);
});

test('aankomstPerTicket: enkel tickets, sleutel = ticket.id', () => {
  const stops = [tk('a'), lok(), tk('b')];
  assert.deepEqual(aankomstPerTicket(stops, [500, 600, 700]), { a: 500, b: 700 });
});

test('fmtTijd', () => {
  assert.equal(fmtTijd(1500), '01:00');
  assert.equal(fmtTijd(510), '08:30');
  assert.equal(fmtTijd(0), '00:00');
});

test('dagHeeftEenTechnieker', () => {
  const p = (assignee) => ({ ticket: { assignee } });
  assert.equal(dagHeeftEenTechnieker([]), true);
  assert.equal(dagHeeftEenTechnieker([p('Tim')]), true);
  assert.equal(dagHeeftEenTechnieker([p('Tim'), p('Tim')]), true);
  assert.equal(dagHeeftEenTechnieker([p('Tim'), p('Sam')]), false);
  // leeg assignee = eigen groep
  assert.equal(dagHeeftEenTechnieker([p('Tim'), p('')]), false);
  assert.equal(dagHeeftEenTechnieker([p(''), p(undefined)]), true);
});

test('buitenDagklok', () => {
  assert.equal(buitenDagklok(1440, '10:00', '17:00'), true);
  assert.equal(buitenDagklok(600, '00:00', '17:00'), true);
  assert.equal(buitenDagklok(600, '19:00', '17:00'), false);
  assert.equal(buitenDagklok(600, '19:15', '17:00'), true);
  assert.equal(buitenDagklok(600, '19:15', undefined), true); // totTijd leeg = 17:00
});

test('mergeMetAnkers: anker eerst als de klok het al bijna haalt', () => {
  const o = opties({ duurVoor: duur({ p1: 60, p2: 60 }) });
  const anker = lok({ uur: '08:30', einduur: '09:30' });
  const p1 = { ticket: { id: 'p1' } };
  const r = mergeMetAnkers([p1], [anker], o);
  assert.equal(r[0], anker);
  assert.equal(r[1].item, p1);
  assert.equal(r.length, 2);
});

test('mergeMetAnkers: ver anker en ankers zonder uur achteraan; originele items blijven', () => {
  const o = opties({ duurVoor: duur({ p1: 60 }) });
  const laat = lok({ uur: '14:00', einduur: '15:00' });
  const zonder = lok({});
  const p1 = { ticket: { id: 'p1' } };
  const r = mergeMetAnkers([p1], [zonder, laat], o);
  assert.equal(r[0].item, p1);
  assert.deepEqual(r.slice(1), [laat, zonder]);
});

test('routeHandtekening: volgorde-onafhankelijk en gesorteerd', () => {
  const a = routeHandtekening([{ ticket: { id: 't2' } }, { ticket: { id: 't1' } }], [{ id: 5 }]);
  const b = routeHandtekening([{ ticket: { id: 't1' } }, { ticket: { id: 't2' } }], [{ id: 5 }]);
  assert.equal(a, 'l5|tt1|tt2');
  assert.equal(a, b);
  assert.equal(routeHandtekening([], []), '');
});

test('stopZonderTijdstip', () => {
  assert.equal(stopZonderTijdstip({}, false), true);
  assert.equal(stopZonderTijdstip({ uur: '10:00' }, false), false);
  assert.equal(stopZonderTijdstip({}, true), false);
});

test('drukteMagnitude: klassen op de drempels 1,03 / 1,10 / 1,25', () => {
  assert.equal(drukteMagnitude(1.25), 3);
  assert.equal(drukteMagnitude(1.10), 2);
  assert.equal(drukteMagnitude(1.03), 1);
  assert.equal(drukteMagnitude(1.02), 0);
  assert.equal(drukteMagnitude(1.2499), 2); // net onder de drempel
  assert.equal(drukteMagnitude(0), 0);      // geen/ontbrekend signaal
  assert.equal(drukteMagnitude(2), 3);      // ruim boven de hoogste drempel
});

// ---- gedeeld met de route van de verkoper: vertraging en drukte-detail ----

test('routeVertraging: live vertraging, verwachte vertraging (toekomstige dag) of geen', () => {
  assert.equal(routeVertraging({ totalTrafficDelaySeconds: 720 }), '+12min');
  assert.equal(routeVertraging({ totalTrafficDelaySeconds: 3900 }), '+1u 5min');
  // live ~0 bij een toekomstig departAt: het verschil historisch - vrij is de verwachte vertraging
  assert.equal(routeVertraging({ totalTrafficDelaySeconds: 0, totalHistoricTrafficTravelTimeSeconds: 2000, totalNoTrafficTravelTimeSeconds: 1400 }), '+10min (verwacht)');
  // tot en met 1 minuut telt niet
  assert.equal(routeVertraging({ totalTrafficDelaySeconds: 60 }), 'geen');
  assert.equal(routeVertraging({ totalHistoricTrafficTravelTimeSeconds: 1460, totalNoTrafficTravelTimeSeconds: 1400 }), 'geen');
  assert.equal(routeVertraging({}), 'geen');
  assert.equal(routeVertraging(null), 'geen');
});

test('haalDrukteDetail: niet van toepassing (uit, geen toekomstig vertrek, te korte lijn) geeft null zonder verzoek', async () => {
  let n = 0;
  const apiVerzoek = async () => { n++; };
  const rData = { departAtUsed: '2026-10-06T06:00:00.000Z', polyline: [[1, 1], [2, 2]] };
  assert.equal(await haalDrukteDetail({ rData, apiVerzoek, drukteKleuring: false }), null);
  assert.equal(await haalDrukteDetail({ rData: { ...rData, departAtUsed: null }, apiVerzoek, drukteKleuring: true }), null);
  assert.equal(await haalDrukteDetail({ rData: { ...rData, polyline: [[1, 1]] }, apiVerzoek, drukteKleuring: true }), null);
  assert.equal(await haalDrukteDetail({ rData: null, apiVerzoek, drukteKleuring: true }), null);
  assert.equal(n, 0);
});

test('haalDrukteDetail: POST /api/drukte met de routelijn, het vertrek en de stukjes van 1500 m; geeft segmenten en info terug', async () => {
  const oproepen = [];
  const apiVerzoek = async (pad, opties) => {
    oproepen.push({ pad, opties });
    return { ok: true, status: 200, data: { segmenten: [{ startIndex: 0, endIndex: 1 }], reconstructie: true, onbetrouwbaar: 0, aantalAanvragen: 1 } };
  };
  const rData = { departAtUsed: '2026-10-06T06:00:00.000Z', polyline: [[1, 1], [2, 2], [3, 3]] };
  const r = await haalDrukteDetail({ rData, apiVerzoek, drukteKleuring: true });
  assert.equal(DRUKTE_SEGMENT_METERS, 1500);
  assert.equal(oproepen.length, 1);
  assert.equal(oproepen[0].pad, '/api/drukte');
  assert.equal(oproepen[0].opties.methode, 'POST');
  assert.deepEqual(oproepen[0].opties.body, { polyline: rData.polyline, departAt: rData.departAtUsed, segmentMeters: 1500 });
  assert.deepEqual(r.segmenten, [{ startIndex: 0, endIndex: 1 }]);
  assert.deepEqual(r.info, { reconstructie: true, onbetrouwbaar: 0, aantalAanvragen: 1 });
});

test('haalDrukteDetail: een fout van de server of het netwerk wordt gegooid (de oproeper beslist)', async () => {
  const rData = { departAtUsed: '2026-10-06T06:00:00.000Z', polyline: [[1, 1], [2, 2]] };
  const gevallen = [
    async () => ({ ok: false, status: 500, data: { error: 'stuk' } }),
    async () => ({ ok: true, status: 200, data: { error: 'TomTom weigert' } }),
    async () => ({ ok: true, status: 200, data: {} }),
    async () => { throw new TypeError('netwerk'); },
  ];
  for (const apiVerzoek of gevallen) await assert.rejects(() => haalDrukteDetail({ rData, apiVerzoek, drukteKleuring: true }));
});

