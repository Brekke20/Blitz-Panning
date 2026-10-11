// schermen/sales-registratie.js — registreert de sales-tabs en de start voor rol sales (sales-planner, Task 13).
// GEEN statische imports: rol-schil.js importeert dit bestand statisch (modulepreload), alles hieronder laadt lazy bij de eerste tabwissel.
// De schermen (sales-lijst/-kalender/-route/-afgewerkt) exporteren `toon(view)`; `zorgVoorView` (sales-schil.js) geeft de view van de tab.
const laadScherm = (id, importeer) => async () => {
  const [{ zorgVoorView }, m] = await Promise.all([import('./sales-schil.js'), importeer()]);
  return m.toon(zorgVoorView(id));
};

export const SALES_TABS = [
  { id: 'sales-lijst', label: 'Leads', laad: laadScherm('sales-lijst', () => import('./sales-lijst.js')) },
  { id: 'sales-kalender', label: 'Kalender', laad: laadScherm('sales-kalender', () => import('./sales-kalender.js')) },
  { id: 'sales-route', label: 'Route', alleenGroot: true, laad: laadScherm('sales-route', () => import('./sales-route.js')) },
  { id: 'sales-afgewerkt', label: 'Afgewerkt', laad: laadScherm('sales-afgewerkt', () => import('./sales-afgewerkt.js')) },
];

// Sales: de vier tabs en een eigen start (de gewone opstart roept ~15 endpoints aan die voor sales 403 geven).
// Beheerder (kop B): de tab "Sales" is weg. De vier tabs staan onder een eigen sleutel ('beheerder-sales') en rol-schil.js toont ze in de
// werkruimte Sales: de beheerder kiest in de persoonskiezer een verkoper, en dan wisselen de hoofdtabs (Leads, Kalender, Route, Afgewerkt, Beheer).
export const BEHEERDER_SALES = 'beheerder-sales';
export function registreerSalesRol({ registreerTabs, registreerStart }) {
  registreerTabs('sales', SALES_TABS);
  registreerTabs(BEHEERDER_SALES, SALES_TABS);
  registreerStart('sales', () => import('./sales-start.js').then(m => m.start()));
}
