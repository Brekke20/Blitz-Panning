import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_START_PER_RUN, MAX_MIGRATIE_PER_RUN, kiesTeStarten, kiesTeMigreren, maakMigratie,
} from '../netlify/lib/rapport-vangnet-logica.js';
import { voerVangnetUit } from '../netlify/lib/rapport-vangnet-run.js';
import { LIJST_KEY } from '../netlify/lib/rapportlijst.js';
import { INHOUD_PREFIX } from '../netlify/lib/rapport-inhoud.js';

const MIN = 60_000;
const NU = new Date('2026-10-08T10:00:00.000Z');
const voor = min => new Date(NU.getTime() - min * MIN).toISOString();
const verw = (status, extra = {}) => ({ status, pogingen: 0, volgendePoging: null, laatsteFout: null, bijgewerkt: voor(1), ...extra });
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function nepStore() {
  const m = new Map();
  const schrijfTeller = {};
  return {
    m, schrijfTeller,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { schrijfTeller[k] = (schrijfTeller[k] ?? 0) + 1; m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
  };
}

test('constanten', () => {
  assert.equal(MAX_START_PER_RUN, 5);
  assert.equal(MAX_MIGRATIE_PER_RUN, 20);
});

test('kiesTeStarten: respecteert max 5 en volgorde; negeert entries zonder verwerking, in-zoho, mislukt', () => {
  // De lijst staat nieuwste eerst; "oudste eerst" = achteraan beginnen.
  const wacht = n => ({ id: `w${n}`, verwerking: verw('wacht') });
  const rapports = [
    wacht(1), wacht(2),
    { id: 'oud' },
    { id: 'klaar', verwerking: verw('in-zoho') },
    { id: 'stuk', verwerking: verw('mislukt') },
    { id: 'lokaal', verwerking: verw('lokaal') },
    wacht(3), wacht(4), wacht(5), wacht(6), wacht(7),
  ];
  assert.deepEqual(kiesTeStarten(rapports, NU), ['w7', 'w6', 'w5', 'w4', 'w3']);
  assert.deepEqual(kiesTeStarten(rapports, NU, 2), ['w7', 'w6']);
  const toekomst = new Date(NU.getTime() + MIN).toISOString();
  assert.deepEqual(kiesTeStarten([{ id: 'x', verwerking: verw('wacht', { volgendePoging: toekomst }) }], NU), []);
});

test('kiesTeStarten: bezig > 20 min wordt opnieuw gestart, bezig < 20 min niet', () => {
  const rapports = [
    { id: 'vers', verwerking: verw('bezig', { bijgewerkt: voor(19) }) },
    { id: 'vast', verwerking: verw('bezig', { bijgewerkt: voor(21) }) },
  ];
  assert.deepEqual(kiesTeStarten(rapports, NU), ['vast']);
});

test('kiesTeMigreren: enkel entries met inline _html, max 20', () => {
  const rapports = [];
  for (let i = 0; i < 25; i++) rapports.push({ id: uuid(i), rapportData: { _html: `<p>${i}</p>` } });
  rapports.push({ id: 'licht', rapportData: { probleem: 'x' } }, { id: 'leeg', rapportData: { _html: '' } }, { id: 'geen', rapportData: null });
  const gekozen = kiesTeMigreren(rapports);
  assert.equal(gekozen.length, 20);
  assert.ok(gekozen.every(e => typeof e.rapportData._html === 'string' && e.rapportData._html));
  assert.equal(kiesTeMigreren(rapports, 3).length, 3);
  assert.deepEqual(kiesTeMigreren([rapports[25], rapports[26], rapports[27]]), []);
});

test('maakMigratie: html naar inhoud, lichte entry zonder _html/handtekeningen met inhoudBeschikbaar true, zonder verwerking-veld', () => {
  const entry = {
    id: uuid(1), ticketId: '555', ticketNumber: '1006', datum: '2026-09-01', zohoUploaded: true, verzondenKlant: true,
    rapportData: { _html: '<p>x</p>', handtekeningTech: 'data:a', handtekeningKlant: 'data:b', probleem: 'p' },
  };
  const { inhoud, lichteEntry } = maakMigratie(entry, NU);
  assert.deepEqual(inhoud, { id: uuid(1), html: '<p>x</p>', ticketId: '555', filename: 'rapport-1006-2026-09-01.pdf', isLocal: false });
  assert.deepEqual(lichteEntry.rapportData, { probleem: 'p' });
  assert.equal(lichteEntry.inhoudBeschikbaar, true);
  assert.equal('verwerking' in lichteEntry, false);
  assert.equal(lichteEntry.zohoUploaded, true);
  assert.equal(lichteEntry.verzondenKlant, true);
  const zonder = maakMigratie({ id: uuid(2), ticketId: '7', rapportData: { _html: 'h' } }, NU);
  assert.equal(zonder.inhoud.filename, 'rapport-7-onbekend.pdf');
});

async function lijstMet(store, aantal) {
  const rapports = [];
  for (let i = 0; i < aantal; i++) {
    rapports.push({
      id: uuid(i), ticketId: String(1000 + i), ticketNumber: String(2000 + i), datum: '2026-09-01',
      zohoUploaded: i % 2 === 0, verzondenKlant: i % 3 === 0,
      rapportData: { _html: `<p>${i}</p>`, handtekeningTech: 'x', probleem: `p${i}` },
    });
  }
  await store.setJSON(LIJST_KEY, { versie: 5, rapports });
  return rapports;
}
const geen = async () => {};

test('voerVangnetUit: migreert 20 van 25 per run; tweede run de resterende 5; inhoudsblobs bestaan; lijst bevat geen _html meer; entries blijven in dezelfde volgorde en behouden alle andere velden', async () => {
  const store = nepStore();
  const orig = await lijstMet(store, 25);
  const r1 = await voerVangnetUit({ store, start: geen, verwerk: geen, nu: NU });
  assert.equal(r1.gemigreerd, 20);
  let lijst = (await store.get(LIJST_KEY)).rapports;
  assert.equal(lijst.filter(e => e.rapportData?._html).length, 5);
  const r2 = await voerVangnetUit({ store, start: geen, verwerk: geen, nu: NU });
  assert.equal(r2.gemigreerd, 5);
  lijst = (await store.get(LIJST_KEY)).rapports;
  assert.equal(lijst.length, 25);
  assert.deepEqual(lijst.map(e => e.id), orig.map(e => e.id));
  for (let i = 0; i < 25; i++) {
    const e = lijst[i];
    assert.equal(e.rapportData._html, undefined);
    assert.equal(e.rapportData.handtekeningTech, undefined);
    assert.equal(e.rapportData.probleem, `p${i}`);
    assert.equal(e.inhoudBeschikbaar, true);
    assert.equal(e.zohoUploaded, orig[i].zohoUploaded);
    assert.equal(e.verzondenKlant, orig[i].verzondenKlant);
    assert.equal(e.ticketId, orig[i].ticketId);
    assert.equal('verwerking' in e, false);
    const blob = await store.get(INHOUD_PREFIX + e.id);
    assert.equal(blob.html, `<p>${i}</p>`);
    assert.equal(blob.filename, `rapport-${2000 + i}-2026-09-01.pdf`);
  }
  const r3 = await voerVangnetUit({ store, start: geen, verwerk: geen, nu: NU });
  assert.equal(r3.gemigreerd, 0);
});

test('voerVangnetUit: één lijst-write per run voor de migratie', async () => {
  const store = nepStore();
  await lijstMet(store, 25);
  store.schrijfTeller[LIJST_KEY] = 0;
  await voerVangnetUit({ store, start: geen, verwerk: geen, nu: NU });
  assert.equal(store.schrijfTeller[LIJST_KEY], 1);
});

test('voerVangnetUit: migratie slaat een entry over waarvan de blob al bestaat zonder ze te herschrijven', async () => {
  const store = nepStore();
  await lijstMet(store, 2);
  store.m.set(INHOUD_PREFIX + uuid(0), JSON.stringify({ id: uuid(0), html: '<p>BESTAAND</p>' }));
  store.schrijfTeller[INHOUD_PREFIX + uuid(0)] = 0;
  const r = await voerVangnetUit({ store, start: geen, verwerk: geen, nu: NU });
  assert.equal(r.gemigreerd, 2);
  assert.equal(store.schrijfTeller[INHOUD_PREFIX + uuid(0)], 0);
  assert.equal((await store.get(INHOUD_PREFIX + uuid(0))).html, '<p>BESTAAND</p>');
  assert.equal((await store.get(INHOUD_PREFIX + uuid(1))).html, '<p>1</p>');
  assert.ok((await store.get(LIJST_KEY)).rapports.every(e => !e.rapportData._html));
});

test('voerVangnetUit: start() voor elk te starten rapport (max 5)', async () => {
  const store = nepStore();
  const rapports = [];
  for (let i = 0; i < 7; i++) rapports.push({ id: uuid(i), verwerking: verw('wacht') });
  await store.setJSON(LIJST_KEY, { versie: 1, rapports });
  const gestart = [];
  const r = await voerVangnetUit({
    store, nu: NU,
    start: async id => { gestart.push(id); },
    verwerk: async () => assert.fail('verwerk niet verwacht'),
  });
  assert.equal(gestart.length, 5);
  assert.deepEqual(r.gestart, gestart);
});

test('voerVangnetUit: zelfVerwerken → verwerk() voor precies 1 rapport, start() nooit', async () => {
  const store = nepStore();
  const rapports = [];
  for (let i = 0; i < 3; i++) rapports.push({ id: uuid(i), verwerking: verw('wacht') });
  await store.setJSON(LIJST_KEY, { versie: 1, rapports });
  const verwerkt = [];
  const r = await voerVangnetUit({
    store, zelfVerwerken: true, nu: NU,
    start: async () => assert.fail('start niet verwacht'),
    verwerk: async id => { verwerkt.push(id); },
  });
  assert.deepEqual(verwerkt, [uuid(2)]);
  assert.deepEqual(r.gestart, [uuid(2)]);
});

test('voerVangnetUit: tijdsbudget 0 → geen migraties', async () => {
  const store = nepStore();
  await lijstMet(store, 3);
  const r = await voerVangnetUit({ store, start: geen, verwerk: geen, nu: NU, tijdsbudgetMs: 0 });
  assert.equal(r.gemigreerd, 0);
  assert.ok((await store.get(LIJST_KEY)).rapports.every(e => e.rapportData._html));
  assert.equal(Object.keys(store.schrijfTeller).filter(k => k.startsWith(INHOUD_PREFIX)).length, 0);
});

test('voerVangnetUit: een fout bij start() stopt de migratie niet', async () => {
  const store = nepStore();
  await lijstMet(store, 2);
  const lijst = await store.get(LIJST_KEY);
  lijst.rapports.push({ id: uuid(99), verwerking: verw('wacht') });
  await store.setJSON(LIJST_KEY, lijst);
  const r = await voerVangnetUit({ store, start: async () => { throw new Error('boem'); }, verwerk: geen, nu: NU });
  assert.equal(r.gemigreerd, 2);
});
