// schermen/vorm-svg.js — een vorm uit een themapakket (gegevens, zie kern/themapakket-validatie.js) wordt een SVG-element.
// Veilig door de manier van bouwen (ADR 0001): enkel `createElementNS` in de SVG-naamruimte, enkel de vaste soorten (path, circle,
// ellipse, rect, polygon, line, g) en per soort een vaste lijst attributen. Nooit innerHTML, href, style-attribuut, on*, <script>,
// <foreignObject> of <use>. Elke waarde wordt hier nog eens gecontroleerd (getal, kleur, pad-tekens), ook al heeft de validator dat
// al gedaan: een fout in de cache of een voorbeeldpakket kan zo nooit iets anders dan een tekening opleveren.
// Lichte varianten (`vulLicht`/`lijnLicht`): een vaste klasse (`ev-vl`/`ev-ll`) en een CSS-variabele (`--ev-vl`/`--ev-ll`) met de
// kleur op het deel; css/evenement.css gebruikt ze in het lichte thema. Zo wisselt een tekening mee zonder opnieuw te bouwen.
// Een licht verloop (`vulLicht` als verloop) wordt een tweede <linearGradient>/<radialGradient> met een eigen id; de variabele is dan
// `url(#ev-verloop-<n>)` (een id die deze module zelf maakt, nooit een waarde uit het pakket).
// Raakt `document` enkel binnen `vormNaarSvg` (te vervangen via de optie `document`, voor de unit-test).
const SVG_NS = 'http://www.w3.org/2000/svg';

const KLEUR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const PAD = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]{1,20000}$/;
const PUNTEN = /^[-0-9.,\s]{1,2000}$/;
const TRANSFORM = /^(?:(?:translate|rotate|scale)\([-0-9.eE\s,]+\)\s*){1,10}$/;
const KIJKVENSTER = /^-?[0-9.eE+-]+(?:\s+-?[0-9.eE+-]+){3}$/;

const GEOMETRIE = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  polygon: ['points'],
  line: ['x1', 'y1', 'x2', 'y2'],
  groep: [],
};
const ELEMENT = { path: 'path', circle: 'circle', ellipse: 'ellipse', rect: 'rect', polygon: 'polygon', line: 'line', groep: 'g' };
const LIJN_EINDE = { rond: 'round', recht: 'butt', vierkant: 'square' };
const LIJN_HOEK = { rond: 'round', scherp: 'miter', schuin: 'bevel' };

const eigen = (obj, sleutel) => (obj !== null && typeof obj === 'object' && Object.hasOwn(obj, sleutel) ? obj[sleutel] : undefined);
const isGetal = (x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 100000;
// 'geen' -> 'none', een kleur blijft; al de rest (ook een verloop) -> null.
const kleurWaarde = (w) => (w === 'geen' ? 'none' : typeof w === 'string' && KLEUR.test(w) ? w : null);
const geometrieWaarde = (sleutel, w) => {
  if (sleutel === 'd') return typeof w === 'string' && PAD.test(w) ? w : null;
  if (sleutel === 'points') return typeof w === 'string' && PUNTEN.test(w) ? w : null;
  return isGetal(w) ? String(w) : null;
};

// De attributen van één deel als [naam, waarde], puur en uit een vaste lijst. Een verloop in `vul` staat er niet in (vormNaarSvg
// maakt er een <linearGradient>/<radialGradient> met een eigen id van). Een onbekende soort geeft een lege lijst.
export function svgAttributen(deel) {
  const soort = eigen(deel, 'soort');
  if (typeof soort !== 'string' || !Object.hasOwn(GEOMETRIE, soort)) return [];
  const uit = [];
  for (const sleutel of GEOMETRIE[soort]) {
    const w = eigen(deel, sleutel);
    if (w === undefined) continue;
    const waarde = geometrieWaarde(sleutel, w);
    if (waarde !== null) uit.push([sleutel, waarde]);
  }
  if (soort !== 'groep') {
    const vul = kleurWaarde(eigen(deel, 'vul'));
    if (vul !== null) uit.push(['fill', vul]);
    const lijn = kleurWaarde(eigen(deel, 'lijn'));
    if (lijn !== null) uit.push(['stroke', lijn]);
    const dikte = eigen(deel, 'lijnDikte');
    if (isGetal(dikte) && dikte >= 0) uit.push(['stroke-width', String(dikte)]);
    const dekking = eigen(deel, 'dekking');
    if (isGetal(dekking) && dekking >= 0 && dekking <= 1) uit.push(['opacity', String(dekking)]);
    const einde = eigen(deel, 'lijnEinde');
    if (typeof einde === 'string' && Object.hasOwn(LIJN_EINDE, einde)) uit.push(['stroke-linecap', LIJN_EINDE[einde]]);
    const hoek = eigen(deel, 'lijnHoek');
    if (typeof hoek === 'string' && Object.hasOwn(LIJN_HOEK, hoek)) uit.push(['stroke-linejoin', LIJN_HOEK[hoek]]);
  }
  const t = eigen(deel, 'transform');
  if (typeof t === 'string' && t.length <= 200 && TRANSFORM.test(t)) uit.push(['transform', t]);
  if (soort !== 'groep') {
    const klassen = lichtVariabelen(deel).map(([naam]) => naam.slice(2)); // '--ev-vl' -> 'ev-vl'
    // Een licht verloop (taak 9c): ook de klasse ev-vl; de variabele (url naar het eigen verloop) zet vormNaarSvg.
    if (isVerloop(eigen(deel, 'vulLicht'))) klassen.unshift('ev-vl');
    if (klassen.length) uit.push(['class', klassen.join(' ')]);
  }
  return uit;
}

const isVerloop = (w) => w !== null && typeof w === 'object' && (eigen(w, 'verloop') === 'lineair' || eigen(w, 'verloop') === 'radiaal');

// De lichte varianten van een deel als [CSS-variabele, waarde]: '--ev-vl' (vulling) en '--ev-ll' (lijn). Enkel kleur of 'none'
// (een licht verloop staat hier niet in: vormNaarSvg maakt er een eigen verloop van en zet '--ev-vl' op url(#id)).
export function lichtVariabelen(deel) {
  const uit = [];
  const vl = kleurWaarde(eigen(deel, 'vulLicht'));
  if (vl !== null) uit.push(['--ev-vl', vl]);
  const ll = kleurWaarde(eigen(deel, 'lijnLicht'));
  if (ll !== null) uit.push(['--ev-ll', ll]);
  return uit;
}

let teller = 0; // unieke id's voor verlopen (per gebouwd element, ook als dezelfde vorm meermaals getekend wordt)

function maakVerloop(doc, defs, vul) {
  const soort = eigen(vul, 'verloop');
  if (soort !== 'lineair' && soort !== 'radiaal') return null;
  const stops = eigen(vul, 'stops');
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > 8) return null;
  const el = doc.createElementNS(SVG_NS, soort === 'lineair' ? 'linearGradient' : 'radialGradient');
  const id = `ev-verloop-${++teller}`;
  el.setAttribute('id', id);
  for (const sleutel of soort === 'lineair' ? ['x1', 'y1', 'x2', 'y2'] : ['cx', 'cy', 'r']) {
    const w = eigen(vul, sleutel);
    if (isGetal(w)) el.setAttribute(sleutel, String(w));
  }
  for (const stop of stops) {
    const op = eigen(stop, 'op');
    const kleur = eigen(stop, 'kleur');
    if (!isGetal(op) || op < 0 || op > 1 || typeof kleur !== 'string' || !KLEUR.test(kleur)) continue;
    const s = doc.createElementNS(SVG_NS, 'stop');
    s.setAttribute('offset', String(op));
    s.setAttribute('stop-color', kleur);
    el.appendChild(s);
  }
  defs.appendChild(el);
  return id;
}

function bouwDeel(doc, deel, ouder, verlopen, diepte) {
  const soort = eigen(deel, 'soort');
  if (typeof soort !== 'string' || !Object.hasOwn(ELEMENT, soort)) return;
  if (soort === 'groep' && diepte > 0) return; // één niveau diep, zoals de validator
  const el = doc.createElementNS(SVG_NS, ELEMENT[soort]);
  for (const [naam, waarde] of svgAttributen(deel)) el.setAttribute(naam, waarde);
  for (const [naam, waarde] of lichtVariabelen(deel)) el.style.setProperty(naam, waarde);
  const vul = eigen(deel, 'vul');
  if (soort !== 'groep' && vul !== null && typeof vul === 'object') {
    const id = maakVerloop(doc, verlopen(), vul);
    if (id) el.setAttribute('fill', `url(#${id})`);
  }
  // Licht verloop: een tweede verloop in hetzelfde svg; css/evenement.css zet in het lichte thema `fill: var(--ev-vl)`.
  const vulLicht = eigen(deel, 'vulLicht');
  if (soort !== 'groep' && isVerloop(vulLicht)) {
    const id = maakVerloop(doc, verlopen(), vulLicht);
    if (id) el.style.setProperty('--ev-vl', `url(#${id})`);
  }
  if (soort === 'groep') {
    const kinderen = eigen(deel, 'delen');
    if (Array.isArray(kinderen)) for (const k of kinderen.slice(0, 400)) bouwDeel(doc, k, el, verlopen, diepte + 1);
  }
  ouder.appendChild(el);
}

// Bouwt het <svg> van een vorm. Opties: `klasse` (vaste tekst van de aanroeper), `document` (enkel voor tests).
export function vormNaarSvg(vorm, { klasse = '', document: doc = globalThis.document } = {}) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const vb = eigen(vorm, 'viewBox');
  if (typeof vb === 'string' && KIJKVENSTER.test(vb)) svg.setAttribute('viewBox', vb);
  if (klasse) svg.setAttribute('class', klasse);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  let defs = null;
  const verlopen = () => {
    if (!defs) { defs = doc.createElementNS(SVG_NS, 'defs'); svg.insertBefore(defs, svg.firstChild); }
    return defs;
  };
  const delen = eigen(vorm, 'delen');
  if (Array.isArray(delen)) for (const deel of delen.slice(0, 400)) bouwDeel(doc, deel, svg, verlopen, 0);
  return svg;
}
