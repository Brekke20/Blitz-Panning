// spel/spel-ui.js — de overlay van "Blitz Run": startscherm (beste score, skinkeuze), het canvas en het eindscherm.
// Wordt pas geladen bij de eerste 5× tik op de titel (spel-opening.js). Schrijft nooit iets naar de planning: enkel /api/spel.
// Sluiten: 5× tikken op de titel, ✕ of Escape (registreerVenster). Het overlay laat de kop (met de titel) vrij, zodat 5× tikken ook sluit.
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
#spel-overlay { display: none; position: fixed; left: 0; right: 0; bottom: 0; top: var(--spel-top, 52px); z-index: 9000;
  background: rgba(0,0,0,.72); align-items: center; justify-content: center; padding: 12px; overflow: auto; }
#spel-overlay.open { display: flex; }
#spel-overlay:focus { outline: none; }
.spel-kaart { width: 100%; max-width: 720px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
.spel-kop { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.spel-kop h2 { margin: 0; font-size: 1rem; }
.spel-veld canvas { display: block; width: 100%; aspect-ratio: 3 / 1; border-radius: 8px; touch-action: none; user-select: none; -webkit-user-select: none; background: linear-gradient(${HEMEL.boven}, ${HEMEL.onder}); }
.spel-info { margin-top: 10px; text-align: center; }
.spel-info[hidden] { display: block; visibility: hidden; }
.spel-beste { font-weight: 600; margin-bottom: 6px; }
.spel-melding { min-height: 1.3em; color: var(--accent-ink, var(--accent)); font-weight: 600; margin-bottom: 4px; }
.spel-skins { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 8px 0; }
.spel-skin { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 84px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; font-size: .8rem; cursor: pointer; }
.spel-skin[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.spel-skin[disabled] { opacity: .55; cursor: not-allowed; }
.spel-skin small { color: var(--muted); }
.spel-skin i { display: block; width: 14px; height: 24px; border-radius: 2px; border: 1.5px solid ${RAND_KLEUR}; box-shadow: 0 0 0 1px rgba(0,0,0,.45); }
.spel-skin i b { display: block; width: 8px; height: 7px; margin: 2px 0 0 2px; }
.spel-hint { color: var(--muted); font-size: .78rem; margin-top: 6px; }
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
  hint = el('div', { class: 'spel-hint', tekst: 'Pijl omhoog of spatie: springen. Pijl omlaag: bukken (ingedrukt houden). Op een scherm: tik boven om te springen, houd onderaan om te bukken.' });
  overlay = el('div', { id: 'spel-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Blitz Run', tabindex: '-1' },
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
        hint)));
  document.body.append(overlay);

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

  // Aanraking: boven springen, onderen bukken (ingehouden).
  const wijzer = (omlaag) => (e) => {
    if (modus !== 'bezig') return;
    const r = canvas.getBoundingClientRect();
    spel.aanraak(e.clientY - r.top, r.height, omlaag);
    if (omlaag) { try { canvas.setPointerCapture(e.pointerId); } catch { /* geen capture */ } }
    e.preventDefault();
  };
  canvas.addEventListener('pointerdown', wijzer(true));
  canvas.addEventListener('pointerup', wijzer(false));
  canvas.addEventListener('pointercancel', wijzer(false));
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

// Het overlay begint onder de sticky kop; die hoogte wijzigt bij draaien of schalen, dus ook herberekenen terwijl het open is.
function zetBovenkant() {
  const balk = document.querySelector('.topbar-sticky');
  overlay.style.setProperty('--spel-top', `${Math.max(0, Math.round(balk?.getBoundingClientRect().bottom ?? 52))}px`);
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
  zetBovenkant();
  melding = '';
  overlay.classList.add('open');
  document.addEventListener('keydown', bijToets);
  document.addEventListener('keyup', bijToets);
  document.addEventListener('visibilitychange', bijZichtbaarheid);
  window.addEventListener('resize', zetBovenkant);
  window.addEventListener('orientationchange', zetBovenkant);
  afmeld = () => {
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
