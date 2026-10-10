// Tests voor kern/navigatie.js (logins T15): rolregister van tabs en start, en laadTab.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registreerTabs, tabsVoorRol, registreerStart, startVoorRol, laadTab, zetActieveRol, wisNavigatieVoorTest,
} from '../public/js/kern/navigatie.js';

const tab = (id, laad = async () => {}) => ({ id, label: id.toUpperCase(), laad });

beforeEach(() => wisNavigatieVoorTest());

test('registreerTabs voegt toe in registratievolgorde', () => {
  const a = tab('a'); const b = tab('b');
  registreerTabs('planner', [a]);
  registreerTabs('planner', [b]);
  assert.deepEqual(tabsVoorRol('planner'), [a, b]);
});

test('dezelfde id opnieuw registreren vervangt de tab op dezelfde plaats en dupliceert niet', () => {
  const a = tab('a'); const b = tab('b'); const a2 = { ...tab('a'), label: 'Nieuw' };
  registreerTabs('planner', [a, b]);
  registreerTabs('planner', [a2]);
  assert.deepEqual(tabsVoorRol('planner'), [a2, b]);
});

test('onbekende rol geeft een lege lijst; rollen zijn gescheiden', () => {
  registreerTabs('planner', [tab('a')]);
  assert.deepEqual(tabsVoorRol('onbekend'), []);
  assert.deepEqual(tabsVoorRol('technieker'), []);
  assert.deepEqual(tabsVoorRol(undefined), []);
});

test('tabsVoorRol geeft een kopie: de aanroeper kan het register niet wijzigen', () => {
  registreerTabs('planner', [tab('a')]);
  tabsVoorRol('planner').push(tab('x'));
  assert.equal(tabsVoorRol('planner').length, 1);
});

test('registreerTabs negeert ongeldige invoer zonder te gooien', () => {
  registreerTabs('planner', null);
  registreerTabs('planner', [null, { label: 'zonder id' }, { id: '' }]);
  assert.deepEqual(tabsVoorRol('planner'), []);
});

test('registreerStart/startVoorRol roundtrip; onbekende rol is null', () => {
  const fn = () => {};
  assert.equal(startVoorRol('sales'), null);
  registreerStart('sales', fn);
  assert.equal(startVoorRol('sales'), fn);
  assert.equal(startVoorRol('planner'), null);
  registreerStart('sales', 'geen functie');
  assert.equal(startVoorRol('sales'), fn, 'een niet-functie vervangt niets');
});

test('laadTab roept enkel de laad van de geregistreerde tab van de actieve rol aan', async () => {
  const roep = [];
  registreerTabs('planner', [tab('a', async () => roep.push('planner-a')), tab('b', async () => roep.push('planner-b'))]);
  registreerTabs('technieker', [tab('a', async () => roep.push('technieker-a'))]);
  zetActieveRol('planner');
  await laadTab('b');
  assert.deepEqual(roep, ['planner-b']);
  zetActieveRol('technieker');
  await laadTab('a');
  assert.deepEqual(roep, ['planner-b', 'technieker-a']);
});

test('laadTab gooit niet bij een onbekende id, zonder actieve rol of bij een falende laad', async () => {
  registreerTabs('planner', [
    tab('stuk', async () => { throw new Error('stuk'); }),
    tab('sync-stuk', () => { throw new Error('sync'); }),
  ]);
  await laadTab('a'); // geen actieve rol
  zetActieveRol('planner');
  await laadTab('bestaat-niet');
  const fouten = [];
  const oud = console.error; console.error = (...a) => fouten.push(a);
  try { await laadTab('stuk'); await laadTab('sync-stuk'); } finally { console.error = oud; }
  assert.equal(fouten.length, 2);
});

test('zetActieveRol met extra: laadTab laadt ook de tabs van die extra sleutel (sales manager: Beheer); zonder extra niet', async () => {
  const geladen = [];
  registreerTabs('sales', [tab('sales-lijst', async () => { geladen.push('lijst'); })]);
  registreerTabs('sales-manager', [tab('beheer', async () => { geladen.push('beheer'); })]);
  zetActieveRol('sales');
  await laadTab('beheer');
  assert.deepEqual(geladen, []);
  zetActieveRol('sales', ['sales-manager']);
  await laadTab('beheer');
  await laadTab('sales-lijst');
  assert.deepEqual(geladen, ['beheer', 'lijst']);
  zetActieveRol('sales'); // terug zonder extra
  await laadTab('beheer');
  assert.deepEqual(geladen, ['beheer', 'lijst']);
});
