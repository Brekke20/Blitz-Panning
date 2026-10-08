// schermen/sales-plan-logica.js — het resultaat van "Plan deze week" in gewone taal (puur, geen DOM).
// Redenen komen van het planner-brein (planner.js); teksten volgen planacties.js, maar over bezoeken in plaats van tickets.
import { getWeekStart } from '../kern/tijd.js';
import { naamVan, dagLabel } from './sales-tekst.js';

const ONBEKEND = 'Geen plaats meer deze week';

/** Gewone-taaltekst bij een reden waarom een lead niet ingepland werd. `laatsteStart` is vrij voor latere uitbreiding (nu niet in de tekst). */
export function redenTekst(reden, { maxReistijdMin = 45, laatsteStart = '16:00' } = {}) {
  const teksten = {
    'geen-plaats': ONBEKEND,
    'te-ver': `Te ver van de andere afspraken (meer dan ${maxReistijdMin} min)`,
    'klant-geblokkeerd': 'Klant is niet beschikbaar op de vrije dagen',
    'voorkeursdag-afstand': 'Voorkeursdag botst qua afstand met een ander bezoek',
    'voorkeursdag-vol': 'Voorkeursdag is al vol',
    'vast-uur-botst': 'Vast uur botst met een andere afspraak',
    'adres-niet-gevonden': 'Adres niet gevonden',
  };
  return teksten[reden] ?? ONBEKEND;
}

const waarschuwingTekst = (w) => {
  if (w?.soort === 'reistijd-geschat') return `Reistijd kon niet gecontroleerd worden voor ${(w.ticketIds ?? []).length} bezoeken — kijk de route na`;
  if (w?.soort === 'locatie-onbekend') return 'Locatie van een bestaande afspraak onbekend — reistijdcontrole minder nauwkeurig';
  return null; // onbekende soorten tonen we niet
};

/**
 * Zet het overzicht van `verwerkUitkomst` (planner-adapter) om in regels voor het resultaatvenster.
 * `opties` (optioneel): { maxReistijdMin, laatsteStart } voor de redenteksten.
 * -> { ingepland: [{ naam, datumLabel, start }], nietIngepland: [{ naam, tekst }], waarschuwingen: [tekst] }
 */
export function bouwResultaatRegels({ overzicht, leads, opties = {} }) {
  const perId = new Map((leads ?? []).map((l) => [l.id, l]));
  const naam = (id) => (perId.has(id) ? naamVan(perId.get(id)) : 'Onbekende lead');
  const ingepland = (overzicht?.wijzigingen ?? [])
    .filter((w) => w.velden?.status === 'voorgesteld' && w.velden.planning)
    .map((w) => ({ naam: naam(w.id), datumLabel: dagLabel(w.velden.planning.datum), start: w.velden.planning.start }));
  const nietIngepland = (overzicht?.nietGepland ?? []).map((n) => ({ naam: naam(n.leadId), tekst: redenTekst(n.reden, opties) }));
  const waarschuwingen = (overzicht?.waarschuwingen ?? []).map(waarschuwingTekst).filter(Boolean);
  return { ingepland, nietIngepland, waarschuwingen };
}

/** Maandag (Date, lokaal, 00:00) van de week met de gekozen dag 'YYYY-MM-DD'. */
export function weekStartVan(gekozenIso) {
  return getWeekStart(new Date(`${gekozenIso}T12:00:00`), 0);
}
