// spel/spel-regels.js — de gedeelde regels van "Blitz Run": client én server (netlify/lib/spel.js) importeren dit bestand,
// zodat de ontgrendelregels nooit uit elkaar lopen. Puur: geen DOM, geen window, geen opslag.
import { SKINS, standaardSkin, vrijgespeeld } from './skins.js';
import { BASIS_SKIN_IDS } from './skin-kleuren.js';

export const MAX_SCORE = 25000; // hoogste score die in één inzending geaccepteerd wordt (ruim 20 minuten non-stop op topsnelheid)

// Scoreschaal: v2.1.0 gaf 0,1 punt per eenheid afstand, v2.1.1 geeft er 0,025 (4x trager). Een record zonder `schaal: 2` is op de
// oude schaal bewaard; `naNieuweSchaal` rekent zijn beste score om (gedeeld door 4). Bewaarde skins blijven altijd open.
export const SCORE_SCHAAL = 2;
export const SCORE_DELER = 4;
export function naNieuweSchaal(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  if (record.schaal === SCORE_SCHAAL) return record;
  const oud = Number(record.besteScore);
  return { ...record, besteScore: Number.isFinite(oud) && oud > 0 ? Math.floor(oud / SCORE_DELER) : 0, schaal: SCORE_SCHAAL };
}

const isId = (x) => typeof x === 'string' && x !== '';

// Datum (YYYY-MM-DD) in Europe/Brussels voor een tijdstip in ms.
export function datumBrussel(nuMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nuMs));
}

// Geeft een geheel getal 0..MAX_SCORE, of null als de invoer geen geldige score is.
export function geldigeScore(x) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > MAX_SCORE) return null;
  return Math.floor(x);
}

// Welke skins zijn ontgrendeld. `actieveThemaIds` = de ids van de thema's die nu actief zijn (aan en binnen hun periode, op de serverdatum).
// - basis en goud: besteScore >= drempel (vrijgespeeld in skins.js; blitz heeft drempel 0); thema: het thema van de skin is actief (skin-id = thema-id)
// - `bewaard`: eerder ontgrendelde ids (een themaskin blijft na afloop van het thema van de speler)
// Ids in `bewaard` die niet in `skins` staan, worden hier weggelaten; wie ze toch wil bewaren (de server) gebruikt `onbekendeThemaIds`.
export function ontgrendeldeSkins({ besteScore = 0, bewaard = [], actieveThemaIds = [], skins = SKINS } = {}) {
  const actief = Array.isArray(actieveThemaIds) ? actieveThemaIds.filter(isId) : [];
  const eerder = new Set(Array.isArray(bewaard) ? bewaard.filter(isId) : []);
  const uit = [];
  for (const s of skins) {
    if (vrijgespeeld(s, { besteScore, actieveThemaIds: actief }) || eerder.has(s.id)) uit.push(s.id);
  }
  return uit;
}

// Is dit een geldig thema-id (en dus een mogelijke skin-id van een thema)? Hetzelfde formaat als `id` in een themapakket;
// de ingebouwde skin-id's (basis en goud) en gevaarlijke sleutelnamen zijn uitgesloten.
const THEMA_ID = /^[a-z0-9-]{2,30}$/;
const GERESERVEERD = new Set(['__proto__', 'constructor', 'prototype', ...BASIS_SKIN_IDS]);
export const isThemaSkinId = (x) => typeof x === 'string' && THEMA_ID.test(x) && !GERESERVEERD.has(x);

// De geldige thema-id's in `lijst` (een bewaarde `ontgrendeld`) die `skins` niet kent: themas worden nooit verwijderd, maar een
// server met een lege of onleesbare themas-opslag mag een eerder ontgrendelde themaskin toch niet vergeten. Ontdubbeld.
export function onbekendeThemaIds(lijst, skins = SKINS) {
  if (!Array.isArray(lijst)) return [];
  const bekend = new Set(skins.map(s => s.id));
  return [...new Set(lijst.filter(i => isThemaSkinId(i) && !bekend.has(i)))];
}

// De tekst bij een vergrendelde skin: "vanaf 250 punten" of "Halloween-thema".
export function ontgrendelVoorwaarde(skin) {
  if (skin?.soort === 'thema') {
    const naam = String(skin.themaNaam || skin.id || 'Speciaal');
    return `${naam.charAt(0).toUpperCase()}${naam.slice(1)}-thema`;
  }
  if (typeof skin?.drempel === 'number' && skin.drempel > 0) return `vanaf ${skin.drempel} punten`;
  return '';
}

export const leegVoortgang = () => ({ besteScore: 0, ontgrendeld: [standaardSkin()], gekozenSkin: standaardSkin() });

// Een voortgangsrecord (van server of cache) naar een veilige vorm; onbekende of ongeldige velden vallen terug op de standaard.
export function schoonVoortgang(r, skins = SKINS) {
  const basis = leegVoortgang();
  if (!r || typeof r !== 'object' || Array.isArray(r)) return basis;
  const ids = new Set(skins.map(s => s.id));
  const ontgrendeld = Array.isArray(r.ontgrendeld) ? [...new Set(r.ontgrendeld.filter(i => ids.has(i)))] : basis.ontgrendeld;
  const gekozen = ids.has(r.gekozenSkin) && ontgrendeld.includes(r.gekozenSkin) ? r.gekozenSkin : basis.gekozenSkin;
  return { besteScore: geldigeScore(r.besteScore) ?? 0, ontgrendeld: ontgrendeld.length ? ontgrendeld : basis.ontgrendeld, gekozenSkin: gekozen };
}

// Voegt twee inzendingen samen die nog verstuurd moeten worden (een mislukte inzending + een nieuwe): hoogste score, laatste skin.
export function voegWachtendSamen(oud, nieuw) {
  const score = Math.max(geldigeScore(oud?.score) ?? 0, geldigeScore(nieuw?.score) ?? 0);
  const gekozenSkin = nieuw?.gekozenSkin ?? oud?.gekozenSkin;
  return gekozenSkin === undefined ? { score } : { score, gekozenSkin };
}
