// tests/spel-regels.test.mjs — de gedeelde regels van Blitz Run (ontgrendelen, scorevalidatie) en de pariteit client <-> server.
// Hangt niet af van specifieke skin-ids (enkel standaardSkin()): eigen skinlijsten waar een regel getest wordt.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { SKINS, standaardSkin } from '../public/js/spel/skins.js';
import {
  MAX_SCORE, geldigeScore, ontgrendeldeSkins, ontgrendelVoorwaarde, schoonVoortgang, voegWachtendSamen, datumBrussel, leegVoortgang,
} from '../public/js/spel/spel-regels.js';
import { bewaarSpel, leesSpel, voortgangVan } from '../netlify/lib/spel.js';

const TESTSKINS = [
  { id: 'a', naam: 'A', soort: 'basis' },
  { id: 'g1', naam: 'G1', soort: 'goud', drempel: 1500 },
  { id: 'g2', naam: 'G2', soort: 'goud', drempel: 4000 },
  { id: 'e1', naam: 'E1', soort: 'event', eventId: 'halloween' },
  { id: 'e2', naam: 'E2', soort: 'event', eventId: 'kerst' },
];
const o = (extra) => ontgrendeldeSkins({ skins: TESTSKINS, ...extra });

test('ontgrendelen: basis altijd; score-skins op de drempel (vanaf, niet erboven)', () => {
  assert.deepEqual(o({ besteScore: 0 }), ['a']);
  assert.deepEqual(o({ besteScore: 1499 }), ['a']);
  assert.deepEqual(o({ besteScore: 1500 }), ['a', 'g1']);
  assert.deepEqual(o({ besteScore: 99999 }), ['a', 'g1', 'g2']);
});

test('ontgrendelen: een event-skin enkel bij een actief event (op eventId of als spelSkin); anders niet', () => {
  assert.deepEqual(o({ evenementen: [] }), ['a']);
  assert.deepEqual(o({ evenementen: [{ id: 'halloween' }] }), ['a', 'e1']);
  assert.deepEqual(o({ evenementen: [{ id: 'iets-anders', spelSkin: 'e2' }] }), ['a', 'e2']);
  assert.deepEqual(o({ evenementen: [{ id: 'paasbrunch' }] }), ['a']);
});

test('ontgrendelen: eerder ontgrendelde skins blijven (ook een event-skin na het event); onbekende ids niet', () => {
  assert.deepEqual(o({ bewaard: ['e1', 'bestaat-niet', 'g2'] }), ['a', 'g2', 'e1']);
});

test('ontgrendelen: rommel in de invoer valt terug op de basis', () => {
  assert.deepEqual(o({ besteScore: 0, bewaard: 'x', evenementen: [null, 5, 'a', { id: 3 }] }), ['a']);
  assert.deepEqual(ontgrendeldeSkins({ skins: [] }), []);
});

test('de echte SKINS: de standaardskin bestaat, is een basisskin en altijd ontgrendeld', () => {
  const s = SKINS.find(x => x.id === standaardSkin());
  assert.ok(s);
  assert.ok(ontgrendeldeSkins({}).includes(standaardSkin()));
});

test('de echte SKINS: unieke ids; elke goud-skin heeft een drempel, elke event-skin een eventId', () => {
  assert.equal(new Set(SKINS.map(s => s.id)).size, SKINS.length);
  for (const s of SKINS) {
    assert.ok(['basis', 'goud', 'event'].includes(s.soort), s.id);
    if (s.soort === 'goud') assert.equal(typeof s.drempel, 'number', s.id);
    if (s.soort === 'event') assert.equal(typeof s.eventId, 'string', s.id);
  }
});

test('voorwaardetekst: "vanaf N punten" en "<Event>-event"', () => {
  assert.equal(ontgrendelVoorwaarde({ soort: 'goud', drempel: 1500 }), 'vanaf 1500 punten');
  assert.equal(ontgrendelVoorwaarde({ soort: 'event', eventId: 'halloween' }), 'Halloween-event');
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
test('pariteit: de server ontgrendelt precies wat de client-regel zegt, voor een reeks scores en events', async () => {
  const scores = [0, 1, 99, 1499, 1500, 2999, 3000, 4000, 9999, MAX_SCORE];
  const events = [[], [{ id: 'halloween' }], [{ id: 'kerst', spelSkin: 'x' }], SKINS.filter(s => s.eventId).map(s => ({ id: s.eventId }))];
  for (const score of scores) {
    for (const evenementen of events) {
      const store = maakNepStore({});
      const r = await bewaarSpel(store, 'u1', { score }, { evenementen });
      const verwacht = ontgrendeldeSkins({ besteScore: score, evenementen });
      assert.deepEqual(r.voortgang.ontgrendeld, verwacht, `score ${score}`);
      assert.deepEqual((await leesSpel(store, 'u1', evenementen)).ontgrendeld, verwacht);
    }
  }
});

test('pariteit: voortgangVan van een leeg record is de beginstand van de client', () => {
  assert.deepEqual(voortgangVan(null), leegVoortgang());
  assert.deepEqual(voortgangVan(undefined), leegVoortgang());
});

test('de echte skins: een basis-skin met drempel is vergrendeld onder die drempel (nooit "basis = altijd open")', () => {
  const open = (besteScore, evenementen = []) => ontgrendeldeSkins({ besteScore, evenementen });
  assert.deepEqual(open(0), ['blitz']);
  assert.ok(!open(249).includes('olijf'));
  assert.ok(open(250).includes('olijf'));
  assert.ok(!open(6499).includes('poolijs') && open(6500).includes('poolijs'));
  assert.ok(!open(9999).includes('goud') && open(10000).includes('goud'));
  assert.deepEqual(open(0, [{ id: 'halloween', spelSkin: 'spookpaal' }]), ['blitz', 'halloween']);
  assert.deepEqual(open(0, [{ id: 'kerst', spelSkin: null }]), ['blitz', 'kerst']);
});

test('de echte skins: de voorwaardetekst voor elke skin met drempel > 0 en voor event-skins', () => {
  for (const s of SKINS) {
    if (s.soort === 'event') assert.match(ontgrendelVoorwaarde(s), /-event$/, s.id);
    else if (s.drempel > 0) assert.equal(ontgrendelVoorwaarde(s), `vanaf ${s.drempel} punten`, s.id);
    else assert.equal(ontgrendelVoorwaarde(s), '', s.id);
  }
  assert.equal(ontgrendelVoorwaarde(SKINS.find(s => s.id === 'olijf')), 'vanaf 250 punten');
  assert.equal(ontgrendelVoorwaarde(SKINS.find(s => s.eventId === 'halloween')), 'Halloween-event');
  assert.equal(ontgrendelVoorwaarde(SKINS.find(s => s.eventId === 'kerst')), 'Kerst-event');
});
