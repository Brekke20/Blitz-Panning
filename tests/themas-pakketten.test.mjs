// tests/themas-pakketten.test.mjs — de voorgeladen themapakketten (netlify/themas): Halloween en Kerst.
// Elk pakket moet door de validator (kern/themapakket-validatie.js) en blijft gelijk aan wat de app nu hardcode toont.
// Alles waarmee vergeleken wordt dat een latere taak uit de code schrapt (de SVG-constanten van evenement-laag.js, de scène van
// evenement-scene.js, de skins en canvas-extra's van spel/skins.js, LEGE_TEKSTEN) staat hieronder als vastgelegde kopie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOORGELADEN } from '../netlify/themas/pakketten.js';
import { valideerPakket, contrastVerhouding, MAX_PAKKET_BYTES } from '../public/js/kern/themapakket-validatie.js';

const pakket = (id) => VOORGELADEN.find((p) => p.id === id);
const halloween = () => pakket('halloween');
const kerst = () => pakket('kerst');

// ---- Vastgelegde kopieën ----

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): evenement-laag.js:23-25
const WEB = '<path d="M0 0H100M0 0L90 40M0 0L70 70M0 0L40 90M0 0V100"/><path d="M22 0Q20 18 0 22M45 0Q40 40 0 45M70 0Q60 60 0 70M95 0Q80 80 0 95"/>';
const SPIN = '<ellipse cx="12" cy="13" rx="4" ry="5"/><circle cx="12" cy="7.5" r="2.6"/><path d="M8 11L2 7M8 13L1 13M8 15L2 20M9 17L5 23M16 11L22 7M16 13L23 13M16 15L22 20M15 17L19 23" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>';
const VLEERMUIS = '<path d="M16 17c-2-3-4-6-9-7 1 2 1 4 0 6-2-1-5 0-7 2 3 0 5 1 6 3 1-1 3-1 4 1 1-2 3-3 6-3 3 0 5 1 6 3 1-2 3-2 4-1 1-2 3-3 6-3-2-2-5-3-7-2-1-2-1-4 0-6-5 1-7 4-9 7z" transform="translate(4 3)"/>';

// karakterisering van de Halloween-vormen van v2.2.0 (evenement-scene.js is in taak 6 geschrapt; vastgelegde getallen):
// aantal tekenelementen van sceneSvg() in evenement-scene.js, met de vier `<use href="#ev-vv">` uitgeschreven (per vogelverschrikker 1 cirkel, 3 paden en 2 rechthoeken).
const SCENE_AANTALLEN = { circle: 57, path: 25, rect: 28, ellipse: 0, polygon: 0, line: 0 };

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): LEGE_TEKSTEN.halloween in kern/versiering-logica.js
const HALLOWEEN_TEKSTEN = { wachtrijLeeg: 'Geen spoken in de wachtrij.', ingeplandLeeg: 'Geen spookbezoeken gepland deze week' };

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): de event-skins in spel/skins.js
const HALLOWEEN_SKIN = { naam: 'Spookpaal', faceplate: '#ff7a00', behuizing: '#1b0f26', bliksem: '#1b0f26', extra: 'heksenhoed' };
const KERST_SKIN = { naam: 'Kerstpaal', faceplate: '#c8102e', behuizing: '#0f3d22', bliksem: '#ffffff', extra: 'kerstmuts' };

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): de canvascode van `heksenhoed` en `kerstmuts` in spel/skins.js,
// uitgevoerd met bw = bh = 100, x = 0, top = 0, t = 0 en niet bukkend (dus eenheden = procent van de paal). Opgenomen aanroepen:
//   heksenhoed: fillStyle #2a1840, strokeStyle #e9f2f8, lineWidth 1.2; fillRect+strokeRect(-10,-5,120,5);
//               vlak (10,-5) (90,-5) (75,-38) (50,-42) met vulling en lijn; fillStyle #ff7a00, fillRect(10,-12,80,5)
//   kerstmuts:  fillStyle #d3162f; moveTo(5,-3) quad(10,-39.8 -> 70,-35) quad(107,-33.4 -> 112,-20.6) quad(90,-19 -> 95,-3) sluiten, vullen;
//               fillStyle #ffffff, fillRect(0,-6,100,7.8); cirkel (112,-20.6) met straal 11
const HEKSENHOED_DELEN = [
  { soort: 'path', d: 'M-10 -5H110V0H-10Z', vul: '#2a1840', lijn: '#e9f2f8', lijnDikte: 1.2 },
  { soort: 'path', d: 'M10 -5L90 -5L75 -38L50 -42Z', vul: '#2a1840', lijn: '#e9f2f8', lijnDikte: 1.2 },
  { soort: 'path', d: 'M10 -12H90V-7H10Z', vul: '#ff7a00' },
];
const KERSTMUTS_KEGEL = 'M5 -3Q10 -39.8 70 -35Q107 -33.4 112 -20.6Q90 -19 95 -3Z';
const KERSTMUTS_PELS = 'M0 -6H100V1.8H0Z';

// ---- Hulpen ----

// Telt de tekenende delen (geen groepen) per soort, groepen worden doorlopen.
function tel(delen, uit = { circle: 0, path: 0, rect: 0, ellipse: 0, polygon: 0, line: 0 }) {
  for (const d of delen) {
    if (d.soort === 'groep') tel(d.delen, uit);
    else uit[d.soort] += 1;
  }
  return uit;
}
function alleDelen(delen) {
  return delen.flatMap((d) => (d.soort === 'groep' ? alleDelen(d.delen) : [d]));
}
// Leest een rij `<tag a="b" .../>` uit een SVG-fragment als [{ tag, attrs }].
function leesTags(html) {
  return [...html.matchAll(/<(\w+)([^>]*)\/>/g)].map(([, tag, rest]) => ({
    tag,
    attrs: Object.fromEntries([...rest.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
  }));
}
const GEOMETRIE = { path: ['d'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'] };
// Controleert dat de delen van een vorm dezelfde meetkunde (en eventuele lijndikte en transformatie) hebben als de oude SVG-tekst.
function vergelijkMetOudeSvg(vorm, html) {
  const tags = leesTags(html);
  assert.equal(vorm.delen.length, tags.length, 'evenveel delen als de oude tekening');
  tags.forEach(({ tag, attrs }, i) => {
    const deel = vorm.delen[i];
    assert.equal(deel.soort, tag, `deel ${i}: soort`);
    for (const sleutel of GEOMETRIE[tag]) {
      const verwacht = sleutel === 'd' ? attrs.d : Number(attrs[sleutel]);
      assert.equal(deel[sleutel], verwacht, `deel ${i}: ${sleutel}`);
    }
    if (attrs['stroke-width']) assert.equal(deel.lijnDikte, Number(attrs['stroke-width']), `deel ${i}: lijnDikte`);
    if (attrs.transform) assert.equal(deel.transform, attrs.transform, `deel ${i}: transform`);
    if (attrs['stroke-linecap'] === 'round') assert.equal(deel.lijnEinde, 'rond', `deel ${i}: lijnEinde`);
  });
}

// ---- Alle voorgeladen pakketten ----

test('VOORGELADEN is een bevroren lijst en bevat Halloween en Kerst', () => {
  assert.ok(Array.isArray(VOORGELADEN));
  assert.ok(Object.isFrozen(VOORGELADEN));
  assert.ok(halloween(), 'halloween ontbreekt');
  assert.ok(kerst(), 'kerst ontbreekt');
});

test('elk voorgeladen pakket is geldig en blijft onder 512 kB', () => {
  for (const p of VOORGELADEN) {
    const r = valideerPakket(p);
    assert.equal(r.ok, true, `${p.id}: ${JSON.stringify(r.fouten)}`);
    assert.ok(JSON.stringify(p).length <= MAX_PAKKET_BYTES, `${p.id} is te groot`);
  }
});

test('de id van elk voorgeladen pakket is uniek en gelijk aan de bestandsnaam', async () => {
  const ids = VOORGELADEN.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const { readdirSync } = await import('node:fs');
  const bestanden = readdirSync(new URL('../netlify/themas/', import.meta.url)).filter((f) => f.endsWith('.blitzthema.json')).sort();
  assert.deepEqual(bestanden, ids.map((id) => `${id}.blitzthema.json`).sort());
});

// ---- Halloween ----

test('Halloween: periode, kleuren en voorkeurthema zoals nu', () => {
  const p = halloween();
  assert.equal(p.naam, 'Halloween');
  assert.deepEqual(p.periode, { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } });
  assert.equal(p.kleuren.donker.accent, '#f97316');
  assert.equal(p.kleuren.licht.accent, '#c2570c');
  assert.equal(p.kleuren.voorkeurThema, 'donker');
});

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): css/evenement.css:48-52
//   [data-event="halloween"] (beide thema's): --accent #f97316, --accent-hover #fb8a3c, --accent-dim rgba(249,115,22,0.12),
//     --accent-glow rgba(249,115,22,0.24), --on-accent #1f0d00
//   [data-event="halloween"][data-theme="light"] overschrijft enkel: --accent #c2570c, --accent-dim rgba(194,87,12,0.12),
//     --accent-glow rgba(194,87,12,0.22); hover en on-accent blijven dus die van het donkere blok.
// (rgba-alpha naar hex: 0,12 = 1f, 0,24 = 3d, 0,22 = 38)
const HALLOWEEN_KLEUREN = {
  donker: { accent: '#f97316', accentHover: '#fb8a3c', accentDim: '#f973161f', accentGlow: '#f973163d', opAccent: '#1f0d00' },
  licht: { accent: '#c2570c', accentHover: '#fb8a3c', accentDim: '#c2570c1f', accentGlow: '#c2570c38', opAccent: '#1f0d00' },
  voorkeurThema: 'donker',
};

test('Halloween: de volledige donkere en lichte kleurenset is die van v2.2.0 (ook hover en tekst op accent in licht)', () => {
  assert.deepEqual(halloween().kleuren, HALLOWEEN_KLEUREN);
});

test('elk voorgeladen pakket geeft het lichte thema evenveel kleursleutels als het donkere', () => {
  for (const p of VOORGELADEN) {
    if (p.kleuren.licht) assert.deepEqual(Object.keys(p.kleuren.licht).sort(), Object.keys(p.kleuren.donker).sort(), p.id);
  }
});

test('Halloween: de versiering is hoek (web, 4 hoeken), hangen, kruipen, vliegen en mist', () => {
  assert.deepEqual(halloween().versiering, [
    // richting 'naarHoek' (taak 6): de webben wijzen in elke hoek naar de hoek, zoals .ev-web-tl/tr/bl/br van v2.2.0 (scaleX/scaleY -1)
    { beweging: 'hoek', beeld: 'web', hoeken: ['lb', 'rb', 'lo', 'ro'], richting: 'naarHoek' },
    { beweging: 'hangen', beeld: 'spin', aantal: 2 },
    { beweging: 'kruipen', beeld: 'spin', aantal: 1, langs: 'tabbalk' },
    { beweging: 'vliegen', beeld: 'vleermuis', aantal: 1 },
    { beweging: 'mist' },
  ]);
});

test('Halloween: de lege teksten zijn die van v2.2.0', () => {
  assert.deepEqual(halloween().teksten, HALLOWEEN_TEKSTEN);
});

test('Halloween: de spelskin heeft de kleuren van de huidige skin en de heksenhoed als extra', () => {
  assert.deepEqual(halloween().spelskin, HALLOWEEN_SKIN);
  assert.ok(halloween().vormen.heksenhoed, 'de vorm heksenhoed ontbreekt');
});

test('Halloween: de vormen web, spin en vleermuis hebben exact de padstrings van v2.2.0', () => {
  const { vormen } = halloween();
  vergelijkMetOudeSvg(vormen.web, WEB);
  vergelijkMetOudeSvg(vormen.spin, SPIN);
  vergelijkMetOudeSvg(vormen.vleermuis, VLEERMUIS);
  assert.equal(vormen.web.viewBox, '0 0 100 100');
  assert.equal(vormen.spin.viewBox, '0 0 24 24');
  assert.equal(vormen.vleermuis.viewBox, '0 0 40 26');
});

test('Halloween: de web is een lijntekening zonder vulling, de spin heeft pootjes als ronde lijn', () => {
  const { web, spin } = halloween().vormen;
  for (const d of web.delen) { assert.equal(d.vul, 'geen'); assert.equal(d.lijnDikte, 1); assert.ok(d.lijn); }
  const poten = spin.delen.find((d) => d.soort === 'path');
  assert.equal(poten.vul, 'geen');
  assert.ok(poten.lijn);
  assert.equal(poten.lijnEinde, 'rond');
});

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): css/evenement.css:7-12
//   --ev-web: rgba(220, 225, 230, 0.4) (donker) en rgba(40, 50, 65, 0.4) (licht); --ev-spin: #aab3bd (donker) en #2b2b2b (licht)
test('Halloween: web, spin en vleermuis hebben dezelfde donkere en lichte kleuren als de CSS-variabelen van v2.2.0', () => {
  const { web, spin, vleermuis } = halloween().vormen;
  for (const d of web.delen) {
    assert.equal(d.lijn, '#dce1e6'); // 220,225,230
    assert.equal(d.lijnLicht, '#283241'); // 40,50,65
    assert.equal(d.dekking, 0.4);
  }
  for (const d of spin.delen) {
    if (d.vul === 'geen') { assert.equal(d.lijn, '#aab3bd'); assert.equal(d.lijnLicht, '#2b2b2b'); } else { assert.equal(d.vul, '#aab3bd'); assert.equal(d.vulLicht, '#2b2b2b'); }
  }
  assert.equal(vleermuis.delen[0].vul, '#aab3bd');
  assert.equal(vleermuis.delen[0].vulLicht, '#2b2b2b');
});

test('Halloween: de vogelverschrikker heeft een afgeronde balk (rx 2) en ronde armen, de takken van de boom een ronde lijn', () => {
  const alle = alleDelen(halloween().vormen.scene.delen);
  const balken = alle.filter((d) => d.soort === 'rect' && d.width === 76);
  assert.equal(balken.length, 4);
  for (const b of balken) assert.equal(b.rx, 2);
  const rond = alle.filter((d) => d.lijnEinde === 'rond');
  assert.deepEqual(rond.map((d) => d.lijnDikte), [2.2, 2.2, 2.2, 2.2, 5]);
  // Elke andere rechthoek in de scène is scherp.
  assert.equal(alle.filter((d) => d.soort === 'rect' && d.rx !== undefined).length, 4);
});

test('Halloween: de vorm scene telt evenveel cirkels, paden en rechthoeken als sceneSvg() van v2.2.0', () => {
  const { scene } = halloween().vormen;
  assert.deepEqual(tel(scene.delen), SCENE_AANTALLEN);
  assert.equal(scene.viewBox, '0 0 1600 900');
});

test('Halloween: de scène schrijft de vier vogelverschrikkers uit als groepen met dezelfde transformatie', () => {
  const groepen = halloween().vormen.scene.delen.filter((d) => d.soort === 'groep');
  const verschrikkers = groepen.filter((g) => g.delen.length === 6);
  assert.deepEqual(verschrikkers.map((g) => g.transform), [
    'translate(250 790) rotate(-4) scale(0.95)',
    'translate(560 765) rotate(3) scale(0.75)',
    'translate(1010 770) rotate(-3) scale(0.8)',
    'translate(1420 790) rotate(4) scale(1.05)',
  ]);
  for (const g of verschrikkers) assert.deepEqual(tel(g.delen), { circle: 1, path: 3, rect: 2, ellipse: 0, polygon: 0, line: 0 });
});

test('Halloween: de scène heeft de lucht en twee gloeden als verloop, en de achtergrondinstellingen kloppen', () => {
  const p = halloween();
  const verlopen = alleDelen(p.vormen.scene.delen).filter((d) => d.vul && typeof d.vul === 'object');
  assert.deepEqual(verlopen.map((d) => d.vul.verloop), ['lineair', 'radiaal', 'radiaal']);
  // keuze opdrachtgever 2026-10-22: eigen lichte versie (een lichte schemering met eigen verlopen) aan 0,75 in plaats van de
  // verbleekte nachtscène aan 0,2
  assert.deepEqual(verlopen.map((d) => d.vulLicht?.verloop), ['lineair', 'radiaal', 'radiaal']);
  assert.deepEqual(p.achtergrond, { vorm: 'scene', kijkvensterStaand: '820 0 780 900', dekkingLicht: 0.75 });
});

test('Halloween: de heksenhoed is opgebouwd uit paden met de kleuren van de canvascode', () => {
  const { heksenhoed } = halloween().vormen;
  assert.deepEqual(heksenhoed.delen, HEKSENHOED_DELEN);
});

// ---- Kerst ----

test('Kerst: periode 7/12 tot 31/12 en een accent dat op beide achtergronden afsteekt', () => {
  const p = kerst();
  assert.equal(p.naam, 'Kerst');
  assert.deepEqual(p.periode, { van: { maand: 12, dag: 7 }, tot: { maand: 12, dag: 31 } });
  for (const [modus, achtergrond] of [['donker', '#181e24'], ['licht', '#f5f6f7']]) {
    const accent = p.kleuren[modus].accent;
    for (const bg of ['#181e24', '#f5f6f7']) {
      assert.ok(contrastVerhouding(accent, bg) >= 3, `${modus}.accent ${accent} tegen ${bg}`);
    }
    assert.ok(contrastVerhouding(accent, achtergrond) >= 3);
  }
});

test('Kerst: vallen (sneeuwvlok), hangen (kerstbal, 2) en vliegen (rendier, 1)', () => {
  const { versiering, vormen } = kerst();
  assert.deepEqual(versiering.map((e) => e.beweging), ['vallen', 'hangen', 'vliegen']);
  assert.equal(versiering[0].beeld, 'sneeuwvlok');
  assert.deepEqual(versiering[1], { beweging: 'hangen', beeld: 'kerstbal', aantal: 2 });
  assert.deepEqual(versiering[2], { beweging: 'vliegen', beeld: 'rendier', aantal: 1 });
  for (const naam of ['sneeuwvlok', 'kerstbal', 'rendier']) assert.ok(vormen[naam], `vorm ${naam} ontbreekt`);
});

test('Kerst: de spelskin heeft de kleuren van de huidige skin en de kerstmuts als extra', () => {
  assert.deepEqual(kerst().spelskin, KERST_SKIN);
});

test('Kerst: de kerstmuts is opgebouwd uit paden met de kleuren van de canvascode', () => {
  const { delen } = kerst().vormen.kerstmuts;
  assert.equal(delen.length, 3);
  assert.deepEqual(delen[0], { soort: 'path', d: KERSTMUTS_KEGEL, vul: '#d3162f' });
  assert.deepEqual(delen[1], { soort: 'path', d: KERSTMUTS_PELS, vul: '#ffffff' });
  // De pompon is een cirkel met straal 11 % van de breedte: in de eenheden van de box een ellips (de paal is 18 breed en 52 hoog).
  assert.equal(delen[2].soort, 'path');
  assert.equal(delen[2].vul, '#ffffff');
  assert.match(delen[2].d, /^M123 -20\.6A11 3\.8 0 1 0 101 -20\.6A11 3\.8 0 1 0 123 -20\.6Z$/);
});

test('beide skins gebruiken enkel paden in hun extra (zo kan het spel ze met Path2D tekenen)', () => {
  for (const [p, extra] of [[halloween(), 'heksenhoed'], [kerst(), 'kerstmuts']]) {
    const delen = p.vormen[extra].delen;
    assert.ok(delen.every((d) => d.soort === 'path'), `${extra}: enkel paden`);
  }
});

// ---- De zeven nieuwe pakketten (spec §7) ----

const NIEUWE_IDS = ['nieuwjaar', 'valentijn', 'carnaval', 'pasen', 'zomer', 'nationale-feestdag', 'sinterklaas'];
const periodeVast = (vm, vd, tm, td) => ({ van: { maand: vm, dag: vd }, tot: { maand: tm, dag: td } });
// Tabel van spec §7: periode, skin (naam en extra) en de telling per beweging.
const VERWACHT = {
  nieuwjaar: { periode: periodeVast(1, 1, 1, 6), skin: ['Feestpaal', 'feesthoedje'], tel: { vuurwerk: 1, vallen: 10 } },
  valentijn: { periode: periodeVast(2, 10, 2, 14), skin: ['Liefdespaal', 'paalhartje'], tel: { opstijgen: 8, hoek: 2 } },
  carnaval: { periode: { basis: 'pasen', van: -52, tot: -46 }, skin: ['Carnavalspaal', 'masker'], tel: { vallen: 12, hoek: 2 } },
  pasen: { periode: { basis: 'pasen', van: -7, tot: 1 }, skin: ['Paaspaal', 'konijnenoren'], tel: { hoek: 2, opstijgen: 6 } },
  zomer: { periode: periodeVast(7, 1, 8, 31), skin: ['Zomerpaal', 'zonnebril'], tel: { hoek: 1, opstijgen: 6 } },
  'nationale-feestdag': { periode: periodeVast(7, 19, 7, 21), skin: ['Driekleurpaal', 'vlaggetje'], tel: { hoek: 2, vuurwerk: 1 } },
  sinterklaas: { periode: periodeVast(12, 1, 12, 6), skin: ['Sintpaal', 'sintmijter'], tel: { vallen: 10, hoek: 1 } },
};
// Telt per beweging hoeveel exemplaren de versiering levert (een `hoek` telt per hoek, `vuurwerk` als 1).
function telVersiering(versiering) {
  const uit = {};
  for (const e of versiering) uit[e.beweging] = (uit[e.beweging] ?? 0) + (e.beweging === 'hoek' ? e.hoeken.length : (e.aantal ?? 1));
  return uit;
}

test('VOORGELADEN bevat precies de negen id\'s uit de spec', () => {
  assert.deepEqual(VOORGELADEN.map((p) => p.id).sort(), ['halloween', 'kerst', ...NIEUWE_IDS].sort());
});

test('de zeven nieuwe pakketten hebben de periode uit de tabel van de spec', () => {
  for (const id of NIEUWE_IDS) assert.deepEqual(pakket(id)?.periode, VERWACHT[id].periode, id);
});

test('de zeven nieuwe pakketten hebben de skin (naam en extra) uit de tabel, met een extra die enkel uit paden bestaat', () => {
  for (const id of NIEUWE_IDS) {
    const p = pakket(id);
    assert.deepEqual([p.spelskin.naam, p.spelskin.extra], VERWACHT[id].skin, id);
    const delen = p.vormen[p.spelskin.extra].delen;
    assert.ok(delen.length > 0 && delen.every((d) => d.soort === 'path'), `${id}: de extra bestaat enkel uit paden`);
  }
});

test('de zeven nieuwe pakketten hebben precies de aantallen per beweging uit de tabel', () => {
  for (const id of NIEUWE_IDS) assert.deepEqual(telVersiering(pakket(id).versiering), VERWACHT[id].tel, id);
});

test('het accent van elk van de zeven nieuwe pakketten (en van Kerst) steekt in licht en donker af op beide achtergronden (3:1)', () => {
  for (const id of [...NIEUWE_IDS, 'kerst']) {
    const { kleuren } = pakket(id);
    for (const modus of ['donker', 'licht']) {
      for (const bg of ['#181e24', '#f5f6f7']) {
        const verhouding = contrastVerhouding(kleuren[modus].accent, bg);
        assert.ok(verhouding >= 3, `${id}.${modus}.accent ${kleuren[modus].accent} tegen ${bg}: ${verhouding.toFixed(2)}`);
      }
    }
  }
});

test('de zeven nieuwe pakketten hebben vormen en beelden zonder rasterbeelden, en de opgegeven versie', () => {
  for (const id of NIEUWE_IDS) {
    const p = pakket(id);
    assert.equal(p.beelden, undefined, `${id}: vectorvormen, geen rasterbeelden`);
    assert.equal(p.versie, '2026-10-22', id);
    assert.equal(p.formaat, 1, id);
  }
});

test('de zeven nieuwe pakketten hebben vriendelijke lege teksten (max 80 tekens)', () => {
  for (const id of NIEUWE_IDS) {
    const { teksten } = pakket(id);
    assert.ok(teksten, `${id}: teksten ontbreken`);
    for (const t of Object.values(teksten)) assert.ok(t.length > 0 && t.length <= 80, `${id}: ${t}`);
  }
});

test('Nieuwjaar heeft een nachtlucht als achtergrond en een donkere voorkeur', () => {
  const p = pakket('nieuwjaar');
  assert.equal(p.achtergrond.vorm, 'nachtlucht');
  assert.equal(p.kleuren.voorkeurThema, 'donker');
  // keuze opdrachtgever 2026-10-22: elk thema krijgt een eigen achtergrond, ook Valentijn (vroeger: geen achtergrond).
  assert.equal(pakket('valentijn').achtergrond.vorm, 'schemering');
});

test('de driekleur van 21 juli is de Belgische (zwart, geel, rood) en niet de Nederlandse', () => {
  const kleuren = JSON.stringify(pakket('nationale-feestdag').vormen).toLowerCase();
  for (const k of ['#111111', '#fdda24', '#ed2939']) assert.ok(kleuren.includes(k), `ontbrekende kleur ${k}`);
  for (const k of ['#ae1c28', '#21468b']) assert.ok(!kleuren.includes(k), `Nederlandse kleur ${k}`);
});

test('Sinterklaas toont enkel mijter, staf, lekkers en daken met een paard (geen figuren)', () => {
  const p = pakket('sinterklaas');
  // keuze opdrachtgever 2026-10-22: de achtergrond `daken` (daken, schoorstenen, maan en een paard, geen mensen) komt erbij.
  assert.deepEqual(Object.keys(p.vormen).sort(), ['daken', 'mijter', 'pepernoot', 'sintmijter', 'speculaas']);
});

// ---- Achtergronden en de mijter (keuze opdrachtgever 2026-10-22) ----

// keuze opdrachtgever 2026-10-22: eigen lichte versie. In het lichte thema tekent elke achtergrond een eigen pastelversie (vulLicht en
// lijnLicht, de lucht als licht verloop) aan 50 tot 80 % dekking: een bewust pastellandschap in plaats van de verbleekte nachtscène.
// De leesbaarheid van de kaarten bewaakt e2e/versiering.spec.mjs (4,5:1 over de lichtste en donkerste kleur, per thema).
const NIEUWE_ACHTERGRONDEN = {
  kerst: 'dorp', valentijn: 'schemering', carnaval: 'straat', pasen: 'weide', zomer: 'strand', 'nationale-feestdag': 'brussel', sinterklaas: 'daken',
};
const vierGetallen = (t) => t.trim().split(/\s+/).map(Number);

test('elk voorgeladen pakket heeft een achtergrond met een bestaande vorm en 50 tot 80 % dekking in het lichte thema', () => {
  for (const p of VOORGELADEN) {
    const a = p.achtergrond;
    assert.ok(a, `${p.id}: achtergrond ontbreekt`);
    assert.ok(Object.hasOwn(p.vormen, a.vorm), `${p.id}: vorm ${a.vorm} bestaat niet`);
    assert.equal(typeof a.dekkingLicht, 'number', `${p.id}: dekkingLicht ontbreekt`);
    // keuze opdrachtgever 2026-10-22: eigen lichte versie (vroeger hooguit 0,2: de nachtscène als grijze waas)
    assert.ok(a.dekkingLicht >= 0.5 && a.dekkingLicht <= 0.8, `${p.id}: dekkingLicht ${a.dekkingLicht}`);
  }
});

// Helderheid (WCAG) van #rrggbb(aa), alpha genegeerd.
const lum = (hex) => {
  const k = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
};
// De kleuren die een deel in het lichte thema tekent: vulLicht/lijnLicht als ze er zijn, anders vul/lijn (verlopen: hun stops).
const lichteKleuren = (d) => [d.vulLicht ?? d.vul, d.lijnLicht ?? d.lijn]
  .flatMap((w) => (w && typeof w === 'object' ? w.stops.map((s) => s.kleur) : [w]))
  .filter((w) => typeof w === 'string' && w.startsWith('#'));

test('elke achtergrond heeft een eigen lichte versie: een lichte lucht en geen donkere silhouetten in het lichte thema', () => {
  for (const p of VOORGELADEN) {
    const delen = p.vormen[p.achtergrond.vorm].delen;
    const lucht = delen[0];
    assert.equal(lucht.vulLicht?.verloop, 'lineair', `${p.id}: de lichte lucht is een verloop`);
    for (const s of lucht.vulLicht.stops) assert.ok(lum(s.kleur) >= 0.55, `${p.id}: lichte luchtkleur ${s.kleur} is te donker`);
    // Elk deel dat goed zichtbaar is (dekking boven 0,5): in het lichte thema minstens een middentoon. Kleine, doorschijnende accenten
    // (de zwarte vlaggetjes van de driekleur aan 0,45) tellen niet mee.
    for (const d of alleDelen(delen)) {
      if ((d.dekking ?? 1) <= 0.5) continue;
      for (const k of lichteKleuren(d)) assert.ok(lum(k) >= 0.15, `${p.id}: ${d.soort} tekent ${k} in het lichte thema (te donker)`);
    }
  }
});

test('elke achtergrond is een scène van 1600 x 900 met een staand kijkvenster binnen de scène, en blijft onder 25 kB', () => {
  for (const p of VOORGELADEN) {
    const vorm = p.vormen[p.achtergrond.vorm];
    assert.equal(vorm.viewBox, '0 0 1600 900', p.id);
    const [x, y, b, h] = vierGetallen(p.achtergrond.kijkvensterStaand);
    assert.ok(x >= 0 && y >= 0 && x + b <= 1600 && y + h <= 900 && b < h, `${p.id}: kijkvenster ${p.achtergrond.kijkvensterStaand}`);
    assert.ok(JSON.stringify(vorm).length <= 25600, `${p.id}: achtergrond is ${JSON.stringify(vorm).length} bytes`);
  }
});

test('de zeven nieuwe achtergronden hebben de afgesproken naam, een dekking van 0,5 tot 0,8, een donkere en een lichte lucht', () => {
  for (const [id, naam] of Object.entries(NIEUWE_ACHTERGRONDEN)) {
    const p = pakket(id);
    assert.equal(p.achtergrond.vorm, naam, id);
    // keuze opdrachtgever 2026-10-22: eigen lichte versie (vroeger 0,12 tot 0,18 en een effen lichte luchtkleur)
    assert.ok(p.achtergrond.dekkingLicht >= 0.5 && p.achtergrond.dekkingLicht <= 0.8, `${id}: ${p.achtergrond.dekkingLicht}`);
    // De lucht is het eerste deel: een rechthoek over de hele scène met een lineair verloop van gedempte, donkere kleuren
    // (luminantie hooguit 0,05, dus contrast met zwart hooguit 2:1), en een eigen licht verloop voor het lichte thema.
    const lucht = p.vormen[naam].delen[0];
    assert.deepEqual([lucht.soort, lucht.x, lucht.y, lucht.width, lucht.height], ['rect', 0, 0, 1600, 900], `${id}: lucht`);
    assert.equal(lucht.vul.verloop, 'lineair', id);
    for (const s of lucht.vul.stops) assert.ok(contrastVerhouding(s.kleur, '#000000') <= 2, `${id}: luchtkleur ${s.kleur} is te fel`);
    assert.equal(lucht.vulLicht.verloop, 'lineair', `${id}: lichte lucht`);
    for (const s of lucht.vulLicht.stops) assert.match(s.kleur, /^#[0-9a-f]{6}$/, `${id}: lichte luchtkleur`);
  }
});

// Vaste herstelling taak 9c (schermafdrukken 2026-10-22): de slingers bovenaan zijn een gespiegeld paar (de rechtse was niet
// gespiegeld) en blijven binnen hun vak.
test('Carnaval en Nationale feestdag: de slinger bovenaan wordt naar beide hoeken gespiegeld en past in zijn vak', () => {
  for (const [id, beeld] of [['carnaval', 'slinger'], ['nationale-feestdag', 'driekleurslinger']]) {
    const p = pakket(id);
    assert.deepEqual(p.versiering.find((e) => e.beweging === 'hoek'), { beweging: 'hoek', beeld, hoeken: ['lb', 'rb'], richting: 'naarHoek' });
    const [x, y, b, h] = vierGetallen(p.vormen[beeld].viewBox);
    for (const d of p.vormen[beeld].delen) {
      const getallen = d.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const xs = getallen.filter((_, i) => i % 2 === 0);
      const ys = getallen.filter((_, i) => i % 2 === 1);
      assert.ok(Math.min(...xs) >= x && Math.max(...xs) <= x + b, `${id}: ${d.d} valt horizontaal buiten het vak`);
      assert.ok(Math.min(...ys) >= y && Math.max(...ys) <= y + h, `${id}: ${d.d} valt verticaal buiten het vak`);
    }
  }
});

// Vaste herstelling taak 9c: het Atomium zakt (het verdween bovenaan achter de kaarten) en de grond vult de onderkant (geen lege band).
test('Nationale feestdag: de skyline staat lager, het Atomium kleiner en de grond is een smalle strook onderaan', () => {
  const delen = pakket('nationale-feestdag').vormen.brussel.delen;
  const atomium = delen.find((d) => d.soort === 'groep');
  const [, ty, s] = atomium.transform.match(/^translate\(1250 (\d+)\) scale\(([\d.]+)\)$/).map(Number);
  assert.ok(ty - 140 * s >= 580, `de top van het Atomium ligt op ${ty - 140 * s}`);
  const grond = delen.at(-1);
  assert.match(grond.d, /^M0 (\d+)H1600V900H0Z$/);
  assert.ok(Number(grond.d.match(/^M0 (\d+)/)[1]) >= 850, 'de grond begint laag');
});

test('Sinterklaas: de mijter staat rechtsonder (ro), kleiner en tegen de hoek, los van de spelskin', () => {
  const p = pakket('sinterklaas');
  const hoek = p.versiering.find((e) => e.beweging === 'hoek');
  assert.deepEqual(hoek, { beweging: 'hoek', beeld: 'mijter', hoeken: ['ro'] });
  assert.notEqual(p.spelskin.extra, 'mijter');
  // De tekening zelf (staf en mijter) reikt tot x = 76 en y = 76; een groter, vierkant kijkvenster met lege marge links en boven
  // maakt ze kleiner in het vaste hoekvak (de mijter vult zo ongeveer 55 tot 60 % van het vak) en duwt ze naar rechtsonder.
  // Taak 9c (schermafdrukken 2026-10-22: de linten lagen tegen de schermrand en leken afgesneden): rechts en onder minstens 8
  // eenheden marge (ongeveer 6 px), zodat de hele mijter met linten in het vak staat.
  const [x, y, b, h] = vierGetallen(p.vormen.mijter.viewBox);
  assert.equal(b, h, 'vierkant kijkvenster');
  assert.ok(73 / b >= 0.5 && 73 / b <= 0.62, `de mijter vult ${(73 / b * 100).toFixed(0)} % van het vak`);
  assert.ok(x + b >= 84 && x + b <= 92, `rechterrand ${x + b}`);
  assert.ok(y + h >= 84 && y + h <= 92, `onderrand ${y + h}`);
});
