// schermen/sales-kalender-logica.js — kalenderitems en maandchips voor de agenda van de verkoper (puur, geen DOM).
// De items hebben `startMin`/`endMin`, zodat `bepaalLanes` (kalender-logica.js) ze ongewijzigd kan indelen.
import { isVast } from '../sales/lead-regels.js';
import { isHeleDag } from '../sales/blok-regels.js';
import { timeStrToMin, minToTimeStr, localISO } from '../kern/tijd.js';
import { maandRaster } from './kalender-logica.js';
import { naamVan, blokTitel } from './sales-tekst.js';

const STANDAARD_DUUR_MIN = 60;

/** 'bevestigd' bij een vast bezoek (bevestigd of vastgezet uur), anders 'voorgesteld'. */
export function tintVan(lead) {
  return isVast(lead) ? 'bevestigd' : 'voorgesteld';
}

/**
 * Items van één dag: voorgestelde en bevestigde bezoeken met die datum, plus de blokken van die dag, op beginuur gesorteerd.
 * -> [{ id, type: 'bezoek'|'blok', titel, tint, startMin, endMin, heleDag }]; een hele-dag blok loopt van 0 tot 1440.
 */
export function bouwKalenderItems({ leads = [], blokken = [], datum, standaardDuurMin = STANDAARD_DUUR_MIN }) {
  const items = [];
  for (const l of leads ?? []) {
    if ((l.status !== 'voorgesteld' && l.status !== 'bevestigd') || l.planning?.datum !== datum || !l.planning.start) continue;
    const startMin = timeStrToMin(l.planning.start);
    items.push({
      id: l.id, type: 'bezoek', titel: naamVan(l), tint: tintVan(l),
      startMin, endMin: startMin + (l.duurMin ?? standaardDuurMin), heleDag: false,
    });
  }
  for (const b of blokken ?? []) {
    if (b.datum !== datum) continue;
    const heleDag = isHeleDag(b);
    items.push({
      id: b.id, type: 'blok', titel: blokTitel(b), tint: 'blok',
      startMin: heleDag ? 0 : timeStrToMin(b.start), endMin: heleDag ? 1440 : timeStrToMin(b.eind), heleDag,
    });
  }
  return items.sort((a, b) => a.startMin - b.startMin);
}

/**
 * Chips voor het maandraster rond `datum` (ISO): per dag van het raster een lijst { label, tint }, op uur gesorteerd.
 * Dagen zonder items ontbreken. -> { [iso]: [{ label, tint }] }
 */
export function maandChips({ leads = [], blokken = [], datum }) {
  const uit = {};
  for (const dag of maandRaster(new Date(`${datum}T12:00:00`))) {
    const iso = localISO(dag);
    const items = bouwKalenderItems({ leads, blokken, datum: iso });
    if (items.length) {
      uit[iso] = items.map((i) => ({ label: i.heleDag ? i.titel : `${minToTimeStr(i.startMin)} ${i.titel}`, tint: i.tint }));
    }
  }
  return uit;
}
