// schermen/paginakop-logica.js — puur (Open dag, taak 7): de samenvatting onder de paginatitel op `breed`.
// Enkel schermen met cijfers krijgen een samenvatting; elk scherm levert de cijfers die het zelf al tekent (geen eigen berekening hier,
// geen serveraanroep). Elke andere tab: '' (enkel de titel). Unit-getest in tests/paginakop.test.mjs.
import { meervoud } from './ticketdetail-logica.js';

// Een aantal: een eindig geheel getal >= 0, anders 0 (een ontbrekend cijfer mag nooit "NaN tickets" opleveren).
const aantal = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

const TEKSTEN = {
  // Wachtrij: tickets na de persoonfilter (de teller van de tab); verlopen = isOverdue.
  tickets: ({ wachtend, verlopen }) => {
    const n = aantal(wachtend);
    if (!n) return 'Geen tickets wachten op een datum';
    const v = aantal(verlopen);
    return `${meervoud(n, 'ticket wacht', 'tickets wachten')} op een datum${v ? `, ${v} verlopen` : ''}`;
  },
  // Kalender: de week van de gekozen datum; zonder datum = de pil "N zonder datum".
  kalender: ({ week, gepland, zonderDatum }) => {
    const g = aantal(gepland);
    const z = aantal(zonderDatum);
    return `Week ${aantal(week)} · ${g ? `${meervoud(g, 'stop', 'stops')} gepland` : 'nog niets gepland'}${z ? `, ${z} zonder datum` : ''}`;
  },
  // Ingepland: de afspraken van de getoonde week; wacht op bevestiging = dezelfde test als het label "Wacht bevestiging".
  gepland: ({ dezeWeek, wachtBevestiging }) => {
    const n = aantal(dezeWeek);
    const w = aantal(wachtBevestiging);
    const eerste = n ? `${meervoud(n, 'afspraak', 'afspraken')} deze week` : 'Geen afspraken deze week';
    return w ? `${eerste}, ${meervoud(w, 'wacht', 'wachten')} op bevestiging` : eerste;
  },
  // Inventaris: producten onder hun meldgrens (lageItems).
  inventaris: ({ onderGrens }) => {
    const n = aantal(onderGrens);
    return n ? `${meervoud(n, 'product onder zijn', 'producten onder hun')} meldgrens` : 'Alles boven de meldgrens';
  },
  // Leads (sales): leads die nog niet afgewerkt zijn.
  'sales-lijst': ({ open }) => {
    const n = aantal(open);
    return n ? meervoud(n, 'open lead', 'open leads') : 'Geen open leads';
  },
};

/**
 * @param {string} tabId  id van de tab zonder "tab-" (tickets, kalender, gepland, inventaris, sales-lijst, ...)
 * @param {object} [cijfers]
 * @returns {string} de samenvatting, of '' voor een scherm zonder samenvatting
 */
export function samenvattingVoor(tabId, cijfers = {}) {
  const maak = Object.hasOwn(TEKSTEN, tabId) ? TEKSTEN[tabId] : null;
  return maak ? maak(cijfers || {}) : '';
}

/** ISO 8601-weeknummer (maandag eerste dag; week 1 bevat de eerste donderdag) van een lokale datum. */
export function isoWeekNummer(datum) {
  // Op de middag rekenen (UTC) houdt de zomertijdwissel buiten de dagtelling.
  const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate(), 12));
  const dag = (d.getUTCDay() + 6) % 7; // maandag = 0
  d.setUTCDate(d.getUTCDate() - dag + 3); // de donderdag van deze week bepaalt het jaar
  const eersteDonderdag = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12));
  const eersteDag = (eersteDonderdag.getUTCDay() + 6) % 7;
  eersteDonderdag.setUTCDate(eersteDonderdag.getUTCDate() - eersteDag + 3);
  return 1 + Math.round((d - eersteDonderdag) / (7 * 24 * 3600 * 1000));
}
