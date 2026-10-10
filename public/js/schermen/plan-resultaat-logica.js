// schermen/plan-resultaat-logica.js — de teksten van het resultaatvenster van "Plan deze week" (puur, geen DOM). Gedeeld door de planning van
// de technieker (planacties.js, over tickets) en die van de verkoper (sales-plan-logica.js, over bezoeken): zelfde redenen, zelfde zinnen,
// enkel het woord ("ticket" of "bezoek") en de benaming van een vast uur verschillen.

/** De woorden voor de planning van de technieker. */
export const WOORDEN_TICKET = Object.freeze({ enkel: 'ticket', meer: 'tickets', vastUur: 'Voorkeursuur' });
/** De woorden voor de planning van de verkoper. */
// `enkelvoud`: bij precies één stuk staat er "1 bezoek" (de tekst van de technieker zegt al jaren "1 tickets" en blijft zo, e2e-vast).
export const WOORDEN_BEZOEK = Object.freeze({ enkel: 'bezoek', meer: 'bezoeken', vastUur: 'Vast uur', enkelvoud: true });

const ONBEKEND = 'Geen plaats meer deze week';

/**
 * Gewone-taaltekst bij een reden waarom iets niet gepland werd (redenen van het planner-brein + 'zoho-fout' van de schil van de technieker).
 * `maxReistijdMin`: de ingestelde grens (standaard 45); `woorden`: WOORDEN_TICKET (standaard) of WOORDEN_BEZOEK.
 */
export function redenTekst(reden, { maxReistijdMin = 45, woorden = WOORDEN_TICKET } = {}) {
  const teksten = {
    'geen-plaats':          ONBEKEND,
    'te-ver':               `Te ver van de andere afspraken (meer dan ${maxReistijdMin} min)`,
    'klant-geblokkeerd':    'Klant is niet beschikbaar op de vrije dagen',
    'voorkeursdag-afstand': `Voorkeursdag botst qua afstand met een ander ${woorden.enkel}`,
    'voorkeursdag-vol':     'Voorkeursdag is al vol',
    'vast-uur-botst':       `${woorden.vastUur} botst met een andere afspraak`,
    'adres-niet-gevonden':  'Adres niet gevonden',
    'zoho-fout':            'Kon niet opgeslagen worden in Zoho',
  };
  return Object.hasOwn(teksten, reden) ? teksten[reden] : ONBEKEND;
}

/** De tekst (zonder ⚠) bij een waarschuwing van het brein; null voor een onbekende soort (die tonen we niet). */
export function waarschuwingTekst(w, woorden = WOORDEN_TICKET, naamVan = null) {
  if (w?.soort === 'reistijd-geschat') {
    const aantal = (w.ticketIds ?? []).length;
    // Met een naam-functie (verkoper): de bezoeken bij naam, hoogstens drie, de rest als "+n".
    if (naamVan && aantal) {
      const namen = w.ticketIds.map((id) => naamVan(id));
      const zichtbaar = namen.slice(0, 3).join(', ') + (namen.length > 3 ? ` +${namen.length - 3}` : '');
      return `Reistijd kon niet gecontroleerd worden voor ${zichtbaar} — kijk de route na`;
    }
    return `Reistijd kon niet gecontroleerd worden voor ${aantal} ${aantal === 1 && woorden.enkelvoud ? woorden.enkel : woorden.meer} — kijk de route na`;
  }
  if (w?.soort === 'locatie-onbekend') return 'Locatie van een bestaande afspraak onbekend — reistijdcontrole minder nauwkeurig';
  return null;
}
