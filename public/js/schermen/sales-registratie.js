// schermen/sales-registratie.js — registreert de sales-tabs en de start voor rol sales (sales-planner, Task 13).
// GEEN statische imports: rol-schil.js importeert dit bestand statisch (modulepreload), alles hieronder laadt lazy bij de eerste tabwissel.
// De schermen (sales-lijst/-kalender/-route/-afgewerkt) exporteren `toon(view)`; `zorgVoorView` (sales-schil.js) geeft de view van de tab.
const laadScherm = (id, importeer) => async () => {
  const [{ zorgVoorView }, m] = await Promise.all([import('./sales-schil.js'), importeer()]);
  return m.toon(zorgVoorView(id));
};

// `beheerLabel`: de naam in de tabbalk van de beheerder, die al zeven eigen tabs heeft. Hij mag niet een deel van een bestaande tabnaam
// bevatten (Kalender, Route): zoekers op tabnaam (schermlezers, de e2e-suite) vinden anders twee tabs.
export const SALES_TABS = [
  { id: 'sales-lijst', label: 'Te plannen', beheerLabel: 'Te plannen', laad: laadScherm('sales-lijst', () => import('./sales-lijst.js')) },
  { id: 'sales-kalender', label: 'Kalender', beheerLabel: 'Agenda', laad: laadScherm('sales-kalender', () => import('./sales-kalender.js')) },
  { id: 'sales-route', label: 'Route', beheerLabel: 'Rit', laad: laadScherm('sales-route', () => import('./sales-route.js')) },
  { id: 'sales-afgewerkt', label: 'Afgewerkt', beheerLabel: 'Afgewerkt', laad: laadScherm('sales-afgewerkt', () => import('./sales-afgewerkt.js')) },
];

// Sales: de vier tabs en een eigen start (de gewone opstart roept ~15 endpoints aan die voor sales 403 geven).
// Beheerder: dezelfde schermen als extra tabs met het voorvoegsel "Sales: ", met de verkoperkeuze in elk scherm.
export function registreerSalesRol({ registreerTabs, registreerStart }) {
  registreerTabs('sales', SALES_TABS.map(({ id, label, laad }) => ({ id, label, laad })));
  registreerTabs('beheerder', SALES_TABS.map(({ id, beheerLabel, laad }) => ({ id, label: 'Sales: ' + beheerLabel, laad })));
  registreerStart('sales', () => import('./sales-start.js').then(m => m.start()));
}
