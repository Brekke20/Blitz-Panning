// Zuivere hulp voor /api/mail-check (etappe 7, Q1): welke uitgaande e-mails staan er op een ticket sinds een tijdstip?
// Enkel lezen en rekenen; geen Zoho, geen netwerk. De threads komen van GET /tickets/{id}/threads.

// Tolerantie voor het klokverschil tussen toestel (de `sinds` van de client) en Zoho (createdTime).
export const KLOKMARGE_MS = 2 * 60 * 1000;

const ADRES_RE = /[^\s<>,;"'()]+@[^\s<>,;"'()]+/g;
export const GELDIG_ADRES_RE = /^[^\s<>,;"'()@]+@[^\s<>,;"'()@]+$/;

// "Luc <luc@x.be>, an@y.be" -> ['luc@x.be', 'an@y.be'] (kleine letters, zonder dubbels).
export function adressenUit(tekst) {
  if (typeof tekst !== 'string') return [];
  return [...new Set((tekst.match(ADRES_RE) || []).map(a => a.toLowerCase()))];
}

// Een thread telt als verzonden mail als ze uitgaand is, via het kanaal e-mail loopt, niet privé is en na `sinds` (min de marge) werd aangemaakt.
export function isUitgaandeMail(thread, sindsMs) {
  if (!thread || typeof thread !== 'object') return false;
  if (String(thread.direction || '').toLowerCase() !== 'out') return false;
  if (String(thread.channel || '').toUpperCase() !== 'EMAIL') return false;
  if (String(thread.visibility || '').toLowerCase() === 'private') return false;
  const t = Date.parse(thread.createdTime);
  return !Number.isNaN(t) && t >= sindsMs - KLOKMARGE_MS;
}

// -> [{ aan, tijdstip }] per verschillend adres (vroegste tijdstip), oplopend op tijd. Een thread zonder leesbaar adres geeft aan: ''.
export function uitgaandeMails(threads, sindsMs) {
  const perAdres = new Map();
  for (const th of Array.isArray(threads) ? threads : []) {
    if (!isUitgaandeMail(th, sindsMs)) continue;
    const adressen = adressenUit(th.to);
    for (const aan of adressen.length ? adressen : ['']) {
      const huidig = perAdres.get(aan);
      if (!huidig || Date.parse(th.createdTime) < Date.parse(huidig)) perAdres.set(aan, th.createdTime);
    }
  }
  return [...perAdres.entries()]
    .map(([aan, tijdstip]) => ({ aan, tijdstip }))
    .sort((a, b) => Date.parse(a.tijdstip) - Date.parse(b.tijdstip));
}

// verwacht = lijst adressen (kleine letters) of leeg. Geeft { verzonden, tijdstip, ontvangers? }.
// Zonder verwachte ontvangers: verzonden zodra er één uitgaande mail is. Met: enkel als álle adressen een mail kregen.
export function beoordeel(uitgaand, verwacht = []) {
  if (!verwacht.length) {
    return { verzonden: uitgaand.length > 0, tijdstip: uitgaand[0]?.tijdstip ?? null };
  }
  const ontvangers = {};
  for (const adres of verwacht) {
    const gevonden = uitgaand.find(u => u.aan === adres);
    ontvangers[adres] = { verzonden: !!gevonden, tijdstip: gevonden?.tijdstip ?? null };
  }
  const tijden = Object.values(ontvangers).filter(o => o.verzonden).map(o => o.tijdstip).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { verzonden: verwacht.every(a => ontvangers[a].verzonden), tijdstip: tijden[0] ?? null, ontvangers };
}
