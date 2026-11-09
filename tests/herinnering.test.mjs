// tests/herinnering.test.mjs — de automatische herinnering 3 dagen voor de interventie (netlify/lib/herinnering.js en de geplande
// functie herinnering-bevestiging.js): het dagvenster (kalenderdagen in Brusselse tijd, ook rond de zomer- en wintertijd), het overslaan
// (al een herinnering, bevestigd, afgewezen of een inkomende klantmail), de volgorde sendReply -> PATCH, en dat één falend ticket de rest niet
// stopt. Nooit echt Zoho of Blobs: nep-fetch en nep-store.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, zetEnv } from './nep-fetch.mjs';
import { maakNepStore } from './nep-blobs.mjs';
import { maakZoho } from '../netlify/lib/zoho.js';
import { inkomendeMailsNa } from '../netlify/lib/mailcontrole.js';
import { tekenLink } from '../netlify/lib/bevestigingslink.js';
import { VEROUDERD_SLEUTEL } from '../netlify/lib/tickets-snapshot.js';
import {
  dagenTot, beoordeelTicket, verstuurdSinds, bouwHerinneringMail, bouwHerinneringNotitie, bouwOvergeslagenNotitie, verwerkHerinneringen,
} from '../netlify/lib/herinnering.js';

const DESK = 'https://desk.zoho.eu/api/v1';
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const MS_DAG = 24 * 60 * 60 * 1000;

// ============================================================ dagenTot (kalenderdagen in Brussel) ====
test('dagenTot: kalenderdagen in Brusselse tijd, niet 24 uur-blokken', () => {
  const nu = Date.parse('2026-10-11T08:00:00.000Z'); // zondag 10:00 Brussel
  assert.equal(dagenTot('2026-10-14', nu), 3);
  assert.equal(dagenTot('2026-10-12', nu), 1);
  assert.equal(dagenTot('2026-10-11', nu), 0);
  assert.equal(dagenTot('2026-10-10', nu), -1);
  assert.equal(dagenTot('2026-10-15', nu), 4);
});

test('dagenTot rond middernacht: 23:30 en 00:30 Brusselse tijd zitten op verschillende dagen (ook als UTC dezelfde dag is)', () => {
  // 2026-10-10T21:30Z = 23:30 CEST op 10 okt; 2026-10-10T22:30Z = 00:30 CEST op 11 okt.
  assert.equal(dagenTot('2026-10-13', Date.parse('2026-10-10T21:30:00.000Z')), 3);
  assert.equal(dagenTot('2026-10-13', Date.parse('2026-10-10T22:30:00.000Z')), 2);
  // Winter: 2026-01-10T22:30Z = 23:30 CET op 10 jan; 23:30Z = 00:30 CET op 11 jan.
  assert.equal(dagenTot('2026-01-13', Date.parse('2026-01-10T22:30:00.000Z')), 3);
  assert.equal(dagenTot('2026-01-13', Date.parse('2026-01-10T23:30:00.000Z')), 2);
});

test('dagenTot over de omschakeling naar zomertijd (zo 29 maart 2026) en naar wintertijd (zo 25 oktober 2026)', () => {
  // Maart: de nacht van 28 op 29 maart heeft 23 uur.
  assert.equal(dagenTot('2026-03-31', Date.parse('2026-03-28T12:00:00.000Z')), 3);
  assert.equal(dagenTot('2026-03-31', Date.parse('2026-03-29T12:00:00.000Z')), 2);
  assert.equal(dagenTot('2026-03-30', Date.parse('2026-03-27T23:30:00.000Z')), 2); // 00:30 CET op 28 maart
  assert.equal(dagenTot('2026-03-30', Date.parse('2026-03-28T22:59:00.000Z')), 2);  // 23:59 CET op 28 maart
  assert.equal(dagenTot('2026-03-30', Date.parse('2026-03-28T23:00:00.000Z')), 1);  // 00:00 CET op 29 maart: één kalenderdag minder
  // Oktober: 25 oktober heeft 25 uur.
  assert.equal(dagenTot('2026-10-27', Date.parse('2026-10-24T21:30:00.000Z')), 3); // 23:30 CEST op 24 okt
  assert.equal(dagenTot('2026-10-27', Date.parse('2026-10-24T22:30:00.000Z')), 2); // 00:30 CEST op 25 okt
  assert.equal(dagenTot('2026-10-27', Date.parse('2026-10-25T12:00:00.000Z')), 2);
  assert.equal(dagenTot('2026-10-28', Date.parse('2026-10-25T00:30:00.000Z')), 3); // 02:30 (CEST) op 25 okt
  assert.equal(dagenTot('2026-10-28', Date.parse('2026-10-25T23:30:00.000Z')), 2); // 00:30 CET op 26 okt
  // Een afspraak van 85 uur verderop kan 3 of 4 kalenderdagen zijn: enkel de kalender telt.
  const nu = Date.parse('2026-10-24T20:00:00.000Z');
  assert.equal(dagenTot('2026-10-28', nu), 4);
  assert.equal(Math.floor((Date.parse('2026-10-28T05:00:00.000Z') - nu) / MS_DAG), 3);
});

test('dagenTot: ongeldige invoer geeft null (nooit een herinnering op een onbekende datum)', () => {
  const nu = Date.parse('2026-10-11T08:00:00.000Z');
  for (const datum of [null, undefined, '', 'morgen', '2026-13-45x', 20261014]) assert.equal(dagenTot(datum, nu), null, String(datum));
});

// ============================================================ inkomende mail ====
test('inkomendeMailsNa: enkel inkomende, publieke e-mails NA het tijdstip, oplopend op tijd', () => {
  const sinds = Date.parse('2026-10-10T08:00:00.000Z');
  const threads = [
    { direction: 'out', channel: 'EMAIL', createdTime: '2026-10-10T08:00:05.000Z', to: 'klant@x.be' },                      // onze eigen mail
    { direction: 'in', channel: 'EMAIL', createdTime: '2026-10-09T09:00:00.000Z', fromEmailAddress: 'klant@x.be' },        // vóór het voorstel (het oorspronkelijke ticket)
    { direction: 'in', channel: 'EMAIL', createdTime: '2026-10-10T12:00:00.000Z', fromEmailAddress: 'Klant <klant@x.be>' },
    { direction: 'in', channel: 'EMAIL', createdTime: '2026-10-10T09:00:00.000Z', fromEmailAddress: 'inst@x.be' },
    { direction: 'in', channel: 'EMAIL', visibility: 'private', createdTime: '2026-10-10T10:00:00.000Z', fromEmailAddress: 'x@x.be' }, // privé
    { direction: 'in', channel: 'PHONE', createdTime: '2026-10-10T10:00:00.000Z' },                                           // geen e-mail
    { direction: 'in', channel: 'EMAIL', createdTime: 'kapot' },
    null, 'tekst',
  ];
  const r = inkomendeMailsNa(threads, sinds);
  assert.deepEqual(r.map(m => m.tijdstip), ['2026-10-10T09:00:00.000Z', '2026-10-10T12:00:00.000Z']);
  assert.deepEqual(r.map(m => m.van), ['inst@x.be', 'klant@x.be']);
  assert.deepEqual(inkomendeMailsNa(undefined, sinds), []);
  assert.deepEqual(inkomendeMailsNa([], sinds), []);
});

test('inkomendeMailsNa: een mail op exact hetzelfde tijdstip of ervoor telt niet (het is niet een antwoord op het voorstel)', () => {
  const sinds = Date.parse('2026-10-10T08:00:00.000Z');
  assert.deepEqual(inkomendeMailsNa([{ direction: 'in', channel: 'EMAIL', createdTime: '2026-10-10T08:00:00.000Z' }], sinds), []);
});

// ============================================================ beoordeelTicket ====
const NU = Date.parse('2026-10-11T08:00:00.000Z'); // 3 dagen vóór 14 oktober
const TIJD1 = '2026-10-10T08:00:00.000Z';
const ENTRY = { contact: TIJD1, klant: '2026-10-10T08:00:03.000Z', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' };
const TICKET = (over = {}) => ({
  id: '555', number: '1004', subject: 'FW: Laadpaal defect', status: 'Wachten op bevestiging planning',
  interventieDatum: '2026-10-14T06:30:00.000Z', email: 'contact@x.be', emailEindklant: 'klant@x.be', emailInstallateur: 'inst@x.be',
  contact: 'An Peeters', naamEindklant: 'Luc Wouters', serienummer: 'SN123', ...over,
});

test('verstuurdSinds: het vroegste geldige tijdstip van contact, klant of installateur; anders null', () => {
  assert.equal(verstuurdSinds(ENTRY), Date.parse(TIJD1));
  assert.equal(verstuurdSinds({ installateur: '2026-10-09T08:00:00.000Z', klant: TIJD1 }), Date.parse('2026-10-09T08:00:00.000Z'));
  assert.equal(verstuurdSinds({ klant: 'kapot', contact: TIJD1 }), Date.parse(TIJD1));
  assert.equal(verstuurdSinds({ tijdslot: '08:30–11:30' }), null);
  assert.equal(verstuurdSinds({ bevestigd: { door: 'klant' } }), null);
  assert.equal(verstuurdSinds(undefined), null);
});

test('beoordeelTicket: binnen het venster (1 tot en met 3 dagen) komt het ticket in aanmerking; erbuiten niet', () => {
  for (const [datum, verwacht] of [['2026-10-11', 'buitenVenster'], ['2026-10-12', null], ['2026-10-13', null], ['2026-10-14', null], ['2026-10-15', 'buitenVenster'], ['2026-10-09', 'buitenVenster']]) {
    const b = beoordeelTicket({ ticket: TICKET({ interventieDatum: `${datum}T06:30:00.000Z` }), entry: { ...ENTRY, tijdslotDatum: datum }, nuMs: NU });
    if (verwacht) assert.deepEqual(b, { besluit: 'overslaan', reden: verwacht }, datum);
    else assert.equal(b.besluit, 'controleer', datum);
  }
  const b = beoordeelTicket({ ticket: TICKET(), entry: ENTRY, nuMs: NU });
  assert.deepEqual(b, { besluit: 'controleer', datum: '2026-10-14', dagen: 3, sindsMs: Date.parse(TIJD1) });
});

test('beoordeelTicket: zonder datum, zonder voorstel in het register, bevestigd, afgewezen of al herinnerd (voor deze datum) wordt overgeslagen', () => {
  const sla = (ticket, entry) => beoordeelTicket({ ticket, entry, nuMs: NU });
  assert.deepEqual(sla(TICKET({ interventieDatum: null }), ENTRY), { besluit: 'overslaan', reden: 'buitenVenster' });
  assert.deepEqual(sla(TICKET(), undefined), { besluit: 'overslaan', reden: 'geenVoorstel' });
  assert.deepEqual(sla(TICKET(), { tijdslot: '08:30–11:30' }), { besluit: 'overslaan', reden: 'geenVoorstel' });
  assert.deepEqual(sla(TICKET(), { ...ENTRY, bevestigd: { door: 'klant', tijdstip: 'T' } }), { besluit: 'overslaan', reden: 'bevestigd' });
  assert.deepEqual(sla(TICKET(), { afgewezen: { door: 'klant', tijdstip: 'T' } }), { besluit: 'overslaan', reden: 'afgewezen' });
  assert.deepEqual(sla(TICKET(), { ...ENTRY, afgewezen: { door: 'klant', tijdstip: 'T' } }), { besluit: 'overslaan', reden: 'afgewezen' });
  assert.deepEqual(sla(TICKET(), { ...ENTRY, herinnering: { datum: '2026-10-14', tijdstip: 'T' } }), { besluit: 'overslaan', reden: 'herinnerd' });
  assert.deepEqual(sla(TICKET(), { ...ENTRY, herinnering: { datum: '2026-10-14', tijdstip: 'T', overgeslagen: 'mailantwoord' } }), { besluit: 'overslaan', reden: 'herinnerd' });
  // Een herinnering voor een ándere (oudere) datum telt niet: een opnieuw voorgestelde datum krijgt zijn eigen herinnering.
  assert.equal(sla(TICKET(), { ...ENTRY, herinnering: { datum: '2026-10-09', tijdstip: 'T' } }).besluit, 'controleer');
  // Een voorstel voor een andere datum dan die van het ticket (verzet zonder nieuw voorstel): niets sturen.
  assert.deepEqual(sla(TICKET(), { ...ENTRY, tijdslotDatum: '2026-10-16' }), { besluit: 'overslaan', reden: 'datumAnders' });
});

// ============================================================ de mail ====
test('bouwHerinneringMail: herinnering met afspraak, tijdslot, serienummer en dezelfde twee knoppen (bevestigen en "Deze datum lukt niet")', () => {
  const url = 'https://app.test/api/confirm-afspraak?ticketId=555&date=2026-10-14&exp=1&d=klant&sig=abc';
  const h = bouwHerinneringMail({ naam: 'Luc <b>', onderwerp: 'Laadpaal defect', datum: '2026-10-14', tijdslot: '08:30–11:30', serienummer: 'SN123', confirmUrl: url });
  assert.match(h, /Geachte Luc &lt;b&gt;,/);
  assert.match(h, /herinnering/i);
  assert.match(h, /Laadpaal defect/);
  assert.match(h, /woensdag 14 oktober 2026/);
  assert.match(h, /tussen <strong>08:30–11:30<\/strong> uur/);
  assert.match(h, /Serienummer: SN123/);
  assert.match(h, /nog geen bevestiging/);
  assert.ok(h.includes(`<a href="${url}"`));
  assert.ok(h.includes('✅ Bevestig deze afspraak'));
  assert.ok(h.includes(`<a href="${url}&keuze=nee"`));
  assert.ok(h.includes('Deze datum lukt niet'));
  assert.match(h, /Team Blitz Power/);
  assert.ok(!h.includes('<script'));
});

test('bouwHerinneringMail: zonder tijdslot het uur, zonder bevestigingslink geen knoppen maar wel de vraag om te antwoorden', () => {
  const h = bouwHerinneringMail({ naam: '', onderwerp: '', datum: '2026-10-14', uur: '08:30', serienummer: '', confirmUrl: null });
  assert.match(h, /Geachte klant,/);
  assert.match(h, /om <strong>08:30<\/strong> uur/);
  assert.match(h, /uw laadstation/);
  assert.ok(!h.includes('Serienummer'));
  assert.ok(!h.includes('/api/confirm-afspraak') && !h.includes('keuze=nee') && !h.includes('Deze datum lukt niet'));
  assert.match(h, /antwoorden/);
});

test('bouwHerinneringNotitie en bouwOvergeslagenNotitie: interne teksten, geëscaped', () => {
  const n = bouwHerinneringNotitie({ datum: '2026-10-14', tijdslot: '08:30–11:30', gemaild: ['contact@x.be', 'klant@x.be'], fouten: [{ doelgroep: 'installateur', fout: 'boem <b>' }] });
  assert.match(n, /Automatische herinnering verstuurd naar contact@x\.be, klant@x\.be/);
  assert.match(n, /14\/10\/2026 08:30–11:30/);
  assert.match(n, /installateur: boem &lt;b&gt;/);
  const o = bouwOvergeslagenNotitie({ tijdstip: '10/10/2026 14:00', van: ['klant@x.be'] });
  assert.match(o, /Geen herinnering: de klant antwoordde per mail op 10\/10\/2026 14:00/);
  assert.match(o, /controleer en registreer de bevestiging/);
});

// ============================================================ verwerkHerinneringen ====
const DRAAI_ENV = { ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC', ZOHO_FROM_EMAIL: 'service@blitz.test', CONFIRM_LINK_SECRET: 'geheim-voor-test' };
let herstelEnv; let consoleFout;
test.beforeEach(() => {
  herstelEnv = zetEnv({ ...DRAAI_ENV, URL: 'https://app.test', NETLIFY_BLOBS_CONTEXT: undefined });
  mock.timers.enable({ apis: ['Date'], now: NU });
  consoleFout = mock.method(console, 'error', () => {});
  mock.method(console, 'log', () => {});
});
test.afterEach(() => { mock.timers.reset(); mock.restoreAll(); herstelEnv(); });

const registerStand = (status) => ({ versie: 7, status });
const entryVan = (store, id = '555') => JSON.parse(store._data.get('voorstel-status')).status[id];
const kort = calls => calls.filter(c => !c.url.includes('oauth') && !c.url.endsWith('/organizations')).map(c => `${c.method} ${c.url.replace(DESK, '')}`);
const bodyVan = (calls, eind) => JSON.parse(calls.find(c => c.url.endsWith(eind)).body);

// Router met threads per ticket, schrijfacties en per onderdeel een foutjasje.
function maakRouter({ threads = {}, threadsRes, replyRes, patchRes, commentRes } = {}) {
  return (url, opts = {}) => {
    const m = opts.method || 'GET';
    const th = url.match(/\/tickets\/(\d+)\/threads\?from=(\d+)&limit=(\d+)/);
    if (th && m === 'GET') {
      if (threadsRes) return threadsRes(th[1], Number(th[2]));
      const alle = threads[th[1]] || [];
      return json({ data: alle.slice(Number(th[2]) - 1, Number(th[2]) - 1 + Number(th[3])) });
    }
    if (url.endsWith('/sendReply')) return replyRes ? replyRes(opts) : json({});
    const t = url.match(/\/tickets\/(\d+)$/);
    if (t && m === 'PATCH') return patchRes ? patchRes(t[1]) : json({});
    if (url.endsWith('/comments')) return commentRes ? commentRes() : json({});
    return undefined;
  };
}

async function draai({ tickets = [TICKET()], register = { 555: ENTRY }, router = {}, store, opties = {} } = {}) {
  const s = store || maakNepStore({ 'voorstel-status': registerStand(register) });
  const { fn, calls } = maakNepFetch(maakRouter(router));
  const zoho = maakZoho({ fetch: fn, env: process.env });
  const r = await metGlobaleFetch(async () => { throw new Error('globale fetch verboden'); }, () => verwerkHerinneringen({
    zoho, haalStore: async () => s, haalTickets: async () => ({ pendingTickets: tickets }), nu: () => Date.now(), ...opties,
  }));
  return { r, calls, store: s };
}

test('herinnering: een ticket 3 dagen vooraf zonder bevestiging of antwoord krijgt per ontvanger één mail en de status gaat terug naar Wachten op bevestiging planning', async () => {
  const { r, calls, store } = await draai();
  assert.deepEqual(r, { gecontroleerd: 1, verstuurd: 1, overgeslagen: 0, fouten: 0, uitgesteld: 0 });
  assert.deepEqual(kort(calls), [
    'GET /tickets/555/threads?from=1&limit=100',
    'POST /tickets/555/sendReply', 'POST /tickets/555/sendReply', 'POST /tickets/555/sendReply',
    'PATCH /tickets/555',
    'POST /tickets/555/comments',
  ]);
  const replies = calls.filter(c => c.url.endsWith('/sendReply')).map(c => JSON.parse(c.body));
  assert.deepEqual(replies.map(x => x.to), ['contact@x.be', 'klant@x.be', 'inst@x.be']);
  for (const x of replies) {
    assert.deepEqual([x.channel, x.contentType, x.fromEmailAddress], ['EMAIL', 'html', 'service@blitz.test']);
    assert.equal(x.attachmentIds, undefined);
    assert.match(x.content, /herinnering/i);
    assert.match(x.content, /tussen <strong>08:30–11:30<\/strong> uur/);
  }
  // Elke ontvanger krijgt een eigen, getekende link (met zijn doelgroep) en de tweede knop.
  const exp = Math.floor(NU / 1000) + 14 * 24 * 60 * 60;
  for (const [i, d] of ['contact', 'klant', 'installateur'].entries()) {
    const sig = tekenLink('555', '2026-10-14', exp, d);
    const link = `https://app.test/api/confirm-afspraak?ticketId=555&date=2026-10-14&exp=${exp}&d=${d}&sig=${sig}`;
    assert.ok(replies[i].content.includes(`<a href="${link}"`), `link ${d}`);
    assert.ok(replies[i].content.includes(`<a href="${link}&keuze=nee"`), `nee-link ${d}`);
  }
  // sendReply zet Zoho op "Wachten op klant": de PATCH komt dus NA de laatste sendReply en zet de status terug (geen datum aangeraakt).
  const idxPatch = calls.findIndex(c => c.method === 'PATCH');
  const idxLaatsteReply = calls.map(c => c.url.endsWith('/sendReply')).lastIndexOf(true);
  assert.ok(idxPatch > idxLaatsteReply);
  assert.deepEqual(JSON.parse(calls[idxPatch].body), { status: 'Wachten op bevestiging planning' });
  // Interne notitie, register, ticket-momentopname en activiteitenlog.
  const notitie = JSON.parse(calls.at(-1).body);
  assert.equal(notitie.isPublic, false);
  assert.equal(notitie.content, bouwHerinneringNotitie({ datum: '2026-10-14', tijdslot: '08:30–11:30', gemaild: ['contact@x.be', 'klant@x.be', 'inst@x.be'], fouten: [] }));
  assert.deepEqual(entryVan(store).herinnering, { datum: '2026-10-14', tijdstip: new Date(NU).toISOString() });
  assert.equal(entryVan(store).klant, ENTRY.klant); // het voorstel zelf blijft staan
  assert.ok(store._data.has(VEROUDERD_SLEUTEL));
  const log = JSON.parse(store._data.get('activiteit/2026-10')).items;
  assert.deepEqual(log.map(i => [i.actie, i.onderwerp, i.naam]), [['herinnering-verstuurd', '555', 'Automatische herinnering']]);
  assert.equal(consoleFout.mock.calls.length, 0);
});

test('herinnering: dezelfde ontvanger onder twee doelgroepen (hoofdletterongevoelig) krijgt één mail; zonder adres geen mail', async () => {
  const { calls } = await draai({ tickets: [TICKET({ email: 'Klant@X.be', emailEindklant: 'klant@x.be', emailInstallateur: '' })] });
  assert.deepEqual(calls.filter(c => c.url.endsWith('/sendReply')).map(c => JSON.parse(c.body).to), ['Klant@X.be']);
});

test('herinnering: zonder ZOHO_FROM_EMAIL volgt emailAddresses?limit=50 (eerste geldige adres)', async () => {
  const hersteld = zetEnv({ ZOHO_FROM_EMAIL: undefined });
  try {
    const { fn, calls } = maakNepFetch((url, opts = {}) => (url.includes('/emailAddresses')
      ? json({ data: [{ emailAddress: 'kapot' }, { emailAddress: 'support@blitz.test' }] })
      : maakRouter()(url, opts)));
    const s = maakNepStore({ 'voorstel-status': registerStand({ 555: ENTRY }) });
    await verwerkHerinneringen({ zoho: maakZoho({ fetch: fn, env: process.env }), haalStore: async () => s, haalTickets: async () => ({ pendingTickets: [TICKET({ emailEindklant: '', emailInstallateur: '' })] }), nu: () => Date.now() });
    assert.equal(JSON.parse(calls.find(c => c.url.endsWith('/sendReply')).body).fromEmailAddress, 'support@blitz.test');
  } finally { hersteld(); }
});

test('herinnering: buiten het venster (0 dagen, 4 dagen of een verleden datum) gebeurt er niets: geen Zoho-aanroep', async () => {
  for (const datum of ['2026-10-11', '2026-10-15', '2026-10-09']) {
    const { r, calls } = await draai({ tickets: [TICKET({ interventieDatum: `${datum}T06:30:00.000Z` })], register: { 555: { ...ENTRY, tijdslotDatum: datum } } });
    assert.deepEqual(kort(calls), [], datum);
    assert.deepEqual(r, { gecontroleerd: 1, verstuurd: 0, overgeslagen: 1, fouten: 0, uitgesteld: 0 }, datum);
  }
});

test('herinnering: een gemiste run wordt ingehaald (1 of 2 dagen vooraf krijgt nog één herinnering)', async () => {
  for (const datum of ['2026-10-12', '2026-10-13']) {
    const { r } = await draai({ tickets: [TICKET({ interventieDatum: `${datum}T06:30:00.000Z` })], register: { 555: { ...ENTRY, tijdslotDatum: datum } } });
    assert.equal(r.verstuurd, 1, datum);
  }
});

test('herinnering: de datum telt in Brusselse tijd (een afspraak om 00:30 Brusselse tijd valt op de volgende kalenderdag)', async () => {
  // 2026-10-13T22:30Z = 00:30 CEST op 14 oktober -> 3 dagen vanaf 11 oktober
  const { r } = await draai({ tickets: [TICKET({ interventieDatum: '2026-10-13T22:30:00.000Z' })], register: { 555: { ...ENTRY, tijdslotDatum: '2026-10-14' } } });
  assert.equal(r.verstuurd, 1);
});

test('herinnering: één herinnering per datum: een tweede run (ook na een mislukte PATCH) stuurt niets meer; een nieuwe datum krijgt wel weer een herinnering', async () => {
  const eerste = await draai();
  assert.equal(eerste.r.verstuurd, 1);
  const tweede = await draai({ store: eerste.store });
  assert.deepEqual(kort(tweede.calls), []);
  assert.deepEqual(tweede.r, { gecontroleerd: 1, verstuurd: 0, overgeslagen: 1, fouten: 0, uitgesteld: 0 });
  // Het voorstel wordt opnieuw gedaan voor een andere datum (reset): de oude herinnering is weg, de nieuwe datum telt apart.
  const nieuw = maakNepStore({ 'voorstel-status': registerStand({ 555: { ...ENTRY, herinnering: { datum: '2026-10-09', tijdstip: 'T' } } }) });
  const derde = await draai({ store: nieuw });
  assert.equal(derde.r.verstuurd, 1);
});

test('herinnering: bevestigd, afgewezen of zonder voorstel in het register wordt overgeslagen, zonder Zoho-aanroep', async () => {
  for (const register of [
    { 555: { ...ENTRY, bevestigd: { door: 'klant', tijdstip: 'T' } } },
    { 555: { afgewezen: { door: 'klant', tijdstip: 'T' } } },
    { 555: { ...ENTRY, bevestigd: { door: 'mail', tijdstip: 'T', wie: 'Petra' } } },
    {},
  ]) {
    const { r, calls } = await draai({ register });
    assert.deepEqual(kort(calls), [], JSON.stringify(register));
    assert.equal(r.verstuurd, 0);
    assert.equal(r.overgeslagen, 1);
  }
});

test('herinnering: een inkomende klantmail na het voorstel -> geen herinnering, één interne notitie en een markering (komt niet elke dag terug)', async () => {
  const threads = { 555: [
    { direction: 'in', channel: 'EMAIL', createdTime: '2026-10-09T09:00:00.000Z', fromEmailAddress: 'klant@x.be' }, // het oorspronkelijke ticket, vóór het voorstel
    { direction: 'out', channel: 'EMAIL', createdTime: '2026-10-10T08:00:05.000Z', to: 'klant@x.be' },
    { direction: 'in', channel: 'EMAIL', createdTime: '2026-10-10T14:00:00.000Z', fromEmailAddress: 'klant@x.be' },
  ] };
  const { r, calls, store } = await draai({ router: { threads } });
  assert.deepEqual(r, { gecontroleerd: 1, verstuurd: 0, overgeslagen: 1, fouten: 0, uitgesteld: 0 });
  assert.deepEqual(kort(calls), ['GET /tickets/555/threads?from=1&limit=100', 'POST /tickets/555/comments']);
  assert.equal(calls.filter(c => c.url.endsWith('/sendReply') || c.method === 'PATCH').length, 0);
  assert.equal(JSON.parse(calls[calls.length - 1].body).content, bouwOvergeslagenNotitie({ tijdstip: '10/10/2026 16:00', van: ['klant@x.be'] }));
  assert.deepEqual(entryVan(store).herinnering, { datum: '2026-10-14', tijdstip: new Date(NU).toISOString(), overgeslagen: 'mailantwoord' });
  // De volgende dag: niets meer (ook geen tweede notitie).
  const dagNa = await draai({ store, router: { threads }, opties: { nu: () => NU + MS_DAG } });
  assert.deepEqual(kort(dagNa.calls), []);
});

test('herinnering: een inkomende mail die niet telt (vóór het voorstel, privé, geen e-mail) blokkeert de herinnering niet', async () => {
  const threads = { 555: [
    { direction: 'in', channel: 'EMAIL', createdTime: '2026-10-09T09:00:00.000Z' },
    { direction: 'in', channel: 'EMAIL', visibility: 'private', createdTime: '2026-10-10T14:00:00.000Z' },
    { direction: 'in', channel: 'PHONE', createdTime: '2026-10-10T14:00:00.000Z' },
  ] };
  const { r } = await draai({ router: { threads } });
  assert.equal(r.verstuurd, 1);
});

test('herinnering: de threads worden met paginering gelezen (een antwoord op pagina 2 telt)', async () => {
  const eigen = Array.from({ length: 100 }, (_, i) => ({ direction: 'out', channel: 'EMAIL', createdTime: `2026-10-10T08:00:${String(i % 60).padStart(2, '0')}.000Z`, to: 'klant@x.be' }));
  const threads = { 555: [...eigen, { direction: 'in', channel: 'EMAIL', createdTime: '2026-10-10T15:00:00.000Z', fromEmailAddress: 'klant@x.be' }] };
  const { r, calls } = await draai({ router: { threads } });
  assert.deepEqual(kort(calls).slice(0, 2), ['GET /tickets/555/threads?from=1&limit=100', 'GET /tickets/555/threads?from=101&limit=100']);
  assert.equal(r.verstuurd, 0);
  assert.equal(r.overgeslagen, 1);
});

test('herinnering: een falend ticket stopt de rest niet; de fout staat in de samenvatting en nergens staat klantdata in de logs', async () => {
  const tickets = [TICKET({ id: '555' }), TICKET({ id: '556', emailEindklant: 'ander@x.be', emailInstallateur: '' }), TICKET({ id: '557', emailEindklant: '', emailInstallateur: '' })];
  const register = { 555: ENTRY, 556: ENTRY, 557: ENTRY };
  const { r, calls, store } = await draai({
    tickets, register,
    router: { threadsRes: (id) => (id === '556' ? json({}, 500) : json({ data: [] })) },
  });
  assert.deepEqual(r, { gecontroleerd: 3, verstuurd: 2, overgeslagen: 0, fouten: 1, uitgesteld: 0 });
  assert.ok(entryVan(store, '555').herinnering);
  assert.equal(entryVan(store, '556').herinnering, undefined, 'het mislukte ticket krijgt morgen een nieuwe kans');
  assert.ok(entryVan(store, '557').herinnering);
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 2);
  const gelogd = JSON.stringify(consoleFout.mock.calls.map(c => c.arguments.map(a => (a instanceof Error ? a.message : a))));
  assert.ok(!gelogd.includes('x.be'), 'geen e-mailadressen in de logs');
});

test('herinnering: een uitzondering midden in een ticket (netwerkfout op sendReply) telt als fout en stopt de volgende niet', async () => {
  let eerste = true;
  const tickets = [TICKET({ id: '555', emailEindklant: '', emailInstallateur: '' }), TICKET({ id: '556', emailEindklant: '', emailInstallateur: '' })];
  const { r, store } = await draai({
    tickets, register: { 555: ENTRY, 556: ENTRY },
    router: { replyRes: () => { if (eerste) { eerste = false; throw new Error('netwerk'); } return json({}); } },
  });
  assert.deepEqual(r, { gecontroleerd: 2, verstuurd: 1, overgeslagen: 0, fouten: 1, uitgesteld: 0 });
  assert.equal(entryVan(store, '555').herinnering, undefined);
  assert.ok(entryVan(store, '556').herinnering);
});

test('herinnering: faalt elke sendReply, dan geen PATCH en geen markering (het wordt morgen opnieuw geprobeerd)', async () => {
  const { r, calls, store } = await draai({ router: { replyRes: () => json({ message: 'nee' }, 500) } });
  assert.deepEqual(r, { gecontroleerd: 1, verstuurd: 0, overgeslagen: 0, fouten: 1, uitgesteld: 0 });
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
  assert.equal(entryVan(store).herinnering, undefined);
  assert.equal(store._data.has(VEROUDERD_SLEUTEL), false);
});

test('herinnering: faalt één van de drie mails, dan gaat de rest door; de herinnering is toch gemarkeerd (anders dubbele mails) en de fout staat in de notitie', async () => {
  let n = 0;
  const { r, calls, store } = await draai({ router: { replyRes: () => (++n === 2 ? json({ message: 'boem' }, 500) : json({})) } });
  assert.deepEqual(r, { gecontroleerd: 1, verstuurd: 1, overgeslagen: 0, fouten: 0, uitgesteld: 0 });
  assert.equal(calls.filter(c => c.url.endsWith('/sendReply')).length, 3);
  assert.ok(entryVan(store).herinnering);
  const notitie = JSON.parse(calls.at(-1).body).content;
  assert.match(notitie, /Automatische herinnering verstuurd naar contact@x\.be, inst@x\.be/);
  assert.match(notitie, /klant:/);
});

test('herinnering: "Empty Recipients" van Zoho is een stille fout (geen mail, geen foutmelding); alleen dan geen PATCH', async () => {
  const { r, calls } = await draai({ tickets: [TICKET({ emailEindklant: '', emailInstallateur: '' })], router: { replyRes: () => json({ message: 'Empty Recipients' }, 422) } });
  assert.equal(r.verstuurd, 0);
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
});

test('herinnering: een mislukte PATCH nadat de mails weg zijn: toch gemarkeerd (geen dubbele mails morgen), fout geteld, notitie meldt de status', async () => {
  const { r, calls, store } = await draai({ router: { patchRes: () => json({}, 500) } });
  assert.deepEqual(r, { gecontroleerd: 1, verstuurd: 1, overgeslagen: 0, fouten: 1, uitgesteld: 0 });
  assert.ok(entryVan(store).herinnering);
  assert.match(JSON.parse(calls.at(-1).body).content, /status kon niet teruggezet worden/);
});

test('herinnering: een falende notitie of een kapot register verandert het resultaat niet (de mails zijn weg)', async () => {
  const a = await draai({ router: { commentRes: () => json({}, 500) } });
  assert.equal(a.r.verstuurd, 1);
  const kapot = { ...maakNepStore({ 'voorstel-status': registerStand({ 555: ENTRY }) }), async setJSON() { throw new Error('blob stuk'); } };
  const b = await draai({ store: kapot });
  assert.equal(b.calls.filter(c => c.url.endsWith('/sendReply')).length, 3);
  assert.equal(b.r.verstuurd, 1);
  assert.equal(b.r.fouten, 1); // het register kon niet bijgewerkt worden
});

test('herinnering: het tijdbudget houdt de run binnen de limiet; wat overblijft komt de volgende dag aan bod (uitgesteld)', async () => {
  let klok = NU;
  const tickets = [TICKET({ id: '555', emailEindklant: '', emailInstallateur: '' }), TICKET({ id: '556', emailEindklant: '', emailInstallateur: '' }), TICKET({ id: '557', emailEindklant: '', emailInstallateur: '' })];
  const { r, store } = await draai({
    tickets, register: { 555: ENTRY, 556: ENTRY, 557: ENTRY },
    router: { threadsRes: () => { klok += 9000; return json({ data: [] }); } },
    opties: { nu: () => klok, tijdBudgetMs: 15000 },
  });
  assert.equal(r.verstuurd, 2);
  assert.equal(r.uitgesteld, 1);
  assert.equal(entryVan(store, '557').herinnering, undefined);
});

test('herinnering: zonder CONFIRM_LINK_SECRET gaat de herinnering zonder knoppen weg (met de vraag om te antwoorden)', async () => {
  const hersteld = zetEnv({ CONFIRM_LINK_SECRET: undefined });
  try {
    const { r, calls } = await draai({ tickets: [TICKET({ emailEindklant: '', emailInstallateur: '' })] });
    assert.equal(r.verstuurd, 1);
    const mail = bodyVan(calls, '/sendReply').content;
    assert.ok(!mail.includes('/api/confirm-afspraak'));
    assert.match(mail, /antwoorden/);
  } finally { hersteld(); }
});

test('herinnering: zonder tickets of zonder register gebeurt er niets', async () => {
  const leeg = await draai({ tickets: [] });
  assert.deepEqual(leeg.r, { gecontroleerd: 0, verstuurd: 0, overgeslagen: 0, fouten: 0, uitgesteld: 0 });
  assert.deepEqual(kort(leeg.calls), []);
  const zonderRegister = await draai({ store: maakNepStore() });
  assert.equal(zonderRegister.r.overgeslagen, 1);
});

// ============================================================ de geplande functie ====
test('herinnering-bevestiging: de geplande functie draait één keer per dag (07:00 UTC = 08:00 of 09:00 Brusselse tijd) en geeft enkel aantallen terug', async () => {
  const mod = await laadVers('herinnering-bevestiging');
  assert.deepEqual(mod.config, { schedule: '0 7 * * *' });
  const { fn } = maakNepFetch(maakRouter());
  const s = maakNepStore({ 'voorstel-status': registerStand({ 555: ENTRY }) });
  const h = mod.maakHandler({ haalStore: async () => s, haalLive: async () => ({ pendingTickets: [TICKET()] }), zoho: maakZoho({ fetch: fn, env: process.env }) });
  const res = await h();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { gecontroleerd: 1, verstuurd: 1, overgeslagen: 0, fouten: 0, uitgesteld: 0 });
  assert.ok(!JSON.stringify(body).includes('@'));
});

test('herinnering-bevestiging: een mislukte ticketlading geeft 500 zonder klantdata en stuurt niets', async () => {
  const mod = await laadVers('herinnering-bevestiging');
  const { fn, calls } = maakNepFetch(maakRouter());
  const h = mod.maakHandler({ haalStore: async () => maakNepStore(), haalLive: async () => { throw new Error('Zoho tickets-ophalen mislukt (500): klant@x.be'); }, zoho: maakZoho({ fetch: fn, env: process.env }) });
  const res = await h();
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { resultaat: 'mislukt' });
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
  assert.ok(!JSON.stringify(consoleFout.mock.calls.map(c => c.arguments)).includes('x.be'));
});
