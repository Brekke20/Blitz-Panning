// schermen/beheer-performance-tijd.js — blok "Tijd & stiptheid": gemiddelde duur, op-tijd-ringen, stiptheid,
// aanrijtijd tegenover werktijd en interventies per dag. Zuivere stringbouwer: renderTijd(data, ctx) -> html.
// data = antwoord van /api/dashboard; ctx = { grenzen, techniekers, filters }.
import { balkenRijen, gestapeldeKolommen } from '../kern/grafiek-balken.js';
import { lijnGrafiek } from '../kern/grafiek-lijn.js';
import { formatDuur, opTijdVerdeling } from './beheer-performance-logica.js';
import { blok, kaart, lijst, ringenRij, groepeerPerWeek, techniekerSlot } from './beheer-performance-blokhulp.js';

const DUUR_KAARTEN = [
  ['laadpaal', 'Gemiddelde duur per laadpaaltype'],
  ['oorzaak', 'Gemiddelde duur per oorzaak'],
  ['technieker', 'Gemiddelde duur per technieker'],
  ['bezoektype', 'Gemiddelde duur per type bezoek'],
];

const duurKaart = (rijen, titel) => (lijst(rijen).length ? kaart(titel, balkenRijen({
  titel, eenheid: 'min',
  rijen: rijen.map(r => ({ label: r.label, waarde: r.gemMin, tekst: `${formatDuur(r.gemMin)} (${r.n}×)` })),
}), { uitleg: 'Tussen haakjes: aantal bezoeken.' }) : '');

function opTijdKaart(tijd, ctx) {
  const rijen = lijst(tijd.opTijdPerTechnieker).map(t => ({
    kop: t.technieker, pct: t.pct, n: t.opTijd, noemer: t.n, sub: opTijdVerdeling(t),
  }));
  return rijen.length ? kaart('Op tijd per technieker', ringenRij(rijen, 'opTijd', ctx?.grenzen, kop => `${kop}: % op tijd (alle bezoeken)`),
    { breed: true, uitleg: '% op tijd (alle bezoeken): binnen het geplande tijdslot aangekomen.' }) : '';
}

function stiptheidKaart(totaal) {
  if (!totaal?.n) return '';
  const rij = (label, n) => ({ label, waarde: n, tekst: `${n} (${Math.round((n / totaal.n) * 100)} %)` });
  return kaart('Stiptheid', balkenRijen({
    titel: 'Stiptheid (alle bezoeken)', eenheid: 'bezoeken',
    rijen: [rij('Te vroeg', totaal.teVroeg ?? 0), rij('Op tijd', totaal.opTijd ?? 0), rij('Te laat', totaal.teLaat ?? 0)],
  }), { uitleg: opTijdVerdeling(totaal) });
}

function rijtijdKaart(dagen) {
  if (!lijst(dagen).length) return '';
  const g = groepeerPerWeek(dagen.map(d => d.datum), [
    { sleutel: 'aanrijtijd', label: 'Aanrijtijd', slot: 1, waarden: dagen.map(d => d.aanrijtijdMin) },
    { sleutel: 'werktijd', label: 'Werktijd', slot: 2, waarden: dagen.map(d => d.werktijdMin) },
  ]);
  const titel = `Aanrijtijd (schatting vanaf startlocatie) en werktijd per ${g.perWeek ? 'week' : 'dag'}`;
  return kaart(titel, lijnGrafiek({ punten: g.punten, reeksen: g.reeksen, titel, eenheid: 'min' }),
    { breed: true, uitleg: g.perWeek ? 'Totaal per week (bij een lange periode per week gegroepeerd).' : 'Totaal per dag.' });
}

function perDagKaart(pd, ctx, data) {
  const datums = lijst(pd?.datums);
  const namen = lijst(pd?.techniekers);
  if (!datums.length || !namen.length) return '';
  const g = groepeerPerWeek(datums, namen.map(t => ({
    sleutel: t, label: t, slot: techniekerSlot(t, ctx, data, namen), waarden: datums.map(d => pd.waarden?.[t]?.[d] ?? 0),
  })));
  const titel = `Interventies per ${g.perWeek ? 'week' : 'dag'} per technieker`;
  return kaart(titel, gestapeldeKolommen({ categorieen: g.punten, reeksen: g.reeksen, titel, eenheid: 'bezoeken', categorieLabel: g.perWeek ? 'Week' : 'Dag' }), { breed: true });
}

export function renderTijd(data, ctx) {
  const t = data?.tijd ?? {};
  const kaarten = [
    ...DUUR_KAARTEN.map(([sleutel, titel]) => duurKaart(t.duurPer?.[sleutel], titel)),
    opTijdKaart(t, ctx), stiptheidKaart(t.opTijdTotaal), rijtijdKaart(t.rijtijdPerDag), perDagKaart(t.perDagPerTechnieker, ctx, data),
  ];
  return blok('tijd', 'Tijd & stiptheid', kaarten);
}
