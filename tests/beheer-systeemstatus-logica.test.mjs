// Pure logica van de knop "Opnieuw versturen" in Beheer, Systeemstatus (Task 11b): de uitkomst per serverantwoord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opnieuwUitkomst, OPNIEUW_BEVESTIGING } from '../public/js/schermen/beheer-systeemstatus-logica.js';

const r = (status, data = null, netwerk = false) => ({ ok: status >= 200 && status < 300, status, data, netwerk });

test('de bevestigingsvraag is die van de opdracht', () => {
  assert.equal(OPNIEUW_BEVESTIGING.tekst, 'Dit rapport opnieuw naar Zoho sturen?');
});

test('200 of 202: in de wachtrij, de rij toont "opnieuw in behandeling", de knop blijft weg', () => {
  for (const status of [200, 202]) {
    assert.deepEqual(opnieuwUitkomst(r(status, { ok: true, versie: 4 })), {
      soort: 'gelukt', toast: 'Rapport staat opnieuw in de wachtrij', knopBruikbaar: false, rijOpnieuw: true,
    });
  }
});

test('200 ongewijzigd (stond al op wacht of is al verwerkt): eigen melding, ook geen knop meer', () => {
  const u = opnieuwUitkomst(r(200, { ok: true, ongewijzigd: true }));
  assert.equal(u.soort, 'ongewijzigd');
  assert.match(u.toast, /al/);
  assert.equal(u.knopBruikbaar, false);
  assert.equal(u.rijOpnieuw, true);
});

test('503: tijdelijk niet bereikbaar, de knop is weer bruikbaar', () => {
  assert.deepEqual(opnieuwUitkomst(r(503, { error: 'Rapportarchief tijdelijk niet bereikbaar, probeer opnieuw.' })), {
    soort: 'storing', toast: 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.', knopBruikbaar: true, rijOpnieuw: false,
  });
});

test('netwerkfout: geen verbinding, de knop is weer bruikbaar', () => {
  const u = opnieuwUitkomst(r(0, null, true));
  assert.equal(u.soort, 'netwerk');
  assert.match(u.toast, /verbinding/);
  assert.equal(u.knopBruikbaar, true);
  assert.equal(u.rijOpnieuw, false);
});

test('4xx: de servermelding, zonder servermelding een eigen tekst met de status', () => {
  const a = opnieuwUitkomst(r(404, { error: 'Rapport niet gevonden' }));
  assert.deepEqual([a.soort, a.toast, a.knopBruikbaar, a.rijOpnieuw], ['geweigerd', 'Rapport niet gevonden', true, false]);
  const b = opnieuwUitkomst(r(403, { error: 'Je kan enkel je eigen rapporten wijzigen.', code: 'geen-recht' }));
  assert.equal(b.toast, 'Je kan enkel je eigen rapporten wijzigen.');
  const c = opnieuwUitkomst(r(400, null));
  assert.match(c.toast, /HTTP 400/);
});

test('andere 5xx: een melding, de knop is weer bruikbaar', () => {
  const u = opnieuwUitkomst(r(500, { error: 'HTTP 500' }));
  assert.equal(u.knopBruikbaar, true);
  assert.equal(u.rijOpnieuw, false);
  assert.ok(u.toast.length > 0);
});
