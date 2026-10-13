// kern/versiering-thema.js — welk kleurthema (donker/licht) geldt tijdens een feestelijk evenement (puur: opslag en klok worden meegegeven).
// Regel (besluit Brent): tijdens het Halloween-thema is het toestel standaard DONKER, ook als `blitz_theme` 'light' bevat. Die sleutel
// wordt hiervoor nooit overschreven. Wisselt de gebruiker tijdens het evenement van thema, dan staat die keuze apart per evenement
// en jaar (`blitz_theme_<thema>_<jaar>`) en geldt tot het einde van het evenement. Daarna (of met de versiering uit) geldt weer `blitz_theme`.
export const THEMA_SLEUTEL = 'blitz_theme';

export const eventThemaSleutel = (thema, jaar) => `blitz_theme_${thema}_${jaar}`;

const geldig = (w) => (w === 'light' || w === 'dark' ? w : null);
function lees(opslag, sleutel) { try { return opslag?.getItem(sleutel) ?? null; } catch { return null; } }

// Invoer: { actief: bool, thema, jaar, opslag }. Antwoord: 'dark' | 'light'.
export function kiesThema({ actief, thema, jaar, opslag } = {}) {
  if (actief && thema) return geldig(lees(opslag, eventThemaSleutel(thema, jaar))) ?? 'dark';
  return geldig(lees(opslag, THEMA_SLEUTEL)) ?? 'dark';
}

// Bewaart een themawissel van de gebruiker op de juiste plek. Antwoord: de sleutel die geschreven is, of null bij een fout.
export function bewaarThemaKeuze({ actief, thema, jaar, opslag, keuze }) {
  const sleutel = actief && thema ? eventThemaSleutel(thema, jaar) : THEMA_SLEUTEL;
  try { opslag.setItem(sleutel, keuze); return sleutel; } catch { return null; }
}
