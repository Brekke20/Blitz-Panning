// tests/spel-regels.test.mjs — de gedeelde regels van Blitz Run (ontgrendelen, scorevalidatie) en de pariteit client <-> server.
// Hangt niet af van specifieke skin-ids (enkel standaardSkin()) waar een regel getest wordt met eigen skinlijsten; de themaskins
// van de echte pakketten (VOORGELADEN) komen apart aan bod.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { SKINS, alleSkins, themaSkins, standaardSkin } from '../public/js/spel/skins.js';
import {
  MAX_SCORE, geldigeScore, ontgrendeldeSkins, ontgrendelVoorwaarde, schoonVoortgang, voegWachtendSamen, datumBrussel, leegVoortgang,
  isThemaSkinId, onbekendeThemaIds,
} from '../public/js/spel/spel-regels.js';
import { bewaarSpel, leesSpel, voortgangVan } from '../netlify/lib/spel.js';
import { VOORGELADEN } from '../netlify/themas/pakketten.js';

// Bewust gewijzigd (taak 8): event-skins (`soort: 'event'`, `eventId`, parameter `evenementen`) zijn themaskins geworden
// (`soort: 'thema'`, het skin-id is het thema-id, parameter `actieveThemaIds`).
const TESTSKINS = [
  { id: 'a', naam: 'A', soort: 'basis' },
  { id: 'g1', naam: 'G1', soort: 'goud', drempel: 1500 },
  { id: 'g2', naam: 'G2', soort: 'goud', drempel: 4000 },
  { id: 'e1', naam: 'E1', soort: 'thema', themaNaam: 'Eerste' },
  { id: 'e2', naam: 'E2', soort: 'thema', themaNaam: 'Tweede' },
];
const o = (extra) => ontgrendeldeSkins({ skins: TESTSKINS, ...extra });
const ALLE = alleSkins(VOORGELADEN);

test('ontgrendelen: basis altijd; score-skins op de drempel (vanaf, niet erboven)', () => {
  assert.deepEqual(o({ besteScore: 0 }), ['a']);
  assert.deepEqual(o({ besteScore: 1499 }), ['a']);
  assert.deepEqual(o({ besteScore: 1500 }), ['a', 'g1']);
  assert.deepEqual(o({ besteScore: 99999 }), ['a', 'g1', 'g2']);
});

test('ontgrendelen: een themaskin enkel als zijn thema-id actief is; anders niet', () => {
  assert.deepEqual(o({ actieveThemaIds: [] }), ['a']);
  assert.deepEqual(o({ actieveThemaIds: ['e1'] }), ['a', 'e1']);
  assert.deepEqual(o({ actieveThemaIds: ['e2', 'onbekend'] }), ['a', 'e2']);
  assert.deepEqual(o({ actieveThemaIds: ['paasbrunch'] }), ['a']);
  assert.deepEqual(o({}), ['a']);
});

test('ontgrendelen: eerder ontgrendelde skins blijven (ook een themaskin na het thema); onbekende ids niet', () => {
  assert.deepEqual(o({ bewaard: ['e1', 'bestaat-niet', 'g2'] }), ['a', 'g2', 'e1']);
});

test('ontgrendelen: rommel in de invoer valt terug op de basis', () => {
  assert.deepEqual(o({ besteScore: 0, bewaard: 'x', actieveThemaIds: [null, 5, 'a', 3] }), ['a']);
  assert.deepEqual(o({ actieveThemaIds: 'e1' }), ['a']);
  assert.deepEqual(ontgrendeldeSkins({ skins: [] }), []);
});

test('de echte skins: halloween is open met actieveThemaIds ["halloween"], dicht zonder; bewaard blijft open zonder actief thema', () => {
  const open = (extra) => ontgrendeldeSkins({ skins: ALLE, ...extra });
  assert.ok(open({ actieveThemaIds: ['halloween'] }).includes('halloween'));
  assert.ok(!open({ actieveThemaIds: ['halloween'] }).includes('kerst'));
  assert.ok(!open({}).includes('halloween'));
  assert.ok(!open({ besteScore: 99999 }).includes('halloween'), 'een hoge score ontgrendelt een themaskin niet');
  assert.ok(open({ bewaard: ['halloween'] }).includes('halloween'));
  assert.ok(!open({ bewaard: ['halloween'] }).includes('kerst'));
});

test('de echte SKINS: de standaardskin bestaat, is een basisskin en altijd ontgrendeld', () => {
  const s = SKINS.find(x => x.id === standaardSkin());
  assert.ok(s);
  assert.ok(ontgrendeldeSkins({}).includes(standaardSkin()));
});

test('de echte skins: unieke ids; elke goud-skin heeft een drempel, elke themaskin het thema-id van zijn pakket', () => {
  assert.equal(new Set(ALLE.map(s => s.id)).size, ALLE.length);
  for (const s of ALLE) {
    assert.ok(['basis', 'goud', 'thema'].includes(s.soort), s.id);
    if (s.soort === 'goud') assert.equal(typeof s.drempel, 'number', s.id);
    if (s.soort === 'thema') assert.ok(VOORGELADEN.some(p => p.id === s.id), s.id);
  }
});

test('voorwaardetekst: "vanaf N punten" en "<Naam>-thema"', () => {
  assert.equal(ontgrendelVoorwaarde({ soort: 'goud', drempel: 1500 }), 'vanaf 1500 punten');
  assert.equal(ontgrendelVoorwaarde({ soort: 'thema', id: 'halloween' }), 'Halloween-thema', 'zonder themanaam: het id met een hoofdletter');
  assert.equal(ontgrendelVoorwaarde({ soort: 'thema', id: 'kerst', themaNaam: 'Kerst' }), 'Kerst-thema');
  assert.equal(ontgrendelVoorwaarde({ soort: 'thema', id: 'nationale-feestdag', themaNaam: '21 juli' }), '21 juli-thema');
  assert.equal(ontgrendelVoorwaarde({ soort: 'basis' }), '');
});

test('geldigeScore: gehele getallen 0..MAX_SCORE; kommagetallen naar beneden; de rest is null', () => {
  assert.equal(geldigeScore(0), 0);
  assert.equal(geldigeScore(MAX_SCORE), MAX_SCORE);
  assert.equal(geldigeScore(7.9), 7);
  for (const x of [-1, MAX_SCORE + 1, NaN, Infinity, '5', null, undefined, {}, true]) assert.equal(geldigeScore(x), null, String(x));
});

test('schoonVoortgang: onbekende skins en een vergrendelde gekozen skin vallen terug op de standaard', () => {
  assert.deepEqual(schoonVoortgang(null, TESTSKINS), { besteScore: 0, ontgrendeld: [standaardSkin()], gekozenSkin: standaardSkin() });
  const v = schoonVoortgang({ besteScore: 10, ontgrendeld: ['a', 'weg'], gekozenSkin: 'g1' }, TESTSKINS);
  assert.deepEqual(v.ontgrendeld, ['a']);
  assert.equal(v.gekozenSkin, standaardSkin());
  assert.equal(schoonVoortgang({ besteScore: -5 }, TESTSKINS).besteScore, 0);
});

test('isThemaSkinId en onbekendeThemaIds: een geldig thema-id dat de lijst niet kent blijft bewaard (themas worden nooit verwijderd)', () => {
  assert.equal(isThemaSkinId('halloween'), true);
  assert.equal(isThemaSkinId('nationale-feestdag'), true);
  for (const x of ['', 'a', 'Halloween', 'a b', '__proto__', 'constructor', 'prototype', 'blitz', 'goud', 'olijf', 5, null, 'x'.repeat(31)]) assert.equal(isThemaSkinId(x), false, String(x));
  // de lijst met skins kent 'halloween' niet: dan is het een "onbekend maar geldig" id dat de aanroeper moet bewaren
  assert.deepEqual(onbekendeThemaIds(['blitz', 'halloween', 'kerst', 'rommel!', 5, 'halloween'], [{ id: 'blitz' }, { id: 'kerst' }]), ['halloween']);
  assert.deepEqual(onbekendeThemaIds('geen lijst', []), []);
  assert.deepEqual(onbekendeThemaIds(undefined, []), []);
});

test('voegWachtendSamen: hoogste score, laatste skin', () => {
  assert.deepEqual(voegWachtendSamen({ score: 50, gekozenSkin: 'a' }, { score: 30, gekozenSkin: 'b' }), { score: 50, gekozenSkin: 'b' });
  assert.deepEqual(voegWachtendSamen(null, { score: 30 }), { score: 30 });
  assert.deepEqual(voegWachtendSamen({ score: 5, gekozenSkin: 'a' }, { score: 9 }), { score: 9, gekozenSkin: 'a' });
});

test('datumBrussel: de datum in Brusselse tijd, ook rond middernacht en de zomertijd', () => {
  assert.equal(datumBrussel(Date.parse('2026-10-31T22:30:00Z')), '2026-10-31'); // 23:30 in Brussel (CET)
  assert.equal(datumBrussel(Date.parse('2026-10-31T23:30:00Z')), '2026-11-01');
  assert.equal(datumBrussel(Date.parse('2026-07-01T22:30:00Z')), '2026-07-02'); // 00:30 CEST
});

// ---- Pariteit client <-> server: dezelfde regels, dezelfde uitkomst ----
test('pariteit: de server ontgrendelt precies wat de client-regel zegt, voor een reeks scores en actieve thema\'s', async () => {
  const scores = [0, 1, 99, 1499, 1500, 2999, 3000, 4000, 4499, 4500, MAX_SCORE];
  const themas = [[], ['halloween'], ['kerst', 'bestaat-niet'], themaSkins(VOORGELADEN).map(s => s.id)];
  const skins = themaSkins(VOORGELADEN).map(s => ({ id: s.id, naam: s.naam, soort: 'thema' }));
  for (const score of scores) {
    for (const actieveThemaIds of themas) {
      const store = maakNepStore({});
      const bron = { skins, actieveThemaIds };
      const r = await bewaarSpel(store, 'u1', { score }, { bron });
      const verwacht = ontgrendeldeSkins({ besteScore: score, actieveThemaIds, skins: alleSkins(VOORGELADEN) });
      assert.deepEqual(r.voortgang.ontgrendeld, verwacht, `score ${score}`);
      assert.deepEqual((await leesSpel(store, 'u1', bron)).ontgrendeld, verwacht);
    }
  }
});

test('pariteit: voortgangVan van een leeg record is de beginstand van de client', () => {
  assert.deepEqual(voortgangVan(null), leegVoortgang());
  assert.deepEqual(voortgangVan(undefined), leegVoortgang());
});

test('de echte skins: een basis-skin met drempel is vergrendeld onder die drempel (nooit "basis = altijd open")', () => {
  const open = (besteScore, actieveThemaIds = []) => ontgrendeldeSkins({ besteScore, actieveThemaIds, skins: ALLE });
  assert.deepEqual(open(0), ['blitz']);
  assert.ok(!open(499).includes('olijf'));
  assert.ok(open(500).includes('olijf'));
  assert.ok(!open(3799).includes('poolijs') && open(3800).includes('poolijs'));
  assert.ok(!open(4499).includes('goud') && open(4500).includes('goud'));
  assert.deepEqual(open(0, ['halloween']), ['blitz', 'halloween']);
  assert.deepEqual(open(0, ['kerst']), ['blitz', 'kerst']);
});

test('de echte skins: de voorwaardetekst voor elke skin met drempel > 0 en voor themaskins', () => {
  for (const s of ALLE) {
    if (s.soort === 'thema') assert.match(ontgrendelVoorwaarde(s), /-thema$/, s.id);
    else if (s.drempel > 0) assert.equal(ontgrendelVoorwaarde(s), `vanaf ${s.drempel} punten`, s.id);
    else assert.equal(ontgrendelVoorwaarde(s), '', s.id);
  }
  assert.equal(ontgrendelVoorwaarde(SKINS.find(s => s.id === 'olijf')), 'vanaf 500 punten');
  assert.equal(ontgrendelVoorwaarde(ALLE.find(s => s.id === 'halloween')), 'Halloween-thema');
  assert.equal(ontgrendelVoorwaarde(ALLE.find(s => s.id === 'kerst')), 'Kerst-thema');
});
