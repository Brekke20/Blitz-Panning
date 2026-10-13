// spel/spel.js — de engine van "Blitz Run": canvas tekenen, de requestAnimationFrame-lus en de invoer (toetsen en aanraking).
// Raakt geen overlay, netwerk of opslag aan: de overlay (spel-ui.js) geeft een canvas en terugroepers mee. Geen geluid.
// Alle regels (hitboxen, snelheid, score) staan puur in spel-logica.js.
import {
  WERELD, SPELER, maakStaat, stap, scoreBij, SPRING_TOETSEN, BUK_TOETSEN,
} from './spel-logica.js';
import { tekenPaal, tekenLogoBliksem, HEMEL } from './skins.js';

const STAP_MAX = 1 / 60;       // één rekenstap; een groter tijdverschil wordt in stappen verdeeld
const DT_MAX = 0.1;            // na een lange pauze (tab verborgen) geen sprong vooruit
const SPRING_BUFFER_S = 0.12;  // een sprong die net te vroeg ingedrukt wordt, telt nog even mee

const KLEUR = Object.freeze({
  lucht: HEMEL.onder, grond: '#4a5d70', ster: '#6b8197', tekst: '#d9d9d6',
  jerrycan: '#e5483b', jerrycanDonker: '#a9302a', bliksem: '#00dfa3', bliksemGloed: 'rgba(0,223,163,0.55)', flits: 'rgba(255,255,255,0.55)',
});

// `canvas`: het tekenvlak (600 x 200 logische eenheden). `skin()`: het huidige skinobject. `bijScore(score)` bij elke gewijzigde score,
// `bijEinde(score)` na een botsing. `verminderdeBeweging`: geen schudden of flitsen (prefers-reduced-motion).
export function maakSpel({
  canvas, skin, bijScore = () => {}, bijEinde = () => {}, verminderdeBeweging = false,
  rng = Math.random, raf = (f) => requestAnimationFrame(f), annuleerRaf = (id) => cancelAnimationFrame(id),
} = {}) {
  const ctx = canvas.getContext('2d');
  let staat = maakStaat(rng);
  let status = 'wacht'; // 'wacht' (voor de start), 'bezig', 'pauze', 'af'
  let rafId = null;
  let vorige = null;
  let springWacht = 0;
  let bukkenIngehouden = false;
  let laatsteScore = 0;
  let schudTot = 0;
  let klok = 0; // ms sinds de start van het venster, voor kleine animaties

  const stopLus = () => { if (rafId !== null) { annuleerRaf(rafId); rafId = null; } vorige = null; };

  function teken(ts = 0) {
    const g = WERELD.grondY;
    ctx.save();
    // Het tekenvlak mag groter zijn dan de wereld (scherpte op hoge-dpi- en telefoonschermen): schaal naar de logische wereld.
    ctx.setTransform(canvas.width / WERELD.breedte, 0, 0, canvas.height / WERELD.hoogte, 0, 0);
    if (!verminderdeBeweging && ts < schudTot) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    const verloop = ctx.createLinearGradient(0, 0, 0, WERELD.hoogte);
    verloop.addColorStop(0, HEMEL.boven);
    verloop.addColorStop(1, HEMEL.onder);
    ctx.fillStyle = verloop;
    ctx.fillRect(-10, -10, WERELD.breedte + 20, WERELD.hoogte + 20);
    // sterren die langzaam meeschuiven (parallax)
    ctx.fillStyle = KLEUR.ster;
    for (let i = 0; i < 14; i++) {
      const x = ((i * 97 - staat.afstand * 0.15) % WERELD.breedte + WERELD.breedte) % WERELD.breedte;
      ctx.fillRect(x, 14 + ((i * 53) % 90), 2, 2);
    }
    ctx.fillStyle = KLEUR.grond;
    ctx.fillRect(0, g, WERELD.breedte, 2);
    for (let i = 0; i < 20; i++) {
      const x = ((i * 41 - staat.afstand) % WERELD.breedte + WERELD.breedte) % WERELD.breedte;
      ctx.fillRect(x, g + 8 + (i % 3) * 7, 10, 2);
    }
    for (const h of staat.hindernissen) h.soort === 'bliksem' ? tekenBliksem(h) : tekenJerrycan(h);
    // Altijd de staande afmetingen: tekenPaal drukt ze bij `bukken` plat tot precies de bukhitbox.
    tekenPaal(ctx, skin(), { x: SPELER.x, y: g - staat.speler.y, breedte: SPELER.staan.b, hoogte: SPELER.staan.h, bukken: staat.speler.bukken, t: ts });
    ctx.fillStyle = KLEUR.tekst;
    ctx.font = '600 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(scoreBij(staat.afstand)).padStart(5, '0'), WERELD.breedte - 12, 22);
    if (status === 'af' && !verminderdeBeweging && ts < schudTot) {
      ctx.fillStyle = KLEUR.flits;
      ctx.fillRect(0, 0, WERELD.breedte, WERELD.hoogte);
    }
    ctx.restore();
  }

  function tekenJerrycan(h) {
    const x = h.x, y = WERELD.grondY - h.h;
    ctx.fillStyle = KLEUR.jerrycan;
    ctx.fillRect(x, y + 5, h.b, h.h - 5);
    ctx.fillStyle = KLEUR.jerrycanDonker;
    ctx.fillRect(x, y + 5, h.b, 3);
    ctx.fillRect(x + h.b - 6, y, 6, 6); // schenktuit
    ctx.fillRect(x + 3, y + 1, 5, 4);   // handvat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 5, y + 12, h.b - 10, 3);
  }

  function tekenBliksem(h) {
    // Het Blitz-logo (twee schuine streken) van het plafond tot aan de punt (h.bodem boven de grond), met een lichte gloed.
    const top = WERELD.grondY - h.bodem - h.h;
    ctx.save();
    ctx.shadowColor = KLEUR.bliksemGloed;
    ctx.shadowBlur = 8;
    tekenLogoBliksem(ctx, h.x, top, h.b, h.h, h.b * 0.36, KLEUR.bliksem);
    ctx.restore();
  }

  function lus(ts) {
    rafId = null;
    if (status !== 'bezig') return;
    const dt = vorige === null ? 0 : Math.min(DT_MAX, (ts - vorige) / 1000);
    vorige = ts;
    klok = ts;
    let rest = dt;
    while (rest > 0 && !staat.dood) {
      const d = Math.min(STAP_MAX, rest);
      rest -= d;
      const grond = staat.speler.y <= 0 && staat.speler.vy <= 0;
      stap(staat, d, { spring: springWacht > 0 && grond, bukken: bukkenIngehouden });
      if (grond && staat.speler.vy > 0) springWacht = 0;
      else springWacht = Math.max(0, springWacht - d);
    }
    const score = scoreBij(staat.afstand);
    if (score !== laatsteScore) { laatsteScore = score; bijScore(score); }
    if (staat.dood) {
      status = 'af';
      schudTot = ts + 250;
      teken(ts);
      bijEinde(score);
      return;
    }
    teken(ts);
    rafId = raf(lus);
  }

  const api = {
    get status() { return status; },
    get score() { return scoreBij(staat.afstand); },
    /** Nieuw spel: begint meteen te lopen. */
    start() {
      stopLus();
      staat = maakStaat(rng);
      laatsteScore = 0; springWacht = 0; schudTot = 0;
      status = 'bezig';
      bijScore(0);
      rafId = raf(lus);
    },
    /** Tekent de beginstand (stilstaand, bv. op het startscherm of na het wisselen van skin). */
    toonStil() {
      if (status === 'bezig') return;
      if (status !== 'af') staat = maakStaat(rng);
      teken(klok);
    },
    pauzeer() {
      if (status !== 'bezig') return;
      status = 'pauze';
      stopLus();
    },
    hervat() {
      if (status !== 'pauze') return;
      status = 'bezig';
      rafId = raf(lus);
    },
    /** Stopt alles (overlay dicht): geen lus meer, geen terugroepers. */
    stop() {
      stopLus();
      status = 'wacht';
      bukkenIngehouden = false;
      springWacht = 0;
    },
    spring() { if (status === 'bezig') springWacht = SPRING_BUFFER_S; },
    bukken(aan) { bukkenIngehouden = Boolean(aan); },
    /** Toetsenbord. Geeft true als de toets voor het spel is (de oproeper doet dan preventDefault). */
    toets(e, omlaag) {
      if (SPRING_TOETSEN.includes(e.key)) { if (omlaag && !e.repeat) api.spring(); return true; }
      if (BUK_TOETSEN.includes(e.key)) { api.bukken(omlaag); return true; }
      return false;
    },
    teken: () => teken(klok),
  };
  return api;
}
