import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUSSEN, RESULTAAT_LABEL, WIJZIGBARE_VELDEN, isVast, zetVastUur, bevestig, terugNaarTePlannen,
  geefResultaat, valideerLead, pasLeadToe,
} from '../public/js/sales/lead-regels.js';

const basis = (extra = {}) => ({
  id: 'l1', voornaam: 'Marie', naam: 'Janssens', postcode: '3500', gemeente: 'Hasselt',
  status: 'te-plannen', geimporteerdOp: '2026-10-01T08:00:00.000Z', ...extra,
});
const voorgesteld = (extra = {}) => basis({ status: 'voorgesteld', planning: { datum: '2026-10-06', start: '09:30', vast: false }, ...extra });
const bevestigd = (extra = {}) => basis({ status: 'bevestigd', planning: { datum: '2026-10-06', start: '10:00', vast: true }, ...extra });
const afgewerkt = (extra = {}) => basis({ status: 'afgewerkt', resultaat: { soort: 'offerte', op: '2026-10-06T12:00:00.000Z' }, ...extra });

test('constanten', () => {
  assert.deepEqual(STATUSSEN, ['te-plannen', 'voorgesteld', 'bevestigd', 'afgewerkt']);
  assert.equal(RESULTAAT_LABEL.opnieuw, 'Opnieuw langsgaan');
  assert.equal(RESULTAAT_LABEL['geen-interesse'], 'Geen interesse');
  assert.ok(WIJZIGBARE_VELDEN.includes('eerderVerwijderd'));
  assert.ok(!WIJZIGBARE_VELDEN.includes('locatie'));
});

test('isVast: vast-vlag of bevestigd', () => {
  assert.equal(isVast(basis()), false);
  assert.equal(isVast(voorgesteld()), false);
  assert.equal(isVast(bevestigd()), true);
  assert.equal(isVast(voorgesteld({ planning: { datum: '2026-10-06', start: '09:00', vast: true } })), true);
  assert.equal(isVast(null), false);
});

test('zetVastUur: vanuit te-plannen, voorgesteld en bevestigd altijd bevestigd + vast', () => {
  for (const l of [basis(), voorgesteld(), bevestigd()]) {
    const r = zetVastUur(l, { datum: '2026-10-07', start: '14:00' });
    assert.equal(r.status, 'bevestigd');
    assert.deepEqual(r.planning, { datum: '2026-10-07', start: '14:00', vast: true });
    assert.deepEqual(valideerLead(r), []);
    assert.equal(isVast(r), true);
  }
});

test('zetVastUur: muteert niet en gooit op afgewerkt', () => {
  const l = basis();
  zetVastUur(l, { datum: '2026-10-07', start: '14:00' });
  assert.equal(l.status, 'te-plannen');
  assert.equal(l.planning, undefined);
  assert.throws(() => zetVastUur(afgewerkt(), { datum: '2026-10-07', start: '14:00' }));
});

test('zetVastUur met ongeldige datum of uur geeft een fout via valideerLead', () => {
  assert.ok(valideerLead(zetVastUur(basis(), { datum: '2026-13-40', start: '10:00' })).length > 0);
  assert.ok(valideerLead(zetVastUur(basis(), { datum: '2026-10-07', start: '25:00' })).length > 0);
  assert.ok(valideerLead(zetVastUur(basis(), { datum: '2026-02-30', start: '10:00' })).length > 0);
});

test('bevestig: voorgesteld -> bevestigd met vast', () => {
  const r = bevestig(voorgesteld());
  assert.equal(r.status, 'bevestigd');
  assert.deepEqual(r.planning, { datum: '2026-10-06', start: '09:30', vast: true });
  assert.deepEqual(valideerLead(r), []);
  assert.throws(() => bevestig(basis()));
});

test('terugNaarTePlannen: planning weg, status te-plannen', () => {
  for (const l of [voorgesteld(), bevestigd()]) {
    const r = terugNaarTePlannen(l);
    assert.equal(r.status, 'te-plannen');
    assert.ok(!('planning' in r));
    assert.deepEqual(valideerLead(r), []);
  }
  const bv = bevestigd();
  terugNaarTePlannen(bv);
  assert.equal(bv.status, 'bevestigd'); // geen mutatie
});

test('geefResultaat opnieuw: behoudt eerdere bezoeken, voegt er een toe, wist het resultaat', () => {
  const eerder = [{ datum: '2026-09-20', resultaat: 'opnieuw', op: '2026-09-20T10:00:00.000Z' }];
  const l = bevestigd({ bezoeken: eerder, resultaat: { soort: 'offerte', op: '2026-09-01T00:00:00.000Z' } });
  const r = geefResultaat(l, { soort: 'opnieuw', notitie: 'Niet thuis', nu: '2026-10-06T10:15:00.000Z' });
  assert.equal(r.status, 'te-plannen');
  assert.ok(!('planning' in r));
  assert.ok(!('resultaat' in r));
  assert.equal(r.bezoeken.length, 2);
  assert.deepEqual(r.bezoeken[0], eerder[0]);
  assert.deepEqual(r.bezoeken[1], { datum: '2026-10-06', resultaat: 'opnieuw', notitie: 'Niet thuis', op: '2026-10-06T10:15:00.000Z' });
  assert.equal(l.bezoeken.length, 1); // geen mutatie
  assert.deepEqual(valideerLead(r), []);
});

test('geefResultaat offerte/verkocht/geen-interesse: afgewerkt met resultaat', () => {
  for (const soort of ['offerte', 'verkocht', 'geen-interesse']) {
    const r = geefResultaat(bevestigd(), { soort, nu: '2026-10-06T10:15:00.000Z' });
    assert.equal(r.status, 'afgewerkt');
    assert.ok(!('planning' in r));
    assert.deepEqual(r.resultaat, { soort, op: '2026-10-06T10:15:00.000Z' });
    assert.deepEqual(r.bezoeken, [{ datum: '2026-10-06', resultaat: soort, op: '2026-10-06T10:15:00.000Z' }]);
    assert.deepEqual(valideerLead(r), []);
  }
});

test('geefResultaat: bezoekdatum = planning.datum, anders de dag van nu; notitie meegegeven', () => {
  const r1 = geefResultaat(bevestigd({ planning: { datum: '2026-10-05', start: '09:00', vast: true } }), { soort: 'verkocht', notitie: 'Top', nu: '2026-10-06T10:00:00.000Z' });
  assert.equal(r1.bezoeken[0].datum, '2026-10-05');
  assert.equal(r1.resultaat.notitie, 'Top');
  const r2 = geefResultaat(basis(), { soort: 'verkocht', nu: new Date('2026-10-07T09:00:00.000Z') });
  assert.equal(r2.bezoeken[0].datum, '2026-10-07');
  assert.equal(r2.resultaat.op, '2026-10-07T09:00:00.000Z');
});

test('geefResultaat: ongeldig soort gooit', () => {
  assert.throws(() => geefResultaat(basis(), { soort: 'misschien', nu: '2026-10-06T10:00:00.000Z' }));
  assert.throws(() => geefResultaat(basis(), { nu: '2026-10-06T10:00:00.000Z' }));
});

test('valideerLead: geldige leads per status', () => {
  for (const l of [basis(), voorgesteld(), bevestigd(), afgewerkt()]) assert.deepEqual(valideerLead(l), []);
});

test('valideerLead: invarianten', () => {
  assert.ok(valideerLead(basis({ status: 'raar' })).length);
  assert.ok(valideerLead(basis({ planning: { datum: '2026-10-06', start: '09:00', vast: false } })).length); // te-plannen => geen planning
  assert.ok(valideerLead(voorgesteld({ planning: undefined })).length);
  assert.ok(valideerLead(voorgesteld({ planning: { datum: '2026-10-06', start: '9:00', vast: false } })).length);
  assert.ok(valideerLead(voorgesteld({ planning: { datum: '2026-10-06', start: '09:00', vast: true } })).length);
  assert.ok(valideerLead(bevestigd({ planning: { datum: '2026-10-06', start: '10:00', vast: false } })).length);
  assert.ok(valideerLead(afgewerkt({ resultaat: undefined })).length);
  assert.ok(valideerLead(afgewerkt({ planning: { datum: '2026-10-06', start: '10:00', vast: true } })).length);
  assert.ok(valideerLead(basis({ postcode: '35' })).length);
  assert.ok(valideerLead(basis({ postcode: '35000' })).length);
  assert.ok(valideerLead(basis({ duurMin: 10 })).length);
  assert.deepEqual(valideerLead(basis({ duurMin: 15 })), []);
  assert.ok(valideerLead(basis({ eerderVerwijderd: true })).length);
  assert.deepEqual(valideerLead(basis({ eerderVerwijderd: { op: '2026-09-01T00:00:00.000Z' } })), []);
});

test('pasLeadToe: gewone notitie, geen adreswijziging', () => {
  const l = basis({ locatie: { lat: 50.9, lon: 5.3, bron: 'postcode' } });
  const r = pasLeadToe(l, { notitie: 'Bel na 18u' });
  assert.deepEqual(r.fouten, []);
  assert.equal(r.adresGewijzigd, false);
  assert.equal(r.lead.notitie, 'Bel na 18u');
  assert.deepEqual(r.lead.locatie, l.locatie);
  assert.equal(l.notitie, undefined); // geen mutatie
});

test('pasLeadToe: adresvelden wijzigen wist de locatie', () => {
  const l = basis({ locatie: { lat: 50.9, lon: 5.3, bron: 'postcode' } });
  const r = pasLeadToe(l, { straat: 'Dorpsstraat', huisnr: '12' });
  assert.deepEqual(r.fouten, []);
  assert.equal(r.adresGewijzigd, true);
  assert.equal(r.lead.locatie, null);
  assert.equal(r.lead.straat, 'Dorpsstraat');
  // zelfde waarde = geen wijziging
  const zelfde = pasLeadToe(l, { postcode: '3500' });
  assert.equal(zelfde.adresGewijzigd, false);
  assert.deepEqual(zelfde.lead.locatie, l.locatie);
});

test('pasLeadToe: onbekende of verboden velden geven een fout en laten de lead ongewijzigd', () => {
  const l = basis({ email: 'marie@test.invalid' });
  for (const veld of ['locatie', 'email', 'id', 'gsm']) {
    const r = pasLeadToe(l, { notitie: 'x', [veld]: 'iets' });
    assert.deepEqual(r.fouten, [`Veld niet toegelaten: ${veld}`]);
    assert.deepEqual(r.lead, l);
    assert.equal(r.adresGewijzigd, false);
  }
});

test('pasLeadToe: eerderVerwijderd mag enkel gewist worden', () => {
  const l = basis({ eerderVerwijderd: { op: '2026-09-01T00:00:00.000Z' } });
  const ok = pasLeadToe(l, { eerderVerwijderd: null });
  assert.deepEqual(ok.fouten, []);
  assert.ok(!('eerderVerwijderd' in ok.lead));
  for (const waarde of [{ op: '2026-10-01T00:00:00.000Z' }, true]) {
    const r = pasLeadToe(l, { eerderVerwijderd: waarde });
    assert.equal(r.fouten.length, 1);
    assert.deepEqual(r.lead, l);
  }
});

test('pasLeadToe: statusovergangen', () => {
  const toegelaten = [
    ['te-plannen', 'voorgesteld'], ['te-plannen', 'bevestigd'], ['te-plannen', 'afgewerkt'],
    ['voorgesteld', 'te-plannen'], ['voorgesteld', 'bevestigd'], ['voorgesteld', 'afgewerkt'],
    ['bevestigd', 'te-plannen'], ['bevestigd', 'afgewerkt'], ['afgewerkt', 'te-plannen'],
    ['te-plannen', 'te-plannen'], ['bevestigd', 'bevestigd'],
  ];
  const verboden = [['bevestigd', 'voorgesteld'], ['afgewerkt', 'voorgesteld'], ['afgewerkt', 'bevestigd']];
  const maak = { 'te-plannen': basis, voorgesteld, bevestigd, afgewerkt };
  const velden = {
    'te-plannen': { status: 'te-plannen', planning: null, resultaat: null },
    voorgesteld: { status: 'voorgesteld', planning: { datum: '2026-10-08', start: '11:00', vast: false } },
    bevestigd: { status: 'bevestigd', planning: { datum: '2026-10-08', start: '11:00', vast: true } },
    afgewerkt: { status: 'afgewerkt', planning: null, resultaat: { soort: 'verkocht', op: '2026-10-08T10:00:00.000Z' } },
  };
  for (const [van, naar] of toegelaten) {
    const r = pasLeadToe(maak[van](), velden[naar]);
    assert.deepEqual(r.fouten, [], `${van} -> ${naar}`);
    assert.equal(r.lead.status, naar);
  }
  for (const [van, naar] of verboden) {
    const r = pasLeadToe(maak[van](), velden[naar]);
    assert.ok(r.fouten.length, `${van} -> ${naar}`);
    assert.equal(r.lead.status, van);
  }
});

test('pasLeadToe: het resultaat moet de invarianten halen', () => {
  const r = pasLeadToe(basis(), { status: 'voorgesteld' }); // zonder planning
  assert.ok(r.fouten.length);
  assert.equal(r.lead.status, 'te-plannen');
  const p = pasLeadToe(basis(), { postcode: '35' });
  assert.ok(p.fouten.length);
});

// ---- inhoudsvalidatie (fix-ronde 1): pasLeadToe is de bewaker die de server gebruikt ----
test('valideerLead: resultaat.soort moet een bekende afwerksoort zijn', () => {
  const metSoort = (soort) => afgewerkt({ resultaat: { soort, op: '2026-10-06T12:00:00.000Z' } });
  for (const soort of ['offerte', 'verkocht', 'geen-interesse']) assert.deepEqual(valideerLead(metSoort(soort)), []);
  for (const soort of ['hacken', undefined, 'opnieuw', 42]) assert.ok(valideerLead(metSoort(soort)).length, String(soort));
  assert.ok(valideerLead(afgewerkt({ resultaat: 'verkocht' })).length);
  assert.ok(valideerLead(afgewerkt({ resultaat: { soort: 'verkocht' } })).length); // tijdstip ontbreekt
  assert.ok(valideerLead(afgewerkt({ resultaat: { soort: 'verkocht', op: 'x', extra: 1 } })).length); // onbekende sleutel
  assert.ok(valideerLead(afgewerkt({ resultaat: { soort: 'verkocht', op: 'x', notitie: 'n'.repeat(1001) } })).length);
});

test('valideerLead: bezoeken hebben de verwachte vorm', () => {
  const goed = { datum: '2026-10-06', resultaat: 'opnieuw', notitie: 'Niet thuis', op: '2026-10-06T10:00:00.000Z' };
  assert.deepEqual(valideerLead(basis({ bezoeken: [goed] })), []);
  assert.deepEqual(valideerLead(basis({ bezoeken: [] })), []);
  for (const slecht of [
    'tekst', null, { ...goed, datum: '2026-02-30' }, { ...goed, resultaat: 'hacken' }, { ...goed, op: undefined },
    { ...goed, extra: true }, { ...goed, notitie: 5 }, { ...goed, notitie: 'n'.repeat(1001) },
  ]) assert.ok(valideerLead(basis({ bezoeken: [slecht] })).length, JSON.stringify(slecht));
  assert.ok(valideerLead(basis({ bezoeken: goed })).length); // geen lijst
  assert.ok(valideerLead(basis({ bezoeken: Array.from({ length: 201 }, () => goed) })).length);
});

test('valideerLead: planning kent enkel datum, start en vast', () => {
  assert.ok(valideerLead(voorgesteld({ planning: { datum: '2026-10-06', start: '09:00', vast: false, __proto: 'x' } })).length);
  assert.ok(valideerLead(voorgesteld({ planning: { datum: '2026-10-06', start: '09:00', vast: 'nee' } })).length);
});

test('valideerLead: tekstvelden zijn tekst met een maximale lengte', () => {
  assert.deepEqual(valideerLead(basis({ notitie: 'n'.repeat(1000), straat: 's'.repeat(200) })), []);
  assert.ok(valideerLead(basis({ notitie: 'n'.repeat(1001) })).length);
  for (const veld of ['straat', 'huisnr', 'gemeente', 'adresTekst']) {
    assert.ok(valideerLead(basis({ [veld]: 'x'.repeat(201) })).length, veld);
    assert.ok(valideerLead(basis({ [veld]: { a: 1 } })).length, veld);
  }
  assert.ok(valideerLead(basis({ notitie: ['a'] })).length);
  assert.ok(valideerLead(basis({ postcode: 3500 })).length);
});

test('valideerLead: enkel een afgewerkte lead heeft een resultaat', () => {
  const r = { soort: 'offerte', op: '2026-10-06T12:00:00.000Z' };
  assert.ok(valideerLead(basis({ resultaat: r })).length);
  assert.ok(valideerLead(voorgesteld({ resultaat: r })).length);
  assert.ok(valideerLead(bevestigd({ resultaat: r })).length);
});

test('pasLeadToe: naar een andere status dan afgewerkt laat het resultaat vallen', () => {
  const r = pasLeadToe(afgewerkt(), { status: 'te-plannen' }); // zonder resultaat: null mee te sturen
  assert.deepEqual(r.fouten, []);
  assert.equal(r.lead.status, 'te-plannen');
  assert.ok(!('resultaat' in r.lead));
  const v = pasLeadToe(basis(), { status: 'voorgesteld', planning: { datum: '2026-10-08', start: '11:00', vast: false }, resultaat: { soort: 'offerte', op: '2026-10-06T12:00:00.000Z' } });
  assert.deepEqual(v.fouten, []);
  assert.ok(!('resultaat' in v.lead));
  // blijft afgewerkt: resultaat mag wijzigen, maar enkel naar een geldige soort
  assert.deepEqual(pasLeadToe(afgewerkt(), { resultaat: { soort: 'verkocht', op: '2026-10-07T00:00:00.000Z' } }).fouten, []);
  assert.ok(pasLeadToe(afgewerkt(), { resultaat: { soort: 'hacken', op: '2026-10-07T00:00:00.000Z' } }).fouten.length);
});

test('pasLeadToe: weigert ongeldige inhoud en laat de lead ongewijzigd', () => {
  const l = basis();
  const gevallen = [
    { notitie: 'n'.repeat(1001) }, { notitie: { x: 1 } }, { straat: 's'.repeat(201) }, { gemeente: 42 },
    { bezoeken: [{ datum: 'nu', resultaat: 'opnieuw', op: 'x' }] }, { bezoeken: 'veel' },
    { status: 'voorgesteld', planning: { datum: '2026-10-08', start: '11:00', vast: false, rol: 'admin' } },
  ];
  for (const velden of gevallen) {
    const r = pasLeadToe(l, velden);
    assert.ok(r.fouten.length, JSON.stringify(velden));
    assert.deepEqual(r.lead, l);
  }
});

test('geefResultaat weigert een reeds afgewerkte lead', () => {
  assert.throws(() => geefResultaat(afgewerkt(), { soort: 'verkocht', nu: '2026-10-07T10:00:00.000Z' }), /afgewerkt/);
  assert.throws(() => geefResultaat(afgewerkt(), { soort: 'opnieuw', nu: '2026-10-07T10:00:00.000Z' }));
});
