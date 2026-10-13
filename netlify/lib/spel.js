// Serverkant van "Blitz Run": de voortgang per gebruiker (beste score, ontgrendelde skins, gekozen skin), één record per
// gebruikers-id onder de sleutel `spel/<id>` in de store van het verzoek. De regels (SKINS, drempels, wat een skin ontgrendelt)
// komen uit public/js/spel/spel-regels.js en skins.js: dezelfde bestanden als de client, dus nooit uit elkaar gelopen.
import { wijzigBlob } from './blob-wijzig.js';
import { SKINS, standaardSkin } from '../../public/js/spel/skins.js';
import { MAX_SCORE, SCORE_SCHAAL, naNieuweSchaal, geldigeScore, ontgrendeldeSkins, schoonVoortgang } from '../../public/js/spel/spel-regels.js';

export { MAX_SCORE };

const geldigId = (id) => typeof id === 'string' && /^[\w.@-]{1,128}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
export const spelSleutel = (id) => `spel/${id}`;

const isObject = (b) => Boolean(b) && typeof b === 'object' && !Array.isArray(b);

// Het record van een gebruiker zoals de speler het ziet: wat bewaard is, aangevuld met wat nú ontgrendeld is
// (score-skins volgens de drempel, event-skins van de op `evenementen` actieve events). Schrijft niets.
export function voortgangVan(record, evenementen = []) {
  const basis = schoonVoortgang(isObject(record) ? naNieuweSchaal(record) : null, SKINS); // oude records: score omgerekend naar schaal 2
  const ontgrendeld = ontgrendeldeSkins({ besteScore: basis.besteScore, bewaard: basis.ontgrendeld, evenementen, skins: SKINS });
  return { besteScore: basis.besteScore, ontgrendeld, gekozenSkin: ontgrendeld.includes(basis.gekozenSkin) ? basis.gekozenSkin : standaardSkin() };
}

export async function leesSpel(store, gebruikerId, evenementen = []) {
  if (!geldigId(gebruikerId)) throw new Error('spel: ongeldig gebruikers-id');
  const record = await store.get(spelSleutel(gebruikerId), { type: 'json' });
  const voortgang = voortgangVan(record, evenementen);
  // Een event-skin die nu voor het eerst open is, meteen bewaren: wie het spel enkel tijdens het event opent, houdt hem.
  // Best-effort: een schrijffout mag de GET nooit breken.
  const eerder = new Set(schoonVoortgang(isObject(record) ? naNieuweSchaal(record) : null, SKINS).ontgrendeld);
  const nieuwEvent = voortgang.ontgrendeld.filter(id => !eerder.has(id) && SKINS.some(s => s.id === id && s.soort === 'event'));
  if (nieuwEvent.length) {
    try {
      await wijzigBlob(store, spelSleutel(gebruikerId), {
        leeg: {},
        wijzig: (blob) => {
          const huidig = schoonVoortgang(isObject(blob) && Object.keys(blob).length ? naNieuweSchaal(blob) : null, SKINS);
          const ontgrendeld = ontgrendeldeSkins({ besteScore: huidig.besteScore, bewaard: [...huidig.ontgrendeld, ...nieuwEvent], evenementen, skins: SKINS });
          if (ontgrendeld.length === huidig.ontgrendeld.length) return null;
          return { besteScore: huidig.besteScore, ontgrendeld, gekozenSkin: huidig.gekozenSkin, schaal: SCORE_SCHAAL };
        },
      });
    } catch (e) {
      console.error('spel: event-skin bewaren mislukt (' + (e?.name || 'Error') + ')');
    }
  }
  return voortgang;
}

// Controleert een inzending { score, gekozenSkin? }. Geeft { fout } (Nederlands) of { score, gekozenSkin }.
export function valideerInzending(body) {
  if (!isObject(body)) return { fout: 'Ongeldige invoer.' };
  const score = geldigeScore(body.score);
  if (score === null) return { fout: `Ongeldige score (een getal van 0 tot ${MAX_SCORE}).` };
  // Een onbekende skin weigert de inzending niet: de score telt altijd; de skin-keuze wordt genegeerd (`skinGeweigerd`).
  if (body.gekozenSkin !== undefined && (typeof body.gekozenSkin !== 'string' || !SKINS.some(s => s.id === body.gekozenSkin))) {
    return { score, gekozenSkin: undefined, skinGeweigerd: true };
  }
  return { score, gekozenSkin: body.gekozenSkin };
}

// Verwerkt een inzending: beste score = max, score-skins volgens de drempel, event-skins enkel als het event nu actief is.
// Een gekozen skin moet ontgrendeld zijn (ná deze inzending), anders wordt enkel de skin genegeerd en meldt het antwoord `skinGeweigerd: true`.
// Geeft { ok: true, voortgang }.
export async function bewaarSpel(store, gebruikerId, { score, gekozenSkin, skinGeweigerd: skinAlGeweigerd = false }, { evenementen = [], nu = () => Date.now() } = {}) {
  if (!geldigId(gebruikerId)) throw new Error('spel: ongeldig gebruikers-id');
  let skinGeweigerd = skinAlGeweigerd;
  let uitkomst = null;
  const r = await wijzigBlob(store, spelSleutel(gebruikerId), {
    leeg: {},
    wijzig: (blob) => {
      skinGeweigerd = skinAlGeweigerd;
      const huidig = schoonVoortgang(isObject(blob) && Object.keys(blob).length ? naNieuweSchaal(blob) : null, SKINS);
      const besteScore = Math.max(huidig.besteScore, score);
      const ontgrendeld = ontgrendeldeSkins({ besteScore, bewaard: huidig.ontgrendeld, evenementen, skins: SKINS });
      // Een vergrendelde skin weigert de inzending NIET (de score gaat nooit verloren): de keuze wordt genegeerd en de vorige skin blijft.
      const toegestaan = gekozenSkin !== undefined && ontgrendeld.includes(gekozenSkin);
      if (gekozenSkin !== undefined && !toegestaan) skinGeweigerd = true;
      const nieuw = { besteScore, ontgrendeld, gekozenSkin: toegestaan ? gekozenSkin : huidig.gekozenSkin, schaal: SCORE_SCHAAL, bijgewerkt: new Date(nu()).toISOString() };
      uitkomst = nieuw;
      return nieuw;
    },
  });
  if (!r.ok) throw new Error('spel: schrijven mislukt na herhaling');
  const voortgang = voortgangVan(uitkomst ?? r.waarde, evenementen);
  return { ok: true, voortgang: skinGeweigerd ? { ...voortgang, skinGeweigerd: true } : voortgang };
}
