// Serverkant van "Blitz Run": de voortgang per gebruiker (beste score, ontgrendelde skins, gekozen skin), één record per
// gebruikers-id onder de sleutel `spel/<id>` in de store van het verzoek. De regels (SKINS, drempels, wat een skin ontgrendelt)
// komen uit public/js/spel/spel-regels.js en skins.js: dezelfde bestanden als de client, dus nooit uit elkaar gelopen.
import { wijzigBlob } from './blob-wijzig.js';
import { SKINS, standaardSkin } from '../../public/js/spel/skins.js';
import { MAX_SCORE, geldigeScore, ontgrendeldeSkins, schoonVoortgang } from '../../public/js/spel/spel-regels.js';

export { MAX_SCORE };

const geldigId = (id) => typeof id === 'string' && /^[\w.@-]{1,128}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
export const spelSleutel = (id) => `spel/${id}`;

const isObject = (b) => Boolean(b) && typeof b === 'object' && !Array.isArray(b);

// Het record van een gebruiker zoals de speler het ziet: wat bewaard is, aangevuld met wat nú ontgrendeld is
// (score-skins volgens de drempel, event-skins van de op `evenementen` actieve events). Schrijft niets.
export function voortgangVan(record, evenementen = []) {
  const basis = schoonVoortgang(isObject(record) ? record : null, SKINS);
  const ontgrendeld = ontgrendeldeSkins({ besteScore: basis.besteScore, bewaard: basis.ontgrendeld, evenementen, skins: SKINS });
  return { besteScore: basis.besteScore, ontgrendeld, gekozenSkin: ontgrendeld.includes(basis.gekozenSkin) ? basis.gekozenSkin : standaardSkin() };
}

export async function leesSpel(store, gebruikerId, evenementen = []) {
  if (!geldigId(gebruikerId)) throw new Error('spel: ongeldig gebruikers-id');
  return voortgangVan(await store.get(spelSleutel(gebruikerId), { type: 'json' }), evenementen);
}

// Controleert een inzending { score, gekozenSkin? }. Geeft { fout } (Nederlands) of { score, gekozenSkin }.
export function valideerInzending(body) {
  if (!isObject(body)) return { fout: 'Ongeldige invoer.' };
  const score = geldigeScore(body.score);
  if (score === null) return { fout: `Ongeldige score (een getal van 0 tot ${MAX_SCORE}).` };
  if (body.gekozenSkin !== undefined && (typeof body.gekozenSkin !== 'string' || !SKINS.some(s => s.id === body.gekozenSkin))) {
    return { fout: 'Onbekende skin.' };
  }
  return { score, gekozenSkin: body.gekozenSkin };
}

// Verwerkt een inzending: beste score = max, score-skins volgens de drempel, event-skins enkel als het event nu actief is.
// Een gekozen skin moet ontgrendeld zijn (ná deze inzending). Geeft { ok: true, voortgang } of { ok: false, fout }.
export async function bewaarSpel(store, gebruikerId, { score, gekozenSkin }, { evenementen = [], nu = () => Date.now() } = {}) {
  if (!geldigId(gebruikerId)) throw new Error('spel: ongeldig gebruikers-id');
  let weigering = null;
  let uitkomst = null;
  const r = await wijzigBlob(store, spelSleutel(gebruikerId), {
    leeg: {},
    wijzig: (blob) => {
      weigering = null;
      const huidig = schoonVoortgang(isObject(blob) && Object.keys(blob).length ? blob : null, SKINS);
      const besteScore = Math.max(huidig.besteScore, score);
      const ontgrendeld = ontgrendeldeSkins({ besteScore, bewaard: huidig.ontgrendeld, evenementen, skins: SKINS });
      if (gekozenSkin !== undefined && !ontgrendeld.includes(gekozenSkin)) { weigering = 'Deze skin is nog niet ontgrendeld.'; return null; }
      const nieuw = { besteScore, ontgrendeld, gekozenSkin: gekozenSkin ?? huidig.gekozenSkin, bijgewerkt: new Date(nu()).toISOString() };
      uitkomst = nieuw;
      return nieuw;
    },
  });
  if (weigering) return { ok: false, fout: weigering };
  if (!r.ok) throw new Error('spel: schrijven mislukt na herhaling');
  return { ok: true, voortgang: voortgangVan(uitkomst ?? r.waarde, evenementen) };
}
