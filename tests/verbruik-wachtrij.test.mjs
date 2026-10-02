// Wagenvoorraad-aftrek na een rapport (etappe 7, Q4): melding bij mislukken, herpoging enkel na een ZEKERE mislukking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakVerbruikWachtrij, classificeer, TEKSTEN } from '../public/js/kern/verbruik-wachtrij.js';

const ITEMS = [{ materiaalId: 'm1', materiaalNaam: 'Kabel', aantal: 2 }];

function bouw({ antwoorden = [], online = true, begin = [], versie = 5, klok = { t: 1000 } } = {}) {
  let lijst = JSON.parse(JSON.stringify(begin));
  const posts = [], toasts = [], succes = [];
  let n = 0;
  const w = maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijst)), schrijf: l => { lijst = JSON.parse(JSON.stringify(l)); } },
    post: async body => {
      posts.push(body);
      const a = antwoorden.shift();
      if (a instanceof Error) throw a;
      return a;
    },
    versie: () => versie,
    naSucces: d => { succes.push(d); versie = d.versie; },
    naConflict: d => { if (d) versie = d.versie; },
    toon: (t, ms) => toasts.push(t),
    online: () => online,
    nu: () => klok.t,
    maakId: () => 'id' + (++n),
  });
  return { w, posts, toasts, succes, lijst: () => lijst, klok };
}
const ok = versie => ({ status: 200, data: { versie, wagenvoorraad: {}, log: [] } });
const conflict = versie => ({ status: 409, data: { error: 'gewijzigd', serverVersie: versie, data: { versie } } });

test('classificeer: zeker (409, eigen 503) tegenover onzeker (netwerk, 500, 502, 503 van gateway) en definitief (4xx)', () => {
  assert.equal(classificeer({ res: conflict(9) }).uitkomst, 'conflict');
  assert.equal(classificeer({ res: conflict(9) }).versie, 9);
  assert.equal(classificeer({ res: { status: 503, data: { error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' } } }).uitkomst, 'tijdelijk');
  assert.equal(classificeer({ res: { status: 503, data: null } }).uitkomst, 'onzeker');
  for (const s of [500, 502, 504]) assert.equal(classificeer({ res: { status: s, data: null } }).uitkomst, 'onzeker');
  for (const s of [400, 404, 405]) assert.equal(classificeer({ res: { status: s, data: { error: 'x' } } }).uitkomst, 'definitief');
  assert.equal(classificeer({ err: new TypeError('Failed to fetch') }).uitkomst, 'onzeker');
  assert.equal(classificeer({ err: new DOMException('Time-out na 20 s', 'TimeoutError') }).detail, 'De server antwoordt niet (time-out na 20 s)');
});

test('gelukt: geen melding, geen wachtrij, één POST met de huidige versie', async () => {
  const t = bouw({ antwoorden: [ok(6)] });
  await t.w.meld('Jan', ITEMS);
  assert.deepEqual(t.toasts, []);
  assert.equal(t.lijst().length, 0);
  assert.deepEqual(t.posts, [{ versie: 5, technieker: 'Jan', actie: 'verbruik', items: ITEMS }]);
});

test('409 bij de eerste poging: meteen opnieuw met de nieuwe versie, geen melding bij succes', async () => {
  const t = bouw({ antwoorden: [conflict(7), ok(8)] });
  await t.w.meld('Jan', ITEMS);
  assert.deepEqual(t.posts.map(p => p.versie), [5, 7]);
  assert.deepEqual(t.toasts, []);
  assert.equal(t.lijst().length, 0);
});

test('onzekere uitkomst (netwerkfout, time-out, 502): melding, NIET in de wachtrij, nooit een herpoging', async () => {
  for (const a of [new TypeError('Failed to fetch'), new DOMException('Time-out na 20 s', 'TimeoutError'), { status: 502, data: null }, { status: 500, data: { error: 'Opslaan mislukt: x' } }]) {
    const t = bouw({ antwoorden: [a, ok(6)] });
    await t.w.meld('Jan', ITEMS);
    assert.equal(t.posts.length, 1, 'één POST');
    assert.equal(t.lijst().length, 0, 'niet opnieuw proberen');
    assert.equal(t.toasts.length, 1);
    assert.match(t.toasts[0], /^⚠ Onzeker of de wagenvoorraad is bijgewerkt \(/);
    await t.w.verwerk();
    assert.equal(t.posts.length, 1, 'ook de wachtrijverwerking stuurt niets');
  }
});

test('definitieve fout (400): melding, niet in de wachtrij', async () => {
  const t = bouw({ antwoorden: [{ status: 400, data: { error: 'ongeldig' } }] });
  await t.w.meld('Jan', ITEMS);
  assert.deepEqual(t.toasts, [TEKSTEN.definitief]);
  assert.equal(t.lijst().length, 0);
});

test('offline: niets verzonden, in de wachtrij met melding; bij weer online één poging en melding "alsnog"', async () => {
  const t = bouw({ antwoorden: [ok(6)], online: false });
  await t.w.meld('Jan', ITEMS);
  assert.equal(t.posts.length, 0);
  assert.deepEqual(t.toasts, [TEKSTEN.wachtrij]);
  assert.equal(t.lijst().length, 1);
  await t.w.verwerk(); // nog offline: niets
  assert.equal(t.posts.length, 0);
});

test('eigen 503 (opslag niet bereikbaar): in de wachtrij; later gelukt, precies één aftrek, item weg', async () => {
  const t = bouw({ antwoorden: [{ status: 503, data: { error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' } }, ok(6)] });
  await t.w.meld('Jan', ITEMS);
  assert.deepEqual(t.toasts, [TEKSTEN.wachtrij]);
  assert.equal(t.lijst().length, 1);
  await t.w.verwerk();
  assert.equal(t.posts.length, 2);
  assert.equal(t.lijst().length, 0);
  assert.deepEqual(t.toasts, [TEKSTEN.wachtrij, TEKSTEN.alsnog]);
  await t.w.verwerk(); // lege wachtrij: geen nieuwe POST
  assert.equal(t.posts.length, 2);
});

test('herpoging zonder succes blijft in de wachtrij; na 8 pogingen een definitieve melding en het item weg', async () => {
  const stuk = { status: 503, data: { error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' } };
  const t = bouw({ antwoorden: Array(20).fill(stuk) });
  await t.w.meld('Jan', ITEMS);
  for (let i = 0; i < 7; i++) { await t.w.verwerk(); assert.equal(t.lijst().length, 1); }
  await t.w.verwerk();
  assert.equal(t.lijst().length, 0);
  assert.equal(t.toasts.at(-1), TEKSTEN.definitief);
});

test('onzeker tijdens een herpoging: item weg en melding, geen derde poging', async () => {
  const t = bouw({ antwoorden: [{ status: 503, data: { error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' } }, new TypeError('Failed to fetch'), ok(6)] });
  await t.w.meld('Jan', ITEMS);
  await t.w.verwerk();
  assert.equal(t.lijst().length, 0);
  assert.match(t.toasts.at(-1), /^⚠ Onzeker/);
  await t.w.verwerk();
  assert.equal(t.posts.length, 2);
});

test('een item dat onderweg stond en waarvan de lease verliep (pagina gesloten) is onzeker: melding, nooit opnieuw', async () => {
  const klok = { t: 100000 };
  const t = bouw({ begin: [{ id: 'x', technieker: 'Jan', items: ITEMS, pogingen: 0, bezigTot: 50000 }], antwoorden: [ok(6)], klok });
  await t.w.verwerk();
  assert.equal(t.posts.length, 0);
  assert.equal(t.lijst().length, 0);
  assert.match(t.toasts[0], /^⚠ Onzeker/);
});

test('een item met een lopende lease (andere tab bezig) wordt overgeslagen', async () => {
  const t = bouw({ begin: [{ id: 'x', technieker: 'Jan', items: ITEMS, pogingen: 0, bezigTot: 200000 }], antwoorden: [ok(6)], klok: { t: 100000 } });
  await t.w.verwerk();
  assert.equal(t.posts.length, 0);
  assert.equal(t.lijst().length, 1);
  assert.deepEqual(t.toasts, []);
});

test('tijdens het verzenden staat het item op onderweg; een andere tab die het item al afhandelde, laat de herpoging na een 409 vervallen', async () => {
  const klok = { t: 1000 };
  // Eerste antwoord: 409; bij die POST verwijdert "een andere tab" het item (het is daar gelukt).
  let eersteGedaan = false;
  const lijstRef = { lijst: [{ id: 'x', technieker: 'Jan', items: ITEMS, pogingen: 1, bezigTot: null }] };
  const posts = [];
  const w = maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijstRef.lijst)), schrijf: l => { lijstRef.lijst = JSON.parse(JSON.stringify(l)); } },
    post: async body => {
      posts.push(body);
      assert.ok(lijstRef.lijst[0].bezigTot > klok.t, 'lease gezet tijdens het verzenden');
      if (!eersteGedaan) { eersteGedaan = true; lijstRef.lijst = []; return conflict(9); }
      return ok(10);
    },
    versie: () => 5, naSucces: () => {}, toon: () => {}, nu: () => klok.t,
  });
  await w.verwerk();
  assert.equal(posts.length, 1, 'geen tweede POST: het item bestaat niet meer');
});
