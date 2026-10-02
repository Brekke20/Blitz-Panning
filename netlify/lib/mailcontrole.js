// Zuivere hulp voor /api/mail-check (etappe 7, Q1): welke uitgaande e-mails staan er op een ticket sinds een tijdstip?
// Enkel lezen en rekenen; geen Zoho, geen netwerk. De threads komen van GET /tickets/{id}/threads.

// `sinds` komt van de SERVERklok (nu - verlopenMs, zie functions/mail-check.js), nooit van het toestel. De marge vangt enkel de
// kleine afwijking tussen de serverklok en de Zoho-klok (beide NTP) en de transporttijd van het verzoek op.
// Per adres (KLOKMARGE_MS) en in de brede controle (BREDE_KLOKMARGE_MS) is ze even klein: een collega- of workflowmail van meer dan
// enkele seconden ervoor mag niet als onze mail tellen.
export const KLOKMARGE_MS = 10 * 1000;
export const BREDE_KLOKMARGE_MS = 10 * 1000;
// Bereik van `verlopenMs`: 0 tot 15 minuten.
export const MAX_VERLOPEN_MS = 15 * 60 * 1000;

const ADRES_RE = /[^\s<>,;"'()]+@[^\s<>,;"'()]+/g;
export const GELDIG_ADRES_RE = /^[^\s<>,;"'()@]+@[^\s<>,;"'()@]+$/;
// Volledig ISO 8601 met tijd en zone ("2020" of een kale datum is geen geldig begin van een verzending).
export const ISO_TIJDSTIP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

// De referentie (docs/integrations, §9.4) noemt het threadveld `status` maar geen waarden. Enkel een ontbrekende of herkenbaar verzonden
// status telt als verzonden; elke andere (DRAFT, FAILED, PENDING, onbekend) telt niet mee en maakt een "niet verzonden" onzeker.
const VERZONDEN_STATUS_RE = /^(success|sent|delivered)$/i;
export function heeftVerzondenStatus(thread) {
  const s = thread?.status;
  return s === undefined || s === null || s === '' || VERZONDEN_STATUS_RE.test(String(s));
}

// "Luc <luc@x.be>, an@y.be" -> ['luc@x.be', 'an@y.be'] (kleine letters, zonder dubbels).
export function adressenUit(tekst) {
  if (typeof tekst !== 'string') return [];
  return [...new Set((tekst.match(ADRES_RE) || []).map(a => a.toLowerCase()))];
}

// Uitgaand + via het kanaal e-mail + niet privé + vanaf sinds min de marge aangemaakt (de status wordt apart beoordeeld).
export function isUitgaandeMail(thread, sindsMs, marge = KLOKMARGE_MS) {
  if (!thread || typeof thread !== 'object') return false;
  if (String(thread.direction || '').toLowerCase() !== 'out') return false;
  if (String(thread.channel || '').toUpperCase() !== 'EMAIL') return false;
  if (String(thread.visibility || '').toLowerCase() === 'private') return false;
  const t = Date.parse(thread.createdTime);
  return !Number.isNaN(t) && t >= sindsMs - marge;
}

// -> { uitgaand: [{ aan, tijdstip }], twijfel }. `uitgaand` heeft één regel per adres (vroegste tijdstip), oplopend op tijd.
// Zonder `verwacht` (brede controle) telt elke uitgaande mail, ook zonder leesbaar adres (aan: '').
// Met `verwacht` (controle per adres) kan een mail zonder leesbaar adres niet aan een ontvanger toegewezen worden.
// `twijfel` is waar als er een mogelijk verstuurde mail is die niet meetelt (onleesbaar adres of een status die niet "verzonden" is).
export function uitgaandeMails(threads, sindsMs, { marge = KLOKMARGE_MS, verwachtAdressen = false } = {}) {
  const perAdres = new Map();
  let twijfel = false;
  for (const th of Array.isArray(threads) ? threads : []) {
    if (!isUitgaandeMail(th, sindsMs, marge)) continue;
    if (!heeftVerzondenStatus(th)) { twijfel = true; continue; }
    const adressen = adressenUit(th.to);
    if (!adressen.length && verwachtAdressen) { twijfel = true; continue; }
    for (const aan of adressen.length ? adressen : ['']) {
      const huidig = perAdres.get(aan);
      if (!huidig || Date.parse(th.createdTime) < Date.parse(huidig)) perAdres.set(aan, th.createdTime);
    }
  }
  const uitgaand = [...perAdres.entries()]
    .map(([aan, tijdstip]) => ({ aan, tijdstip }))
    .sort((a, b) => Date.parse(a.tijdstip) - Date.parse(b.tijdstip));
  return { uitgaand, twijfel };
}

// verwacht = lijst adressen (kleine letters) of leeg. Geeft { verzonden, twijfel, tijdstip, ontvangers? }.
// Zonder verwachte ontvangers: verzonden zodra er één uitgaande mail is. Met: enkel als álle adressen een mail kregen.
// `twijfel` blijft alleen waar als er niet (volledig) verzonden is: dan mag de oproeper nooit "niet verzonden" melden.
export function beoordeel(uitgaand, verwacht = [], twijfel = false) {
  if (!verwacht.length) {
    const verzonden = uitgaand.length > 0;
    return { verzonden, twijfel: twijfel && !verzonden, tijdstip: uitgaand[0]?.tijdstip ?? null };
  }
  const ontvangers = {};
  for (const adres of verwacht) {
    const gevonden = uitgaand.find(u => u.aan === adres);
    ontvangers[adres] = { verzonden: !!gevonden, tijdstip: gevonden?.tijdstip ?? null };
  }
  const tijden = Object.values(ontvangers).filter(o => o.verzonden).map(o => o.tijdstip).sort((a, b) => Date.parse(a) - Date.parse(b));
  const verzonden = verwacht.every(a => ontvangers[a].verzonden);
  return { verzonden, twijfel: twijfel && !verzonden, tijdstip: tijden[0] ?? null, ontvangers };
}
