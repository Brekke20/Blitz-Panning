// kern/themapakket-validatie.js — de poort voor themapakketten (puur: geen DOM, geen window, geen opslag).
// De server gebruikt ze om een upload te aanvaarden of te weigeren; de client valideert een pakket uit de cache opnieuw.
// Een pakket bevat enkel gegevens met een vaste lijst sleutels (spec §3): elke onbekende sleutel, op elk niveau, wordt geweigerd.
// Bij `ok: true` komt een DIEPE KOPIE terug met enkel de toegelaten sleutels; de invoer wordt nooit gewijzigd.
//
// Stijl van een tekendeel (voor de renderer):
//  - `vul`/`lijn`: kleur, 'geen' of (enkel `vul`) een verloop. `vulLicht`/`lijnLicht`: dezelfde regel maar zonder verloop; in het LICHTE
//    thema gebruikt de renderer `vulLicht`/`lijnLicht` als ze er zijn, anders `vul`/`lijn` (in het donkere thema altijd `vul`/`lijn`);
//  - `lijnEinde` ('rond' | 'recht' | 'vierkant') = stroke-linecap round | butt | square; `lijnHoek` ('rond' | 'scherp' | 'schuin')
//    = stroke-linejoin round | miter | bevel; zonder waarde geldt de standaard van SVG/canvas (recht en scherp);
//  - `rect` mag `rx`/`ry` hebben (afgeronde hoeken, 0 tot 100000); zonder `ry` geldt `rx` ook voor de hoogte, zoals in SVG.
//
// Veiligheidsregels in deze module:
//  - nooit `in` of overgeërfde eigenschappen lezen: enkel eigen sleutels (`Object.hasOwn`), zodat `__proto__` en `constructor`
//    nooit iets doen; namen van vormen/beelden volgen een strikt patroon (dus ook geen `__proto__` als sleutel);
//  - elke regex is verankerd en krijgt pas een tekst te zien na een lengtecontrole;
//  - de grootte wordt eerst gecontroleerd, dan pas de structuur; lijsten worden begrensd vóór ze doorlopen worden;
//  - van een rasterbeeld wordt enkel het begin gedecodeerd (magic bytes), nooit het hele beeld.
import { HEMEL, RAND_KLEUR, BASIS_SKIN_IDS } from '../spel/skin-kleuren.js';

export const MAX_PAKKET_BYTES = 524288; // 512 kB (JSON-tekst)
export const MAX_BEELD_BYTES = 204800; // 200 kB per rasterbeeld
export const MAX_ELEMENTEN = 8; // elementen in `versiering`
export const MAX_BEWEGEND = 16; // alle bewegende elementen samen
export const PLAFONDS = Object.freeze({ hoek: 4, hangen: 3, kruipen: 1, vliegen: 2, vallen: 12, opstijgen: 8, vuurwerk: 1, mist: 1 });
export const BEWEGINGEN = Object.keys(PLAFONDS);
export const DEEL_SOORTEN = ['path', 'circle', 'ellipse', 'rect', 'polygon', 'line', 'groep'];

const MAX_HANGEN_EN_KRUIPEN = 3;
const MAX_DELEN_VORM = 400;
const MAX_DELEN_PAKKET = 3000;
const MAX_VORMEN = 40;
const MAX_BEELDEN = 20;
const MAX_STOPS = 8;
const MAX_PAD = 20000;
const MAX_GETAL = 100000;
const MIN_CONTRAST = 3;

const KLEUR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const KLEUR_ZONDER_ALPHA = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9-]{2,30}$/;
const NAAMRUIMTE = /^[a-z][a-z0-9-]{0,29}$/;
// Namen van vormen en beelden zijn sleutels van een kaart: nooit een naam die ook op Object.prototype zit (`constructor`, ...).
const VERBODEN_NAMEN = new Set(['__proto__', 'constructor', 'prototype']);
const isNaam = (naam) => NAAMRUIMTE.test(naam) && !VERBODEN_NAMEN.has(naam) && !Object.hasOwn(Object.prototype, naam);
// Het pakket-id is ook het skin-id van Blitz Run: de ingebouwde skins (basis en goud) zijn gereserveerd.
// De skins `halloween` en `kerst` (voorheen event-skins) zijn zelf pakketten en blijven dus toegelaten.
// De lijst komt uit skin-kleuren.js (puur); skins.js zelf wordt bij de opstart niet geladen.
const GERESERVEERDE_IDS = new Set(BASIS_SKIN_IDS);
const GETAL_TOKEN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const AANTAL_ARGUMENTEN = { translate: [1, 2], rotate: [1, 3], scale: [1, 2] }; // toegelaten aantallen argumenten
const PAD = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]{1,20000}$/;
const PUNTEN = /^[-0-9.,\s]{1,2000}$/;
const TRANSFORM = /^(?:(?:translate|rotate|scale)\([-0-9.eE\s,]+\)\s*)+$/;
const GETAL_IN_TEKST = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const BEELD = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const STUURTEKEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const DAGEN_IN_MAAND = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 29 februari bestaat niet elk jaar

const STIJL = ['vul', 'vulLicht', 'lijn', 'lijnLicht', 'lijnDikte', 'lijnEinde', 'lijnHoek', 'dekking', 'transform'];
const GEOMETRIE = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  rect: ['x', 'y', 'width', 'height'],
  polygon: ['points'],
  line: ['x1', 'y1', 'x2', 'y2'],
};
const OPTIONELE_GEOMETRIE = { rect: ['rx', 'ry'] }; // afgeronde hoeken (niet verplicht)
const LIJN_EINDE = ['rond', 'recht', 'vierkant']; // = stroke-linecap round | butt | square
const LIJN_HOEK = ['rond', 'scherp', 'schuin']; // = stroke-linejoin round | miter | bevel
const NIET_NEGATIEF = new Set(['r', 'rx', 'ry', 'width', 'height']);
const HOEKEN = ['lb', 'rb', 'lo', 'ro'];
// Richting van een hoekbeeld: 'rechtop' (standaard) = in elke hoek zoals getekend; 'naarHoek' = gespiegeld zodat de oorsprong (0,0)
// van de tekening in elke hoek in die hoek ligt (zoals de webben van Halloween v2.2.0).
const RICHTINGEN = ['rechtop', 'naarHoek'];
const KLEUR_SLEUTELS = ['accent', 'accentHover', 'accentDim', 'accentGlow', 'opAccent'];
const MET_BEELD = ['hoek', 'hangen', 'kruipen', 'vliegen', 'vallen', 'opstijgen'];
const TOP_SLEUTELS = ['formaat', 'id', 'naam', 'versie', 'periode', 'kleuren', 'vormen', 'beelden', 'achtergrond', 'versiering', 'teksten', 'spelskin'];

// ---- Hulpen ----

const isObject = (x) => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};
const eigen = (obj, sleutel) => (Object.hasOwn(obj, sleutel) ? obj[sleutel] : undefined);
const kort = (tekst) => (String(tekst).length > 40 ? `${String(tekst).slice(0, 40)}…` : String(tekst));
const isGetal = (x, min = -MAX_GETAL, max = MAX_GETAL) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const isGeheel = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
const veldPad = (basis, sleutel) => (basis ? `${basis}.${sleutel}` : sleutel);

// Contrastverhouding (WCAG) tussen twee kleuren in #rrggbb of #rrggbbaa (alpha telt niet mee).
function helderheid(hex) {
  const kanalen = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * kanalen[0] + 0.7152 * kanalen[1] + 0.0722 * kanalen[2];
}
export function contrastVerhouding(kleurA, kleurB) {
  const [licht, donker] = [helderheid(kleurA), helderheid(kleurB)].sort((a, b) => b - a);
  return (licht + 0.05) / (donker + 0.05);
}

// Verzamelt de fouten; elke controle geeft de opgeschoonde waarde terug of `undefined` (en meldt dan een fout).
function maakContext() {
  return {
    fouten: [],
    fout(veld, tekst) { this.fouten.push({ veld, fout: tekst }); },
    delenPakket: 0,
    delenVorm: 0,
    deelFoutGemeld: false,
  };
}

// Controleert dat `obj` een gewoon object is met enkel de toegelaten sleutels. Geeft false (en meldt) als het geen object is.
function controleerObject(ctx, obj, veld, toegestaan, naam = 'object') {
  if (!isObject(obj)) { ctx.fout(veld, `Moet een ${naam} zijn.`); return false; }
  for (const sleutel of Object.keys(obj)) {
    if (!toegestaan.includes(sleutel)) ctx.fout(veldPad(veld, sleutel), `Onbekende sleutel '${kort(sleutel)}'.`);
  }
  return true;
}

function eisVerplicht(ctx, obj, veld, sleutels) {
  for (const sleutel of sleutels) {
    if (!Object.hasOwn(obj, sleutel)) ctx.fout(veldPad(veld, sleutel), 'Ontbreekt (verplicht).');
  }
}

function tekstVeld(ctx, waarde, veld, min, max, naam) {
  if (typeof waarde !== 'string') { ctx.fout(veld, `${naam} moet tekst zijn.`); return undefined; }
  if (waarde.length < min || waarde.length > max) {
    ctx.fout(veld, min > 0 ? `${naam} moet tussen ${min} en ${max} tekens lang zijn.` : `${naam} mag maximaal ${max} tekens bevatten.`);
    return undefined;
  }
  if (STUURTEKEN.test(waarde)) { ctx.fout(veld, `${naam} mag geen stuurtekens bevatten.`); return undefined; }
  return waarde;
}

function kleurVeld(ctx, waarde, veld, metAlpha = true) {
  if (typeof waarde === 'string' && (metAlpha ? KLEUR : KLEUR_ZONDER_ALPHA).test(waarde)) return waarde;
  ctx.fout(veld, metAlpha ? 'Ongeldige kleur (enkel #rrggbb of #rrggbbaa).' : 'Ongeldige kleur (enkel #rrggbb).');
  return undefined;
}

function getalVeld(ctx, waarde, veld, min = -MAX_GETAL, max = MAX_GETAL) {
  if (isGetal(waarde, min, max)) return waarde;
  ctx.fout(veld, `Moet een getal zijn tussen ${min} en ${max}.`);
  return undefined;
}

function kijkvenster(ctx, waarde, veld) {
  if (typeof waarde === 'string' && waarde.length <= 100 && /^\s*\S+(?:\s+\S+){3}\s*$/.test(waarde)) {
    const delen = waarde.trim().split(/\s+/).map(Number);
    if (delen.every((n) => isGetal(n)) && delen[2] > 0 && delen[3] > 0) return delen.join(' ');
  }
  ctx.fout(veld, "Ongeldig kijkvenster (vier getallen, bv. '0 0 24 24', met een positieve breedte en hoogte).");
  return undefined;
}

// ---- Onderdelen ----

function controleerPeriode(ctx, periode, veld) {
  if (!isObject(periode)) { ctx.fout(veld, 'Moet een periode zijn (vast of beweeglijk).'); return undefined; }
  if (Object.hasOwn(periode, 'basis')) {
    if (!controleerObject(ctx, periode, veld, ['basis', 'van', 'tot'])) return undefined;
    eisVerplicht(ctx, periode, veld, ['van', 'tot']);
    if (periode.basis !== 'pasen') ctx.fout(veldPad(veld, 'basis'), "Onbekende basis (enkel 'pasen').");
    const van = eigen(periode, 'van');
    const tot = eigen(periode, 'tot');
    const vanOk = Object.hasOwn(periode, 'van') && isGeheel(van, -60, 60);
    const totOk = Object.hasOwn(periode, 'tot') && isGeheel(tot, -60, 60);
    if (Object.hasOwn(periode, 'van') && !vanOk) ctx.fout(veldPad(veld, 'van'), 'Moet een geheel getal zijn tussen -60 en 60 (dagen ten opzichte van Pasen).');
    if (Object.hasOwn(periode, 'tot') && !totOk) ctx.fout(veldPad(veld, 'tot'), 'Moet een geheel getal zijn tussen -60 en 60 (dagen ten opzichte van Pasen).');
    if (vanOk && totOk && van > tot) ctx.fout(veldPad(veld, 'tot'), "'tot' mag niet voor 'van' liggen.");
    return vanOk && totOk && van <= tot && periode.basis === 'pasen' ? { basis: 'pasen', van, tot } : undefined;
  }
  if (!controleerObject(ctx, periode, veld, ['van', 'tot'])) return undefined;
  eisVerplicht(ctx, periode, veld, ['van', 'tot']);
  const uit = {};
  for (const kant of ['van', 'tot']) {
    if (!Object.hasOwn(periode, kant)) continue;
    const dagVeld = veldPad(veld, kant);
    const d = periode[kant];
    if (!controleerObject(ctx, d, dagVeld, ['maand', 'dag'])) continue;
    eisVerplicht(ctx, d, dagVeld, ['maand', 'dag']);
    const maandOk = isGeheel(eigen(d, 'maand'), 1, 12);
    if (Object.hasOwn(d, 'maand') && !maandOk) ctx.fout(veldPad(dagVeld, 'maand'), 'Moet een geheel getal zijn van 1 tot 12.');
    if (!Object.hasOwn(d, 'dag')) continue;
    const maxDag = maandOk ? DAGEN_IN_MAAND[d.maand - 1] : 31;
    if (!isGeheel(d.dag, 1, maxDag)) {
      ctx.fout(veldPad(dagVeld, 'dag'), maandOk && d.dag === 29 && d.maand === 2
        ? '29 februari bestaat niet elk jaar.'
        : `Ongeldige dag (1 tot ${maxDag}${maandOk ? ' voor deze maand' : ''}).`);
    } else if (maandOk) {
      uit[kant] = { maand: d.maand, dag: d.dag };
    }
  }
  return uit.van && uit.tot ? uit : undefined;
}

// Valideert een losse periode (bv. de override van de beheerder) met dezelfde regels als `periode` in een pakket.
// Geeft { ok: true, periode } (schone kopie) of { ok: false, fouten: [{ veld, fout }] }; `veld` is 'periode' of 'periode.van...'.
export function valideerPeriode(periode) {
  const ctx = maakContext();
  const uit = controleerPeriode(ctx, periode, 'periode');
  return ctx.fouten.length === 0 && uit ? { ok: true, periode: uit } : { ok: false, fouten: ctx.fouten.length ? ctx.fouten : [{ veld: 'periode', fout: 'Moet een periode zijn (vast of beweeglijk).' }] };
}

function valideerKleurenSet(ctx, set, veld) {
  if (!controleerObject(ctx, set, veld, KLEUR_SLEUTELS)) return undefined;
  eisVerplicht(ctx, set, veld, ['accent']);
  const uit = {};
  for (const sleutel of KLEUR_SLEUTELS) {
    if (!Object.hasOwn(set, sleutel)) continue;
    const k = kleurVeld(ctx, set[sleutel], veldPad(veld, sleutel));
    if (k !== undefined) uit[sleutel] = k;
  }
  return uit;
}

function valideerKleuren(ctx, kleuren, veld) {
  if (!controleerObject(ctx, kleuren, veld, ['donker', 'licht', 'voorkeurThema'])) return undefined;
  const uit = {};
  for (const modus of ['donker', 'licht']) {
    if (Object.hasOwn(kleuren, modus)) uit[modus] = valideerKleurenSet(ctx, kleuren[modus], veldPad(veld, modus));
  }
  if (Object.hasOwn(kleuren, 'voorkeurThema')) {
    const v = kleuren.voorkeurThema;
    if (v === 'donker' || v === 'licht' || v === null) uit.voorkeurThema = v;
    else ctx.fout(veldPad(veld, 'voorkeurThema'), "Moet 'donker', 'licht' of null zijn.");
  }
  return uit;
}

function valideerVerloop(ctx, vul, veld) {
  const soort = eigen(vul, 'verloop');
  const sleutels = soort === 'radiaal' ? ['cx', 'cy', 'r'] : ['x1', 'y1', 'x2', 'y2'];
  if (!controleerObject(ctx, vul, veld, ['verloop', 'stops', ...sleutels])) return undefined;
  if (soort !== 'lineair' && soort !== 'radiaal') ctx.fout(veldPad(veld, 'verloop'), "Onbekend verloop (enkel 'lineair' of 'radiaal').");
  const uit = { verloop: soort };
  for (const sleutel of sleutels) {
    if (Object.hasOwn(vul, sleutel)) {
      const g = getalVeld(ctx, vul[sleutel], veldPad(veld, sleutel));
      if (g !== undefined) uit[sleutel] = g;
    }
  }
  const stopsVeld = veldPad(veld, 'stops');
  const stops = eigen(vul, 'stops');
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > MAX_STOPS) {
    ctx.fout(stopsVeld, `Een verloop heeft 1 tot ${MAX_STOPS} stops.`);
    return undefined;
  }
  uit.stops = [];
  stops.forEach((stop, i) => {
    const sv = `${stopsVeld}[${i}]`;
    if (!controleerObject(ctx, stop, sv, ['op', 'kleur'])) return;
    eisVerplicht(ctx, stop, sv, ['op', 'kleur']);
    const op = Object.hasOwn(stop, 'op') ? getalVeld(ctx, stop.op, `${sv}.op`, 0, 1) : undefined;
    const kleur = Object.hasOwn(stop, 'kleur') ? kleurVeld(ctx, stop.kleur, `${sv}.kleur`) : undefined;
    if (op !== undefined && kleur !== undefined) uit.stops.push({ op, kleur });
  });
  return uit;
}

function valideerVulling(ctx, vul, veld, metGeen = true) {
  if (vul === 'geen' && metGeen) return vul;
  if (isObject(vul)) return valideerVerloop(ctx, vul, veld);
  return kleurVeld(ctx, vul, veld);
}

function valideerPad(ctx, d, veld) {
  const FOUT = "Ongeldige tekening (enkel padcommando's en getallen).";
  if (typeof d !== 'string' || d.length < 1 || d.length > MAX_PAD || !PAD.test(d)) { ctx.fout(veld, FOUT); return undefined; }
  for (const m of d.match(GETAL_IN_TEKST) ?? []) {
    if (!isGetal(Number(m))) { ctx.fout(veld, FOUT); return undefined; }
  }
  return d;
}

function valideerPunten(ctx, punten, veld) {
  const FOUT = 'Ongeldige punten (enkel getallen, komma\'s en spaties).';
  if (typeof punten !== 'string' || !PUNTEN.test(punten)) { ctx.fout(veld, FOUT); return undefined; }
  for (const m of punten.match(GETAL_IN_TEKST) ?? []) {
    if (!isGetal(Number(m))) { ctx.fout(veld, FOUT); return undefined; }
  }
  return punten;
}

// Elke transformatie wordt ontleed: echte getallen (eindig, |n| <= 100000) en het juiste aantal argumenten.
function transformOk(t) {
  if (typeof t !== 'string' || t.length < 1 || t.length > 200 || !TRANSFORM.test(t)) return false;
  for (const m of t.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)) {
    // Argumenten worden gescheiden door één komma (met optionele spaties) of door spaties; "1,,2" of ",1" geeft een leeg argument.
    const args = m[2].trim().split(/\s*,\s*|\s+/);
    if (!AANTAL_ARGUMENTEN[m[1]].includes(args.length)) return false;
    if (!args.every((a) => GETAL_TOKEN.test(a) && isGetal(Number(a)))) return false;
  }
  return true;
}

function valideerTransform(ctx, t, veld) {
  if (transformOk(t)) return t;
  ctx.fout(veld, 'Ongeldige transformatie (translate met 1 of 2, rotate met 1 of 3 en scale met 1 of 2 getallen).');
  return undefined;
}

// Telt een deel mee; meldt één keer wanneer de grens van de vorm of het pakket overschreden wordt.
function telDeel(ctx, veldVanLijst) {
  ctx.delenVorm += 1;
  ctx.delenPakket += 1;
  if (ctx.delenVorm > MAX_DELEN_VORM || ctx.delenPakket > MAX_DELEN_PAKKET) {
    if (!ctx.deelFoutGemeld) {
      ctx.deelFoutGemeld = true;
      if (ctx.delenVorm > MAX_DELEN_VORM) ctx.fout(veldVanLijst, `Een vorm mag maximaal ${MAX_DELEN_VORM} delen hebben.`);
      else ctx.fout('vormen', `Het pakket mag maximaal ${MAX_DELEN_PAKKET} delen hebben.`);
    }
    return false;
  }
  return true;
}

function valideerDeel(ctx, deel, veld, niveau, lijstVeld) {
  if (!isObject(deel)) { ctx.fout(veld, 'Moet een deel van een tekening zijn.'); return undefined; }
  const soort = eigen(deel, 'soort');
  if (typeof soort !== 'string' || !DEEL_SOORTEN.includes(soort)) {
    ctx.fout(veldPad(veld, 'soort'), `Onbekende soort (toegelaten: ${DEEL_SOORTEN.join(', ')}).`);
    return undefined;
  }
  if (soort === 'groep') {
    if (niveau >= 1) { ctx.fout(veldPad(veld, 'soort'), 'Een groep mag geen groep bevatten (één niveau diep).'); return undefined; }
    controleerObject(ctx, deel, veld, ['soort', 'delen', 'transform']);
    const uit = { soort };
    if (Object.hasOwn(deel, 'transform')) {
      const t = valideerTransform(ctx, deel.transform, veldPad(veld, 'transform'));
      if (t !== undefined) uit.transform = t;
    }
    const kinderen = eigen(deel, 'delen');
    const kv = veldPad(veld, 'delen');
    if (!Array.isArray(kinderen) || kinderen.length < 1 || kinderen.length > MAX_DELEN_VORM) {
      ctx.fout(kv, `Een groep heeft 1 tot ${MAX_DELEN_VORM} delen.`);
      return uit;
    }
    uit.delen = [];
    for (let i = 0; i < kinderen.length; i++) {
      if (!telDeel(ctx, lijstVeld)) break;
      const k = valideerDeel(ctx, kinderen[i], `${kv}[${i}]`, niveau + 1, lijstVeld);
      if (k !== undefined) uit.delen.push(k);
    }
    return uit;
  }
  const geo = GEOMETRIE[soort];
  const optioneel = OPTIONELE_GEOMETRIE[soort] ?? [];
  controleerObject(ctx, deel, veld, ['soort', ...geo, ...optioneel, ...STIJL]);
  eisVerplicht(ctx, deel, veld, geo);
  const uit = { soort };
  for (const sleutel of [...geo, ...optioneel]) {
    if (!Object.hasOwn(deel, sleutel)) continue;
    const v = veldPad(veld, sleutel);
    let waarde;
    if (sleutel === 'd') waarde = valideerPad(ctx, deel.d, v);
    else if (sleutel === 'points') waarde = valideerPunten(ctx, deel.points, v);
    else waarde = getalVeld(ctx, deel[sleutel], v, NIET_NEGATIEF.has(sleutel) ? 0 : -MAX_GETAL, MAX_GETAL);
    if (waarde !== undefined) uit[sleutel] = waarde;
  }
  if (Object.hasOwn(deel, 'vul')) {
    const v = valideerVulling(ctx, deel.vul, veldPad(veld, 'vul'));
    if (v !== undefined) uit.vul = v;
  }
  // Lichte variant: enkel een kleur of 'geen' (nooit een verloop). Zonder `vulLicht`/`lijnLicht` geldt `vul`/`lijn` ook in het lichte thema.
  if (Object.hasOwn(deel, 'vulLicht')) {
    const v = deel.vulLicht === 'geen' ? 'geen' : kleurVeld(ctx, deel.vulLicht, veldPad(veld, 'vulLicht'));
    if (v !== undefined) uit.vulLicht = v;
  }
  if (Object.hasOwn(deel, 'lijn')) {
    const lijn = deel.lijn === 'geen' ? 'geen' : kleurVeld(ctx, deel.lijn, veldPad(veld, 'lijn'));
    if (lijn !== undefined) uit.lijn = lijn;
  }
  if (Object.hasOwn(deel, 'lijnLicht')) {
    const lijn = deel.lijnLicht === 'geen' ? 'geen' : kleurVeld(ctx, deel.lijnLicht, veldPad(veld, 'lijnLicht'));
    if (lijn !== undefined) uit.lijnLicht = lijn;
  }
  for (const [sleutel, toegelaten] of [['lijnEinde', LIJN_EINDE], ['lijnHoek', LIJN_HOEK]]) {
    if (!Object.hasOwn(deel, sleutel)) continue;
    if (typeof deel[sleutel] === 'string' && toegelaten.includes(deel[sleutel])) uit[sleutel] = deel[sleutel];
    else ctx.fout(veldPad(veld, sleutel), `Onbekende waarde (toegelaten: ${toegelaten.join(', ')}).`);
  }
  if (Object.hasOwn(deel, 'lijnDikte')) {
    const g = getalVeld(ctx, deel.lijnDikte, veldPad(veld, 'lijnDikte'), 0, 1000);
    if (g !== undefined) uit.lijnDikte = g;
  }
  if (Object.hasOwn(deel, 'dekking')) {
    const g = getalVeld(ctx, deel.dekking, veldPad(veld, 'dekking'), 0, 1);
    if (g !== undefined) uit.dekking = g;
  }
  if (Object.hasOwn(deel, 'transform')) {
    const t = valideerTransform(ctx, deel.transform, veldPad(veld, 'transform'));
    if (t !== undefined) uit.transform = t;
  }
  return uit;
}

function valideerVorm(ctx, vorm, veld) {
  if (!controleerObject(ctx, vorm, veld, ['viewBox', 'delen'])) return undefined;
  eisVerplicht(ctx, vorm, veld, ['viewBox', 'delen']);
  const uit = {};
  if (Object.hasOwn(vorm, 'viewBox')) {
    const vb = kijkvenster(ctx, vorm.viewBox, veldPad(veld, 'viewBox'));
    if (vb !== undefined) uit.viewBox = vb;
  }
  const lijstVeld = veldPad(veld, 'delen');
  const delen = eigen(vorm, 'delen');
  if (Object.hasOwn(vorm, 'delen')) {
    if (!Array.isArray(delen) || delen.length < 1) { ctx.fout(lijstVeld, 'Een vorm heeft minstens één deel.'); return undefined; }
    if (delen.length > MAX_DELEN_VORM) { ctx.fout(lijstVeld, `Een vorm mag maximaal ${MAX_DELEN_VORM} delen hebben.`); return undefined; }
    ctx.delenVorm = 0;
    uit.delen = [];
    for (let i = 0; i < delen.length; i++) {
      if (!telDeel(ctx, lijstVeld)) break;
      const d = valideerDeel(ctx, delen[i], `${lijstVeld}[${i}]`, 0, lijstVeld);
      if (d !== undefined) uit.delen.push(d);
    }
  }
  return uit;
}

function valideerVormen(ctx, vormen, veld) {
  if (!isObject(vormen)) { ctx.fout(veld, 'Moet een lijst van vormen zijn.'); return {}; }
  const namen = Object.keys(vormen);
  if (namen.length > MAX_VORMEN) { ctx.fout(veld, `Maximaal ${MAX_VORMEN} vormen.`); return {}; }
  const uit = Object.create(null); // zonder prototype: een opzoeking van een onbekende naam geeft nooit iets overgeërfd
  for (const naam of namen) {
    if (!isNaam(naam)) { ctx.fout(veldPad(veld, naam), "Ongeldige naam (enkel kleine letters, cijfers en '-', beginnend met een letter, max 30)."); continue; }
    const vorm = valideerVorm(ctx, vormen[naam], veldPad(veld, naam));
    if (vorm !== undefined) uit[naam] = vorm;
  }
  return uit;
}

// Leest de eerste bytes van een base64-tekst (16 tekens = 12 bytes: genoeg voor PNG, JPEG en WebP).
function kopBytes(base64Begin) {
  if (typeof atob === 'function') {
    const bin = atob(base64Begin);
    return Array.from(bin, (c) => c.charCodeAt(0));
  }
  return Array.from(Buffer.from(base64Begin, 'base64'));
}
const gelijk = (bytes, begin, verwacht) => verwacht.every((b, i) => bytes[begin + i] === b);
const MAGIE = {
  png: (b) => gelijk(b, 0, [0x89, 0x50, 0x4e, 0x47]),
  jpeg: (b) => gelijk(b, 0, [0xff, 0xd8, 0xff]),
  webp: (b) => gelijk(b, 0, [0x52, 0x49, 0x46, 0x46]) && gelijk(b, 8, [0x57, 0x45, 0x42, 0x50]), // RIFF....WEBP
};

function valideerBeeld(ctx, beeld, veld) {
  const FOUT = 'Ongeldig beeld (enkel png, webp of jpeg als base64-gegevens, met een kloppend bestandstype).';
  if (typeof beeld !== 'string') { ctx.fout(veld, FOUT); return undefined; }
  // Een beeld van 200 kB is ruim 273.000 base64-tekens; alles daarboven valt af nog vóór de regex.
  if (beeld.length > Math.ceil(MAX_BEELD_BYTES / 3) * 4 + 64) { ctx.fout(veld, 'Het beeld is groter dan 200 kB.'); return undefined; }
  const m = BEELD.exec(beeld);
  if (!m || m[2].length % 4 !== 0 || m[2].length < 16) { ctx.fout(veld, FOUT); return undefined; }
  const padding = m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0;
  if ((m[2].length / 4) * 3 - padding > MAX_BEELD_BYTES) { ctx.fout(veld, 'Het beeld is groter dan 200 kB.'); return undefined; }
  let kop;
  try { kop = kopBytes(m[2].slice(0, 16)); } catch { ctx.fout(veld, FOUT); return undefined; }
  if (!MAGIE[m[1]](kop)) { ctx.fout(veld, `Het beeld is geen echte ${m[1]} (het bestandstype klopt niet met de inhoud).`); return undefined; }
  return beeld;
}

function valideerBeelden(ctx, beelden, veld, vormNamen) {
  if (!isObject(beelden)) { ctx.fout(veld, 'Moet een lijst van beelden zijn.'); return undefined; }
  const namen = Object.keys(beelden);
  if (namen.length > MAX_BEELDEN) { ctx.fout(veld, `Maximaal ${MAX_BEELDEN} beelden.`); return undefined; }
  const uit = Object.create(null);
  for (const naam of namen) {
    const v = veldPad(veld, naam);
    if (!isNaam(naam)) { ctx.fout(v, "Ongeldige naam (enkel kleine letters, cijfers en '-', beginnend met een letter, max 30)."); continue; }
    if (vormNamen.has(naam)) { ctx.fout(v, 'Deze naam bestaat al bij de vormen; kies een andere naam.'); continue; }
    const b = valideerBeeld(ctx, beelden[naam], v);
    if (b !== undefined) uit[naam] = b;
  }
  return uit;
}

// Eén element van `versiering`. Geeft { uit, beweging, aantal } terug (aantal = bijdrage aan het plafond).
function valideerElement(ctx, el, veld, bekend) {
  if (!isObject(el)) { ctx.fout(veld, 'Moet een versieringselement zijn.'); return undefined; }
  const beweging = eigen(el, 'beweging');
  if (typeof beweging !== 'string' || !BEWEGINGEN.includes(beweging)) {
    ctx.fout(veldPad(veld, 'beweging'), `Onbekende beweging (toegelaten: ${BEWEGINGEN.join(', ')}).`);
    return undefined;
  }
  const opties = {
    hoek: ['hoeken', 'richting'], hangen: ['aantal'], kruipen: ['aantal', 'langs'], vliegen: ['aantal'],
    vallen: ['aantal', 'wiebel'], opstijgen: ['aantal'], vuurwerk: ['frequentie'], mist: [],
  }[beweging];
  const metBeeld = MET_BEELD.includes(beweging);
  controleerObject(ctx, el, veld, ['beweging', ...(metBeeld ? ['beeld'] : []), ...opties]);
  const uit = { beweging };
  if (metBeeld) {
    const bv = veldPad(veld, 'beeld');
    if (!Object.hasOwn(el, 'beeld')) ctx.fout(bv, 'Ontbreekt (verplicht).');
    else if (typeof el.beeld !== 'string' || !bekend.has(el.beeld)) ctx.fout(bv, 'Verwijst naar een vorm of beeld dat niet in het pakket zit.');
    else uit.beeld = el.beeld;
  }
  let aantal = 1;
  if (beweging === 'hoek') {
    const hv = veldPad(veld, 'hoeken');
    const hoeken = eigen(el, 'hoeken');
    if (!Array.isArray(hoeken) || hoeken.length < 1 || hoeken.length > HOEKEN.length) {
      ctx.fout(hv, `Kies 1 tot ${HOEKEN.length} hoeken (${HOEKEN.join(', ')}).`);
      aantal = 0;
    } else {
      uit.hoeken = [];
      hoeken.forEach((h, i) => {
        if (typeof h !== 'string' || !HOEKEN.includes(h)) ctx.fout(`${hv}[${i}]`, `Onbekende hoek (toegelaten: ${HOEKEN.join(', ')}).`);
        else if (uit.hoeken.includes(h)) ctx.fout(hv, 'Elke hoek mag maar één keer voorkomen.');
        else uit.hoeken.push(h);
      });
      aantal = uit.hoeken.length;
    }
    if (Object.hasOwn(el, 'richting')) {
      if (typeof el.richting === 'string' && RICHTINGEN.includes(el.richting)) uit.richting = el.richting;
      else ctx.fout(veldPad(veld, 'richting'), `Onbekende richting (toegelaten: ${RICHTINGEN.join(', ')}).`);
    }
  } else if (opties.includes('aantal')) {
    const av = veldPad(veld, 'aantal');
    if (!Object.hasOwn(el, 'aantal')) { ctx.fout(av, 'Ontbreekt (verplicht).'); aantal = 0; }
    else if (!isGeheel(el.aantal, 1, PLAFONDS[beweging])) { ctx.fout(av, `Moet een geheel getal zijn van 1 tot ${PLAFONDS[beweging]} voor '${beweging}'.`); aantal = 0; }
    else { uit.aantal = el.aantal; aantal = el.aantal; }
  }
  if (beweging === 'kruipen' && Object.hasOwn(el, 'langs')) {
    if (el.langs === 'tabbalk') uit.langs = 'tabbalk';
    else ctx.fout(veldPad(veld, 'langs'), "Onbekende plaats (enkel 'tabbalk').");
  }
  if (beweging === 'vallen' && Object.hasOwn(el, 'wiebel')) {
    const w = getalVeld(ctx, el.wiebel, veldPad(veld, 'wiebel'), 0, 1);
    if (w !== undefined) uit.wiebel = w;
  }
  if (beweging === 'vuurwerk' && Object.hasOwn(el, 'frequentie')) {
    const f = getalVeld(ctx, el.frequentie, veldPad(veld, 'frequentie'), 0, 1);
    if (f !== undefined) uit.frequentie = f;
  }
  return { uit, beweging, aantal };
}

function valideerVersiering(ctx, lijst, veld, bekend) {
  if (!Array.isArray(lijst)) { ctx.fout(veld, 'Moet een lijst van elementen zijn.'); return undefined; }
  if (lijst.length > MAX_ELEMENTEN) { ctx.fout(veld, `Maximaal ${MAX_ELEMENTEN} elementen in de versiering.`); return undefined; }
  const uit = [];
  const som = Object.fromEntries(BEWEGINGEN.map((b) => [b, 0]));
  lijst.forEach((el, i) => {
    const r = valideerElement(ctx, el, `${veld}[${i}]`, bekend);
    if (!r) return;
    uit.push(r.uit);
    som[r.beweging] += r.aantal;
  });
  for (const beweging of BEWEGINGEN) {
    if (som[beweging] > PLAFONDS[beweging]) ctx.fout(veld, `Samen te veel '${beweging}' (maximaal ${PLAFONDS[beweging]}).`);
  }
  if (som.hangen + som.kruipen > MAX_HANGEN_EN_KRUIPEN) ctx.fout(veld, `'hangen' en 'kruipen' samen mogen maximaal ${MAX_HANGEN_EN_KRUIPEN} zijn.`);
  const bewegend = BEWEGINGEN.filter((b) => b !== 'hoek').reduce((s, b) => s + som[b], 0);
  if (bewegend > MAX_BEWEGEND) ctx.fout(veld, `Alle bewegende elementen samen mogen maximaal ${MAX_BEWEGEND} zijn (nu ${bewegend}).`);
  return uit;
}

function valideerAchtergrond(ctx, a, veld, bekend) {
  if (!controleerObject(ctx, a, veld, ['vorm', 'kijkvensterStaand', 'dekkingLicht'])) return undefined;
  const uit = {};
  if (!Object.hasOwn(a, 'vorm')) ctx.fout(veldPad(veld, 'vorm'), 'Ontbreekt (verplicht).');
  else if (typeof a.vorm !== 'string' || !bekend.has(a.vorm)) ctx.fout(veldPad(veld, 'vorm'), 'Verwijst naar een vorm of beeld dat niet in het pakket zit.');
  else uit.vorm = a.vorm;
  if (Object.hasOwn(a, 'kijkvensterStaand')) {
    const k = kijkvenster(ctx, a.kijkvensterStaand, veldPad(veld, 'kijkvensterStaand'));
    if (k !== undefined) uit.kijkvensterStaand = k;
  }
  if (Object.hasOwn(a, 'dekkingLicht')) {
    const d = getalVeld(ctx, a.dekkingLicht, veldPad(veld, 'dekkingLicht'), 0, 1);
    if (d !== undefined) uit.dekkingLicht = d;
  }
  return uit;
}

function valideerTeksten(ctx, t, veld) {
  if (!controleerObject(ctx, t, veld, ['wachtrijLeeg', 'ingeplandLeeg'])) return undefined;
  const uit = {};
  for (const sleutel of ['wachtrijLeeg', 'ingeplandLeeg']) {
    if (!Object.hasOwn(t, sleutel)) continue;
    const s = tekstVeld(ctx, t[sleutel], veldPad(veld, sleutel), 1, 80, 'Deze tekst');
    if (s !== undefined) uit[sleutel] = s;
  }
  return uit;
}

function valideerSpelskin(ctx, s, veld, vormNamen) {
  if (!controleerObject(ctx, s, veld, ['naam', 'behuizing', 'faceplate', 'bliksem', 'rand', 'extra'])) return undefined;
  eisVerplicht(ctx, s, veld, ['naam', 'behuizing', 'faceplate', 'bliksem']);
  const uit = {};
  if (Object.hasOwn(s, 'naam')) {
    const n = tekstVeld(ctx, s.naam, veldPad(veld, 'naam'), 1, 40, 'De naam');
    if (n !== undefined) uit.naam = n;
  }
  for (const sleutel of ['behuizing', 'faceplate', 'bliksem', 'rand']) {
    if (!Object.hasOwn(s, sleutel)) continue;
    const k = kleurVeld(ctx, s[sleutel], veldPad(veld, sleutel), false);
    if (k !== undefined) uit[sleutel] = k;
  }
  // De paal moet tegen de nachthemel afsteken: de rand (of de standaardrand) heeft minstens 3:1 met beide kanten van de hemel.
  if (uit.rand !== undefined) {
    const slechtste = Math.min(contrastVerhouding(uit.rand, HEMEL.boven), contrastVerhouding(uit.rand, HEMEL.onder));
    if (slechtste < MIN_CONTRAST) ctx.fout(veldPad(veld, 'rand'), `De randkleur steekt te weinig af tegen de nachthemel van het spel (contrast ${slechtste.toFixed(1)}:1, minstens ${MIN_CONTRAST}:1).`);
  } else if (contrastVerhouding(RAND_KLEUR, HEMEL.boven) < MIN_CONTRAST || contrastVerhouding(RAND_KLEUR, HEMEL.onder) < MIN_CONTRAST) {
    ctx.fout(veldPad(veld, 'rand'), 'De standaardrand steekt te weinig af; geef een eigen randkleur.');
  }
  if (Object.hasOwn(s, 'extra')) {
    if (typeof s.extra === 'string' && vormNamen.has(s.extra)) uit.extra = s.extra;
    else ctx.fout(veldPad(veld, 'extra'), 'Verwijst naar een vorm die niet in het pakket zit.');
  }
  return uit;
}

function jsonBytes(pakket) {
  return new TextEncoder().encode(JSON.stringify(pakket)).length;
}

// Valideert een themapakket. `tekstLengte` is de grootte in bytes van de ontvangen JSON-tekst (als de aanroeper ze kent);
// anders rekent de validator zelf. Geeft { ok: true, pakket } (diepe kopie) of { ok: false, fouten: [{ veld, fout }] }.
export function valideerPakket(pakket, opties) {
  const { tekstLengte } = isObject(opties) ? opties : {};
  const ctx = maakContext();
  if (!isObject(pakket)) {
    ctx.fout('pakket', 'Een themapakket moet een JSON-object zijn.');
    return { ok: false, fouten: ctx.fouten };
  }
  let bytes = tekstLengte;
  if (!Number.isInteger(bytes) || bytes < 0) { // enkel een niet-negatief geheel getal wordt vertrouwd; anders zelf tellen
    try { bytes = jsonBytes(pakket); } catch { ctx.fout('pakket', 'Het pakket is geen geldige JSON.'); return { ok: false, fouten: ctx.fouten }; }
  }
  if (bytes > MAX_PAKKET_BYTES) {
    ctx.fout('pakket', 'Het pakket is groter dan 512 kB.');
    return { ok: false, fouten: ctx.fouten };
  }

  controleerObject(ctx, pakket, '', TOP_SLEUTELS);
  eisVerplicht(ctx, pakket, '', ['formaat', 'id', 'naam', 'versie', 'periode', 'kleuren', 'vormen', 'versiering', 'spelskin']);
  const uit = {};

  if (Object.hasOwn(pakket, 'formaat')) {
    if (pakket.formaat === 1) uit.formaat = 1;
    else ctx.fout('formaat', 'Onbekend formaat (enkel formaat 1).');
  }
  if (Object.hasOwn(pakket, 'id')) {
    if (typeof pakket.id === 'string' && GERESERVEERDE_IDS.has(pakket.id)) ctx.fout('id', 'Deze id is gereserveerd voor een ingebouwde skin van Blitz Run; kies een andere id.');
    else if (typeof pakket.id === 'string' && ID.test(pakket.id)) uit.id = pakket.id;
    else ctx.fout('id', "Ongeldige id (enkel kleine letters, cijfers en '-', 2 tot 30 tekens).");
  }
  if (Object.hasOwn(pakket, 'naam')) uit.naam = tekstVeld(ctx, pakket.naam, 'naam', 1, 40, 'De naam');
  if (Object.hasOwn(pakket, 'versie')) uit.versie = tekstVeld(ctx, pakket.versie, 'versie', 1, 20, 'De versie');
  if (Object.hasOwn(pakket, 'periode')) uit.periode = controleerPeriode(ctx, pakket.periode, 'periode');
  if (Object.hasOwn(pakket, 'kleuren')) uit.kleuren = valideerKleuren(ctx, pakket.kleuren, 'kleuren');

  // Eerst de vormen, dan de beelden (de naamruimte is gedeeld), dan al wat ernaar verwijst.
  const vormNamen = new Set();
  let vormen;
  if (Object.hasOwn(pakket, 'vormen')) {
    vormen = valideerVormen(ctx, pakket.vormen, 'vormen');
    if (isObject(pakket.vormen)) for (const n of Object.keys(pakket.vormen)) if (isNaam(n)) vormNamen.add(n);
    uit.vormen = vormen;
  }
  const beeldNamen = new Set();
  if (Object.hasOwn(pakket, 'beelden')) {
    uit.beelden = valideerBeelden(ctx, pakket.beelden, 'beelden', vormNamen);
    if (isObject(pakket.beelden)) for (const n of Object.keys(pakket.beelden)) if (isNaam(n)) beeldNamen.add(n);
  }
  const bekend = new Set([...vormNamen, ...beeldNamen]);

  if (Object.hasOwn(pakket, 'achtergrond')) uit.achtergrond = valideerAchtergrond(ctx, pakket.achtergrond, 'achtergrond', bekend);
  if (Object.hasOwn(pakket, 'versiering')) uit.versiering = valideerVersiering(ctx, pakket.versiering, 'versiering', bekend);
  if (Object.hasOwn(pakket, 'teksten')) uit.teksten = valideerTeksten(ctx, pakket.teksten, 'teksten');
  if (Object.hasOwn(pakket, 'spelskin')) uit.spelskin = valideerSpelskin(ctx, pakket.spelskin, 'spelskin', vormNamen);

  if (ctx.fouten.length > 0) return { ok: false, fouten: ctx.fouten };
  // Sleutelvolgorde zoals in de spec; ontbrekende optionele delen blijven weg.
  const resultaat = {};
  for (const sleutel of TOP_SLEUTELS) if (uit[sleutel] !== undefined) resultaat[sleutel] = uit[sleutel];
  return { ok: true, pakket: resultaat };
}
