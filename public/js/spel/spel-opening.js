// spel/spel-opening.js — het enige deel van "Blitz Run" dat bij de opstart meeleest: 5× snel tikken op het bliksem-icoon (logo) linksboven.
// Elke tik moet binnen 600 ms na de vorige komen (een tragere tik begint opnieuw bij 1). Na de 3e en 4e tik verschijnt onderaan een korte
// melding ("Nog 2 keer tikken…"); de 5e tik opent het spel. Staat het spel open, dan sluit 5× snel tikken het weer (zonder melding).
// Het spel zelf (spel-ui.js met de engine en de skins) wordt pas bij de eerste activatie geladen (dynamische import, zoals excel-export.js).
// Doet verder niets: geen netwerk, geen opslag, geen wijziging aan het logo.
import { maakSnelleTikTeller } from './spel-logica.js';

export const TIK_AANTAL = 5;
export const TIK_TUSSEN_MS = 600;
export const MELDING_MS = 1500;

export const tikMelding = (aantal) => (aantal === 3 ? 'Nog 2 keer tikken om Blitz Run te openen' : aantal === 4 ? 'Nog 1 keer tikken om Blitz Run te openen' : '');

// De standaardmelding: een klein balkje onderaan (id spel-tik-toast, opmaak in app.css). Verdwijnt na MELDING_MS of bij `verberg`.
function maakDomMelding() {
  let balk = null;
  let timer = 0;
  const verberg = () => { clearTimeout(timer); balk?.classList.remove('show'); };
  const toon = (tekst) => {
    if (typeof document === 'undefined') return;
    if (!balk) {
      balk = document.createElement('div');
      balk.id = 'spel-tik-toast';
      balk.setAttribute('role', 'status');
      balk.setAttribute('aria-live', 'polite');
      document.body.append(balk);
    }
    balk.textContent = tekst;
    balk.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(verberg, MELDING_MS);
  };
  return { toon, verberg };
}
const spelIsOpen = () => typeof document !== 'undefined' && Boolean(document.getElementById('spel-overlay')?.classList.contains('open'));

// `doel`: het logo-icoon (.logo-icon). `laad`: geeft de belofte van de spel-module (standaard de dynamische import).
// De thema-afhankelijkheden komen van app.js en gaan ongewijzigd naar het spel (`wisselSpel(afh)`); dit bestand zelf kent geen skins (die zijn lazy):
// `actieveThemas(datum: Date)` -> [{ id }] (de nu actieve themas), `pakketten()` -> de bekende themapakketten (voor de themaskins) en
// `haalPakketten()` -> belofte (haalt de pakketten van themas die nog niet in de cache zitten; true als er iets nieuw binnenkwam).
// `melding` ({ toon(tekst), verberg() }) en `isOpen()` zijn injecteerbaar voor tests.
export function installeerSpelOpening({ doel, laad = () => import('./spel-ui.js'), nu = () => Date.now(), actieveThemas = () => [], pakketten = () => [], haalPakketten = async () => false, melding = maakDomMelding(), isOpen = spelIsOpen } = {}) {
  if (!doel) return null;
  const tik = maakSnelleTikTeller({ aantal: TIK_AANTAL, maxTussenMs: TIK_TUSSEN_MS });
  let module = null; // de gedeelde belofte van de spel-module
  const bijKlik = () => {
    const r = tik(nu());
    if (r.reset) melding.verberg();
    if (!r.bereikt) {
      // Enkel tijdens het openen een telmelding; bij sluiten (spel open) blijft het stil.
      const tekst = tikMelding(r.aantal);
      if (tekst && !isOpen()) melding.toon(tekst);
      return;
    }
    melding.verberg();
    // Een mislukte lading (offline zonder kopie) is stil en wordt niet onthouden: het spel is een extraatje en mag nooit iets storen.
    module = module ?? laad();
    module.then((m) => m.wisselSpel({ actieveThemas, pakketten, haalPakketten })).catch(() => { module = null; });
  };
  doel.addEventListener('click', bijKlik);
  return () => { doel.removeEventListener('click', bijKlik); melding.verberg(); };
}
