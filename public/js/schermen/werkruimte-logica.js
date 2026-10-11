// schermen/werkruimte-logica.js — de werkruimtes van de beheerder (kop B, taak 2), als pure functies (geen DOM, de opslag wordt meegegeven).
// De beheerder werkt in één van twee werkruimtes: `techniek` (Wachtrij, Kalender, Route, Ingepland, Inventaris, Rapporten, Beheer) of `sales`
// (Leads, Kalender, Route, Afgewerkt, Beheer). Hij kiest ze via de persoonskiezer: een technieker of "Alle technici" = techniek, een verkoper = sales.
// Bij een wissel blijft hij op het gelijkaardige scherm (Route blijft Route, Kalender blijft Kalender): `omzetTab`.
// De keuze staat in localStorage `blitz_werkruimte`; kern/eigenaar.js wist ze bij afmelden en bij een andere gebruiker op hetzelfde toestel.

export const WERKRUIMTE_SLEUTEL = 'blitz_werkruimte';
export const TECHNIEK_TABS = Object.freeze(['tickets', 'kalender', 'planning', 'gepland', 'inventaris', 'rapporten']);
export const SALES_TAB_IDS = Object.freeze(['sales-lijst', 'sales-kalender', 'sales-route', 'sales-afgewerkt']);

/** De bewaarde werkruimte; alles behalve 'sales' (ook een ontbrekende of onbekende waarde) is 'techniek'. */
export function leesWerkruimte(opslag) {
  try { return opslag?.getItem(WERKRUIMTE_SLEUTEL) === 'sales' ? 'sales' : 'techniek'; } catch { return 'techniek'; }
}
export function bewaarWerkruimte(opslag, werkruimte) {
  try { opslag?.setItem(WERKRUIMTE_SLEUTEL, werkruimte === 'sales' ? 'sales' : 'techniek'); } catch { /* geen opslag */ }
}

// Techniek -> sales en sales -> techniek, zoals in het ontwerp (§2.3). Beheer verandert niet.
const NAAR_SALES = { tickets: 'sales-lijst', kalender: 'sales-kalender', planning: 'sales-route', gepland: 'sales-lijst', inventaris: 'sales-lijst', rapporten: 'sales-afgewerkt', beheer: 'beheer' };
const NAAR_TECHNIEK = { 'sales-lijst': 'tickets', 'sales-kalender': 'kalender', 'sales-route': 'planning', 'sales-afgewerkt': 'rapporten', beheer: 'beheer' };

/**
 * Welke tab hoort bij `tab` in de werkruimte `naar`? Een tab die al bij die werkruimte hoort blijft staan; een onbekende waarde (bv. de
 * vroegere hoofdtab "sales") wordt de eerste tab van de werkruimte. Op een gsm (`smal`) bestaat Route niet: dan wordt het de Kalender.
 */
export function omzetTab(tab, naar, { smal = false } = {}) {
  const sales = naar === 'sales';
  const eerste = sales ? 'sales-lijst' : 'tickets';
  const doelen = sales ? SALES_TAB_IDS : TECHNIEK_TABS;
  let doel;
  if (tab === 'beheer') doel = 'beheer';
  else if (doelen.includes(tab)) doel = tab;
  else doel = (sales ? NAAR_SALES : NAAR_TECHNIEK)[tab] || eerste;
  if (smal && doel === (sales ? 'sales-route' : 'planning')) return sales ? 'sales-kalender' : 'kalender';
  return doel;
}

/** Hoort de tab bij de werkruimte? (`beheer` hoort bij beide.) */
export function tabHoortBij(tab, werkruimte) {
  if (tab === 'beheer') return true;
  return (werkruimte === 'sales' ? SALES_TAB_IDS : TECHNIEK_TABS).includes(tab);
}
