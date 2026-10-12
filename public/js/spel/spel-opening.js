// spel/spel-opening.js — het enige deel van "Blitz Run" dat bij de opstart meeleest: 5× snel tikken op de titel linksboven.
// Het spel zelf (spel-ui.js met de engine en de skins) wordt pas bij de eerste activatie geladen (dynamische import, zoals excel-export.js).
// Doet verder niets: geen netwerk, geen opslag, geen wijziging aan de titel.
import { maakTikDetector } from './spel-logica.js';

export const TIK_AANTAL = 5;
export const TIK_VENSTER_MS = 2000;

// `doel`: het element met de titel (.logo). `laad`: geeft de belofte van de spel-module (standaard de dynamische import).
// `actieveEvenementen(datum)` -> [{ id, spelSkin? }]: app.js geeft die van kern/evenementen.js mee; standaard geen enkel event.
export function installeerSpelOpening({ doel, laad = () => import('./spel-ui.js'), nu = () => Date.now(), actieveEvenementen = () => [] } = {}) {
  if (!doel) return null;
  const tik = maakTikDetector({ aantal: TIK_AANTAL, venster: TIK_VENSTER_MS });
  let module = null; // de gedeelde belofte van de spel-module
  const bijKlik = () => {
    if (!tik(nu())) return;
    // Een mislukte lading (offline zonder kopie) is stil en wordt niet onthouden: het spel is een extraatje en mag nooit iets storen.
    module = module ?? laad();
    module.then((m) => m.wisselSpel({ actieveEvenementen })).catch(() => { module = null; });
  };
  doel.addEventListener('click', bijKlik);
  return () => doel.removeEventListener('click', bijKlik);
}
