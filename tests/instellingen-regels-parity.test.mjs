// Pariteit: het instellingenscherm (valideerInstellingen) en de server (schoonInstellingen) gebruiken dezelfde regels
// (kern/instellingen-regels.js). Elke grensrand en elke tekst gaat door beide en moet hetzelfde oordeel geven.
// Bewuste uitzondering: een ongeldige routekleur weigert de server, het scherm valt stil terug op de standaard (de
// kleurkiezer kan geen ongeldige waarde geven); zie de laatste test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valideerInstellingen } from '../public/js/schermen/instellingen-logica.js';
import { schoonInstellingen } from '../netlify/lib/instellingen.js';
import { WERKUREN_STANDAARD } from '../public/js/kern/instellingen-regels.js';
import { readFileSync } from 'node:fs';

const STD = {
  startlocatie: 'Heirbaan 9, 9150 Kruibeke', duurMinuten: 120, maxPerDag: 4, vanTijd: '08:00', totTijd: '17:00',
  laatsteStart: '16:00', werkdagen: [1, 2, 3, 4, 5], maxReistijdMin: 45, tijdslotMinuten: 180, routeKleur: '#f59e0b',
};

// serverinvoer -> schermformulier (leeg veld = '' of NaN, zoals de DOM het geeft)
function naarFormulier(s) {
  return {
    startlocatie: s.startlocatie ?? '',
    duur: s.duurMinuten ?? NaN, max: s.maxPerDag ?? NaN,
    van: s.vanTijd ?? '', tot: s.totTijd ?? '', laatsteStart: s.laatsteStart ?? '',
    maxReistijd: s.maxReistijdMin ?? NaN,
    tijdslotMinuten: s.tijdslotMinuten ?? NaN, tijdslotTekst: s.tijdslotMinuten === undefined ? '' : String(s.tijdslotMinuten),
    routeKleur: s.routeKleur ?? STD.routeKleur,
    werkdagen: s.werkdagen ?? [1],
  };
}
const oordeel = r => (r.fout ? { fout: r.fout } : { ok: true });
const vergelijk = (s, label) => assert.deepEqual(
  oordeel(valideerInstellingen(naarFormulier(s), STD)), oordeel(schoonInstellingen(s)), label ?? JSON.stringify(s),
);

test('de werkuren-standaard van de regels is die van de app', () => {
  const bron = readFileSync(new URL('../public/js/schermen/instellingen.js', import.meta.url), 'utf8');
  assert.match(bron, new RegExp(`vanTijd:\\s*'${WERKUREN_STANDAARD.vanTijd}'`));
  assert.match(bron, new RegExp(`totTijd:\\s*'${WERKUREN_STANDAARD.totTijd}'`));
});

test('pariteit: elke grensrand en elke weigeringstekst geeft op scherm en server hetzelfde oordeel', () => {
  const gevallen = [
    {},
    { duurMinuten: 14 }, { duurMinuten: 15 }, { duurMinuten: 0 }, { duurMinuten: -5 },
    { maxPerDag: 0 }, { maxPerDag: 1 }, { maxPerDag: -3 },
    { maxReistijdMin: -1 }, { maxReistijdMin: 0 },
    { tijdslotMinuten: 59 }, { tijdslotMinuten: 60 }, { tijdslotMinuten: 0 }, { tijdslotMinuten: -30 },
    { werkdagen: [] }, { werkdagen: [0] }, { werkdagen: [1, 2, 3, 4, 5] },
    { vanTijd: '17:00', totTijd: '08:00' }, { vanTijd: '09:00', totTijd: '09:00' }, { vanTijd: '07:30', totTijd: '16:30' },
    // laatste start, met en zonder ingevulde werkuren (terugval op de standaardwerkuren)
    { laatsteStart: '07:59' }, { laatsteStart: '08:00' }, { laatsteStart: '17:00' }, { laatsteStart: '17:01' },
    { vanTijd: '07:30', totTijd: '16:30', laatsteStart: '07:00' }, { vanTijd: '07:30', totTijd: '16:30', laatsteStart: '07:30' },
    { vanTijd: '07:30', totTijd: '16:30', laatsteStart: '16:30' }, { vanTijd: '07:30', totTijd: '16:30', laatsteStart: '16:31' },
    { vanTijd: '18:00', laatsteStart: '' }, { vanTijd: '16:00', laatsteStart: '15:00' },
    { totTijd: '12:00', laatsteStart: '13:00' }, { totTijd: '12:00', laatsteStart: '12:00' },
    { startlocatie: '   ' }, { startlocatie: 'Gent' },
    // meerdere fouten tegelijk: dezelfde eerste weigering
    { vanTijd: '18:00', totTijd: '08:00', duurMinuten: 1, maxPerDag: 0, maxReistijdMin: -5, tijdslotMinuten: 1, werkdagen: [] },
    { duurMinuten: 1, maxPerDag: 0, maxReistijdMin: -5, tijdslotMinuten: 1, werkdagen: [] },
    { duurMinuten: 60, maxPerDag: 0, maxReistijdMin: -5, tijdslotMinuten: 1, werkdagen: [] },
    { duurMinuten: 60, maxPerDag: 2, maxReistijdMin: -5, tijdslotMinuten: 1, werkdagen: [] },
    { duurMinuten: 60, maxPerDag: 2, maxReistijdMin: 5, tijdslotMinuten: 1, werkdagen: [] },
    { duurMinuten: 60, maxPerDag: 2, maxReistijdMin: 5, tijdslotMinuten: 60, werkdagen: [] },
    { laatsteStart: '23:00', duurMinuten: 1 },
  ];
  for (const g of gevallen) vergelijk(g);
  // ook met een geldige routekleur
  vergelijk({ routeKleur: '#ABCDEF', duurMinuten: 90 });
});

test('pariteit: de weigeringsteksten zijn exact die van het scherm', () => {
  const teksten = [
    [{ vanTijd: '17:00', totTijd: '08:00' }, '⚠ Begintijd moet voor eindtijd liggen'],
    [{ laatsteStart: '17:30' }, '⚠ Laatste start moet tussen begin- en eindtijd liggen'],
    [{ duurMinuten: 14 }, '⚠ Minimale interventieduur is 15 minuten'],
    [{ maxPerDag: 0 }, '⚠ Maximaal per dag moet minstens 1 zijn'],
    [{ maxReistijdMin: -1 }, '⚠ Max. reistijd kan niet negatief zijn'],
    [{ tijdslotMinuten: 59 }, '⚠ Tijdslot moet minstens 60 minuten zijn'],
    [{ werkdagen: [] }, '⚠ Selecteer minstens één werkdag'],
  ];
  for (const [invoer, tekst] of teksten) {
    assert.equal(schoonInstellingen(invoer).fout, tekst);
    assert.equal(valideerInstellingen(naarFormulier(invoer), STD).fout, tekst);
  }
});

test('pariteit: een leeg of ontbrekend veld is geen weigering; server geeft enkel de aanwezige velden terug', () => {
  assert.deepEqual(schoonInstellingen({ startlocatie: '  ', duurMinuten: undefined }).waarden, {});
  assert.deepEqual(schoonInstellingen({ vanTijd: '', laatsteStart: '' }).waarden, {});
  assert.equal(valideerInstellingen(naarFormulier({}), STD).fout, undefined);
});

test('bewuste uitzondering: ongeldige routekleur weigert de server, het scherm valt terug op de standaard', () => {
  assert.ok(schoonInstellingen({ routeKleur: 'rood' }).fout);
  const r = valideerInstellingen({ ...naarFormulier({}), routeKleur: 'rood' }, STD);
  assert.equal(r.fout, undefined);
  assert.equal(r.waarden.routeKleur, STD.routeKleur);
});
