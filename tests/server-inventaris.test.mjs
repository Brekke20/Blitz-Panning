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
