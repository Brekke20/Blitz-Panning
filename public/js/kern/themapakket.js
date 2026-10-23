// kern/themapakket.js — periodes en "welk thema is nu actief" voor thema-pakketten (puur: geen DOM, geen window, geen opslag).
// Wordt later door browser en server gedeeld (zoals spel/spel-regels.js): één bron voor de regels.
//
// Een periode is een JAARLIJKS terugkerend venster in Belgische kalenderdagen (Europe/Brussels), grenzen inclusief:
//   vast:       { van: { maand, dag }, tot: { maand, dag } }   (`van` na `tot` = over de jaarwissel, bv. 1 dec tot 6 jan)
//   beweeglijk: { basis: 'pasen', van: n, tot: m }             (n en m zijn dagen ten opzichte van Pasen, negatief = ervoor)
// Een thema is { id, aan, periode, periodeOverride? }; `periodeOverride` (indien niet null) gaat voor op `periode` van het pakket.
// Datums worden intern als 'YYYY-MM-DD'-tekst vergeleken; de dagrekenkunde gebeurt in UTC, zodat zomertijd niets verschuift.
import { easterDate } from './feestdagen.js';

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const DAG_MS = 24 * 60 * 60 * 1000;

const dagFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' });

// De Belgische kalenderdag van een moment: { jaar, maand (1-12), dag }.
export function belgischeDag(datum) {
  const d = datum instanceof Date ? datum : new Date(datum);
  if (Number.isNaN(d.getTime())) throw new RangeError('themapakket: ongeldige datum');
  const delen = Object.fromEntries(dagFormatter.formatToParts(d).map(p => [p.type, p.value]));
  return { jaar: Number(delen.year), maand: Number(delen.month), dag: Number(delen.day) };
}

const tekst = (ms) => new Date(ms).toISOString().slice(0, 10);
const utc = (jaar, maand, dag) => Date.UTC(jaar, maand - 1, dag);
const dagTekst = (datum) => { const { jaar, maand, dag } = belgischeDag(datum); return tekst(utc(jaar, maand, dag)); };

// De periode van het pakket, of de override van de beheerder als die er is.
export function effectievePeriode(thema) {
  return thema.periodeOverride ?? thema.periode;
}

// De begin- en einddatum van de periode in het gegeven jaar. Bij een vaste periode over de jaarwissel begint `start` in `jaar`
// en eindigt `einde` in `jaar + 1`.
export function periodeVoorJaar(periode, jaar) {
  if (periode.basis === 'pasen') {
    const p = easterDate(jaar);
    const pasen = utc(p.getFullYear(), p.getMonth() + 1, p.getDate());
    return { start: tekst(pasen + periode.van * DAG_MS), einde: tekst(pasen + periode.tot * DAG_MS) };
  }
  const { van, tot } = periode;
  const overJaarwissel = van.maand * 100 + van.dag > tot.maand * 100 + tot.dag;
  return {
    start: tekst(utc(jaar, van.maand, van.dag)),
    einde: tekst(utc(overJaarwissel ? jaar + 1 : jaar, tot.maand, tot.dag)),
  };
}

// Aantal dagen van de periode in dat jaar, begin en einde inclusief.
export function periodeLengte(periode, jaar) {
  const { start, einde } = periodeVoorJaar(periode, jaar);
  return Math.round((Date.parse(einde) - Date.parse(start)) / DAG_MS) + 1;
}

// De uitvoering van de periode die deze dag omvat ({ start, einde }), of null. Een periode die in december begint kan in januari
// nog lopen, dus ook het vorige jaar wordt getoetst.
function uitvoeringOp(periode, dag) {
  const jaar = Number(dag.slice(0, 4));
  for (const j of [jaar, jaar - 1]) {
    const u = periodeVoorJaar(periode, j);
    if (u.start <= dag && dag <= u.einde) return u;
  }
  return null;
}

export function isActief(thema, datum = new Date()) {
  if (thema.aan === false) return false;
  return uitvoeringOp(effectievePeriode(thema), dagTekst(datum)) !== null;
}

// Alle thema's die op deze dag lopen, in de volgorde van de lijst. Voor de skins van het spel.
export function actieveThemas(datum, themas) {
  return themas.filter(t => isActief(t, datum));
}

// Overlapregel: het kortste venster wint (het specifiekste thema), bij gelijke lengte de latere start, daarna de alfabetische id.
// null als er geen thema actief is.
export function actiefThema(datum, themas) {
  const dag = dagTekst(datum);
  const kandidaten = [];
  for (const thema of themas) {
    if (thema.aan === false) continue;
    const u = uitvoeringOp(effectievePeriode(thema), dag);
    if (!u) continue;
    kandidaten.push({ thema, start: u.start, lengte: Math.round((Date.parse(u.einde) - Date.parse(u.start)) / DAG_MS) + 1 });
  }
  if (!kandidaten.length) return null;
  kandidaten.sort((a, b) =>
    a.lengte - b.lengte
    || (a.start < b.start ? 1 : a.start > b.start ? -1 : 0)
    || (a.thema.id < b.thema.id ? -1 : a.thema.id > b.thema.id ? 1 : 0));
  return kandidaten[0].thema;
}

// Het thema (dat aan staat) met de eerstvolgende start na vandaag, als { thema, start }, of null. Bij een gelijke start
// wint de alfabetische id.
export function volgendThema(datum, themas) {
  const dag = dagTekst(datum);
  const jaar = Number(dag.slice(0, 4));
  let beste = null;
  for (const thema of themas) {
    if (thema.aan === false) continue;
    const periode = effectievePeriode(thema);
    for (const j of [jaar, jaar + 1]) {
      const { start } = periodeVoorJaar(periode, j);
      if (start <= dag) continue;
      if (!beste || start < beste.start || (start === beste.start && thema.id < beste.thema.id)) beste = { thema, start };
      break;
    }
  }
  return beste;
}

const korteDag = (isoDatum) => `${Number(isoDatum.slice(8, 10))} ${MAANDEN[Number(isoDatum.slice(5, 7)) - 1]}`;

// "1 tot 31 oktober", "1 december tot 6 januari" of, voor een beweeglijke periode, "29 maart tot 6 april 2026".
export function vensterTekst(periode, jaar) {
  if (periode.basis === 'pasen') {
    const { start, einde } = periodeVoorJaar(periode, jaar);
    return `${korteDag(start)} tot ${korteDag(einde)} ${einde.slice(0, 4)}`;
  }
  const { van, tot } = periode;
  return van.maand === tot.maand
    ? `${van.dag} tot ${tot.dag} ${MAANDEN[tot.maand - 1]}`
    : `${van.dag} ${MAANDEN[van.maand - 1]} tot ${tot.dag} ${MAANDEN[tot.maand - 1]}`;
}
