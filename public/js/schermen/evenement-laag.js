// schermen/evenement-laag.js — de DOM-kant van de feestelijke versiering (thema Halloween).
// De beslissing (wanneer, voor wie, hoe sober) staat puur in kern/versiering-logica.js; de kalender in kern/evenementen.js.
// Wat dit bestand doet:
//  - zet `data-event="halloween"` op <html> (css/evenement.css overschrijft dan enkel kleurvariabelen; enkel in `@media screen`);
//  - bouwt één decoratielaag `#event-laag` (inline SVG, aria-hidden, pointer-events: none, geen netwerk, niet in print);
//  - bouwt de achtergrondscène `#event-achtergrond` (inline SVG uit evenement-scene.js, onder alle inhoud, zelfde levensduur als de laag);
//  - zet tijdens het evenement het donkere thema (eigen keuze apart bewaard; `blitz_theme` blijft onaangeroerd);
//  - laat één spin langs de tabbalk kruipen en een vleermuis vliegen met een timer-lus (setTimeout, ~30 beelden per seconde, geen
//    requestAnimationFrame-lus; enkel met beweging). Sinds v2.1.3 rust ze zolang het spel Blitz Run open staat of de tab verborgen is;
//    de CSS-animaties (hangende spinnen, mist) lopen in stappen (steps()) van ongeveer 30 per seconde.
// Op aanraak/gsm/tablet en bij prefers-reduced-motion bevat de laag GEEN bewegende elementen (ze worden niet eens gebouwd).
// Raakt `document`/`window` enkel binnen functies (daarom een scherm-module en geen kern). Wijst geen `window`-namen toe.
// De beslissing wordt herberekend bij de start, bij een wijziging van toestel/beweging/voorkeur, bij terugkeer naar de pagina en elke minuut
// (een toestel dat dagen openstaat, volgt zo de datum: 31 okt 23:59 -> 1 nov 00:00). Verandert het thema, dan komt de gebeurtenis
// 'versiering-gewijzigd' op window, zodat lege-tekst-lijsten zich hertekenen.
import { TEST_MODE } from '../kern/omgeving.js';
import { beslis, leesVoorkeur, bewaarVoorkeur, legeTekst, STAP_MS } from '../kern/versiering-logica.js';
import { belgischeDag } from '../kern/evenementen.js';
import { kiesThema, bewaarThemaKeuze } from '../kern/versiering-thema.js';
import { sceneSvg, kijkvenster } from './evenement-scene.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WEB = '<path d="M0 0H100M0 0L90 40M0 0L70 70M0 0L40 90M0 0V100"/><path d="M22 0Q20 18 0 22M45 0Q40 40 0 45M70 0Q60 60 0 70M95 0Q80 80 0 95"/>';
const SPIN = '<ellipse cx="12" cy="13" rx="4" ry="5"/><circle cx="12" cy="7.5" r="2.6"/><path d="M8 11L2 7M8 13L1 13M8 15L2 20M9 17L5 23M16 11L22 7M16 13L23 13M16 15L22 20M15 17L19 23" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>';
const VLEERMUIS = '<path d="M16 17c-2-3-4-6-9-7 1 2 1 4 0 6-2-1-5 0-7 2 3 0 5 1 6 3 1-1 3-1 4 1 1-2 3-3 6-3 3 0 5 1 6 3 1-2 3-2 4-1 1-2 3-3 6-3-2-2-5-3-7-2-1-2-1-4 0-6-5 1-7 4-9 7z" transform="translate(4 3)"/>';

let laag = null;          // het element #event-laag (of null)
let achtergrond = null;   // het element #event-achtergrond (de scène onder de inhoud), leeft en sterft samen met `laag`
let laagSleutel = '';     // 'thema|beweging': bij wijziging wordt de laag opnieuw gebouwd
let lusTimer = 0;   // de timer van het volgende beeld (~30 per seconde)
let kruiper = null;
let vleermuis = null;
// Vleermuis: wacht een willekeurige tijd, vliegt dan een golvende baan van links naar rechts of omgekeerd, op een willekeurige
// hoogte, en schiet weg van de muiswijzer. Alles in de rAF-lus van de kruiper (geen extra lus).
const vlucht = { actief: false, wachtTot: 0, x: 0, y: 0, basisY: 0, dir: 1, v: 160, amp: 30, freq: 1.2, fase: 0, vy: 0, t: 0 };
let kruipState = { x: 40, dir: 1, last: 0, top: 0, breedte: 0, wacht: 0 };
let minuutTimer = 0;
let vorigThema; // undefined = nog niet bepaald (de eerste bepaling meldt niets)
const muis = { x: -999, y: -999 };
let luisteraars = false;

const venster = () => (typeof window !== 'undefined' ? window : null);

function opslag() { try { return venster()?.localStorage ?? null; } catch { return null; } }

function reducedMotion() {
  try { return !!venster()?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function invoer() {
  const w = venster();
  const a = w?.apparaat || {};
  let testForceer = false;
  try { testForceer = new URLSearchParams(w.location.search).get('versiering') === 'aan'; } catch {}
  return {
    nu: new Date(), voorkeur: leesVoorkeur(opslag()), testMode: TEST_MODE, testForceer,
    soort: a.soort, aanraak: a.aanraak, reducedMotion: reducedMotion(),
  };
}

// Wat er nu geldt (voor de instellingen en de lege-tekst-helper).
export function huidigeBeslissing() { return beslis(invoer()); }

// Themateksten voor lege toestanden: de standaardtekst als er geen thema actief is.
export function eventTekst(sleutel, standaard) {
  const thema = typeof document !== 'undefined' ? document.documentElement.dataset.event : null;
  return thema ? legeTekst(thema, sleutel, standaard) : standaard;
}

function svg(klasse, viewBox, inhoud, extra = '') {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('class', klasse);
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  if (extra) el.setAttribute('style', extra);
  el.innerHTML = inhoud;
  return el;
}

function webSvg(klasse) {
  const el = svg('ev-web ' + klasse, '0 0 100 100', WEB);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1');
  return el;
}

function bouwLaag(b) {
  const el = document.createElement('div');
  el.id = 'event-laag';
  el.setAttribute('aria-hidden', 'true');
  el.dataset.thema = b.thema;
  // Statisch: webben (ook op aanraak/gsm/tablet, maar kleiner via CSS).
  for (const k of ['ev-web-tl', 'ev-web-tr', 'ev-web-bl', 'ev-web-br']) el.appendChild(webSvg(k));
  if (b.beweging) {
    // Hangende spinnen (twee) en de kruipende spin (één): samen MAX_SPINNEN. Plus één vleermuis en een lichte mist.
    const hang = (links, lengte, duur, vertraging) => {
      const h = document.createElement('div');
      h.className = 'ev-hang ev-beweeg';
      h.style.cssText = `left:${links}%;--l:${lengte}px;--st:${Math.round(duur * 15)};animation-duration:${duur}s;animation-delay:${vertraging}s`;
      const draad = document.createElement('span');
      draad.className = 'ev-draad';
      h.appendChild(draad);
      h.appendChild(svg('ev-spin', '0 0 24 24', SPIN));
      return h;
    };
    el.appendChild(hang(1.2, 60, 10, -2)); // helemaal aan de zijkanten (in de kalender boven de urenkolom): weg van de inhoud
    el.appendChild(hang(95, 44, 13, -6));
    const kr = svg('ev-spin ev-kruiper ev-beweeg', '0 0 24 24', SPIN);
    kr.id = 'ev-kruiper';
    el.appendChild(kr);
    const vl = svg('ev-vleermuis ev-beweeg', '0 0 40 26', VLEERMUIS);
    vl.id = 'ev-vleermuis';
    el.appendChild(vl);
    const mist = document.createElement('div');
    mist.className = 'ev-mist ev-beweeg';
    el.appendChild(mist);
  }
  return el;
}

// Onderkant van alles wat bovenaan vast blijft staan: kop + tabbalk + meldingsbalken (--sticky-top) én de vaste balk van het
// actieve tabblad (zoekbalk, weekbalk, routebalk, ...). De versiering begint daar, anders verdwijnt ze achter die balk.
// Gemeten bij de start, bij een formaatwijziging, na een klik (tabwissel) en bij terugkeer naar de pagina; nooit per beeld.
export function meetEvTop() {
  if (!laag || typeof document === 'undefined') return;
  const kop = document.querySelector('.topbar-sticky');
  let onder = kop ? kop.getBoundingClientRect().bottom : 0;
  for (const id of ['offline-banner', 'outbox-banner']) {
    const b = document.getElementById(id);
    if (b && getComputedStyle(b).display !== 'none') onder = Math.max(onder, b.getBoundingClientRect().bottom);
  }
  // Wat staat er net onder die rand? Is dat (of een ouder) een vaste balk, dan schuift de rand naar de onderkant ervan (max. 3 lagen).
  for (let i = 0; i < 3 && document.elementFromPoint; i++) {
    let el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(onder) + 2);
    while (el && el !== document.body && getComputedStyle(el).position !== 'sticky') el = el.parentElement;
    if (!el || el === document.body || el.classList.contains('topbar-sticky')) break;
    const r = el.getBoundingClientRect();
    // Enkel balken over (bijna) de volle breedte tellen: de dagkoppen van de kalender zijn kolommen, geen balk. Anders
    // zou de versiering pas onder die hoge koppen beginnen, midden in het uurrooster.
    if (r.width < window.innerWidth * 0.8) break;
    if (r.bottom <= onder + 1) break;
    onder = r.bottom;
  }
  if (onder > 0) laag.style.setProperty('--ev-top', Math.round(onder) + 'px');
  meetKruiper();
}
let meetGepland = 0;
function planMeting() {
  if (meetGepland || typeof requestAnimationFrame === 'undefined') return;
  meetGepland = requestAnimationFrame(() => { meetGepland = 0; meetEvTop(); });
}

// Stopt de lus volledig.
function stopKruiper() {
  if (lusTimer) clearTimeout(lusTimer);
  lusTimer = 0; kruipState.last = 0;
}

const spelOpen = () => !!document.getElementById('spel-overlay')?.classList.contains('open');
const nuMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Volgend beeld over ~33 ms (een timer, geen requestAnimationFrame: de browser tekent dan hoogstens ~30 keer per seconde).
function planStap(ms = STAP_MS) { lusTimer = setTimeout(stapKruiper, ms); }

// De hoogte van de kruiper staat vast (alleen x verandert): één meting bij het starten en bij een formaatwijziging, niet per frame.
function meetKruiper() {
  if (!kruiper) return;
  kruipState.top = kruiper.getBoundingClientRect().top;
  kruipState.breedte = window.innerWidth - 40;
}

function stapKruiper() {
  lusTimer = 0;
  if (!kruiper || !kruiper.isConnected) return;
  // Het spel tekent zelf: de versiering staat stil (ook de CSS-animaties) en kijkt elke halve seconde of het spel dicht is.
  if (spelOpen()) {
    laag?.classList.add('ev-gepauzeerd');
    kruipState.last = 0;
    planStap(500);
    return;
  }
  if (!document.hidden) laag?.classList.remove('ev-gepauzeerd');
  const t = nuMs();
  const s = kruipState;
  if (!s.last) { s.last = t; planStap(); return; }
  const dt = t - s.last;
  s.last = t;
  const stap = Math.min(100, dt);
  const dx = (s.x + 11) - muis.x, dy = (s.top + 11) - muis.y, d = Math.hypot(dx, dy);
  let v = 22; // px per seconde: langzaam
  if (d < 90) { s.dir = dx >= 0 ? 1 : -1; v = 110; } // ontwijkt de muis
  s.x += s.dir * v * stap / 1000;
  if (s.x > s.breedte) { s.x = s.breedte; s.dir = -1; }
  if (s.x < 10) { s.x = 10; s.dir = 1; }
  kruiper.style.transform = `translateX(${s.x}px) scaleX(${s.dir})`;
  stapVleermuis(t, stap);
  planStap();
}

function startVlucht(t) {
  const w = window.innerWidth, h = window.innerHeight;
  const top = kruipState.top + 30;
  const r = Math.random;
  Object.assign(vlucht, {
    actief: true, dir: r() < 0.5 ? 1 : -1, v: 120 + r() * 120, amp: 10 + r() * 50, freq: 0.6 + r() * 1.6, fase: r() * 6.28,
    basisY: top + r() * Math.max(40, h * 0.5 - top), vy: 0, t: 0,
  });
  vlucht.x = vlucht.dir > 0 ? -50 : w + 50;
  vlucht.y = vlucht.basisY;
}

function stapVleermuis(t, stapMs) {
  if (!vleermuis) return;
  const dt = stapMs / 1000;
  if (!vlucht.actief) {
    if (!vlucht.wachtTot) vlucht.wachtTot = t + 4000 + Math.random() * 8000; // eerste vlucht na 4 tot 12 s
    if (t < vlucht.wachtTot) { vleermuis.style.opacity = '0'; return; }
    startVlucht(t);
  }
  const f = vlucht;
  f.t += dt;
  // Weg van de muis: duw de basislijn weg en vlieg sneller zolang de muis dichtbij is.
  const dx = f.x + 17 - muis.x, dy = f.y + 11 - muis.y, d = Math.hypot(dx, dy);
  let v = f.v;
  if (d < 140) {
    const kracht = (140 - d) / 140;
    f.vy += (dy >= 0 ? 1 : -1) * 900 * kracht * dt;
    v *= 1 + 1.5 * kracht;
    if ((dx >= 0) !== (f.dir > 0) && d < 70) f.dir = dx >= 0 ? 1 : -1; // muis recht voor: draai om
  }
  f.vy *= 0.92;
  f.basisY = Math.min(window.innerHeight - 60, Math.max(kruipState.top + 10, f.basisY + f.vy * dt));
  f.x += f.dir * v * dt;
  f.y = f.basisY + Math.sin(f.t * f.freq * 6.28 + f.fase) * f.amp;
  const klap = 1 - 0.4 * Math.abs(Math.sin(f.t * 14));
  vleermuis.style.opacity = '0.85';
  vleermuis.style.transform = `translate(${f.x}px, ${f.y}px) scale(${f.dir}, ${klap})`;
  if (f.x > window.innerWidth + 60 || f.x < -60) { f.actief = false; f.wachtTot = t + 15000 + Math.random() * 30000; vleermuis.style.opacity = '0'; }
}

// Start de lus (doet niets als ze al loopt, er geen kruiper is of de tab verborgen is).
function startKruiper() {
  if (lusTimer || !kruiper || document.hidden) return;
  kruipState.last = 0;
  vlucht.actief = false; vlucht.wachtTot = 0; // een vlucht die door een verborgen tab werd onderbroken, begint niet halverwege opnieuw
  if (vleermuis) vleermuis.style.opacity = '0';
  meetKruiper();
  planStap();
}

// De achtergrondscène (boerderij, maan, vogelverschrikkers): één inline SVG onder alle inhoud (css/evenement.css: z-index -1).
function bouwAchtergrond() {
  const el = document.createElement('div');
  el.id = 'event-achtergrond';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = sceneSvg();
  return el;
}
// Smal (staand) scherm: toon het rechterdeel van de scène (maan en boerderij); breed: alles. Bij het bouwen en bij een formaatwijziging.
function pasKijkvenster() {
  const s = achtergrond?.querySelector('svg');
  if (!s) return;
  const k = kijkvenster(window.innerWidth, window.innerHeight);
  s.setAttribute('viewBox', k.viewBox);
  s.setAttribute('preserveAspectRatio', k.uitlijning);
}

// Het thema (donker/licht) tijdens het evenement: zie kern/versiering-thema.js. Raakt `blitz_theme` nooit aan.
function themaContext(b) {
  return { actief: !!b.actief, thema: b.thema, jaar: belgischeDag(new Date()).jaar, opslag: opslag() };
}
function pasThemaToe(b) {
  const t = kiesThema(themaContext(b));
  const el = document.documentElement;
  if (el.getAttribute('data-theme') !== t) el.setAttribute('data-theme', t);
  document.getElementById('meta-theme-color')?.setAttribute('content', t === 'light' ? '#f5f6f7' : '#181e24');
}
// Een themawissel van de gebruiker (knop in de kop): tijdens het evenement in de eigen sleutel, anders in `blitz_theme`.
export function bewaarThemaWissel(keuze) {
  return bewaarThemaKeuze({ ...themaContext(beslis(invoer())), keuze });
}

function verwijderLaag() {
  stopKruiper();
  laag?.remove();
  achtergrond?.remove();
  achtergrond = null;
  laag = null; kruiper = null; vleermuis = null; laagSleutel = '';
  document.documentElement.removeAttribute('data-event');
}

// Herberekent alles: roep aan bij de start, na een wijziging van de voorkeur, en bij een wijziging van toestel of bewegingsvoorkeur.
export function herbereken() {
  if (typeof document === 'undefined') return;
  const b = beslis(invoer());
  const thema = b.actief ? b.thema : null;
  pasToe(b);
  pasThemaToe(b);
  if (thema !== vorigThema) {
    const eerste = vorigThema === undefined;
    vorigThema = thema;
    if (!eerste) window.dispatchEvent(new CustomEvent('versiering-gewijzigd', { detail: { thema } }));
  }
}

function pasToe(b) {
  if (!b.actief) { verwijderLaag(); return; }
  const sleutel = `${b.thema}|${b.beweging}`;
  document.documentElement.dataset.event = b.thema;
  document.documentElement.dataset.eventSober = b.sober ? 'ja' : 'nee';
  if (laag && sleutel === laagSleutel) { if (b.beweging) startKruiper(); return; }
  stopKruiper();
  laag?.remove();
  laag = bouwLaag(b);
  laagSleutel = sleutel;
  document.body.appendChild(laag);
  achtergrond?.remove();
  achtergrond = bouwAchtergrond();
  document.body.insertBefore(achtergrond, document.body.firstChild);
  pasKijkvenster();
  kruiper = b.beweging ? laag.querySelector('#ev-kruiper') : null;
  vleermuis = b.beweging ? laag.querySelector('#ev-vleermuis') : null;
  vlucht.actief = false; vlucht.wachtTot = 0;
  if (document.hidden) laag.classList.add('ev-gepauzeerd');
  meetEvTop();
  if (kruiper) startKruiper();
}

// Voorkeur van de gebruiker voor dit toestel: aan = automatisch (tijdens een evenement), uit = nooit.
export function zetVersieringAan(aan) {
  bewaarVoorkeur(opslag(), aan ? 'auto' : 'uit');
  herbereken();
}
export function versieringAanVoorkeur() { return leesVoorkeur(opslag()) !== 'uit'; }

export function startVersiering() {
  const w = venster();
  if (!w || typeof document === 'undefined') return;
  herbereken();
  if (luisteraars) return;
  luisteraars = true;
  w.addEventListener('apparaatwijziging', herbereken);
  try { w.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', herbereken); } catch {}
  w.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { muis.x = e.clientX; muis.y = e.clientY; } }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    laag?.classList.toggle('ev-gepauzeerd', document.hidden);
    if (document.hidden) stopKruiper();
    else { herbereken(); planMeting(); startKruiper(); } // na een tijd op de achtergrond kan de datum veranderd zijn
  });
  w.addEventListener('resize', () => { planMeting(); pasKijkvenster(); });
  document.addEventListener('click', planMeting, true); // een tabwissel verandert de vaste balk van het scherm
  if (!minuutTimer) minuutTimer = setInterval(() => { if (!document.hidden) { herbereken(); planMeting(); } }, 60000);
  w.addEventListener('keyup', planMeting, true); // tabwissel met het toetsenbord
  // Bij de start staan de balken van het scherm er soms nog niet: meet opnieuw na het laden en kort daarna.
  w.addEventListener('load', planMeting);
  for (const ms of [300, 1500]) setTimeout(planMeting, ms);
}
