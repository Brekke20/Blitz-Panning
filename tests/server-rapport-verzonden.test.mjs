// tests/server-rapport-verzonden.test.mjs — "verzonden" aanvinken mag nooit verloren gaan door een verouderde archiefversie.
// Bug (2026-11-12): op de tablet vertrok het rapport (#3746, #3998) wel naar Zoho, maar de app bleef "Verstuur rapport" tonen.
// De achtergrondverwerking van een net bewaard rapport hoogt de archiefversie op; de client stuurde daarna zijn oude versie mee
// en kreeg een 409, zodat het vinkje nooit bewaard werd. Eén veld op één item zetten heeft geen versiecontrole nodig.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { metRol } from './auth-hulp.mjs';
import { maakHandler } from '../netlify/functions/rapport-verzonden.js';

const planner = werk => metRol('planner', werk);
const req = body => new Request('http://localhost/api/rapport-verzonden', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-blitz': '1' },
  body: JSON.stringify(body),
});
const TIJD = '2026-11-04T14:58:12.000Z';
const opzet = () => {
  const store = maakNepStore({ rapportlijst: { versie: 7, rapports: [
    { id: 'r1', ticketId: '555', datum: '2026-11-04', technieker: 'Brent' },
    { id: 'r2', ticketId: '556', datum: '2026-11-04', technieker: 'Brent' },
  ] } });
  return { store, h: maakHandler({ getStore: () => store }) };
};
const lijst = store => store.get('rapportlijst', { type: 'json' });

test('een verouderde versie blokkeert het aanvinken niet meer (geen 409)', async () => {
  const { store, h } = opzet();
  const r = await planner(() => h(req({ id: 'r1', doelgroep: 'klant', tijdstip: TIJD, versie: 5 })));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.versie, 8);
  const na = await lijst(store);
  assert.equal(na.versie, 8);
  assert.equal(na.rapports.find(x => x.id === 'r1').verzondenKlant, TIJD);
  assert.equal(na.rapports.find(x => x.id === 'r2').verzondenKlant, undefined);
});

test('drie doelgroepen na elkaar met dezelfde (oude) versie: alle drie bewaard', async () => {
  const { store, h } = opzet();
  for (const doelgroep of ['contact', 'klant', 'installateur']) {
    const r = await planner(() => h(req({ id: 'r1', doelgroep, tijdstip: TIJD, versie: 7 })));
    assert.equal(r.status, 200, doelgroep);
  }
  const e = (await lijst(store)).rapports.find(x => x.id === 'r1');
  assert.equal(e.verzondenContact, TIJD);
  assert.equal(e.verzondenKlant, TIJD);
  assert.equal(e.verzondenInstallateur, TIJD);
});

test('een gelijktijdige schrijver die het vinkje wegschrijft: opnieuw proberen tot het blijft staan', async () => {
  const { store, h } = opzet();
  // Eerste write wordt meteen overschreven door een andere schrijver die nog de oude lijst had.
  const echteSet = store.setJSON.bind(store);
  let overschreven = false;
  store.setJSON = async (k, v) => {
    const oud = await lijst(store);
    await echteSet(k, v);
    if (!overschreven) { overschreven = true; await echteSet(k, { versie: v.versie + 1, rapports: oud.rapports }); }
  };
  const r = await planner(() => h(req({ id: 'r1', doelgroep: 'klant', tijdstip: TIJD })));
  assert.equal(r.status, 200);
  assert.equal((await lijst(store)).rapports.find(x => x.id === 'r1').verzondenKlant, TIJD);
});

test('onbekend rapport blijft 404', async () => {
  const { h } = opzet();
  const r = await planner(() => h(req({ id: 'weg', doelgroep: 'klant', tijdstip: TIJD })));
  assert.equal(r.status, 404);
});
