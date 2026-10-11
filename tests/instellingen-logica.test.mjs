process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valideerInstellingen, settingsKey } from '../public/js/schermen/instellingen-logica.js';

const STD = {
  startlocatie: 'Heirbaan 9, 9150 Kruibeke', duurMinuten: 120, maxPerDag: 4, vanTijd: '08:00', totTijd: '17:00',
  laatsteStart: '16:00', werkdagen: [1, 2, 3, 4, 5], maxReistijdMin: 45, tijdslotMinuten: 180, routeKleur: '#f59e0b',
};
const GOED = {
  startlocatie: 'Gent', duur: 90, max: 5, van: '07:30', tot: '16:30', laatsteStart: '15:00',
  maxReistijd: 30, tijdslotMinuten: 120, tijdslotTekst: '120', routeKleur: '#112233', werkdagen: [1, 2],
};
const met = (o) => ({ ...GOED, ...o });

test('geldige invoer geeft de afgeleide waarden', () => {
  assert.deepEqual(valideerInstellingen(GOED, STD), { waarden: {
    startlocatie: 'Gent', duurMinuten: 90, maxPerDag: 5, vanTijd: '07:30', totTijd: '16:30', laatsteStart: '15:00',
    maxReistijdMin: 30, tijdslotMinuten: 120, routeKleur: '#112233',
  } });
});

test('weigering: begintijd niet voor eindtijd (ook gelijk)', () => {
  assert.equal(valideerInstellingen(met({ van: '17:00', tot: '08:00' }), STD).fout, '⚠ Begintijd moet voor eindtijd liggen');
  assert.equal(valideerInstellingen(met({ van: '09:00', tot: '09:00' }), STD).fout, '⚠ Begintijd moet voor eindtijd liggen');
});

test('weigering: laatste start buiten de werktijden (met en zonder ingevulde werkuren)', () => {
  assert.equal(valideerInstellingen(met({ laatsteStart: '07:00' }), STD).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
  assert.equal(valideerInstellingen(met({ laatsteStart: '17:00' }), STD).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
  // lege werkuren: de standaardwaarden gelden als grens
  assert.equal(valideerInstellingen(met({ van: '', tot: '', laatsteStart: '17:30' }), STD).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
  assert.equal(valideerInstellingen(met({ van: '', tot: '', laatsteStart: '08:00' }), STD).fout, undefined);
  // grenzen zelf zijn toegestaan
  assert.equal(valideerInstellingen(met({ laatsteStart: '07:30' }), STD).fout, undefined);
  assert.equal(valideerInstellingen(met({ laatsteStart: '16:30' }), STD).fout, undefined);
});

test('weigering: interventieduur onder 15 (14 weigert, 15 mag, 0 weigert)', () => {
  assert.equal(valideerInstellingen(met({ duur: 14 }), STD).fout, '⚠ Minimale interventieduur is 15 minuten');
  assert.equal(valideerInstellingen(met({ duur: 0 }), STD).fout, '⚠ Minimale interventieduur is 15 minuten');
  assert.equal(valideerInstellingen(met({ duur: 15 }), STD).waarden.duurMinuten, 15);
});

test('weigering: maximaal per dag onder 1 (0 en negatief weigeren, 1 mag)', () => {
  assert.equal(valideerInstellingen(met({ max: 0 }), STD).fout, '⚠ Maximaal per dag moet minstens 1 zijn');
  assert.equal(valideerInstellingen(met({ max: -3 }), STD).fout, '⚠ Maximaal per dag moet minstens 1 zijn');
  assert.equal(valideerInstellingen(met({ max: 1 }), STD).waarden.maxPerDag, 1);
});

test('weigering: negatieve reistijd; 0 is toegestaan en blijft 0', () => {
  assert.equal(valideerInstellingen(met({ maxReistijd: -1 }), STD).fout, '⚠ Max. reistijd kan niet negatief zijn');
  assert.equal(valideerInstellingen(met({ maxReistijd: 0 }), STD).waarden.maxReistijdMin, 0);
});

test('weigering: tijdslot onder 60 (59, 0 en negatief weigeren, 60 mag)', () => {
  const tekst = '⚠ Tijdslot moet minstens 60 minuten zijn';
  assert.equal(valideerInstellingen(met({ tijdslotMinuten: 59, tijdslotTekst: '59' }), STD).fout, tekst);
  assert.equal(valideerInstellingen(met({ tijdslotMinuten: 0, tijdslotTekst: '' }), STD).fout, tekst);
  assert.equal(valideerInstellingen(met({ tijdslotMinuten: -30, tijdslotTekst: '-30' }), STD).fout, tekst);
  assert.equal(valideerInstellingen(met({ tijdslotMinuten: 60, tijdslotTekst: '60' }), STD).waarden.tijdslotMinuten, 60);
});

test('weigering: geen enkele werkdag', () => {
  assert.equal(valideerInstellingen(met({ werkdagen: [] }), STD).fout, '⚠ Selecteer minstens één werkdag');
});

test('volgorde: bij meerdere fouten wint de eerste in de lijst', () => {
  const alles = met({ van: '18:00', tot: '08:00', duur: 1, max: 0, maxReistijd: -5, tijdslotMinuten: 1, werkdagen: [] });
  assert.equal(valideerInstellingen(alles, STD).fout, '⚠ Begintijd moet voor eindtijd liggen');
  // zonder tijdfouten: eerst duur, dan max, dan reistijd, dan tijdslot, dan werkdagen
  const rest = met({ duur: 1, max: 0, maxReistijd: -5, tijdslotMinuten: 1, werkdagen: [] });
  assert.equal(valideerInstellingen(rest, STD).fout, '⚠ Minimale interventieduur is 15 minuten');
  assert.equal(valideerInstellingen({ ...rest, duur: 60 }, STD).fout, '⚠ Maximaal per dag moet minstens 1 zijn');
  assert.equal(valideerInstellingen({ ...rest, duur: 60, max: 2 }, STD).fout, '⚠ Max. reistijd kan niet negatief zijn');
  assert.equal(valideerInstellingen({ ...rest, duur: 60, max: 2, maxReistijd: 5 }, STD).fout, '⚠ Tijdslot moet minstens 60 minuten zijn');
  assert.equal(valideerInstellingen({ ...rest, duur: 60, max: 2, maxReistijd: 5, tijdslotMinuten: 60 }, STD).fout, '⚠ Selecteer minstens één werkdag');
  // laatste start gaat vóór duur
  assert.equal(valideerInstellingen(met({ laatsteStart: '23:00', duur: 1 }), STD).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
});

test('terugvalregels: lege velden vallen terug op de standaard', () => {
  const leeg = valideerInstellingen({
    startlocatie: '   ', duur: 20, max: 1, van: '', tot: '', laatsteStart: '', maxReistijd: 0,
    tijdslotMinuten: 60, tijdslotTekst: 'abc', routeKleur: 'rood', werkdagen: [1],
  }, STD).waarden;
  assert.equal(leeg.startlocatie, STD.startlocatie);
  assert.equal(leeg.vanTijd, '08:00');
  assert.equal(leeg.totTijd, '17:00');
  assert.equal(leeg.laatsteStart, '16:00');
  assert.equal(leeg.tijdslotMinuten, 180); // parseInt('abc') is NaN -> standaard
  assert.equal(leeg.routeKleur, '#f59e0b');
  assert.equal(leeg.maxReistijdMin, 0);
});

test('terugvalregels: NaN-reistijd en routekleur-regex', () => {
  assert.equal(valideerInstellingen(met({ maxReistijd: NaN }), STD).waarden.maxReistijdMin, 45);
  assert.equal(valideerInstellingen(met({ routeKleur: '#ABCDEF' }), STD).waarden.routeKleur, '#ABCDEF');
  assert.equal(valideerInstellingen(met({ routeKleur: '#abc' }), STD).waarden.routeKleur, '#f59e0b');
  assert.equal(valideerInstellingen(met({ startlocatie: '  Gent  ' }), STD).waarden.startlocatie, 'Gent');
});

test('tijdslotMinuten komt uit parseInt van de veldtekst', () => {
  assert.equal(valideerInstellingen(met({ tijdslotMinuten: 90.5, tijdslotTekst: '90.5' }), STD).waarden.tijdslotMinuten, 90);
});

test('settingsKey: all/leeg geeft de gemeenschappelijke sleutel, een persoon een eigen sleutel', () => {
  assert.equal(settingsKey('all'), 'blitz_settings');
  assert.equal(settingsKey(''), 'blitz_settings');
  assert.equal(settingsKey(null), 'blitz_settings');
  assert.equal(settingsKey('Tim Peeters'), 'blitz_settings_Tim Peeters');
});

test('begintijd zonder eindtijd: de eindgrens van de laatste start is de standaard-eindtijd', () => {
  // van ingevuld, tot leeg: geen "begintijd voor eindtijd"-controle (er is geen eindtijd om mee te vergelijken)
  assert.equal(valideerInstellingen(met({ van: '18:00', tot: '', laatsteStart: '' }), STD).fout, undefined);
  // laatste start vóór de ingevulde begintijd wordt wel geweigerd
  assert.equal(valideerInstellingen(met({ van: '16:00', tot: '', laatsteStart: '15:00' }), STD).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
  // laatste start na de standaard-eindtijd (17:00) wordt geweigerd
  assert.equal(valideerInstellingen(met({ van: '09:00', tot: '', laatsteStart: '17:30' }), STD).fout, '⚠ Laatste start moet tussen begin- en eindtijd liggen');
  assert.equal(valideerInstellingen(met({ van: '09:00', tot: '', laatsteStart: '16:30' }), STD).fout, undefined);
});

test('NaN in de numerieke velden: geen weigering en terugval op de standaard (NaN < x is onwaar)', () => {
  const r = valideerInstellingen(met({ duur: NaN, max: NaN, tijdslotMinuten: NaN, tijdslotTekst: '' }), STD);
  assert.equal(r.fout, undefined);
  assert.equal(r.waarden.duurMinuten, STD.duurMinuten);
  assert.equal(r.waarden.maxPerDag, STD.maxPerDag);
  assert.equal(r.waarden.tijdslotMinuten, STD.tijdslotMinuten);
});
