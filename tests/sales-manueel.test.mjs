// Een lead manueel toevoegen (Task 14b): minimum naam + (gsm of e-mail) + postcode, het export-object, herkennen van een bestaande klant.
// Alle namen, e-mails en nummers zijn verzonnen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { valideerManueleLead, bouwManueelExport, controleerManueleExport, zoekBestaandeLead, MANUEEL } from '../public/js/sales/manueel.js';
import { leesExport } from '../public/js/sales/import.js';
import { voegSamen } from '../public/js/sales/herkenning.js';

const geldig = (extra = {}) => ({ voornaam: 'Greet', naam: '', gsm: '0470 11 22 33', email: '', postcode: '3500', gemeente: '', straat: '', huisnr: '', notitie: '', ...extra });

test('minimum: een naam, een gsm of e-mail en een postcode is genoeg; de rest wordt null', () => {
  const r = valideerManueleLead(geldig());
  assert.equal(r.fouten, undefined);
  assert.deepEqual(r.lead, { voornaam: 'Greet', naam: null, gsm: '0470 11 22 33', email: null, postcode: '3500', gemeente: null, straat: null, huisnr: null, notitie: null });
  assert.equal(valideerManueleLead(geldig({ gsm: '', email: 'greet@voorbeeld.test', voornaam: '', naam: 'Peeters' })).fouten, undefined);
});

test('zonder naam: "Vul een naam in" (een voornaam of een naam volstaat)', () => {
  assert.equal(valideerManueleLead(geldig({ voornaam: '  ', naam: '' })).fouten.naam, 'Vul een naam in');
  assert.equal(valideerManueleLead(geldig({ voornaam: '', naam: 'Peeters' })).fouten, undefined);
});

test('zonder gsm én e-mail: "Vul een gsm-nummer of e-mailadres in"', () => {
  assert.equal(valideerManueleLead(geldig({ gsm: '', email: '' })).fouten.contact, 'Vul een gsm-nummer of e-mailadres in');
  assert.equal(valideerManueleLead(geldig({ gsm: '', email: ' ' })).fouten.contact, 'Vul een gsm-nummer of e-mailadres in');
});

test('een ingevuld maar onbruikbaar nummer of e-mailadres wordt niet stilzwijgend weggelaten', () => {
  const kort = valideerManueleLead(geldig({ gsm: '0470 11', email: '' }));
  assert.equal(kort.fouten.gsm, 'Dit gsm-nummer lijkt niet te kloppen');
  assert.equal(kort.fouten.contact, undefined); // het veld zelf krijgt de fout
  const geenAt = valideerManueleLead(geldig({ gsm: '', email: 'geen-mailadres' }));
  assert.equal(geenAt.fouten.email, 'Dit e-mailadres lijkt niet te kloppen');
  // een geldig nummer met een kapot e-mailadres: de kapotte invoer wordt gemeld
  assert.equal(valideerManueleLead(geldig({ email: 'kapot' })).fouten.email, 'Dit e-mailadres lijkt niet te kloppen');
});

test('postcode: precies 4 cijfers', () => {
  for (const p of ['35', '35000', 'abcd', '3 500']) assert.equal(valideerManueleLead(geldig({ postcode: p })).fouten.postcode, 'Postcode bestaat uit 4 cijfers', p);
  assert.equal(valideerManueleLead(geldig({ postcode: '' })).fouten.postcode, 'Vul een postcode in');
  assert.equal(valideerManueleLead(geldig({ postcode: ' 3500 ' })).lead.postcode, '3500');
});

test('straat en huisnummer horen samen; teksten hebben een maximum', () => {
  assert.equal(valideerManueleLead(geldig({ straat: 'Dorpsstraat' })).fouten.straat, 'Vul straat én huisnummer in');
  assert.equal(valideerManueleLead(geldig({ huisnr: '12' })).fouten.straat, 'Vul straat én huisnummer in');
  assert.deepEqual(valideerManueleLead(geldig({ straat: 'Dorpsstraat', huisnr: '12', gemeente: 'Hasselt' })).lead.straat, 'Dorpsstraat');
  assert.match(valideerManueleLead(geldig({ voornaam: 'x'.repeat(201) })).fouten.voornaam, /te lang/);
  assert.match(valideerManueleLead(geldig({ notitie: 'x'.repeat(1001) })).fouten.notitie, /te lang \(max. 1000/);
  assert.equal(valideerManueleLead(geldig({ notitie: 'x'.repeat(1000) })).fouten, undefined);
});

test('alle fouten tegelijk (de verkoper ziet alles in één keer)', () => {
  const r = valideerManueleLead({ voornaam: '', naam: '', gsm: '', email: '', postcode: '' });
  assert.deepEqual(Object.keys(r.fouten).sort(), ['contact', 'naam', 'postcode']);
});

test('bouwManueelExport: één lead, bron manueel, geen verantwoordelijke; leesExport leest alle velden terug (ook de notitie)', () => {
  const { lead } = valideerManueleLead(geldig({ naam: 'Peeters', email: 'Greet@Voorbeeld.Test', gemeente: 'Hasselt', straat: 'Dorpsstraat', huisnr: '12', notitie: 'Bel na vijf uur' }));
  const exp = bouwManueelExport(lead);
  assert.equal(exp.bron, MANUEEL);
  assert.equal(exp.leads.length, 1);
  const gelezen = leesExport(exp);
  assert.equal(gelezen.ok, true);
  assert.equal(gelezen.bron, 'manueel');
  assert.equal(gelezen.verantwoordelijke, null);
  assert.deepEqual(gelezen.leads[0], {
    voornaam: 'Greet', naam: 'Peeters', gsm: '0470 11 22 33', email: 'greet@voorbeeld.test', postcode: '3500', gemeente: 'Hasselt',
    straat: 'Dorpsstraat', huisnr: '12', adresTekst: null, notitie: 'Bel na vijf uur',
  });
});

test('leesExport: een gewone export leest geen structurele velden (alleen "adres"), ook niet als ze er toch in staan', () => {
  const g = leesExport({ leads: [{ voornaam: 'A', naam: 'B', gsm: '0470 11 22 33', adres: '3640', postcode: '9999', notitie: 'x', straat: 'Y', huisnr: '1' }] });
  assert.equal(g.bron, null);
  assert.equal(g.leads[0].postcode, '3640');
  assert.equal(g.leads[0].notitie, undefined);
  assert.equal(g.leads[0].straat, null);
});

test('leesExport manueel: straat zonder huisnummer of ongeldige postcode komt er niet in; een lange notitie blijft tot 1000 tekens', () => {
  const m = (r) => leesExport({ bron: 'manueel', leads: [{ voornaam: 'A', gsm: '0470 11 22 33', ...r }] }).leads[0];
  assert.equal(m({ postcode: '35', straat: 'Y', huisnr: '1' }).postcode, null);
  assert.equal(m({ postcode: '3500', straat: 'Y' }).straat, null);
  assert.equal(m({ postcode: '3500', notitie: 'n'.repeat(1500) }).notitie.length, 1000);
});

test('controleerManueleExport (server): precies één lead met het minimum; anders de eerste fout in het Nederlands', () => {
  const ok = bouwManueelExport(valideerManueleLead(geldig()).lead);
  assert.equal(controleerManueleExport(ok), null);
  assert.equal(controleerManueleExport({ ...ok, leads: [] }).fout, 'Een manueel toegevoegde lead bestaat uit precies één lead');
  assert.equal(controleerManueleExport({ ...ok, leads: [ok.leads[0], ok.leads[0]] }).fout, 'Een manueel toegevoegde lead bestaat uit precies één lead');
  assert.equal(controleerManueleExport({ ...ok, leads: ['tekst'] }).fout, 'Een manueel toegevoegde lead bestaat uit precies één lead');
  assert.equal(controleerManueleExport({ ...ok, leads: [{ ...ok.leads[0], voornaam: '' }] }).fout, 'Vul een naam in');
  assert.equal(controleerManueleExport({ ...ok, leads: [{ ...ok.leads[0], gsm: null, email: null }] }).fout, 'Vul een gsm-nummer of e-mailadres in');
  assert.equal(controleerManueleExport({ ...ok, leads: [{ ...ok.leads[0], postcode: '12' }] }).fout, 'Postcode bestaat uit 4 cijfers');
});

test('zoekBestaandeLead: dezelfde gsm of hetzelfde e-mailadres (herkenningssleutels), ook in een andere schrijfwijze', () => {
  const leads = [
    { id: 'a', voornaam: 'Els', naam: 'Maes', gsm: '+32 478 00 11 22', email: null, postcode: '2000' },
    { id: 'b', voornaam: 'Greet', naam: null, gsm: null, email: 'greet@voorbeeld.test', postcode: '3500' },
  ];
  assert.equal(zoekBestaandeLead(leads, { voornaam: 'Greet', gsm: '0470 11 22 33', email: 'GREET@voorbeeld.test', postcode: '3500' }).id, 'b');
  assert.equal(zoekBestaandeLead(leads, { voornaam: 'E', gsm: '0478/00.11.22', email: null, postcode: '9999' }).id, 'a');
  assert.equal(zoekBestaandeLead(leads, { voornaam: 'Nieuw', gsm: '0499 99 99 99', email: null, postcode: '3500' }), null);
});

test('samenvoegen met een latere export: de export vult enkel lege velden aan, het zelf ingevulde blijft, geen dubbele lead', () => {
  const { lead } = valideerManueleLead(geldig({ voornaam: 'Greet', naam: '', gsm: '', email: 'greet@voorbeeld.test', gemeente: 'Hasselt', notitie: 'Bel na vijf uur' }));
  let n = 0;
  const eerste = voegSamen([], leesExport(bouwManueelExport(lead)).leads, { nu: '2026-10-09T08:00:00.000Z', nieuwId: () => `id${++n}`, bronExport: { verantwoordelijke: null, geexporteerdOp: null, bron: 'manueel' } });
  assert.equal(eerste.samenvatting.nieuw, 1);
  assert.equal(eerste.leads[0].notitie, 'Bel na vijf uur');
  assert.deepEqual(eerste.leads[0].bronExport, { verantwoordelijke: null, geexporteerdOp: null, bron: 'manueel' });
  // dezelfde persoon in een latere JSON-export, met naam, gsm en een volledig adres
  const export2 = leesExport({ leads: [{ voornaam: 'Greta', naam: 'Peeters', gsm: '0470 11 22 33', email: 'greet@voorbeeld.test', adres: 'Dorpsstraat 12, 3500 Hasselt' }] });
  const tweede = voegSamen(eerste.leads, export2.leads, { nu: '2026-10-10T08:00:00.000Z', nieuwId: () => `id${++n}`, bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null } });
  assert.equal(tweede.samenvatting.alAanwezig, 1);
  assert.equal(tweede.samenvatting.nieuw, 0);
  assert.equal(tweede.leads.length, 1);
  const l = tweede.leads[0];
  assert.equal(l.voornaam, 'Greet');          // zelf ingevuld: blijft
  assert.equal(l.naam, 'Peeters');            // leeg: aangevuld
  assert.equal(l.gsm, '0470 11 22 33');       // leeg: aangevuld
  assert.equal(l.notitie, 'Bel na vijf uur'); // blijft
  assert.equal(l.straat, 'Dorpsstraat');      // postcode-adres wordt volledig adres (zelfde postcode)
  assert.equal(l.bronExport.bron, 'manueel'); // de herkomst blijft
});

test('een manueel toegevoegde klant die al bestaat vult een lege notitie aan, maar overschrijft er geen', () => {
  const bestaand = [{ id: 'a', voornaam: 'Greet', naam: null, gsm: null, email: 'greet@voorbeeld.test', postcode: '3500', gemeente: null, status: 'te-plannen', bezoeken: [] }];
  const nieuw = leesExport(bouwManueelExport(valideerManueleLead(geldig({ gsm: '', email: 'greet@voorbeeld.test', notitie: 'Nieuwe notitie' })).lead)).leads;
  assert.equal(voegSamen(bestaand, nieuw, { nu: 'x', nieuwId: () => 'z' }).leads[0].notitie, 'Nieuwe notitie');
  const metNotitie = [{ ...bestaand[0], notitie: 'Mijn notitie' }];
  assert.equal(voegSamen(metNotitie, nieuw, { nu: 'x', nieuwId: () => 'z' }).leads[0].notitie, 'Mijn notitie');
});
