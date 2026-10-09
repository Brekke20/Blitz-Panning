// schermen/sales-lijst-logica.js — logica van de lijsten Te plannen en Afgewerkt en van de leadkaart (puur, geen DOM).
import { adresSoort, plaatsLabel } from '../sales/adres.js';
import { isVast, RESULTAAT_LABEL } from '../sales/lead-regels.js';
import { normaliseerGsm, normaliseerEmail, zelfdeNaam } from '../sales/import.js';
import { localISO, fmtDateShort } from '../kern/tijd.js';
import { naamVan, dagLabel } from './sales-tekst.js';

const ADRES_LABEL = { postcode: 'enkel postcode', volledig: 'volledig adres', nakijken: 'adres nakijken' };

const zoekTekst = (l) => [l.voornaam, l.naam, l.gemeente, l.postcode].filter(Boolean).join(' ').toLowerCase();

/** Alle zoekwoorden moeten voorkomen in voornaam, naam, gemeente of postcode; `gebied` = eerste 2 cijfers van de postcode. */
export function filterLeads(leads, { zoek = '', gebied = '' } = {}) {
  const woorden = String(zoek).toLowerCase().split(/\s+/).filter(Boolean);
  return (leads ?? []).filter((l) => {
    if (gebied && !String(l.postcode ?? '').startsWith(gebied)) return false;
    const tekst = zoekTekst(l);
    return woorden.every((w) => tekst.includes(w));
  });
}

/** Postcodegebieden (eerste 2 cijfers) met het aantal leads, oplopend gesorteerd; leads zonder postcode tellen niet mee. */
export function postcodegebieden(leads) {
  const telling = new Map();
  for (const l of leads ?? []) {
    const gebied = String(l.postcode ?? '').slice(0, 2);
    if (gebied.length === 2) telling.set(gebied, (telling.get(gebied) ?? 0) + 1);
  }
  return [...telling].map(([gebied, aantal]) => ({ gebied, aantal })).sort((a, b) => a.gebied.localeCompare(b.gebied));
}

// Ontbrekende waarde sorteert achteraan.
const tekstVolgorde = (a, b) => (a ?? '￿').localeCompare(b ?? '￿');

/** Te plannen (langst wachtende eerst) en ingepland (voorgesteld + bevestigd, op datum en uur); afgewerkt valt weg. */
export function groepeerLijst(leads) {
  const lijst = leads ?? [];
  const tePlannen = lijst.filter((l) => l.status === 'te-plannen')
    .sort((a, b) => tekstVolgorde(a.geimporteerdOp, b.geimporteerdOp));
  const ingepland = lijst.filter((l) => l.status === 'voorgesteld' || l.status === 'bevestigd')
    .sort((a, b) => tekstVolgorde(a.planning?.datum, b.planning?.datum) || tekstVolgorde(a.planning?.start, b.planning?.start));
  return { tePlannen, ingepland };
}

/** Alles wat een leadkaart nodig heeft. `telHref` enkel bij een echt nummer (>= 9 cijfers), `mailHref` enkel bij een e-mailadres. */
export function kaartInfo(lead) {
  const gsm = normaliseerGsm(lead?.gsm);
  const email = normaliseerEmail(lead?.email);
  const vast = isVast(lead) && lead.planning?.datum && lead.planning.start;
  return {
    titel: naamVan(lead),
    plaats: plaatsLabel(lead),
    adresLabel: ADRES_LABEL[adresSoort(lead)],
    vastUur: vast ? `${dagLabel(lead.planning.datum)} ${lead.planning.start}` : null,
    telHref: gsm ? `tel:+${gsm}` : null,
    mailHref: email ? `mailto:${encodeURIComponent(email).replace('%40', '@')}` : null,
    status: lead?.status,
    eerderVerwijderd: Boolean(lead?.eerderVerwijderd?.op), // label "eerder verwijderd": de lead kwam terug via een nieuwe import
  };
}

// Laatste bezoek (op `op`); zonder bezoeken het resultaat van de lead zelf (oudere leads).
function laatsteBezoek(lead) {
  const bezoeken = Array.isArray(lead.bezoeken) ? lead.bezoeken : [];
  const laatste = [...bezoeken].sort((a, b) => tekstVolgorde(a.op, b.op)).at(-1);
  if (laatste) return { datum: laatste.datum, soort: lead.resultaat?.soort ?? laatste.resultaat, notitie: laatste.notitie ?? lead.resultaat?.notitie };
  const r = lead.resultaat;
  if (!r) return null;
  const moment = new Date(r.op);
  return { datum: isNaN(moment) ? null : localISO(moment), soort: r.soort, notitie: r.notitie };
}

// Aantal dagen van de maand die `maanden` maanden voor `d` ligt (om 31 mei - 3 maanden niet naar 3 maart te laten overlopen).
const dagenInMaand = (d, maanden) => new Date(d.getFullYear(), d.getMonth() + maanden + 1, 0).getDate();

// Eerste dag (ISO, lokaal) die nog binnen de periode valt; null = geen grens.
function periodeStart(periode, nu) {
  const d = new Date(nu);
  if (periode === '30d') d.setDate(d.getDate() - 30);
  else if (periode === '3m') d.setMonth(d.getMonth() - 3, Math.min(d.getDate(), dagenInMaand(d, -3)));
  else if (periode === '12m') d.setMonth(d.getMonth() - 12, Math.min(d.getDate(), dagenInMaand(d, -12)));
  else return null;
  return localISO(d);
}

/** Rijen voor het tabblad Afgewerkt, nieuwste eerst. `periode`: '30d' | '3m' | '12m' | 'alles'. */
export function afgewerktRijen(leads, { resultaat = '', periode = 'alles', nu = new Date() } = {}) {
  const start = periodeStart(periode, nu);
  const rijen = [];
  for (const lead of leads ?? []) {
    if (lead.status !== 'afgewerkt') continue;
    const b = laatsteBezoek(lead);
    if (!b?.datum || (resultaat && b.soort !== resultaat)) continue;
    if (start && b.datum < start) continue;
    rijen.push({
      leadId: lead.id, naam: naamVan(lead), datum: b.datum, datumLabel: fmtDateShort(b.datum).replace(/\.$/, ''),
      soort: b.soort, label: RESULTAAT_LABEL[b.soort] ?? b.soort, notitie: b.notitie ?? '',
    });
  }
  return rijen.sort((a, b) => b.datum.localeCompare(a.datum));
}

// ---- importteksten (Task 14) ----

/** '12 nieuw (waarvan 2 eerder verwijderd), 7 al aanwezig, 1 adres nakijken'; het stuk tussen haakjes enkel bij eerderVerwijderd > 0. */
export function samenvattingTekst({ nieuw = 0, alAanwezig = 0, adresNakijken = 0, eerderVerwijderd = 0 } = {}) {
  const eerder = eerderVerwijderd > 0 ? ` (waarvan ${eerderVerwijderd} eerder verwijderd)` : '';
  return `${nieuw} nieuw${eerder}, ${alAanwezig} al aanwezig, ${adresNakijken} adres nakijken`;
}

/** De gegevens van het exportbestand voor onder de samenvatting; '' zonder gegevens. */
export function exportTekst(exp) {
  if (!exp || typeof exp !== 'object') return '';
  const delen = [exp.verantwoordelijke ? `Export van ${exp.verantwoordelijke}` : 'Export'];
  if (Number.isFinite(exp.aantal)) delen.push(`${exp.aantal} ${exp.aantal === 1 ? 'lead' : 'leads'}`);
  if (Array.isArray(exp.statussen) && exp.statussen.length) delen.push(`statussen: ${exp.statussen.join(', ')}`);
  if (exp.overgeslagen > 0) delen.push(`${exp.overgeslagen} ${exp.overgeslagen === 1 ? 'lead' : 'leads'} zonder naam of contactgegevens overgeslagen`);
  return delen.join(' · ');
}

/** Is de export van iemand anders dan de verkoper wiens leads getoond worden? Een export zonder naam valt niet te vergelijken. */
export function andereVerantwoordelijke(verantwoordelijke, salesNaam) {
  if (!verantwoordelijke || String(verantwoordelijke).trim() === '') return false;
  return !zelfdeNaam(verantwoordelijke, salesNaam);
}
