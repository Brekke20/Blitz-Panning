// kern/evenement-laag.js — de DOM-kant van de feestelijke versiering (thema Halloween).
// De beslissing (wanneer, voor wie, hoe sober) staat puur in kern/versiering-logica.js; de kalender in kern/evenementen.js.
// Wat dit bestand doet:
//  - zet `data-event="halloween"` op <html> (css/evenement.css overschrijft dan enkel kleurvariabelen; enkel in `@media screen`);
//  - bouwt één decoratielaag `#event-laag` (inline SVG, aria-hidden, pointer-events: none, geen netwerk, niet in print);
//  - laat één spin langs de tabbalk kruipen met een rAF-lus (enkel met beweging; stopt bij een verborgen tab).
// Op aanraak/gsm/tablet en bij prefers-reduced-motion bevat de laag GEEN bewegende elementen (ze worden niet eens gebouwd).
// Raakt `document`/`window` enkel binnen functies. Wijst geen `window`-namen toe.
import { TEST_MODE } from './omgeving.js';
import { beslis, leesVoorkeur, bewaarVoorkeur, legeTekst } from './versiering-logica.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WEB = '<path d="M0 0H100M0 0L90 40M0 0L70 70M0 0L40 90M0 0V100"/><path d="M22 0Q20 18 0 22M45 0Q40 40 0 45M70 0Q60 60 0 70M95 0Q80 80 0 95"/>';
const SPIN = '<ellipse cx="12" cy="13" rx="4" ry="5"/><circle cx="12" cy="7.5" r="2.6"/><path d="M8 11L2 7M8 13L1 13M8 15L2 20M9 17L5 23M16 11L22 7M16 13L23 13M16 15L22 20M15 17L19 23" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>';
const VLEERMUIS = '<path d="M16 17c-2-3-4-6-9-7 1 2 1 4 0 6-2-1-5 0-7 2 3 0 5 1 6 3 1-1 3-1 4 1 1-2 3-3 6-3 3 0 5 1 6 3 1-2 3-2 4-1 1-2 3-3 6-3-2-2-5-3-7-2-1-2-1-4 0-6-5 1-7 4-9 7z" transform="translate(4 3)"/>';

let laag = null;          // het element #event-laag (of null)
let laagSleutel = '';     // 'thema|beweging|sober': bij wijziging wordt de laag opnieuw gebouwd
let raf = 0;
let kruiper = null;
let kruipState = { x: 40, dir: 1, last: 0 };
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
      h.style.cssText = `left:${links}%;--l:${lengte}px;animation-duration:${duur}s;animation-delay:${vertraging}s`;
      const draad = document.createElement('span');
      draad.className = 'ev-draad';
      h.appendChild(draad);
      h.appendChild(svg('ev-spin', '0 0 24 24', SPIN));
      return h;
    };
    el.appendChild(hang(4, 60, 10, -2)); // aan de zijkanten: weg van de inhoud
    el.appendChild(hang(95, 44, 13, -6));
    const kr = svg('ev-spin ev-kruiper ev-beweeg', '0 0 24 24', SPIN);
    kr.id = 'ev-kruiper';
    el.appendChild(kr);
    const vl = svg('ev-vleermuis ev-beweeg', '0 0 40 26', VLEERMUIS);
    el.appendChild(vl);
    const mist = document.createElement('div');
    mist.className = 'ev-mist ev-beweeg';
    el.appendChild(mist);
  }
  return el;
}

function stopKruiper() { if (raf) cancelAnimationFrame(raf); raf = 0; kruipState.last = 0; }

function stapKruiper(t) {
  if (!kruiper || !kruiper.isConnected) { raf = 0; return; }
  const s = kruipState;
  if (!s.last) s.last = t;
  const dt = Math.min(50, t - s.last); s.last = t;
  const breedte = window.innerWidth - 40;
  const rect = kruiper.getBoundingClientRect();
  const dx = (s.x + 11) - muis.x, dy = (rect.top + 11) - muis.y, d = Math.hypot(dx, dy);
  let v = 22; // px per seconde: langzaam
  if (d < 90) { s.dir = dx >= 0 ? 1 : -1; v = 110; } // ontwijkt de muis
  s.x += s.dir * v * dt / 1000;
  if (s.x > breedte) { s.x = breedte; s.dir = -1; }
  if (s.x < 10) { s.x = 10; s.dir = 1; }
  kruiper.style.transform = `translateX(${s.x}px) scaleX(${s.dir})`;
  raf = requestAnimationFrame(stapKruiper);
}

function startKruiper() {
  if (raf || !kruiper || document.hidden) return;
  kruipState.last = 0;
  raf = requestAnimationFrame(stapKruiper);
}

function verwijderLaag() {
  stopKruiper();
  laag?.remove();
  laag = null; kruiper = null; laagSleutel = '';
  document.documentElement.removeAttribute('data-event');
}

// Herberekent alles: roep aan bij de start, na een wijziging van de voorkeur, en bij een wijziging van toestel of bewegingsvoorkeur.
export function herbereken() {
  if (typeof document === 'undefined') return;
  const b = beslis(invoer());
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
  kruiper = b.beweging ? laag.querySelector('#ev-kruiper') : null;
  if (document.hidden) laag.classList.add('ev-gepauzeerd');
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
    if (document.hidden) stopKruiper(); else startKruiper();
  });
}
