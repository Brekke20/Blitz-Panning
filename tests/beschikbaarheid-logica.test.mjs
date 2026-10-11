process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWorkday, groupExceptionsForDisplay, valideerNieuweBlokkering, bouwPersonenlijst,
  bouwVoorWieGroepen, verkoperWaarde, verkoperIdUitWaarde, maakVerkoperBlokken, verkoperBlokkenNaarUitzonderingen } from '../public/js/schermen/beschikbaarheid-logica.js';
import { isHeleDag } from '../public/js/sales/blok-regels.js';

const MA_VR = [1, 2, 3, 4, 5];

test('bewaking: tijdzone is Europe/Brussels', () => {
  assert.equal(new Date(2026, 6, 1, 12).getTimezoneOffset(), -120);
});

test('nextWorkday: gewone werkdag geeft de volgende dag', () => {
  assert.equal(nextWorkday('2026-10-06', MA_VR), '2026-10-07'); // di -> wo
});

test('nextWorkday: vrijdag, zaterdag en zondag geven maandag', () => {
  assert.equal(nextWorkday('2026-10-09', MA_VR), '2026-10-12'); // vr
  assert.equal(nextWorkday('2026-10-10', MA_VR), '2026-10-12'); // za
  assert.equal(nextWorkday('2026-10-11', MA_VR), '2026-10-12'); // zo
});

test('nextWorkday: overgang naar wintertijd (zo 25 okt 2026) en zomertijd (zo 29 mrt 2026)', () => {
  assert.equal(nextWorkday('2026-10-23', MA_VR), '2026-10-26'); // vr voor de wintertijd
  assert.equal(nextWorkday('2026-10-25', MA_VR), '2026-10-26'); // de dag van de overgang zelf
  assert.equal(nextWorkday('2026-03-27', MA_VR), '2026-03-30');
  assert.equal(nextWorkday('2026-03-29', MA_VR), '2026-03-30');
});

test('nextWorkday: volgt de ingestelde werkdagen (donderdag vrij -> vrijdag)', () => {
  assert.equal(nextWorkday('2026-10-07', [1, 2, 3, 5]), '2026-10-09'); // wo -> vr
});

const BLOK = (o) => ({ id: 'x', scope: 'global', person: null, kind: 'fullday', from: null, to: null, reason: '', ...o });

test('groupExceptionsForDisplay: lege lijst geeft geen groepen', () => {
  assert.deepEqual(groupExceptionsForDisplay([], MA_VR), []);
});

test('groupExceptionsForDisplay: aaneensluitende werkdagen, weekend ertussen breekt niet', () => {
  const lijst = [BLOK({ id: 'a', date: '2026-10-09', reason: 'Verlof' }), BLOK({ id: 'b', date: '2026-10-12', reason: 'Verlof' })];
  const g = groupExceptionsForDisplay(lijst, MA_VR);
  assert.equal(g.length, 1);
  assert.equal(g[0].startDate, '2026-10-09');
  assert.equal(g[0].endDate, '2026-10-12');
  assert.deepEqual(g[0].items.map(e => e.id), ['a', 'b']);
});

test('groupExceptionsForDisplay: een gewone werkdag ertussen breekt de groep', () => {
  const lijst = [BLOK({ id: 'a', date: '2026-10-12', reason: 'Verlof' }), BLOK({ id: 'b', date: '2026-10-14', reason: 'Verlof' })];
  assert.equal(groupExceptionsForDisplay(lijst, MA_VR).length, 2);
});

test('groupExceptionsForDisplay: andere persoon, scope of reden breekt de groep', () => {
  const basis = BLOK({ id: 'a', date: '2026-10-06', reason: 'Verlof', scope: 'person', person: 'Tim' });
  assert.equal(groupExceptionsForDisplay([basis, BLOK({ ...basis, id: 'b', date: '2026-10-07', person: 'Roel' })], MA_VR).length, 2);
  assert.equal(groupExceptionsForDisplay([basis, BLOK({ ...basis, id: 'b', date: '2026-10-07', scope: 'global', person: null })], MA_VR).length, 2);
  assert.equal(groupExceptionsForDisplay([basis, BLOK({ ...basis, id: 'b', date: '2026-10-07', reason: 'Dokter' })], MA_VR).length, 2);
  assert.equal(groupExceptionsForDisplay([basis, BLOK({ ...basis, id: 'b', date: '2026-10-07' })], MA_VR).length, 1);
});

test('groupExceptionsForDisplay: tijdvakken worden nooit samengevoegd', () => {
  const r = (id, date) => BLOK({ id, date, kind: 'range', from: '09:00', to: '10:00', reason: 'Dokter' });
  const g = groupExceptionsForDisplay([r('a', '2026-10-19'), r('b', '2026-10-20')], MA_VR);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map(x => x.items.length), [1, 1]);
});

test('groupExceptionsForDisplay: een hele dag direct na een tijdvak (of omgekeerd) blijft apart', () => {
  const lijst = [BLOK({ id: 'a', date: '2026-10-19', kind: 'range', from: '09:00', to: '10:00' }), BLOK({ id: 'b', date: '2026-10-20' })];
  assert.equal(groupExceptionsForDisplay(lijst, MA_VR).length, 2);
  assert.equal(groupExceptionsForDisplay([lijst[1], BLOK({ id: 'c', date: '2026-10-21', kind: 'range', from: '09:00', to: '10:00' })], MA_VR).length, 2);
});

test('groupExceptionsForDisplay: de groep draagt soort, scope, persoon en reden van de eerste regel; de invoer blijft ongemuteerd', () => {
  const e = BLOK({ id: 'a', date: '2026-10-06', reason: 'R', scope: 'person', person: 'Tim' });
  const lijst = [e];
  const g = groupExceptionsForDisplay(lijst, MA_VR);
  assert.deepEqual(g[0], { kind: 'fullday', scope: 'person', person: 'Tim', reason: 'R', startDate: '2026-10-06', endDate: '2026-10-06', items: [e] });
  assert.deepEqual(lijst, [e]);
});

// W5-bugfix: lege werkdagen mogen nooit een oneindige lus geven. Een synchrone lus laat zich niet
// door een test-timeout onderbreken, dus draaien deze proeven in een apart proces met harde timeout.
import { spawnSync } from 'node:child_process';
const LOGICA_URL = new URL('../public/js/schermen/beschikbaarheid-logica.js', import.meta.url).href;
function inProces(code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `process.env.TZ='Europe/Brussels'; import(${JSON.stringify(LOGICA_URL)}).then(m => { ${code} });`],
    { timeout: 3000, encoding: 'utf8' });
  assert.equal(r.error, undefined, 'proces liep vast of faalde: ' + (r.error && r.error.message));
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('nextWorkday: geen enkele werkdag -> null (geen oneindige lus)', () => {
  assert.deepEqual(inProces(`console.log(JSON.stringify(m.nextWorkday('2026-10-06', [])))`), null);
});

test('groupExceptionsForDisplay: lege werkdagen voegt niets samen, rijen blijven apart', () => {
  const lijst = [
    { kind: 'fullday', scope: 'all', person: 'A', reason: 'verlof', date: '2026-10-06' },
    { kind: 'fullday', scope: 'all', person: 'A', reason: 'verlof', date: '2026-10-07' },
    { kind: 'fullday', scope: 'all', person: 'A', reason: 'verlof', date: '2026-10-08' }
  ];
  const g = inProces(`console.log(JSON.stringify(m.groupExceptionsForDisplay(${JSON.stringify(lijst)}, [])))`);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map(x => x.startDate), ['2026-10-06', '2026-10-07', '2026-10-08']);
});

test('nextWorkday: jaargrens, 31 dec -> eerstvolgende werkdag in januari', () => {
  assert.equal(nextWorkday('2026-12-31', MA_VR), '2027-01-01'); // do -> vr
  assert.equal(nextWorkday('2027-12-31', MA_VR), '2028-01-03'); // vr -> ma
  assert.equal(nextWorkday('2025-12-31', [1, 2, 3, 4, 5]), '2026-01-01');
});

test('valideerNieuweBlokkering: de vier weigeringen met exacte tekst en in de vastgelegde volgorde', () => {
  // 1. eindtijd voor begintijd gaat voor een lege datum
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'range', meerdaags: false, datum: '', datumTot: '', van: '10:00', tot: '09:00' }),
    { ok: false, melding: '⚠ Eindtijd moet na begintijd liggen' });
  // 2. lege datum
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '', datumTot: '', van: null, tot: null }),
    { ok: false, melding: '⚠ Kies een datum' });
  // 3. meerdaags zonder einddatum
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '2026-10-13', datumTot: '', van: null, tot: null }),
    { ok: false, melding: '⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit' });
  // 4. einddatum voor startdatum
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '2026-10-14', datumTot: '2026-10-13', van: null, tot: null }),
    { ok: false, melding: '⚠ Einddatum moet na startdatum liggen' });
});

test('valideerNieuweBlokkering: geldig: hele dag, tijdvak, periode', () => {
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: false, datum: '2026-10-13', datumTot: null, van: null, tot: null }), { ok: true });
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'range', meerdaags: false, datum: '2026-10-13', datumTot: null, van: '09:00', tot: '12:00' }), { ok: true });
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '2026-10-13', datumTot: '2026-10-13', van: null, tot: null }), { ok: true });
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '2026-10-13', datumTot: '2026-10-16', van: null, tot: null }), { ok: true });
});

test('valideerNieuweBlokkering: lege datum bij een tijdvak wordt ook geweigerd', () => {
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'range', meerdaags: false, datum: '', datumTot: null, van: '09:00', tot: '12:00' }),
    { ok: false, melding: '⚠ Kies een datum' });
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: false, datum: null, datumTot: null, van: null, tot: null }),
    { ok: false, melding: '⚠ Kies een datum' });
});

test('valideerNieuweBlokkering: meerdaags uitgevinkt met lege datumTot is geldig', () => {
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: false, datum: '2026-10-13', datumTot: '', van: null, tot: null }), { ok: true });
});

const ACCOUNTS = [
  { id: 'a', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true },
  { id: 'b', naam: 'Roel Techniek', rol: 'technieker', zohoNaam: ' Roel ', actief: true },
  { id: 'c', naam: 'Kursat Deniz', rol: 'technieker', zohoNaam: 'Kursat Deniz', actief: false }, // vertrokken (geblokkeerd)
  { id: 'd', naam: 'Test Beheerder', rol: 'beheerder', actief: true }, // geen Zoho-naam
  { id: 'e', naam: 'Plan Ner', rol: 'planner', zohoNaam: 'Tim', actief: true }, // dubbele naam telt één keer
  { id: 'f', naam: 'Leeg', rol: 'technieker', zohoNaam: '  ', actief: true },
  null,
];
const TICKETS = [{ assignee: 'Kursat Deniz' }, { assignee: 'Tim' }, { assignee: null }];

test('bouwPersonenlijst: met gebruikerslijst enkel actieve accounts met een Zoho-naam, op die naam, gesorteerd', () => {
  assert.deepEqual(bouwPersonenlijst({ gebruikers: ACCOUNTS, ticketLijsten: [TICKETS], exceptions: [{ person: 'Kursat Deniz' }] }), ['Roel', 'Tim']);
});

test('bouwPersonenlijst: gebruikerslijst geladen maar zonder geschikte accounts geeft een lege lijst (geen terugval)', () => {
  assert.deepEqual(bouwPersonenlijst({ gebruikers: [{ naam: 'Beheer', rol: 'beheerder', actief: true }], ticketLijsten: [TICKETS] }), []);
  assert.deepEqual(bouwPersonenlijst({ gebruikers: [], ticketLijsten: [TICKETS] }), []);
});

test('bouwPersonenlijst: zonder gebruikerslijst (null/geen array) terugval op tickets en afwezigheden', () => {
  const verwacht = ['Kursat Deniz', 'Roel', 'Tim'];
  const exceptions = [{ person: 'Roel' }, { person: null }, { scope: 'global', person: null }];
  assert.deepEqual(bouwPersonenlijst({ gebruikers: null, ticketLijsten: [TICKETS, [], undefined], exceptions }), verwacht);
  assert.deepEqual(bouwPersonenlijst({ ticketLijsten: [TICKETS], exceptions }), verwacht);
  assert.deepEqual(bouwPersonenlijst({ gebruikers: 'kapot', ticketLijsten: [TICKETS], exceptions }), verwacht);
});

test('bouwPersonenlijst: zonder enige invoer een lege lijst', () => {
  assert.deepEqual(bouwPersonenlijst(), []);
});

// ---- "Voor wie": alle accounts, gegroepeerd (L1) ----
const ALLE = [
  { id: 'a', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true },
  { id: 'b', naam: 'Roel Techniek', rol: 'technieker', zohoNaam: ' Roel ', actief: true },
  { id: 'c', naam: 'Kursat Deniz', rol: 'technieker', zohoNaam: 'Kursat Deniz', actief: false }, // vertrokken
  { id: 'd', naam: 'Test Beheerder', rol: 'beheerder', actief: true },                           // plant niet: geen Zoho-naam
  { id: 'e', naam: 'Plan Ner', rol: 'planner', zohoNaam: 'Plan', actief: true },
  { id: 'f', naam: 'Beheer Plan', rol: 'beheerder', zohoNaam: 'Bart', actief: true },           // beheerder die wel plant
  { id: 'g', naam: 'Bea Verkoper', rol: 'sales', salesNaam: 'Bea V.', actief: true },
  { id: 'h', naam: 'Carl Verkoper', rol: 'sales', actief: true },                                // geen salesNaam: de naam
  { id: 'i', naam: 'Oud Verkoper', rol: 'sales', salesNaam: 'Oud', actief: false },
  { id: 'j', naam: 'Dubbel', rol: 'planner', zohoNaam: 'Tim', actief: true },                    // dubbele Zoho-naam: één keer
  null,
];

test('bouwVoorWieGroepen: beheerder ziet Techniek (met Zoho-naam) en Sales, elk met de rol achter de naam', () => {
  const g = bouwVoorWieGroepen({ gebruikers: ALLE, kijkerRol: 'beheerder' });
  assert.deepEqual(g.techniek.map(o => [o.waarde, o.label]), [
    ['Bart', 'Bart (beheerder)'], ['Plan', 'Plan (planner)'], ['Roel', 'Roel (technieker)'], ['Tim', 'Tim (technieker)'],
  ]);
  assert.deepEqual(g.sales.map(o => [o.waarde, o.label, o.id]), [
    ['verkoper:g', 'Bea V. (verkoper)', 'g'], ['verkoper:h', 'Carl Verkoper (verkoper)', 'h'],
  ]);
});

test('bouwVoorWieGroepen: planners/beheerders zonder Zoho-naam en vertrokken accounts staan er niet in', () => {
  const g = bouwVoorWieGroepen({ gebruikers: ALLE });
  const labels = [...g.techniek, ...g.sales].map(o => o.label).join('|');
  assert.ok(!labels.includes('Kursat') && !labels.includes('Test Beheerder') && !labels.includes('Oud'));
});

test('bouwVoorWieGroepen: de planner ziet enkel de groep Techniek', () => {
  const g = bouwVoorWieGroepen({ gebruikers: ALLE, kijkerRol: 'planner' });
  assert.deepEqual(g.sales, []);
  assert.equal(g.techniek.length, 4);
});

test('bouwVoorWieGroepen: niet geladen (geen array) geeft null; een lege lijst twee lege groepen', () => {
  assert.equal(bouwVoorWieGroepen(), null);
  assert.equal(bouwVoorWieGroepen({ gebruikers: null }), null);
  assert.equal(bouwVoorWieGroepen({ gebruikers: 'kapot' }), null);
  assert.deepEqual(bouwVoorWieGroepen({ gebruikers: [] }), { techniek: [], sales: [] });
});

test('verkoperWaarde en verkoperIdUitWaarde: heen en terug; Zoho-namen en "all" zijn geen verkoper', () => {
  assert.equal(verkoperWaarde('u-bea'), 'verkoper:u-bea');
  assert.equal(verkoperIdUitWaarde('verkoper:u-bea'), 'u-bea');
  assert.equal(verkoperIdUitWaarde('Tim'), null);
  assert.equal(verkoperIdUitWaarde('all'), null);
  assert.equal(verkoperIdUitWaarde('verkoper:'), null);
  assert.equal(verkoperIdUitWaarde(null), null);
});

// ---- afwezigheid -> sales-blok ----
const FORM = { kind: 'fullday', meerdaags: false, datum: '2026-10-07', datumTot: null, van: null, tot: null, reden: 'Verlof', werkdagen: MA_VR };

test('maakVerkoperBlokken: één hele dag = 00:00-23:59, soort verlof, reden als omschrijving (en zo een hele dag voor de planner)', () => {
  const r = maakVerkoperBlokken(FORM);
  assert.deepEqual(r, { blokken: [{ datum: '2026-10-07', start: '00:00', eind: '23:59', soort: 'verlof', omschrijving: 'Verlof' }] });
  assert.equal(isHeleDag(r.blokken[0]), true); // planner-adapter.js slaat zo'n dag over (zie bouwPlanInvoer in tests/sales-planner-adapter.test.mjs)
});

test('maakVerkoperBlokken: zonder reden geen omschrijving; reden wordt getrimd', () => {
  assert.deepEqual(maakVerkoperBlokken({ ...FORM, reden: '  ' }).blokken[0], { datum: '2026-10-07', start: '00:00', eind: '23:59', soort: 'verlof' });
  assert.equal(maakVerkoperBlokken({ ...FORM, reden: '  Dokter ' }).blokken[0].omschrijving, 'Dokter');
});

test('maakVerkoperBlokken: meerdere werkdagen = één blok per werkdag, weekend overgeslagen', () => {
  const r = maakVerkoperBlokken({ ...FORM, meerdaags: true, datum: '2026-10-09', datumTot: '2026-10-13' });
  assert.deepEqual(r.blokken.map(b => b.datum), ['2026-10-09', '2026-10-12', '2026-10-13']);
  assert.ok(r.blokken.every(b => isHeleDag(b) && b.soort === 'verlof' && b.omschrijving === 'Verlof'));
});

test('maakVerkoperBlokken: tijdvak', () => {
  const r = maakVerkoperBlokken({ ...FORM, kind: 'range', van: '13:00', tot: '15:30', reden: '' });
  assert.deepEqual(r, { blokken: [{ datum: '2026-10-07', start: '13:00', eind: '15:30', soort: 'verlof' }] });
  assert.equal(isHeleDag(r.blokken[0]), false);
});

test('maakVerkoperBlokken: periode zonder werkdagen en een te lange reden geven een melding', () => {
  assert.match(maakVerkoperBlokken({ ...FORM, meerdaags: true, datum: '2026-10-10', datumTot: '2026-10-11' }).fout, /geen werkdagen/);
  assert.match(maakVerkoperBlokken({ ...FORM, reden: 'x'.repeat(201) }).fout, /te lang/);
});

test('verkoperBlokkenNaarUitzonderingen: enkel komende verlofblokken (en hele dag zonder soort), gesorteerd; kantoor en afspraak nooit', () => {
  const blokken = [
    { id: 'z', datum: '2026-10-04', start: '00:00', eind: '23:59', soort: 'verlof' }, // verleden
    { id: 'k', datum: '2026-10-08', start: '09:00', eind: '12:00', soort: 'kantoor', omschrijving: 'Papierwerk' },
    { id: 'a', datum: '2026-10-08', start: '14:00', eind: '15:00', soort: 'afspraak', omschrijving: 'Klant' },
    { id: 'ka', datum: '2026-10-09', start: '00:00', eind: '23:59', soort: 'kantoor' }, // hele dag, maar geen verlof
    { id: 'v', datum: '2026-10-07', start: '00:00', eind: '23:59', soort: 'verlof', omschrijving: 'Verlof' },
    { id: 'w', datum: '2026-10-09', start: '00:00', eind: '24:00', soort: 'verlof' },
    { id: 't', datum: '2026-10-09', start: '13:00', eind: '15:00', soort: 'verlof', omschrijving: ' Dokter ' },
    { id: 'zs', datum: '2026-10-10', start: '00:00', eind: '23:59' }, // hele dag zonder soort
    { id: 'zs2', datum: '2026-10-10', start: '10:00', eind: '11:00' }, // tijdvak zonder soort: geen afwezigheid
  ];
  const r = verkoperBlokkenNaarUitzonderingen(blokken, { naam: 'Bea V.', vandaag: '2026-10-05' });
  assert.deepEqual(r.map(e => e.id), ['v', 'w', 't', 'zs']);
  assert.deepEqual(r.map(e => e.kind), ['fullday', 'fullday', 'range', 'fullday']);
  assert.equal(r[0].reason, 'Verlof');
  assert.equal(r[2].reason, 'Dokter');
  assert.deepEqual([r[2].from, r[2].to, r[2].person, r[2].scope], ['13:00', '15:00', 'Bea V.', 'person']);
  assert.deepEqual(verkoperBlokkenNaarUitzonderingen(null, { naam: 'x', vandaag: '2026-10-05' }), []);
});

test('verkoperBlokkenNaarUitzonderingen + groupExceptionsForDisplay: opeenvolgende verlofdagen worden één regel', () => {
  const blokken = ['2026-10-09', '2026-10-12', '2026-10-13'].map((datum, i) => ({ id: 'b' + i, datum, start: '00:00', eind: '23:59', soort: 'verlof', omschrijving: 'Verlof' }));
  const groepen = groupExceptionsForDisplay(verkoperBlokkenNaarUitzonderingen(blokken, { naam: 'Bea V.', vandaag: '2026-10-05' }), MA_VR);
  assert.equal(groepen.length, 1);
  assert.deepEqual(groepen[0].items.map(e => e.id), ['b0', 'b1', 'b2']);
});
