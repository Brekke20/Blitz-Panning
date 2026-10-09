// schermen/sales-verkoper.js — wiens leads toont het scherm? De verkoper zelf zijn eigen leads; de beheerder en een sales-gebruiker met
// "mag alle sales zien" kiezen een verkoper uit een lijst (actieve verkopers, GET /api/gebruikers?rol=sales). De keuze blijft in
// localStorage 'blitz_sales_verkoper' (per toestel; kern/eigenaar.js en het afmelden wissen ze bij een andere gebruiker).
// Veiligheid: namen komen enkel via textContent in de DOM; de server beslist wie wat mag (sales-toegang), dit is enkel de weergave.
import { apiVerzoek } from '../kern/api.js';
import { huidigeGebruiker, heeftRol, huidigeRechten } from '../kern/sessie.js';
import { magSchrijven } from '../sales/toegang.js';
import { salesToestand } from './sales-data.js';

export const VERKOPER_SLEUTEL = 'blitz_sales_verkoper';

let lijstBelofte = null;  // belofte van de lijst actieve verkopers (null = nog niet gevraagd of mislukt)
let verkopers = [];       // [{ id, naam, salesNaam }] gesorteerd op naam; leeg zolang niet geladen

const bewaardeKeuze = () => { try { return globalThis.localStorage.getItem(VERKOPER_SLEUTEL); } catch { return null; } };
function bewaarKeuze(id) { try { globalThis.localStorage.setItem(VERKOPER_SLEUTEL, id); } catch { /* geen opslag */ } }

const naarVerkoper = (g) => ({ id: g.id, naam: g.naam ?? '', salesNaam: g.salesNaam || g.naam || '' });

// De lijst wordt één keer per paginasessie opgehaald; bij een fout probeert de volgende aanroep opnieuw.
function laadVerkopers() {
  if (!lijstBelofte) {
    lijstBelofte = (async () => {
      let r;
      try { r = await apiVerzoek('/api/gebruikers?rol=sales'); } catch { return false; }
      if (!r.ok || !Array.isArray(r.data?.gebruikers)) return false;
      verkopers = r.data.gebruikers.filter(g => g && typeof g.id === 'string').map(naarVerkoper)
        .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
      return true;
    })().then(ok => { if (!ok) lijstBelofte = null; return ok; });
  }
  return lijstBelofte;
}

/** Wie het scherm nu toont: { id, naam, salesNaam }. `id` is null als er niemand te tonen valt (beheerder zonder actieve verkopers). */
export function getoondeVerkoper() {
  const ik = huidigeGebruiker();
  if (!ik) return { id: null, naam: '', salesNaam: '' };
  const eigen = naarVerkoper(ik);
  if (!huidigeRechten().alleSales) return eigen;                           // gewone verkoper: enkel zichzelf
  const bewaard = bewaardeKeuze();
  const gekozen = verkopers.find(v => v.id === bewaard);
  if (gekozen) return gekozen;
  if (ik.rol === 'sales') return verkopers.find(v => v.id === ik.id) ?? eigen; // standaard: de eigen leads
  return verkopers[0] ?? { id: null, naam: '', salesNaam: '' };            // beheerder: de eerste verkoper
}

/** Mag de ingelogde gebruiker de nu geladen leads wijzigen? (beheerder: altijd; sales: enkel het eigen blob) */
export function schrijfbaarNu() { return magSchrijven(huidigeGebruiker(), salesToestand().gebruikerId); }

/** Importeren en de eigen instellingen: enkel een verkoper die zijn EIGEN leads toont (niet de beheerder, niet de weergave van een ander). */
export function kanImporteren() {
  const ik = huidigeGebruiker();
  return heeftRol('sales') && Boolean(ik) && getoondeVerkoper().id === ik.id;
}

/**
 * Tekent de verkoperbalk in `container` (leeg voor een gewone verkoper). De keuzelijst staat er enkel voor beheerder of sales met magAlleSales.
 * `onWijzig(gebruikerId, schrijfbaar)` na een keuze van de gebruiker. Wacht op de lijst, zodat `getoondeVerkoper()` daarna klopt.
 */
export async function renderVerkoperBalk(container, { onWijzig } = {}) {
  container.replaceChildren();
  const instellingen = maakInstellingenKnop();
  if (!huidigeRechten().alleSales) {
    if (kanImporteren()) container.appendChild(instellingen); // een gewone verkoper: enkel de instellingenknop
    return;
  }
  const ok = await laadVerkopers();
  container.replaceChildren();
  const ik = huidigeGebruiker();
  const getoond = getoondeVerkoper();

  const wrap = document.createElement('label');
  wrap.className = 'sales-verkoper';
  const tekst = document.createElement('span');
  tekst.className = 'sales-verkoper-label';
  tekst.textContent = 'Verkoper';
  const keuze = document.createElement('select');
  keuze.className = 'sales-verkoper-keuze';
  for (const v of verkopers) {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.naam + (ik && v.id === ik.id ? ' (jij)' : '');
    keuze.appendChild(o);
  }
  if (getoond.id) keuze.value = getoond.id;
  wrap.append(tekst, keuze);
  container.appendChild(wrap);

  if (!ok) {
    const melding = document.createElement('span');
    melding.className = 'sales-verkoper-fout';
    melding.textContent = 'De lijst met verkopers kon niet geladen worden.';
    container.appendChild(melding);
  }
  const leesMelding = document.createElement('span');
  leesMelding.className = 'sales-alleen-lezen';
  leesMelding.textContent = 'Alleen lezen';
  leesMelding.hidden = !getoond.id || magSchrijven(ik, getoond.id);
  container.appendChild(leesMelding);
  instellingen.hidden = !kanImporteren(); // enkel bij de eigen leads: niet bij de weergave van een collega
  container.appendChild(instellingen);

  keuze.addEventListener('change', () => {
    const id = keuze.value;
    bewaarKeuze(id);
    const schrijfbaar = magSchrijven(huidigeGebruiker(), id);
    leesMelding.hidden = schrijfbaar;
    instellingen.hidden = !kanImporteren();
    onWijzig?.(id, schrijfbaar);
  });
}

// De knop ⚙ Instellingen (enkel voor de verkoper die zijn eigen leads toont; de beheerder gebruikt Beheer > Instellingen).
// Het venster laadt lazy: sales-instellingen.js importeert zelf uit dit bestand.
function maakInstellingenKnop() {
  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'btn-sec sales-instellingen-knop';
  knop.textContent = '⚙ Instellingen';
  knop.addEventListener('click', () => { import('./sales-instellingen.js').then(m => m.openSalesInstellingen()); });
  return knop;
}

/** Enkel voor tests en het afmelden: de lijst vergeten. */
export function vergeetVerkopers() { lijstBelofte = null; verkopers = []; }
