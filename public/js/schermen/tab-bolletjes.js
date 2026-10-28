// schermen/tab-bolletjes.js — de tellers van de tabbladen als bolletje (Open dag, taak 19; Brent, 2026-10-28: "alles aangeven met een bolletje
// zonder cijfer", overal: zijkolom, dok en het blad "Meer").
// Het cijfer blijft in de DOM (textContent van .badge: de code en de tests lezen het) en de stijl zit op één plek (css/navigatie.css). Deze module
// doet de twee dingen die CSS niet kan: een teller van 0 krijgt `data-nul` (dan is er geen bolletje) en de tab krijgt een aria-label die zegt wat
// het bolletje betekent (de kleur alleen is voor een schermlezer niets). Er is geen abonnement op de toestand: een waarnemer op de tabbalk volgt
// elke wijziging van een teller (tekst, klasse, display) en van de tabs zelf (rol-schil.js maakt ze aan en verbergt ze).
import { tellerKleur, tellerLabel } from './tab-bolletjes-logica.js';

// Het label van een tab zonder de teller en het icoon.
export function tabNaam(knop) {
  const kloon = knop.cloneNode(true);
  for (const x of kloon.querySelectorAll('.badge, svg')) x.remove();
  return kloon.textContent.replace(/\s+/g, ' ').trim();
}

// Verborgen = door de app verborgen (hidden of inline display:none, zoals de teller van Inventaris). Bewust niet uit getComputedStyle: de eigen
// `data-nul` (nul = geen bolletje) zet ook display:none, en die staat even achter als een teller van 0 naar N gaat (waarnemers lopen na elkaar).
export const tellerVerborgen = (el) => el.hidden || el.style.display === 'none';

function werk(balk) {
  for (const tab of balk.querySelectorAll('.tab')) {
    const el = tab.querySelector('.badge');
    if (!el) continue;
    const kleur = tellerKleur({
      tekst: el.textContent,
      verborgen: tellerVerborgen(el), // de eigen `data-nul` telt niet mee: dat is net het resultaat
      op: el.classList.contains('badge--op'),
      bijna: el.classList.contains('badge--bijna'),
    });
    const nul = kleur === null && !tellerVerborgen(el);
    if (el.hasAttribute('data-nul') !== nul) el.toggleAttribute('data-nul', nul);
    const label = tellerLabel(tabNaam(tab), kleur, el.textContent, tab.id.replace(/^tab-/, ''));
    if (label) { if (tab.getAttribute('aria-label') !== label) tab.setAttribute('aria-label', label); }
    else if (tab.hasAttribute('aria-label')) tab.removeAttribute('aria-label');
  }
}

export function initTabBolletjes() {
  const balk = document.querySelector('.tabs-inner');
  if (!balk) return;
  let gepland = false;
  const plan = () => {
    if (gepland) return;
    gepland = true;
    queueMicrotask(() => { gepland = false; werk(balk); });
  };
  new MutationObserver(plan).observe(balk, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  werk(balk);
}
