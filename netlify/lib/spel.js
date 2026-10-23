// Serverkant van "Blitz Run": de voortgang per gebruiker (beste score, ontgrendelde skins, gekozen skin), één record per
// gebruikers-id onder de sleutel `spel/<id>` in de store van het verzoek. De regels (BASIS_SKINS, drempels, wat een skin ontgrendelt)
// komen uit public/js/spel/spel-regels.js en skins.js: dezelfde bestanden als de client, dus nooit uit elkaar gelopen.
//
// Themaskins komen uit de themapakketten: de skin-id is het thema-id. De server kent ze via `themas/index` in dezelfde store
// (`leesThemaBron`): `{ skins, actieveThemaIds }`. Een themaskin is nieuw te ontgrendelen zolang zijn thema actief is (aan en binnen
// zijn periode op de serverdatum in Europe/Brussels); wie hem al had, houdt hem voor altijd. De server tekent niets, dus de skins
// van de bron zijn enkel { id, naam, soort: 'thema' }: de pakketten zelf worden hier niet gelezen.
import { wijzigBlob } from './blob-wijzig.js';
import { zaai } from './themas.js';
import { isActief } from '../../public/js/kern/themapakket.js';
import { BASIS_SKINS, standaardSkin } from '../../public/js/spel/skins.js';
import {
  MAX_SCORE, SCORE_SCHAAL, naNieuweSchaal, geldigeScore, ontgrendeldeSkins, schoonVoortgang, isThemaSkinId, onbekendeThemaIds,
} from '../../public/js/spel/spel-regels.js';

export { MAX_SCORE };

const geldigId = (id) => typeof id === 'string' && /^[\w.@-]{1,128}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
export const spelSleutel = (id) => `spel/${id}`;

const isObject = (b) => Boolean(b) && typeof b === 'object' && !Array.isArray(b);

// Geen enkel bekend thema: enkel de basisskins en goud.
export const LEGE_BRON = Object.freeze({ skins: Object.freeze([]), actieveThemaIds: Object.freeze([]) });

// Een bron (van de standaardlezer of een test) naar zijn vaste vorm: `skins` = de basisskins plus de themaskins (soort 'thema', geldig id,
// ontdubbeld); `actieveThemaIds` = enkel geldige thema-id's. Onzin geeft een lege bron.
export function normaliseerBron(bron) {
  const b = isObject(bron) ? bron : {};
  const gezien = new Set();
  const thema = [];
  for (const s of Array.isArray(b.skins) ? b.skins : []) {
    if (!isObject(s) || s.soort !== 'thema' || !isThemaSkinId(s.id) || gezien.has(s.id)) continue;
    gezien.add(s.id);
    thema.push({ id: s.id, naam: typeof s.naam === 'string' ? s.naam : s.id, soort: 'thema', themaNaam: typeof s.themaNaam === 'string' ? s.themaNaam : s.naam });
  }
  const actief = [...new Set((Array.isArray(b.actieveThemaIds) ? b.actieveThemaIds : []).filter(isThemaSkinId))];
  return { skins: [...BASIS_SKINS, ...thema], actieveThemaIds: actief };
}

// De standaardbron: leest `themas/index` (en zaait de voorgeladen themas als dat nog niet gebeurde) uit de store van het verzoek.
// `datum` = 'YYYY-MM-DD' (Europe/Brussels) of een Date. Een indexregel met een onbruikbare periode telt als niet actief (en verstoort niets).
// Gooit bij een leesfout van de index: de aanroeper (de handler) valt dan terug op `LEGE_BRON`.
export async function leesThemaBron(store, datum) {
  const index = await zaai(store);
  const dag = datum instanceof Date ? datum : new Date(`${datum}T12:00:00+01:00`);
  const skins = [];
  const actieveThemaIds = [];
  for (const t of index.themas) {
    if (!isThemaSkinId(t.id)) continue;
    skins.push({ id: t.id, naam: typeof t.naam === 'string' ? t.naam : t.id, soort: 'thema', themaNaam: t.naam });
    try {
      if (isActief(t, dag)) actieveThemaIds.push(t.id);
    } catch (e) {
      console.error('spel: indexregel overgeslagen (' + (e?.name || 'Error') + ', id ' + String(t.id).slice(0, 30) + ')');
    }
  }
  return { skins, actieveThemaIds };
}

// De ontgrendelde skins van een record: wat de regels zeggen, plus de geldige thema-id's uit het bewaarde record die de bron niet kent
// (een themaskin wordt nooit vergeten, ook niet als de themas-opslag even leeg of onleesbaar is).
function ontgrendeldVan({ besteScore, bewaard, rauw, bron, extra = [] }) {
  const lijst = ontgrendeldeSkins({ besteScore, bewaard: [...bewaard, ...extra], actieveThemaIds: bron.actieveThemaIds, skins: bron.skins });
  return [...lijst, ...onbekendeThemaIds(rauw, bron.skins)];
}

const rauweLijst = (record) => (isObject(record) && Array.isArray(record.ontgrendeld) ? record.ontgrendeld : []);

// Een eerder gekozen skin die de bron niet kent maar wel geldig is (zie boven) blijft in het bewaarde record staan zolang er niets anders gekozen wordt.
const bewaardeKeuze = (record, huidig, bron) => {
  const k = isObject(record) ? record.gekozenSkin : undefined;
  return isThemaSkinId(k) && !bron.skins.some(s => s.id === k) && rauweLijst(record).includes(k) ? k : huidig.gekozenSkin;
};

// Het record van een gebruiker zoals de speler het ziet: wat bewaard is, aangevuld met wat nú ontgrendeld is
// (score-skins volgens de drempel, themaskins van de op `bron` actieve thema's). Schrijft niets.
export function voortgangVan(record, bron = LEGE_BRON) {
  const b = normaliseerBron(bron);
  const basis = schoonVoortgang(isObject(record) ? naNieuweSchaal(record) : null, b.skins); // oude records: score omgerekend naar schaal 2
  const ontgrendeld = ontgrendeldVan({ besteScore: basis.besteScore, bewaard: basis.ontgrendeld, rauw: rauweLijst(record), bron: b });
  // Een bewaarde themakeuze die de bron nu niet kent (themas onleesbaar of niet in de index) wordt gewoon gemeld: ze staat nog in het record,
  // en de client tekent zelf een terugval. Zo ziet de speler zijn keuze niet verdwijnen en schrijft zijn volgende inzending hem niet over.
  const bewaard = bewaardeKeuze(record, basis, b);
  const gekozenSkin = ontgrendeld.includes(bewaard) ? bewaard : standaardSkin();
  return { besteScore: basis.besteScore, ontgrendeld, gekozenSkin };
}

export async function leesSpel(store, gebruikerId, bron = LEGE_BRON) {
  if (!geldigId(gebruikerId)) throw new Error('spel: ongeldig gebruikers-id');
  const b = normaliseerBron(bron);
  const record = await store.get(spelSleutel(gebruikerId), { type: 'json' });
  const voortgang = voortgangVan(record, b);
  // Een themaskin die nu voor het eerst open is, meteen bewaren: wie het spel enkel tijdens het thema opent, houdt hem.
  // Best-effort: een schrijffout mag de GET nooit breken.
  const eerder = new Set(rauweLijst(record));
  const nieuwThema = voortgang.ontgrendeld.filter(id => !eerder.has(id) && b.skins.some(s => s.id === id && s.soort === 'thema'));
  if (nieuwThema.length) {
    try {
      await wijzigBlob(store, spelSleutel(gebruikerId), {
        leeg: {},
        wijzig: (blob) => {
          const heeftData = isObject(blob) && Object.keys(blob).length;
          const huidig = schoonVoortgang(heeftData ? naNieuweSchaal(blob) : null, b.skins);
          const ontgrendeld = ontgrendeldVan({ besteScore: huidig.besteScore, bewaard: huidig.ontgrendeld, rauw: rauweLijst(blob), bron: b, extra: nieuwThema });
          const bekend = new Set(rauweLijst(blob));
          if (ontgrendeld.every(id => bekend.has(id))) return null;
          return { besteScore: huidig.besteScore, ontgrendeld, gekozenSkin: bewaardeKeuze(blob, huidig, b), schaal: SCORE_SCHAAL };
        },
      });
    } catch (e) {
      console.error('spel: themaskin bewaren mislukt (' + (e?.name || 'Error') + ')');
    }
  }
  return voortgang;
}

// Controleert een inzending { score, gekozenSkin? }. Geeft { fout } (Nederlands) of { score, gekozenSkin }.
// `skins`: de skins die de server kent (standaard enkel de basis; de handler geeft de basis plus de themaskins mee).
export function valideerInzending(body, skins = BASIS_SKINS) {
  if (!isObject(body)) return { fout: 'Ongeldige invoer.' };
  const score = geldigeScore(body.score);
  if (score === null) return { fout: `Ongeldige score (een getal van 0 tot ${MAX_SCORE}).` };
  // Een onbekende skin weigert de inzending niet: de score telt altijd; de skin-keuze wordt genegeerd (`skinGeweigerd`).
  if (body.gekozenSkin !== undefined && (typeof body.gekozenSkin !== 'string' || !skins.some(s => s.id === body.gekozenSkin))) {
    return { score, gekozenSkin: undefined, skinGeweigerd: true };
  }
  return { score, gekozenSkin: body.gekozenSkin };
}

// Verwerkt een inzending: beste score = max, score-skins volgens de drempel, themaskins enkel als hun thema nu actief is.
// Een gekozen skin moet ontgrendeld zijn (ná deze inzending), anders wordt enkel de skin genegeerd en meldt het antwoord `skinGeweigerd: true`.
// Geeft { ok: true, voortgang }.
export async function bewaarSpel(store, gebruikerId, { score, gekozenSkin, skinGeweigerd: skinAlGeweigerd = false }, { bron = LEGE_BRON, nu = () => Date.now() } = {}) {
  if (!geldigId(gebruikerId)) throw new Error('spel: ongeldig gebruikers-id');
  const b = normaliseerBron(bron);
  let skinGeweigerd = skinAlGeweigerd;
  let uitkomst = null;
  const r = await wijzigBlob(store, spelSleutel(gebruikerId), {
    leeg: {},
    wijzig: (blob) => {
      skinGeweigerd = skinAlGeweigerd;
      const heeftData = isObject(blob) && Object.keys(blob).length;
      const huidig = schoonVoortgang(heeftData ? naNieuweSchaal(blob) : null, b.skins);
      const besteScore = Math.max(huidig.besteScore, score);
      const ontgrendeld = ontgrendeldVan({ besteScore, bewaard: huidig.ontgrendeld, rauw: rauweLijst(blob), bron: b });
      // Een vergrendelde skin weigert de inzending NIET (de score gaat nooit verloren): de keuze wordt genegeerd en de vorige skin blijft.
      // Kiezen mag enkel wat de server kent (en dus kan tekenen) en wat ontgrendeld is.
      const toegestaan = gekozenSkin !== undefined && b.skins.some(s => s.id === gekozenSkin) && ontgrendeld.includes(gekozenSkin);
      if (gekozenSkin !== undefined && !toegestaan) skinGeweigerd = true;
      const nieuw = { besteScore, ontgrendeld, gekozenSkin: toegestaan ? gekozenSkin : bewaardeKeuze(blob, huidig, b), schaal: SCORE_SCHAAL, bijgewerkt: new Date(nu()).toISOString() };
      uitkomst = nieuw;
      return nieuw;
    },
  });
  if (!r.ok) throw new Error('spel: schrijven mislukt na herhaling');
  const voortgang = voortgangVan(uitkomst ?? r.waarde, b);
  return { ok: true, voortgang: skinGeweigerd ? { ...voortgang, skinGeweigerd: true } : voortgang };
}
