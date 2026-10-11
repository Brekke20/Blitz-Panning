// schermen/persoonskiezer.js — het menu van de persoonskiezer in de kop (kop B, taak 1): tekent wat persoonskiezer-logica.js uitrekent.
// Eén module voor alle rollen: de gewone opstart (app.js) en de sales-start (sales-start.js) geven een `bron` mee met wat de rol weet
// (de namen uit de tickets, de gekozen persoon, de verkopers) en een `kies(item)` voor een keuze.
// Veiligheid: namen (Zoho-namen en gebruikersnamen) komen ENKEL via textContent in de DOM, nooit via innerHTML.
// Het menu is een lijst met knoppen: pijltjes op en neer, Home en End, Enter kiest, Escape sluit en zet de focus terug op de knop.
import { apiVerzoek } from '../kern/api.js';
import { huidigeGebruiker, huidigeRechten, eigenZohoNaam } from '../kern/sessie.js';
import { kiezerLijst, initialen } from './persoonskiezer-logica.js';

let bron = null;
let gebruikers = null;      // de volledige gebruikerslijst (enkel beheerder); null = nog niet (of niet) geladen
let verkopers = [];         // [{ id, naam, actief, salesManager }]
let verkopersFout = false;
let lijstenGevraagd = false;
let lijstenBelofte = null;

const wortel = () => document.getElementById('person-sel');
const knopEl = () => document.getElementById('person-btn');
const menuEl = () => document.getElementById('person-menu');

function el(tag, klasse, tekst) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}

/**
 * Koppelt de kiezer aan zijn omgeving.
 * bron = {
 *   ticketNamen: () => string[], gekozenTechnieker: () => string, gekozenVerkoper: () => string|null,
 *   werkruimte: () => 'techniek'|'sales', metSales: () => boolean,
 *   laadVerkopers: () => Promise<{ ok:boolean, lijst:{ id, naam, actief, salesManager }[] }>,   (beheerder en sales manager)
 *   verkopersNu?: () => lijst|null,  de huidige lijst verkopers (sales-schermen verversen ze bij het openen); anders de lijst van laadVerkopers
 *   kies: (item) => void,            een persoon of "Alle technici" of een verkoper gekozen
 *   terug: (sleutel) => void,        "↩ Terug naar techniekers"
 * }
 */
export function initPersoonskiezer(nieuweBron) {
  bron = nieuweBron;
}

/** Haalt de lijsten op die het menu nodig heeft (beheerder: gebruikers en verkopers; sales manager: verkopers); één keer, tot `ververs`. */
export function laadLijsten({ ververs = false } = {}) {
  if (!bron) return Promise.resolve();
  if (ververs) { lijstenGevraagd = false; lijstenBelofte = null; }
  if (lijstenGevraagd) return lijstenBelofte;
  const rechten = huidigeRechten();
  const salesManager = huidigeGebruiker()?.rol === 'sales' && rechten.alleSales;
  const nodig = [];
  if (rechten.beheer) nodig.push(laadGebruikers());
  if ((rechten.beheer && bron.metSales?.()) || salesManager) nodig.push(laadVerkopers());
  if (!nodig.length) return Promise.resolve();
  lijstenGevraagd = true;
  lijstenBelofte = Promise.all(nodig).then(() => {
    // Mislukte lading: de volgende opening (of ↺) probeert opnieuw, anders blijft de beheerder zonder Sales-groep tot een herlaadbeurt.
    if (verkopersFout || (rechten.beheer && gebruikers === null)) { lijstenGevraagd = false; lijstenBelofte = null; }
    bouwMenu(); werkKnopBij();
  });
  return lijstenBelofte;
}

async function laadGebruikers() {
  try {
    const r = await apiVerzoek('/api/gebruikers');
    gebruikers = r.ok && Array.isArray(r.data?.gebruikers) ? r.data.gebruikers.filter(g => g && typeof g === 'object') : null;
  } catch { gebruikers = null; }
}

async function laadVerkopers() {
  try {
    const r = await bron.laadVerkopers();
    verkopers = r.ok ? r.lijst : [];
    verkopersFout = !r.ok;
  } catch { verkopers = []; verkopersFout = true; }
}

/** Voor de beheerder: na een wijziging in Beheer > Gebruikers de lijsten opnieuw laten ophalen bij het volgende openen. */
export function vergeetLijsten() {
  lijstenGevraagd = false; lijstenBelofte = null; gebruikers = null; verkopers = []; verkopersFout = false;
}

/** De Zoho-namen van de accounts uit de (geladen) gebruikerslijst: een gekozen technieker zonder ticket mag niet als "onbekend" terugvallen op Alle. */
export function bekendeZohoNamen() {
  return (gebruikers || []).filter(g => g.rol !== 'sales' && typeof g.zohoNaam === 'string' && g.zohoNaam.trim()).map(g => g.zohoNaam.trim());
}

function huidigeLijst() {
  const g = huidigeGebruiker();
  return kiezerLijst({
    rol: g?.rol, rechten: huidigeRechten(), ticketNamen: bron.ticketNamen(), eigen: eigenZohoNaam(),
    gebruikers, verkopers: bron.verkopersNu?.() ?? verkopers, verkopersFout,
    werkruimte: bron.werkruimte(), gekozenTechnieker: bron.gekozenTechnieker(), gekozenVerkoper: bron.gekozenVerkoper(),
    ikId: g?.id ?? null, metSales: bron.metSales?.() ?? false,
  });
}

function maakItem(item) {
  const knop = el('button', 'pm-item' + (item.huidig ? ' active' : ''));
  knop.type = 'button';
  if (item.huidig) knop.setAttribute('aria-current', 'true');
  knop.dataset.soort = item.soort;
  knop.dataset.sleutel = item.sleutel;
  const info = el('div', 'pm-item-info');
  const naam = el('div', 'pm-item-name', item.naam + (item.jij ? ' (jij)' : ''));
  info.append(naam);
  if (item.sub) info.append(el('div', 'pm-item-sub' + (item.rolLabel ? ' pm-sub-rol' : ''), item.sub));
  knop.append(el('div', 'pm-avatar', initialen(item.soort === 'alle' ? 'all' : item.naam)), info);
  if (item.rolLabel) knop.append(el('span', 'pm-item-rol', [item.rolLabel, item.extra].filter(Boolean).join(' · ')));
  knop.addEventListener('click', () => { zetMenuOpen(false); bron.kies(item); });
  return knop;
}

/** Bouwt het menu opnieuw op uit de huidige toestand. Veilig om vaak aan te roepen (abonnee op de toestand). */
export function bouwMenu() {
  const menu = menuEl();
  if (!menu || !bron) return;
  const lijst = huidigeLijst();
  const kiezer = wortel();
  if (kiezer) kiezer.hidden = !lijst.zichtbaar;
  menu.replaceChildren();
  if (!lijst.zichtbaar) return;
  if (lijst.terug) {
    const terug = el('button', 'pm-item pm-terug', lijst.terug.tekst);
    terug.type = 'button';
    terug.addEventListener('click', () => { zetMenuOpen(false); bron.terug(lijst.terug.sleutel); });
    menu.append(terug);
  }
  for (const groep of lijst.groepen) {
    if (groep.titel) menu.append(el('div', 'pm-groep-titel', groep.titel));
    for (const item of groep.items) menu.append(maakItem(item));
  }
  if (lijst.melding) { const m = el('div', 'pm-melding', lijst.melding); m.setAttribute('role', 'status'); menu.append(m); }
}

/** Werkt de knop in de kop bij (icoon, "Planning:"/"Sales:", naam, werkruimte-kleur, titel en aria-label). */
export function werkKnopBij() {
  const knop = knopEl();
  if (!knop || !bron) return;
  const lijst = huidigeLijst();
  if (!lijst.zichtbaar || !lijst.knop) return;
  const k = lijst.knop;
  knop.querySelector('.person-icoon').textContent = k.icoon;
  knop.querySelector('.person-voor').textContent = k.voor;
  const naam = document.getElementById('person-name-hdr');
  if (naam) naam.textContent = k.naam;
  let alleenLezen = knop.querySelector('.person-lezen');
  if (k.leesalleen) {
    if (!alleenLezen) { alleenLezen = el('span', 'person-lezen', 'Alleen lezen'); knop.insertBefore(alleenLezen, knop.querySelector('.person-chevron')); }
  } else alleenLezen?.remove();
  knop.dataset.werkruimte = k.werkruimte;
  knop.title = k.titel;
  knop.setAttribute('aria-label', k.aria);
}

export function menuIsOpen() { return Boolean(menuEl()?.classList.contains('open')); }

export function zetMenuOpen(open, { focus = false } = {}) {
  const menu = menuEl();
  if (!menu) return;
  menu.classList.toggle('open', open);
  knopEl()?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    laadLijsten().catch(() => {});
    if (focus) (menu.querySelector('.pm-item.active') || menu.querySelector('.pm-item'))?.focus();
  }
}

/** Opent of sluit het menu; `focus`: ook de focus in het menu zetten (open via toetsenbord). */
export function toggleMenu({ focus = false } = {}) { zetMenuOpen(!menuIsOpen(), { focus }); }

// ---- luisteraars (één keer) ----
let gekoppeld = false;
export function koppelLuisteraars() {
  if (gekoppeld) return;
  gekoppeld = true;
  document.addEventListener('click', (e) => { if (!wortel()?.contains(e.target)) zetMenuOpen(false); });
  // Beheer > Gebruikers wijzigde een account (aangemaakt, geblokkeerd, van rol veranderd): de lijsten bij het volgende openen opnieuw vragen.
  document.addEventListener('blitz:gebruikers-gewijzigd', () => { vergeetLijsten(); });
  // Een sales-scherm laadde de lijst verkopers (opnieuw): menu en knop tonen die lijst.
  document.addEventListener('blitz:verkopers-geladen', () => { verkopersFout = false; bouwMenu(); werkKnopBij(); });
  document.addEventListener('keydown', (e) => {
    const menu = menuEl();
    if (!menu || !menuIsOpen()) return;
    if (e.key === 'Escape') {
      zetMenuOpen(false);
      knopEl()?.focus();
      return;
    }
    if (!wortel()?.contains(document.activeElement)) return;
    const items = [...menu.querySelectorAll('.pm-item')];
    if (!items.length) return;
    const nu = items.indexOf(document.activeElement);
    let nieuw = null;
    if (e.key === 'ArrowDown') nieuw = nu < 0 ? 0 : (nu + 1) % items.length;
    else if (e.key === 'ArrowUp') nieuw = nu < 0 ? items.length - 1 : (nu - 1 + items.length) % items.length;
    else if (e.key === 'Home') nieuw = 0;
    else if (e.key === 'End') nieuw = items.length - 1;
    if (nieuw === null) return;
    e.preventDefault();
    items[nieuw].focus();
  });
}
