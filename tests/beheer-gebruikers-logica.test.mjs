// Pure logica van de tab Gebruikers (logins T17): sorteren, formuliervalidatie (zelfde regels als de server),
// Zoho-namen voor de keuzelijst, de laatste-beheerder-regel voor de knop en de weergave van de laatste login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sorteerGebruikers, valideerGebruikerFormulier, zohoNaamOpties, rolLabel, kanBlokkeren, formatLaatsteLogin,
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
  assert.deepEqual(r, { waarden: { email: 'tim@test.be', naam: 'Tim', rol: 'technieker', zohoNaam: 'Tim' } });
});

test('valideerGebruikerFormulier: sales zonder salesNaam geeft een fout; magAlleSales is enkel waar bij true', () => {
  assert.ok(valideerGebruikerFormulier({ rol: 'sales', salesNaam: '', naam: 'Eva', email: 'eva@test.be' }).fout);
  const aan = valideerGebruikerFormulier({ rol: 'sales', salesNaam: 'Eva D.', magAlleSales: true, naam: 'Eva', email: 'eva@test.be' });
  assert.deepEqual(aan.waarden, { email: 'eva@test.be', naam: 'Eva', rol: 'sales', salesNaam: 'Eva D.', magAlleSales: true });
  const uit = valideerGebruikerFormulier({ rol: 'sales', salesNaam: 'Eva D.', magAlleSales: 'ja', naam: 'Eva', email: 'eva@test.be' });
  assert.equal(uit.waarden.magAlleSales, false);
});

test('valideerGebruikerFormulier: planner en beheerder hebben geen rolvelden nodig en krijgen er ook geen', () => {
  const r = valideerGebruikerFormulier({ rol: 'planner', naam: 'Pia', email: 'pia@test.be', zohoNaam: 'Tim', salesNaam: 'x', magAlleSales: true });
  assert.deepEqual(r, { waarden: { email: 'pia@test.be', naam: 'Pia', rol: 'planner' } });
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
