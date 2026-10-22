// kern/versiering-logica.js — de beslissingen achter de feestelijke versiering (puur: geen DOM, geen window; opslag, klok en
// themas worden meegegeven). De DOM-kant staat in schermen/evenement-laag.js.
//
// Regels (besluit Brent; spec thema's als pakket §2):
//  - Het thema komt uit de themapakketten (`themas: { index, pakketten }` van schermen/themas-bron.js): het actieve thema volgens
//    kern/themapakket.js (`actiefThema`: aan, binnen de periode, kortste periode wint). Zonder pakket in de cache: niets.
//  - De voorkeur is PER TOESTEL (localStorage 'blitz_versiering'): 'uit' of afwezig (= automatisch). 'uit' gaat voor alles.
//  - Een voorbeeld (Beheer → Thema's, enkel in het geheugen) gaat voor de testmodus, voor de schakelaar per toestel ('uit') en voor
//    `bewegingUit` (keuze controller 2026-10-22: de beheerder vroeg het zelf te zien, met de beweging die anderen zien); sober en
//    prefers-reduced-motion gelden ook voor een voorbeeld.
//  - In testmodus (?test) staat de versiering uit, tenzij de test `?versiering=aan` meegeeft (die vlag telt ENKEL in testmodus).
//  - Op een aanraakscherm, gsm of tablet is de versiering sober: enkel hoekbeelden en achtergrond, niets dat beweegt.
//  - prefers-reduced-motion: niets beweegt.
//  - `bewegingUit` (persoonlijke instelling "Bewegende beelden tijdens een thema", per account): niets beweegt, de rest blijft; de schakelaar
//    per toestel (voorkeur 'uit') gaat nog steeds voor alles.
import { actiefThema } from './themapakket.js';

export const VOORKEUR_SLEUTEL = 'blitz_versiering';

// 'uit' | 'auto'. Elke andere waarde (of een kapotte opslag) geldt als 'auto'.
export function leesVoorkeur(opslag) {
  try { return opslag?.getItem(VOORKEUR_SLEUTEL) === 'uit' ? 'uit' : 'auto'; } catch { return 'auto'; }
}

// Bewaart enkel de uitzondering: 'uit' wordt geschreven, 'auto' haalt de sleutel weg (dus de standaard blijft de standaard).
export function bewaarVoorkeur(opslag, voorkeur) {
  try {
    if (voorkeur === 'uit') opslag.setItem(VOORKEUR_SLEUTEL, 'uit');
    else opslag.removeItem(VOORKEUR_SLEUTEL);
    return true;
  } catch { return false; }
}

// Sober = geen bewegende elementen: aanraakscherm, of een toestel dat als gsm of tablet wordt behandeld.
export function isSober({ soort, aanraak } = {}) {
  return !!aanraak || soort === 'gsm' || soort === 'tablet';
}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Het pakket van het thema dat op `nu` actief is, of null.
function actiefPakket(nu, themas) {
  const lijst = Array.isArray(themas?.index?.themas) ? themas.index.themas : [];
  let thema = null;
  try { thema = actiefThema(nu, lijst); } catch { return null; }
  if (!thema || !isObject(themas.pakketten) || !Object.hasOwn(themas.pakketten, thema.id)) return null;
  const pakket = themas.pakketten[thema.id];
  return isObject(pakket) && pakket.id === thema.id ? pakket : null;
}

// Wat er getoond wordt. Invoer: { nu: Date, voorkeur: 'uit'|'auto', testMode, testForceer, soort, aanraak, reducedMotion,
// themas: { index, pakketten }, voorbeeld: pakket|null, bewegingUit: boolean }. Antwoord: { actief, thema: pakket|null, sober, beweging }.
export function beslis({ nu, voorkeur = 'auto', testMode = false, testForceer = false, soort, aanraak, reducedMotion = false, themas, voorbeeld = null, bewegingUit = false } = {}) {
  const sober = isSober({ soort, aanraak });
  const geen = { actief: false, thema: null, sober, beweging: false };
  const isVoorbeeld = isObject(voorbeeld);
  // Een voorbeeld (de beheerder vroeg er zelf om; keuze controller 2026-10-22) gaat ook voor de schakelaar per toestel en voor zijn
  // eigen "Bewegende beelden uit": een voorbeeld toont wat de anderen zien. Sober en reduced-motion gelden wel nog.
  if (voorkeur === 'uit' && !isVoorbeeld) return geen;
  let pakket = isVoorbeeld ? voorbeeld : null;
  if (!pakket) {
    if (testMode && !testForceer) return geen;
    pakket = actiefPakket(nu, themas);
  }
  if (!pakket) return geen;
  // bewegingUit (instelling van het account, enkel `true` telt): dezelfde stilstaande versiering als op een sober toestel.
  return { actief: true, thema: pakket, sober, beweging: !sober && !reducedMotion && (isVoorbeeld || bewegingUit !== true) };
}

// v2.1.3 (prestaties): de bewegende delen lopen met een timer-lus van ~30 beelden per seconde (niet 60).
export const STAP_MS = 33;

// Tekst voor een lege toestand ('wachtrijLeeg' | 'ingeplandLeeg') uit het pakket, anders de standaard. Enkel voor "er is niets",
// nooit voor foutmeldingen of statussen. Altijd als platte tekst te tonen (textContent of escHtml).
export function legeTekst(pakket, sleutel, standaard) {
  const teksten = isObject(pakket) && Object.hasOwn(pakket, 'teksten') ? pakket.teksten : null;
  const t = isObject(teksten) && Object.hasOwn(teksten, sleutel) ? teksten[sleutel] : undefined;
  return typeof t === 'string' && t !== '' ? t : standaard;
}

// Welk deel van de achtergrond getoond wordt: een staand scherm (breedte/hoogte < 1) met een `kijkvensterStaand` toont dat deel,
// rechts onder uitgelijnd; anders het geheel, onderaan gecentreerd (v2.2.0: het rechterdeel met maan en boerderij op een gsm).
export function kijkvenster(breedte, hoogte, achtergrond, viewBox) {
  const staand = hoogte > 0 && breedte / hoogte < 1;
  if (staand && typeof achtergrond?.kijkvensterStaand === 'string') return { viewBox: achtergrond.kijkvensterStaand, uitlijning: 'xMaxYMax slice' };
  return { viewBox, uitlijning: 'xMidYMax slice' };
}
