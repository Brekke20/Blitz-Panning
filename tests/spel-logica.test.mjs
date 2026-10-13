// tests/spel-logica.test.mjs — de pure spelregels van Blitz Run (natuurkunde, hitboxen, snelheid, score, de 5-tikdetector)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SPELER, FYSICA, HINDERNIS, SNELHEID, WERELD, HITBOX_MARGE, BLIKSEM_VANAF_AFSTAND,
  snelheidBij, scoreBij, spelerBox, botst, maakStaat, stap, maakHindernis, volgendeAfstand,
  aanraakActie, maakTikDetector,
} from '../public/js/spel/spel-logica.js';

const vast = (...w) => { let i = 0; return () => w[i++ % w.length]; };
const jerrycanOp = (x) => ({ soort: 'jerrycan', x, b: HINDERNIS.jerrycan.b, h: HINDERNIS.jerrycan.h, bodem: 0 });
const bliksemOp = (x) => ({ soort: 'bliksem', x, b: HINDERNIS.bliksem.b, h: HINDERNIS.bliksem.h, bodem: HINDERNIS.bliksem.bodem });
const grond = () => ({ y: 0, vy: 0, bukken: false });

test('spelerBox: staand is hoog en slank, bukkend lager en breder (de hitbox volgt de houding)', () => {
  const staand = spelerBox(grond());
  const bukkend = spelerBox({ ...grond(), bukken: true });
  assert.ok(bukkend.h < staand.h);
  assert.ok(bukkend.b > staand.b);
  assert.equal(staand.x, SPELER.x);
});

test('botst: een jerrycan op de grond raakt een speler op de grond, niet een speler die hoog genoeg springt', () => {
  const j = jerrycanOp(SPELER.x);
  assert.equal(botst(grond(), j), true);
  assert.equal(botst({ y: HINDERNIS.jerrycan.h + HITBOX_MARGE * 2 + 1, vy: 0, bukken: false }, j), false);
});

test('botst: een bliksem raakt een staande speler (ook een springende) maar niet een bukkende', () => {
  const b = bliksemOp(SPELER.x);
  assert.equal(botst(grond(), b), true);
  assert.equal(botst({ y: 80, vy: 0, bukken: false }, b), true, 'over een bliksem springen kan niet');
  assert.equal(botst({ ...grond(), bukken: true }, b), false);
});

test('botst: de bukhouding is lager dan de bliksembodem, de staande houding hoger (het ontwerp klopt)', () => {
  assert.ok(SPELER.bukken.h < HINDERNIS.bliksem.bodem);
  assert.ok(SPELER.staan.h > HINDERNIS.bliksem.bodem);
});

test('botst: dingen die elkaar enkel raken of ruim ernaast zitten botsen niet; de marge is vergevingsgezind', () => {
  assert.equal(botst(grond(), jerrycanOp(SPELER.x + SPELER.staan.b)), false);
  assert.equal(botst(grond(), jerrycanOp(SPELER.x + 300)), false);
  // net binnen de getekende rand maar binnen de marge: geen botsing
  assert.equal(botst(grond(), jerrycanOp(SPELER.x + SPELER.staan.b - HITBOX_MARGE)), false);
  assert.equal(botst(grond(), jerrycanOp(SPELER.x + SPELER.staan.b - HITBOX_MARGE * 2 - 1)), true);
});

test('snelheid: begint op de startsnelheid, stijgt geleidelijk en stopt bij het maximum', () => {
  assert.equal(snelheidBij(0), SNELHEID.start);
  assert.ok(snelheidBij(1000) > snelheidBij(0));
  assert.ok(snelheidBij(5000) > snelheidBij(1000));
  assert.equal(snelheidBij(1e9), SNELHEID.max);
  assert.equal(snelheidBij(-50), SNELHEID.start);
});

test('score: afstand gedeeld door 40, naar beneden afgerond en nooit negatief', () => {
  assert.equal(scoreBij(0), 0);
  assert.equal(scoreBij(39), 0);
  assert.equal(scoreBij(40), 1);
  assert.equal(scoreBij(399), 9);
  assert.equal(scoreBij(400), 10);
  assert.equal(scoreBij(-5), 0);
});

test('stap: springen vanaf de grond geeft een boog die terug op de grond landt', () => {
  const s = maakStaat(vast(0.5));
  s.volgendeBij = Infinity;
  stap(s, 1 / 60, { spring: true });
  assert.ok(s.speler.y > 0 && s.speler.vy > 0);
  let top = 0;
  for (let i = 0; i < 120 && s.speler.y > 0; i++) { stap(s, 1 / 60, {}); top = Math.max(top, s.speler.y); }
  assert.equal(s.speler.y, 0);
  assert.ok(top > HINDERNIS.jerrycan.h * 2, 'de sprong is hoog genoeg voor een jerrycan');
  assert.ok(top < FYSICA.spring ** 2 / FYSICA.zwaartekracht / 2 + 1);
});

test('stap: in de lucht springen doet niets extra (geen dubbele sprong)', () => {
  const s = maakStaat(vast(0.5));
  s.volgendeBij = Infinity;
  stap(s, 1 / 60, { spring: true });
  const vy = s.speler.vy;
  stap(s, 1 / 60, { spring: true });
  assert.ok(s.speler.vy < vy, 'de zwaartekracht werkt gewoon door');
});

test('stap: bukken op de grond geeft de bukhouding; in de lucht niet; bukken in de lucht valt sneller', () => {
  const s = maakStaat(vast(0.5));
  s.volgendeBij = Infinity;
  stap(s, 1 / 60, { bukken: true });
  assert.equal(s.speler.bukken, true);
  stap(s, 1 / 60, { bukken: false });
  assert.equal(s.speler.bukken, false);

  const a = maakStaat(vast(0.5)); a.volgendeBij = Infinity;
  const b = maakStaat(vast(0.5)); b.volgendeBij = Infinity;
  stap(a, 1 / 60, { spring: true }); stap(b, 1 / 60, { spring: true });
  for (let i = 0; i < 10; i++) { stap(a, 1 / 60, {}); stap(b, 1 / 60, { bukken: true }); }
  assert.ok(b.speler.y < a.speler.y, 'omlaag duwen in de lucht valt sneller');
  assert.equal(b.speler.bukken, false);
});

test('stap: springen en bukken tegelijk op de grond is bukken (geen sprong)', () => {
  const s = maakStaat(vast(0.5));
  s.volgendeBij = Infinity;
  stap(s, 1 / 60, { spring: true, bukken: true });
  assert.equal(s.speler.y, 0);
  assert.equal(s.speler.bukken, true);
});

test('stap: de afstand en dus de score lopen op met de snelheid; hindernissen schuiven naar links', () => {
  const s = maakStaat(vast(0.5));
  s.volgendeBij = Infinity;
  s.hindernissen.push(jerrycanOp(500));
  stap(s, 0.5, {});
  assert.ok(Math.abs(s.afstand - SNELHEID.start * 0.5) < 1e-9);
  assert.ok(Math.abs(s.hindernissen[0].x - (500 - SNELHEID.start * 0.5)) < 1e-9);
});

test('stap: een jerrycan overleef je door te springen, zonder sprong ben je af (en daarna staat alles stil)', () => {
  const lopen = (springOp) => {
    const s = maakStaat(vast(0.5));
    s.volgendeBij = Infinity;
    s.hindernissen.push(jerrycanOp(220));
    for (let i = 0; i < 90; i++) {
      stap(s, 1 / 60, { spring: i === springOp });
      if (s.dood) break;
    }
    return s;
  };
  assert.equal(lopen(-1).dood, true);
  // snelheid 260 u/s: 164 eenheden afstand = 0,63 s = 38 stappen; spring ruim ervoor
  assert.equal(lopen(14).dood, false);
  const dood = lopen(-1);
  const afstand = dood.afstand;
  stap(dood, 1, {});
  assert.equal(dood.afstand, afstand);
});

test('stap: een bliksem overleef je door te bukken, niet door te springen of staan te blijven', () => {
  const lopen = (invoerBij) => {
    const s = maakStaat(vast(0.5));
    s.volgendeBij = Infinity;
    s.hindernissen.push(bliksemOp(220));
    for (let i = 0; i < 90 && !s.dood; i++) stap(s, 1 / 60, invoerBij(i));
    return s;
  };
  assert.equal(lopen(() => ({})).dood, true);
  assert.equal(lopen(i => ({ spring: i === 10 })).dood, true);
  assert.equal(lopen(() => ({ bukken: true })).dood, false);
});

test('maakHindernis: voor de bliksemgrens enkel jerrycans; erna een mengeling volgens de rng', () => {
  assert.equal(maakHindernis(BLIKSEM_VANAF_AFSTAND - 1, () => 0).soort, 'jerrycan');
  assert.equal(maakHindernis(BLIKSEM_VANAF_AFSTAND, () => 0.1).soort, 'bliksem');
  assert.equal(maakHindernis(BLIKSEM_VANAF_AFSTAND, () => 0.9).soort, 'jerrycan');
  const h = maakHindernis(0, () => 0);
  assert.ok(h.x > WERELD.breedte);
});

test('volgendeAfstand: groeit met de snelheid zodat er altijd reactietijd is', () => {
  assert.ok(volgendeAfstand(500, () => 0) > volgendeAfstand(250, () => 0));
  assert.ok(volgendeAfstand(300, () => 0) >= 300 * 0.8);
});

test('spel speelt volledig door met een eenvoudige "bot": hindernissen verschijnen en komen voorbij', () => {
  const s = maakStaat(vast(0.3, 0.7, 0.2, 0.9));
  let gesprongen = 0;
  for (let i = 0; i < 60 * 40 && !s.dood; i++) {
    const naast = s.hindernissen.find(h => h.x + h.b > 40 && h.x < 56 + 140);
    const vooruit = naast && naast.x < 56 + SPELER.staan.b + 60 + s.snelheid * 0.12;
    const spring = Boolean(vooruit && naast.soort === 'jerrycan' && s.speler.y === 0);
    if (spring) gesprongen++;
    stap(s, 1 / 60, { spring, bukken: Boolean(vooruit && naast.soort === 'bliksem') });
  }
  assert.ok(gesprongen > 0);
  assert.ok(s.afstand > 2000, `de bot haalde ${s.afstand}`);
});

test('aanraakActie: bovenste helft springt, onderste helft bukt', () => {
  assert.equal(aanraakActie(10, 100), 'spring');
  assert.equal(aanraakActie(49.9, 100), 'spring');
  assert.equal(aanraakActie(50, 100), 'bukken');
  assert.equal(aanraakActie(99, 100), 'bukken');
});

test('tikdetector: vijf tikken binnen het venster slaan aan, daarna begint het opnieuw', () => {
  const tik = maakTikDetector({ aantal: 5, venster: 2000 });
  assert.deepEqual([0, 300, 600, 900].map(tik), [false, false, false, false]);
  assert.equal(tik(1200), true);
  assert.equal(tik(1300), false, 'de teller begint opnieuw');
});

test('tikdetector: te traag tikken slaat niet aan (schuivend venster)', () => {
  const tik = maakTikDetector({ aantal: 5, venster: 2000 });
  assert.deepEqual([0, 600, 1200, 1800, 2400].map(tik), [false, false, false, false, false]);
  assert.equal(tik(2500), true, 'de laatste vijf liggen wel binnen 2 s');
});

test('tikdetector: precies op de vensterrand telt nog mee; erbuiten niet', () => {
  const a = maakTikDetector({ aantal: 5, venster: 2000 });
  assert.equal([0, 500, 1000, 1500, 2000].map(a).pop(), true);
  const b = maakTikDetector({ aantal: 5, venster: 2000 });
  assert.equal([0, 500, 1000, 1500, 2001].map(b).pop(), false);
});
