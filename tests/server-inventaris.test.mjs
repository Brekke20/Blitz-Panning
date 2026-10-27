// tests/server-inventaris.test.mjs — /api/inventaris: aftrek na een rapport (verbruik) met het ticketnummer in de logregel
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { metRol } from './auth-hulp.mjs';
import { maakHandler } from '../netlify/functions/inventaris.js';

const tim = werk => metRol('technieker', werk, { zohoNaam: 'Tim' });
const req = body => new Request('http://localhost/api/inventaris', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-blitz': '1' },
  body: JSON.stringify(body),
});
const ITEMS = [{ materiaalId: 'kabel', materiaalNaam: 'Kabel', aantal: 2 }, { materiaalId: 'zekering', materiaalNaam: 'Zekering', aantal: 3 }];
const opzet = () => {
  const store = maakNepStore({ inventaris: { versie: 4, wagenvoorraad: { Tim: { kabel: { aantal: 5, gedempt: false }, zekering: 1 } }, log: [] } });
  return { store, h: maakHandler({ getStore: () => store }) };
};
const bewaard = store => store.get('inventaris', { type: 'json' });

test('verbruik trekt af (nooit onder 0) en logt de echt toegepaste aftrek', async () => {
  const { store, h } = opzet();
  const r = await tim(() => h(req({ versie: 4, technieker: 'Tim', actie: 'verbruik', items: ITEMS })));
  assert.equal(r.status, 200);
  const d = await bewaard(store);
  assert.equal(d.versie, 5);
  assert.equal(d.wagenvoorraad.Tim.kabel.aantal, 3);
  assert.equal(d.wagenvoorraad.Tim.zekering.aantal, 0);
  assert.deepEqual(d.log.map(l => [l.materiaalId, l.aantal, l.type]), [['kabel', -2, 'verbruik'], ['zekering', -1, 'verbruik']]);
  assert.ok(d.log.every(l => !('ticketNummer' in l)), 'zonder ticketnummer geen veld');
});

test('verbruik met ticketNummer: elke logregel krijgt het nummer (getal of tekst, # en spaties weg)', async () => {
  for (const [invoer, verwacht] of [['3979', '3979'], [3979, '3979'], [' #3979 ', '3979']]) {
    const { store, h } = opzet();
    const r = await tim(() => h(req({ versie: 4, technieker: 'Tim', actie: 'verbruik', items: ITEMS, ticketNummer: invoer })));
    assert.equal(r.status, 200);
    const d = await bewaard(store);
    assert.deepEqual(d.log.map(l => l.ticketNummer), [verwacht, verwacht], `invoer ${JSON.stringify(invoer)}`);
    assert.equal((await r.json()).log[0].ticketNummer, verwacht);
  }
});

test('een onbruikbaar ticketNummer weigert de aftrek niet (anders gaat ze verloren), maar wordt niet bewaard', async () => {
  for (const invoer of ['', '   ', '#', 'x'.repeat(41), { id: 1 }, true, null, NaN]) {
    const { store, h } = opzet();
    const r = await tim(() => h(req({ versie: 4, technieker: 'Tim', actie: 'verbruik', items: ITEMS, ticketNummer: invoer })));
    assert.equal(r.status, 200, `invoer ${String(invoer)}`);
    const d = await bewaard(store);
    assert.equal(d.wagenvoorraad.Tim.kabel.aantal, 3);
    assert.ok(d.log.every(l => !('ticketNummer' in l)), `invoer ${String(invoer)}`);
  }
});

test('mutatie (aanvulling/correctie) bewaart nooit een ticketNummer', async () => {
  const { store, h } = opzet();
  const r = await tim(() => h(req({ versie: 4, technieker: 'Tim', actie: 'mutatie', ticketNummer: '3979',
    items: [{ materiaalId: 'kabel', materiaalNaam: 'Kabel', aantal: 4 }] })));
  assert.equal(r.status, 200);
  const d = await bewaard(store);
  assert.equal(d.log[0].type, 'aanvulling');
  assert.ok(!('ticketNummer' in d.log[0]));
});

// ── Karakterisering (2026-10-27, vóór de meldgrens): normalisatie en het belletje (gedempt) ──
const get = () => new Request('http://localhost/api/inventaris', { method: 'GET', headers: { 'x-blitz': '1' } });

test('GET normaliseert een oud getal naar een voorraadregel', async () => {
  const { h } = opzet();
  const r = await tim(() => h(get()));
  const d = await r.json();
  assert.equal(d.wagenvoorraad.Tim.zekering.aantal, 1);
  assert.equal(d.wagenvoorraad.Tim.zekering.gedempt, false);
});

test('gedempt: enkel een boolean, enkel bij mutatie', async () => {
  const { h } = opzet();
  const fout = await tim(() => h(req({ versie: 4, technieker: 'Tim', actie: 'mutatie', items: [{ materiaalId: 'kabel', materiaalNaam: 'Kabel', gedempt: 'ja' }] })));
  assert.equal(fout.status, 400);
  const verbruik = await tim(() => h(req({ versie: 4, technieker: 'Tim', actie: 'verbruik', items: [{ materiaalId: 'kabel', materiaalNaam: 'Kabel', aantal: 1, gedempt: true }] })));
  assert.equal(verbruik.status, 400);
  const leeg = await tim(() => h(req({ versie: 4, technieker: 'Tim', actie: 'mutatie', items: [{ materiaalId: 'kabel', materiaalNaam: 'Kabel' }] })));
  assert.equal(leeg.status, 400);
});

test('een zuivere demp-wijziging logt niets maar verhoogt de versie', async () => {
  const { store, h } = opzet();
  const r = await tim(() => h(req({ versie: 4, technieker: 'Tim', actie: 'mutatie', items: [{ materiaalId: 'kabel', materiaalNaam: 'Kabel', gedempt: true }] })));
  assert.equal(r.status, 200);
  const d = await bewaard(store);
  assert.equal(d.versie, 5);
  assert.equal(d.log.length, 0);
  assert.equal(d.wagenvoorraad.Tim.kabel.gedempt, true);
  assert.equal(d.wagenvoorraad.Tim.kabel.aantal, 5);
});
