// schermen/sales-schil.js — de gedeelde schil van de vier sales-schermen: de view van de tab, de verkoperbalk, het laden van de
// leads en de instellingen, het ene abonnement per view en de foutmelding met "Opnieuw". Een scherm schrijft enkel `toon(view)`:
//   export const toon = (view) => startScherm(view, (inhoud) => { ...tekenen... });
// `toon` wordt door laadTab bij ELKE tabwissel aangeroepen en is dus idempotent (één abonnement per view, geen dubbele luisteraars).
// Alle id's en klassen in de sales-views dragen het voorvoegsel `sales-` (de beheerder heeft de ticket-schermen op dezelfde pagina).
// Sales-markup gebruikt nooit `.coord-only`, `.kal-actions` of `.cal-unplan-x` (die verbergt de rol "sales" net als "technieker").
import { onSalesWijziging, laadSales, laadInstellingen, resetSales, spoelUitgesteld } from './sales-data.js';
import { registreerAfmeldHaak, registreerVoorAfmeldHaak, huidigeGebruiker } from '../kern/sessie.js';
import { renderVerkoperBalk, getoondeVerkoper, VERKOPER_SLEUTEL } from './sales-verkoper.js';
import { OPSLAG_TEKST } from './sales-tekst.js';

export { OPSLAG_TEKST };
const LAAD_TEKST = 'De leads konden niet geladen worden.';

// ---- afmelden (één keer, bij het laden van deze module) ----
// Vóór auth-uitloggen: nog te versturen (uitgestelde) verwijderingen versturen zolang de sessie bestaat (anders 401 en een inlogscherm
// midden in het afmelden). Daarna: de toestand leeg (de abonnees blijven) en de gekozen verkoper vergeten.
registreerVoorAfmeldHaak(() => spoelUitgesteld({ keepalive: false }));
registreerAfmeldHaak(() => {
  resetSales();
  try { globalThis.localStorage.removeItem(VERKOPER_SLEUTEL); } catch { /* geen opslag */ }
});

// ---- stijl en view ----

export function zorgVoorStijl() {
  if (document.querySelector('link[data-sales-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/sales.css';
  link.dataset.salesCss = '1';
  document.head.appendChild(link);
}

/** De view van de tab: de bestaande `<div class="view" id="view-<id>">` (pasRolToe maakt hem); ontbreekt hij, dan maken we hem in <main>. */
export function zorgVoorView(id) {
  zorgVoorStijl();
  let view = document.getElementById(`view-${id}`);
  if (!view) {
    view = document.createElement('div');
    view.className = 'view';
    view.id = `view-${id}`;
    view.setAttribute('role', 'tabpanel');
    view.setAttribute('aria-labelledby', `tab-${id}`);
    document.getElementById('hoofdinhoud')?.appendChild(view);
  }
  return view;
}

/** Een foutmelding in `doel` (een view of een inhoudsvak), met een knop Opnieuw als `opnieuw` een functie is. */
export function toonFout(doel, tekst, opnieuw) {
  const blok = document.createElement('div');
  blok.className = 'sales-fout';
  blok.setAttribute('role', 'alert');
  const p = document.createElement('p');
  p.textContent = tekst;
  blok.appendChild(p);
  if (opnieuw instanceof Function) {
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'btn-sec sales-opnieuw';
    knop.textContent = 'Opnieuw';
    knop.addEventListener('click', () => opnieuw());
    blok.appendChild(knop);
  }
  doel.replaceChildren(blok);
}

// ---- het scherm opstarten ----

const staten = new WeakMap(); // view -> { balk, inhoud, geladen, aanvraag, keten, teken, afmelden }

function staatVan(view) {
  let s = staten.get(view);
  if (s) return s;
  const balk = document.createElement('div');
  balk.className = 'sales-balk';
  const inhoud = document.createElement('div');
  inhoud.className = 'sales-inhoud';
  view.replaceChildren(balk, inhoud);
  s = { balk, inhoud, geladen: false, aanvraag: 0, keten: Promise.resolve(), teken: null, afmelden: null };
  staten.set(view, s);
  return s;
}

function tekenVeilig(s) {
  try { s.teken(s.inhoud); } catch (fout) {
    console.error('Sales-scherm tekenen mislukt:', fout);
    toonFout(s.inhoud, 'Het scherm kon niet getekend worden.');
  }
}

/**
 * Start (of herstart) een sales-scherm in `view`: verkoperbalk, laad de leads en de instellingen van de getoonde verkoper en teken met
 * `teken(inhoud)`. Daarna hertekent elke wijziging van de sales-toestand (onSalesWijziging) het scherm. Idempotent per view.
 * Ladingen lopen na elkaar (een late lading van een vorige verkoper mag de toestand van de nieuwe niet overschrijven) en een lading die
 * al door een nieuwere is ingehaald, wordt overgeslagen.
 */
export async function startScherm(view, teken) {
  const s = staatVan(view);
  s.teken = teken;
  // Eén abonnement per view; het detailobject van de melding wordt genegeerd. Tekenen kan pas na de eerste lading (geen leeg-flits).
  if (!s.afmelden) s.afmelden = onSalesWijziging(() => { if (s.geladen) tekenVeilig(s); });

  const herlaad = () => {
    const mijn = ++s.aanvraag;
    s.keten = s.keten.then(() => laadEnTeken(mijn)).catch((fout) => { console.error('Sales laden mislukt:', fout); });
    return s.keten;
  };

  async function laadEnTeken(mijn) {
    if (mijn !== s.aanvraag) return;
    const v = getoondeVerkoper();
    if (!v.id) {
      s.geladen = false;
      const p = document.createElement('p');
      p.className = 'sales-leeg';
      p.textContent = 'Geen actieve verkopers gevonden.';
      s.inhoud.replaceChildren(p);
      return;
    }
    const gebruikerId = v.id === huidigeGebruiker()?.id ? undefined : v.id; // de eigen blob heeft geen ?gebruiker= nodig
    const [leads] = await Promise.all([laadSales({ gebruikerId }), laadInstellingen({ gebruikerId })]);
    if (mijn !== s.aanvraag) return;
    if (!leads.ok) {
      s.geladen = false;
      toonFout(s.inhoud, leads.opslag ? OPSLAG_TEKST : LAAD_TEKST, herlaad);
      return;
    }
    s.geladen = true;
    tekenVeilig(s);
  }

  await renderVerkoperBalk(s.balk, { onWijzig: () => { herlaad(); } });
  await herlaad();
}
