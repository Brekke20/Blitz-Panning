// tests/versiering-logica.test.mjs — kern/versiering-logica.js: voorkeur per toestel, standaard aan in het venster, sober op aanraak.
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOORKEUR_SLEUTEL, leesVoorkeur, bewaarVoorkeur, isSober, beslis, legeTekst, STAP_MS } from '../public/js/kern/versiering-logica.js';
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

// v2.1.2: kern/versiering-thema.js en schermen/evenement-scene.js
import { kiesThema, bewaarThemaKeuze, eventThemaSleutel } from '../public/js/kern/versiering-thema.js';
import { sceneSvg, sterren, kijkvenster } from '../public/js/schermen/evenement-scene.js';

const themaOpslag = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };

test('thema: tijdens het evenement standaard donker, ook bij opgeslagen licht', () => {
  const opslag = themaOpslag({ blitz_theme: 'light' });
  assert.equal(kiesThema({ actief: true, thema: 'halloween', jaar: 2026, opslag }), 'dark');
});
test('thema: een eigen keuze tijdens het evenement geldt, per jaar', () => {
  const opslag = themaOpslag({ blitz_theme: 'dark', blitz_theme_halloween_2026: 'light' });
  assert.equal(kiesThema({ actief: true, thema: 'halloween', jaar: 2026, opslag }), 'light');
  assert.equal(kiesThema({ actief: true, thema: 'halloween', jaar: 2027, opslag }), 'dark');
});
test('thema: buiten het evenement geldt blitz_theme; kapotte of ontbrekende opslag geeft donker', () => {
  assert.equal(kiesThema({ actief: false, jaar: 2026, opslag: themaOpslag({ blitz_theme: 'light' }) }), 'light');
  assert.equal(kiesThema({ actief: false, jaar: 2026, opslag: themaOpslag() }), 'dark');
  assert.equal(kiesThema({ actief: false, jaar: 2026, opslag: themaOpslag({ blitz_theme: 'rommel' }) }), 'dark');
  assert.equal(kiesThema({ actief: true, thema: 'halloween', jaar: 2026, opslag: { getItem() { throw new Error('x'); } } }), 'dark');
  assert.equal(kiesThema({ actief: false, jaar: 2026, opslag: null }), 'dark');
});
test('thema: een wissel tijdens het evenement gaat naar de eigen sleutel en laat blitz_theme staan', () => {
  const opslag = themaOpslag({ blitz_theme: 'light' });
  assert.equal(bewaarThemaKeuze({ actief: true, thema: 'halloween', jaar: 2026, opslag, keuze: 'dark' }), eventThemaSleutel('halloween', 2026));
  assert.equal(opslag.m.get('blitz_theme_halloween_2026'), 'dark');
  assert.equal(opslag.m.get('blitz_theme'), 'light');
  const o2 = themaOpslag({ blitz_theme: 'dark' });
  assert.equal(bewaarThemaKeuze({ actief: false, jaar: 2026, opslag: o2, keuze: 'light' }), 'blitz_theme');
  assert.equal(o2.m.get('blitz_theme'), 'light');
  assert.equal(bewaarThemaKeuze({ actief: false, jaar: 2026, opslag: { setItem() { throw new Error('x'); } }, keuze: 'light' }), null);
});
test('scène: sterren zijn vast en liggen in de bovenste helft, buiten de gloed van de maan', () => {
  const a = sterren(), b = sterren();
  assert.deepEqual(a, b);
  assert.equal(a.length, 46);
  for (const s of a) { assert.ok(s.y <= 430 && s.x >= 0 && s.x <= 1600); assert.ok(Math.hypot(s.x - 1380, s.y - 170) >= 150); }
});
test('scène: één svg, zonder netwerkverwijzingen of scripts, met verlicht raam en vier vogelverschrikkers', () => {
  const s = sceneSvg();
  assert.equal((s.match(/<svg/g) || []).length, 1);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(s) && !/<script|<image|onload|xlink/.test(s));
  assert.ok(s.includes('#f97316'));
  assert.equal((s.match(/<use href="#ev-vv"/g) || []).length, 4);
});
test('scène: een staand scherm toont het rechterdeel, een liggend scherm alles', () => {
  assert.equal(kijkvenster(375, 812).uitlijning, 'xMaxYMax slice');
  assert.equal(kijkvenster(1920, 1080).viewBox, '0 0 1600 900');
  assert.equal(kijkvenster(0, 0).viewBox, '0 0 1600 900');
});

// v2.1.3 (prestaties): de lus rekent hoogstens ongeveer 30 keer per seconde (een timer, geen rAF-lus), zonder rustpauzes
test('STAP_MS: de lus rekent hoogstens ongeveer 30 keer per seconde', () => {
  assert.ok(STAP_MS >= 30 && STAP_MS <= 40);
});
