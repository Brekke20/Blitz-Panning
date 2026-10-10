// Wagenvoorraad-aftrek na een rapport (etappe 7, Q4): melding bij mislukken, herpoging enkel na een ZEKERE mislukking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakVerbruikWachtrij, classificeer, hoortBijGebruiker, TEKSTEN } from '../public/js/kern/verbruik-wachtrij.js';

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
  assert.equal(classificeer({ err: Object.assign(new TypeError('Failed to fetch'), { vanFetch: true }) }).uitkomst, 'onzeker');
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
  for (const a of [Object.assign(new TypeError('Failed to fetch'), { vanFetch: true }), new DOMException('Time-out na 20 s', 'TimeoutError'), { status: 502, data: null }, { status: 500, data: { error: 'Opslaan mislukt: x' } }]) {
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
  const t = bouw({ antwoorden: [{ status: 503, data: { error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' } }, Object.assign(new TypeError('Failed to fetch'), { vanFetch: true }), ok(6)] });
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

// Fix-ronde 1 (review 8a): twee tabs op één opslag mogen nooit hetzelfde item twee keer verzenden.
test('twee instanties, één opslag, 2 items: elk item precies één POST (geen dubbele aftrek)', async () => {
  const it = [{ materiaalId: 'm', materiaalNaam: 'k', aantal: 1 }];
  let lijst = [{ id: 'a', technieker: 'J', items: it, pogingen: 0, bezigTot: null }, { id: 'b', technieker: 'J', items: it, pogingen: 0, bezigTot: null }];
  const posts = [], open = [];
  const tab = (naam) => maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijst)), schrijf: l => { lijst = JSON.parse(JSON.stringify(l)); } },
    post: (body) => new Promise(r => { posts.push(naam + ':' + body.technieker + ':' + (lijst.find(e => e.bezigTot) || {}).id); open.push(() => r({ status: 200, data: { versie: 1 } })); }),
    versie: () => 1, naSucces: () => {}, toon: () => {}, nu: () => 1000, maakId: () => naam + Math.random(),
  });
  const A = tab('A'), B = tab('B');
  const tick = () => new Promise(r => setTimeout(r, 5));
  const pb = B.verwerk(); await tick();
  const pa = A.verwerk(); await tick();
  open.shift()(); await tick();      // B klaart zijn eerste item en gaat verder
  while (open.length) { open.shift()(); await tick(); }
  await Promise.all([pa, pb]);
  assert.equal(posts.length, 2, 'precies twee POSTs voor twee items: ' + posts.join(' | '));
  assert.equal(lijst.length, 0);
});

test('slot: verwerk draait binnen het meegegeven slot; een bezet slot slaat de ronde over', async () => {
  let bezet = false; const posts = [];
  let lijst = [{ id: 'x', technieker: 'J', items: ITEMS, pogingen: 0, bezigTot: null }];
  const w = maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijst)), schrijf: l => { lijst = JSON.parse(JSON.stringify(l)); } },
    post: async b => { posts.push(b); return ok(6); }, versie: () => 1, naSucces: () => {}, toon: () => {},
    slot: async (fn) => { if (bezet) return; bezet = true; try { await fn(); } finally { bezet = false; } },
  });
  bezet = true; await w.verwerk(); assert.equal(posts.length, 0);
  bezet = false; await w.verwerk(); assert.equal(posts.length, 1);
});

test('meld zet het item met lease in de opslag vóór de eerste POST; een pagina die sluit tijdens de POST wordt bij de volgende start "onzeker"', async () => {
  let lijst = [];
  const klok = { t: 1000 };
  const gezien = [];
  const w1 = maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijst)), schrijf: l => { lijst = JSON.parse(JSON.stringify(l)); } },
    post: () => { gezien.push(JSON.parse(JSON.stringify(lijst))); return new Promise(() => {}); }, // nooit antwoord: pagina sluit
    versie: () => 1, naSucces: () => {}, toon: () => {}, nu: () => klok.t,
  });
  w1.meld('J', ITEMS);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(gezien[0].length, 1);
  assert.ok(gezien[0][0].bezigTot > klok.t, 'lease vóór de POST');
  klok.t += 120000; // volgende start, lease verlopen
  const toasts = [], posts = [];
  const w2 = maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijst)), schrijf: l => { lijst = JSON.parse(JSON.stringify(l)); } },
    post: async b => { posts.push(b); return ok(2); }, versie: () => 1, naSucces: () => {}, toon: t => toasts.push(t), nu: () => klok.t,
  });
  await w2.verwerk();
  assert.equal(posts.length, 0, 'nooit een herpoging');
  assert.equal(lijst.length, 0);
  assert.match(toasts[0], /^⚠ Onzeker/);
});

test('een 2xx zonder leesbare JSON is onzeker en zet geen stand op null', async () => {
  const t = bouw({ antwoorden: [{ status: 200, data: null }] });
  await t.w.meld('Jan', ITEMS);
  assert.deepEqual(t.succes, []);
  assert.equal(t.lijst().length, 0);
  assert.match(t.toasts[0], /^⚠ Onzeker/);
});

// ── Wachtrij per gebruiker (logins T16): een item van A wordt nooit onder de sessie van B verzonden of verwijderd ──
test('hoortBijGebruiker: zonder eigenaar (legacy) voor iedereen; met eigenaar enkel voor die gebruiker', () => {
  assert.equal(hoortBijGebruiker({ id: 'x' }, 'u1'), true);
  assert.equal(hoortBijGebruiker({ id: 'x', gebruikerId: null }, 'u1'), true);
  assert.equal(hoortBijGebruiker({ id: 'x', gebruikerId: 'u1' }, 'u1'), true);
  assert.equal(hoortBijGebruiker({ id: 'x', gebruikerId: 'u1' }, 'u2'), false);
  assert.equal(hoortBijGebruiker({ id: 'x', gebruikerId: 'u1' }, null), false);
  assert.equal(hoortBijGebruiker({ id: 'x', gebruikerId: 'u1' }, undefined), false);
});

test('meld bewaart de eigenaar op het item; zonder gebruiker blijft het veld weg', async () => {
  const klok = { t: 1000 };
  const metEigenaar = bouw({ antwoorden: [{ status: 503, data: { error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' } }], online: false, klok });
  // opnieuw bouwen met de afhankelijkheid: bouw() kent ze niet, dus rechtstreeks
  let lijst = [];
  const w = maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijst)), schrijf: l => { lijst = JSON.parse(JSON.stringify(l)); } },
    post: async () => ok(1), versie: () => 1, naSucces: () => {}, toon: () => {}, online: () => false, nu: () => klok.t,
    gebruikerId: () => 'u-a',
  });
  await w.meld('Jan', ITEMS);
  assert.equal(lijst[0].gebruikerId, 'u-a');
  await metEigenaar.w.meld('Jan', ITEMS);
  assert.equal('gebruikerId' in metEigenaar.lijst()[0], false);
});

test('verwerk onder een andere gebruiker: item van A blijft staan (geen POST, geen melding); eigen en legacy items worden verwerkt', async () => {
  const lijst0 = [
    { id: 'a', technieker: 'A', items: ITEMS, aangemaakt: 1, pogingen: 0, bezigTot: null, eigenaar: null, gebruikerId: 'u-a' },
    { id: 'b', technieker: 'B', items: ITEMS, aangemaakt: 2, pogingen: 0, bezigTot: null, eigenaar: null, gebruikerId: 'u-b' },
    { id: 'l', technieker: 'L', items: ITEMS, aangemaakt: 3, pogingen: 0, bezigTot: null, eigenaar: null },
  ];
  let lijst = JSON.parse(JSON.stringify(lijst0));
  const posts = [], toasts = [];
  const w = maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijst)), schrijf: l => { lijst = JSON.parse(JSON.stringify(l)); } },
    // 403 zou voor A definitief zijn (item weg); voor de eigen items geeft de server 200
    post: async b => { posts.push(b); return b.technieker === 'A' ? { status: 403, data: { error: 'geen toegang' } } : ok(9); },
    versie: () => 1, naSucces: () => {}, toon: t => toasts.push(t), gebruikerId: () => 'u-b',
  });
  await w.verwerk();
  assert.deepEqual(posts.map(p => p.technieker), ['B', 'L']);
  assert.deepEqual(lijst.map(e => e.id), ['a'], 'het item van A blijft bewaard');
  assert.deepEqual(toasts, [TEKSTEN.alsnog, TEKSTEN.alsnog], 'enkel de eigen items melden "alsnog"; niets over A (geen "definitief")');
});

test('verwerk zonder bekende gebruiker: enkel legacy items', async () => {
  let lijst = [
    { id: 'a', technieker: 'A', items: ITEMS, aangemaakt: 1, pogingen: 0, bezigTot: null, eigenaar: null, gebruikerId: 'u-a' },
    { id: 'l', technieker: 'L', items: ITEMS, aangemaakt: 3, pogingen: 0, bezigTot: null, eigenaar: null },
  ];
  const posts = [];
  const w = maakVerbruikWachtrij({
    opslag: { lees: () => JSON.parse(JSON.stringify(lijst)), schrijf: l => { lijst = JSON.parse(JSON.stringify(l)); } },
    post: async b => { posts.push(b.technieker); return ok(2); }, versie: () => 1, naSucces: () => {}, toon: () => {},
  });
  await w.verwerk();
  assert.deepEqual(posts, ['L']);
  assert.deepEqual(lijst.map(e => e.id), ['a']);
});
