import test from 'node:test';
import assert from 'node:assert/strict';
import { redenTekst, waarschuwingTekst, WOORDEN_TICKET, WOORDEN_BEZOEK } from '../public/js/schermen/plan-resultaat-logica.js';
import { redenTekst as redenVerkoper } from '../public/js/schermen/sales-plan-logica.js';

// Het resultaatvenster van "Plan deze week" is gedeeld door de technieker (tickets) en de verkoper (bezoeken): zelfde zinnen, ander woord.

test('technieker: de zinnen van het resultaatvenster blijven zoals ze waren', () => {
  assert.equal(redenTekst('geen-plaats'), 'Geen plaats meer deze week');
  assert.equal(redenTekst('te-ver', { maxReistijdMin: 30 }), 'Te ver van de andere afspraken (meer dan 30 min)');
  assert.equal(redenTekst('te-ver'), 'Te ver van de andere afspraken (meer dan 45 min)');
  assert.equal(redenTekst('klant-geblokkeerd'), 'Klant is niet beschikbaar op de vrije dagen');
  assert.equal(redenTekst('voorkeursdag-afstand'), 'Voorkeursdag botst qua afstand met een ander ticket');
  assert.equal(redenTekst('voorkeursdag-vol'), 'Voorkeursdag is al vol');
  assert.equal(redenTekst('vast-uur-botst'), 'Voorkeursuur botst met een andere afspraak');
  assert.equal(redenTekst('adres-niet-gevonden'), 'Adres niet gevonden');
  assert.equal(redenTekst('zoho-fout'), 'Kon niet opgeslagen worden in Zoho');
});

test('verkoper: dezelfde zinnen, maar over een bezoek en een vast uur', () => {
  assert.equal(redenTekst('voorkeursdag-afstand', { woorden: WOORDEN_BEZOEK }), 'Voorkeursdag botst qua afstand met een ander bezoek');
  assert.equal(redenTekst('vast-uur-botst', { woorden: WOORDEN_BEZOEK }), 'Vast uur botst met een andere afspraak');
  assert.equal(redenVerkoper('te-ver', { maxReistijdMin: 25 }), 'Te ver van de andere afspraken (meer dan 25 min)');
});

test('een onbekende of overgeërfde reden valt terug op "geen plaats"', () => {
  for (const reden of ['iets-nieuws', undefined, null, '', 'constructor', 'toString']) assert.equal(redenTekst(reden), 'Geen plaats meer deze week', String(reden));
});

test('waarschuwingTekst: aantal en woord; onbekende soorten geven null', () => {
  assert.equal(waarschuwingTekst({ soort: 'reistijd-geschat', ticketIds: [1, 2, 3] }, WOORDEN_TICKET), 'Reistijd kon niet gecontroleerd worden voor 3 tickets — kijk de route na');
  assert.equal(waarschuwingTekst({ soort: 'reistijd-geschat', ticketIds: ['a'] }, WOORDEN_BEZOEK), 'Reistijd kon niet gecontroleerd worden voor 1 bezoek — kijk de route na');
  assert.equal(waarschuwingTekst({ soort: 'reistijd-geschat' }), 'Reistijd kon niet gecontroleerd worden voor 0 tickets — kijk de route na');
  assert.equal(waarschuwingTekst({ soort: 'locatie-onbekend' }), 'Locatie van een bestaande afspraak onbekend — reistijdcontrole minder nauwkeurig');
  assert.equal(waarschuwingTekst({ soort: 'iets-anders' }), null);
  assert.equal(waarschuwingTekst(null), null);
});
