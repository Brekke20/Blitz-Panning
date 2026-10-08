// schermen/sales-detail-logica.js — logica van het leaddetail: velden nakijken, vast uur controleren, botsingen zoeken (puur, geen DOM).
import { isVast, isGeldigeDatum, isGeldigUur } from '../sales/lead-regels.js';
import { isHeleDag } from '../sales/blok-regels.js';
import { timeStrToMin } from '../kern/tijd.js';
import { naamVan } from './sales-tekst.js';

const MIN_DUUR_MIN = 15;
const BLOK_LABEL = { verlof: 'Verlof', kantoor: 'Kantoor', afspraak: 'Afspraak' };

const tekst = (x) => (x == null ? '' : String(x).trim());
const leegNaarNull = (s) => (s === '' ? null : s);

/** { straat, huisnr, postcode, gemeente, notitie, duurMin } -> { fout } of { velden } (getrimd, leeg = null, duurMin getal of null). */
export function valideerDetail(invoer) {
  const straat = tekst(invoer?.straat);
  const huisnr = tekst(invoer?.huisnr);
  const postcode = tekst(invoer?.postcode);
  const duurTekst = tekst(invoer?.duurMin);

  if (postcode !== '' && !/^\d{4}$/.test(postcode)) return { fout: 'Postcode bestaat uit 4 cijfers' };
  if ((straat === '') !== (huisnr === '')) return { fout: 'Vul straat én huisnummer in' };
  if (straat !== '' && postcode === '') return { fout: 'Postcode bestaat uit 4 cijfers' }; // een adres kan zonder postcode niet gevonden worden
  let duurMin = null;
  if (duurTekst !== '') {
    duurMin = /^\d+$/.test(duurTekst) ? Number(duurTekst) : NaN;
    if (!(duurMin >= MIN_DUUR_MIN)) return { fout: `Minimale bezoekduur is ${MIN_DUUR_MIN} minuten` };
  }
  return {
    velden: {
      straat: leegNaarNull(straat), huisnr: leegNaarNull(huisnr), postcode: leegNaarNull(postcode),
      gemeente: leegNaarNull(tekst(invoer?.gemeente)), notitie: leegNaarNull(tekst(invoer?.notitie)), duurMin,
    },
  };
}

/** Controle van het vast uur dat de verkoper kiest. -> { fout } of { ok: true } */
export function valideerVastUur({ datum, start, vandaag }) {
  if (!isGeldigeDatum(datum) || datum < vandaag) return { fout: 'Kies een datum vanaf vandaag' };
  if (!isGeldigUur(start)) return { fout: 'Geef het uur als UU:MM' };
  return { ok: true };
}

const naarUur = (min) => (min >= 1440 ? '24:00' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
const overlapt = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;

/**
 * Vaste leads (bevestigd of vastgezet uur) en blokken die overlappen met een bezoek op `datum` om `start`.
 * Een voorgesteld bezoek telt niet mee: het brein mag dat verschuiven. `exceptId` = de lead die zelf verplaatst wordt.
 * -> [{ soort: 'lead'|'blok', omschrijving, start, eind }] op uur gesorteerd
 */
export function vindBotsingen({ leads = [], blokken = [], datum, start, duurMin, exceptId, standaardDuurMin = 60 }) {
  const s = timeStrToMin(start);
  const e = s + (duurMin ?? standaardDuurMin);
  const gevonden = [];
  for (const l of leads ?? []) {
    if (l.id === exceptId || !isVast(l) || l.status === 'afgewerkt' || l.planning?.datum !== datum || !l.planning.start) continue;
    const ls = timeStrToMin(l.planning.start);
    const le = ls + (l.duurMin ?? standaardDuurMin);
    if (overlapt(s, e, ls, le)) gevonden.push({ soort: 'lead', omschrijving: naamVan(l), start: l.planning.start, eind: naarUur(le), _s: ls });
  }
  for (const b of blokken ?? []) {
    if (b.datum !== datum) continue;
    const bs = timeStrToMin(b.start);
    const be = isHeleDag(b) ? 1440 : timeStrToMin(b.eind);
    if (overlapt(s, e, bs, be)) gevonden.push({ soort: 'blok', omschrijving: b.omschrijving || BLOK_LABEL[b.soort] || 'Blok', start: b.start, eind: b.eind, _s: bs });
  }
  return gevonden.sort((a, b) => a._s - b._s).map(({ _s, ...rest }) => rest);
}
