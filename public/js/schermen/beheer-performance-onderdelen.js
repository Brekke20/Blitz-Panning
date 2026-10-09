// schermen/beheer-performance-onderdelen.js — blok "Onderdelen": top 10 verbruikte onderdelen en het verbruik per
// maand per technieker en per laadpaaltype. Zuivere stringbouwer: renderOnderdelen(data, ctx) -> html.
import { balkenRijen, gestapeldeKolommen } from '../kern/grafiek-balken.js';
import { grafiekTabel } from '../kern/grafiek-tabel.js';
import { formatGetal } from '../kern/grafiek-hulp.js';
import { formatEuro } from './beheer-performance-logica.js';
import { blok, kaart, lijst, maandLabel, techniekerSlot, typeSlot } from './beheer-performance-blokhulp.js';

function top10Kaart(top, perMaand, dekking) {
  const rijen = lijst(top);
  if (!rijen.length) return '';
  const titel = 'Top 10 onderdelen (aantal)';
  const totaal = Object.values(perMaand?.totaal ?? {}).reduce((s, m) => ({ aantal: s.aantal + (m.aantal || 0), waarde: s.waarde + (m.waarde || 0) }), { aantal: 0, waarde: 0 });
  const zonderPrijs = dekking?.zonderPrijs > 0 ? ` ${dekking.zonderPrijs} onderdeel${dekking.zonderPrijs === 1 ? '' : 'en'} zonder prijs tellen voor € 0 mee.` : '';
  return kaart(titel, balkenRijen({
    titel, eenheid: 'stuks',
    rijen: rijen.map(o => ({ label: o.naam, waarde: o.aantal, tekst: `${formatGetal(o.aantal)}× · ${formatEuro(o.waarde)}` })),
  }), { uitleg: `Totaal in de periode: ${formatGetal(totaal.aantal)} stuks, ${formatEuro(totaal.waarde)}.${zonderPrijs}`.trim() });
}

// Eén maand = enkel een tabel (een grafiek met één kolom zegt niets); meerdere maanden = gestapelde kolommen.
function verbruikKaart(titel, groepen, maanden, ctx, data, perTechnieker) {
  const namen = Object.keys(groepen ?? {});
  if (!namen.length || !maanden.length) return '';
  const cel = (g, m) => groepen[g]?.[m]?.aantal ?? 0;
  if (maanden.length === 1) {
    const rijen = namen.map(g => [g, cel(g, maanden[0]), groepen[g]?.[maanden[0]]?.waarde ?? 0]);
    const tabel = grafiekTabel({ titel, kolommen: [perTechnieker ? 'Technieker' : 'Laadpaaltype', 'Aantal', 'Waarde (€)'], rijen });
    return kaart(titel, tabel.replace('<details class="tabel-twin">', '<details class="tabel-twin" open>'), // open: de tabel ís hier de weergave
      { uitleg: `${maandLabel(maanden[0])}: één maand, dus enkel een tabel.` });
  }
  return kaart(titel, gestapeldeKolommen({
    titel, eenheid: 'stuks', categorieLabel: 'Maand', categorieen: maanden.map(maandLabel),
    reeksen: namen.map(g => ({ sleutel: g, label: g, slot: perTechnieker ? techniekerSlot(g, ctx, data, namen) : typeSlot(g, data, namen), waarden: maanden.map(m => cel(g, m)) })),
  }), { breed: true });
}

export function renderOnderdelen(data, ctx) {
  const o = data?.onderdelen ?? {};
  const maanden = lijst(o.perMaand?.maanden);
  return blok('onderdelen', 'Onderdelen', [
    top10Kaart(o.top10, o.perMaand, o.dekking),
    verbruikKaart('Verbruik per maand per technieker', o.perMaand?.perTechnieker, maanden, ctx, data, true),
    verbruikKaart('Verbruik per maand per laadpaaltype', o.perMaand?.perType, maanden, ctx, data, false),
  ]);
}
