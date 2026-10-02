// kern/mailcontrole.js (etappe 7, Q1): de uitkomst na een onzeker resultaat. Nooit echte aanroepen: api.zetFetch.
process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import { zetFetch } from '../public/js/kern/api.js';
import {
  beoordeelAntwoord, controleerMail, mailControleTekst, uurBrussel, TEKST_NIET_VERZONDEN, TEKST_ONZEKER,
} from '../public/js/kern/mailcontrole.js';

const SINDS = '2026-10-02T10:00:00.000Z';
const T1 = '2026-10-02T10:01:00.000Z'; // 12:01 in Brussel (zomertijd)
const T2 = '2026-10-02T22:30:00.000Z'; // 00:30 de volgende dag
const antwoord = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

test.afterEach(() => zetFetch(null));

test('uurBrussel: hh:mm in Brusselse tijd, ook rond middernacht', () => {
  assert.equal(uurBrussel(T1), '12:01');
  assert.equal(uurBrussel(T2), '00:30');
});

test('beoordeelAntwoord zonder verwachte adressen: verzonden met de adressen van de threads, of niet verzonden', () => {
  assert.deepEqual(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [{ aan: 'luc@test.be', tijdstip: T1 }] }),
    { uitkomst: 'verzonden', verzonden: [{ aan: 'luc@test.be', tijdstip: T1 }] });
  assert.deepEqual(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [] }),
    { uitkomst: 'verzonden', verzonden: [{ aan: '', tijdstip: T1 }] });
  assert.deepEqual(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [] }), { uitkomst: 'niet-verzonden', verzonden: [] });
});

test('beoordeelAntwoord met verwachte adressen: alles, niets of een deel', () => {
  const o = (a, b) => ({ ok: true, twijfel: false, verzonden: !!(a && b), tijdstip: T1, uitgaand: [], ontvangers: { 'luc@test.be': { verzonden: a, tijdstip: a ? T1 : null }, 'an@y.be': { verzonden: b, tijdstip: b ? T2 : null } } });
  assert.deepEqual(beoordeelAntwoord(o(true, true), ['Luc@test.be', 'an@y.be']), {
    uitkomst: 'verzonden', verzonden: [{ aan: 'luc@test.be', tijdstip: T1 }, { aan: 'an@y.be', tijdstip: T2 }],
  });
  assert.deepEqual(beoordeelAntwoord(o(false, false), ['luc@test.be', 'an@y.be']), { uitkomst: 'niet-verzonden', verzonden: [] });
  assert.deepEqual(beoordeelAntwoord(o(true, false), ['luc@test.be', 'an@y.be']), { uitkomst: 'onbekend', verzonden: [] });
});

test('beoordeelAntwoord: elk onvolledig of vreemd antwoord is onbekend, nooit "niet verzonden"', () => {
  const onbekend = { uitkomst: 'onbekend', verzonden: [] };
  for (const d of [null, undefined, 'tekst', {}, { ok: false, verzonden: false }, { ok: true }, { ok: true, twijfel: false, verzonden: 'nee' },
    { ok: true, twijfel: false, verzonden: true, tijdstip: 'nonsens', uitgaand: [{ aan: 'a@b.be', tijdstip: 'nonsens' }] }]) {
    assert.deepEqual(beoordeelAntwoord(d), onbekend, JSON.stringify(d));
  }
  // verwachte adressen, maar geen of een onvolledig ontvangers-veld
  assert.deepEqual(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [] }, ['luc@test.be']), onbekend);
  assert.deepEqual(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: false, ontvangers: {} }, ['luc@test.be']), onbekend);
  assert.deepEqual(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: true, ontvangers: { 'luc@test.be': { verzonden: true, tijdstip: 'nonsens' } } }, ['luc@test.be']), onbekend);
});

test('mailControleTekst: de drie goedgekeurde teksten, per ontvanger een uur', () => {
  assert.equal(mailControleTekst({ uitkomst: 'verzonden', verzonden: [{ aan: 'luc@test.be', tijdstip: T1 }] }), 'Mail is verzonden om 12:01 (luc@test.be)');
  assert.equal(mailControleTekst({ uitkomst: 'verzonden', verzonden: [{ aan: 'luc@test.be', tijdstip: T1 }, { aan: '', tijdstip: T2 }] }),
    'Mail is verzonden om 12:01 (luc@test.be); Mail is verzonden om 00:30');
  assert.equal(mailControleTekst({ uitkomst: 'niet-verzonden', verzonden: [] }), 'Mail is niet verzonden — je kan veilig opnieuw versturen');
  assert.equal(mailControleTekst({ uitkomst: 'onbekend', verzonden: [] }), 'De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt');
  assert.equal(TEKST_NIET_VERZONDEN, mailControleTekst({ uitkomst: 'niet-verzonden', verzonden: [] }));
  assert.equal(TEKST_ONZEKER, mailControleTekst({ uitkomst: 'onbekend', verzonden: [] }));
});

test('controleerMail: één GET naar /api/mail-check met ticketId, sinds en ontvangers; nooit een body of schrijfmethode', async () => {
  const oproepen = [];
  zetFetch(async (...a) => { oproepen.push(a); return antwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [{ aan: 'luc@test.be', tijdstip: T1 }] }); });
  const r = await controleerMail({ ticketId: '555', sinds: SINDS });
  assert.deepEqual(r, { uitkomst: 'verzonden', verzonden: [{ aan: 'luc@test.be', tijdstip: T1 }] });
  assert.deepEqual(oproepen, [['/api/mail-check?ticketId=555&sinds=2026-10-02T10%3A00%3A00.000Z']]); // geen init-object: een gewone GET
});

test('controleerMail: ontvangers gaan als kommalijst mee en bepalen de uitkomst', async () => {
  const oproepen = [];
  zetFetch(async (...a) => {
    oproepen.push(a);
    return antwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [], ontvangers: { 'luc@test.be': { verzonden: false, tijdstip: null }, 'an@y.be': { verzonden: false, tijdstip: null } } });
  });
  const r = await controleerMail({ ticketId: '555', sinds: SINDS, verwacht: ['luc@test.be', 'an@y.be'] });
  assert.deepEqual(r, { uitkomst: 'niet-verzonden', verzonden: [] });
  assert.equal(new URL(oproepen[0][0], 'http://x').searchParams.get('ontvangers'), 'luc@test.be,an@y.be');
});

test('controleerMail gooit nooit: netwerkfout, time-out, 4xx/5xx en onleesbaar antwoord zijn onbekend', async () => {
  const onbekend = { uitkomst: 'onbekend', verzonden: [] };
  const gevallen = [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => { throw new DOMException('Time-out na 20 s', 'TimeoutError'); },
    async () => antwoord({ error: 'Zoho threads ophalen mislukt (503)' }, 502),
    async () => antwoord({ error: 'x' }, 500),
    async () => antwoord({ error: 'Ongeldig' }, 400),
    async () => new Response('<html>Bad Gateway</html>', { status: 200 }),
    async () => new Response('<html>Bad Gateway</html>', { status: 502 }),
  ];
  for (const g of gevallen) {
    zetFetch(g);
    assert.deepEqual(await controleerMail({ ticketId: '555', sinds: SINDS }), onbekend);
  }
});

test('twijfel (onleesbaar adres, draft- of mislukte status): nooit "niet verzonden", met of zonder verwachte adressen', () => {
  const onbekend = { uitkomst: 'onbekend', verzonden: [] };
  // per adres: de server kon een uitgaande mail niet aan een ontvanger toewijzen
  assert.deepEqual(beoordeelAntwoord({
    ok: true, verzonden: false, twijfel: true, tijdstip: null, uitgaand: [], ontvangers: { 'luc@test.be': { verzonden: false, tijdstip: null } },
  }, ['luc@test.be']), onbekend);
  // brede controle
  assert.deepEqual(beoordeelAntwoord({ ok: true, verzonden: false, twijfel: true, tijdstip: null, uitgaand: [] }), onbekend);
  // zonder twijfel blijft het "niet verzonden"
  assert.deepEqual(beoordeelAntwoord({ ok: true, verzonden: false, twijfel: false, tijdstip: null, uitgaand: [] }), { uitkomst: 'niet-verzonden', verzonden: [] });
  // een antwoord zonder (booleaanse) twijfel is onvolledig
  assert.deepEqual(beoordeelAntwoord({ ok: true, verzonden: false, tijdstip: null, uitgaand: [] }), onbekend);
  assert.deepEqual(beoordeelAntwoord({ ok: true, verzonden: false, twijfel: 'nee', tijdstip: null, uitgaand: [] }), onbekend);
  // een zekere mail wint van twijfel
  assert.equal(beoordeelAntwoord({ ok: true, verzonden: true, twijfel: false, tijdstip: T1, uitgaand: [{ aan: 'a@b.be', tijdstip: T1 }] }).uitkomst, 'verzonden');
});
