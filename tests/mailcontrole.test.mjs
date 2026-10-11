// kern/mailcontrole.js (etappe 7, Q1): de uitkomst na een onzeker resultaat. Nooit echte aanroepen: api.zetFetch.
process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import { zetFetch } from '../public/js/kern/api.js';
import {
  beoordeelAntwoord, controleerMail, mailControleTekst, mailControleAfsluiting, uurBrussel, TEKST_NIET_VERZONDEN, TEKST_ONZEKER, SERVER_MAX_MS,
} from '../public/js/kern/mailcontrole.js';

const T1 = '2026-10-02T10:01:00.000Z'; // 12:01 in Brussel (zomertijd)
const T2 = '2026-10-02T22:30:00.000Z'; // 00:30 de volgende dag
const antwoord = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

test.afterEach(() => zetFetch(null));

// Nepklok: `nu()` geeft de verstreken tijd sinds start (0); `wacht(ms)` laat hem ms verder lopen en onthoudt de wachttijden.
function maakKlok(begin) {
  const k = { t: begin, wachttijden: [] };
  k.nu = () => k.t;
  k.wacht = async (ms) => { k.wachttijden.push(ms); k.t += ms; };
  return k;
}

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
  // B4-voorbereiding: bij een deel levert de uitkomst de gevonden ontvangers (adres in kleine letters, tijdstip uit het antwoord)
  assert.deepEqual(beoordeelAntwoord(o(true, false), ['luc@test.be', 'an@y.be']), { uitkomst: 'onbekend', verzonden: [], gevonden: [{ aan: 'luc@test.be', tijdstip: T1 }] });
});

test("beoordeelAntwoord: twijfel zonder enige gevonden ontvanger blijft { uitkomst: 'onbekend', verzonden: [] } (geen gevonden-veld)", () => {
  const r = beoordeelAntwoord({
    ok: true, verzonden: false, twijfel: true, tijdstip: null, uitgaand: [],
    ontvangers: { 'luc@test.be': { verzonden: false, tijdstip: null }, 'an@y.be': { verzonden: false, tijdstip: null } },
  }, ['luc@test.be', 'an@y.be']);
  assert.deepEqual(r, { uitkomst: 'onbekend', verzonden: [] });
  assert.equal('gevonden' in r, false);
});

test('de andere onbekend-uitkomsten (onvolledig antwoord, geen ontvangers-veld, ongeldig uur) hebben geen gevonden-veld', () => {
  const zonder = (r) => assert.equal('gevonden' in r, false, JSON.stringify(r));
  zonder(beoordeelAntwoord({ ok: true }));
  zonder(beoordeelAntwoord(null, ['luc@test.be']));
  zonder(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [] }, ['luc@test.be']));
  zonder(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: false, ontvangers: {} }, ['luc@test.be']));
  zonder(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: true, ontvangers: { 'luc@test.be': { verzonden: true, tijdstip: 'nonsens' } } }, ['luc@test.be']));
  // een deel gevonden, maar een ander adres ontbreekt in het antwoord: onvolledig, dus ook geen gevonden
  zonder(beoordeelAntwoord({ ok: true, twijfel: false, verzonden: true, ontvangers: { 'luc@test.be': { verzonden: true, tijdstip: T1 } } }, ['luc@test.be', 'an@y.be']));
});

test('mailControleAfsluiting geeft de zes exacte teksten', () => {
  assert.equal(mailControleAfsluiting('rapport', 'alles'), ' — rapport als verzonden aangevinkt');
  assert.equal(mailControleAfsluiting('voorstel', 'alles'), ' — voorstel als verzonden aangevinkt');
  for (const soort of ['rapport', 'voorstel']) {
    assert.equal(mailControleAfsluiting(soort, 'deel'), ' — voor wie de mail al kreeg is "verzonden" aangevinkt');
    assert.equal(mailControleAfsluiting(soort, 'mislukt'), ' — maar kon niet als verzonden aangevinkt worden (herlaad de pagina)');
  }
});

test('controleerMail geeft de gevonden-lijst bij een gedeeltelijk resultaat ongewijzigd door', async () => {
  zetFetch(async () => antwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [],
    ontvangers: { 'luc@test.be': { verzonden: true, tijdstip: T1 }, 'an@y.be': { verzonden: false, tijdstip: null } } }));
  const r = await controleerMail({ ticketId: '555', start: 0, verwacht: ['Luc@test.be', 'an@y.be'] });
  assert.deepEqual(r, { uitkomst: 'onbekend', verzonden: [], gevonden: [{ aan: 'luc@test.be', tijdstip: T1 }] });
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

test('controleerMail: één GET naar /api/mail-check met ticketId en verlopenMs (nooit een absolute tijd); nooit een body of schrijfmethode', async () => {
  const oproepen = [];
  zetFetch(async (...a) => { oproepen.push(a); return antwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [{ aan: 'luc@test.be', tijdstip: T1 }] }); });
  const klok = maakKlok(3000);
  const r = await controleerMail({ ticketId: '555', start: 0, nu: klok.nu, wacht: klok.wacht });
  assert.deepEqual(r, { uitkomst: 'verzonden', verzonden: [{ aan: 'luc@test.be', tijdstip: T1 }] });
  assert.deepEqual(oproepen, [['/api/mail-check?ticketId=555&verlopenMs=3000']]); // geen init-object: een gewone GET
});

test('controleerMail: ontvangers gaan als kommalijst mee en bepalen de uitkomst', async () => {
  const oproepen = [];
  zetFetch(async (...a) => {
    oproepen.push(a);
    return antwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [], ontvangers: { 'luc@test.be': { verzonden: false, tijdstip: null }, 'an@y.be': { verzonden: false, tijdstip: null } } });
  });
  const klok = maakKlok(SERVER_MAX_MS + 1);
  const r = await controleerMail({ ticketId: '555', start: 0, verwacht: ['luc@test.be', 'an@y.be'], nu: klok.nu, wacht: klok.wacht });
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
    const klok = maakKlok(SERVER_MAX_MS + 1);
    assert.deepEqual(await controleerMail({ ticketId: '555', start: 0, nu: klok.nu, wacht: klok.wacht }), onbekend);
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

// ── I1: een snelle fout bewijst niet dat de serverfunctie klaar is (ze werkt tot ~26 s door) ──
test('I1: "niet verzonden" na een snelle fout (2 s) wacht tot SERVER_MAX_MS en controleert dan één keer opnieuw; de mail die intussen vertrok geeft "verzonden"', async () => {
  assert.equal(SERVER_MAX_MS, 30000);
  const klok = maakKlok(2000);
  const oproepen = [];
  zetFetch(async (url) => {
    oproepen.push(new URL(url, 'http://x').searchParams.get('verlopenMs'));
    // de mail komt op de server pas na 10 s: de eerste controle (2 s) ziet niets, de tweede (30 s) wel
    return klok.t >= 10000
      ? antwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [{ aan: 'luc@test.be', tijdstip: T1 }] })
      : antwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [] });
  });
  const r = await controleerMail({ ticketId: '555', start: 0, nu: klok.nu, wacht: klok.wacht });
  assert.deepEqual(r, { uitkomst: 'verzonden', verzonden: [{ aan: 'luc@test.be', tijdstip: T1 }] });
  assert.deepEqual(klok.wachttijden, [28000]);
  assert.deepEqual(oproepen, ['2000', '30000']); // twee controles, precies één wachttijd
});

test('I1: blijft de mail ook na SERVER_MAX_MS weg, dan pas "niet verzonden"; na 30 s verstreken geen wachttijd meer', async () => {
  let klok = maakKlok(2000);
  let n = 0;
  zetFetch(async () => { n++; return antwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [] }); });
  assert.deepEqual(await controleerMail({ ticketId: '555', start: 0, nu: klok.nu, wacht: klok.wacht }), { uitkomst: 'niet-verzonden', verzonden: [] });
  assert.equal(n, 2);
  klok = maakKlok(SERVER_MAX_MS); n = 0; // time-out (35 s) of 502 na 26+ s: de functie is zeker klaar
  assert.deepEqual(await controleerMail({ ticketId: '555', start: 0, nu: klok.nu, wacht: klok.wacht }), { uitkomst: 'niet-verzonden', verzonden: [] });
  assert.deepEqual([n, klok.wachttijden], [1, []]);
});

test('I1: een zekere "verzonden" komt meteen (geen wachttijd); een tweede controle die faalt of twijfelt is "onbekend", nooit "niet verzonden"', async () => {
  let klok = maakKlok(1000);
  zetFetch(async () => antwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [{ aan: 'a@b.be', tijdstip: T1 }] }));
  assert.equal((await controleerMail({ ticketId: '5', start: 0, nu: klok.nu, wacht: klok.wacht })).uitkomst, 'verzonden');
  assert.deepEqual(klok.wachttijden, []);
  for (const tweede of [async () => { throw new TypeError('Failed to fetch'); }, async () => antwoord({ error: 'x' }, 502),
    async () => antwoord({ ok: true, twijfel: true, verzonden: false, tijdstip: null, uitgaand: [] })]) {
    klok = maakKlok(1000);
    let n = 0;
    zetFetch(async () => (++n === 1 ? antwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [] }) : tweede()));
    assert.equal((await controleerMail({ ticketId: '5', start: 0, nu: klok.nu, wacht: klok.wacht })).uitkomst, 'onbekend');
  }
  // een eerste controle die zelf faalt blijft onbekend (geen herpoging)
  klok = maakKlok(1000);
  let m = 0;
  zetFetch(async () => { m++; throw new TypeError('Failed to fetch'); });
  assert.equal((await controleerMail({ ticketId: '5', start: 0, nu: klok.nu, wacht: klok.wacht })).uitkomst, 'onbekend');
  assert.deepEqual([m, klok.wachttijden], [1, []]);
});

test('I2: het verzoek bevat enkel verlopenMs (geheel, niet negatief); een toestelklok speelt geen rol', async () => {
  const urls = [];
  zetFetch(async (u) => { urls.push(u); return antwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [{ aan: 'a@b.be', tijdstip: T1 }] }); });
  await controleerMail({ ticketId: '5', start: 100.4, nu: () => 2600.9, wacht: async () => {} });
  await controleerMail({ ticketId: '5', start: 500, nu: () => 100, wacht: async () => {} }); // klok liep terug: nooit negatief
  assert.deepEqual(urls, ['/api/mail-check?ticketId=5&verlopenMs=2501', '/api/mail-check?ticketId=5&verlopenMs=0']);
  assert.ok(urls.every(u => !/sinds/.test(u)));
});

// I1 (eindreview): performance.now() staat stil tijdens slaapstand; Date.now() niet. verlopen = max(beide), nooit negatief.
test('I1: slaapstand (perf-verschil < Date-verschil): verlopenMs volgt het grootste verschil', async () => {
  const urls = [];
  zetFetch(async (u) => { urls.push(u); return antwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [{ aan: 'a@b.be', tijdstip: T1 }] }); });
  // perf: 3 s verstreken; de muurklok: 5 minuten (het toestel sliep)
  await controleerMail({ ticketId: '5', start: 1000, startWand: 1_000_000, nu: () => 4000, wand: () => 1_300_000, wacht: async () => {} });
  assert.deepEqual(urls, ['/api/mail-check?ticketId=5&verlopenMs=300000']);
});

test('I1: slaapstand: de tweede controle wacht niet opnieuw als de muurklok al voorbij SERVER_MAX_MS is', async () => {
  let m = 0;
  const wachttijden = [];
  zetFetch(async () => { m++; return antwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [] }); });
  const r = await controleerMail({ ticketId: '5', start: 0, startWand: 0, nu: () => 2000, wand: () => 300_000, wacht: async (ms) => { wachttijden.push(ms); } });
  assert.deepEqual([r.uitkomst, m, wachttijden], ['niet-verzonden', 1, []]);
});

test('I1: zonder slaapstand telt de wachttijd nog steeds het grootste verschil (perf 2 s, muur 2 s: wacht 28 s)', async () => {
  const wachttijden = [];
  zetFetch(async () => antwoord({ ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [] }));
  await controleerMail({ ticketId: '5', start: 0, startWand: 0, nu: () => 2000, wand: () => 2000, wacht: async (ms) => { wachttijden.push(ms); } });
  assert.deepEqual(wachttijden, [SERVER_MAX_MS - 2000]);
});

test('I1: de muurklok springt achteruit: perf bepaalt, nooit een negatief of kleiner venster', async () => {
  const urls = [];
  zetFetch(async (u) => { urls.push(u); return antwoord({ ok: true, twijfel: false, verzonden: true, tijdstip: T1, uitgaand: [{ aan: 'a@b.be', tijdstip: T1 }] }); });
  await controleerMail({ ticketId: '5', start: 0, startWand: 5_000_000, nu: () => 7000, wand: () => 1_000_000, wacht: async () => {} });
  await controleerMail({ ticketId: '5', start: 9000, startWand: 5_000_000, nu: () => 8000, wand: () => 1_000_000, wacht: async () => {} }); // beide klokken terug
  assert.deepEqual(urls, ['/api/mail-check?ticketId=5&verlopenMs=7000', '/api/mail-check?ticketId=5&verlopenMs=0']);
});
