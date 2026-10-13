// kern/versiering-logica.js — de beslissingen achter de feestelijke versiering (puur: geen DOM, geen window; opslag en klok
// worden meegegeven). De DOM-kant staat in schermen/evenement-laag.js.
//
// Regels (besluit Brent):
//  - De voorkeur is PER TOESTEL (localStorage 'blitz_versiering'): 'uit' of afwezig (= automatisch). Standaard AAN tijdens een
//    evenementvenster; de gebruiker kan het uitzetten en die keuze blijft staan. Buiten een venster toont niets iets.
//  - In testmodus (?test) staat de versiering uit, tenzij de test `?versiering=aan` meegeeft (die vlag telt ENKEL in testmodus).
//  - Op een aanraakscherm, gsm of tablet is de versiering sober: statische webben en kleur, niets dat beweegt.
//  - prefers-reduced-motion: niets beweegt.
import { actiefEvenement, MAX_SPINNEN } from './evenementen.js';

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

// Wat er getoond wordt. Invoer: { nu: Date, voorkeur: 'uit'|'auto', testMode, testForceer, soort, aanraak, reducedMotion }.
// Antwoord: { actief, evenement, thema, sober, beweging, spinnen }.
export function beslis({ nu, voorkeur = 'auto', testMode = false, testForceer = false, soort, aanraak, reducedMotion = false } = {}) {
  const geen = { actief: false, evenement: null, thema: null, sober: isSober({ soort, aanraak }), beweging: false, spinnen: 0 };
  if (voorkeur === 'uit') return geen;
  if (testMode && !testForceer) return geen;
  const evenement = actiefEvenement(nu);
  if (!evenement || !evenement.thema) return geen;
  const sober = geen.sober;
  const beweging = !sober && !reducedMotion;
  return { actief: true, evenement, thema: evenement.thema, sober, beweging, spinnen: beweging ? MAX_SPINNEN : 0 };
}

// v2.1.3 (prestaties): de bewegende delen lopen in korte actieve periodes met lange rustpauzes ertussen. Tijdens een rustpauze draait
// er GEEN requestAnimationFrame-lus en staan de CSS-animaties stil (klasse .ev-rust), zodat de pagina geen beelden meer aanmaakt.
// Tijdens een actieve periode rekent de lus ongeveer 30 keer per seconde (STAP_MS), niet 60.
export const FASE = Object.freeze({
  EERSTE_ACTIEF_MS: 20000,            // de eerste periode na de start: lang genoeg voor de eerste vlucht van de vleermuis
  ACTIEF_MS: Object.freeze([8000, 14000]),
  RUST_MS: Object.freeze([25000, 45000]),
  EERSTE_VLEERMUIS_MS: Object.freeze([4000, 12000]),
  VLEERMUIS_MS: Object.freeze([1000, 5000]),
  VLEERMUIS_KANS: 0.5,                // kans op een vlucht in een latere actieve periode (hoogstens één vlucht per periode)
  STAP_MS: 33,
});

// Plant één actieve periode en de rust erna. `vleermuisNaMs`: wanneer de vleermuis in deze periode vertrekt (null = niet).
export function planFase({ eerste = false, rng = Math.random } = {}) {
  const tussen = ([a, b]) => Math.round(a + rng() * (b - a));
  if (eerste) return { actiefMs: FASE.EERSTE_ACTIEF_MS, rustMs: tussen(FASE.RUST_MS), vleermuisNaMs: tussen(FASE.EERSTE_VLEERMUIS_MS) };
  const actiefMs = tussen(FASE.ACTIEF_MS);
  const rustMs = tussen(FASE.RUST_MS);
  const vleermuisNaMs = rng() < FASE.VLEERMUIS_KANS ? tussen(FASE.VLEERMUIS_MS) : null;
  return { actiefMs, rustMs, vleermuisNaMs };
}

// Mag de lus stoppen (rustpauze)? Nooit midden in een vlucht van de vleermuis; meteen als het spel open staat; anders na de actieve periode.
export function magRusten({ t, actiefTot, vliegt = false, spelOpen = false }) {
  if (vliegt) return false;
  return !!spelOpen || t >= actiefTot;
}

// Teksten voor lege toestanden per thema. Enkel voor "er is niets", nooit voor foutmeldingen of statussen.
export const LEGE_TEKSTEN = {
  halloween: {
    wachtrij: 'Geen spoken in de wachtrij.',
    ingepland: 'Geen spookbezoeken gepland deze week',
  },
};

export function legeTekst(thema, sleutel, standaard) {
  return LEGE_TEKSTEN[thema]?.[sleutel] ?? standaard;
}
