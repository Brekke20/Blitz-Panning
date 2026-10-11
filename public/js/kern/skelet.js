// kern/skelet.js — skeleton-laadschermen: grijze blokken in de vorm van de echte inhoud, zolang een scherm op zijn gegevens wacht.
// Enkel uitzicht: de dataflow, de endpoints en het aantal verzoeken veranderen er niet door.
//
//   const skelet = toonSkelet(inhoudVak, { vorm: 'kaarten' });   // vóór het wachten
//   ...await het verzoek...
//   skelet.stop();                                                // vóór het tekenen van de echte inhoud (of de foutmelding)
//
// Spelregels:
//  - Het skelet verschijnt pas na SKELET_VERTRAGING_MS (150 ms): een snel antwoord geeft geen flits.
//  - Het verschijnt enkel als er niets te tonen is: `isLeeg(vak)` (standaard: het vak heeft geen kinderen) wordt gecontroleerd op het
//    moment dat het skelet zou verschijnen. Staat er al inhoud (geheugen, cache), dan blijft die staan en ververst de lading op de achtergrond.
//  - Het vak krijgt aria-busy="true" zolang er geladen wordt (alleen als het die nog niet had: een eigenaar die zelf aria-busy beheert houdt dat).
//    Het skelet zelf is aria-hidden; een visueel verborgen "Laden…" (.sr-only) meldt het wachten aan schermlezers.
//  - stop() is idempotent en ruimt alles op (timer, skelet, verborgen elementen, aria-busy), ook als het skelet nooit getoond is.
// De uitzicht-regels (.skelet, .skelet-blok, shimmer, reduced motion) staan in css/base.css.

export const SKELET_VERTRAGING_MS = 150;
export const SKELET_VORMEN = Object.freeze(['rijen', 'kaarten', 'tegels', 'route', 'formulier']);
const WEG = 'skelet-weg'; // verbergt een element (bv. een "Laden..."-tekst) zolang het skelet zichtbaar is

// De bouwers: elk geeft een gewoon element terug met enkel div's (geen tekst, geen servergegevens).
function blok(doc, klasse, breedte) {
  const el = doc.createElement('div');
  el.className = `skelet-blok ${klasse}`;
  if (breedte) el.style.width = breedte;
  return el;
}
function groep(doc, klasse, ...kinderen) {
  const el = doc.createElement('div');
  el.className = klasse;
  for (const k of kinderen) el.append(k);
  return el;
}
const herhaal = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
// Breedtes wisselen af, zodat de regels niet als een rasterpatroon ogen.
const BREEDTES = ['72%', '55%', '84%', '48%', '66%', '78%'];

const BOUWERS = {
  // Tabelrijen of lijstregels (Gebruikers, Activiteitenlog, Afgewerkt, Systeemstatus).
  rijen: (doc, n = 6) => groep(doc, 'skelet-rijen', ...herhaal(n, (i) => groep(doc, 'skelet-rij',
    blok(doc, 'skelet-regel', '22%'), blok(doc, 'skelet-regel', BREEDTES[i % BREEDTES.length]), blok(doc, 'skelet-regel skelet-regel--kort', '14%')))),
  // Kaarten (Leads, Wachtrij): een titelregel, een tekstregel en een kleine regel per kaart.
  kaarten: (doc, n = 6) => groep(doc, 'skelet-kaarten', ...herhaal(n, (i) => groep(doc, 'skelet-kaart',
    blok(doc, 'skelet-regel skelet-regel--titel', '40%'), blok(doc, 'skelet-regel', BREEDTES[i % BREEDTES.length]), blok(doc, 'skelet-regel skelet-regel--kort', '30%')))),
  // Kerncijfertegels met daaronder twee grote blokken (Performance).
  tegels: (doc, n = 6) => groep(doc, 'skelet-dash',
    groep(doc, 'skelet-tegels', ...herhaal(n, () => groep(doc, 'skelet-tegel', blok(doc, 'skelet-regel skelet-regel--kort', '50%'), blok(doc, 'skelet-cijfer', '36%')))),
    blok(doc, 'skelet-vlak'), blok(doc, 'skelet-vlak')),
  // Een lijst stops naast een kaartvlak (Route).
  route: (doc, n = 4) => groep(doc, 'skelet-route',
    groep(doc, 'skelet-route-lijst', ...herhaal(n, (i) => groep(doc, 'skelet-kaart',
      blok(doc, 'skelet-regel skelet-regel--titel', '35%'), blok(doc, 'skelet-regel', BREEDTES[i % BREEDTES.length])))),
    blok(doc, 'skelet-kaartvlak')),
  // Label + invoerveld onder elkaar (Instellingen).
  formulier: (doc, n = 5) => groep(doc, 'skelet-formulier', ...herhaal(n, () => groep(doc, 'skelet-veld',
    blok(doc, 'skelet-regel skelet-regel--kort', '30%'), blok(doc, 'skelet-invoer')))),
};

/** Het skelet zelf (zonder timer of aria): een element `.skelet` met de gevraagde vorm; een onbekende vorm valt terug op 'rijen'. */
export function bouwSkelet(vorm = 'rijen', { doc = globalThis.document, aantal } = {}) {
  const gekozen = SKELET_VORMEN.includes(vorm) ? vorm : 'rijen';
  const wortel = doc.createElement('div');
  wortel.className = 'skelet';
  wortel.dataset.skelet = gekozen;
  wortel.setAttribute('aria-hidden', 'true');
  wortel.append(BOUWERS[gekozen](doc, aantal));
  return wortel;
}

const standaardIsLeeg = (vak) => vak.childElementCount === 0;

/**
 * Toont (na `vertraging` ms, enkel als `isLeeg(vak)` dan nog klopt) een skelet in `vak` en zet aria-busy.
 * `verberg`: elementen die zolang het skelet staat verborgen zijn (bv. de "Laden..."-tekst die het skelet vervangt).
 * Geeft { stop(), zichtbaar() } terug; een ontbrekend vak geeft een no-op.
 */
export function toonSkelet(vak, { vorm = 'rijen', aantal, vertraging = SKELET_VERTRAGING_MS, isLeeg = standaardIsLeeg, verberg = [] } = {}) {
  if (!vak) return { stop() {}, zichtbaar: () => false };
  const hadBusy = vak.hasAttribute('aria-busy');
  if (!hadBusy) vak.setAttribute('aria-busy', 'true');
  let gestopt = false;
  let timer = null;
  let el = null;
  let sr = null;
  const verborgen = [];

  function toon() {
    timer = null;
    if (gestopt || el) return;
    if (!isLeeg(vak)) return; // er is al iets te tonen: geen skelet (en dus geen geflikker)
    const doc = vak.ownerDocument ?? globalThis.document;
    el = bouwSkelet(vorm, { doc, aantal }); // aria-hidden: puur decoratief
    sr = doc.createElement('span');
    sr.className = 'sr-only skelet-melding';
    sr.setAttribute('role', 'status');
    sr.textContent = 'Laden…'; // voor schermlezers (visueel verborgen); aria-busy op het vak meldt het wachten
    vak.append(el, sr);
    for (const v of verberg) { if (v && !v.classList.contains(WEG)) { v.classList.add(WEG); verborgen.push(v); } }
  }

  function stop() {
    if (gestopt) return;
    gestopt = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    el?.remove();
    sr?.remove();
    el = null;
    sr = null;
    for (const v of verborgen) v.classList.remove(WEG);
    verborgen.length = 0;
    if (!hadBusy) vak.removeAttribute('aria-busy');
  }

  if (vertraging > 0) timer = setTimeout(toon, vertraging); else toon();
  return { stop, zichtbaar: () => el !== null && !gestopt };
}
