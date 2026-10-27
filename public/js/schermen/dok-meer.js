// schermen/dok-meer.js — "Meer" in het dok (Open dag, taak 6).
// Op `smal` (gsm) en `tablet-staand` staat de tabbalk als dok onderaan. Zijn er meer dan 5 zichtbare tabs, dan blijven de eerste 4 in het
// dok en gaat de rest achter "Meer" (.dok-meer): een knop die een glazen blad (#dok-meer-overlay) opent met een knop per overig tabblad.
// - De echte .tab-knoppen blijven in .tabs-inner staan (geen verplaatsing, geen kopie met dezelfde id): de overtollige krijgen enkel de
//   klasse `tab--in-meer` (css/navigatie.css verbergt ze in het dok); de bladknoppen klikken `#tab-<id>` door.
// - .dok-meer is geen .tab en staat buiten .tabs-inner: de app-schil telt `.tab.active` en loopt met de pijltjestoetsen over de .tab-knoppen.
// - Op `breed` (zijkolom) gebeurt er niets: geen klasse, Meer blijft verborgen.
// De verdeling zelf is puur (dok-meer-logica.js). Herberekend bij elke wijziging van de tabs (hidden, class: ook een rolwissel of de
// werkruimtewissel van de beheerder in rol-schil.js), van de indeling/rol op <html> en bij `apparaatwijziging`.
// De labels komen uit de DOM (textContent) en worden met textContent gezet; het icoon is een vaste constante uit kern/tab-iconen.js.
import { dokVerdeling } from './dok-meer-logica.js';
import { registreerVenster } from '../venster.js';
import { registreerBackdrop } from '../kern/ui.js';
import { tabIcoonSvg } from '../kern/tab-iconen.js';

const DOK_INDELINGEN = new Set(['smal', 'tablet-staand']);
const MAX_IN_DOK = 5;

let balk = null;     // .tabs-inner
let meerKnop = null; // .dok-meer
let overlay = null;  // #dok-meer-overlay
let blad = null;     // .dok-meer-blad
let waarnemer = null;
let gepland = false;

const isOpen = () => !!overlay && overlay.classList.contains('open');

function sluit() {
  if (!overlay) return;
  overlay.classList.remove('open');
  meerKnop?.setAttribute('aria-expanded', 'false');
}

function open() {
  if (!overlay || !meerKnop || meerKnop.hidden) return;
  vulBlad();
  overlay.classList.add('open');
  meerKnop.setAttribute('aria-expanded', 'true');
}

// Het label van een tab zonder de teller en het icoon.
function labelVan(knop) {
  const kloon = knop.cloneNode(true);
  for (const x of kloon.querySelectorAll('.badge, svg')) x.remove();
  return kloon.textContent.replace(/\s+/g, ' ').trim();
}

// Eén knop per tab achter "Meer"; leest de actuele staat (klasse, teller) van de echte tab. Gevuld bij elke herberekening en bij het openen.
function vulBlad() {
  if (!blad || !balk) return;
  const items = [...balk.querySelectorAll('.tab.tab--in-meer')];
  blad.replaceChildren();
  for (const tab of items) {
    const id = tab.id.replace(/^tab-/, '');
    const actief = tab.classList.contains('active');
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'dok-meer-item' + (actief ? ' actief' : '');
    knop.dataset.tab = id;
    if (actief) knop.setAttribute('aria-current', 'true');
    knop.insertAdjacentHTML('afterbegin', tabIcoonSvg(tab.dataset.arg || id));
    const tekst = document.createElement('span');
    tekst.className = 'dok-meer-item-naam';
    tekst.textContent = labelVan(tab);
    knop.append(tekst);
    // De teller van de echte tab (bv. de voorraadteller van Inventaris), als die zichtbaar is.
    const teller = tab.querySelector('.badge');
    if (teller && teller.textContent.trim() && getComputedStyle(teller).display !== 'none') {
      const kopie = document.createElement('span');
      kopie.className = teller.className;
      kopie.textContent = teller.textContent;
      knop.append(kopie);
    }
    blad.append(knop);
  }
}

function herbereken() {
  gepland = false;
  if (!balk || !meerKnop) return;
  const alle = [...balk.querySelectorAll('.tab')];
  for (const t of alle) t.classList.remove('tab--in-meer');
  const dok = DOK_INDELINGEN.has(document.documentElement.getAttribute('data-indeling'));
  const zichtbaar = dok ? alle.filter(t => !t.hidden && t.offsetParent !== null) : [];
  const actief = zichtbaar.find(t => t.classList.contains('active'));
  const { inMeer, meerActief } = dokVerdeling(zichtbaar.map(t => t.id), actief ? actief.id : null, MAX_IN_DOK);
  for (const id of inMeer) document.getElementById(id)?.classList.add('tab--in-meer');
  meerKnop.hidden = inMeer.length === 0;
  meerKnop.classList.toggle('actief', meerActief);
  if (meerActief) meerKnop.setAttribute('aria-current', 'true'); else meerKnop.removeAttribute('aria-current');
  if (!inMeer.length && isOpen()) sluit();
  vulBlad();
  waarnemer?.takeRecords(); // de eigen klassewijzigingen hierboven zijn geen aanleiding voor een nieuwe ronde
}

// Meerdere wijzigingen in één keer (rol-schil.js zet alle tabs na elkaar) leveren één herberekening op.
function plan() {
  if (gepland) return;
  gepland = true;
  queueMicrotask(herbereken);
}

export function initDokMeer() {
  balk = document.querySelector('.tabs-inner');
  meerKnop = document.querySelector('.dok-meer');
  overlay = document.getElementById('dok-meer-overlay');
  blad = overlay?.querySelector('.dok-meer-blad') ?? null;
  if (!balk || !meerKnop || !overlay || !blad) return;

  if (!meerKnop.querySelector('.tab-icoon')) meerKnop.insertAdjacentHTML('afterbegin', tabIcoonSvg('meer'));
  meerKnop.addEventListener('click', () => (isOpen() ? sluit() : open()));
  blad.addEventListener('click', (e) => {
    const knop = e.target.closest('.dok-meer-item');
    if (!knop) return;
    sluit();
    document.getElementById('tab-' + knop.dataset.tab)?.click(); // de echte tab doet het werk (setTab, aria-selected, scherm laden)
  });
  registreerBackdrop(overlay, sluit);
  registreerVenster({ el: overlay, sluit, terugFocus: () => meerKnop });

  waarnemer = new MutationObserver(plan);
  waarnemer.observe(balk, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  // Indeling, rol en schil staan op <html>: een rolwissel of het vrijgeven van de schil verandert wat zichtbaar is zonder dat een tab wijzigt.
  new MutationObserver(plan).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-indeling', 'data-rol', 'data-plan-eigen', 'data-schil'],
  });
  window.addEventListener('apparaatwijziging', plan);
  window.addEventListener('resize', plan); // de zichtbaarheid (offsetParent) kan met de breedte wisselen
  herbereken();
}
