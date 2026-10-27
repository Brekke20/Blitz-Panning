// Open dag, taak 7: de samenvatting onder de paginatitel op `breed` (puur, schermen/paginakop-logica.js).
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samenvattingVoor, isoWeekNummer } from '../public/js/schermen/paginakop-logica.js';

// ── Wachtrij ──
test('wachtrij: meervoud met verlopen', () => {
  assert.equal(samenvattingVoor('tickets', { wachtend: 4, verlopen: 1 }), '4 tickets wachten op een datum, 1 verlopen');
});
test('wachtrij: één ticket', () => {
  assert.equal(samenvattingVoor('tickets', { wachtend: 1, verlopen: 0 }), '1 ticket wacht op een datum');
});
test('wachtrij: zonder verlopen geen tweede deel', () => {
  assert.equal(samenvattingVoor('tickets', { wachtend: 3, verlopen: 0 }), '3 tickets wachten op een datum');
});
test('wachtrij: leeg', () => {
  assert.equal(samenvattingVoor('tickets', { wachtend: 0, verlopen: 0 }), 'Geen tickets wachten op een datum');
});

// ── Kalender ──
test('kalender: week, stops en zonder datum', () => {
  assert.equal(samenvattingVoor('kalender', { week: 44, gepland: 3, zonderDatum: 1 }), 'Week 44 · 3 stops gepland, 1 zonder datum');
});
test('kalender: één stop', () => {
  assert.equal(samenvattingVoor('kalender', { week: 44, gepland: 1, zonderDatum: 0 }), 'Week 44 · 1 stop gepland');
});
test('kalender: nog niets gepland', () => {
  assert.equal(samenvattingVoor('kalender', { week: 44, gepland: 0, zonderDatum: 0 }), 'Week 44 · nog niets gepland');
});
test('kalender: nog niets gepland, met zonder datum', () => {
  assert.equal(samenvattingVoor('kalender', { week: 44, gepland: 0, zonderDatum: 2 }), 'Week 44 · nog niets gepland, 2 zonder datum');
});

// ── Ingepland ──
test('ingepland: meervoud', () => {
  assert.equal(samenvattingVoor('gepland', { dezeWeek: 5, wachtBevestiging: 2 }), '5 afspraken deze week, 2 wachten op bevestiging');
});
test('ingepland: enkelvoud', () => {
  assert.equal(samenvattingVoor('gepland', { dezeWeek: 1, wachtBevestiging: 1 }), '1 afspraak deze week, 1 wacht op bevestiging');
});
test('ingepland: geen afspraken', () => {
  assert.equal(samenvattingVoor('gepland', { dezeWeek: 0, wachtBevestiging: 0 }), 'Geen afspraken deze week');
});
test('ingepland: zonder wachtende geen tweede deel', () => {
  assert.equal(samenvattingVoor('gepland', { dezeWeek: 3, wachtBevestiging: 0 }), '3 afspraken deze week');
});

// ── Inventaris ──
test('inventaris: meervoud', () => {
  assert.equal(samenvattingVoor('inventaris', { onderGrens: 3 }), '3 producten onder hun meldgrens');
});
test('inventaris: enkelvoud', () => {
  assert.equal(samenvattingVoor('inventaris', { onderGrens: 1 }), '1 product onder zijn meldgrens');
});
test('inventaris: alles boven de grens', () => {
  assert.equal(samenvattingVoor('inventaris', { onderGrens: 0 }), 'Alles boven de meldgrens');
});
// Taak 8a: zonder geladen wagenvoorraad weten we niets ("Alles boven de meldgrens" zou dan liegen).
test('inventaris: wagenvoorraad nog niet geladen: geen samenvatting', () => {
  assert.equal(samenvattingVoor('inventaris', { onderGrens: 0, geladen: false }), '');
  assert.equal(samenvattingVoor('inventaris', { onderGrens: 2, geladen: false }), '');
  assert.equal(samenvattingVoor('inventaris', { onderGrens: 2, geladen: true }), '2 producten onder hun meldgrens');
});
// Ruling 13: "Alle" toont de aanvullingen, niet de voorraad per wagen.
test('inventaris: persoon "Alle": geen samenvatting', () => {
  assert.equal(samenvattingVoor('inventaris', { onderGrens: 4, geladen: true, alle: true }), '');
  assert.equal(samenvattingVoor('inventaris', { onderGrens: 0, alle: true }), '');
});

// ── Leads (sales) ──
test('leads: meervoud', () => {
  assert.equal(samenvattingVoor('sales-lijst', { open: 6 }), '6 open leads');
});
test('leads: enkelvoud', () => {
  assert.equal(samenvattingVoor('sales-lijst', { open: 1 }), '1 open lead');
});
test('leads: geen', () => {
  assert.equal(samenvattingVoor('sales-lijst', { open: 0 }), 'Geen open leads');
});

// ── Andere schermen ──
test('elke andere tab: lege tekst', () => {
  for (const id of ['planning', 'rapporten', 'beheer', 'sales-kalender', 'onbekend', '']) assert.equal(samenvattingVoor(id, { open: 3, wachtend: 2 }), '');
});
test('ontbrekende of ongeldige cijfers tellen als 0', () => {
  assert.equal(samenvattingVoor('tickets', {}), 'Geen tickets wachten op een datum');
  assert.equal(samenvattingVoor('sales-lijst'), 'Geen open leads');
  assert.equal(samenvattingVoor('inventaris', { onderGrens: Number.NaN }), 'Alles boven de meldgrens');
});

// ── ISO-weeknummer (Kalender: week van de gekozen datum) ──
test('isoWeekNummer: ISO 8601, maandag als eerste dag', () => {
  assert.equal(isoWeekNummer(new Date(2026, 9, 27)), 44);  // di 27 oktober 2026
  assert.equal(isoWeekNummer(new Date(2026, 9, 26)), 44);  // maandag
  assert.equal(isoWeekNummer(new Date(2026, 10, 1)), 44);  // zondag 1 november: nog week 44
  assert.equal(isoWeekNummer(new Date(2026, 10, 2)), 45);  // maandag
  assert.equal(isoWeekNummer(new Date(2027, 0, 1)), 53);   // vr 1 januari 2027 hoort bij week 53 van 2026
  assert.equal(isoWeekNummer(new Date(2026, 0, 1)), 1);    // do 1 januari 2026: week 1
  assert.equal(isoWeekNummer(new Date(2026, 2, 29)), 13);  // zondag van de zomertijdwissel
});
