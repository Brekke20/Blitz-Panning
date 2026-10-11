// tests/dashboard-techniekers.test.mjs — de technieker in het dashboard is een Zoho-naam, niet de vrije tekst in het rapport.
// Koppeling (netlify/lib/dashboard/techniekers.js) en de metrics erop (totaal per rapport, per technieker voor elk).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakKoppelaar, splitsNamen, NIET_GEKOPPELD } from '../netlify/lib/dashboard/techniekers.js';
import { berekenDashboard } from '../netlify/lib/dashboard-metrics.js';

const AGENTEN = ['Brent Calaerts', 'Kursat Deniz', 'Tim Janssens', 'Sven Peeters', 'Anouk Peeters', 'José Verbeke', 'Roel'];
const koppelaar = (extra = {}) => maakKoppelaar({ agenten: AGENTEN, accounts: [], ...extra });
const namen = (k, tekst, rest = {}) => k({ technieker: tekst, ...rest }).namen;

test('splitsNamen: + & , ; / en " en " splitsen; een naam met "en" erin blijft heel', () => {
  assert.deepEqual(splitsNamen('Brent + Deniz'), ['Brent', 'Deniz']);
  assert.deepEqual(splitsNamen('Tim&Sven, Roel; Anouk / Jose'), ['Tim', 'Sven', 'Roel', 'Anouk', 'Jose']);
  assert.deepEqual(splitsNamen('Tim en Sven'), ['Tim', 'Sven']);
  assert.deepEqual(splitsNamen('Ken Jensen'), ['Ken Jensen']);
  assert.deepEqual(splitsNamen('  '), []);
  assert.deepEqual(splitsNamen(null), []);
});

test('alle namen uit het scherm: brent, Brent, Brent Calaerts -> Brent Calaerts; Deniz, K. Deniz, K.Deniz -> Kursat Deniz', () => {
  const k = koppelaar();
  for (const t of ['brent', 'Brent', 'Brent Calaerts', ' BRENT  calaerts ']) assert.deepEqual(namen(k, t), ['Brent Calaerts'], t);
  for (const t of ['Deniz', 'K. Deniz', 'K.Deniz', 'k deniz', 'Kursat', 'Kursat Deniz']) assert.deepEqual(namen(k, t), ['Kursat Deniz'], t);
});

test('"Brent + Deniz" geeft twee Zoho-namen (geen dubbele bij "Brent + Brent Calaerts")', () => {
  const k = koppelaar();
  const r = k({ technieker: 'Brent + Deniz' });
  assert.deepEqual(r.namen, ['Brent Calaerts', 'Kursat Deniz']);
  assert.deepEqual(r.groepen, ['Brent Calaerts', 'Kursat Deniz']);
  assert.deepEqual(r.onbekend, []);
  assert.deepEqual(namen(k, 'Brent + Brent Calaerts'), ['Brent Calaerts']);
  assert.deepEqual(namen(k, 'Tim en Sven & Roel'), ['Tim Janssens', 'Sven Peeters', 'Roel']);
});

test('accenten en punten tellen niet: "jose", "JOSÉ", "J.Verbeke" -> José Verbeke', () => {
  const k = koppelaar();
  assert.deepEqual(namen(k, 'jose'), ['José Verbeke']);
  assert.deepEqual(namen(k, 'JOSÉ'), ['José Verbeke']);
  assert.deepEqual(namen(k, 'J.Verbeke'), ['José Verbeke']);
  const k2 = maakKoppelaar({ agenten: ['Jose Verbeke'] }); // accent in de tekst, niet in Zoho
  assert.deepEqual(namen(k2, 'José'), ['Jose Verbeke']);
});

test('dubbelzinnig of onbekend: "Niet gekoppeld", met de ruwe stukken als uitleg', () => {
  const k = koppelaar();
  const peeters = k({ technieker: 'Peeters' }); // Sven Peeters en Anouk Peeters
  assert.deepEqual(peeters.namen, []);
  assert.deepEqual(peeters.groepen, [NIET_GEKOPPELD]);
  assert.deepEqual(peeters.onbekend, ['Peeters']);
  const typfout = k({ technieker: 'Bernt' });
  assert.deepEqual(typfout.groepen, [NIET_GEKOPPELD]);
  assert.deepEqual(typfout.onbekend, ['Bernt']);
  const leeg = k({ technieker: '' });
  assert.deepEqual(leeg.groepen, [NIET_GEKOPPELD]);
  assert.deepEqual(leeg.onbekend, []);
  assert.deepEqual(k({}).groepen, [NIET_GEKOPPELD]);
});

test('twee agenten met dezelfde voornaam: "Brent" is dubbelzinnig, de volledige naam niet; initiaal + achternaam ook niet', () => {
  const k = maakKoppelaar({ agenten: ['Brent Calaerts', 'Brent Peeters'] });
  assert.deepEqual(k({ technieker: 'Brent' }).groepen, [NIET_GEKOPPELD]);
  assert.deepEqual(namen(k, 'Brent Calaerts'), ['Brent Calaerts']);
  assert.deepEqual(namen(k, 'B.Peeters'), ['Brent Peeters']);
  assert.deepEqual(namen(k, 'Peeters'), ['Brent Peeters']); // enige met die achternaam
});

test('één stuk past, één niet: de naam telt en het rapport staat er ook bij "Niet gekoppeld"', () => {
  const r = koppelaar()({ technieker: 'Tim + Bernt' });
  assert.deepEqual(r.namen, ['Tim Janssens']);
  assert.deepEqual(r.groepen, ['Tim Janssens', NIET_GEKOPPELD]);
  assert.deepEqual(r.onbekend, ['Bernt']);
});

test('ingediendDoor wint: de zohoNaam van het account, ook als de tekst iets anders of niets zegt', () => {
  const k = koppelaar({ accounts: [{ id: 'u-1', zohoNaam: 'Tim Janssens', rol: 'technieker' }] });
  assert.deepEqual(namen(k, 'Sven', { ingediendDoor: 'u-1' }), ['Tim Janssens']);
  assert.deepEqual(namen(k, 'Bernt', { ingediendDoor: 'u-1' }), ['Tim Janssens']);
  assert.deepEqual(namen(k, '', { ingediendDoor: 'u-1' }), ['Tim Janssens']);
  assert.deepEqual(k({ technieker: 'Bernt', ingediendDoor: 'u-1' }).groepen, ['Tim Janssens']);
  // Onbekend id of account zonder zohoNaam: de tekst beslist.
  assert.deepEqual(namen(k, 'Sven', { ingediendDoor: 'u-onbekend' }), ['Sven Peeters']);
});

test('ingediendDoor + "Brent + Deniz": de indiener en de eenduidig herkende collega samen', () => {
  const k = koppelaar({ accounts: [{ id: 'u-b', zohoNaam: 'Brent Calaerts', rol: 'technieker' }] });
  assert.deepEqual(namen(k, 'Brent + Deniz', { ingediendDoor: 'u-b' }), ['Brent Calaerts', 'Kursat Deniz']);
  assert.deepEqual(namen(k, 'Brent + Bernt', { ingediendDoor: 'u-b' }), ['Brent Calaerts']);
});

test('een planner of beheerder die een rapport voor een ander indient: de herkende tekst wint; anders zijn eigen zohoNaam', () => {
  const k = koppelaar({ accounts: [{ id: 'u-p', zohoNaam: 'Brent Calaerts', rol: 'planner' }] });
  assert.deepEqual(namen(k, 'Sven', { ingediendDoor: 'u-p' }), ['Sven Peeters']);
  assert.deepEqual(namen(k, 'Bernt', { ingediendDoor: 'u-p' }), ['Brent Calaerts']);
});

test('de spelling van Zoho wint: een account met "brent calaerts" wordt "Brent Calaerts"', () => {
  const k = koppelaar({ accounts: [{ id: 'u-b', zohoNaam: 'brent calaerts', rol: 'technieker' }] });
  assert.deepEqual(namen(k, 'x', { ingediendDoor: 'u-b' }), ['Brent Calaerts']);
});

test('terugval zonder agenten: de zohoNamen van de accounts zijn de kandidaten; zonder beide: null (ruwe tekst, zoals vroeger)', () => {
  const k = maakKoppelaar({ agenten: null, accounts: [{ id: 'u-1', zohoNaam: 'Tim Janssens' }, { id: 'u-2', zohoNaam: 'Kursat Deniz' }, { id: 'u-3' }] });
  assert.deepEqual(namen(k, 'K.Deniz'), ['Kursat Deniz']);
  assert.deepEqual(namen(k, 'tim'), ['Tim Janssens']);
  assert.deepEqual(k({ technieker: 'Brent' }).groepen, [NIET_GEKOPPELD]);
  assert.equal(maakKoppelaar({ agenten: null, accounts: null }), null);
  assert.equal(maakKoppelaar({ agenten: [], accounts: [{ id: 'u-3' }] }), null);
  assert.equal(maakKoppelaar(), null);
});

// ---- metrics ----
const rapport = (id, technieker, extra = {}) => ({
  id, datum: '2026-10-05', technieker, ticketId: `T-${id}`, interventieType: 'Interventie', hersteld: 'ja', nieuwInter: 'nee',
  rapportData: { type: 'CHARX', start: '09:00', stop: '10:00', onderdelen: [{ id: 'o1', naam: 'Relais', aantal: 1, prijs: '10' }] }, ...extra,
});
const SCHERM = [
  rapport('r1', 'brent'), rapport('r2', 'Brent'), rapport('r3', 'Brent + Deniz'), rapport('r4', 'Brent Calaerts'),
  rapport('r5', 'Deniz'), rapport('r6', 'K. Deniz'), rapport('r7', 'K.Deniz'), rapport('r8', 'Bernt'),
];
const berekenMet = (rapporten, extra = {}, bron = { agenten: AGENTEN, accounts: [] }) => berekenDashboard({
  rapporten, filters: { van: '2026-10-01', tot: '2026-10-08', ...extra }, techniekerBron: bron, nu: '2026-10-08T10:00:00.000Z',
  register: { versie: 0, status: {} }, activiteit: [], salesBlobs: [], prijslijst: null,
});

test('de keuzelijst Technieker toont enkel Zoho-namen (gesorteerd) en "Niet gekoppeld" achteraan, nooit ruwe tekst', () => {
  const d = berekenMet(SCHERM);
  assert.deepEqual(d.opties.techniekers, ['Brent Calaerts', 'Kursat Deniz', NIET_GEKOPPELD]);
  assert.deepEqual(d.opties.nietGekoppeld, ['Bernt']);
  const zonderOnbekend = berekenMet(SCHERM.filter(r => r.id !== 'r8'));
  assert.deepEqual(zonderOnbekend.opties.techniekers, ['Brent Calaerts', 'Kursat Deniz']);
  assert.deepEqual(zonderOnbekend.opties.nietGekoppeld, []);
});

test('het totaal telt elk rapport één keer, ook "Brent + Deniz"; per technieker telt het voor elk', () => {
  const d = berekenMet(SCHERM);
  assert.equal(d.kern.huidig.interventies.n, 8);
  assert.equal(d.kern.huidig.firstTimeFix.n, 8);
  assert.equal(d.kern.huidig.onderdelenWaarde.waarde, 80);
  assert.equal(d.tijd.dekking.rapporten, 8);
  const perT = Object.fromEntries(d.kwaliteit.ftfPerTechnieker.map(g => [g.sleutel, g.n]));
  assert.deepEqual(perT, { 'Brent Calaerts': 4, 'Kursat Deniz': 4, [NIET_GEKOPPELD]: 1 }); // r1-r4 voor Brent, r3 r5-r7 voor Deniz
  assert.equal(d.kwaliteit.ftfTotaal.n, 8);
  const duur = Object.fromEntries(d.tijd.duurPer.technieker.map(g => [g.sleutel, g.n]));
  assert.deepEqual(duur, { 'Brent Calaerts': 4, 'Kursat Deniz': 4, [NIET_GEKOPPELD]: 1 });
  const verbruik = d.onderdelen.perMaand;
  assert.equal(verbruik.perTechnieker['Brent Calaerts']['2026-10'].aantal, 4);
  assert.equal(verbruik.perTechnieker['Kursat Deniz']['2026-10'].aantal, 4);
  assert.equal(verbruik.totaal['2026-10'].aantal, 8); // r3 één keer in het totaal
  assert.equal(verbruik.totaal['2026-10'].waarde, 80);
  const perDag = d.tijd.perDagPerTechnieker;
  assert.equal(perDag.waarden['Brent Calaerts']['2026-10-05'], 4);
  assert.equal(perDag.waarden['Kursat Deniz']['2026-10-05'], 4);
});

test('filteren op "Kursat Deniz" toont K.Deniz, K. Deniz, Deniz en "Brent + Deniz"; het totaal telt die rapporten één keer', () => {
  const d = berekenMet(SCHERM, { technieker: 'Kursat Deniz' });
  assert.equal(d.kern.huidig.interventies.n, 4); // r3 r5 r6 r7
  assert.equal(d.tijd.dekking.rapporten, 4);
  assert.equal(d.filters.technieker, 'Kursat Deniz');
  assert.deepEqual(d.opties.techniekers, ['Brent Calaerts', 'Kursat Deniz', NIET_GEKOPPELD]); // de keuzelijst blijft volledig
  const brent = berekenMet(SCHERM, { technieker: 'Brent Calaerts' });
  assert.equal(brent.kern.huidig.interventies.n, 4); // r1 r2 r3 r4
  assert.equal(berekenMet(SCHERM, { technieker: NIET_GEKOPPELD }).kern.huidig.interventies.n, 1);
});

test('ingediendDoor in de metrics: het rapport hangt aan de zohoNaam van het account', () => {
  const bron = { agenten: AGENTEN, accounts: [{ id: 'u-t', zohoNaam: 'Tim Janssens', rol: 'technieker' }] };
  const d = berekenMet([rapport('x1', 'Bernt', { ingediendDoor: 'u-t' }), rapport('x2', 'tim')], {}, bron);
  assert.deepEqual(d.opties.techniekers, ['Tim Janssens']);
  assert.equal(berekenMet([rapport('x1', 'Bernt', { ingediendDoor: 'u-t' })], { technieker: 'Tim Janssens' }, bron).kern.huidig.interventies.n, 1);
});

test('zonder agenten en accounts: het huidige gedrag (ruwe tekst), zonder extra velden in opties', () => {
  const d = berekenMet(SCHERM.slice(0, 3), {}, { agenten: null, accounts: null });
  assert.deepEqual(d.opties.techniekers, ['brent', 'Brent', 'Brent + Deniz']);
  assert.equal('nietGekoppeld' in d.opties, false);
  assert.equal(berekenMet(SCHERM.slice(0, 3), { technieker: 'Brent' }, { agenten: null, accounts: null }).kern.huidig.interventies.n, 1);
  const zonderBron = berekenDashboard({ rapporten: SCHERM.slice(0, 1), filters: { van: '2026-10-01', tot: '2026-10-08' }, nu: '2026-10-08T10:00:00.000Z' });
  assert.deepEqual(zonderBron.opties.techniekers, ['brent']);
});

test('het antwoord bevat geen account-id of rol, enkel namen', () => {
  const bron = { agenten: AGENTEN, accounts: [{ id: 'u-geheim-id', zohoNaam: 'Tim Janssens', rol: 'technieker' }] };
  const tekst = JSON.stringify(berekenMet([rapport('x1', 'tim', { ingediendDoor: 'u-geheim-id' })], {}, bron));
  assert.equal(tekst.includes('u-geheim-id'), false);
});
