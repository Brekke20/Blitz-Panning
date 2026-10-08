import test from 'node:test';
import assert from 'node:assert/strict';
import { adresSoort } from '../public/js/sales/adres.js';
import { pasLeadToe } from '../public/js/sales/lead-regels.js';
import { valideerDetail, valideerVastUur, vindBotsingen } from '../public/js/schermen/sales-detail-logica.js';

const geldig = (extra = {}) => ({ straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', gemeente: 'Kinrooi', notitie: 'Bel eerst', duurMin: '45', ...extra });

test('valideerDetail: geldige invoer geeft getrimde velden en een getal voor duurMin', () => {
  const r = valideerDetail(geldig({ straat: '  Dorpsstraat ', duurMin: '45' }));
  assert.deepEqual(r, { velden: { straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', gemeente: 'Kinrooi', notitie: 'Bel eerst', duurMin: 45, adresTekst: null } });
});

test('valideerDetail: lege duurMin wordt null (standaard van de verkoper)', () => {
  assert.equal(valideerDetail(geldig({ duurMin: '' })).velden.duurMin, null);
  assert.equal(valideerDetail(geldig({ duurMin: null })).velden.duurMin, null);
  assert.equal(valideerDetail(geldig({ duurMin: undefined })).velden.duurMin, null);
  assert.equal(valideerDetail(geldig({ duurMin: 90 })).velden.duurMin, 90);
});

test('valideerDetail: lege tekstvelden worden null', () => {
  const r = valideerDetail({ straat: '', huisnr: ' ', postcode: '', gemeente: '', notitie: '', duurMin: '' });
  assert.deepEqual(r, { velden: { straat: null, huisnr: null, postcode: null, gemeente: null, notitie: null, duurMin: null } });  // zonder postcode blijft adresTekst ongemoeid
});

test('valideerDetail: postcode van 4 cijfers', () => {
  for (const p of ['350', '35000', 'abcd', '35 00']) {
    assert.deepEqual(valideerDetail(geldig({ postcode: p })), { fout: 'Postcode bestaat uit 4 cijfers' }, p);
  }
});

test('valideerDetail: straat en huisnummer samen', () => {
  assert.deepEqual(valideerDetail(geldig({ huisnr: '' })), { fout: 'Vul straat én huisnummer in' });
  assert.deepEqual(valideerDetail(geldig({ straat: '' })), { fout: 'Vul straat én huisnummer in' });
});

test('valideerDetail: een adres vraagt ook een postcode', () => {
  assert.deepEqual(valideerDetail(geldig({ postcode: '' })), { fout: 'Postcode bestaat uit 4 cijfers' });
});

test('valideerDetail: minimale duur van 15 minuten', () => {
  for (const d of ['14', 0, -5, 'abc', '1x']) {
    assert.deepEqual(valideerDetail(geldig({ duurMin: d })), { fout: 'Minimale bezoekduur is 15 minuten' }, String(d));
  }
  assert.equal(valideerDetail(geldig({ duurMin: '15' })).velden.duurMin, 15);
});

test('valideerVastUur: datum vanaf vandaag en uur als UU:MM', () => {
  const v = '2026-10-12';
  assert.deepEqual(valideerVastUur({ datum: '2026-10-12', start: '09:30', vandaag: v }), { ok: true });
  assert.deepEqual(valideerVastUur({ datum: '2026-10-20', start: '00:00', vandaag: v }), { ok: true });
  assert.deepEqual(valideerVastUur({ datum: '2026-10-11', start: '09:30', vandaag: v }), { fout: 'Kies een datum vanaf vandaag' });
  assert.deepEqual(valideerVastUur({ datum: '', start: '09:30', vandaag: v }), { fout: 'Kies een datum vanaf vandaag' });
  assert.deepEqual(valideerVastUur({ datum: '2026-02-30', start: '09:30', vandaag: v }), { fout: 'Kies een datum vanaf vandaag' });
  for (const u of ['', '9:30', '25:00', '09:60', 'negen']) {
    assert.deepEqual(valideerVastUur({ datum: '2026-10-13', start: u, vandaag: v }), { fout: 'Geef het uur als UU:MM' }, u);
  }
});

// ---- vindBotsingen ----
const vast = (id, start, extra = {}) => ({
  id, voornaam: 'Marie', naam: 'Janssens ' + id, status: 'bevestigd',
  planning: { datum: '2026-10-12', start, vast: true }, ...extra,
});
const basis = { datum: '2026-10-12', start: '10:00', duurMin: 60, standaardDuurMin: 60 };

test('vindBotsingen: een overlappende vaste lead en een blok', () => {
  const leads = [vast('a', '10:30')];
  const blokken = [{ id: 'b1', datum: '2026-10-12', start: '09:30', eind: '10:15', soort: 'kantoor', omschrijving: 'Teamoverleg' }];
  const r = vindBotsingen({ ...basis, leads, blokken });
  assert.deepEqual(r, [
    { soort: 'blok', omschrijving: 'Teamoverleg', start: '09:30', eind: '10:15' },
    { soort: 'lead', omschrijving: 'Marie Janssens a', start: '10:30', eind: '11:30' },
  ]);
});

test('vindBotsingen: negeert exceptId, voorgestelde leads, andere dagen en aansluitende bezoeken', () => {
  const leads = [
    vast('zelf', '10:00'),
    vast('voorstel', '10:00', { status: 'voorgesteld', planning: { datum: '2026-10-12', start: '10:00', vast: false } }),
    vast('anderedag', '10:00', { planning: { datum: '2026-10-13', start: '10:00', vast: true } }),
    vast('ervoor', '09:00'),   // 09:00-10:00 sluit aan
    vast('erna', '11:00'),     // begint op het einde
  ];
  assert.deepEqual(vindBotsingen({ ...basis, leads, blokken: [], exceptId: 'zelf' }), []);
});

test('vindBotsingen: een vastgezet uur op een voorgestelde lead botst wel (isVast)', () => {
  const leads = [vast('v', '10:30', { status: 'voorgesteld', planning: { datum: '2026-10-12', start: '10:30', vast: true } })];
  assert.equal(vindBotsingen({ ...basis, leads, blokken: [] }).length, 1);
});

test('vindBotsingen: gebruikt de duur van de lead of de standaard', () => {
  const lang = vast('lang', '08:00', { duurMin: 180 });          // 08:00-11:00
  const standaard = vast('std', '10:45');                         // standaard 60 -> 10:45-11:45
  const r = vindBotsingen({ ...basis, leads: [lang, standaard], blokken: [], standaardDuurMin: 60 });
  assert.deepEqual(r.map((x) => [x.start, x.eind]), [['08:00', '11:00'], ['10:45', '11:45']]);
  // Lege duurMin van het nieuwe bezoek: standaard van de verkoper (hier 30 min, ook voor de bestaande lead: 11:15-11:45)
  const kort = vast('kort', '11:15');
  assert.equal(vindBotsingen({ datum: '2026-10-12', start: '11:40', duurMin: null, standaardDuurMin: 30, leads: [kort], blokken: [] }).length, 1);
  assert.equal(vindBotsingen({ datum: '2026-10-12', start: '11:45', duurMin: null, standaardDuurMin: 30, leads: [kort], blokken: [] }).length, 0);
});

test('vindBotsingen: een hele-dag blok botst en krijgt een omschrijving per soort', () => {
  const blokken = [{ id: 'v', datum: '2026-10-12', start: '00:00', eind: '23:59', soort: 'verlof' }];
  const r = vindBotsingen({ ...basis, leads: [], blokken });
  assert.deepEqual(r, [{ soort: 'blok', omschrijving: 'Verlof', start: '00:00', eind: '23:59' }]);
});

test('vindBotsingen: blok op een andere dag botst niet; ontbrekende lijsten zijn leeg', () => {
  const blokken = [{ id: 'b', datum: '2026-10-13', start: '09:00', eind: '12:00', soort: 'kantoor' }];
  assert.deepEqual(vindBotsingen({ ...basis, leads: [], blokken }), []);
  assert.deepEqual(vindBotsingen({ ...basis }), []);
});

test('valideerDetail: een ingevulde postcode wist de importtekst "adres nakijken"', () => {
  assert.equal(valideerDetail({ postcode: '3640' }).velden.adresTekst, null);
  assert.ok(!('adresTekst' in valideerDetail({ postcode: '', notitie: 'x' }).velden));
  const nakijken = { id: 'n', voornaam: 'Marie', naam: 'Janssens', adresTekst: 'ergens bij de kerk', status: 'te-plannen' };
  assert.equal(adresSoort(nakijken), 'nakijken');
  // Enkel postcode ingevuld: label wordt 'postcode'
  const postcode = pasLeadToe(nakijken, valideerDetail({ postcode: '3640', gemeente: 'Kinrooi' }).velden);
  assert.deepEqual(postcode.fouten, []);
  assert.equal(adresSoort(postcode.lead), 'postcode');
  // Volledig adres ingevuld: 'nakijken' tot de server het adres gevonden heeft (locatie is gewist), nooit meer door de importtekst
  const adres = pasLeadToe(nakijken, valideerDetail({ straat: 'Dorpsstraat', huisnr: '12', postcode: '3640', gemeente: 'Kinrooi' }).velden);
  assert.deepEqual(adres.fouten, []);
  assert.equal(adres.lead.adresTekst, null);
  assert.equal(adres.adresGewijzigd, true);
  assert.equal(adresSoort({ ...adres.lead, locatie: { lat: 51, lon: 5, bron: 'adres' } }), 'volledig');
});

test('valideerDetail: lengtegrenzen zoals de server (veld 200, notitie 1000, duur 15-480)', () => {
  assert.deepEqual(valideerDetail(geldig({ straat: 'x'.repeat(201) })), { fout: 'Straat is te lang (max. 200 tekens)' });
  assert.deepEqual(valideerDetail(geldig({ gemeente: 'x'.repeat(201) })), { fout: 'Gemeente is te lang (max. 200 tekens)' });
  assert.deepEqual(valideerDetail(geldig({ notitie: 'x'.repeat(1001) })), { fout: 'Notitie is te lang (max. 1000 tekens)' });
  assert.equal(valideerDetail(geldig({ straat: 'x'.repeat(200), notitie: 'x'.repeat(1000) })).velden.notitie.length, 1000);
  assert.deepEqual(valideerDetail(geldig({ duurMin: '481' })), { fout: 'Maximale bezoekduur is 480 minuten' });
  assert.equal(valideerDetail(geldig({ duurMin: '480' })).velden.duurMin, 480);
});

test('valideerVastUur: zonder vandaag faalt de controle veilig', () => {
  assert.deepEqual(valideerVastUur({ datum: '2026-10-13', start: '09:30' }), { fout: 'Kies een datum vanaf vandaag' });
});

test('vindBotsingen: ontbrekend of ongeldig uur geeft geen fout maar geen botsingen', () => {
  const leads = [vast('a', '10:30')];
  assert.deepEqual(vindBotsingen({ datum: '2026-10-12', duurMin: 60, leads, blokken: [] }), []);
  assert.deepEqual(vindBotsingen({ datum: '2026-10-12', start: 'negen', duurMin: 60, leads, blokken: [] }), []);
});

test('vindBotsingen: een item zonder uur wordt overgeslagen', () => {
  const leads = [{ id: 'k', status: 'bevestigd', planning: { datum: '2026-10-12', vast: true } }];
  const blokken = [{ id: 'b', datum: '2026-10-12', soort: 'kantoor' }];
  assert.deepEqual(vindBotsingen({ ...basis, leads, blokken }), []);
});
