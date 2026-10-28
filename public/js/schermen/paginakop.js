// schermen/paginakop.js — de paginakop (Open dag, taak 7): op `breed` staat in de kop de naam van het actieve tabblad (#paginatitel) met
// eronder een samenvatting (#paginasub). Op gsm en staande tablet verbergt css/app.css de paginakop (daar staat het logo in de kop).
// - De titel volgt de actieve `.tabs-inner .tab` via een MutationObserver op `class` (ook voor de tabs die rol-schil.js zelf aanmaakt en voor
//   de sales-tabs van sales-start.js): de tekst van de tab zonder teller en icoon.
// - De samenvatting levert elk scherm zelf met `zetSamenvatting(tabId, tekst)`, op de plek waar het zijn teller of lijst al tekent
//   (geen eigen abonnement op de toestand, geen serveraanroep). Bewaard per tab, meteen getoond als die tab actief is.
// Geen DOM op moduleniveau: schermmodules die zetSamenvatting importeren, blijven laadbaar in `node --test`.

const teksten = new Map(); // tabId -> samenvatting
let titelEl = null;
let subEl = null;
let actiefId = null;

// Het label van een tab zonder de teller (.badge) en het icoon (svg).
function labelVan(tab) {
  const kloon = tab.cloneNode(true);
  for (const x of kloon.querySelectorAll('.badge, svg')) x.remove();
  return kloon.textContent.replace(/\s+/g, ' ').trim();
}

function toon() {
  if (!titelEl || !subEl) return;
  const tab = document.querySelector('.tabs-inner .tab.active');
  actiefId = tab ? tab.id.replace(/^tab-/, '') : null;
  const titel = tab ? labelVan(tab) : '';
  if (titelEl.textContent !== titel) titelEl.textContent = titel;
  const sub = (actiefId && teksten.get(actiefId)) || '';
  if (subEl.textContent !== sub) subEl.textContent = sub;
  subEl.hidden = !sub;
}

/** Bewaart de samenvatting van een scherm; toont ze meteen als dat scherm actief is. */
export function zetSamenvatting(tabId, tekst) {
  const waarde = String(tekst ?? '');
  if (teksten.get(tabId) === waarde) return;
  teksten.set(tabId, waarde);
  if (subEl && tabId === actiefId) toon();
}

export function initPaginakop() {
  titelEl = document.getElementById('paginatitel');
  subEl = document.getElementById('paginasub');
  const balk = document.querySelector('.tabs-inner');
  if (!titelEl || !subEl || !balk) return;
  // `class` (de actieve tab wisselt) en childList (rol-schil.js en sales maken tabs aan). Een teller die verandert, komt hier ook langs
  // (childList van de badge); toon() is goedkoop en schrijft enkel als titel of samenvatting echt anders is.
  new MutationObserver(toon).observe(balk, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
  toon();
}
