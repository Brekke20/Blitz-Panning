// Pure logica van de tab Activiteitenlog (logins T18): labels, querystring, groeperen per Brusselse dag, standaardperiode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actieLabel, ACTIES, bouwActiviteitUrl, groepeerPerDag, standaardPeriode, formatDagKop, formatUur, formatDatumTijd } from '../public/js/schermen/beheer-activiteit-logica.js';

const TWINTIG = [
  'login', 'login-mislukt-reeks', 'uitloggen', 'wachtwoord-gewijzigd', 'herstel', 'gebruiker-aangemaakt', 'gebruiker-gewijzigd',
  'gebruiker-geblokkeerd', 'plannen', 'voorstel-verstuurd', 'annulatie', 'rapport-verstuurd', 'rapport-opnieuw', 'sales-import',
  'sales-lead-verwijderd', 'sales-resultaat', 'instellingen-gewijzigd', 'wachtwoord-gereset', 'foto-toegevoegd', 'notitie-toegevoegd',
];

test('actieLabel: alle 20 namen uit het koppelvlak hebben een eigen label', () => {
  const labels = TWINTIG.map(actieLabel);
  for (const [i, l] of labels.entries()) {
    assert.ok(typeof l === 'string' && l.length > 0, TWINTIG[i]);
    assert.notEqual(l, TWINTIG[i], `${TWINTIG[i]} heeft geen label`);
  }
  assert.equal(new Set(labels).size, TWINTIG.length, 'labels zijn uniek');
  for (const naam of TWINTIG) assert.ok(ACTIES.includes(naam), `${naam} staat in ACTIES`);
});

test('actieLabel: vaste voorbeelden en onbekend valt terug op de ruwe naam', () => {
  assert.equal(actieLabel('login'), 'Ingelogd');
  assert.equal(actieLabel('plannen'), 'Ingepland');
  assert.equal(actieLabel('instellingen-gewijzigd'), 'Instellingen gewijzigd');
  assert.equal(actieLabel('wachtwoord-gereset'), 'Wachtwoord gereset');
  assert.equal(actieLabel('foto-toegevoegd'), 'Foto toegevoegd');
  assert.equal(actieLabel('notitie-toegevoegd'), 'Notitie toegevoegd');
  assert.equal(actieLabel('iets-nieuws'), 'iets-nieuws');
  assert.equal(actieLabel(undefined), '');
  assert.equal(actieLabel(null), '');
});

test('bouwActiviteitUrl: enkel ingevulde filters, in vaste volgorde en geëncodeerd', () => {
  assert.equal(bouwActiviteitUrl({ van: '2026-10-01', actie: 'login' }), '/api/activiteit?van=2026-10-01&actie=login');
  assert.equal(bouwActiviteitUrl({}), '/api/activiteit');
  assert.equal(bouwActiviteitUrl(), '/api/activiteit');
  assert.equal(bouwActiviteitUrl({ van: '', tot: '', gebruiker: '', actie: '' }), '/api/activiteit');
  assert.equal(bouwActiviteitUrl({ gebruiker: 'a&b=c d', tot: '2026-10-08' }), '/api/activiteit?tot=2026-10-08&gebruiker=a%26b%3Dc%20d');
  assert.equal(
    bouwActiviteitUrl({ actie: 'plannen', gebruiker: 'u1', tot: '2026-10-08', van: '2026-10-01' }),
    '/api/activiteit?van=2026-10-01&tot=2026-10-08&gebruiker=u1&actie=plannen',
  );
});

test('groepeerPerDag: Brusselse kalenderdag rond middernacht UTC, nieuwste eerst', () => {
  const items = [
    { op: '2026-10-07T21:59:59.000Z', naam: 'a' }, // 23:59:59 Brussel (CEST) -> 7 okt
    { op: '2026-10-07T22:00:00.000Z', naam: 'b' }, // 00:00 Brussel -> 8 okt
    { op: '2026-10-08T10:00:00.000Z', naam: 'c' }, // 8 okt
    { op: '2026-01-15T23:30:00.000Z', naam: 'd' }, // 00:30 Brussel (CET) -> 16 jan
  ];
  const kopie = structuredClone(items);
  const groepen = groepeerPerDag(items);
  assert.deepEqual(groepen.map(g => g.dag), ['2026-10-08', '2026-10-07', '2026-01-16']);
  assert.deepEqual(groepen[0].items.map(i => i.naam), ['c', 'b']);
  assert.deepEqual(groepen[1].items.map(i => i.naam), ['a']);
  assert.deepEqual(groepen[2].items.map(i => i.naam), ['d']);
  assert.deepEqual(items, kopie, 'muteert de invoer niet');
  assert.deepEqual(groepeerPerDag([]), []);
  assert.deepEqual(groepeerPerDag(null), []);
});

test('groepeerPerDag: een item zonder geldige tijd verdwijnt niet', () => {
  const g = groepeerPerDag([{ op: 'kapot', naam: 'x' }, { op: '2026-10-08T10:00:00.000Z', naam: 'y' }]);
  assert.equal(g.length, 2);
  assert.equal(g[0].dag, '2026-10-08');
  assert.equal(g[1].dag, '');
  assert.equal(g[1].items[0].naam, 'x');
});

test('standaardPeriode: laatste 30 dagen, tot = vandaag in Brussel', () => {
  assert.deepEqual(standaardPeriode(new Date('2026-10-08T12:00:00Z')), { van: '2026-09-08', tot: '2026-10-08' });
  assert.deepEqual(standaardPeriode(new Date('2026-10-08')), { van: '2026-09-08', tot: '2026-10-08' });
  assert.deepEqual(standaardPeriode('2026-10-08'), { van: '2026-09-08', tot: '2026-10-08' });
  // 23:30 UTC is al de volgende dag in Brussel
  assert.deepEqual(standaardPeriode(new Date('2026-10-08T22:30:00Z')), { van: '2026-09-09', tot: '2026-10-09' });
  assert.deepEqual(standaardPeriode(new Date('2026-03-05T12:00:00Z')), { van: '2026-02-03', tot: '2026-03-05' });
});

test('formatDagKop, formatUur en formatDatumTijd: Brusselse weergave, ongeldig valt netjes terug', () => {
  assert.equal(formatDagKop('2026-10-08'), 'donderdag 8 oktober 2026');
  assert.equal(formatDagKop(''), 'Onbekende datum');
  assert.equal(formatUur('2026-10-07T22:05:00.000Z'), '00:05');
  assert.equal(formatUur('kapot'), '—');
  assert.equal(formatUur(undefined), '—');
  assert.equal(formatDatumTijd('2026-01-15T23:30:00.000Z'), '16/01/2026 00:30');
  assert.equal(formatDatumTijd(''), '—');
  assert.equal(formatDatumTijd(null), '—');
});

// Elke actienaam die de server logt (`actie: '...'` in netlify/) moet een eigen label hebben, anders toont het log de ruwe sleutel.
function lees(map) {
  const uit = [];
  for (const naam of readdirSync(map)) {
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) { if (naam !== 'node_modules') uit.push(...lees(pad)); } else if (/\.m?js$/.test(naam)) uit.push(pad);
  }
  return uit;
}
test('elke actienaam die de server logt staat in ACTIES en heeft een label', () => {
  const gelogd = new Set();
  for (const pad of lees(fileURLToPath(new URL('../netlify', import.meta.url)))) {
    for (const m of readFileSync(pad, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').matchAll(/actie:\s*'([a-z][a-z-]*)'/g)) gelogd.add(m[1]);
  }
  assert.ok(gelogd.size >= 15, `te weinig actienamen gevonden (${gelogd.size}): is de scan stuk?`);
  for (const naam of gelogd) {
    assert.ok(ACTIES.includes(naam), `de server logt '${naam}' maar ACTIES kent die niet`);
    assert.notEqual(actieLabel(naam), naam, `'${naam}' heeft geen label`);
  }
  assert.ok(gelogd.has('rapport-geweigerd') && gelogd.has('herstel-mislukt-reeks'));
});
