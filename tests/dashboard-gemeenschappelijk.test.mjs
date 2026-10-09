import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPE_ONBEKEND, MAX_WERKTIJD_MIN, werktijdMinuten, normaliseerRapport, normaliseerSerienummer, normaliseerAdres,
  dagenTussen, inPeriode, vorigePeriode, weekStart, filterRapporten, pct, gemiddelde, mediaan,
} from '../netlify/lib/dashboard/gemeenschappelijk.js';
import { herhaalbezoeken } from '../netlify/lib/dashboard/kwaliteit.js';

const entry = (extra = {}, rd = {}) => ({
  id: 'r1', datum: '2026-10-05', technieker: 'Tim', ticketId: 't1', ticketNumber: '1001', klant: 'Jan', adres: 'Antwerpseweg 50, 2440 Geel',
  interventieType: 'Interventie', hersteld: 'nee', nieuwInter: 'nee', servicetype: '2e-lijn', facturatie: 'klant',
  rapportData: { type: 'Single', ...rd }, ...extra,
});

test('constanten', () => {
  assert.equal(TYPE_ONBEKEND, 'Onbekend');
  assert.equal(MAX_WERKTIJD_MIN, 720);
});

test('werktijdMinuten [RF2]: start/stop met middernacht-wrap', () => {
  assert.equal(werktijdMinuten({ start: '22:00', stop: '02:00' }), 240);
  assert.equal(werktijdMinuten({ start: '08:00', stop: '09:30' }), 90);
  assert.equal(werktijdMinuten({ start: '08:00', stop: '07:59' }), null); // 23u59 > 720
  assert.equal(werktijdMinuten({ start: '08:00', stop: '08:00' }), null);
});

test('werktijdMinuten: tekst als er geen start/stop is', () => {
  assert.equal(werktijdMinuten({ werktijd: '1u30' }), 90);
  assert.equal(werktijdMinuten({ werktijd: '2u' }), 120);
  assert.equal(werktijdMinuten({ werktijd: '45 min' }), 45);
  assert.equal(werktijdMinuten({ werktijd: '' }), null);
  assert.equal(werktijdMinuten({}), null);
  assert.equal(werktijdMinuten(null), null);
  assert.equal(werktijdMinuten({ werktijd: '13u' }), null); // > 720
  assert.equal(werktijdMinuten({ werktijd: 'veel' }), null);
});

test('werktijdMinuten: start/stop gaat voor op de tekst', () => {
  assert.equal(werktijdMinuten({ start: '08:00', stop: '09:00', werktijd: '5u' }), 60);
});

test('normaliseerRapport: geannuleerd en zonder datum is null', () => {
  assert.equal(normaliseerRapport(entry({ geannuleerd: true })), null);
  assert.equal(normaliseerRapport(entry({ verwerking: { status: 'geannuleerd' } })), null);
  assert.equal(normaliseerRapport(entry({ datum: '' })), null);
  assert.equal(normaliseerRapport(entry({ datum: '5/10/2026' })), null);
  assert.equal(normaliseerRapport(null), null);
});

test('normaliseerRapport: andere verwerkingsstatussen tellen mee', () => {
  for (const status of ['mislukt', 'lokaal', 'wacht', 'bezig', 'in-zoho']) {
    assert.ok(normaliseerRapport(entry({ verwerking: { status } })), status);
  }
});

test('normaliseerRapport: basisvelden', () => {
  const r = normaliseerRapport(entry({ hersteld: 'ja' }, { start: '09:05', aanrijtijdMin: 25, oorzaakStoring: ['Productfout', 'Netwerk'], serienummer: ' charx-12 34 ', partner: 'Proxes', regio: 'Kempen', geplandTijdslot: { van: '08:30', tot: '11:30' } }));
  assert.equal(r.id, 'r1');
  assert.equal(r.datum, '2026-10-05');
  assert.equal(r.technieker, 'Tim');
  assert.equal(r.type, 'Single');
  assert.equal(r.hersteld, true);
  assert.equal(r.nieuwInter, false);
  assert.equal(r.start, '09:05');
  assert.equal(r.aanrijtijdMin, 25);
  assert.deepEqual(r.oorzaken, ['Productfout', 'Netwerk']);
  assert.equal(r.serienummer, 'CHARX-1234');
  assert.equal(r.partner, 'Proxes');
  assert.equal(r.regio, 'Kempen');
  assert.deepEqual(r.geplandTijdslot, { van: '08:30', tot: '11:30' });
});

test('normaliseerRapport: leeg type wordt Onbekend; oude entry zonder rapportData crasht niet', () => {
  assert.equal(normaliseerRapport(entry({}, { type: '' })).type, 'Onbekend');
  const oud = normaliseerRapport({ id: 'x', datum: '2026-10-01', technieker: 'Roel' });
  assert.equal(oud.type, 'Onbekend');
  assert.equal(oud.werktijdMin, null);
  assert.equal(oud.werktijdOnbetrouwbaar, false);
  assert.equal(oud.aanrijtijdMin, null);
  assert.deepEqual(oud.oorzaken, []);
  assert.deepEqual(oud.onderdelen, []);
  assert.equal(oud.alLangs, null);
  assert.equal(oud.partner, null);
  assert.equal(oud.regio, null);
  assert.equal(oud.geplandTijdslot, null);
  assert.equal(oud.interventieType, 'Interventie');
});

test('normaliseerRapport: alLangs komt uit installateurAlLangsGeweest, niet uit installateur', () => {
  assert.equal(normaliseerRapport(entry({}, { installateurAlLangsGeweest: 'Ja' })).alLangs, true);
  assert.equal(normaliseerRapport(entry({}, { installateurAlLangsGeweest: 'nee' })).alLangs, false);
  assert.equal(normaliseerRapport(entry({}, { installateurAlLangsGeweest: '' })).alLangs, null);
  assert.equal(normaliseerRapport(entry({}, {})).alLangs, null);
  assert.equal(normaliseerRapport(entry({}, { installateurAlLangsGeweest: '-Geen-' })).alLangs, null);
  assert.equal(normaliseerRapport(entry({}, { installateur: 'Proxes' })).alLangs, null);
  assert.equal(normaliseerRapport(entry({}, { installateur: 'Proxes', installateurAlLangsGeweest: 'Nee' })).alLangs, false);
});

test('normaliseerRapport: onderdelen en prijsbron', () => {
  const prijzen = new Map([['led', { naam: 'LED-module', prijs: 12.5 }]]);
  const r1 = normaliseerRapport(entry({}, { onderdelen: [{ id: 'led', prijs: '8', aantal: 2 }] }), { prijzen });
  assert.deepEqual(r1.onderdelen, [{ sleutel: 'led', naam: 'LED-module', aantal: 2, prijs: 8, prijsBron: 'rapport' }]);
  const r2 = normaliseerRapport(entry({}, { onderdelen: [{ id: 'led', prijs: '', aantal: 1 }] }), { prijzen });
  assert.equal(r2.onderdelen[0].prijs, 12.5);
  assert.equal(r2.onderdelen[0].prijsBron, 'prijslijst');
  const r3 = normaliseerRapport(entry({}, { onderdelen: [{ id: 'vrij-1', naam: ' Zekering ', prijs: '', aantal: 1 }] }), { prijzen });
  assert.equal(r3.onderdelen[0].prijs, 0);
  assert.equal(r3.onderdelen[0].prijsBron, 'geen');
  assert.equal(r3.onderdelen[0].sleutel, 'zekering');
  assert.equal(r3.onderdelen[0].naam, 'Zekering');
  // een vrije regel krijgt nooit een prijs uit de lijst, ook niet bij toeval dezelfde id
  const r4 = normaliseerRapport(entry({}, { onderdelen: [{ id: 'vrij-led', prijs: 0, aantal: 1, naam: 'x' }] }), { prijzen: new Map([['vrij-led', { naam: 'n', prijs: 9 }]]) });
  assert.equal(r4.onderdelen[0].prijsBron, 'geen');
});

test('normaliseerRapport: onderdelen met rommel crashen niet', () => {
  const r = normaliseerRapport(entry({}, { onderdelen: [null, 'x', {}, { id: 'a', naam: 'A', prijs: '1,5', aantal: 'x' }] }));
  assert.equal(r.onderdelen.length, 1);
  assert.equal(r.onderdelen[0].prijs, 1.5);
  assert.equal(r.onderdelen[0].aantal, 1);
  assert.equal(normaliseerRapport(entry({}, { onderdelen: 'kapot', oorzaakStoring: 'kapot' })).onderdelen.length, 0);
});

test('normaliseerRapport: werktijd onbetrouwbaar en aanrijtijd 0', () => {
  const lang = normaliseerRapport(entry({}, { werktijd: '25u' }));
  assert.equal(lang.werktijdMin, null);
  assert.equal(lang.werktijdOnbetrouwbaar, true);
  const nul = normaliseerRapport(entry({}, { start: '08:00', stop: '08:00' }));
  assert.equal(nul.werktijdOnbetrouwbaar, true);
  const goed = normaliseerRapport(entry({}, { start: '08:00', stop: '09:30' }));
  assert.equal(goed.werktijdMin, 90);
  assert.equal(goed.werktijdOnbetrouwbaar, false);
  assert.equal(normaliseerRapport(entry({}, { aanrijtijdMin: 0 })).aanrijtijdMin, null);
  assert.equal(normaliseerRapport(entry({}, { aanrijtijdMin: '35' })).aanrijtijdMin, 35);
});

test('normaliseerRapport: zware velden worden niet doorgegeven', () => {
  const r = normaliseerRapport(entry({}, { _html: '<p>x</p>', fotos: ['data:x'], handtekeningTech: 'data:y' }));
  const tekst = JSON.stringify(r);
  assert.ok(!tekst.includes('data:'));
  assert.ok(!tekst.includes('<p>'));
});

test('normaliseerSerienummer en normaliseerAdres', () => {
  assert.equal(normaliseerSerienummer(' charx-12 34 '), 'CHARX-1234');
  assert.equal(normaliseerSerienummer(''), '');
  assert.equal(normaliseerSerienummer(null), '');
  for (const plaats of ['nvt', 'N.V.T.', 'n/a', '-', '--', '0', '000', '?', 'Onbekend', ' geen ', 'N.A.', 'x', 'XX', 'tbd', 'TBD', 'nb', 'n.b.', '/', ' / ']) assert.equal(normaliseerSerienummer(plaats), '', plaats);
  assert.equal(normaliseerSerienummer('CHARX-0'), 'CHARX-0', 'een echt serienummer met een nul blijft');
  assert.equal(normaliseerAdres('Antwerpseweg 50, 2440 Geel'), 'antwerpseweg502440geel');
  assert.equal(normaliseerAdres('Geel'), '');
  assert.equal(normaliseerAdres('Rue Léopold 12, Liège'), 'rueleopold12liege');
  assert.equal(normaliseerAdres(undefined), '');
});

test('datumhulpen [RF5]', () => {
  assert.equal(dagenTussen('2026-03-28', '2026-03-30'), 2); // zomertijdwissel
  assert.equal(dagenTussen('2026-10-24', '2026-10-26'), 2); // wintertijdwissel
  assert.equal(dagenTussen('2026-10-08', '2026-10-01'), -7);
  assert.deepEqual(vorigePeriode('2026-10-01', '2026-10-08'), { van: '2026-09-23', tot: '2026-09-30' });
  assert.deepEqual(vorigePeriode('2026-03-02', '2026-03-02'), { van: '2026-03-01', tot: '2026-03-01' });
  assert.equal(weekStart('2026-10-08'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(inPeriode('2026-10-01', '2026-10-01', '2026-10-08'), true);
  assert.equal(inPeriode('2026-10-08', '2026-10-01', '2026-10-08'), true);
  assert.equal(inPeriode('2026-10-09', '2026-10-01', '2026-10-08'), false);
  assert.equal(inPeriode('2026-09-30', '2026-10-01', '2026-10-08'), false);
});

test('rekenhulpen [RF1]', () => {
  assert.equal(pct(0, 0), null);
  assert.equal(pct(1, 3), 33.3);
  assert.equal(pct(0, 5), 0);
  assert.equal(pct(5, 5), 100);
  assert.equal(gemiddelde([]), null);
  assert.equal(gemiddelde([1, 2, 6]), 3);
  assert.equal(mediaan([]), null);
  assert.equal(mediaan([1, 3, 2, 10]), 2.5);
  assert.equal(mediaan([5, 1, 3]), 3);
});

test('filterRapporten', () => {
  const lijst = [
    { technieker: 'Tim', type: 'Dual 1' }, { technieker: 'Tim', type: 'Single' },
    { technieker: 'Roel', type: 'Dual 1' },
  ];
  assert.equal(filterRapporten(lijst).length, 3);
  assert.equal(filterRapporten(lijst, { technieker: '', type: '' }).length, 3);
  assert.equal(filterRapporten(lijst, { type: 'Dual 1' }).length, 2);
  assert.deepEqual(filterRapporten(lijst, { technieker: 'Tim', type: 'Dual 1' }), [lijst[0]]);
});

test('plaatshouder-serienummer is geen herhaalbezoek-sleutel: valt terug op het adres (eindreview M3)', () => {
  const a = normaliseerRapport(entry({ id: 'a', datum: '2026-10-01', adres: 'Antwerpseweg 50, 2440 Geel' }, { serienummer: 'nvt' }));
  const b = normaliseerRapport(entry({ id: 'b', datum: '2026-10-10', adres: 'Kerkstraat 1, 9000 Gent' }, { serienummer: 'NVT' }));
  assert.equal(a.serienummer, '');
  assert.equal(herhaalbezoeken([a, b], [b], 30).length, 0, 'twee verschillende klanten met "nvt" zijn geen herhaalbezoek');
  const c = normaliseerRapport(entry({ id: 'c', datum: '2026-10-10', adres: 'Antwerpseweg 50, 2440 Geel' }, { serienummer: '-' }));
  const [h] = herhaalbezoeken([a, c], [c], 30);
  assert.equal(h.vorigeId, 'a', 'zelfde adres blijft wel een herhaalbezoek');
});
