import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRespToPerson, technieklijst, bouwImportRijen, nieuweImportItems } from '../public/js/schermen/afspraken-logica.js';

const AGENTS = ['Roel Peeters', 'Tim Vermeulen'];

test('matchRespToPerson: exact, ongeacht hoofdletters', () => {
  assert.equal(matchRespToPerson('tim vermeulen', AGENTS), 'Tim Vermeulen');
  assert.equal(matchRespToPerson('ROEL PEETERS', AGENTS), 'Roel Peeters');
});

test('matchRespToPerson: voornaam-only en deelnaam in beide richtingen', () => {
  assert.equal(matchRespToPerson('Tim', AGENTS), 'Tim Vermeulen');
  assert.equal(matchRespToPerson('ROEL', AGENTS), 'Roel Peeters');
  assert.equal(matchRespToPerson('Tim Vermeulen (extern)', ['Tim Vermeulen']), 'Tim Vermeulen');
});

test('matchRespToPerson: dubbele voornaam geeft de eerste in de lijst', () => {
  assert.equal(matchRespToPerson('Tim', ['Tim Aerts', 'Tim Vermeulen']), 'Tim Aerts');
});

test('matchRespToPerson: woorddelen korter dan 3 tekens tellen niet; onbekend, leeg of geen agents geeft null', () => {
  assert.equal(matchRespToPerson('Jo De', ['Jan De Vos']), null);
  assert.equal(matchRespToPerson('Onbekende', AGENTS), null);
  assert.equal(matchRespToPerson('', AGENTS), null);
  assert.equal(matchRespToPerson(undefined, AGENTS), null);
  assert.equal(matchRespToPerson('Tim', []), null);
  assert.equal(matchRespToPerson('Tim', undefined), null);
});

test('technieklijst: uniek, zonder lege namen, gesorteerd, uit alle vier bronnen', () => {
  const lijst = technieklijst(
    [{ assignee: 'Tim' }, { assignee: null }],
    [{ assignee: 'Roel' }, { assignee: 'Tim' }],
    [{ assignee: '' }],
    [{ persoon: 'Anja' }, { persoon: null }, {}]
  );
  assert.deepEqual(lijst, ['Anja', 'Roel', 'Tim']);
});

test('bouwImportRijen: velden, standaardwaarden, titel uit type en linkLabel, matching en verse ids', () => {
  let n = 0;
  const rijen = bouwImportRijen([
    { titel: 'A', datum: '2026-10-08', uur: '09:00', einduur: '11:00', type: 'Installatie', resp: 'tim', notitie: 'n', telefoon: 't', email: 'e' },
    { type: 'Installatie', linkLabel: 'Pietersen', datum: '2026-10-14' },
    {},
  ], AGENTS, () => 'id' + (++n));
  assert.deepEqual(rijen[0], { id: 'id1', titel: 'A', datum: '2026-10-08', uur: '09:00', einduur: '11:00', type: 'Installatie', persoon: 'Tim Vermeulen',
    notitie: 'n', telefoon: 't', email: 'e', bron: 'import', origResp: 'tim', _agents: AGENTS });
  assert.equal(rijen[1].titel, 'Installatie: Pietersen');
  assert.equal(rijen[1].persoon, null);
  assert.equal(rijen[1].type, 'Installatie');
  assert.equal(rijen[2].titel, 'Afspraak: ');
  assert.equal(rijen[2].type, 'Overige');
  assert.equal(rijen[2].datum, '');
  assert.deepEqual(rijen.map(r => r.id), ['id1', 'id2', 'id3']);
});

test('nieuweImportItems: zonder datum en duplicaten (datum+titel+uur) vallen af; _agents verdwijnt', () => {
  const pending = [
    { id: '1', titel: 'A', datum: '2026-10-08', uur: '09:00', _agents: ['x'] },
    { id: '2', titel: 'B', datum: '', uur: '09:00', _agents: ['x'] },
    { id: '3', titel: 'C', datum: '2026-10-09', uur: '10:00', _agents: ['x'] },
  ];
  const bestaand = [{ id: 'z', titel: 'A', datum: '2026-10-08', uur: '09:00' }, { id: 'y', titel: 'C', datum: '2026-10-09', uur: '11:00' }];
  const nieuw = nieuweImportItems(pending, bestaand);
  assert.deepEqual(nieuw, [{ id: '3', titel: 'C', datum: '2026-10-09', uur: '10:00' }]);
});
