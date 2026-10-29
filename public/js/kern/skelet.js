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
//  - Schermen die vanuit abonnementen tekenen (Kalender, Ingepland, Route: geen haakjes rond een verzoek) gebruiken `maakTicketsStand`:
//    één timer per eerste lading zet `data-tickets-laden="zichtbaar"` op <html>; hun skelet (`bouwTicketsSkelet`) staat vanaf het begin in
//    de DOM (de plaats is dus gereserveerd, geen sprong) maar is onzichtbaar tot dat attribuut er staat. Zie het blok L1 onderaan.
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

// ── L1: Kalender, Ingepland en Route zolang de tickets nog onbekend zijn ──
// Deze schermen tekenen vanuit toestand-abonnementen en hebben geen eigen verzoek om een timer omheen te zetten. Zonder bewaarde kopie van
// de tickets zouden ze een lege staat tonen die op "niets gepland" lijkt, terwijl de gegevens nog onderweg zijn. De stand zegt of de
// tickets al gekend zijn; app.js zet hem VÓÓR het toepassen van de gegevens op 'bekend' (het toepassen tekent de schermen synchroon).
//
//   'onbekend'  nog geen bewaarde kopie en nog geen geslaagde lading: de schermen tekenen een skelet (onzichtbaar tot het attribuut)
//   'bekend'    de kopie is toegepast of een lading slaagde: echte inhoud, ook een echte lege staat
//   'mislukt'   de eerste lading faalde zonder kopie: geen skelet meer, de lege staat en de bestaande foutmelding
// De 150 ms zit bewust NIET in CSS (animation-delay loopt in echte tijd en is niet door een nepklok te sturen) maar in één JS-timer; een
// hertekening tijdens het laden (afspraken of beschikbaarheid komen binnen) begint hem dus nooit opnieuw en laat het skelet niet flikkeren.
export const TICKETS_LADEN_ATTR = 'data-tickets-laden';

export function maakTicketsStand({ wortel = globalThis.document?.documentElement ?? null, vertraging = SKELET_VERTRAGING_MS } = {}) {
  let stand = 'onbekend';
  let gestart = false;
  let timer = null;
  const opruimen = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    wortel?.removeAttribute(TICKETS_LADEN_ATTR);
  };
  return {
    stand: () => stand,
    /** Zijn de tickets gekend of is de eerste lading definitief mislukt? Dan is de lege staat eerlijk en komt er geen skelet. */
    isBekend: () => stand !== 'onbekend',
    /** Start (hoogstens één keer, enkel zolang onbekend) de timer die het skelet na `vertraging` ms zichtbaar maakt. */
    start() {
      if (stand !== 'onbekend' || gestart) return;
      gestart = true;
      timer = setTimeout(() => {
        timer = null;
        if (stand === 'onbekend') wortel?.setAttribute(TICKETS_LADEN_ATTR, 'zichtbaar');
      }, vertraging);
    },
    /** De tickets zijn gekend (kopie of lading). Geeft true als dit de overgang uit 'onbekend' was. */
    bekend() {
      const was = stand;
      stand = 'bekend';
      gestart = true; // een kopie of lading is er al: nooit meer een skelet starten
      opruimen();
      return was === 'onbekend';
    },
    /** De eerste lading faalde zonder kopie. Enkel uit 'onbekend'; geeft true als dat de overgang was. */
    mislukt() {
      if (stand !== 'onbekend') return false;
      stand = 'mislukt';
      opruimen();
      return true;
    },
  };
}

/**
 * Skelet voor een abonnementsscherm: een gewoon `bouwSkelet` met klasse `skelet--tickets` (onzichtbaar tot `data-tickets-laden` op <html>
 * staat) en een `skelet--<variant>` voor de maten van dat scherm (kal = dagkolom, lijst = Ingepland en Route). `metKop`: een kopblok
 * vooraan (de dagkop boven de kaarten van Ingepland), zodat de eerste echte kaart op dezelfde hoogte begint.
 */
export function bouwTicketsSkelet(vorm = 'kaarten', { doc = globalThis.document, aantal, variant, metKop = false } = {}) {
  const el = bouwSkelet(vorm, { doc, aantal });
  el.className += ' skelet--tickets' + (variant ? ` skelet--${variant}` : '');
  if (metKop) el.prepend(blok(doc, 'skelet-kop'));
  return el;
}

/** De ene "Laden…" voor schermlezers per scherm (niet per dagkolom): visueel verborgen en pas onder het attribuut aanwezig (CSS). */
export function bouwTicketsMelding(doc = globalThis.document) {
  const sr = doc.createElement('span');
  sr.className = 'sr-only skelet-melding skelet-melding--tickets';
  sr.setAttribute('role', 'status');
  sr.textContent = 'Laden…';
  return sr;
}
