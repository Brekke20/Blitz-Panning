// tests/versiering-logica.test.mjs — kern/versiering-logica.js: voorkeur per toestel, standaard aan tijdens het actieve themapakket,
// sober op aanraak. Sinds taak 6 (thema's als pakket) komt het thema uit de themas-cache (`themas: { index, pakketten }`) in plaats
// van uit de vaste kalender kern/evenementen.js; de verwachtingen van v2.2.0 (aan in oktober, uit erbuiten, testmodus, sober) blijven.
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  VOORKEUR_SLEUTEL, leesVoorkeur, bewaarVoorkeur, isSober, beslis, legeTekst, kijkvenster, STAP_MS,
} from '../public/js/kern/versiering-logica.js';
import { valideerPakket } from '../public/js/kern/themapakket-validatie.js';

const lees = (id) => valideerPakket(JSON.parse(fs.readFileSync(new URL(`../netlify/themas/${id}.blitzthema.json`, import.meta.url), 'utf8'))).pakket;
const HALLOWEEN = lees('halloween');
const KERST = lees('kerst');
const rij = (p, extra = {}) => ({ id: p.id, naam: p.naam, aan: true, periode: p.periode, periodeOverride: null, pakketHash: 'h', ...extra });
const THEMAS = { index: { versie: 1, themas: [rij(HALLOWEEN), rij(KERST)] }, pakketten: { halloween: HALLOWEEN, kerst: KERST } };

const OKT = new Date('2026-10-05T10:00:00+02:00');
const MEI = new Date('2026-05-12T10:00:00+02:00');
const desktop = { soort: 'computer', aanraak: false };
const met = (extra) => ({ nu: OKT, themas: THEMAS, ...desktop, ...extra });

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

test('beslis: halloween in de themas op 5 oktober geeft het halloween-pakket, met beweging', () => {
  const b = beslis(met());
  assert.equal(b.actief, true);
  assert.equal(b.thema.id, 'halloween');
  assert.equal(b.thema, HALLOWEEN);
  assert.equal(b.beweging, true);
  assert.equal(b.sober, false);
});

test('beslis: buiten elke periode, zonder themas of zonder pakket is er niets', () => {
  assert.equal(beslis(met({ nu: MEI })).actief, false);
  assert.equal(beslis(met({ nu: MEI })).thema, null);
  assert.equal(beslis(met({ themas: undefined })).actief, false);
  assert.equal(beslis(met({ themas: { index: null, pakketten: {} } })).actief, false);
  // index zegt actief, maar het pakket ontbreekt (nog niet opgehaald): niets (nooit een fout)
  assert.equal(beslis(met({ themas: { index: THEMAS.index, pakketten: {} } })).actief, false);
  // een geërfde sleutel telt niet als pakket
  assert.equal(beslis(met({ themas: { index: { themas: [rij({ ...HALLOWEEN, id: 'constructor' })] }, pakketten: {} } })).actief, false);
});

test('beslis: voorkeur uit geeft niets, ook met een voorbeeld', () => {
  assert.equal(beslis(met({ voorkeur: 'uit' })).actief, false);
  assert.equal(beslis(met({ voorkeur: 'uit', voorbeeld: KERST })).actief, false);
});

test('beslis: testmodus zonder testForceer geeft niets; met de vlag wel; de vlag telt enkel in testmodus', () => {
  assert.equal(beslis(met({ testMode: true })).actief, false);
  assert.equal(beslis(met({ testMode: true, testForceer: true })).thema.id, 'halloween');
  assert.equal(beslis(met({ nu: MEI, testMode: true, testForceer: true })).actief, false);
  assert.equal(beslis(met({ nu: MEI, testMode: false, testForceer: true })).actief, false);
});

test('beslis: een thema dat de beheerder uitzette (aan: false) geeft niets', () => {
  const uit = { ...THEMAS, index: { versie: 2, themas: [rij(HALLOWEEN, { aan: false }), rij(KERST)] } };
  assert.equal(beslis(met({ themas: uit })).actief, false);
});

test('beslis: een periode-override van de beheerder telt', () => {
  const verschoven = { ...THEMAS, index: { versie: 2, themas: [rij(HALLOWEEN, { periodeOverride: { van: { maand: 5, dag: 1 }, tot: { maand: 5, dag: 20 } } })] } };
  assert.equal(beslis(met({ themas: verschoven, nu: MEI })).thema.id, 'halloween');
  assert.equal(beslis(met({ themas: verschoven })).actief, false);
});

test('beslis: een voorbeeld gaat voor (kerst in oktober), ook in testmodus en buiten elke periode', () => {
  assert.equal(beslis(met({ voorbeeld: KERST })).thema.id, 'kerst');
  assert.equal(beslis(met({ voorbeeld: KERST, testMode: true })).thema.id, 'kerst');
  assert.equal(beslis(met({ voorbeeld: KERST, nu: MEI })).thema.id, 'kerst');
  assert.equal(beslis(met({ voorbeeld: null })).thema.id, 'halloween');
});

test('beslis: sober op aanraak, gsm en tablet: wel versierd, geen beweging', () => {
  for (const toestel of [{ soort: 'gsm', aanraak: true }, { soort: 'tablet', aanraak: true }, { soort: 'tablet', aanraak: false }, { soort: 'computer', aanraak: true }, { soort: 'gsm', aanraak: false }]) {
    assert.equal(isSober(toestel), true, JSON.stringify(toestel));
    const b = beslis(met(toestel));
    assert.equal(b.actief, true);
    assert.equal(b.sober, true);
    assert.equal(b.beweging, false);
  }
});

test('beslis: bewegingUit (instelling van het account) geeft enkel de stilstaande versiering: actief, geen beweging', () => {
  const b = beslis(met({ bewegingUit: true }));
  assert.equal(b.actief, true);
  assert.equal(b.thema.id, 'halloween');
  assert.equal(b.beweging, false);
  assert.equal(b.sober, false); // het toestel is een gewone computer: de koppeling met de glasvervaging blijft ongemoeid
  // false of afwezig laat de beweging toe
  assert.equal(beslis(met({ bewegingUit: false })).beweging, true);
  assert.equal(beslis(met()).beweging, true);
  // enkel `true` telt (een tekst of getal uit een kapotte opslag zet niets uit)
  assert.equal(beslis(met({ bewegingUit: 'ja' })).beweging, true);
});

test('beslis: de schakelaar per toestel (voorkeur uit) gaat voor bewegingUit; een voorbeeld volgt bewegingUit ook', () => {
  assert.equal(beslis(met({ voorkeur: 'uit', bewegingUit: true })).actief, false);
  assert.equal(beslis(met({ voorkeur: 'uit', bewegingUit: false })).actief, false);
  const v = beslis(met({ voorbeeld: KERST, bewegingUit: true }));
  assert.equal(v.thema.id, 'kerst');
  assert.equal(v.beweging, false);
  // zonder thema blijft het "niets", met of zonder bewegingUit
  assert.equal(beslis(met({ nu: MEI, bewegingUit: true })).actief, false);
});

test('beslis: desktop met muis beweegt; reduced-motion zet de beweging uit', () => {
  assert.equal(isSober(desktop), false);
  assert.equal(beslis(met()).beweging, true);
  const rm = beslis(met({ reducedMotion: true }));
  assert.equal(rm.actief, true);
  assert.equal(rm.beweging, false);
});

test('legeTekst: de tekst van het pakket, anders de standaard', () => {
  assert.equal(legeTekst(HALLOWEEN, 'wachtrijLeeg', 'x'), 'Geen spoken in de wachtrij.');
  assert.equal(legeTekst(HALLOWEEN, 'ingeplandLeeg', 'x'), 'Geen spookbezoeken gepland deze week');
  assert.equal(legeTekst(HALLOWEEN, 'onbekend', 'standaard'), 'standaard');
  assert.equal(legeTekst(KERST, 'wachtrijLeeg', 'standaard'), 'standaard'); // kerst heeft geen teksten
  assert.equal(legeTekst(null, 'wachtrijLeeg', 'standaard'), 'standaard');
  assert.equal(legeTekst({ teksten: Object.create({ wachtrijLeeg: 'geërfd' }) }, 'wachtrijLeeg', 'standaard'), 'standaard');
  assert.equal(legeTekst({ teksten: { wachtrijLeeg: 5 } }, 'wachtrijLeeg', 'standaard'), 'standaard');
});

test('kijkvenster: een staand scherm toont het staande deel, een liggend scherm alles (v2.2.0)', () => {
  const a = HALLOWEEN.achtergrond;
  const vb = HALLOWEEN.vormen.scene.viewBox;
  assert.deepEqual(kijkvenster(375, 812, a, vb), { viewBox: '820 0 780 900', uitlijning: 'xMaxYMax slice' });
  assert.deepEqual(kijkvenster(1920, 1080, a, vb), { viewBox: '0 0 1600 900', uitlijning: 'xMidYMax slice' });
  assert.deepEqual(kijkvenster(0, 0, a, vb), { viewBox: '0 0 1600 900', uitlijning: 'xMidYMax slice' });
  // zonder staand kijkvenster: altijd het geheel, ook op een staand scherm (centraal uitgelijnd)
  assert.deepEqual(kijkvenster(375, 812, { vorm: 'scene' }, vb), { viewBox: '0 0 1600 900', uitlijning: 'xMidYMax slice' });
});

// v2.1.3 (prestaties): de lus rekent hoogstens ongeveer 30 keer per seconde (een timer, geen rAF-lus)
test('STAP_MS: de lus rekent hoogstens ongeveer 30 keer per seconde', () => {
  assert.equal(STAP_MS, 33);
});

// v2.1.2: kern/versiering-thema.js. Sinds taak 6 bepaalt `voorkeurThema` van het pakket het standaardthema tijdens het thema
// (vroeger altijd donker: Halloween heeft 'donker' en houdt dus hetzelfde gedrag).
import { kiesThema, bewaarThemaKeuze, eventThemaSleutel } from '../public/js/kern/versiering-thema.js';

const themaOpslag = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };

test('thema: tijdens het thema met voorkeur donker standaard donker, ook bij opgeslagen licht', () => {
  const opslag = themaOpslag({ blitz_theme: 'light' });
  assert.equal(kiesThema({ actief: true, thema: 'halloween', voorkeurThema: 'donker', jaar: 2026, opslag }), 'dark');
});
test('thema: voorkeur licht geeft licht; zonder voorkeur geldt blitz_theme (of donker)', () => {
  assert.equal(kiesThema({ actief: true, thema: 'pasen', voorkeurThema: 'licht', jaar: 2026, opslag: themaOpslag({ blitz_theme: 'dark' }) }), 'light');
  assert.equal(kiesThema({ actief: true, thema: 'pasen', voorkeurThema: null, jaar: 2026, opslag: themaOpslag({ blitz_theme: 'light' }) }), 'light');
  assert.equal(kiesThema({ actief: true, thema: 'pasen', voorkeurThema: null, jaar: 2026, opslag: themaOpslag() }), 'dark');
  assert.equal(kiesThema({ actief: true, thema: 'pasen', voorkeurThema: 'rommel', jaar: 2026, opslag: themaOpslag({ blitz_theme: 'light' }) }), 'light');
});
test('thema: een eigen keuze tijdens het thema geldt, per jaar en per thema-id', () => {
  const opslag = themaOpslag({ blitz_theme: 'dark', blitz_theme_halloween_2026: 'light' });
  assert.equal(kiesThema({ actief: true, thema: 'halloween', voorkeurThema: 'donker', jaar: 2026, opslag }), 'light');
  assert.equal(kiesThema({ actief: true, thema: 'halloween', voorkeurThema: 'donker', jaar: 2027, opslag }), 'dark');
  assert.equal(kiesThema({ actief: true, thema: 'kerst', voorkeurThema: 'donker', jaar: 2026, opslag }), 'dark');
});
test('thema: buiten het thema geldt blitz_theme; kapotte of ontbrekende opslag geeft donker', () => {
  assert.equal(kiesThema({ actief: false, jaar: 2026, opslag: themaOpslag({ blitz_theme: 'light' }) }), 'light');
  assert.equal(kiesThema({ actief: false, jaar: 2026, opslag: themaOpslag() }), 'dark');
  assert.equal(kiesThema({ actief: false, jaar: 2026, opslag: themaOpslag({ blitz_theme: 'rommel' }) }), 'dark');
  assert.equal(kiesThema({ actief: true, thema: 'halloween', voorkeurThema: 'donker', jaar: 2026, opslag: { getItem() { throw new Error('x'); } } }), 'dark');
  assert.equal(kiesThema({ actief: false, jaar: 2026, opslag: null }), 'dark');
});
test('thema: een wissel tijdens het thema gaat naar de eigen sleutel en laat blitz_theme staan', () => {
  const opslag = themaOpslag({ blitz_theme: 'light' });
  assert.equal(bewaarThemaKeuze({ actief: true, thema: 'halloween', jaar: 2026, opslag, keuze: 'dark' }), eventThemaSleutel('halloween', 2026));
  assert.equal(opslag.m.get('blitz_theme_halloween_2026'), 'dark');
  assert.equal(opslag.m.get('blitz_theme'), 'light');
  const o2 = themaOpslag({ blitz_theme: 'dark' });
  assert.equal(bewaarThemaKeuze({ actief: false, jaar: 2026, opslag: o2, keuze: 'light' }), 'blitz_theme');
  assert.equal(o2.m.get('blitz_theme'), 'light');
  assert.equal(bewaarThemaKeuze({ actief: false, jaar: 2026, opslag: { setItem() { throw new Error('x'); } }, keuze: 'light' }), null);
});
