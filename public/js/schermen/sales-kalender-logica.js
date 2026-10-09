// schermen/sales-kalender-logica.js — kalenderitems en maandchips voor de agenda van de verkoper (puur, geen DOM).
// De items hebben `startMin`/`endMin`, zodat `bepaalLanes` (kalender-logica.js) ze ongewijzigd kan indelen.
import { isVast } from '../sales/lead-regels.js';
import { isHeleDag } from '../sales/blok-regels.js';
import { timeStrToMin, minToTimeStr, localISO, getWeekStart } from '../kern/tijd.js';
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


/**
 * De dagen (ISO, ma tot zo) van de week van `gekozen`: de werkdagen plus elke andere dag waarop een bezoek of blok staat (anders zou
 * een vastgelegd uur in het weekend onzichtbaar zijn). Zonder werkdagen: ma-vr.
 */
export function weekDagen({ gekozen, werkdagen, leads = [], blokken = [] }) {
  const wd = Array.isArray(werkdagen) && werkdagen.length ? werkdagen : [1, 2, 3, 4, 5];
  const maandag = getWeekStart(new Date(`${gekozen}T12:00:00`), 0);
  const uit = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(maandag);
    d.setDate(maandag.getDate() + i);
    const iso = localISO(d);
    if (wd.includes(d.getDay()) || bouwKalenderItems({ leads, blokken, datum: iso }).length) uit.push(iso);
  }
  return uit;
}

/** Het adres om naartoe te navigeren: volledig adres, postcode + gemeente, vrije tekst, of 'lat,lon'; null als er niets is. */
export function navigatieAdres(lead) {
  if (!lead) return null;
  const plaats = [lead.postcode, lead.gemeente].filter(Boolean).join(' ');
  if (lead.straat && plaats) return `${[lead.straat, lead.huisnr].filter(Boolean).join(' ')}, ${plaats}`;
  if (plaats) return plaats;
  if (lead.adresTekst) return String(lead.adresTekst);
  if (Number.isFinite(lead.locatie?.lat) && Number.isFinite(lead.locatie?.lon)) return `${lead.locatie.lat},${lead.locatie.lon}`;
  return null;
}

/** Link zoals `navigate()` in app.js: een geo:-link op Android (het toestel kiest de app), anders Google Maps. */
export function navigatieLink(adres, android) {
  if (!adres) return null;
  const enc = encodeURIComponent(adres);
  return android ? `geo:0,0?q=${enc}` : `https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=driving`;
}
