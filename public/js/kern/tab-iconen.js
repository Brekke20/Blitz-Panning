// kern/tab-iconen.js — één register van tab-id naar icoon (Open dag, taak 5). Dekt de vaste tabs van index.html en de tabs die
// schermen/rol-schil.js (Beheer) en schermen/sales-registratie.js (sales) aanmaken. De iconen komen uit de mockup
// (docs/superpowers/specs/assets/2026-10-27-open-dag-mockup.html: #i-wachtrij, #i-kalender, ...), lijnstijl 1,8, kleur = currentColor.
// Het icoon is decoratief (aria-hidden, niet focusbaar, geen tekst): de tekst van de tab blijft de toegankelijke naam en textContent.
// Puur (geen DOM op moduleniveau); `zetTabIconen` krijgt de wortel mee. De paden zijn vaste constanten, nooit gebruikersinvoer.

const PADEN = {
  tickets: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  kalender: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  planning: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
  gepland: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18M9 15.5l2 2 4-4"/>',
  inventaris: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  rapporten: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4"/>',
  beheer: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  // Leads: een lijst met een persoon ernaast
  'sales-lijst': '<path d="M3 6h10M3 12h7M3 18h5"/><circle cx="17" cy="10" r="3"/><path d="M12 20a5 5 0 0 1 10 0"/>',
  // Afgewerkt: een vinkje in een cirkel
  'sales-afgewerkt': '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 9.8"/>',
};
// Meer (drie puntjes): geen tab maar de knop van het dok (schermen/dok-meer.js); daarom niet in ICOON_IDS.
PADEN.meer = '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>';
PADEN['sales-kalender'] = PADEN.kalender;
PADEN['sales-route'] = PADEN.planning;

// Een tab die (nog) geen eigen icoon heeft: een neutraal rondje, zodat de opmaak (icoon boven of naast de naam) klopt.
const NEUTRAAL = '<circle cx="12" cy="12" r="4"/>';

export const ICOON_IDS = ['tickets', 'kalender', 'planning', 'gepland', 'inventaris', 'rapporten', 'beheer',
  'sales-lijst', 'sales-kalender', 'sales-route', 'sales-afgewerkt'];

/** De inline SVG van het icoon van tab `id` (een onbekende id geeft een neutraal rondje). */
export function tabIcoonSvg(id) {
  const pad = Object.hasOwn(PADEN, id) ? PADEN[id] : NEUTRAAL;
  return '<svg class="tab-icoon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + pad + '</svg>';
}

/** Zet het icoon als eerste kind in elke `.tab[data-arg]` onder `wortel` die er nog geen heeft (idempotent). */
export function zetTabIconen(wortel) {
  if (!wortel?.querySelectorAll) return;
  for (const knop of wortel.querySelectorAll('.tab[data-arg]')) {
    if (knop.querySelector('.tab-icoon')) continue;
    knop.insertAdjacentHTML('afterbegin', tabIcoonSvg(knop.dataset.arg));
  }
}
