// schermen/rol-schil.js — de app start pas na de login en past zich aan de rol van de gebruiker aan (logins T15).
// Dit is het registratiepunt van de rollen: hier staan de tabs per rol (kern/navigatie.js); de sales-planner registreert zijn tabs en start via sales-registratie.js.
// Latere deelprojecten voegen hier één importregel toe (instellingen-sync, rolwisselaar, sales-planning, ...).
// Veiligheid: de rol verbergt enkel knoppen; de server beslist (rechtentabel). Namen komen enkel via textContent.
import './inloggen.js';                       // registreert de loginschermen bij kern/sessie.js (zetInlogUi)
import { toonGebruikersmenu } from './gebruikersmenu.js';
import { toonRolwisselaar } from './rolwisselaar.js';  // testmodus op een lokale dev-server: kies de rol (logins T19)
import { registreerTabs, tabsVoorRol, registreerStart, startVoorRol, zetActieveRol } from '../kern/navigatie.js';
import { laadSessie, huidigeGebruiker, huidigeRechten, registreerAfmeldHaak, laatsteOpstartNetwerkMs, eigenZohoNaam } from '../kern/sessie.js';
import { claimToestel, geefToestelVrij } from '../kern/eigenaar.js';
import { synchroniseerInstellingen, wisInstellingenCache, resterendSyncBudget } from '../kern/instellingen-sync.js';
import { toast } from '../kern/ui.js';
import { registreerSalesRol } from './sales-registratie.js';

// De zes bestaande tabs van index.html (de knoppen `tab-<id>`): setTab laadt de inhoud zelf, dus er valt hier niets te laden.
const nietsTeLaden = async () => {};
const bestaand = (id, label) => ({ id, label, laad: nietsTeLaden });
const COORDINATOR_TABS = [
  bestaand('tickets', 'Wachtrij'), bestaand('kalender', 'Kalender'), bestaand('planning', 'Route'),
  bestaand('gepland', 'Ingepland'), bestaand('inventaris', 'Inventaris'), bestaand('rapporten', 'Rapporten'),
];

// Lazy: beheer*.js wordt pas geladen als de tab opent (geen modulepreload). Welke subtabs iemand ziet, bepaalt beheer.js per rol
// (beheerder: alles; planner en sales manager: enkel Instellingen en Performance); de server beslist wat echt mag.
const BEHEER_TAB = { id: 'beheer', label: 'Beheer', laad: () => import('./beheer.js').then(m => m.openBeheer(document.getElementById('view-beheer'))) };
registreerTabs('planner', [...COORDINATOR_TABS, BEHEER_TAB]);
registreerTabs('beheerder', [...COORDINATOR_TABS, BEHEER_TAB]);
// Een sales manager (sales + "Sales manager"-vinkje, magAlleSales) krijgt de tab Beheer bovenop zijn vier sales-tabs.
registreerTabs('sales-manager', [BEHEER_TAB]);
// Technieker: zijn eigen rapporten (de server filtert) en collega's enkel lezen; geen wachtrij en geen route.
registreerTabs('technieker', [bestaand('kalender', 'Kalender'), bestaand('gepland', 'Ingepland'), bestaand('inventaris', 'Inventaris'), bestaand('rapporten', 'Rapporten')]);
// Een technieker met het vinkje "Mag zelf plannen" krijgt er de Wachtrij en de Route bij (enkel voor zijn eigen tickets; de server dwingt dat af).
registreerTabs('technieker-plan-eigen', [bestaand('tickets', 'Wachtrij'), bestaand('planning', 'Route')]);
// Sales: de tabs en de start van de sales-planner (en de sales-tabs van de beheerder) staan in sales-registratie.js; de tabs VOEGEN toe.
registreerTabs('sales', []);
registreerSalesRol({ registreerTabs, registreerStart });

// Uitloggen: de gekozen persoon en de eigenaarsmarkering van dit toestel weg (kern/eigenaar.js); de rapportwachtrij blijft bewust staan.
registreerAfmeldHaak(() => geefToestelVrij(globalThis.localStorage, globalThis.sessionStorage));
// ... en de lokale instellingen-cache (blitz_settings*, laatste start, marker, vuil-markering): de server heeft ze, de volgende login haalt ze terug.
registreerAfmeldHaak(() => wisInstellingenCache(globalThis.localStorage));

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
  const salesManager = rol === 'sales' && gebruiker?.magAlleSales === true;
  zetActieveRol(rol, salesManager ? ['sales-manager'] : []);
  const planEigen = huidigeRechten().planEigen === true;
  window.zetLoginRol?.(rol, { planEigen }); // technieker en sales forceren het toestel-rolgedrag (apparaat.js)

  const tabs = [...tabsVoorRol(rol), ...(planEigen ? tabsVoorRol('technieker-plan-eigen') : []), ...(salesManager ? tabsVoorRol('sales-manager') : [])];
  const toegestaan = new Set(tabs.map(t => t.id));
  for (const t of tabs) if (!document.getElementById(`tab-${t.id}`)) maakTab(t);
  for (const knop of document.querySelectorAll('.tabs-inner .tab')) zetTabZichtbaar(knop, toegestaan.has(knop.id.replace(/^tab-/, '')));

  // Een technieker ziet Rapporten (enkel zijn eigen: de server filtert) op elk toestel; de rest van .coord-only blijft verborgen.
  document.getElementById('tab-rapporten')?.classList.toggle('coord-only', rol !== 'technieker');

  // "Mijn rapporten" (Rapporten-tab): voor wie alles ziet (beheerder, planner) en zelf interventies uitvoert; een technieker ziet enkel zijn eigen.
  const mijnRapporten = document.getElementById('rapp-filter-mijn');
  if (mijnRapporten) mijnRapporten.style.display = rol !== 'technieker' && rol !== 'sales' && eigenZohoNaam() ? '' : 'none';

  // Een technieker start op zijn eigen planning, tenzij hij al een bepaalde persoon gekozen had. Een beheerder of planner met een
  // Zoho-naam (voert zelf interventies uit) start op zichzelf zolang er op dit toestel nog niets gekozen is; een bewuste keuze,
  // ook "Alle", blijft staan.
  if (rol !== 'sales' && gebruiker.zohoNaam) {
    try {
      const gekozen = localStorage.getItem('blitz_active_person');
      const opEigen = rol === 'technieker' ? (!gekozen || gekozen === 'all') : !gekozen;
      if (opEigen) localStorage.setItem('blitz_active_person', String(gebruiker.zohoNaam));
    } catch { /* geen opslag */ }
  }
  toonGebruikersmenu(gebruiker);
}

// Haalt de "laden"-markering van de schil weg (index.html zet data-schil="laden", app.css verbergt tabs en inhoud daarmee): de schil toont pas
// als de rol is toegepast, zodat de planner-schil niet kort zichtbaar is voor een verkoper. Veilig om meermaals of zonder document aan te roepen.
export function geefSchilVrij() {
  try { globalThis.document?.documentElement?.removeAttribute('data-schil'); } catch { /* geen document */ }
}

// Wacht op de login, past de rol toe en start dan de app: de eigen start van de rol, anders de gewone opstart.
export async function startNaInlog(opstart) {
  try {
    await laadSessie();
  } catch (fout) {
    console.error('Sessie laden mislukt:', fout);
    toast('Inloggen is niet gelukt. Herlaad de pagina.');
    geefSchilVrij();
    return;
  }
  const gebruiker = huidigeGebruiker();
  if (!gebruiker) { console.warn('startNaInlog: geen gebruiker na de login; de app start niet'); geefSchilVrij(); return; }
  // Gedeeld toestel: staat van een vorige gebruiker (gekozen persoon, ticket-/planningcaches) eerst weg, vóór pasRolToe en de opstart.
  claimToestel(globalThis.localStorage, globalThis.sessionStorage, gebruiker.id);
  pasRolToe(gebruiker);
  toonRolwisselaar(); // enkel in ?test op een lokale dev-server; anders niets
  // Instellingen van de server in de lokale cache zetten (logins T16) vóór de app ze leest (met het budget dat na een trage auth-ik overblijft, zodat de opstart ≤ ~8 s blijft); faalt nooit hard: bij een fout start de app met de lokale cache.
  try { await synchroniseerInstellingen(gebruiker, { budgetMs: resterendSyncBudget(laatsteOpstartNetwerkMs()) }); } catch (fout) { console.warn('Instellingen synchroniseren mislukt; de lokale cache wordt gebruikt:', fout); }
  const start = startVoorRol(gebruiker.rol);
  // Een rol met een eigen start (sales) houdt de schil verborgen tot die start de tabs, de kop en de eerste tab gezet heeft; de gewone opstart
  // toont de schil meteen (de tabs staan dan al op de rol).
  if (start) { try { await start(); } finally { geefSchilVrij(); } } else { geefSchilVrij(); opstart(); }
}
