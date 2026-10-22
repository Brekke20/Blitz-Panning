// schermen/versiering-bewegingen.js — de vaste bewegingen van de versieringslaag (spec thema's als pakket §3.3). Een pakket kiest
// er enkel uit; de code staat hier, nooit in het pakket (ADR 0001).
//
// BOUWERS[beweging](element, pakket, ctx) -> { stap?(t, dtMs), meet?(), hervat?(), stop() }
//   element: één gevalideerd element van `pakket.versiering`; pakket: het gevalideerde themapakket;
//   ctx: { laag, sober, muis: { x, y }, evTop: () => px, max: hoeveel elementen van deze beweging er nog bij mogen (plafond) }.
//   - `stap` loopt in de gedeelde timer-lus van evenement-laag.js (~30 per seconde, STAP_MS); die pauzeert tijdens het spel en in
//     een verborgen tab. `meet` volgt een formaatwijziging, `hervat` een terugkeer naar de pagina, `stop` ruimt op (geen timers hier).
//   - CSS-animaties (hangen, vallen, opstijgen, mist, vonken) lopen in stappen (steps()) van ongeveer 30 per seconde; ze staan stil
//     via `.ev-gepauzeerd` op de laag (css/evenement.css).
// De opmaak van v2.2.0 die niet in het pakket staat, staat hier en in de CSS vast: de plaatsen en draadlengtes van de hangende
// beelden, de snelheid van de kruiper (22 px/s, wijkt binnen 90 px voor de muis), de vleermuisvluchten (eerste na 4 tot 12 s, pauze
// 15 tot 45 s, vlucht voor de muis binnen 140 px), de hoekmaten en de mistkleuren.
// Alles wordt gebouwd met createElement/createElementNS (vorm-svg.js) en vaste klassen; tekst komt er niet in.
import { vormNaarSvg } from './vorm-svg.js';
import { PLAFONDS } from '../kern/themapakket-validatie.js';

const NAAM = /^[a-z][a-z0-9-]{0,29}$/;
const BEELD = /^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const HOEKEN = ['lb', 'rb', 'lo', 'ro'];
// v2.2.0: twee hangende spinnen helemaal aan de zijkanten (in de kalender boven de urenkolom), weg van de inhoud. Een derde (enkel
// zonder kruiper: hangen + kruipen samen hoogstens 3) hangt rechts van het midden.
const HANG_PLAATSEN = [
  { links: 1.2, lengte: 60, duur: 10, vertraging: -2 },
  { links: 95, lengte: 44, duur: 13, vertraging: -6 },
  { links: 72, lengte: 52, duur: 11.5, vertraging: -4 },
];

const r = () => Math.random();
const aantalVan = (element, ctx, beweging) => {
  const gevraagd = Number.isInteger(element.aantal) ? element.aantal : 1;
  return Math.max(0, Math.min(gevraagd, PLAFONDS[beweging], ctx.max ?? PLAFONDS[beweging]));
};
const stijl = (el, eigenschappen) => { for (const [k, v] of Object.entries(eigenschappen)) el.style.setProperty(k, v); return el; };
const div = (klasse) => { const el = document.createElement('div'); el.className = klasse; return el; };

// Een beeld uit het pakket: een vorm (SVG) of een rasterbeeld (<img> met de data-URI). null als de naam niet bestaat.
export function tekenBeeld(pakket, naam, klasse) {
  if (typeof naam !== 'string' || !NAAM.test(naam)) return null;
  const k = `ev-beeld ev-beeld-${naam}${klasse ? ' ' + klasse : ''}`;
  const vormen = pakket?.vormen;
  if (vormen && typeof vormen === 'object' && Object.hasOwn(vormen, naam)) return vormNaarSvg(vormen[naam], { klasse: k });
  const beelden = pakket?.beelden;
  if (beelden && typeof beelden === 'object' && Object.hasOwn(beelden, naam) && typeof beelden[naam] === 'string' && BEELD.test(beelden[naam])) {
    const img = document.createElement('img');
    img.className = k;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.draggable = false;
    img.decoding = 'async';
    img.src = beelden[naam];
    return img;
  }
  return null;
}

// Statisch beeld in de schermhoeken (webben, slingers). `richting: 'naarHoek'` spiegelt het beeld zodat de oorsprong van de
// tekening in elke hoek in die hoek ligt (de webben van v2.2.0); 'rechtop' (standaard) tekent het overal zoals het is.
function hoek(element, pakket, ctx) {
  const naarHoek = element.richting === 'naarHoek';
  let over = Math.min(PLAFONDS.hoek, ctx.max ?? PLAFONDS.hoek);
  for (const h of Array.isArray(element.hoeken) ? element.hoeken : []) {
    if (!HOEKEN.includes(h) || over <= 0) continue;
    const b = tekenBeeld(pakket, element.beeld, `ev-hoek ev-hoek-${h}${naarHoek ? ' ev-naar-hoek' : ''}`);
    if (!b) continue;
    ctx.laag.appendChild(b);
    over -= 1;
  }
  return { stop() {} };
}

// Beeld aan een draad dat zacht op en neer gaat (CSS-animatie ev-zak in stappen).
function hangen(element, pakket, ctx) {
  const n = aantalVan(element, ctx, 'hangen');
  for (let i = 0; i < n; i++) {
    const p = HANG_PLAATSEN[i];
    const beeld = tekenBeeld(pakket, element.beeld, '');
    if (!beeld) break;
    const h = stijl(div('ev-hang ev-beweeg'), {
      left: `${p.links}%`, '--l': `${p.lengte}px`, '--st': String(Math.round(p.duur * 15)),
      'animation-duration': `${p.duur}s`, 'animation-delay': `${p.vertraging}s`,
    });
    h.appendChild(div('ev-draad'));
    h.appendChild(beeld);
    ctx.laag.appendChild(h);
  }
  return { stop() {} };
}

// Kruipt langs de onderrand van de tabbalk (de vaste balken bovenaan) en wijkt uit voor de muis.
function kruipen(element, pakket, ctx) {
  if (aantalVan(element, ctx, 'kruipen') < 1) return { stop() {} };
  const el = tekenBeeld(pakket, element.beeld, 'ev-kruip ev-beweeg');
  if (!el) return { stop() {} };
  ctx.laag.appendChild(el);
  const s = { x: 40, dir: 1, top: 0, breedte: 0 };
  return {
    meet() { s.top = el.getBoundingClientRect().top; s.breedte = window.innerWidth - 40; },
    stap(t, stapMs) {
      const dx = (s.x + 11) - ctx.muis.x, dy = (s.top + 11) - ctx.muis.y, d = Math.hypot(dx, dy);
      let v = 22; // px per seconde: langzaam
      if (d < 90) { s.dir = dx >= 0 ? 1 : -1; v = 110; } // ontwijkt de muis
      s.x += s.dir * v * stapMs / 1000;
      if (s.x > s.breedte) { s.x = s.breedte; s.dir = -1; }
      if (s.x < 10) { s.x = 10; s.dir = 1; }
      el.style.transform = `translateX(${s.x}px) scaleX(${s.dir})`;
    },
    stop() {},
  };
}

// Vliegt af en toe over het scherm in een golvende baan (vleermuis, vogel, rendier): wacht een willekeurige tijd, vliegt van links
// naar rechts of omgekeerd op een willekeurige hoogte, en schiet weg van de muiswijzer.
function eenVlieger(element, pakket, ctx) {
  const el = tekenBeeld(pakket, element.beeld, 'ev-vlieg ev-beweeg');
  if (!el) return null;
  ctx.laag.appendChild(el);
  const f = { actief: false, wachtTot: 0, x: 0, y: 0, basisY: 0, dir: 1, v: 160, amp: 30, freq: 1.2, fase: 0, vy: 0, t: 0 };
  const kruipTop = () => ctx.evTop() - 12; // v2.2.0: de hoogte van de kruiper (onderrand van de balken - 12 px)
  function start() {
    const w = window.innerWidth, h = window.innerHeight;
    const top = kruipTop() + 30;
    Object.assign(f, {
      actief: true, dir: r() < 0.5 ? 1 : -1, v: 120 + r() * 120, amp: 10 + r() * 50, freq: 0.6 + r() * 1.6, fase: r() * 6.28,
      basisY: top + r() * Math.max(40, h * 0.5 - top), vy: 0, t: 0,
    });
    f.x = f.dir > 0 ? -50 : w + 50;
    f.y = f.basisY;
  }
  return {
    hervat() { f.actief = false; f.wachtTot = 0; el.style.opacity = '0'; }, // een vlucht onderbroken door een verborgen tab begint niet halverwege
    stap(t, stapMs) {
      const dt = stapMs / 1000;
      if (!f.actief) {
        if (!f.wachtTot) f.wachtTot = t + 4000 + r() * 8000; // eerste vlucht na 4 tot 12 s
        if (t < f.wachtTot) { el.style.opacity = '0'; return; }
        start();
      }
      f.t += dt;
      // Weg van de muis: duw de basislijn weg en vlieg sneller zolang de muis dichtbij is.
      const dx = f.x + 17 - ctx.muis.x, dy = f.y + 11 - ctx.muis.y, d = Math.hypot(dx, dy);
      let v = f.v;
      if (d < 140) {
        const kracht = (140 - d) / 140;
        f.vy += (dy >= 0 ? 1 : -1) * 900 * kracht * dt;
        v *= 1 + 1.5 * kracht;
        if ((dx >= 0) !== (f.dir > 0) && d < 70) f.dir = dx >= 0 ? 1 : -1; // muis recht voor: draai om
      }
      f.vy *= 0.92;
      f.basisY = Math.min(window.innerHeight - 60, Math.max(kruipTop() + 10, f.basisY + f.vy * dt));
      f.x += f.dir * v * dt;
      f.y = f.basisY + Math.sin(f.t * f.freq * 6.28 + f.fase) * f.amp;
      const klap = 1 - 0.4 * Math.abs(Math.sin(f.t * 14));
      el.style.opacity = '0.85';
      el.style.transform = `translate(${f.x}px, ${f.y}px) scale(${f.dir}, ${klap})`;
      if (f.x > window.innerWidth + 60 || f.x < -60) { f.actief = false; f.wachtTot = t + 15000 + r() * 30000; el.style.opacity = '0'; }
    },
  };
}
function vliegen(element, pakket, ctx) {
  const vliegers = [];
  for (let i = 0; i < aantalVan(element, ctx, 'vliegen'); i++) {
    const v = eenVlieger(element, pakket, ctx);
    if (v) vliegers.push(v);
  }
  return {
    hervat() { for (const v of vliegers) v.hervat(); },
    stap(t, stapMs) { for (const v of vliegers) v.stap(t, stapMs); },
    stop() { vliegers.length = 0; },
  };
}

// Valt traag van boven (sneeuw, confetti, blaadjes): CSS-animaties in stappen, elk op een eigen plek, tempo en grootte.
// `wiebel` (0 tot 1) = hoe ver het beeld heen en weer zwiept (0 = recht naar beneden).
function vallen(element, pakket, ctx) {
  const n = aantalVan(element, ctx, 'vallen');
  const wiebel = typeof element.wiebel === 'number' && element.wiebel >= 0 && element.wiebel <= 1 ? element.wiebel : 0.5;
  for (let i = 0; i < n; i++) {
    const beeld = tekenBeeld(pakket, element.beeld, '');
    if (!beeld) break;
    const duur = 14 + r() * 10;
    const wduur = 2.5 + r() * 2;
    const el = stijl(div('ev-val ev-beweeg'), {
      left: `${(((i + r() * 0.8) / n) * 96 + 2).toFixed(1)}%`, '--g': `${Math.round(14 + r() * 10)}px`,
      'animation-duration': `${duur.toFixed(1)}s`, 'animation-delay': `${(-r() * duur).toFixed(1)}s`, '--st': String(Math.round(duur * 30)),
      '--w': `${Math.round(wiebel * 36)}px`, '--wduur': `${wduur.toFixed(1)}s`, '--wst': String(Math.round(wduur * 30)),
    });
    el.appendChild(beeld);
    ctx.laag.appendChild(el);
  }
  return { stop() {} };
}

// Stijgt traag op (hartjes, ballonnen, bellen): CSS-animaties in stappen, van onder het scherm tot achter de balken bovenaan.
function opstijgen(element, pakket, ctx) {
  const n = aantalVan(element, ctx, 'opstijgen');
  for (let i = 0; i < n; i++) {
    const beeld = tekenBeeld(pakket, element.beeld, '');
    if (!beeld) break;
    const duur = 16 + r() * 10;
    const wduur = 3 + r() * 2;
    const el = stijl(div('ev-stijg ev-beweeg'), {
      left: `${(((i + r() * 0.8) / n) * 92 + 4).toFixed(1)}%`, '--g': `${Math.round(18 + r() * 10)}px`,
      'animation-duration': `${duur.toFixed(1)}s`, 'animation-delay': `${(-r() * duur).toFixed(1)}s`, '--st': String(Math.round(duur * 30)),
      '--w': `${Math.round(8 + r() * 14)}px`, '--wduur': `${wduur.toFixed(1)}s`, '--wst': String(Math.round(wduur * 30)),
    });
    el.appendChild(beeld);
    ctx.laag.appendChild(el);
  }
  return { stop() {} };
}

// Af en toe één vuurwerkpluim in de themakleuren (--accent, --accent-hover en wit), hoogstens één tegelijk, elke 6 tot 14 s.
// `frequentie` (0 tot 1) schuift dat venster: 1 = elke 6 tot 10 s, 0 = elke 10 tot 14 s. Gestuurd door de lus (geen eigen timers).
const VONKEN = 14;
const VONK_MS = 1400;
const VONK_KLEUREN = ['var(--accent)', 'var(--accent-hover)', '#ffffff'];
function vuurwerk(element, pakket, ctx) {
  if (Math.min(PLAFONDS.vuurwerk, ctx.max ?? 1) < 1) return { stop() {} };
  const f = typeof element.frequentie === 'number' && element.frequentie >= 0 && element.frequentie <= 1 ? element.frequentie : null;
  const wacht = () => (f === null ? 6000 + r() * 8000 : 6000 + (1 - f) * 4000 + r() * 4000);
  let volgende = 0;
  let pluim = null;
  let einde = 0;
  const weg = () => { pluim?.remove(); pluim = null; };
  function ontsteek(t) {
    const w = window.innerWidth, h = window.innerHeight, top = ctx.evTop();
    pluim = stijl(div('ev-pluim ev-beweeg'), {
      left: `${Math.round(w * (0.15 + r() * 0.7))}px`, top: `${Math.round(top + 40 + r() * Math.max(40, h * 0.4 - top))}px`,
    });
    for (let i = 0; i < VONKEN; i++) {
      const hoekRad = (i / VONKEN) * Math.PI * 2 + r() * 0.3;
      const afstand = 50 + r() * 40;
      pluim.appendChild(stijl(div('ev-vonk'), {
        '--dx': `${Math.round(Math.cos(hoekRad) * afstand)}px`, '--dy': `${Math.round(Math.sin(hoekRad) * afstand)}px`,
        '--vk': VONK_KLEUREN[i % VONK_KLEUREN.length],
      }));
    }
    ctx.laag.appendChild(pluim);
    einde = t + VONK_MS + 100;
  }
  return {
    hervat() { weg(); volgende = 0; },
    stap(t) {
      if (pluim && t >= einde) { weg(); volgende = t + wacht(); }
      if (!volgende) volgende = t + wacht();
      if (!pluim && t >= volgende) ontsteek(t);
    },
    stop() { weg(); },
  };
}

// Lichte nevel onderaan (kleuren van v2.2.0, css/evenement.css).
function mist(element, pakket, ctx) {
  if (Math.min(PLAFONDS.mist, ctx.max ?? 1) >= 1) ctx.laag.appendChild(div('ev-mist ev-beweeg'));
  return { stop() {} };
}

export const BOUWERS = Object.freeze({ hoek, hangen, kruipen, vliegen, vallen, opstijgen, vuurwerk, mist });
