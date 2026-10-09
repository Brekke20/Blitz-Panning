// schermen/sales-registratie.js — registreert de sales-tabs en de start voor rol sales (sales-planner, Task 13).
// GEEN statische imports: rol-schil.js importeert dit bestand statisch (modulepreload), alles hieronder laadt lazy bij de eerste tabwissel.
// De schermen (sales-lijst/-kalender/-route/-afgewerkt) exporteren `toon(view)`; `zorgVoorView` (sales-schil.js) geeft de view van de tab.
const laadScherm = (id, importeer) => async () => {
  const [{ zorgVoorView }, m] = await Promise.all([import('./sales-schil.js'), importeer()]);
  return m.toon(zorgVoorView(id));
};

export const SALES_TABS = [
  { id: 'sales-lijst', label: 'Te plannen', laad: laadScherm('sales-lijst', () => import('./sales-lijst.js')) },
  { id: 'sales-kalender', label: 'Kalender', laad: laadScherm('sales-kalender', () => import('./sales-kalender.js')) },
  { id: 'sales-route', label: 'Route', laad: laadScherm('sales-route', () => import('./sales-route.js')) },
  { id: 'sales-afgewerkt', label: 'Afgewerkt', laad: laadScherm('sales-afgewerkt', () => import('./sales-afgewerkt.js')) },
];

// Sales: de vier tabs en een eigen start (de gewone opstart roept ~15 endpoints aan die voor sales 403 geven).
// Beheerder: ÉÉN extra tab "Sales" (de beheerder heeft al zeven tabs); daarbinnen een eigen subtabbalk met dezelfde vier schermen en de
// verkoperkeuze (sales-beheer.js). De subtabs bestaan enkel binnen die view, dus de tabnamen Kalender/Route blijven eenduidig.
export function registreerSalesRol({ registreerTabs, registreerStart }) {
  registreerTabs('sales', SALES_TABS);
  registreerTabs('beheerder', [{
    id: 'sales', label: 'Sales',
    laad: () => import('./sales-beheer.js').then(m => m.openSalesBeheer(document.getElementById('view-sales'), SALES_TABS)),
  }]);
  registreerStart('sales', () => import('./sales-start.js').then(m => m.start()));
}
