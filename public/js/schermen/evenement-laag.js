// schermen/evenement-laag.js — de DOM-kant van de feestelijke versiering, gestuurd door het actieve themapakket.
// De beslissing (welk thema, voor wie, hoe sober) staat puur in kern/versiering-logica.js; de pakketten komen uit
// schermen/themas-bron.js (cache in localStorage, ververst door app.js); de bewegingen staan in versiering-bewegingen.js en de
// tekeningen worden gebouwd door vorm-svg.js. Dit bestand orkestreert enkel:
//  - zet `data-event="<thema-id>"` op <html>, plus de accentkleuren van het pakket als `--ev-*`-variabelen (enkel gevalideerde
//    kleuren, via style.setProperty) en de lijsten `data-ev-kleuren(-licht)`; css/evenement.css gebruikt ze enkel in `@media screen`;
//  - bouwt twee decoratielagen uit `versiering` (aria-hidden, pointer-events: none, geen netwerk, niet in print). Besluit Brent
//    (2026-10-22): versiering hangt nooit vóór een knop. STILSTAANDE delen (`hoek`, `hangen`, `mist`) staan in `#event-achter-laag`,
//    ACHTER de inhoud (tussen de achtergrond en de app: knoppen, balken en kaarten bedekken ze; ze schemeren door de glazen kaarten).
//    BEWEGENDE delen (`vallen`, `opstijgen`, `vliegen`, `kruipen`, `vuurwerk`) staan in `#event-laag`, VOOR de inhoud (onder de
//    balken en vensters; klikken gaan er altijd door);
//  - bouwt de achtergrond `#event-achtergrond` uit `achtergrond` (onder alle inhoud, zelfde levensduur als de laag) en zet dan
//    `data-event-achtergrond="ja"` (inhoudsvlakken doorzichtig, ticketkaarten mat glas);
//  - zet tijdens het thema het standaardthema van het pakket (eigen keuze apart bewaard; `blitz_theme` blijft onaangeroerd);
//  - laat de bewegende delen lopen met één timer-lus (setTimeout, ~30 beelden per seconde, geen requestAnimationFrame-lus). Ze rust
//    zolang het spel Blitz Run open staat of de tab verborgen is; de CSS-animaties lopen in stappen (steps()).
// Op aanraak/gsm/tablet en bij prefers-reduced-motion bevat de laag enkel hoekbeelden (niets bewegends wordt gebouwd).
// Raakt `document`/`window` enkel binnen functies (daarom een scherm-module en geen kern). Wijst geen `window`-namen toe.
// De beslissing wordt herberekend bij de start, bij een wijziging van toestel/beweging/voorkeur, bij terugkeer naar de pagina, na het
// laden van de themas (app.js) en elke minuut (een toestel dat dagen openstaat, volgt zo de datum: 31 okt 23:59 -> 1 nov 00:00).
// Verandert het thema, dan komt de gebeurtenis 'versiering-gewijzigd' op window, zodat lege-tekst-lijsten zich hertekenen.
import { TEST_MODE } from '../kern/omgeving.js';
import { beslis, leesVoorkeur, bewaarVoorkeur, legeTekst, kijkvenster, STAP_MS } from '../kern/versiering-logica.js';
import { belgischeDag } from '../kern/themapakket.js';
import { valideerPakket, PLAFONDS, MAX_BEWEGEND } from '../kern/themapakket-validatie.js';
import { kiesThema, bewaarThemaKeuze } from '../kern/versiering-thema.js';
import { themasNu, voorbeeld } from './themas-bron.js';
import { BOUWERS, tekenBeeld, maakPlaatsen } from './versiering-bewegingen.js';

const KLEUR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
// Sleutel in het pakket -> naam van de app-variabele (base.css); de laag zet `--ev-<naam>` (donker) en `--ev-<naam>-licht`.
// Stilstaande bewegingen: achter de inhoud (#event-achter-laag); al de rest vóór de inhoud (#event-laag).
const ACHTER = new Set(['hoek', 'hangen', 'mist']);
const KLEUR_NAMEN = { accent: 'accent', accentHover: 'accent-hover', accentDim: 'accent-dim', accentGlow: 'accent-glow', opAccent: 'on-accent' };

let laag = null;          // het element #event-laag (of null): de bewegende delen, vóór de inhoud
let achterLaag = null;    // het element #event-achter-laag (of null): de stilstaande delen, achter de inhoud
let achtergrond = null;   // het element #event-achtergrond (of null), leeft en sterft samen met `laag`
let laagSleutel = '';     // 'bron|id|hash|beweging|sober': bij een wijziging wordt de laag opnieuw gebouwd
let huidig = null;        // het pakket dat nu getoond wordt (voor eventTekst), of null
let delen = [];           // wat de bouwers teruggaven: { stap?, meet?, hervat?, stop }
let lusTimer = 0;         // de timer van het volgende beeld (~30 per seconde)
let laatsteT = 0;
let evTopPx = 96;         // de gemeten onderrand van de vaste balken (zie meetEvTop)
let minuutTimer = 0;
let vorigeSleutel;        // undefined = nog niet bepaald (de eerste bepaling meldt niets)
const muis = { x: -999, y: -999 };
let luisteraars = false;

const venster = () => (typeof window !== 'undefined' ? window : null);

function opslag() { try { return venster()?.localStorage ?? null; } catch { return null; } }

function reducedMotion() {
  try { return !!venster()?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// Een voorbeeld (Beheer → Thema's) gaat eerst nog door de poort: de laag toont nooit een ongevalideerd pakket.
const voorbeeldCache = new WeakMap(); // pakket -> gevalideerde kopie | null
let voorbeeldTeller = 0;
const voorbeeldId = new WeakMap();
function geldigVoorbeeld() {
  const v = voorbeeld();
  if (!v) return null;
  if (!voorbeeldCache.has(v)) {
    const r = valideerPakket(v);
    voorbeeldCache.set(v, r.ok ? r.pakket : null);
    if (r.ok) voorbeeldId.set(r.pakket, ++voorbeeldTeller);
  }
  return voorbeeldCache.get(v);
}

function invoer() {
  const w = venster();
  const a = w?.apparaat || {};
  let testForceer = false;
  try { testForceer = new URLSearchParams(w.location.search).get('versiering') === 'aan'; } catch {}
  let themas = null;
  try { themas = themasNu(); } catch { themas = null; }
  return {
    nu: new Date(), voorkeur: leesVoorkeur(opslag()), testMode: TEST_MODE, testForceer,
    soort: a.soort, aanraak: a.aanraak, reducedMotion: reducedMotion(), themas, voorbeeld: geldigVoorbeeld(),
  };
}

// Wat er nu geldt (voor de instellingen en de lege-tekst-helper).
export function huidigeBeslissing() { return beslis(invoer()); }

// Tekst voor een lege toestand ('wachtrijLeeg' | 'ingeplandLeeg') uit het getoonde pakket; de standaardtekst zonder thema.
export function eventTekst(sleutel, standaard) {
  return huidig ? legeTekst(huidig, sleutel, standaard) : standaard;
}

// ── Kleuren ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function wisKleuren(html) {
  for (const naam of Object.values(KLEUR_NAMEN)) { html.style.removeProperty(`--ev-${naam}`); html.style.removeProperty(`--ev-${naam}-licht`); }
  html.removeAttribute('data-ev-kleuren');
  html.removeAttribute('data-ev-kleuren-licht');
}
// Ontbrekende sleutels in `licht` vallen terug op `donker` (zoals het record van kern/themas-cache.js).
function zetKleuren(html, kleuren) {
  wisKleuren(html);
  const donker = kleuren?.donker && typeof kleuren.donker === 'object' ? kleuren.donker : {};
  const licht = { ...donker, ...(kleuren?.licht && typeof kleuren.licht === 'object' ? kleuren.licht : {}) };
  for (const [set, achtervoegsel, attribuut] of [[donker, '', 'data-ev-kleuren'], [licht, '-licht', 'data-ev-kleuren-licht']]) {
    const gezet = [];
    for (const [sleutel, naam] of Object.entries(KLEUR_NAMEN)) {
      const w = Object.hasOwn(set, sleutel) ? set[sleutel] : undefined;
      if (typeof w !== 'string' || !KLEUR.test(w)) continue;
      html.style.setProperty(`--ev-${naam}${achtervoegsel}`, w);
      gezet.push(sleutel);
    }
    if (gezet.length) html.setAttribute(attribuut, gezet.join(' '));
  }
}

// ── Laag en achtergrond ──────────────────────────────────────────────────────────────────────────────────────────────────
// Per beweging hoeveel elementen er nog bij mogen (plafonds, hangen + kruipen samen 3, alles wat beweegt samen 16).
function maakBudget() {
  const gebruikt = Object.fromEntries(Object.keys(PLAFONDS).map((b) => [b, 0]));
  let bewegend = 0;
  return (beweging, gevraagd) => {
    let max = PLAFONDS[beweging] - gebruikt[beweging];
    if (beweging === 'hangen' || beweging === 'kruipen') max = Math.min(max, 3 - gebruikt.hangen - gebruikt.kruipen);
    if (beweging !== 'hoek') max = Math.min(max, MAX_BEWEGEND - bewegend);
    const n = Math.max(0, Math.min(max, gevraagd));
    gebruikt[beweging] += n;
    if (beweging !== 'hoek') bewegend += n;
    return n;
  };
}

function maakLaagElement(id, thema) {
  const el = document.createElement('div');
  el.id = id;
  el.setAttribute('aria-hidden', 'true');
  el.dataset.thema = thema;
  return el;
}
function bouwLagen(b) {
  const voor = maakLaagElement('event-laag', b.thema.id);
  const achter = maakLaagElement('event-achter-laag', b.thema.id);
  const budget = maakBudget();
  const plaatsen = maakPlaatsen(); // gedeeld: twee hangen-elementen of twee keer dezelfde hoek liggen nooit op elkaar
  const uit = [];
  for (const element of Array.isArray(b.thema.versiering) ? b.thema.versiering : []) {
    const beweging = element?.beweging;
    if (typeof beweging !== 'string' || !Object.hasOwn(BOUWERS, beweging)) continue;
    if (!b.beweging && beweging !== 'hoek') continue; // sober of reduced-motion: enkel de hoekbeelden
    const gevraagd = beweging === 'hoek' ? (Array.isArray(element.hoeken) ? element.hoeken.length : 0)
      : Number.isInteger(element.aantal) ? element.aantal : 1;
    const max = budget(beweging, gevraagd);
    if (max < 1) continue;
    const ctx = { laag: ACHTER.has(beweging) ? achter : voor, sober: b.sober, muis, evTop: () => evTopPx, max, plaatsen };
    uit.push(BOUWERS[beweging](element, b.thema, ctx));
  }
  return { voor, achter, delen: uit };
}

// De achtergrond: een vorm (inline SVG) of een rasterbeeld, vast onder alle inhoud (css/evenement.css: z-index -1).
function bouwAchtergrond(pakket) {
  const a = pakket.achtergrond;
  if (!a || typeof a.vorm !== 'string') return null;
  const beeld = tekenBeeld(pakket, a.vorm, 'ev-achtergrond-beeld');
  if (!beeld) return null;
  const el = document.createElement('div');
  el.id = 'event-achtergrond';
  el.setAttribute('aria-hidden', 'true');
  if (typeof a.dekkingLicht === 'number' && a.dekkingLicht >= 0 && a.dekkingLicht <= 1) el.style.setProperty('--ev-dekking-licht', String(a.dekkingLicht));
  el.appendChild(beeld);
  return el;
}
// Smal (staand) scherm: toon het staande deel van de achtergrond (`kijkvensterStaand`); breed: alles. Bij het bouwen en bij een
// formaatwijziging.
function pasKijkvenster() {
  const beeld = achtergrond?.firstElementChild;
  if (!beeld || !huidig?.achtergrond) return;
  const vorm = huidig.vormen && Object.hasOwn(huidig.vormen, huidig.achtergrond.vorm) ? huidig.vormen[huidig.achtergrond.vorm] : null;
  const k = kijkvenster(window.innerWidth, window.innerHeight, huidig.achtergrond, vorm?.viewBox);
  if (vorm) {
    if (k.viewBox) beeld.setAttribute('viewBox', k.viewBox);
    beeld.setAttribute('preserveAspectRatio', k.uitlijning);
  } else {
    beeld.style.objectPosition = k.uitlijning.startsWith('xMax') ? 'right bottom' : 'center bottom';
  }
}

// Onderkant van alles wat bovenaan vast blijft staan: kop + tabbalk + meldingsbalken (--sticky-top) én de vaste balk van het
// actieve tabblad (zoekbalk, weekbalk, routebalk, ...). De versiering begint daar, anders verdwijnt ze achter die balk.
// Gemeten bij de start, bij een formaatwijziging, na een klik (tabwissel) en bij terugkeer naar de pagina; nooit per beeld.
export function meetEvTop() {
  if (!laag || typeof document === 'undefined') return;
  const kop = document.querySelector('.topbar-sticky');
  let onder = kop ? kop.getBoundingClientRect().bottom : 0;
  for (const id of ['offline-banner', 'outbox-banner']) {
    const b = document.getElementById(id);
    if (b && getComputedStyle(b).display !== 'none') onder = Math.max(onder, b.getBoundingClientRect().bottom);
  }
  // Wat staat er net onder die rand? Is dat (of een ouder) een vaste balk, dan schuift de rand naar de onderkant ervan (max. 3 lagen).
  for (let i = 0; i < 3 && document.elementFromPoint; i++) {
    let el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(onder) + 2);
    while (el && el !== document.body && getComputedStyle(el).position !== 'sticky') el = el.parentElement;
    if (!el || el === document.body || el.classList.contains('topbar-sticky')) break;
    const r = el.getBoundingClientRect();
    // Enkel balken over (bijna) de volle breedte tellen: de dagkoppen van de kalender zijn kolommen, geen balk. Anders
    // zou de versiering pas onder die hoge koppen beginnen, midden in het uurrooster.
    if (r.width < window.innerWidth * 0.8) break;
    if (r.bottom <= onder + 1) break;
    onder = r.bottom;
  }
  if (onder > 0) {
    evTopPx = Math.round(onder);
    for (const l of [laag, achterLaag]) l?.style.setProperty('--ev-top', evTopPx + 'px');
  }
  for (const d of delen) d.meet?.();
}
let meetGepland = 0;
function planMeting() {
  if (meetGepland || typeof requestAnimationFrame === 'undefined') return;
  meetGepland = requestAnimationFrame(() => { meetGepland = 0; meetEvTop(); });
}

// ── De lus ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function stopLus() {
  if (lusTimer) clearTimeout(lusTimer);
  lusTimer = 0; laatsteT = 0;
}

const spelOpen = () => !!document.getElementById('spel-overlay')?.classList.contains('open');
const nuMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Volgend beeld over ~33 ms (een timer, geen requestAnimationFrame: de browser tekent dan hoogstens ~30 keer per seconde).
function planStap(ms = STAP_MS) { lusTimer = setTimeout(stap, ms); }

function stap() {
  lusTimer = 0;
  if (!laag || !laag.isConnected) return;
  // Het spel tekent zelf: de versiering staat stil (ook de CSS-animaties) en kijkt elke halve seconde of het spel dicht is.
  if (spelOpen()) {
    zetGepauzeerd(true);
    laatsteT = 0;
    planStap(500);
    return;
  }
  if (!document.hidden) zetGepauzeerd(false);
  // Enkel CSS-animaties (vallen, opstijgen, hangen, mist): niets te rekenen, enkel elke halve seconde kijken of het spel open is.
  if (!delen.some((d) => d.stap)) { planStap(500); return; }
  const t = nuMs();
  if (!laatsteT) { laatsteT = t; planStap(); return; }
  const dt = Math.min(100, t - laatsteT);
  laatsteT = t;
  for (const d of delen) d.stap?.(t, dt);
  planStap();
}

// Beide lagen staan stil (CSS-animaties) tijdens het spel en in een verborgen tab.
function zetGepauzeerd(aan) {
  for (const l of [laag, achterLaag]) l?.classList.toggle('ev-gepauzeerd', aan);
}

// Is er iets dat beweegt (rekenend of enkel CSS)? Dan moet het tijdens het spel stil kunnen staan.
const beweegtIets = () => delen.some((d) => d.stap) || !!(laag?.querySelector('.ev-beweeg') || achterLaag?.querySelector('.ev-beweeg'));

// Start de lus (doet niets als ze al loopt, niets beweegt of de tab verborgen is). Zonder rekenende delen loopt ze traag (500 ms)
// en kijkt ze enkel of het spel open staat (fix-ronde 1: een thema met enkel CSS-animaties rust ook tijdens Blitz Run).
function startLus() {
  if (lusTimer || !laag || document.hidden || !beweegtIets()) return;
  laatsteT = 0;
  for (const d of delen) d.hervat?.();
  for (const d of delen) d.meet?.();
  planStap();
}

// ── Thema (donker/licht) ─────────────────────────────────────────────────────────────────────────────────────────────────
// Zie kern/versiering-thema.js. Raakt `blitz_theme` nooit aan.
function themaContext(b) {
  return {
    actief: !!b.actief, thema: b.thema?.id ?? null, voorkeurThema: b.thema?.kleuren?.voorkeurThema ?? null,
    jaar: belgischeDag(new Date()).jaar, opslag: opslag(),
  };
}
function pasThemaToe(b) {
  const t = kiesThema(themaContext(b));
  const el = document.documentElement;
  if (el.getAttribute('data-theme') !== t) el.setAttribute('data-theme', t);
  document.getElementById('meta-theme-color')?.setAttribute('content', t === 'light' ? '#f5f6f7' : '#181e24');
}
// Een themawissel van de gebruiker (knop in de kop): tijdens het thema in de eigen sleutel, anders in `blitz_theme`.
export function bewaarThemaWissel(keuze) {
  return bewaarThemaKeuze({ ...themaContext(beslis(invoer())), keuze });
}

// ── Toepassen ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function verwijderLaag() {
  stopLus();
  for (const d of delen) { try { d.stop(); } catch { /* een bouwer die faalt bij het opruimen, breekt het opruimen niet */ } }
  delen = [];
  laag?.remove();
  achterLaag?.remove();
  achtergrond?.remove();
  laag = null; achterLaag = null; achtergrond = null; laagSleutel = '';
}

function bronSleutel(pakket) {
  if (voorbeeldId.has(pakket)) return `voorbeeld:${voorbeeldId.get(pakket)}`;
  const rij = themasNu()?.index?.themas?.find?.((t) => t.id === pakket.id);
  return `thema:${rij?.pakketHash ?? ''}`;
}

function pasToe(b) {
  const html = document.documentElement;
  if (!b.actief) {
    verwijderLaag();
    huidig = null;
    html.removeAttribute('data-event');
    html.removeAttribute('data-event-sober');
    html.removeAttribute('data-event-achtergrond');
    wisKleuren(html);
    return;
  }
  const sleutel = `${bronSleutel(b.thema)}|${b.thema.id}|${b.beweging}|${b.sober}`;
  html.dataset.event = b.thema.id;
  html.dataset.eventSober = b.sober ? 'ja' : 'nee';
  if (laag && sleutel === laagSleutel) { if (b.beweging) startLus(); return; }
  verwijderLaag();
  huidig = b.thema;
  zetKleuren(html, b.thema.kleuren);
  const gebouwd = bouwLagen(b);
  laag = gebouwd.voor;
  achterLaag = gebouwd.achter;
  delen = gebouwd.delen;
  laagSleutel = sleutel;
  document.body.appendChild(laag);
  // Volgorde vooraan in de body: eerst de achtergrond, dan de achter-laag (beide z-index -1: de latere ligt erboven).
  document.body.insertBefore(achterLaag, document.body.firstChild);
  achtergrond = bouwAchtergrond(b.thema);
  if (achtergrond) {
    document.body.insertBefore(achtergrond, document.body.firstChild);
    html.dataset.eventAchtergrond = 'ja';
    pasKijkvenster();
  } else {
    html.removeAttribute('data-event-achtergrond');
  }
  if (document.hidden) zetGepauzeerd(true);
  meetEvTop();
  if (b.beweging) startLus();
}

// Herberekent alles: roep aan bij de start, na een wijziging van de voorkeur of de themas, en bij een wijziging van toestel of
// bewegingsvoorkeur.
export function herbereken() {
  if (typeof document === 'undefined') return;
  const b = beslis(invoer());
  pasToe(b);
  pasThemaToe(b);
  const sleutel = b.actief ? `${b.thema.id}|${bronSleutel(b.thema)}` : null;
  if (sleutel !== vorigeSleutel) {
    const eerste = vorigeSleutel === undefined;
    vorigeSleutel = sleutel;
    if (!eerste) window.dispatchEvent(new CustomEvent('versiering-gewijzigd', { detail: { thema: b.actief ? b.thema.id : null } }));
  }
}

// Voorkeur van de gebruiker voor dit toestel: aan = automatisch (tijdens een thema), uit = nooit.
export function zetVersieringAan(aan) {
  bewaarVoorkeur(opslag(), aan ? 'auto' : 'uit');
  herbereken();
}
export function versieringAanVoorkeur() { return leesVoorkeur(opslag()) !== 'uit'; }

// `elkeMinuut` (optioneel): wordt mee aangeroepen in de minuutcontrole (enkel met een zichtbare tab); app.js ververst er de
// themas mee als de laatste lading te lang geleden is.
let elkeMinuutHaak = null;
export function startVersiering({ elkeMinuut } = {}) {
  if (elkeMinuut instanceof Function) elkeMinuutHaak = elkeMinuut;
  const w = venster();
  if (!w || typeof document === 'undefined') return;
  herbereken();
  if (luisteraars) return;
  luisteraars = true;
  w.addEventListener('apparaatwijziging', herbereken);
  try { w.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', herbereken); } catch {}
  w.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { muis.x = e.clientX; muis.y = e.clientY; } }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    zetGepauzeerd(document.hidden);
    if (document.hidden) stopLus();
    else { herbereken(); planMeting(); startLus(); } // na een tijd op de achtergrond kan de datum veranderd zijn
  });
  w.addEventListener('resize', () => { planMeting(); pasKijkvenster(); });
  document.addEventListener('click', planMeting, true); // een tabwissel verandert de vaste balk van het scherm
  if (!minuutTimer) {
    minuutTimer = setInterval(() => {
      if (document.hidden) return;
      herbereken(); planMeting();
      try { elkeMinuutHaak?.(); } catch { /* een haak die faalt, breekt de minuutcontrole niet */ }
    }, 60000);
  }
  w.addEventListener('keyup', planMeting, true); // tabwissel met het toetsenbord
  // Bij de start staan de balken van het scherm er soms nog niet: meet opnieuw na het laden en kort daarna.
  w.addEventListener('load', planMeting);
  for (const ms of [300, 1500]) setTimeout(planMeting, ms);
}
