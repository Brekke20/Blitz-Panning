// kern/navigatie.js — welke tabs en welke start hoort bij welke rol (logins T15). Pure registers, geen DOM en geen
// weet van schermen: de deelprojecten registreren hun tabs en hun start in schermen/rol-schil.js (één regel elk);
// rol-schil.js past de rol toe op de pagina (pasRolToe) en roept laadTab aan via setTab.
// Een tab: { id, label, laad: () => Promise<void> }; `id` is de bestaande knop `tab-<id>` van index.html (of een nieuwe).

const tabsPerRol = new Map();   // rol -> tab[] in registratievolgorde
const startPerRol = new Map();  // rol -> () => void
let actieveRol = null;

const geldigeTab = (t) => t && typeof t === 'object' && typeof t.id === 'string' && t.id !== '';

// VOEGT toe; een tab met dezelfde id (binnen dezelfde rol) vervangt de bestaande op dezelfde plaats.
export function registreerTabs(rol, tabs) {
  if (typeof rol !== 'string' || !Array.isArray(tabs)) return;
  const lijst = tabsPerRol.get(rol) || [];
  for (const t of tabs) {
    if (!geldigeTab(t)) continue;
    const i = lijst.findIndex(x => x.id === t.id);
    if (i >= 0) lijst[i] = t; else lijst.push(t);
  }
  tabsPerRol.set(rol, lijst);
}

export function tabsVoorRol(rol) { return [...(tabsPerRol.get(rol) || [])]; }

// fn() start de app voor die rol i.p.v. de gewone opstart (sales: de gewone opstart geeft voor sales 403's).
export function registreerStart(rol, fn) {
  if (typeof rol === 'string' && fn instanceof Function) startPerRol.set(rol, fn);
}
export function startVoorRol(rol) { return startPerRol.get(rol) || null; }

// De rol waarvoor laadTab zoekt; gezet door pasRolToe.
export function zetActieveRol(rol) { actieveRol = typeof rol === 'string' ? rol : null; }

// Roept laad() van de geregistreerde tab van de actieve rol aan. Onbekend = niets; een fout bij het laden stoort
// de tabwissel niet (wel gelogd).
export async function laadTab(id) {
  const tab = tabsVoorRol(actieveRol).find(t => t.id === id);
  if (!tab || !(tab.laad instanceof Function)) return;
  try { await tab.laad(); } catch (fout) { console.error('Tab laden mislukt:', id, fout); }
}

// Enkel voor tests: terug naar een lege toestand.
export function wisNavigatieVoorTest() { tabsPerRol.clear(); startPerRol.clear(); actieveRol = null; }
