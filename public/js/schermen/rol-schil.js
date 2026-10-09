// schermen/rol-schil.js — de app start pas na de login en past zich aan de rol van de gebruiker aan (logins T15).
// Dit is het registratiepunt van de rollen: hier staan de tabs per rol (kern/navigatie.js) en de eigen start van sales.
// Latere deelprojecten voegen hier één importregel toe (instellingen-sync, rolwisselaar, sales-planning, ...).
// Veiligheid: de rol verbergt enkel knoppen; de server beslist (rechtentabel). Namen komen enkel via textContent.
import './inloggen.js';                       // registreert de loginschermen bij kern/sessie.js (zetInlogUi)
import { toonGebruikersmenu } from './gebruikersmenu.js';
import { toonRolwisselaar } from './rolwisselaar.js';  // testmodus op een lokale dev-server: kies de rol (logins T19)
import { registreerTabs, tabsVoorRol, registreerStart, startVoorRol, zetActieveRol } from '../kern/navigatie.js';
import { laadSessie, huidigeGebruiker, registreerAfmeldHaak } from '../kern/sessie.js';
import { claimToestel, geefToestelVrij } from '../kern/eigenaar.js';
import { synchroniseerInstellingen, wisInstellingenCache } from '../kern/instellingen-sync.js';
import { toast } from '../kern/ui.js';

// De zes bestaande tabs van index.html (de knoppen `tab-<id>`): setTab laadt de inhoud zelf, dus er valt hier niets te laden.
const nietsTeLaden = async () => {};
const bestaand = (id, label) => ({ id, label, laad: nietsTeLaden });
const COORDINATOR_TABS = [
  bestaand('tickets', 'Wachtrij'), bestaand('kalender', 'Kalender'), bestaand('planning', 'Route'),
  bestaand('gepland', 'Ingepland'), bestaand('inventaris', 'Inventaris'), bestaand('rapporten', 'Rapporten'),
];

registreerTabs('planner', COORDINATOR_TABS);
registreerTabs('beheerder', [
  ...COORDINATOR_TABS,
  // Lazy: beheer*.js wordt pas geladen als de tab opent (geen modulepreload).
  { id: 'beheer', label: 'Beheer', laad: () => import('./beheer.js').then(m => m.openBeheer(document.getElementById('view-beheer'))) },
]);
// Technieker: zijn eigen rapporten (de server filtert) en collega's enkel lezen; geen wachtrij en geen route.
registreerTabs('technieker', [bestaand('kalender', 'Kalender'), bestaand('gepland', 'Ingepland'), bestaand('inventaris', 'Inventaris'), bestaand('rapporten', 'Rapporten')]);
// Sales: voorlopig een plaatshouder; de sales-planning registreert later haar eigen tabs en start.
registreerTabs('sales', []);
registreerStart('sales', toonSalesPlaceholder);

// Uitloggen: de gekozen persoon en de eigenaarsmarkering van dit toestel weg (kern/eigenaar.js); de rapportwachtrij blijft bewust staan.
registreerAfmeldHaak(() => geefToestelVrij(globalThis.localStorage, globalThis.sessionStorage));
// ... en de lokale instellingen-cache (blitz_settings*, laatste start, marker, vuil-markering): de server heeft ze, de volgende login haalt ze terug.
registreerAfmeldHaak(() => wisInstellingenCache(globalThis.localStorage));

function verberg(el) {
  if (!el) return;
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
}

// Een neutraal scherm voor sales: geen tabs, geen wachtrij en geen enkele aanroep van de planning-API's (de gewone
// opstart geeft voor sales 403's). Het gebruikersmenu staat al in de kop (pasRolToe).
export function toonSalesPlaceholder() {
  document.querySelector('nav[aria-label="Hoofdmenu"]')?.setAttribute('hidden', '');
  for (const sel of ['#person-sel', '[data-actie="vernieuw"]', '[data-actie="thema"]', '[data-actie="instellingen"]']) verberg(document.querySelector(sel));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const main = document.getElementById('hoofdinhoud');
  if (!main || document.getElementById('view-sales')) return;
  const scherm = document.createElement('section');
  scherm.id = 'view-sales';
  scherm.className = 'view active rol-placeholder';
  scherm.setAttribute('aria-labelledby', 'sales-titel');
  const titel = document.createElement('h2');
  titel.id = 'sales-titel';
  titel.textContent = 'Het sales-gedeelte volgt';
  const tekst = document.createElement('p');
  tekst.textContent = 'Je bent ingelogd. De sales-planning is nog niet beschikbaar in deze versie.';
  scherm.append(titel, tekst);
  main.appendChild(scherm);
}

// Een tab-knop en view voor een tab die index.html niet kent (bv. Beheer).
function maakTab(tab) {
  const balk = document.querySelector('.tabs-inner');
  const main = document.getElementById('hoofdinhoud');
  if (!balk || !main) return;
  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'tab';
  knop.id = `tab-${tab.id}`;
  knop.setAttribute('role', 'tab');
  knop.setAttribute('aria-selected', 'false');
  knop.setAttribute('aria-controls', `view-${tab.id}`);
  knop.tabIndex = -1;
  knop.dataset.actie = 'hoofdtab';
  knop.dataset.arg = tab.id;
  knop.textContent = tab.label;
  balk.appendChild(knop);
  if (!document.getElementById(`view-${tab.id}`)) {
    const view = document.createElement('div');
    view.className = 'view';
    view.id = `view-${tab.id}`;
    view.setAttribute('role', 'tabpanel');
    view.setAttribute('aria-labelledby', knop.id);
    main.appendChild(view);
  }
}

function zetTabZichtbaar(knop, zichtbaar) {
  knop.hidden = !zichtbaar;
  if (zichtbaar) knop.removeAttribute('aria-hidden'); else knop.setAttribute('aria-hidden', 'true');
  knop.tabIndex = zichtbaar && knop.classList.contains('active') ? 0 : -1;
}

// Past de pagina aan de rol aan: toestelrol, zichtbare tabs, rapporten voor de technieker, eigen persoon, gebruikersmenu.
export function pasRolToe(gebruiker) {
  const rol = gebruiker?.rol;
  zetActieveRol(rol);
  window.zetLoginRol?.(rol); // technieker en sales forceren het toestel-rolgedrag (apparaat.js)

  const tabs = tabsVoorRol(rol);
  const toegestaan = new Set(tabs.map(t => t.id));
  for (const t of tabs) if (!document.getElementById(`tab-${t.id}`)) maakTab(t);
  for (const knop of document.querySelectorAll('.tabs-inner .tab')) zetTabZichtbaar(knop, toegestaan.has(knop.id.replace(/^tab-/, '')));

  // Een technieker ziet Rapporten (enkel zijn eigen: de server filtert) op elk toestel; de rest van .coord-only blijft verborgen.
  document.getElementById('tab-rapporten')?.classList.toggle('coord-only', rol !== 'technieker');

  // Een technieker start op zijn eigen planning, tenzij hij al een bepaalde persoon gekozen had.
  if (rol === 'technieker' && gebruiker.zohoNaam) {
    try {
      const gekozen = localStorage.getItem('blitz_active_person');
      if (!gekozen || gekozen === 'all') localStorage.setItem('blitz_active_person', String(gebruiker.zohoNaam));
    } catch { /* geen opslag */ }
  }
  toonGebruikersmenu(gebruiker);
}

// Wacht op de login, past de rol toe en start dan de app: de eigen start van de rol, anders de gewone opstart.
export async function startNaInlog(opstart) {
  try {
    await laadSessie();
  } catch (fout) {
    console.error('Sessie laden mislukt:', fout);
    toast('Inloggen is niet gelukt. Herlaad de pagina.');
    return;
  }
  const gebruiker = huidigeGebruiker();
  if (!gebruiker) { console.warn('startNaInlog: geen gebruiker na de login; de app start niet'); return; }
  // Gedeeld toestel: staat van een vorige gebruiker (gekozen persoon, ticket-/planningcaches) eerst weg, vóór pasRolToe en de opstart.
  claimToestel(globalThis.localStorage, globalThis.sessionStorage, gebruiker.id);
  pasRolToe(gebruiker);
  toonRolwisselaar(); // enkel in ?test op een lokale dev-server; anders niets
  // Instellingen van de server in de lokale cache zetten (logins T16) vóór de app ze leest; faalt nooit hard: bij een fout start de app met de lokale cache.
  try { await synchroniseerInstellingen(gebruiker); } catch (fout) { console.warn('Instellingen synchroniseren mislukt; de lokale cache wordt gebruikt:', fout); }
  const start = startVoorRol(gebruiker.rol);
  if (start) start(); else opstart();
}
