// spel/spel-ui.js — de overlay van "Blitz Run": startscherm (beste score, skinkeuze), het canvas en het eindscherm.
// Wordt pas geladen bij de eerste 5× snelle tik op het logo-icoon (spel-opening.js). Schrijft nooit iets naar de planning: enkel /api/spel.
// Sluiten: 5× snel tikken op het logo-icoon, ✕ of Escape (registreerVenster). Het overlay laat de kop (met het logo) vrij, zodat 5× tikken ook sluit.
import { registreerActies } from '../kern/ui.js';
import { apiVerzoek } from '../kern/api.js';
import { huidigeGebruiker } from '../kern/sessie.js';
import { registreerVenster } from '../venster.js';
import { SKINS, standaardSkin, HEMEL, RAND_KLEUR } from './skins.js';
import { ontgrendelVoorwaarde } from './spel-regels.js';
import { maakVoortgang } from './spel-voortgang.js';
import { maakSpel } from './spel.js';
import { WERELD } from './spel-logica.js';

const CSS = `
#spel-overlay { display: none; box-sizing: border-box; overscroll-behavior: contain; position: fixed; left: 0; right: 0; bottom: 0; top: var(--spel-top, 52px); z-index: 9000;
  background: rgba(0,0,0,.72); padding: 12px 3%; overflow: hidden; }
#spel-overlay.open { display: flex; align-items: center; justify-content: center; }
#spel-overlay:focus { outline: none; }
/* Gecentreerd in het gebied onder de balken: breed (tot 1280 px), de kop altijd zichtbaar, enkel het gedeelte met de skinkeuze scrolt. */
.spel-kaart { box-sizing: border-box; display: flex; flex-direction: column; width: min(1280px, 100%); max-height: 100%; min-height: 0;
  background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
.spel-kop { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.spel-kop h2 { margin: 0; font-size: 1rem; }
.spel-veld { flex: none; display: flex; justify-content: center; }
.spel-veld canvas { display: block; flex: none; width: min(100%, max(300px, calc((100vh - var(--spel-top, 52px) - 24px - 24px - 52px - 190px) * 3))); aspect-ratio: 3 / 1; border-radius: 8px; touch-action: none; user-select: none; -webkit-user-select: none; background: linear-gradient(${HEMEL.boven}, ${HEMEL.onder}); }
.spel-info { flex: 0 1 auto; min-height: 0; overflow-y: auto; touch-action: pan-y; margin-top: 10px; text-align: center; }
.spel-info[hidden] { display: block; visibility: hidden; }
.spel-beste { font-weight: 600; margin-bottom: 6px; }
.spel-melding { min-height: 1.3em; color: var(--accent-ink, var(--accent)); font-weight: 600; margin-bottom: 4px; }
.spel-skins { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 8px 0; }
.spel-skin { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 76px; padding: 5px 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; font-size: .76rem; cursor: pointer; }
.spel-skin[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.spel-skin[disabled] { opacity: .55; cursor: not-allowed; }
.spel-skin small { color: var(--muted); }
.spel-skin i { display: block; width: 14px; height: 24px; border-radius: 2px; border: 1.5px solid ${RAND_KLEUR}; box-shadow: 0 0 0 1px rgba(0,0,0,.45); }
.spel-skin i b { display: block; width: 8px; height: 7px; margin: 2px 0 0 2px; }
.spel-hint { color: var(--muted); font-size: .78rem; margin-top: 6px; }
.spel-uitleg summary { cursor: pointer; color: var(--muted); font-size: .78rem; margin-top: 6px; }
.spel-draai, .spel-aanraakhint, .spel-knop { display: none; }
/* Aanraakknoppen (enkel op een aanraakscherm, enkel tijdens het spel): Bukken (ingehouden) linksonder, Springen rechtsonder, binnen duimbereik. */
.spel-knop { position: fixed; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); width: 84px; height: 84px; min-width: 72px; min-height: 72px; box-sizing: border-box;
  flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 0; border-radius: 50%;
  background: var(--surface3, #2a3340); color: var(--text); border: 2px solid var(--accent); font: inherit; font-size: .78rem; font-weight: 700; line-height: 1.1;
  box-shadow: 0 4px 16px rgba(0,0,0,.5); touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; cursor: pointer; }
.spel-knop span[aria-hidden] { font-size: 1.5rem; line-height: 1; }
.spel-knop--bukken { left: calc(14px + env(safe-area-inset-left, 0px)); }
.spel-knop--springen { right: calc(14px + env(safe-area-inset-right, 0px)); }
.spel-knop.is-ingedrukt { background: var(--accent); color: #0b1a14; transform: scale(.94); }
/* Smal scherm (telefoon, klein venster): bijna schermvullend onder de balken, kleine marges, info compact eronder, de overlay scrolt. */
@media (max-width: 820px) {
  #spel-overlay { padding: 4px; overflow: auto; }
  #spel-overlay.open { align-items: flex-start; }
  .spel-kaart { width: 100%; max-height: none; padding: 6px; border-radius: 10px; margin-bottom: auto; }
  .spel-info { overflow: visible; }
}
@media (max-width: 820px), (pointer: coarse) {
  .spel-kop { margin-bottom: 4px; }
  .spel-kop h2 { font-size: .9rem; }
  .spel-info { margin-top: 6px; }
  .spel-beste { margin-bottom: 2px; }
  .spel-skins { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; margin: 4px 0; padding-bottom: 2px; -webkit-overflow-scrolling: touch; }
  .spel-skin { flex: 0 0 auto; min-width: 72px; padding: 4px 6px; }
}
@media (pointer: coarse) {
  #spel-overlay { padding: 4px 3%; touch-action: none; -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
  #spel-overlay[data-status="bezig"] .spel-info { display: none; }
  #spel-overlay[data-status="bezig"] .spel-knop { display: flex; }
  .spel-aanraakhint { display: block; color: var(--muted); font-size: .8rem; margin-top: 6px; }
}
@media (max-width: 820px) and (orientation: portrait), (pointer: coarse) and (orientation: portrait) {
  .spel-draai { display: block; text-align: center; color: var(--muted); font-size: .8rem; margin: 4px 0 0; }
}
/* Liggend op een telefoon: het canvas past in de hoogte onder de balken (3 : 1); tijdens het spel laat het ruimte voor de knoppen links en rechts. */
@media (max-width: 820px) and (orientation: landscape) and (max-height: 560px), (pointer: coarse) and (orientation: landscape) and (max-height: 560px) {
  .spel-veld canvas { width: min(100%, calc((100vh - var(--spel-top, 52px) - 46px) * 3)); margin: 0 auto; }
  #spel-overlay[data-status="bezig"] .spel-veld canvas { width: min(calc(100% - 192px), calc((100vh - var(--spel-top, 52px) - 46px) * 3)); }
  .spel-kop { margin-bottom: 2px; }
}
`;

let overlay = null;
let spel = null;
let voortgang = null;
let afhHuidig = { actieveEvenementen: () => [] };
let afmeld = null;
let modus = 'start'; // 'start' | 'bezig' | 'pauze' | 'af'
let melding = '';
let hint = null;

const el = (tag, eigenschappen = {}, ...kinderen) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschappen)) {
    if (k === 'tekst') e.textContent = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v);
  }
  e.append(...kinderen);
  return e;
};

const skinVan = (id) => SKINS.find(s => s.id === id) ?? SKINS.find(s => s.id === standaardSkin()) ?? SKINS[0];
const isOpen = () => Boolean(overlay) && overlay.classList.contains('open');
const verminderd = () => { try { return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function zetModus(nieuw) {
  modus = nieuw;
  overlay.dataset.status = nieuw;
  const info = overlay.querySelector('.spel-info');
  info.hidden = nieuw === 'bezig';
  info.querySelector('[data-actie="spel-start"]').textContent = nieuw === 'af' ? 'Opnieuw' : nieuw === 'pauze' ? 'Verder' : 'Start';
  info.querySelector('.spel-melding').textContent = nieuw === 'pauze' ? 'Gepauzeerd' : melding;
  tekenInfo();
}

function tekenInfo() {
  const v = voortgang.huidig();
  overlay.querySelector('.spel-beste').textContent = `Beste score: ${v.besteScore}`;
  const rij = overlay.querySelector('.spel-skins');
  rij.replaceChildren(...SKINS.map((s) => {
    const open = v.ontgrendeld.includes(s.id);
    const knop = el('button', {
      type: 'button', class: 'spel-skin', 'aria-pressed': String(v.gekozenSkin === s.id), dataset: { actie: 'spel-skin', arg: s.id },
    },
    el('i', { style: `background:${s.behuizing}` }, el('b', { style: `background:${s.faceplate}` })),
    el('span', { tekst: s.naam }),
    el('small', { tekst: open ? (v.gekozenSkin === s.id ? 'gekozen' : 'ontgrendeld') : ontgrendelVoorwaarde(s) }));
    if (!open) knop.disabled = true;
    knop.dataset.skin = s.id;
    return knop;
  }));
}

function begin() {
  if (!isOpen()) return;
  melding = '';
  zetModus('bezig');
  spel.start();
}

function bijEinde(score) {
  const r = voortgang.meld(score);
  melding = r.nieuweSkins.length
    ? `Nieuwe laadpaal ontgrendeld: ${r.nieuweSkins.map(i => skinVan(i).naam).join(', ')}`
    : r.nieuweBeste && score > 0 ? 'Nieuw record!' : '';
  overlay.dataset.score = String(score);
  zetModus('af');
  overlay.focus({ preventScroll: true });
}

function bouw() {
  const stijl = document.createElement('style');
  stijl.id = 'spel-stijl';
  stijl.textContent = CSS;
  document.head.append(stijl);

  const canvas = el('canvas', { width: String(WERELD.breedte), height: String(WERELD.hoogte), 'aria-label': 'Blitz Run: een spelletje met een laadpaal die over jerrycans springt en onder bliksems bukt' });
  hint = el('div', { class: 'spel-hint', tekst: 'Pijl omhoog of spatie: springen. Pijl omlaag: bukken (ingedrukt houden). Op een aanraakscherm: knop Springen rechtsonder, knop Bukken (ingedrukt houden) linksonder.' });
  overlay = el('div', { id: 'spel-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Blitz Run', tabindex: '-1' },
    el('button', { type: 'button', class: 'spel-knop spel-knop--bukken', 'aria-label': 'Bukken (ingedrukt houden)' }, el('span', { 'aria-hidden': 'true', tekst: '▼' }), el('span', { tekst: 'Bukken' })),
    el('button', { type: 'button', class: 'spel-knop spel-knop--springen', 'aria-label': 'Springen' }, el('span', { 'aria-hidden': 'true', tekst: '▲' }), el('span', { tekst: 'Springen' })),
    el('div', { class: 'spel-kaart' },
      el('div', { class: 'spel-kop' },
        el('h2', { tekst: '⚡ Blitz Run' }),
        el('button', { type: 'button', class: 'btn btn-icon btn--ghost', title: 'Sluiten', 'aria-label': 'Sluiten', tekst: '✕', dataset: { actie: 'spel-sluit' } })),
      el('div', { class: 'spel-veld' }, canvas),
      el('div', { class: 'spel-info' },
        el('div', { class: 'spel-melding', 'aria-live': 'polite' }),
        el('div', { class: 'spel-beste' }),
        el('div', { class: 'spel-skins', role: 'group', 'aria-label': 'Kies je laadpaal' }),
        el('button', { type: 'button', class: 'btn btn--primary', tekst: 'Start', dataset: { actie: 'spel-start' } }),
        el('div', { class: 'spel-aanraakhint', tekst: 'Rechtsonder: Springen. Linksonder: Bukken (ingedrukt houden).' }),
        el('div', { class: 'spel-draai', tekst: 'Draai je toestel voor een groter spel.' }),
        el('details', { class: 'spel-uitleg' }, el('summary', { tekst: 'Uitleg' }), hint))));
  document.body.append(overlay);
  // Op een smal scherm of met aanraking staat de uitleg ingeklapt, op een groot scherm open.
  try { overlay.querySelector('.spel-uitleg').open = !globalThis.matchMedia('(max-width: 820px), (pointer: coarse)').matches; } catch { /* open laten */ }

  const gebruiker = huidigeGebruiker();
  voortgang = maakVoortgang({
    api: apiVerzoek,
    opslag: { lees: (k) => globalThis.localStorage.getItem(k), schrijf: (k, v) => globalThis.localStorage.setItem(k, v) },
    gebruikerId: gebruiker?.id ?? 'anoniem',
    actieveEvenementen: (datum) => afhHuidig.actieveEvenementen(datum),
    bijWijziging: () => { if (overlay && modus !== 'bezig') tekenInfo(); },
  });
  spel = maakSpel({
    canvas, skin: () => skinVan(voortgang.huidig().gekozenSkin), verminderdeBeweging: verminderd(),
    bijScore: (s) => { overlay.dataset.score = String(s); }, bijEinde,
  });

  registreerActies(overlay, {
    'spel-sluit': () => sluit(),
    'spel-start': () => { if (modus === 'pauze') { zetModus('bezig'); spel.hervat(); } else begin(); },
    'spel-skin': (knop, _e, id) => {
      if (voortgang.kiesSkin(id)) { tekenInfo(); spel.toonStil(); spel.teken(); }
      overlay.focus({ preventScroll: true }); // Spatie mag niet opnieuw op de skinknop landen
    },
  });
  registreerVenster({ el: overlay, isOpen, sluit: () => sluit() });

  // Aanraking: twee knoppen (Bukken links, ingehouden; Springen rechts) met pointer capture, dus meerdere vingers tegelijk. Een tik op het canvas
  // springt als extraatje; ergens anders tikken doet niets en bukt NOOIT.
  const knopBukken = overlay.querySelector('.spel-knop--bukken');
  const knopSpringen = overlay.querySelector('.spel-knop--springen');
  const houd = (knop, aan, uit) => {
    const los = () => { knop.classList.remove('is-ingedrukt'); uit?.(); };
    knop.addEventListener('pointerdown', (e) => {
      if (modus !== 'bezig') return;
      try { knop.setPointerCapture(e.pointerId); } catch { /* geen capture */ }
      knop.classList.add('is-ingedrukt');
      aan();
      e.preventDefault();
    });
    for (const naam of ['pointerup', 'pointercancel', 'lostpointercapture']) knop.addEventListener(naam, los);
    knop.addEventListener('contextmenu', (e) => e.preventDefault());
    knop.addEventListener('click', (e) => e.preventDefault());
  };
  houd(knopBukken, () => spel.bukken(true), () => spel.bukken(false));
  houd(knopSpringen, () => spel.spring());
  canvas.addEventListener('pointerdown', (e) => {
    if (modus !== 'bezig') return;
    spel.spring();
    e.preventDefault();
  });
  overlay.addEventListener('contextmenu', (e) => { if (e.target.closest('canvas, .spel-knop')) e.preventDefault(); });
}

// Toetsen: enkel zolang het overlay open is; Escape blijft voor venster.js (sluit).
function bijToets(e) {
  if (!isOpen() || e.key === 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
  const omlaag = e.type === 'keydown';
  const springt = e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Spacebar';
  const bukt = e.key === 'ArrowDown';
  if (!springt && !bukt) return;
  e.preventDefault(); // geen paginascroll, geen klik op een knop met de focus
  if (modus === 'bezig') { spel.toets(e, omlaag); return; }
  if (!omlaag || e.repeat || bukt) return;
  if (modus === 'pauze') { zetModus('bezig'); spel.hervat(); } else begin();
}

function bijZichtbaarheid() {
  if (!isOpen() || modus !== 'bezig') return;
  if (document.hidden) { spel.pauzeer(); zetModus('pauze'); }
}

// Scherp tekenen: het tekenvlak krijgt de weergegeven grootte in apparaatpixels (spel.js schaalt naar de logische wereld, de hitboxen blijven gelijk).
function pasCanvasAan() {
  const canvas = overlay?.querySelector('canvas');
  if (!canvas || !isOpen()) return;
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(3, devicePixelRatio || 1);
  const b = Math.max(WERELD.breedte, Math.min(2400, Math.round(r.width * dpr)));
  const h = Math.round(b * WERELD.hoogte / WERELD.breedte);
  if (canvas.width === b && canvas.height === h) return;
  canvas.width = b; canvas.height = h;
  if (modus !== 'bezig') spel.teken();
}

// Het overlay begint onder de sticky kop; die hoogte wijzigt bij draaien of schalen, dus ook herberekenen terwijl het open is.
function zetBovenkant() {
  const balk = document.querySelector('.topbar-sticky');
  overlay.style.setProperty('--spel-top', `${Math.max(0, Math.round(balk?.getBoundingClientRect().bottom ?? 52))}px`);
  pasCanvasAan();
}

export function openSpel(afh) {
  if (afh?.actieveEvenementen) afhHuidig = afh;
  if (!overlay) {
    try { bouw(); } catch (e) { // halfgebouwd: opruimen zodat een volgende poging schoon begint
      overlay?.remove(); document.getElementById('spel-stijl')?.remove();
      overlay = spel = voortgang = null;
      throw e;
    }
  }
  if (isOpen()) return;
  melding = '';
  overlay.classList.add('open');
  zetBovenkant();
  document.addEventListener('keydown', bijToets);
  document.addEventListener('keyup', bijToets);
  document.addEventListener('visibilitychange', bijZichtbaarheid);
  window.addEventListener('resize', zetBovenkant);
  window.addEventListener('orientationchange', zetBovenkant);
  const waarnemer = typeof ResizeObserver === 'function' ? new ResizeObserver(zetBovenkant) : null;
  const balk = document.querySelector('.topbar-sticky');
  if (balk) waarnemer?.observe(balk);
  waarnemer?.observe(overlay);
  afmeld = () => {
    waarnemer?.disconnect();
    window.removeEventListener('resize', zetBovenkant);
    window.removeEventListener('orientationchange', zetBovenkant);
    document.removeEventListener('keydown', bijToets);
    document.removeEventListener('keyup', bijToets);
    document.removeEventListener('visibilitychange', bijZichtbaarheid);
  };
  zetModus('start');
  spel.toonStil();
  // venster.js zet de focus op de eerste knop (✕); Spatie moet het spel starten, geen knop activeren.
  setTimeout(() => { if (isOpen()) overlay.focus({ preventScroll: true }); }, 0);
  voortgang.ververs().then(() => { if (isOpen() && modus !== 'bezig') { tekenInfo(); spel.toonStil(); } });
}

export function sluit() {
  if (!isOpen()) return;
  spel.stop(); // geen lus meer, geen terugroepers
  afmeld?.(); afmeld = null;
  overlay.classList.remove('open');
}

export function wisselSpel(afh) {
  if (isOpen()) sluit(); else openSpel(afh);
}
