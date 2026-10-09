// kern/sessie.js — wie is er ingelogd (logins T13). Kent geen schermen: het inlog-, wachtwoord- en "geen verbinding"-scherm
// registreren zich via zetInlogUi (schermen/inloggen.js). Kent ook geen instellingen: andere modules hangen een
// afmeldhaak aan (registreerAfmeldHaak). Raakt geen `window` aan (globalThis.location/localStorage, laat gebonden).
import { toast } from './ui.js';

const CACHE_SLEUTEL = 'blitz_sessie_cache';
const TESTROL_SLEUTEL = 'blitz_test_rol';
const TESTROLLEN = ['beheerder', 'planner', 'technieker', 'sales'];
const MAX_RONDES = 20; // vangnet tegen een inlogscherm dat zonder echte login oplost

let gebruiker = null;        // PubliekeGebruiker (in-memory)
let rechten = null;          // { beheer, plannen, alleSales } uit het laatste auth-ik
let lokaleDev = null;        // vlag uit het laatste auth-ik; null = nog geen antwoord
let lopend = null;           // gedeelde lopende laadSessie-belofte
const ui = {};               // { toonInloggen, toonWachtwoordWijzigen, toonGeenVerbinding }
const afmeldHaken = [];
const voorAfmeldHaken = [];  // lopen VÓÓR auth-uitloggen: de sessie bestaat dan nog (bv. nog te versturen verzoeken)

export function zetInlogUi(delen) {
  for (const [naam, fn] of Object.entries(delen || {})) if (fn instanceof Function) ui[naam] = fn;
}
export function registreerAfmeldHaak(fn) {
  if (fn instanceof Function) afmeldHaken.push(fn);
}
// Een haak die wordt afgewacht VÓÓR het uitloggen op de server (sales: uitgestelde verwijderingen versturen terwijl de sessie nog geldt;
// na auth-uitloggen geeft elk verzoek 401 en opent de fetch-omhulling het inlogscherm). Een falende haak houdt het afmelden niet tegen.
export function registreerVoorAfmeldHaak(fn) {
  if (fn instanceof Function) voorAfmeldHaken.push(fn);
}

const normaal = (n) => String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const rechtenUitGebruiker = (g) => {
  const beheer = g?.rol === 'beheerder';
  return { beheer, plannen: beheer || g?.rol === 'planner', alleSales: beheer || g?.magAlleSales === true };
};

function leesCache() {
  try {
    const g = JSON.parse(globalThis.localStorage.getItem(CACHE_SLEUTEL));
    return g && typeof g === 'object' && typeof g.id === 'string' && typeof g.rol === 'string' ? g : null;
  } catch { return null; }
}
function schrijfCache(g) { try { globalThis.localStorage.setItem(CACHE_SLEUTEL, JSON.stringify(g)); } catch { /* geen opslag */ } }
function wisCache() { try { globalThis.localStorage.removeItem(CACHE_SLEUTEL); } catch { /* geen opslag */ } }

export function huidigeGebruiker() { return gebruiker; }
export function heeftRol(...rollen) { return Boolean(gebruiker) && rollen.flat().includes(gebruiker.rol); }
export function huidigeRechten() {
  if (!gebruiker) return { beheer: false, plannen: false, alleSales: false };
  return { ...(rechten || rechtenUitGebruiker(gebruiker)) };
}
export function magSchrijvenVoor(zohoNaam) {
  if (!gebruiker) return false;
  if (gebruiker.rol === 'planner' || gebruiker.rol === 'beheerder') return true;
  if (gebruiker.rol !== 'technieker') return false;
  const eigen = normaal(gebruiker.zohoNaam);
  return eigen !== '' && eigen === normaal(zohoNaam);
}
// De Zoho-naam van het ingelogde account ('' als er geen is). Elk account behalve sales kan er een hebben: wie er een heeft voert
// ook zelf interventies uit (technieker voor het eigen werk), bovenop de rechten van zijn rol.
export function eigenZohoNaam() {
  if (!gebruiker || gebruiker.rol === 'sales' || typeof gebruiker.zohoNaam !== 'string') return '';
  return gebruiker.zohoNaam.trim();
}
// Een rapport is "van mij" als ik het zelf indiende (ingediendDoor = mijn id) of mijn Zoho-naam erop staat (oudere rapporten).
// Spiegelt netlify/lib/eigen.js (isEigenRapport) voor het eigen werk; de server filtert voor een technieker zelf.
export function isEigenRapport(rapport) {
  if (!gebruiker || !rapport) return false;
  if (typeof gebruiker.id === 'string' && gebruiker.id !== '' && rapport.ingediendDoor === gebruiker.id) return true;
  const eigen = normaal(eigenZohoNaam());
  return eigen !== '' && eigen === normaal(rapport.technieker);
}
export function isLokaleDev() { return lokaleDev === true; }

// Enkel in testmodus (?test): de rol die de lokale dev-server als testgebruiker gebruikt. Zodra het laatste auth-ik
// lokaleDev:false gaf (productie met ?test) wordt de header niet meer gestuurd.
export function testRolVoorHeader() {
  let testmodus = false;
  try { testmodus = new URLSearchParams(globalThis.location?.search ?? '').has('test'); } catch { /* geen location */ }
  if (!testmodus || lokaleDev === false) return null;
  let rol = null;
  try { rol = globalThis.localStorage.getItem(TESTROL_SLEUTEL); } catch { /* geen opslag */ }
  return TESTROLLEN.includes(rol) ? rol : 'beheerder';
}

// 503 'opslag-storing': tijdelijk, later opnieuw proberen (niet uitloggen, geen loginscherm).
export function meldOpslagStoring() {
  try { toast('De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.'); } catch { /* geen DOM */ }
}

function neemOver(g, r, dev) {
  const vorige = gebruiker;
  gebruiker = g;
  rechten = r || rechtenUitGebruiker(g);
  if (typeof dev === 'boolean') lokaleDev = dev;
  schrijfCache(g);
  // Herinloggen als iemand anders: de hele pagina draait nog op de gegevens van de vorige gebruiker.
  if (vorige && vorige.id !== g.id) { try { globalThis.location.reload(); } catch { /* geen location */ } }
  return g;
}

function vereis(naam) {
  if (typeof ui[naam] !== 'function') throw new Error('Geen inlogscherm geregistreerd (' + naam + ')');
  return ui[naam];
}

// Eén auth-ik-verzoek, ingedeeld. Gooit nooit: alles wat geen bruikbaar antwoord is wordt een soort.
//   ok (200 met gebruiker) · 401 · storing (503) · serverfout (andere status, of 200 zonder geldige JSON: captive portal, proxyfoutpagina)
//   netwerk (fetch gooit). `ms` = hoe lang het verzoek duurde.
async function haalAuthIk() {
  const t0 = Date.now();
  const klaar = (uitkomst) => ({ ...uitkomst, ms: Date.now() - t0 });
  let res;
  try { res = await globalThis.fetch('/api/auth-ik'); } catch { return klaar({ soort: 'netwerk' }); }
  if (res.status === 503) return klaar({ soort: 'storing' });
  if (res.status === 401) {
    let body = null;
    try { body = await res.json(); } catch { /* geen json */ }
    return klaar({ soort: '401', body });
  }
  if (!res.ok) return klaar({ soort: 'serverfout' });
  let data = null;
  try { data = await res.json(); } catch { /* geen json */ }
  if (!data || typeof data !== 'object' || !data.gebruiker || typeof data.gebruiker.id !== 'string' || typeof data.gebruiker.rol !== 'string') {
    return klaar({ soort: 'serverfout' });
  }
  return klaar({ soort: 'ok', data });
}

// Met een gecachte sessie wacht de opstart hooguit zo lang op auth-ik (eindreview I2); daarna start de app uit de cache en
// verwerkt de nog lopende aanvraag op de achtergrond.
export const KORTE_LIMIET_MS = 5000;
let netwerkMs = 0;           // tijd die een opstart met gecachte sessie op auth-ik wachtte (voor het resterende synchronisatiebudget)
let uitCacheGestart = false; // het laatste laadSessie startte uit de cache i.p.v. een geslaagd auth-ik

export function laatsteOpstartNetwerkMs() { return netwerkMs; }
export function startteUitCache() { return uitCacheGestart; }

const WACHT_OP_TIJD = Symbol('auth-ik-te-traag');
function metLimiet(belofte, ms) {
  let timer;
  const te_traag = new Promise((resolve) => { timer = setTimeout(() => resolve(WACHT_OP_TIJD), ms); });
  return Promise.race([belofte, te_traag]).finally(() => clearTimeout(timer));
}

// Een late (na de korte limiet binnengekomen) auth-ik-uitkomst: de app draait al uit de cache. Een 401 of een verplichte
// wachtwoordwijziging opent het gewone scherm; een 200 ververst gebruiker/rechten (een andere gebruiker herlaadt de pagina).
function verwerkLaat(uitkomst) {
  if (uitkomst.soort === '401' || (uitkomst.soort === 'ok' && uitkomst.data.moetWachtwoordWijzigen === true)) {
    laadSessie().catch((fout) => console.warn('Sessie hervalideren mislukt:', fout));
  } else if (uitkomst.soort === 'ok') {
    neemOver(uitkomst.data.gebruiker, uitkomst.data.rechten, uitkomst.data.lokaleDev === true);
    uitCacheGestart = false;
  }
}

async function laad() {
  netwerkMs = 0;
  uitCacheGestart = false;
  for (let ronde = 0; ronde < MAX_RONDES; ronde++) {
    const cache = leesCache();
    const aanvraag = haalAuthIk();
    const eerste = cache ? await metLimiet(aanvraag, KORTE_LIMIET_MS) : await aanvraag;
    if (eerste === WACHT_OP_TIJD) {
      netwerkMs = KORTE_LIMIET_MS;
      uitCacheGestart = true;
      aanvraag.then(verwerkLaat, () => {});
      return neemOver(cache, null, undefined);
    }
    const uitkomst = eerste;
    // Enkel een opstart MET gecachte sessie telt mee voor het synchronisatiebudget; wie zich net aanmeldde (geen cache) wacht niet op een
    // tijdsplafond maar op zichzelf.
    netwerkMs = cache ? uitkomst.ms : 0;

    // Netwerkfout, opslagstoring of een onbruikbaar antwoord (5xx, captive portal): gecachte gebruiker (offline start),
    // anders "geen verbinding" tot opnieuw proberen. Een latere 401 op een gewone aanroep opent het inlogscherm.
    if (uitkomst.soort === 'netwerk' || uitkomst.soort === 'storing' || uitkomst.soort === 'serverfout') {
      if (uitkomst.soort === 'storing') meldOpslagStoring();
      if (cache) { uitCacheGestart = true; return neemOver(cache, null, undefined); }
      await vereis('toonGeenVerbinding')();
      continue;
    }
    if (uitkomst.soort === '401') {
      wisCache(); // de bewaarde gebruiker hoort bij een sessie die niet meer bestaat
      await vereis('toonInloggen')({ setupNodig: uitkomst.body?.setupNodig === true });
      continue;
    }
    const data = uitkomst.data;
    if (data.moetWachtwoordWijzigen === true) {
      await vereis('toonWachtwoordWijzigen')();
      continue;
    }
    return neemOver(data.gebruiker, data.rechten, data.lokaleDev === true);
  }
  throw new Error('Inloggen is niet gelukt');
}

// Eén gedeelde lopende belofte: gelijktijdige aanroepen (ook van de 401-herlogin) delen één loginscherm.
export function laadSessie() {
  if (!lopend) lopend = laad().finally(() => { lopend = null; });
  return lopend;
}

export async function afmelden() {
  for (const haak of voorAfmeldHaken) {
    try { await haak(); } catch { /* één kapotte haak mag het afmelden niet tegenhouden */ }
  }
  try {
    await globalThis.fetch('/api/auth-uitloggen', { method: 'POST', headers: { 'X-Blitz': '1' } });
  } catch { /* offline: lokaal toch afmelden; de server-cookie vervalt vanzelf */ }
  wisCache();
  for (const haak of afmeldHaken) {
    try { await haak(); } catch { /* één kapotte haak mag de rest niet tegenhouden */ }
  }
  gebruiker = null; rechten = null;
  try { globalThis.location.reload(); } catch { /* geen location */ }
}
