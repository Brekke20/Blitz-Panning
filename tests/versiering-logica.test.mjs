// tests/versiering-logica.test.mjs — kern/versiering-logica.js: voorkeur per toestel, standaard aan in het venster, sober op aanraak.
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOORKEUR_SLEUTEL, leesVoorkeur, bewaarVoorkeur, isSober, beslis, legeTekst } from '../public/js/kern/versiering-logica.js';
import { MAX_SPINNEN } from '../public/js/kern/evenementen.js';

const OKT = new Date('2026-10-12T10:00:00+02:00');
const MEI = new Date('2026-05-12T10:00:00+02:00');
const desktop = { soort: 'computer', aanraak: false };

function nepOpslag(begin = {}) {
  const d = { ...begin };
  return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; }, d };
}

test('voorkeur: standaard auto, uit blijft staan, auto haalt de sleutel weg', () => {
  const o = nepOpslag();
  assert.equal(leesVoorkeur(o), 'auto');
  assert.equal(bewaarVoorkeur(o, 'uit'), true);
  assert.equal(o.d[VOORKEUR_SLEUTEL], 'uit');
  assert.equal(leesVoorkeur(o), 'uit');
  bewaarVoorkeur(o, 'auto');
  assert.equal(VOORKEUR_SLEUTEL in o.d, false);
  assert.equal(leesVoorkeur(o), 'auto');
});

test('voorkeur: een kapotte of ontbrekende opslag gooit niet', () => {
  const kapot = { getItem() { throw new Error('geblokkeerd'); }, setItem() { throw new Error('geblokkeerd'); }, removeItem() { throw new Error('x'); } };
  assert.equal(leesVoorkeur(kapot), 'auto');
  assert.equal(leesVoorkeur(null), 'auto');
  assert.equal(bewaarVoorkeur(kapot, 'uit'), false);
  assert.equal(leesVoorkeur(nepOpslag({ [VOORKEUR_SLEUTEL]: 'rommel' })), 'auto');
});

test('standaard AAN binnen het venster, uit erbuiten', () => {
  assert.equal(beslis({ nu: OKT, ...desktop }).actief, true);
  assert.equal(beslis({ nu: OKT, ...desktop }).thema, 'halloween');
  assert.equal(beslis({ nu: MEI, ...desktop }).actief, false);
});

test('de gebruiker kan het uitzetten, ook binnen het venster', () => {
  assert.equal(beslis({ nu: OKT, voorkeur: 'uit', ...desktop }).actief, false);
});

test('evenement zonder thema (Kerst) toont niets', () => {
  assert.equal(beslis({ nu: new Date('2026-12-24T10:00:00+01:00'), ...desktop }).actief, false);
});

test('testmodus: uit, tenzij de test het afdwingt; buiten het venster ook dan niets', () => {
  assert.equal(beslis({ nu: OKT, testMode: true, ...desktop }).actief, false);
  assert.equal(beslis({ nu: OKT, testMode: true, testForceer: true, ...desktop }).actief, true);
  assert.equal(beslis({ nu: MEI, testMode: true, testForceer: true, ...desktop }).actief, false);
  // de vlag telt enkel in testmodus: in productie verandert hij niets
  assert.equal(beslis({ nu: MEI, testMode: false, testForceer: true, ...desktop }).actief, false);
});

test('sober op aanraak, gsm en tablet: wel versierd, geen beweging', () => {
  for (const toestel of [{ soort: 'gsm', aanraak: true }, { soort: 'tablet', aanraak: true }, { soort: 'tablet', aanraak: false }, { soort: 'computer', aanraak: true }, { soort: 'gsm', aanraak: false }]) {
    assert.equal(isSober(toestel), true, JSON.stringify(toestel));
    const b = beslis({ nu: OKT, ...toestel });
    assert.equal(b.actief, true);
    assert.equal(b.sober, true);
    assert.equal(b.beweging, false);
    assert.equal(b.spinnen, 0);
  }
});

test('desktop met muis: beweging, hoogstens MAX_SPINNEN spinnen; reduced-motion zet de beweging uit', () => {
  assert.equal(isSober(desktop), false);
  const b = beslis({ nu: OKT, ...desktop });
  assert.equal(b.beweging, true);
  assert.ok(b.spinnen > 0 && b.spinnen <= MAX_SPINNEN);
  const rm = beslis({ nu: OKT, reducedMotion: true, ...desktop });
  assert.equal(rm.actief, true);
  assert.equal(rm.beweging, false);
  assert.equal(rm.spinnen, 0);
});

test('lege teksten: themateksten enkel waar gedefinieerd', () => {
  assert.equal(legeTekst('halloween', 'wachtrij', 'x'), 'Geen spoken in de wachtrij.');
  assert.equal(legeTekst('halloween', 'onbekend', 'standaard'), 'standaard');
  assert.equal(legeTekst('kerst', 'wachtrij', 'standaard'), 'standaard');
});
