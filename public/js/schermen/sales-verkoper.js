// schermen/sales-verkoper.js — wiens leads toont het scherm? De verkoper zelf zijn eigen leads; de beheerder en een sales-gebruiker met
// "mag alle sales zien" kiezen een verkoper in de persoonskiezer van de kop (schermen/persoonskiezer.js; kop B): de lijst komt uit
// GET /api/gebruikers?rol=sales (de beheerder ziet ook de geblokkeerde verkopers, enkel om te lezen). De keuze blijft in
// localStorage 'blitz_sales_verkoper' (per toestel; kern/eigenaar.js en het afmelden wissen ze bij een andere gebruiker);
// `kiesVerkoper(id)` bewaart ze en meldt ze aan de schermen (`onVerkoperWijziging`), die dan de leads van die verkoper laden.
// Veiligheid: namen komen enkel via textContent in de DOM; de server beslist wie wat mag (sales-toegang), dit is enkel de weergave.
import { apiVerzoek } from '../kern/api.js';
import { huidigeGebruiker, heeftRol, huidigeRechten } from '../kern/sessie.js';
import { magSchrijven } from '../sales/toegang.js';
import { salesToestand } from './sales-data.js';

export const VERKOPER_SLEUTEL = 'blitz_sales_verkoper';

let lijstBelofte = null;  // belofte van de lijst actieve verkopers (null = nog niet gevraagd of mislukt)
let verkopers = [];       // [{ id, naam, salesNaam, actief }] gesorteerd op naam; leeg zolang niet geladen

const bewaardeKeuze = () => { try { return globalThis.localStorage.getItem(VERKOPER_SLEUTEL); } catch { return null; } };
function bewaarKeuze(id) { try { globalThis.localStorage.setItem(VERKOPER_SLEUTEL, id); } catch { /* geen opslag */ } }

const naarVerkoper = (g) => ({ id: g.id, naam: g.naam ?? '', salesNaam: g.salesNaam || g.naam || '', actief: g.actief !== false, salesManager: g.magAlleSales === true });

// De lijst wordt hergebruikt tot een sales-scherm opent (startScherm vraagt ze dan opnieuw, `ververs`); bij een fout probeert de volgende aanroep opnieuw.
function laadVerkopers() {
  if (!lijstBelofte) {
    lijstBelofte = (async () => {
      let r;
      try { r = await apiVerzoek('/api/gebruikers?rol=sales' + (huidigeRechten().beheer ? '&geblokkeerd=1' : '')); } catch { return false; }
      if (!r.ok || !Array.isArray(r.data?.gebruikers)) return false;
      verkopers = r.data.gebruikers.filter(g => g && typeof g.id === 'string').map(naarVerkoper)
        .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
      try { globalThis.document?.dispatchEvent(new CustomEvent('blitz:verkopers-geladen')); } catch { /* geen document */ } // de persoonskiezer in de kop tekent zich opnieuw
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
  return verkopers.find(v => v.actief) ?? verkopers[0] ?? { id: null, naam: '', salesNaam: '' }; // beheerder: de eerste (actieve) verkoper
}

// Schrijven kan als de rol het toelaat (toegang.js) en de verkoper niet geblokkeerd is: de leads van een geblokkeerde verkoper zijn enkel te lezen.
const schrijfbaarVoor = (id) => magSchrijven(huidigeGebruiker(), id) && verkopers.find(v => v.id === id)?.actief !== false;

/** Mag de ingelogde gebruiker de nu geladen leads wijzigen? (beheerder: elke actieve verkoper; sales: enkel het eigen blob) */
export function schrijfbaarNu() { return schrijfbaarVoor(salesToestand().gebruikerId); }

/** Importeren en de eigen instellingen: enkel een verkoper die zijn EIGEN leads toont (niet de beheerder, niet de weergave van een ander). */
export function kanImporteren() {
  const ik = huidigeGebruiker();
  return heeftRol('sales') && Boolean(ik) && getoondeVerkoper().id === ik.id;
}

/** "+ Lead": de verkoper bij zijn eigen leads, of de beheerder bij een geselecteerde, niet geblokkeerde verkoper (de server dwingt dat af). */
export function kanLeadToevoegen() {
  if (kanImporteren()) return true;
  const id = getoondeVerkoper().id;
  return heeftRol('beheerder') && Boolean(id) && schrijfbaarVoor(id);
}

/**
 * Zorgt dat de lijst verkopers geladen is (enkel nodig voor wie een verkoper kiest: beheerder en sales manager) en geeft terug of dat gelukt is.
 * `ververs`: de lijst opnieuw vragen (elke keer dat een sales-scherm opent: de beheerder kan intussen in Beheer > Gebruikers een verkoper hebben
 * aangemaakt of geblokkeerd, acceptatietest S7). Eén kleine GET; de oude lijst blijft staan tot het antwoord er is.
 */
export async function zorgVoorVerkopers({ ververs = false } = {}) {
  if (!huidigeRechten().alleSales) return true;
  if (ververs) lijstBelofte = null;
  return laadVerkopers();
}

/** De geladen verkopers (kopie): [{ id, naam, salesNaam, actief, salesManager }] op naam. Leeg zolang niet geladen. */
export function lijstVerkopers() { return verkopers.map(v => ({ ...v })); }

// ---- de keuze ----
const luisteraars = new Set();

/** Meldt `fn(id)` aan voor elke keuze van een verkoper (de persoonskiezer); geeft de afmeldfunctie terug. */
export function onVerkoperWijziging(fn) {
  luisteraars.add(fn);
  return () => { luisteraars.delete(fn); };
}

/** Bewaart de gekozen verkoper en laat de sales-schermen die verkoper laden. */
export function kiesVerkoper(id) {
  if (typeof id !== 'string' || id === '') return;
  bewaarKeuze(id);
  for (const fn of [...luisteraars]) { try { fn(id); } catch { /* een luisteraar mag de keuze niet breken */ } }
}

/** Enkel voor tests en het afmelden: de lijst vergeten. */
export function vergeetVerkopers() { lijstBelofte = null; verkopers = []; }
