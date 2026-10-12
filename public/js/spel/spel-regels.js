// spel/spel-regels.js — de gedeelde regels van "Blitz Run": client én server (netlify/lib/spel.js) importeren dit bestand,
// zodat de ontgrendelregels nooit uit elkaar lopen. Puur: geen DOM, geen window, geen opslag.
import { SKINS, standaardSkin } from './skins.js';

export const MAX_SCORE = 100000; // hoogste score die in één inzending geaccepteerd wordt (ruim 20 minuten non-stop op topsnelheid)

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

// Welke skins zijn ontgrendeld. `evenementen` = de actieve evenementen { id, spelSkin? } (injecteerbaar, zie evenementen.js).
// - basis: altijd; goud: besteScore >= drempel; event: het event van de skin is actief (eventId, of de skin staat als spelSkin bij een actief event)
// - `bewaard`: eerder ontgrendelde ids (een event-skin blijft na afloop van het event van de speler)
export function ontgrendeldeSkins({ besteScore = 0, bewaard = [], evenementen = [], skins = SKINS } = {}) {
  const actief = Array.isArray(evenementen) ? evenementen.filter(e => e && typeof e === 'object') : [];
  const eventIds = new Set(actief.map(e => e.id).filter(isId));
  const eventSkins = new Set(actief.map(e => e.spelSkin).filter(isId));
  const eerder = new Set(Array.isArray(bewaard) ? bewaard.filter(isId) : []);
  const uit = [];
  for (const s of skins) {
    let open = false;
    if (s.soort === 'basis') open = true;
    else if (s.soort === 'goud') open = typeof s.drempel === 'number' && besteScore >= s.drempel;
    else if (s.soort === 'event') open = eventIds.has(s.eventId) || eventSkins.has(s.id);
    if (open || eerder.has(s.id)) uit.push(s.id);
  }
  return uit;
}

// De tekst bij een vergrendelde skin: "vanaf 1500 punten" of "Halloween-event".
export function ontgrendelVoorwaarde(skin) {
  if (skin?.soort === 'goud' && typeof skin.drempel === 'number') return `vanaf ${skin.drempel} punten`;
  if (skin?.soort === 'event') {
    const naam = String(skin.eventId ?? 'Speciaal');
    return `${naam.charAt(0).toUpperCase()}${naam.slice(1)}-event`;
  }
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
