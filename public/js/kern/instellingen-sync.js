// kern/instellingen-sync.js — instellingen komen van de server; localStorage (settingsKey) blijft de snelle, synchrone cache
// zodat loadPersonSettings ongewijzigd werkt (logins T16). Raakt geen `window` aan: opslag en api worden meegegeven.
//
// Stroom: bij de start (na de login, vóór opstart) haalt `synchroniseerInstellingen` het overzicht op en zet de serverwaarden in de
// cache; `savePersonSettings` (schermen/instellingen.js) schrijft lokaal én roept `bewaarOpServer` aan.
//
// Een gedeeld toestel: de cache hoort bij één gebruiker (marker `blitz_instellingen_eigenaar`). Hoort ze bij een ANDERE gebruiker,
// dan wordt ze gewist vóór er iets gebeurt: de lokale waarde van een ander gaat nooit omhoog als de mijne. Zonder marker (vóór deze
// versie of net gewist) geldt de lokale waarde als de mijne en gaat ze eenmalig omhoog als de server nog niets van mij heeft.
//
// Vuil-markering (`blitz_instellingen_vuil` = { [persoon]: true }): een PUT die niet lukte door een netwerk- of opslagprobleem.
// De volgende synchronisatie laadt voor zo'n persoon EERST de lokale waarde op; pas als dat lukt (of de server het definitief
// weigert) mag er weer iets van de server in de cache komen. Zo gaat een offline gemaakte wijziging nooit stil verloren.
import { apiJson as standaardApiJson, apiVerzoek as standaardApiVerzoek } from './api.js';
import { settingsKey } from '../schermen/instellingen-logica.js';

export const MARKER_SLEUTEL = 'blitz_instellingen_eigenaar';
export const VUIL_SLEUTEL = 'blitz_instellingen_vuil';
const LAATSTE_START_SLEUTEL = 'blitz_laatste_start';
const SETTINGS_VOORVOEGSEL = 'blitz_settings';
const PAD = '/api/instellingen';

const isObject = b => Boolean(b) && typeof b === 'object' && !Array.isArray(b);
const isTijd = v => /^\d{2}:\d{2}$/.test(v || '');

// De overzicht-cache van de laatste geslaagde synchronisatie: wie ik ben en welk gebruikerId bij welke technieker hoort.
// null = nog niet (of niet meer) geladen.
let overzichtCache = null; // { eigenId, eigenPersoon, techniekers: { [zohoNaam]: gebruikerId } }

// ── opslag-hulp (nooit gooien: geen opslag of vol is niet fataal) ──
const leesTekst = (opslag, k) => { try { return opslag?.getItem(k) ?? null; } catch { return null; } };
const schrijfTekst = (opslag, k, v) => { try { opslag?.setItem(k, v); } catch { /* geen opslag of vol */ } };
const verwijder = (opslag, k) => { try { opslag?.removeItem(k); } catch { /* geen opslag */ } };
function leesJson(opslag, k) {
  const t = leesTekst(opslag, k);
  if (t === null) return null;
  try { const w = JSON.parse(t); return isObject(w) ? w : null; } catch { return null; }
}
function sleutelsMet(opslag, voorvoegsel) {
  const lijst = [];
  try {
    if (typeof opslag?.length === 'number' && typeof opslag.key === 'function') {
      for (let i = 0; i < opslag.length; i++) { const k = opslag.key(i); if (typeof k === 'string' && k.startsWith(voorvoegsel)) lijst.push(k); }
    } else {
      for (const k of Object.keys(opslag || {})) if (k.startsWith(voorvoegsel)) lijst.push(k);
    }
  } catch { /* geen opslag */ }
  return lijst;
}

function leesVuil(opslag) { return leesJson(opslag, VUIL_SLEUTEL) ?? {}; }
function zetVuil(opslag, persoon, vuil) {
  const nu = leesVuil(opslag);
  if (vuil) nu[persoon] = true; else delete nu[persoon];
  if (Object.keys(nu).length) schrijfTekst(opslag, VUIL_SLEUTEL, JSON.stringify(nu)); else verwijder(opslag, VUIL_SLEUTEL);
}

// Alles wat bij de instellingen van een gebruiker hoort (zie wisInstellingenCache): de eigenaar-marker niet.
function wisInstellingen(opslag) {
  for (const k of sleutelsMet(opslag, SETTINGS_VOORVOEGSEL)) verwijder(opslag, k);
  verwijder(opslag, LAATSTE_START_SLEUTEL);
  verwijder(opslag, VUIL_SLEUTEL);
}

// Afmeldhaak (door schermen/rol-schil.js geregistreerd): alle lokale instellingen, de marker en de vuil-markering weg,
// en de overzicht-cache in het geheugen vergeten.
export function wisInstellingenCache(opslag) {
  wisInstellingen(opslag);
  verwijder(opslag, MARKER_SLEUTEL);
  overzichtCache = null;
}

// De persoon van wie de instellingen onder mijn eigen gebruikerId staan: een technieker zijn zohoNaam, anders 'all'.
const eigenPersoonVan = gebruiker => (gebruiker?.rol === 'technieker' && typeof gebruiker.zohoNaam === 'string' && gebruiker.zohoNaam ? gebruiker.zohoNaam : 'all');
const isEigen = (persoon, gebruiker) => !persoon || persoon === 'all' || persoon === eigenPersoonVan(gebruiker);

// Het instellingen-object dat omhoog gaat: een kopie; bij de eigen persoon met de globale laatsteStart (blitz_laatste_start),
// bij een ander zonder (het is een instelling van het toestel, niet van die persoon).
function lichaamVoor(persoon, instellingen, gebruiker, opslag) {
  const kopie = { ...instellingen };
  if (!isEigen(persoon, gebruiker)) { delete kopie.laatsteStart; return kopie; }
  const l = leesTekst(opslag, LAATSTE_START_SLEUTEL);
  if (isTijd(l)) kopie.laatsteStart = l;
  return kopie;
}

// Eén PUT, geclassificeerd: { ok } of { ok:false, reden }.
//   403 geen-recht · 404 geen-account · 400/422 ongeldig (de server weigert de waarde: opnieuw proberen heeft geen zin)
//   al het andere (geen verbinding, time-out, 5xx, 429, 401 na een mislukte herlogin) is 'netwerk': later opnieuw.
function naarReden(status) {
  if (status === 403) return 'geen-recht';
  if (status === 404) return 'geen-account';
  if (status === 400 || status === 422) return 'ongeldig';
  return 'netwerk';
}
async function stuur(verstuur, lichaam) {
  try {
    const r = await verstuur(lichaam);
    if (r?.ok) return { ok: true };
    return { ok: false, reden: naarReden(r?.status) };
  } catch (fout) {
    return { ok: false, reden: naarReden(typeof fout?.status === 'number' ? fout.status : 0) };
  }
}
// Verwerkt de uitkomst voor de vuil-markering. geen-recht en geen-account zijn definitief: de markering verdwijnt (anders blijft de
// persoon voor altijd vastzitten op een lokale waarde die nooit meer omhoog mag); enkel 'netwerk' markeert.
function verwerkUitkomst(opslag, persoon, r) {
  if (r.ok || r.reden === 'geen-recht' || r.reden === 'geen-account' || r.reden === 'ongeldig') zetVuil(opslag, persoon, false);
  else zetVuil(opslag, persoon, true);
}

// Zoekt het gebruikerId van een technieker in de overzicht-cache (exact, daarna zonder hoofdletters/spaties).
function idVoorTechnieker(naam) {
  const t = overzichtCache?.techniekers || {};
  if (Object.hasOwn(t, naam)) return t[naam];
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const sleutel = Object.keys(t).find(k => norm(k) === norm(naam));
  return sleutel === undefined ? null : t[sleutel];
}

export async function synchroniseerInstellingen(gebruiker, { apiJson = standaardApiJson, opslag = globalThis.localStorage } = {}) {
  let overzicht;
  try { overzicht = await apiJson(`${PAD}?overzicht=1`); } catch { return; } // geen verbinding of 503: de app start met de lokale cache
  if (!isObject(overzicht) || !isObject(overzicht.eigen)) return;

  const mijnId = typeof gebruiker?.id === 'string' && gebruiker.id ? gebruiker.id : overzicht.eigen.gebruikerId;
  if (typeof mijnId !== 'string' || !mijnId) return;

  // De lokale cache hoort bij een ANDER: weg, ook de vuil-markering (nooit als de mijne omhoog).
  const marker = leesTekst(opslag, MARKER_SLEUTEL);
  if (marker !== null && marker !== mijnId) wisInstellingen(opslag);

  const eigenPersoon = eigenPersoonVan(gebruiker);
  const techniekers = isObject(overzicht.techniekers) ? overzicht.techniekers : {};
  overzichtCache = { eigenId: mijnId, eigenPersoon, techniekers: {} };
  for (const [naam, t] of Object.entries(techniekers)) {
    if (isObject(t) && typeof t.gebruikerId === 'string') overzichtCache.techniekers[naam] = t.gebruikerId;
  }

  const verstuur = lichaam => apiJson(PAD, { methode: 'PUT', body: lichaam }).then(() => ({ ok: true }), (f) => ({ ok: false, status: f?.status }));
  // Wie staat er in het overzicht: ik (eigenPersoon) en de techniekers (een technieker staat er ook zelf in; dubbel overslaan).
  const personen = [{ persoon: eigenPersoon, id: mijnId, server: isObject(overzicht.eigen.instellingen) ? overzicht.eigen.instellingen : null, eigen: true }];
  for (const [naam, t] of Object.entries(techniekers)) {
    if (naam === eigenPersoon || !isObject(t) || typeof t.gebruikerId !== 'string') continue;
    personen.push({ persoon: naam, id: t.gebruikerId, server: isObject(t.instellingen) ? t.instellingen : null, eigen: false });
  }

  // Ronde 1: mislukte PUT's van vroeger. Eerst ALLE vuile lokale waarden omhoog, vóór er iets van de server in de opslag komt;
  // enkel bij succes of een definitieve weigering mag de server voor die persoon weer winnen.
  const vuil = leesVuil(opslag);
  const blijftLokaal = new Set();
  for (const { persoon, id, eigen } of personen) {
    if (vuil[persoon] !== true) continue;
    const lokaal = leesJson(opslag, settingsKey(persoon));
    if (!lokaal) { zetVuil(opslag, persoon, false); continue; } // niets (meer) om op te laden
    const r = await stuur(verstuur, { ...(eigen ? {} : { gebruiker: id }), instellingen: lichaamVoor(persoon, lokaal, gebruiker, opslag) });
    verwerkUitkomst(opslag, persoon, r);
    if (r.ok || r.reden === 'netwerk') blijftLokaal.add(persoon); // gelukt: lokaal = server; netwerk: lokaal blijft staan, niets overschrijven
  }
  // Ronde 2: de server is de bron; of, voor mij, de eenmalige overgang van een lokale waarde.
  for (const { persoon, server, eigen } of personen) {
    if (blijftLokaal.has(persoon)) continue;
    const sleutel = settingsKey(persoon);
    if (server) {
      schrijfTekst(opslag, sleutel, JSON.stringify(server));
      if (eigen && isTijd(server.laatsteStart)) schrijfTekst(opslag, LAATSTE_START_SLEUTEL, server.laatsteStart);
    } else if (eigen) {
      // De server heeft nog niets van mij maar lokaal staat er iets (en het is het mijne: een andere eigenaar is al gewist).
      const lokaal = leesJson(opslag, sleutel);
      if (lokaal && Object.keys(lokaal).length) await stuur(verstuur, { instellingen: lichaamVoor(persoon, lokaal, gebruiker, opslag) }); // mislukt: volgende start opnieuw
    }
  }
  schrijfTekst(opslag, MARKER_SLEUTEL, mijnId);
}

// Bewaart de instellingen van `persoon` op de server. Faalt nooit hard: geeft { ok } of { ok:false, reden } terug.
export async function bewaarOpServer(persoon, instellingen, gebruiker, { apiVerzoek = standaardApiVerzoek, opslag = globalThis.localStorage } = {}) {
  const eigen = isEigen(persoon, gebruiker);
  let doelId = null;
  if (eigen) doelId = gebruiker?.id ?? overzichtCache?.eigenId ?? null;
  else if (overzichtCache) doelId = idVoorTechnieker(persoon);
  else { // overzicht nog niet geladen (offline start): later opladen via de vuil-markering
    zetVuil(opslag, persoon, true);
    return { ok: false, reden: 'netwerk' };
  }
  if (!doelId) return { ok: false, reden: 'geen-account' };

  const r = await stuur(
    lichaam => apiVerzoek(PAD, { methode: 'PUT', body: lichaam }),
    { ...(eigen ? {} : { gebruiker: doelId }), instellingen: lichaamVoor(persoon, instellingen, gebruiker, opslag) },
  );
  verwerkUitkomst(opslag, persoon, r);
  return r;
}
