// Pure logica van de tab Gebruikers (logins T17): sorteren, formuliervalidatie (zelfde regels als de server),
// Zoho-namen voor de keuzelijst, de laatste-beheerder-regel voor de knop en de weergave van de laatste login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sorteerGebruikers, valideerGebruikerFormulier, zohoNaamOpties, zohoNaamBezetDoor, zohoNaamKeuzes, ZOHO_ANDERE, rolLabel, kanBlokkeren, formatLaatsteLogin,
  kanVerwijderen, verwijderUitleg, naamKomtOver,
} from '../public/js/schermen/beheer-gebruikers-logica.js';

const g = (id, naam, rol, actief = true) => ({ id, naam, rol, actief, email: `${id}@test.be` });

test('sorteerGebruikers: actief eerst, dan op naam; muteert de invoer niet', () => {
  const invoer = [g('1', 'Zoë', 'planner', false), g('2', 'Bert', 'planner'), g('3', 'alice', 'beheerder'), g('4', 'Anna', 'sales', false)];
  const kopie = structuredClone(invoer);
  const uit = sorteerGebruikers(invoer);
  assert.deepEqual(uit.map(x => x.id), ['3', '2', '4', '1']);
  assert.deepEqual(invoer, kopie);
  assert.deepEqual(sorteerGebruikers(null), []);
});

test('valideerGebruikerFormulier: technieker zonder zohoNaam geeft een fout, mét zohoNaam gaat het door', () => {
  assert.ok(valideerGebruikerFormulier({ rol: 'technieker', zohoNaam: '', naam: 'Tim', email: 'tim@test.be' }).fout);
  assert.ok(valideerGebruikerFormulier({ zohoNaam: '   ', naam: 'Tim', email: 'tim@test.be' }, 'technieker').fout);
  const r = valideerGebruikerFormulier({ email: ' Tim@Test.be ', naam: ' Tim ', zohoNaam: ' Tim ' }, 'technieker');
  assert.deepEqual(r, { waarden: { email: 'tim@test.be', naam: 'Tim', rol: 'technieker', zohoNaam: 'Tim', magZelfPlannen: false } });
});

test('valideerGebruikerFormulier: sales zonder salesNaam geeft een fout; magAlleSales is enkel waar bij true', () => {
  assert.ok(valideerGebruikerFormulier({ rol: 'sales', salesNaam: '', naam: 'Eva', email: 'eva@test.be' }).fout);
  const aan = valideerGebruikerFormulier({ rol: 'sales', salesNaam: 'Eva D.', magAlleSales: true, naam: 'Eva', email: 'eva@test.be' });
  assert.deepEqual(aan.waarden, { email: 'eva@test.be', naam: 'Eva', rol: 'sales', salesNaam: 'Eva D.', magAlleSales: true });
  const uit = valideerGebruikerFormulier({ rol: 'sales', salesNaam: 'Eva D.', magAlleSales: 'ja', naam: 'Eva', email: 'eva@test.be' });
  assert.equal(uit.waarden.magAlleSales, false);
});

test('valideerGebruikerFormulier: planner en beheerder hebben geen rolvelden nodig; een zohoNaam is voor hen optioneel, sales-velden krijgen ze niet', () => {
  const r = valideerGebruikerFormulier({ rol: 'planner', naam: 'Pia', email: 'pia@test.be', zohoNaam: 'Tim', salesNaam: 'x', magAlleSales: true });
  assert.deepEqual(r, { waarden: { email: 'pia@test.be', naam: 'Pia', rol: 'planner', zohoNaam: 'Tim' } });
  const zonder = valideerGebruikerFormulier({ rol: 'planner', naam: 'Pia', email: 'pia@test.be', zohoNaam: '  ' });
  assert.deepEqual(zonder, { waarden: { email: 'pia@test.be', naam: 'Pia', rol: 'planner' } });
  assert.ok(valideerGebruikerFormulier({ rol: 'beheerder', naam: 'Bea', zohoNaam: 'x'.repeat(101) }).fout);
  assert.equal(valideerGebruikerFormulier({ rol: 'sales', naam: 'Eva', salesNaam: 'E', zohoNaam: 'Tim' }).waarden.zohoNaam, undefined);
  assert.deepEqual(valideerGebruikerFormulier({ naam: 'Bea', email: 'bea@test.be' }, 'beheerder'), { waarden: { email: 'bea@test.be', naam: 'Bea', rol: 'beheerder' } });
});

test('valideerGebruikerFormulier: naam, e-mail en rol (zelfde regels als de server)', () => {
  assert.ok(valideerGebruikerFormulier({ naam: '', email: 'a@test.be' }, 'planner').fout);
  assert.ok(valideerGebruikerFormulier({ naam: 'x'.repeat(101), email: 'a@test.be' }, 'planner').fout);
  assert.ok(valideerGebruikerFormulier({ naam: 'A', email: 'geen-mail' }, 'planner').fout);
  assert.ok(valideerGebruikerFormulier({ naam: 'A', email: '' }, 'planner').fout);
  assert.ok(valideerGebruikerFormulier({ naam: 'A', email: 'a@test.be' }, 'admin').fout);
  assert.ok(valideerGebruikerFormulier({ naam: 'A', email: 'a@test.be' }, undefined).fout);
  assert.ok(valideerGebruikerFormulier(null, 'planner').fout);
  // Bewerken: zonder e-mailveld wordt het e-mailadres niet gevalideerd en niet teruggegeven.
  assert.deepEqual(valideerGebruikerFormulier({ naam: 'A' }, 'planner'), { waarden: { naam: 'A', rol: 'planner' } });
});

test('zohoNaamOpties: dedupliceert, negeert lege namen, voegt de huidige toe en sorteert', () => {
  const tickets = [{ assignee: 'Tim' }, { assignee: 'Roel' }, { assignee: 'Tim' }, { assignee: '' }, { assignee: null }, {}, null, { assignee: ' Sven ' }];
  assert.deepEqual(zohoNaamOpties(tickets, 'Anouk'), ['Anouk', 'Roel', 'Sven', 'Tim']);
  assert.deepEqual(zohoNaamOpties(tickets, 'Tim'), ['Roel', 'Sven', 'Tim']);
  assert.deepEqual(zohoNaamOpties(tickets, ''), ['Roel', 'Sven', 'Tim']);
  assert.deepEqual(zohoNaamOpties(undefined, undefined), []);
});

test('rolLabel: leesbare Nederlandse namen', () => {
  assert.equal(rolLabel('beheerder'), 'Beheerder');
  assert.equal(rolLabel('planner'), 'Planner');
  assert.equal(rolLabel('technieker'), 'Technieker');
  assert.equal(rolLabel('sales'), 'Sales');
  assert.equal(rolLabel('onbekend'), 'onbekend');
  assert.equal(rolLabel(undefined), '');
});

test('kanBlokkeren: de enige actieve beheerder niet, bij twee wel; andere rollen altijd', () => {
  const een = [g('b1', 'Bea', 'beheerder'), g('p1', 'Pia', 'planner'), g('b2', 'Bob', 'beheerder', false)];
  assert.equal(kanBlokkeren(een, 'b1'), false);
  assert.equal(kanBlokkeren(een, 'p1'), true);
  assert.equal(kanBlokkeren(een, 'b2'), true);
  const twee = [...een, g('b3', 'Bram', 'beheerder')];
  assert.equal(kanBlokkeren(twee, 'b1'), true);
  assert.equal(kanBlokkeren(twee, 'b3'), true);
  assert.equal(kanBlokkeren(een, 'nietbestaand'), false);
  assert.equal(kanBlokkeren(null, 'b1'), false);
});

test('formatLaatsteLogin: "Nooit" zonder (geldige) datum, anders datum en uur in Brusselse tijd', () => {
  assert.equal(formatLaatsteLogin(null), 'Nooit');
  assert.equal(formatLaatsteLogin(undefined), 'Nooit');
  assert.equal(formatLaatsteLogin('geen-datum'), 'Nooit');
  const tekst = formatLaatsteLogin('2026-10-05T07:30:00.000Z'); // 09:30 in Brussel
  assert.match(tekst, /05/);
  assert.match(tekst, /09[:.]30/);
});

test('zohoNaamBezetDoor en de melding vooraf bij een dubbele Zoho-naam (behalve het account zelf)', () => {
  const lijst = [{ id: 'a', naam: 'Tim J', zohoNaam: 'Tim  Janssens' }, { id: 'b', naam: 'Pia' }];
  assert.equal(zohoNaamBezetDoor(lijst, ' tim janssens', 'b')?.id, 'a');
  assert.equal(zohoNaamBezetDoor(lijst, 'Tim Janssens', 'a'), null);
  assert.equal(zohoNaamBezetDoor(lijst, '', 'b'), null);
  assert.equal(zohoNaamBezetDoor(null, 'Tim', 'b'), null);
  const fout = valideerGebruikerFormulier({ naam: 'Pia', zohoNaam: 'tim janssens' }, 'planner', { gebruikers: lijst, id: 'b' }).fout;
  assert.match(fout, /Tim J/);
  assert.deepEqual(valideerGebruikerFormulier({ naam: 'Tim J', zohoNaam: 'Tim Janssens' }, 'technieker', { gebruikers: lijst, id: 'a' }).waarden,
    { naam: 'Tim J', rol: 'technieker', zohoNaam: 'Tim Janssens', magZelfPlannen: false });
});

test('zohoNaamKeuzes: agenten plus de huidige waarde, ontdubbeld (ook met andere hoofdletters), gesorteerd; bezette namen met het andere account', () => {
  const gebruikers = [{ id: 'a', naam: 'Tim J', zohoNaam: 'Tim Janssens' }, { id: 'b', naam: 'Pia', zohoNaam: 'Pia Z' }, { id: 'c', naam: 'Kees' }];
  const agenten = [{ naam: 'Tim Janssens' }, { naam: 'Roel' }, { naam: 'Pia Z' }, { naam: ' ' }, {}, null, { naam: 'roel' }];
  assert.deepEqual(zohoNaamKeuzes({ agenten, huidige: '', gebruikers, behalveId: 'c' }), [
    { naam: 'Pia Z', bezetDoor: 'Pia' }, { naam: 'Roel', bezetDoor: null }, { naam: 'Tim Janssens', bezetDoor: 'Tim J' },
  ]);
  // Het eigen account telt niet als bezetter; een huidige waarde buiten de lijst blijft kiesbaar.
  assert.deepEqual(zohoNaamKeuzes({ agenten, huidige: 'Pia Z', gebruikers, behalveId: 'b' }).find(k => k.naam === 'Pia Z'), { naam: 'Pia Z', bezetDoor: null });
  assert.deepEqual(zohoNaamKeuzes({ agenten: [{ naam: 'Roel' }], huidige: 'Oud Collega', gebruikers: [], behalveId: 'x' }), [
    { naam: 'Oud Collega', bezetDoor: null }, { naam: 'Roel', bezetDoor: null },
  ]);
  assert.deepEqual(zohoNaamKeuzes({ agenten: ['Tim'], huidige: undefined }), [{ naam: 'Tim', bezetDoor: null }]);
  assert.deepEqual(zohoNaamKeuzes(), []);
  assert.equal(typeof ZOHO_ANDERE, 'string');
});

test('valideerGebruikerFormulier: magZelfPlannen enkel bij een technieker en enkel letterlijk true; andere rollen krijgen het veld nooit', () => {
  const basis = { naam: 'Tim', email: 'tim@test.be', zohoNaam: 'Tim' };
  assert.equal(valideerGebruikerFormulier({ ...basis, magZelfPlannen: true }, 'technieker').waarden.magZelfPlannen, true);
  assert.equal(valideerGebruikerFormulier({ ...basis, magZelfPlannen: 'ja' }, 'technieker').waarden.magZelfPlannen, false);
  assert.equal(valideerGebruikerFormulier(basis, 'technieker').waarden.magZelfPlannen, false);
  for (const rol of ['planner', 'beheerder']) assert.equal('magZelfPlannen' in valideerGebruikerFormulier({ ...basis, magZelfPlannen: true }, rol).waarden, false, rol);
  assert.equal('magZelfPlannen' in valideerGebruikerFormulier({ ...basis, salesNaam: 'T', magZelfPlannen: true }, 'sales').waarden, false);
});


// ---- verwijderen: knop-regel, uitleg en naam overtikken ----
test('kanVerwijderen (client): enkel geblokkeerd, nooit jezelf, een actieve beheerder blijft over', () => {
  const l = [
    { id: 'a', rol: 'beheerder', actief: true }, { id: 'b', rol: 'planner', actief: true }, { id: 'c', rol: 'planner', actief: false },
    { id: 'd', rol: 'beheerder', actief: false },
  ];
  assert.equal(kanVerwijderen(l, 'c', 'a'), true);
  assert.equal(kanVerwijderen(l, 'd', 'a'), true);
  assert.equal(kanVerwijderen(l, 'b', 'a'), false, 'actief');
  assert.equal(kanVerwijderen(l, 'a', 'a'), false, 'jezelf');
  assert.equal(kanVerwijderen(l, 'x', 'a'), false, 'onbekend');
  assert.equal(kanVerwijderen([{ id: 'd', rol: 'beheerder', actief: false }, { id: 'b', rol: 'planner', actief: true }], 'd', 'b'), false, 'geen actieve beheerder over');
  assert.equal(kanVerwijderen(null, 'c', 'a'), false);
});

test('verwijderUitleg: gewone taal met de gevolgen; enkel een verkoper krijgt de waarschuwing over leads en planning', () => {
  const gewoon = verwijderUitleg({ naam: 'Piet', rol: 'planner' }).join(' ');
  assert.match(gewoon, /Piet wordt definitief verwijderd/);
  assert.match(gewoon, /Rapporten en tickets blijven bewaard/);
  assert.match(gewoon, /activiteitenlogboek/);
  assert.ok(!/leads/.test(gewoon));
  const verkoper = verwijderUitleg({ naam: 'Sara', rol: 'sales' });
  assert.equal(verkoper.at(-1), 'Zijn leads en planning worden ook verwijderd. Wil je die bewaren, laat hem dan geblokkeerd.');
});

test('naamKomtOver: exacte naam, hoofdletters en spaties aan de rand of dubbele spaties tellen niet; leeg of anders niet', () => {
  assert.equal(naamKomtOver('Piet Planner', 'Piet Planner'), true);
  assert.equal(naamKomtOver('  piet   planner ', 'Piet Planner'), true);
  assert.equal(naamKomtOver('Piet', 'Piet Planner'), false);
  assert.equal(naamKomtOver('', ''), false);
  assert.equal(naamKomtOver('x', undefined), false);
  assert.equal(naamKomtOver(undefined, 'Piet'), false);
});
