import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch } from './nep-fetch.mjs';
import { maakNepStore } from './nep-blobs.mjs';
import { bepaalLocatie, vulLocatiesAan } from '../netlify/lib/sales-locatie.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
// adres-URL -> adrespunt (lat 51.5), postcode-URL -> middelpunt (lat 50.5)
const router = ({ adresFaalt = false } = {}) => url => {
  if (url.includes('/geocode/')) return adresFaalt ? json({ results: [] }) : json({ results: [{ position: { lat: 51.5, lon: 5.5 } }] });
  if (url.includes('structuredGeocode')) {
    const pc = /postalCode=(\d+)/.exec(url)[1];
    return json({ results: [{ position: { lat: 50.5, lon: 4.5 }, address: { municipality: 'Gemeente ' + pc } }] });
  }
  return undefined;
};
const deps = (fetch, extra = {}) => ({ fetch, sleutel: 'NEP', testModus: false, wacht: async () => {}, ...extra });
const volledig = (extra = {}) => ({ id: 'l1', voornaam: 'Marie', naam: 'Janssens', straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', gemeente: 'Kinrooi', locatie: null, ...extra });
const alleenPostcode = (extra = {}) => ({ id: 'l2', naam: 'Peeters', postcode: '3500', gemeente: '', locatie: null, ...extra });

test('bepaalLocatie: volledig adres -> bron adres', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch(router());
  assert.deepEqual(await bepaalLocatie(volledig(), { store, ...deps(fn) }), { lat: 51.5, lon: 5.5, bron: 'adres' });
  assert.equal(calls.length, 1);
});

test('bepaalLocatie: geocode faalt -> terugval op het postcode-middelpunt', async () => {
  const store = maakNepStore();
  const { fn } = maakNepFetch(router({ adresFaalt: true }));
  assert.deepEqual(await bepaalLocatie(volledig(), { store, ...deps(fn) }), { lat: 50.5, lon: 4.5, bron: 'postcode' });
});

test('bepaalLocatie: enkel postcode -> bron postcode (zonder adres-geocoding)', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch(router());
  assert.deepEqual(await bepaalLocatie(alleenPostcode(), { store, ...deps(fn) }), { lat: 50.5, lon: 4.5, bron: 'postcode' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /structuredGeocode/);
});

test('bepaalLocatie: zonder (geldige) postcode -> null zonder fetch', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch(router());
  assert.equal(await bepaalLocatie({ id: 'x', naam: 'Zonder' }, { store, ...deps(fn) }), null);
  assert.equal(await bepaalLocatie({ id: 'x', adresTekst: 'ergens in Limburg' }, { store, ...deps(fn) }), null);
  assert.equal(await bepaalLocatie({ id: 'x', postcode: '36' }, { store, ...deps(fn) }), null);
  assert.equal(calls.length, 0);
});

test('bepaalLocatie: niets gevonden -> null', async () => {
  const store = maakNepStore();
  const { fn } = maakNepFetch(() => json({ results: [] }));
  assert.equal(await bepaalLocatie(alleenPostcode(), { store, ...deps(fn) }), null);
});

test('bepaalLocatie: testmodus geeft nepcoördinaten zonder fetch', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch();
  const r = await bepaalLocatie(volledig(), { store, fetch: fn, testModus: true });
  assert.equal(r.bron, 'adres');
  assert.equal(calls.length, 0);
});

test('vulLocatiesAan: leads met locatie blijven, de rest wordt aangevuld (ook lege gemeente), invoer niet gemuteerd', async () => {
  const store = maakNepStore();
  const { fn } = maakNepFetch(router());
  const bestaand = volledig({ id: 'a', locatie: { lat: 1, lon: 2, bron: 'adres' } });
  const invoer = [bestaand, volledig({ id: 'b' }), alleenPostcode({ id: 'c' }), { id: 'd', naam: 'Zonder' }];
  const kopie = structuredClone(invoer);
  const { leads, open } = await vulLocatiesAan(invoer, { store, ...deps(fn) });
  assert.deepEqual(invoer, kopie);
  assert.deepEqual(leads[0], bestaand);
  assert.deepEqual(leads[1].locatie, { lat: 51.5, lon: 5.5, bron: 'adres' });
  assert.equal(leads[1].gemeente, 'Kinrooi');
  assert.deepEqual(leads[2].locatie, { lat: 50.5, lon: 4.5, bron: 'postcode' });
  assert.equal(leads[2].gemeente, 'Gemeente 3500', 'lege gemeente aangevuld');
  assert.equal(leads[3].locatie, undefined, 'zonder postcode blijft onaangeroerd');
  assert.equal(open, 0, 'een lead zonder postcode telt niet mee');
});

test('vulLocatiesAan: een ingevulde gemeente wordt niet overschreven', async () => {
  const { fn } = maakNepFetch(router());
  const { leads } = await vulLocatiesAan([alleenPostcode({ gemeente: 'Hasselt' })], { store: maakNepStore(), ...deps(fn) });
  assert.equal(leads[0].gemeente, 'Hasselt');
});

test('vulLocatiesAan: adres faalt -> postcode-terugval', async () => {
  const { fn } = maakNepFetch(router({ adresFaalt: true }));
  const { leads, open } = await vulLocatiesAan([volledig()], { store: maakNepStore(), ...deps(fn) });
  assert.equal(leads[0].locatie.bron, 'postcode');
  assert.equal(open, 0);
});

test('vulLocatiesAan: open telt wat het budget niet haalde of niet gevonden werd', async () => {
  let klok = 0;
  const { fn } = maakNepFetch(url => {
    klok += 1000;
    return /postalCode=(1111)/.test(url) ? json({ results: [] }) : router()(url);
  });
  const leads = [
    alleenPostcode({ id: 'p1', postcode: '2001' }), alleenPostcode({ id: 'p2', postcode: '2002' }),
    alleenPostcode({ id: 'p3', postcode: '2003' }), alleenPostcode({ id: 'p4', postcode: '2004' }),
    alleenPostcode({ id: 'nf', postcode: '1111' }),
  ];
  const r = await vulLocatiesAan(leads, { store: maakNepStore(), ...deps(fn), parallel: 1, maxTijdMs: 2000, nu: () => klok });
  const metLocatie = r.leads.filter(l => l.locatie).length;
  assert.ok(metLocatie >= 1 && metLocatie < 4, 'budget haalt niet alles: ' + metLocatie);
  assert.equal(r.open, 5 - metLocatie);
  // zonder budgetprobleem: enkel de niet-gevonden postcode blijft open
  const r2 = await vulLocatiesAan(leads, { store: maakNepStore(), ...deps(fn) });
  assert.equal(r2.open, 1);
  assert.equal(r2.leads.find(l => l.id === 'nf').locatie, null);
});

test('vulLocatiesAan: één schrijfactie naar de postcode-cache voor alle leads samen', async () => {
  const store = maakNepStore();
  const { fn } = maakNepFetch(router());
  await vulLocatiesAan([alleenPostcode({ id: '1', postcode: '3001' }), alleenPostcode({ id: '2', postcode: '3002' }), alleenPostcode({ id: '3', postcode: '3001' })], { store, ...deps(fn) });
  assert.equal(store._schrijfacties.length, 1);
});

test('vulLocatiesAan: lege lijst en testmodus', async () => {
  assert.deepEqual(await vulLocatiesAan([], { store: maakNepStore() }), { leads: [], open: 0 });
  const { fn, calls } = maakNepFetch();
  const { leads, open } = await vulLocatiesAan([volledig(), alleenPostcode()], { store: maakNepStore(), fetch: fn, testModus: true });
  assert.equal(open, 0);
  assert.ok(leads.every(l => l.locatie));
  assert.equal(calls.length, 0);
});

test('vulLocatiesAan: adresgeocoding door het budget overgeslagen -> postcode-locatie + vlag; een latere run upgradet naar adres en wist de vlag', async () => {
  let klok = 0;
  const { fn, calls } = maakNepFetch(url => { klok += 1000; return router()(url); });
  const store = maakNepStore();
  const invoer = [
    volledig({ id: 'a1', straat: 'Dorpsstraat' }), volledig({ id: 'a2', straat: 'Kerkstraat' }),
    volledig({ id: 'a3', straat: 'Molenstraat' }), volledig({ id: 'a4', straat: 'Schoolstraat' }),
  ];
  const kopie = structuredClone(invoer);
  // run 1: budget voor de postcode-opzoeking en ongeveer 1 adres-opzoeking
  const r1 = await vulLocatiesAan(invoer, { store, ...deps(fn), parallel: 1, maxTijdMs: 2000, nu: () => klok });
  assert.deepEqual(invoer, kopie, 'invoer niet gemuteerd');
  const adres = r1.leads.filter(l => l.locatie?.bron === 'adres');
  const vlag = r1.leads.filter(l => l.adresTeGeocoderen === true);
  assert.equal(adres.length, 1);
  assert.equal(vlag.length, 3);
  for (const l of vlag) assert.equal(l.locatie.bron, 'postcode', 'plannbaar met postcode-middelpunt');
  assert.ok(adres.every(l => l.adresTeGeocoderen === undefined));
  assert.equal(r1.open, 3, 'open = enkel de nog openstaande adres-upgrades');
  // run 2: ruim budget -> de gevlagde leads worden echt opgepakt en geupgrade
  const vooraf = calls.length;
  const r2 = await vulLocatiesAan(r1.leads, { store, ...deps(fn) });
  assert.ok(calls.length > vooraf, 'er werd opnieuw geocodeerd');
  assert.equal(r2.open, 0);
  for (const l of r2.leads) {
    assert.deepEqual(l.locatie, { lat: 51.5, lon: 5.5, bron: 'adres' });
    assert.equal('adresTeGeocoderen' in l, false, 'vlag gewist');
  }
});

test('vulLocatiesAan: gevlagde lead waarvan het adres onvindbaar blijkt -> postcode-locatie blijft, vlag weg (geen eindeloze pogingen)', async () => {
  const { fn } = maakNepFetch(router({ adresFaalt: true }));
  const lead = volledig({ locatie: { lat: 50.5, lon: 4.5, bron: 'postcode' }, adresTeGeocoderen: true });
  const { leads, open } = await vulLocatiesAan([lead], { store: maakNepStore(), ...deps(fn) });
  assert.deepEqual(leads[0].locatie, { lat: 50.5, lon: 4.5, bron: 'postcode' });
  assert.equal('adresTeGeocoderen' in leads[0], false);
  assert.equal(open, 0);
});

test('vulLocatiesAan: gevlagde lead zonder bruikbaar adres (adres gewijzigd naar enkel postcode) -> vlag weg zonder fetch', async () => {
  const { fn, calls } = maakNepFetch(router());
  const lead = alleenPostcode({ locatie: { lat: 50.5, lon: 4.5, bron: 'postcode' }, adresTeGeocoderen: true });
  const { leads, open } = await vulLocatiesAan([lead], { store: maakNepStore(), ...deps(fn) });
  assert.equal('adresTeGeocoderen' in leads[0], false);
  assert.equal(open, 0);
  assert.equal(calls.length, 0);
});

test('vulLocatiesAan: gevlagde lead blijft gevlagd (en telt als open) zolang het budget het adres niet haalt', async () => {
  const { fn, calls } = maakNepFetch(router());
  const lead = volledig({ locatie: { lat: 50.5, lon: 4.5, bron: 'postcode' }, adresTeGeocoderen: true });
  const { leads, open } = await vulLocatiesAan([lead], { store: maakNepStore(), ...deps(fn), maxTijdMs: 0 });
  assert.equal(leads[0].adresTeGeocoderen, true);
  assert.equal(open, 1);
  assert.equal(calls.length, 0);
});
