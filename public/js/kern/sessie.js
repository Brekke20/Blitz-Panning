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

export function zetInlogUi(delen) {
  for (const [naam, fn] of Object.entries(delen || {})) if (fn instanceof Function) ui[naam] = fn;
}
export function registreerAfmeldHaak(fn) {
  if (fn instanceof Function) afmeldHaken.push(fn);
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

async function laad() {
  for (let ronde = 0; ronde < MAX_RONDES; ronde++) {
    let res = null;
    try { res = await globalThis.fetch('/api/auth-ik'); } catch { res = null; }

    // Netwerkfout of opslagstoring: gecachte gebruiker (offline start), anders "geen verbinding" tot opnieuw proberen.
    if (!res || res.status === 503) {
      if (res) meldOpslagStoring();
      const cache = leesCache();
      if (cache) return neemOver(cache, null, undefined);
      await vereis('toonGeenVerbinding')();
      continue;
    }
    if (res.status === 401) {
      let body = null;
      try { body = await res.json(); } catch { /* geen json */ }
      wisCache(); // de bewaarde gebruiker hoort bij een sessie die niet meer bestaat
      await vereis('toonInloggen')({ setupNodig: body?.setupNodig === true });
      continue;
    }
    if (!res.ok) throw new Error('auth-ik: HTTP ' + res.status);
    const data = await res.json();
    if (data?.moetWachtwoordWijzigen === true) {
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
