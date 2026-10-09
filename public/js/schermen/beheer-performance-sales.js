// schermen/beheer-performance-sales.js — blok "Sales": bezoeken per verkoper per week, de vier resultaten als
// donut en de wachtende leads. Zuivere stringbouwer: renderSales(data, ctx) -> html. Geen persoonsgegevens van
// klanten of leads; enkel de naam van de verkoper (het dashboard is beheerder-only).
import { gestapeldeKolommen, balkenRijen } from '../kern/grafiek-balken.js';
import { donutFiguur } from '../kern/grafiek-donut.js';
import { formatGetal } from '../kern/grafiek-hulp.js';
import { kleurSlotVoor } from './beheer-performance-logica.js';
import { blok, kaart, lijst, korteDatum, feiten, subkop } from './beheer-performance-blokhulp.js';

// Vaste volgorde en kleur van de vier resultaten (slot 1-4), los van de grootte.
const RESULTATEN = [['offerte', 'Offerte'], ['verkocht', 'Verkocht'], ['geen-interesse', 'Geen interesse'], ['opnieuw', 'Opnieuw bezoeken']];

function perWeekKaart(pw) {
  const weken = lijst(pw?.weken), verkopers = lijst(pw?.verkopers);
  if (!weken.length || !verkopers.length) return '';
  const titel = 'Bezoeken per verkoper per week';
  return kaart(titel, gestapeldeKolommen({
    titel, eenheid: 'bezoeken', categorieLabel: 'Week', categorieen: weken.map(w => `wk ${korteDatum(w)}`),
    reeksen: verkopers.map(v => ({ sleutel: v, label: v, slot: kleurSlotVoor(v, verkopers), waarden: weken.map(w => pw.waarden?.[v]?.[w] ?? 0) })),
  }), { breed: true });
}

function resultatenKaart(r) {
  if (!r?.totaal) return '';
  const titel = 'Resultaat van de bezoeken';
  const perSoort = lijst(r.perSoort);
  const segmenten = RESULTATEN.map(([soort, label], i) => ({
    sleutel: soort, label, slot: i + 1, waarde: perSoort.find(p => p.soort === soort)?.n ?? 0,
  }));
  return kaart(titel, donutFiguur({ titel, segmenten, midden: { groot: formatGetal(r.totaal), klein: 'bezoeken' } }));
}

function wachtendKaart(w) {
  if (!w?.n) return '';
  const regels = [['Gemiddeld', `${formatGetal(w.gemDagen)} dagen wachtend`], ['Oudste', `${formatGetal(w.oudsteDagen)} dagen`]];
  if (w.zonderDatum > 0) regels.push(['Zonder datum', `${w.zonderDatum} ${w.zonderDatum === 1 ? 'lead' : 'leads'}`]);
  const tegel = `<article class="tegel tegel--aantal tegel--wachtend"><h3 class="tegel-kop">Wachtende leads</h3><p class="tegel-getal"><span class="tegel-waarde">${formatGetal(w.n)}</span></p></article>`;
  return kaart(null, tegel + feiten(regels)
    + subkop('Hoe lang al wachtend') + balkenRijen({ titel: 'Wachtende leads: hoe lang al', eenheid: 'leads', rijen: lijst(w.buckets).map(b => ({ label: b.label, waarde: b.n })) })
    + subkop('Per verkoper') + balkenRijen({ titel: 'Wachtende leads per verkoper', eenheid: 'leads', slot: 2, rijen: lijst(w.perVerkoper).map(v => ({ label: v.verkoper, waarde: v.n })) }),
  { breed: true });
}

const NOOT = 'Leads worden na 12 maanden gewist, samen met hun bezoeken: bij een periode van meer dan 12 maanden terug zijn de sales-cijfers onvolledig.';

export function renderSales(data) {
  const s = data?.sales ?? {};
  return blok('sales', 'Sales', [perWeekKaart(s.perWeek), resultatenKaart(s.resultaten), wachtendKaart(s.wachtend)], { noot: NOOT });
}
