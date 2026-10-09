import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterLeads, postcodegebieden, groepeerLijst, kaartInfo, afgewerktRijen,
} from '../public/js/schermen/sales-lijst-logica.js';

// Verzonnen leads (geen echte personen of nummers).
const lead = (id, extra = {}) => ({
  id, voornaam: 'Marie', naam: 'Janssens', postcode: '3500', gemeente: 'Hasselt',
  status: 'te-plannen', geimporteerdOp: '2026-10-01T08:00:00.000Z', ...extra,
});
const kinrooi = lead('k', { voornaam: 'Jan', naam: 'Peeters', postcode: '3640', gemeente: 'Kinrooi' });
const hasselt = lead('h');
const antwerpen = lead('a', { voornaam: 'Els', naam: 'Maes', postcode: '2000', gemeente: 'Antwerpen' });

test('filterLeads: alle woorden moeten voorkomen, hoofdletterongevoelig', () => {
  const alle = [kinrooi, hasselt, antwerpen];
  assert.deepEqual(filterLeads(alle, { zoek: 'kin 36' }).map((l) => l.id), ['k']);
  assert.deepEqual(filterLeads(alle, { zoek: 'MARIE jans' }).map((l) => l.id), ['h']);
  assert.deepEqual(filterLeads(alle, { zoek: 'marie kinrooi' }), []);
  assert.equal(filterLeads(alle, { zoek: '   ' }).length, 3);
  assert.equal(filterLeads(alle, {}).length, 3);
});

test('filterLeads: gebied = eerste 2 cijfers van de postcode', () => {
  const alle = [kinrooi, hasselt, antwerpen];
  assert.deepEqual(filterLeads(alle, { gebied: '36' }).map((l) => l.id), ['k']);
  assert.deepEqual(filterLeads(alle, { gebied: '35', zoek: 'marie' }).map((l) => l.id), ['h']);
  assert.deepEqual(filterLeads(alle, { gebied: '99' }), []);
});

test('filterLeads: lead zonder postcode of gemeente crasht niet', () => {
  const kaal = { id: 'x', voornaam: 'Piet', naam: null, status: 'te-plannen' };
  assert.deepEqual(filterLeads([kaal], { zoek: 'piet' }).map((l) => l.id), ['x']);
  assert.deepEqual(filterLeads([kaal], { gebied: '35' }), []);
});

test('postcodegebieden: aantal per gebied, gesorteerd, zonder postcode overgeslagen', () => {
  const kaal = { id: 'x', status: 'te-plannen' };
  const r = postcodegebieden([hasselt, kinrooi, lead('h2', { postcode: '3510' }), antwerpen, kaal]);
  assert.deepEqual(r, [{ gebied: '20', aantal: 1 }, { gebied: '35', aantal: 2 }, { gebied: '36', aantal: 1 }]);
});

test('groepeerLijst: wachttijd eerst, ingepland op datum en uur, afgewerkt valt weg', () => {
  const nieuw = lead('n', { geimporteerdOp: '2026-10-05T08:00:00.000Z' });
  const oud = lead('o', { geimporteerdOp: '2026-09-20T08:00:00.000Z' });
  const v2 = lead('v2', { status: 'voorgesteld', planning: { datum: '2026-10-13', start: '09:00', vast: false } });
  const b1 = lead('b1', { status: 'bevestigd', planning: { datum: '2026-10-12', start: '14:00', vast: true } });
  const v1 = lead('v1', { status: 'voorgesteld', planning: { datum: '2026-10-12', start: '09:00', vast: false } });
  const klaar = lead('z', { status: 'afgewerkt', resultaat: { soort: 'offerte', op: '2026-10-02T10:00:00.000Z' } });
  const r = groepeerLijst([nieuw, v2, b1, klaar, oud, v1], '2026-10-05');
  assert.deepEqual(r.tePlannen.map((l) => l.id), ['o', 'n']);
  assert.deepEqual(r.ingepland.map((l) => l.id), ['v1', 'b1', 'v2']);
});

test('I2: groepeerLijst: een verlopen voorstel staat bij Nog in te plannen; een bevestigde lead uit het verleden en een voorstel van vandaag niet', () => {
  const nieuw = lead('n', { geimporteerdOp: '2026-10-05T08:00:00.000Z' });
  const verlopen = lead('v', { status: 'voorgesteld', geimporteerdOp: '2026-09-20T08:00:00.000Z', planning: { datum: '2026-10-06', start: '09:00', vast: false } });
  const vandaagVoorstel = lead('w', { status: 'voorgesteld', planning: { datum: '2026-10-07', start: '09:00', vast: false } });
  const bevestigdVerleden = lead('b', { status: 'bevestigd', planning: { datum: '2026-10-01', start: '14:00', vast: true } });
  const r = groepeerLijst([nieuw, verlopen, vandaagVoorstel, bevestigdVerleden], '2026-10-07');
  assert.deepEqual(r.tePlannen.map((l) => l.id), ['v', 'n']);
  assert.deepEqual(r.ingepland.map((l) => l.id), ['b', 'w']);
  assert.equal(kaartInfo(verlopen, '2026-10-07').voorstelVerlopen, true);
  assert.equal(kaartInfo(vandaagVoorstel, '2026-10-07').voorstelVerlopen, false);
  assert.equal(kaartInfo(bevestigdVerleden, '2026-10-07').voorstelVerlopen, false);
  assert.equal(kaartInfo(nieuw, '2026-10-07').voorstelVerlopen, false);
});

test('groepeerLijst: wijzigt de invoer niet', () => {
  const invoer = [lead('n', { geimporteerdOp: '2026-10-05T08:00:00.000Z' }), lead('o', { geimporteerdOp: '2026-09-20T08:00:00.000Z' })];
  groepeerLijst(invoer);
  assert.deepEqual(invoer.map((l) => l.id), ['n', 'o']);
});

test('kaartInfo: titel, plaats, adreslabel per soort', () => {
  const k = kaartInfo(lead('a', { gsm: '32478123456', email: 'Marie@Voorbeeld.BE' }));
  assert.equal(k.titel, 'Marie Janssens');
  assert.equal(k.plaats, 'Hasselt (3500)');
  assert.equal(k.adresLabel, 'enkel postcode');
  assert.equal(k.telHref, 'tel:+32478123456');
  assert.equal(k.mailHref, 'mailto:marie@voorbeeld.be');
  assert.equal(k.status, 'te-plannen');
  assert.equal(k.vastUur, null);
  assert.equal(k.eerderVerwijderd, false);
  assert.equal(kaartInfo(lead('b', { straat: 'Dorpsstraat', huisnr: '12', locatie: { lat: 1, lon: 2, bron: 'adres' } })).adresLabel, 'volledig adres');
  assert.equal(kaartInfo(lead('c', { postcode: null, gemeente: null, adresTekst: 'ergens bij de kerk' })).adresLabel, 'adres nakijken');
});

test('kaartInfo: placeholder-gsm en lege velden geven geen href', () => {
  const k = kaartInfo(lead('a', { gsm: '+32000000', email: 'geen-mail' }));
  assert.equal(k.telHref, null);
  assert.equal(k.mailHref, null);
  assert.equal(kaartInfo(lead('b')).telHref, null);
});

test('kaartInfo: titel met enkel een deel van de naam', () => {
  assert.equal(kaartInfo(lead('a', { voornaam: null })).titel, 'Janssens');
  assert.equal(kaartInfo(lead('b', { voornaam: null, naam: null })).titel, 'Onbekende lead');
});

test('kaartInfo: vastUur enkel bij een vast bezoek (bevestigd of vastgezet)', () => {
  const bevestigd = lead('b', { status: 'bevestigd', planning: { datum: '2026-10-12', start: '10:00', vast: true } });
  assert.equal(kaartInfo(bevestigd).vastUur, 'ma 12 okt 10:00');
  const voorgesteld = lead('v', { status: 'voorgesteld', planning: { datum: '2026-10-12', start: '10:00', vast: false } });
  assert.equal(kaartInfo(voorgesteld).vastUur, null);
});

test('kaartInfo: zelfToegevoegd enkel bij een manueel toegevoegde lead (bronExport.bron)', () => {
  assert.equal(kaartInfo(lead('a', { bronExport: { verantwoordelijke: null, geexporteerdOp: null, bron: 'manueel' } })).zelfToegevoegd, true);
  assert.equal(kaartInfo(lead('b', { bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null } })).zelfToegevoegd, false);
  assert.equal(kaartInfo(lead('c')).zelfToegevoegd, false);
});

test('kaartInfo: eerderVerwijderd is waar bij { op }, anders onwaar', () => {
  assert.equal(kaartInfo(lead('a', { eerderVerwijderd: { op: '2026-09-01T10:00:00.000Z' } })).eerderVerwijderd, true);
  assert.equal(kaartInfo(lead('b')).eerderVerwijderd, false);
});

// ---- afgewerktRijen ----
const NU = new Date(2026, 9, 15, 12, 0); // 15 okt 2026 lokaal
const klaar = (id, datum, soort, extra = {}) => lead(id, {
  status: 'afgewerkt',
  resultaat: { soort, op: `${datum}T12:00:00.000Z` },
  bezoeken: [{ datum, resultaat: soort, op: `${datum}T12:00:00.000Z` }],
  ...extra,
});

test('afgewerktRijen: enkel afgewerkte leads, nieuwste eerst, met label en notitie', () => {
  const leads = [
    klaar('a', '2026-10-01', 'offerte', { bezoeken: [
      { datum: '2026-09-20', resultaat: 'opnieuw', op: '2026-09-20T12:00:00.000Z' },
      { datum: '2026-10-01', resultaat: 'offerte', notitie: 'Offerte verstuurd', op: '2026-10-01T12:00:00.000Z' },
    ] }),
    klaar('b', '2026-10-10', 'verkocht', { voornaam: 'Els', naam: 'Maes' }),
    lead('c'),
  ];
  const r = afgewerktRijen(leads, { nu: NU });
  assert.deepEqual(r.map((x) => x.leadId), ['b', 'a']);
  assert.deepEqual(r[0], { leadId: 'b', naam: 'Els Maes', datum: '2026-10-10', datumLabel: '10 okt', soort: 'verkocht', label: 'Verkocht', notitie: '' });
  assert.equal(r[1].datum, '2026-10-01');
  assert.equal(r[1].label, 'Offerte');
  assert.equal(r[1].notitie, 'Offerte verstuurd');
});

test('afgewerktRijen: filter op resultaat', () => {
  const leads = [klaar('a', '2026-10-01', 'offerte'), klaar('b', '2026-10-10', 'verkocht'), klaar('c', '2026-10-11', 'geen-interesse')];
  assert.deepEqual(afgewerktRijen(leads, { nu: NU, resultaat: 'verkocht' }).map((x) => x.leadId), ['b']);
  assert.equal(afgewerktRijen(leads, { nu: NU, resultaat: '' }).length, 3);
});

test('afgewerktRijen: periode 30d, 3m, 12m en alles met vaste nu', () => {
  const leads = [
    klaar('recent', '2026-10-05', 'offerte'),     // 10 dagen
    klaar('maand', '2026-09-10', 'offerte'),      // 35 dagen
    klaar('kwartaal', '2026-06-20', 'offerte'),   // ruim 3 maanden
    klaar('jaar', '2025-12-01', 'offerte'),
    klaar('oud', '2024-01-01', 'offerte'),
  ];
  const ids = (periode) => afgewerktRijen(leads, { nu: NU, periode }).map((x) => x.leadId);
  assert.deepEqual(ids('30d'), ['recent']);
  assert.deepEqual(ids('3m'), ['recent', 'maand']);
  assert.deepEqual(ids('12m'), ['recent', 'maand', 'kwartaal', 'jaar']);
  assert.deepEqual(ids('alles'), ['recent', 'maand', 'kwartaal', 'jaar', 'oud']);
  assert.deepEqual(ids(undefined), ids('alles'));
});

test('afgewerktRijen: grens van 30 dagen is inclusief', () => {
  const leads = [klaar('rand', '2026-09-15', 'offerte'), klaar('net-te-oud', '2026-09-14', 'offerte')];
  assert.deepEqual(afgewerktRijen(leads, { nu: NU, periode: '30d' }).map((x) => x.leadId), ['rand']);
});

test('afgewerktRijen: zonder bezoeken valt terug op het resultaat', () => {
  const l = lead('z', { status: 'afgewerkt', resultaat: { soort: 'geen-interesse', notitie: 'Te duur', op: new Date(2026, 9, 12, 15, 0).toISOString() } });
  const r = afgewerktRijen([l], { nu: NU });
  assert.equal(r.length, 1);
  assert.equal(r[0].datum, '2026-10-12');
  assert.equal(r[0].soort, 'geen-interesse');
  assert.equal(r[0].notitie, 'Te duur');
});

test('afgewerktRijen: datumLabel eindigt nooit op een punt (alle maanden)', () => {
  const leads = Array.from({ length: 12 }, (_, i) => klaar('m' + i, `2026-${String(i + 1).padStart(2, '0')}-05`, 'offerte'));
  for (const r of afgewerktRijen(leads, { nu: NU })) assert.doesNotMatch(r.datumLabel, /\.$/, r.datumLabel);
});

test('afgewerktRijen: periodegrens loopt niet over aan het einde van een maand', () => {
  // 31 mei - 3 maanden = 28 feb (2026), niet begin maart
  const nu = new Date(2026, 4, 31, 12, 0);
  const leads = [klaar('feb', '2026-02-28', 'offerte'), klaar('net-te-oud', '2026-02-27', 'offerte')];
  assert.deepEqual(afgewerktRijen(leads, { nu, periode: '3m' }).map((x) => x.leadId), ['feb']);
  // 29 feb 2028 - 12 maanden = 28 feb 2027
  const schrikkel = new Date(2028, 1, 29, 12, 0);
  const l2 = [klaar('a', '2027-02-28', 'offerte'), klaar('b', '2027-02-27', 'offerte')];
  assert.deepEqual(afgewerktRijen(l2, { nu: schrikkel, periode: '12m' }).map((x) => x.leadId), ['a']);
});

// ---- importteksten (Task 14) ----
import { samenvattingTekst, exportTekst, andereVerantwoordelijke } from '../public/js/schermen/sales-lijst-logica.js';

test('samenvattingTekst: het deel "eerder verwijderd" staat er enkel bij een aantal > 0', () => {
  assert.equal(samenvattingTekst({ nieuw: 12, alAanwezig: 7, adresNakijken: 1, eerderVerwijderd: 2 }),
    '12 nieuw (waarvan 2 eerder verwijderd), 7 al aanwezig, 1 adres nakijken');
  assert.equal(samenvattingTekst({ nieuw: 3, alAanwezig: 0, adresNakijken: 1, eerderVerwijderd: 0 }), '3 nieuw, 0 al aanwezig, 1 adres nakijken');
  assert.equal(samenvattingTekst({ nieuw: 1, alAanwezig: 0, adresNakijken: 0 }), '1 nieuw, 0 al aanwezig, 0 adres nakijken');
});

test('exportTekst: verantwoordelijke, aantal, statussen en overgeslagen leads (enkel wat er is)', () => {
  assert.equal(exportTekst({ verantwoordelijke: 'Test Verkoper', aantal: 6, statussen: ['Nieuw', 'Gebeld'], overgeslagen: 0 }),
    'Export van Test Verkoper · 6 leads · statussen: Nieuw, Gebeld');
  assert.equal(exportTekst({ verantwoordelijke: null, aantal: 1, statussen: [], overgeslagen: 2 }), 'Export · 1 lead · 2 leads zonder naam of contactgegevens overgeslagen');
  assert.equal(exportTekst({ verantwoordelijke: null, aantal: null, statussen: [] }), 'Export');
  assert.equal(exportTekst(undefined), '');
});

test('andereVerantwoordelijke: enkel bij een ingevulde naam die niet (hoofdletter- en spatieongevoelig) de verkoper is', () => {
  assert.equal(andereVerantwoordelijke('Andere Verkoper', 'Test Verkoper'), true);
  assert.equal(andereVerantwoordelijke('test  verkoper', 'Test Verkoper'), false);
  assert.equal(andereVerantwoordelijke(null, 'Test Verkoper'), false); // niets om mee te vergelijken
  assert.equal(andereVerantwoordelijke('', 'Test Verkoper'), false);
});

// ---- foutTekst (Task 14) ----
import { foutTekst, OPSLAG_TEKST } from '../public/js/schermen/sales-tekst.js';

test('foutTekst: een begrijpelijke tekst per reden van een mislukte schrijfactie', () => {
  assert.equal(OPSLAG_TEKST, 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.');
  assert.equal(foutTekst({ reden: 'opslag' }), OPSLAG_TEKST);
  assert.match(foutTekst({ reden: 'netwerk' }), /verbinding/i);
  assert.match(foutTekst({ reden: 'conflict' }), /intussen gewijzigd/);
  assert.match(foutTekst({ reden: 'vervallen' }), /bestaat niet meer/);
  assert.equal(foutTekst({ reden: 'http', fout: 'Postcode moet 4 cijfers zijn' }), 'Postcode moet 4 cijfers zijn');
  assert.equal(foutTekst({ reden: 'http' }), 'Opslaan is mislukt. Probeer het opnieuw.');
  assert.equal(foutTekst(undefined), 'Opslaan is mislukt. Probeer het opnieuw.');
});
