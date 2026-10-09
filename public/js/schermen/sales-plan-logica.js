// schermen/sales-plan-logica.js — het resultaat van "Plan deze week" in gewone taal (puur, geen DOM).
// Redenen komen van het planner-brein (planner.js); de teksten staan in plan-resultaat-logica.js (gedeeld met planacties.js), over bezoeken.
import { getWeekStart } from '../kern/tijd.js';
import { naamVan, dagLabel } from './sales-tekst.js';
import { redenTekst as gedeeldeRedenTekst, waarschuwingTekst, WOORDEN_BEZOEK } from './plan-resultaat-logica.js';

/** Gewone-taaltekst bij een reden waarom een lead niet ingepland werd: dezelfde zinnen als bij de technieker (plan-resultaat-logica.js), over bezoeken. */
export function redenTekst(reden, { maxReistijdMin = 45 } = {}) {
  return gedeeldeRedenTekst(reden, { maxReistijdMin, woorden: WOORDEN_BEZOEK });
}

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
  const waarschuwingen = (overzicht?.waarschuwingen ?? []).map((w) => waarschuwingTekst(w, WOORDEN_BEZOEK)).filter(Boolean);
  return { ingepland, nietIngepland, waarschuwingen };
}

/** Maandag (Date, lokaal, 00:00) van de week met de gekozen dag 'YYYY-MM-DD'. */
export function weekStartVan(gekozenIso) {
  return getWeekStart(new Date(`${gekozenIso}T12:00:00`), 0);
}
