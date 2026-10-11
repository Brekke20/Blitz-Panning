// schermen/sales-schil.js — de gedeelde schil van de vier sales-schermen: de view van de tab, het laden van de leads en de instellingen
// van de getoonde verkoper (die kiest de persoonskiezer in de kop), het ene abonnement per view en de foutmelding met "Opnieuw". Een scherm schrijft enkel `toon(view)`:
//   export const toon = (view) => startScherm(view, (inhoud) => { ...tekenen... }, { skelet: 'kaarten' });
// `skelet` is de vorm van het laadskelet (kern/skelet.js) dat de eerste keer, zolang er nog niets te tonen is, na 150 ms verschijnt.
// `toon` wordt door laadTab bij ELKE tabwissel aangeroepen en is dus idempotent (één abonnement per view, geen dubbele luisteraars).
// Alle id's en klassen in de sales-views dragen het voorvoegsel `sales-` (de beheerder heeft de ticket-schermen op dezelfde pagina).
// Sales-markup gebruikt nooit `.coord-only`, `.kal-actions` of `.cal-unplan-x` (die verbergt de rol "sales" net als "technieker").
import { onSalesWijziging, laadSales, laadInstellingen, resetSales, spoelUitgesteld } from './sales-data.js';
import { registreerAfmeldHaak, registreerVoorAfmeldHaak, huidigeGebruiker, huidigeRechten } from '../kern/sessie.js';
import { getoondeVerkoper, zorgVoorVerkopers, onVerkoperWijziging, VERKOPER_SLEUTEL } from './sales-verkoper.js';
import { OPSLAG_TEKST } from './sales-tekst.js';
import { toonSkelet } from '../kern/skelet.js';

export { OPSLAG_TEKST };
const LAAD_TEKST = 'De leads konden niet geladen worden.';
const VERKOPERS_TEKST = 'De lijst met verkopers kon niet geladen worden.';

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

const staten = new WeakMap(); // view -> { inhoud, geladen, aanvraag, keten, teken, afmelden, afmeldVerkoper, skelet, herlaad, verkopersOk }

function staatVan(view) {
  let s = staten.get(view);
  if (s) return s;
  const inhoud = document.createElement('div');
  inhoud.className = 'sales-inhoud';
  view.replaceChildren(inhoud);
  s = { inhoud, geladen: false, aanvraag: 0, keten: Promise.resolve(), teken: null, afmelden: null, afmeldVerkoper: null, skelet: null, herlaad: null, verkopersOk: true };
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
 * Start (of herstart) een sales-scherm in `view`: laad de leads en de instellingen van de getoonde verkoper en teken met
 * `teken(inhoud)`. Daarna hertekent elke wijziging van de sales-toestand (onSalesWijziging) het scherm. Idempotent per view.
 * Ladingen lopen na elkaar (een late lading van een vorige verkoper mag de toestand van de nieuwe niet overschrijven) en een lading die
 * al door een nieuwere is ingehaald, wordt overgeslagen.
 */
export async function startScherm(view, teken, { skelet: skeletVorm = 'rijen' } = {}) {
  const s = staatVan(view);
  s.teken = teken;
  // Het laadskelet: enkel zolang `inhoud` leeg is (eerste bezoek) en pas na 150 ms; staat er al inhoud, dan blijft die staan en ververst de lading stil.
  s.skelet?.stop();
  const mijnSkelet = toonSkelet(s.inhoud, { vorm: skeletVorm });
  s.skelet = mijnSkelet;
  const stopSkelet = () => { mijnSkelet.stop(); if (s.skelet === mijnSkelet) s.skelet = null; }; // een oudere aanroep stopt nooit het skelet van een nieuwere
  // Eén abonnement per view; het detailobject van de melding wordt genegeerd. Tekenen kan pas na de eerste lading (geen leeg-flits).
  if (!s.afmelden) s.afmelden = onSalesWijziging(() => { if (s.geladen) tekenVeilig(s); });

  const herlaad = () => {
    const mijn = ++s.aanvraag;
    s.keten = s.keten.then(() => laadEnTeken(mijn)).catch((fout) => { console.error('Sales laden mislukt:', fout); });
    return s.keten;
  };
  s.herlaad = herlaad;
  // De persoonskiezer in de kop koos een andere verkoper: het scherm dat nu open staat laadt zijn leads (de andere schermen laden bij het openen).
  if (!s.afmeldVerkoper) s.afmeldVerkoper = onVerkoperWijziging(() => { if (view.classList.contains('active')) herlaad(); });

  async function laadEnTeken(mijn) {
    if (mijn !== s.aanvraag) return;
    const v = getoondeVerkoper();
    if (!v.id) {
      stopSkelet();
      s.geladen = false;
      if (!s.verkopersOk) { // de lijst met verkopers kon niet geladen worden (beheerder): opnieuw proberen vraagt ze opnieuw op
        toonFout(s.inhoud, VERKOPERS_TEKST, async () => { s.verkopersOk = await zorgVoorVerkopers({ ververs: true }); herlaad(); });
        return;
      }
      const p = document.createElement('p');
      p.className = 'sales-leeg';
      p.textContent = 'Geen actieve verkopers gevonden.';
      s.inhoud.replaceChildren(p);
      return;
    }
    const gebruikerId = v.id === huidigeGebruiker()?.id ? undefined : v.id; // de eigen blob heeft geen ?gebruiker= nodig
    const [leads] = await Promise.all([laadSales({ gebruikerId }), laadInstellingen({ gebruikerId })]);
    if (mijn !== s.aanvraag) return;
    stopSkelet(); // vóór het tekenen of de foutmelding: het skelet maakt altijd plaats
    if (!leads.ok) {
      s.geladen = false;
      toonFout(s.inhoud, leads.opslag ? OPSLAG_TEKST : LAAD_TEKST, herlaad);
      return;
    }
    s.geladen = true;
    tekenVeilig(s);
  }

  try {
    // Wie een verkoper kiest (beheerder, sales manager) heeft de lijst nodig vóór getoondeVerkoper() klopt; opnieuw gevraagd bij elke opening.
    if (huidigeRechten().alleSales) s.verkopersOk = await zorgVoorVerkopers({ ververs: true });
    await herlaad();
  } finally { stopSkelet(); } // ook als het laden of tekenen faalt: nooit een skelet laten staan
}
