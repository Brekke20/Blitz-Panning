// kern/versiering-thema.js — welk kleurthema (donker/licht) geldt tijdens een feestelijk thema (puur: opslag en klok worden meegegeven).
// Regel (besluit Brent): tijdens een thema geldt het standaardthema van het pakket (`kleuren.voorkeurThema`: 'donker' | 'licht';
// null = de eigen keuze `blitz_theme`). Halloween heeft 'donker': standaard donker, ook als `blitz_theme` 'light' bevat. Die sleutel
// wordt hiervoor nooit overschreven. Wisselt de gebruiker tijdens het thema, dan staat die keuze apart per thema-id en jaar
// (`blitz_theme_<id>_<jaar>`) en geldt tot het einde van het thema. Daarna (of met de versiering uit) geldt weer `blitz_theme`.
// Het inline script in index.html spiegelt deze regel voor de eerste schermopbouw (uit `blitz_thema_actief`).
export const THEMA_SLEUTEL = 'blitz_theme';

export const eventThemaSleutel = (thema, jaar) => `blitz_theme_${thema}_${jaar}`;

const geldig = (w) => (w === 'light' || w === 'dark' ? w : null);
const VOORKEUR = { donker: 'dark', licht: 'light' };
function lees(opslag, sleutel) { try { return opslag?.getItem(sleutel) ?? null; } catch { return null; } }

// Invoer: { actief: bool, thema: id, voorkeurThema, jaar, opslag }. Antwoord: 'dark' | 'light'.
export function kiesThema({ actief, thema, voorkeurThema = null, jaar, opslag } = {}) {
  const eigen = geldig(lees(opslag, THEMA_SLEUTEL)) ?? 'dark';
  if (!actief || !thema) return eigen;
  const standaard = Object.hasOwn(VOORKEUR, voorkeurThema ?? '') ? VOORKEUR[voorkeurThema] : eigen;
  return geldig(lees(opslag, eventThemaSleutel(thema, jaar))) ?? standaard;
}

// Bewaart een themawissel van de gebruiker op de juiste plek. Antwoord: de sleutel die geschreven is, of null bij een fout.
export function bewaarThemaKeuze({ actief, thema, jaar, opslag, keuze }) {
  const sleutel = actief && thema ? eventThemaSleutel(thema, jaar) : THEMA_SLEUTEL;
  try { opslag.setItem(sleutel, keuze); return sleutel; } catch { return null; }
}
