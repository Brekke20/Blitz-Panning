// tests/persoonskiezer-logica.test.mjs — de lijst van de persoonskiezer per rol (kop B, taak 1): wie staat er in het menu, wat zegt de knop,
// "Alle" per rol, "(jij)", de koppeling Zoho-naam -> rol, "geen login", en dat er nergens een e-mailadres in de uitvoer zit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kiezerLijst, initialen, voornaam, normaalNaam } from '../public/js/schermen/persoonskiezer-logica.js';

const TICKETS = ['Tim Peeters', 'Roel', 'Wim Smets'];
const alleItems = (l) => l.groepen.flatMap(g => g.items);
const namen = (l) => alleItems(l).map(i => i.naam);

const VERKOPERS = [
  { id: 'u-an', naam: 'An Maes', actief: true, salesManager: false },
  { id: 'u-sofie', naam: 'Sofie Maes', actief: true, salesManager: true },
  { id: 'u-tom', naam: 'Tom Peeters', actief: false, salesManager: false },
];
const GEBRUIKERS = [
  { id: 'u-b', naam: 'Brent Calaerts', email: 'brent@blitz.be', rol: 'beheerder', zohoNaam: 'Brent Calaerts', actief: true },
  { id: 'u-j', naam: 'Jens Vermeulen', email: 'jens@blitz.be', rol: 'technieker', zohoNaam: 'Jens Vermeulen', actief: true },
  { id: 'u-k', naam: 'Kris Dons', email: 'kris@blitz.be', rol: 'planner', zohoNaam: 'Kris Dons', actief: true },
  { id: 'u-t', naam: 'Tim P.', email: 'tim@blitz.be', rol: 'technieker', zohoNaam: ' tim  peeters ', actief: true },
  { id: 'u-an', naam: 'An Maes', email: 'an@blitz.be', rol: 'sales', salesNaam: 'An Maes', magAlleSales: false, actief: true },
];

test('hulpfuncties: voornaam, normaalNaam en initialen', () => {
  assert.equal(voornaam('  Tim Peeters '), 'Tim');
  assert.equal(voornaam(''), '');
  assert.equal(normaalNaam('  Tim   PEETERS '), 'tim peeters');
  assert.equal(initialen('all'), 'A');
  assert.equal(initialen('Tim Peeters'), 'TP');
  assert.equal(initialen('Roel'), 'R');
});

test('technieker: de namen uit de tickets en zichzelf, alfabetisch, de eigen naam met "(jij)", geen "Alle technici"', () => {
  const l = kiezerLijst({ rol: 'technieker', rechten: { plannen: false }, ticketNamen: TICKETS, eigen: 'Tim Peeters', gekozenTechnieker: 'Tim Peeters' });
  assert.equal(l.zichtbaar, true);
  assert.deepEqual(namen(l), ['Roel', 'Tim Peeters', 'Wim Smets']);
  assert.equal(alleItems(l).some(i => i.soort === 'alle'), false);
  assert.deepEqual(alleItems(l).filter(i => i.jij).map(i => i.naam), ['Tim Peeters']);
  assert.equal(l.groepen.length, 1);
  assert.equal(l.groepen[0].titel, null);
  assert.deepEqual({ icoon: l.knop.icoon, voor: l.knop.voor, naam: l.knop.naam, werkruimte: l.knop.werkruimte }, { icoon: '👤', voor: 'Planning:', naam: 'Tim', werkruimte: 'techniek' });
  assert.equal(l.knop.aria, 'Kies technieker, nu Tim Peeters');
  assert.equal(l.terug, null);
});

test('technieker zonder ticket op zijn naam staat toch in de lijst (de eigen Zoho-naam)', () => {
  const l = kiezerLijst({ rol: 'technieker', rechten: {}, ticketNamen: [], eigen: 'Brent Calaerts', gekozenTechnieker: 'all' });
  assert.deepEqual(namen(l), ['Brent Calaerts']);
});

test('planner: "Alle technici" eerst, dan de namen; knop "Planning: Alle" bij all', () => {
  const l = kiezerLijst({ rol: 'planner', rechten: { plannen: true }, ticketNamen: TICKETS, eigen: '', gekozenTechnieker: 'all' });
  assert.deepEqual(namen(l), ['Alle technici', 'Roel', 'Tim Peeters', 'Wim Smets']);
  assert.equal(alleItems(l)[0].soort, 'alle');
  assert.equal(alleItems(l)[0].huidig, true);
  assert.equal(l.knop.naam, 'Alle');
  assert.equal(l.knop.aria, 'Kies technieker, nu alle technici');
  // een planner ziet nooit verkopers, ook niet als ze (per ongeluk) worden doorgegeven
  const l2 = kiezerLijst({ rol: 'planner', rechten: { plannen: true }, ticketNamen: TICKETS, verkopers: VERKOPERS, gekozenTechnieker: 'Roel' });
  assert.equal(alleItems(l2).some(i => i.soort === 'verkoper'), false);
  assert.deepEqual(alleItems(l2).filter(i => i.huidig).map(i => i.naam), ['Roel']);
  assert.equal(l2.knop.naam, 'Roel');
});

test('een gewone verkoper heeft geen kiezer', () => {
  const l = kiezerLijst({ rol: 'sales', rechten: { alleSales: false }, verkopers: VERKOPERS });
  assert.equal(l.zichtbaar, false);
  assert.equal(l.knop, null);
  assert.deepEqual(l.groepen, []);
});

test('sales manager: enkel verkopers (ook de geblokkeerde als de server ze stuurt), de eigen naam met "(jij)", nooit "Alle"', () => {
  const l = kiezerLijst({ rol: 'sales', rechten: { alleSales: true }, verkopers: VERKOPERS.slice(0, 2), ikId: 'u-sofie', gekozenVerkoper: 'u-an', ticketNamen: TICKETS, eigen: 'Tim' });
  assert.equal(l.zichtbaar, true);
  assert.equal(l.werkruimte, 'sales');
  assert.deepEqual(namen(l), ['An Maes', 'Sofie Maes']);
  assert.equal(alleItems(l).every(i => i.soort === 'verkoper'), true);
  assert.deepEqual(alleItems(l).filter(i => i.jij).map(i => i.naam), ['Sofie Maes']);
  assert.deepEqual({ icoon: l.knop.icoon, voor: l.knop.voor, naam: l.knop.naam, werkruimte: l.knop.werkruimte, leesalleen: l.knop.leesalleen }, { icoon: '👥', voor: 'Sales:', naam: 'An', werkruimte: 'sales', leesalleen: true }); // de leads van een collega zijn voor een sales manager enkel te lezen
  const eigen = kiezerLijst({ rol: 'sales', rechten: { alleSales: true }, verkopers: VERKOPERS.slice(0, 2), ikId: 'u-sofie', gekozenVerkoper: 'u-sofie' });
  assert.equal(eigen.knop.leesalleen, false);
  assert.equal(eigen.knop.naam, 'Sofie');
  // zonder bewaarde keuze toont een sales manager zijn eigen leads
  const standaard = kiezerLijst({ rol: 'sales', rechten: { alleSales: true }, verkopers: VERKOPERS.slice(0, 2), ikId: 'u-sofie', gekozenVerkoper: null });
  assert.equal(standaard.knop.naam, 'Sofie');
  assert.equal(alleItems(standaard).filter(i => i.huidig).map(i => i.sleutel).join(), 'u-sofie');
  assert.equal(l.terug, null);
  // geen rol-labels in zijn lijst (zijn lijst bevat niets over rollen)
  assert.equal(alleItems(l).every(i => i.rolLabel === ''), true);
});

test('beheerder (techniek): twee groepen met rol achter elke naam, gekoppeld op Zoho-naam ongevoelig voor hoofdletters en spaties', () => {
  const l = kiezerLijst({
    rol: 'beheerder', rechten: { beheer: true, plannen: true, alleSales: true }, ticketNamen: TICKETS, eigen: 'Brent Calaerts',
    gebruikers: GEBRUIKERS, verkopers: VERKOPERS, gekozenTechnieker: 'Tim Peeters', ikId: 'u-b', metSales: true,
  });
  assert.deepEqual(l.groepen.map(g => g.titel), ['Techniek', 'Sales']);
  const techniek = l.groepen[0].items;
  assert.deepEqual(techniek.map(i => i.naam), ['Alle technici', 'Brent Calaerts', 'Jens Vermeulen', 'Kris Dons', 'Roel', 'Tim Peeters', 'Wim Smets']);
  const rol = (naam) => techniek.find(i => i.naam === naam);
  assert.equal(rol('Brent Calaerts').rolLabel, 'beheerder');
  assert.equal(rol('Brent Calaerts').jij, true);
  assert.equal(rol('Jens Vermeulen').rolLabel, 'technieker');
  assert.equal(rol('Kris Dons').rolLabel, 'planner');
  assert.equal(rol('Tim Peeters').rolLabel, 'technieker'); // account met " tim  peeters " (andere schrijfwijze) is gekoppeld
  assert.equal(rol('Tim Peeters').extra, '');
  assert.equal(rol('Tim Peeters').sleutel, 'Tim Peeters'); // de schrijfwijze van de tickets wint (de filter vergelijkt letterlijk)
  assert.equal(rol('Wim Smets').extra, 'geen login'); // in de tickets, geen account
  assert.equal(rol('Roel').extra, 'geen login');
  assert.equal(rol('Tim Peeters').huidig, true);
  const sales = l.groepen[1].items;
  assert.deepEqual(sales.map(i => i.naam), ['An Maes', 'Sofie Maes', 'Tom Peeters']);
  assert.deepEqual(sales.map(i => i.rolLabel), ['verkoper', 'sales manager', 'verkoper']);
  assert.equal(sales[2].extra, 'geblokkeerd (alleen lezen)');
  assert.equal(sales[2].actief, false);
  assert.equal(sales.some(i => i.huidig), false); // in de techniekwerkruimte is geen verkoper de huidige
  assert.equal(l.knop.naam, 'Tim');
  assert.equal(l.knop.werkruimte, 'techniek');
  assert.equal(l.terug, null);
});

test('beheerder bekijkt een verkoper: knop "Sales: An" (groen), "↩ Terug naar techniekers (Tim)", geen techniek als huidige', () => {
  const l = kiezerLijst({
    rol: 'beheerder', rechten: { beheer: true, plannen: true, alleSales: true }, ticketNamen: TICKETS, gebruikers: GEBRUIKERS, verkopers: VERKOPERS,
    werkruimte: 'sales', gekozenTechnieker: 'Tim Peeters', gekozenVerkoper: 'u-an', ikId: 'u-b', metSales: true,
  });
  assert.equal(l.werkruimte, 'sales');
  assert.equal(l.knop.icoon, '👥');
  assert.equal(l.knop.voor, 'Sales:');
  assert.equal(l.knop.naam, 'An');
  assert.equal(l.knop.leesalleen, false);
  assert.equal(l.terug.tekst, '↩ Terug naar techniekers (Tim)');
  assert.equal(l.terug.sleutel, 'Tim Peeters');
  assert.equal(alleItems(l).filter(i => i.huidig).map(i => i.naam).join(), 'An Maes');
  assert.equal(l.groepen[0].items.some(i => i.huidig), false);
});

test('beheerder bekijkt een geblokkeerde verkoper: "Alleen lezen" in de knop', () => {
  const l = kiezerLijst({
    rol: 'beheerder', rechten: { beheer: true, plannen: true, alleSales: true }, gebruikers: GEBRUIKERS, verkopers: VERKOPERS,
    werkruimte: 'sales', gekozenTechnieker: 'all', gekozenVerkoper: 'u-tom', metSales: true,
  });
  assert.equal(l.knop.leesalleen, true);
  assert.match(l.knop.aria, /alleen lezen/);
  assert.equal(l.terug.tekst, '↩ Terug naar techniekers (alle technici)');
});

test('beheerder zonder werkruimtewissel (metSales: false): enkel de groep Techniek, ook als de werkruimte sales bewaard was', () => {
  const l = kiezerLijst({
    rol: 'beheerder', rechten: { beheer: true, plannen: true }, ticketNamen: TICKETS, gebruikers: GEBRUIKERS, verkopers: VERKOPERS,
    werkruimte: 'sales', gekozenTechnieker: 'Roel', metSales: false,
  });
  assert.deepEqual(l.groepen.map(g => g.titel), ['Techniek']);
  assert.equal(l.werkruimte, 'techniek');
  assert.equal(l.terug, null);
});

test('beheerder: de gebruikerslijst is niet geladen -> de namen uit de tickets zonder rol-labels; verkopers mislukt -> de melding', () => {
  const l = kiezerLijst({
    rol: 'beheerder', rechten: { beheer: true, plannen: true, alleSales: true }, ticketNamen: TICKETS, gebruikers: null, verkopers: [], verkopersFout: true,
    gekozenTechnieker: 'all', metSales: true,
  });
  assert.deepEqual(l.groepen.map(g => g.titel), ['Techniek']);
  assert.deepEqual(namen(l), ['Alle technici', 'Roel', 'Tim Peeters', 'Wim Smets']);
  assert.equal(alleItems(l).every(i => i.rolLabel === '' && i.extra === ''), true);
  assert.equal(l.melding, 'De lijst met verkopers kon niet geladen worden');
});

test('geen e-mailadres (of enig ander veld van de gebruikerslijst) in de uitvoer', () => {
  const rijk = GEBRUIKERS.map(g => ({ ...g, email: 'geheim@blitz.be', wachtwoordHash: 'x', laatsteLogin: 'gisteren', telefoon: '0470' }));
  const verkopers = VERKOPERS.map(v => ({ ...v, email: 'geheim@blitz.be' }));
  const l = kiezerLijst({
    rol: 'beheerder', rechten: { beheer: true, plannen: true, alleSales: true }, ticketNamen: TICKETS, eigen: 'Brent Calaerts',
    gebruikers: rijk, verkopers, werkruimte: 'sales', gekozenVerkoper: 'u-an', metSales: true, ikId: 'u-b',
  });
  const toegestaan = new Set(['soort', 'sleutel', 'naam', 'rol', 'rolLabel', 'extra', 'actief', 'jij', 'huidig', 'sub']);
  for (const i of alleItems(l)) for (const k of Object.keys(i)) assert.ok(toegestaan.has(k), `onverwacht veld ${k}`);
  const tekst = JSON.stringify(l);
  for (const verboden of ['geheim', '@blitz', 'wachtwoord', 'laatsteLogin', '0470']) assert.equal(tekst.includes(verboden), false, verboden);
});

test('rechten.plannen bepaalt "Alle technici" voor een niet-beheerder; een technieker met "Mag zelf plannen" krijgt het niet', () => {
  const plan = kiezerLijst({ rol: 'technieker', rechten: { plannen: false, planEigen: true }, ticketNamen: TICKETS, eigen: 'Tim Peeters' });
  assert.equal(alleItems(plan).some(i => i.soort === 'alle'), false);
});

test('beheerder in de werkruimte Sales zonder bewaarde keuze: de eerste actieve verkoper (op naam) is de getoonde; een onbekende keuze valt daarop terug', () => {
  const geblokkeerdEerst = [{ id: 'u-aad', naam: 'Aad Verkoper', actief: false }, ...VERKOPERS];
  for (const keuze of [null, 'bestaat-niet']) {
    const l = kiezerLijst({ rol: 'beheerder', rechten: { beheer: true, plannen: true, alleSales: true }, gebruikers: GEBRUIKERS, verkopers: geblokkeerdEerst, werkruimte: 'sales', gekozenVerkoper: keuze, metSales: true });
    assert.equal(l.knop.naam, 'An');
    assert.equal(l.knop.leesalleen, false);
    assert.equal(l.groepen[1].items.filter(i => i.huidig).map(i => i.sleutel).join(), 'u-an');
  }
});
