// tests/mcp-protocol.test.mjs — MCP-leesconnector (Task 5): netlify/lib/mcp-protocol.js (JSON-RPC, gereedschappen per rol)
// en netlify/functions/mcp.js (/api/mcp: Bearer-controle, stateless Streamable HTTP). Nep-store, geen Blobs, geen netwerk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maakNepStore } from './nep-blobs.mjs';
import { registreerClient, maakCode, wisselCode } from '../netlify/lib/mcp-oauth.js';
import { behandelRpc } from '../netlify/lib/mcp-protocol.js';
import mcpStandaard, { maakHandler, config } from '../netlify/functions/mcp.js';

const VERSIE = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;
const T0 = 1_800_000_000_000;
const ORIGIN = 'https://blitz.voorbeeld.be';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(50);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const ZES = ['rapporten_zoeken', 'rapport_lezen', 'rapporten_tellen', 'paal_historiek', 'tickets_open', 'planning_lezen'];

const PLANNER = { id: 'u1', naam: 'An', rol: 'planner' };
const TECH = { id: 'u2', naam: 'Jan', rol: 'technieker', zohoNaam: 'Jan Peeters' };
const SALES = { id: 'u3', naam: 'Sam', rol: 'sales' };
const BEHEER = { id: 'u4', naam: 'Bea', rol: 'beheerder' };

const rap = (id, technieker, o = {}, rd = {}) => ({
  id, datum: '2026-03-01', technieker, ticketNumber: 'T' + id, klant: 'Klant BV', adres: 'Straat 1',
  interventieType: 'Interventie', servicetype: 'Herstelling', hersteld: 'ja', nieuwInter: 'nee',
  rapportData: { serienummer: '2201-AB', probleem: 'Laadt niet', acties: 'Reset', oorzaakStoring: ['Component defect'], onderdelen: [], ...rd },
  ...o,
});

// 3 eigen rapporten van Jan Peeters + 5 van collega Piet op dezelfde paal (+ 1 ander paal van Piet).
const RAPPORTEN = [
  rap('j1', 'Jan Peeters', { datum: '2026-01-05' }),
  rap('j2', 'jan  peeters', { datum: '2026-02-05' }),
  rap('j3', 'Iemand anders', { datum: '2026-03-05', ingediendDoor: 'u2' }),
  ...[1, 2, 3, 4, 5].map(i => rap('p' + i, 'Piet Janssens', { datum: `2026-0${i}-10` }, { oorzaakStoring: ['Installatiefout'] })),
  rap('p9', 'Piet Janssens', { datum: '2026-04-20' }, { serienummer: '9999-ZZ' }),
];

const ticket = (id, o = {}) => ({
  id, number: 'N' + id, subject: 'Laadpaal ' + id, status: 'Service in te plannen', priority: 'Middel', assignee: 'Jan Peeters',
  contact: 'Klant ' + id, email: '', phone: '', account: 'Firma ' + id, address: 'Weg ' + id, hasAddress: true, naamEindklant: '',
  emailEindklant: '', telefoonEindklant: '', serienummer: '2201-ab', partner: '', emailInstallateur: '', probleemtype: 'Laadt niet',
  regio: '', interventieDatum: null, garantieStatus: '', installateurAlLangsGeweest: '', createdTime: null, ...o,
});

const SNAPSHOT = {
  v: 1, op: T0 - 60_000, dekt: null, klaar: T0 - 55_000,
  tickets: [ticket('t1'), ticket('t2', { assignee: 'Piet Janssens', serienummer: '7777' })],
  // 2026-11-12 09:00 Brussel (UTC+1) en 2026-11-13 middernacht (geen uur).
  pendingTickets: [ticket('t3', { status: 'Wachten op bevestiging planning', interventieDatum: '2026-11-12T08:00:00.000Z' })],
  plannedTickets: [
    ticket('t4', { status: 'Geplande service', assignee: 'Piet Janssens', interventieDatum: '2026-11-13T09:30:00.000Z' }),
    ticket('t5', { status: 'Geplande service', interventieDatum: '2026-11-12T23:00:00.000Z' }),
  ],
};

const AFSPRAKEN = {
  versie: 3,
  afspraken: [
    { id: 'a1', titel: 'Opleiding', datum: '2026-11-12', uur: '13:00', einduur: '15:00', type: 'Overige', persoon: 'Jan Peeters', notitie: 'Kantoor' },
    { id: 'a2', titel: 'Tandarts', datum: '2026-11-12', uur: '10:00', einduur: '11:00', type: 'Overige', persoon: 'Piet Janssens', notitie: '' },
    { id: 'a3', titel: 'Teamdag', datum: '2026-11-14', uur: '', einduur: '', type: 'Overige', persoon: null, notitie: '' },
    { id: 'a4', titel: 'Later', datum: '2026-12-20', uur: '', einduur: '', type: 'Overige', persoon: 'Jan Peeters', notitie: '' },
  ],
};

const REGISTER = { versie: 5, status: { t3: { klant: 1, tijdslot: '09:00–11:00', tijdslotDatum: '2026-11-12' }, t4: { bevestigd: { door: 'klant', tijdstip: 1 } } } };

function basisBlobs(extra = {}) {
  return {
    rapportlijst: { versie: 1, rapports: RAPPORTEN },
    'tickets-snapshot': SNAPSHOT,
    afspraken: AFSPRAKEN,
    'voorstel-status': REGISTER,
    ...extra,
  };
}

const NU = new Date('2026-11-10T10:00:00Z');
const bron = (blobs = basisBlobs()) => ({ store: maakNepStore(blobs), nu: NU });
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const roep = (gebruiker, naam, args = {}, bronnen = bron()) => behandelRpc(rpc('tools/call', { name: naam, arguments: args }), { gebruiker, bronnen });
const data = r => {
  assert.equal(r.result.isError, undefined, 'onverwachte isError: ' + JSON.stringify(r.result));
  assert.deepEqual(JSON.parse(r.result.content[0].text), r.result.structuredContent);
  assert.equal(r.result.content[0].type, 'text');
  return r.result.structuredContent;
};

// ---------- protocol ----------

test('initialize: protocolversie van de client indien ondersteund, anders 2025-06-18', async () => {
  for (const [gevraagd, verwacht] of [['2025-06-18', '2025-06-18'], ['2025-03-26', '2025-03-26'], ['2024-11-05', '2025-06-18'], [undefined, '2025-06-18']]) {
    const r = await behandelRpc(rpc('initialize', { protocolVersion: gevraagd, capabilities: {}, clientInfo: { name: 'claude' } }, 7), { gebruiker: PLANNER, bronnen: bron() });
    assert.equal(r.jsonrpc, '2.0');
    assert.equal(r.id, 7);
    assert.equal(r.result.protocolVersion, verwacht);
    assert.deepEqual(r.result.capabilities, { tools: {} });
    assert.deepEqual(r.result.serverInfo, { name: 'blitz-planning', version: VERSIE });
    assert.equal(typeof r.result.instructions, 'string');
    assert.match(r.result.instructions, /vaste lijst/);
  }
});

test('ping -> leeg resultaat; onbekende methode -> -32601; notificatie -> null', async () => {
  assert.deepEqual(await behandelRpc(rpc('ping', undefined, 'a'), { gebruiker: PLANNER, bronnen: bron() }), { jsonrpc: '2.0', id: 'a', result: {} });
  const r = await behandelRpc(rpc('resources/list', {}, 2), { gebruiker: PLANNER, bronnen: bron() });
  assert.equal(r.error.code, -32601);
  assert.equal(r.id, 2);
  assert.equal(await behandelRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { gebruiker: PLANNER, bronnen: bron() }), null);
  assert.equal(await behandelRpc({ jsonrpc: '2.0', method: 'iets/onbekends' }, { gebruiker: PLANNER, bronnen: bron() }), null);
});

test('ongeldig verzoek -> -32600', async () => {
  for (const b of [null, 5, 'x', {}, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: { a: 1 }, method: 'ping' }]) {
    const r = await behandelRpc(b, { gebruiker: PLANNER, bronnen: bron() });
    assert.equal(r.error.code, -32600, JSON.stringify(b));
  }
});

test('tools/list: planner, beheerder en technieker 6 namen (allemaal readOnlyHint); sales leeg', async () => {
  for (const g of [PLANNER, BEHEER, TECH]) {
    const r = await behandelRpc(rpc('tools/list'), { gebruiker: g, bronnen: bron() });
    assert.deepEqual(r.result.tools.map(t => t.name), ZES, g.rol);
    for (const t of r.result.tools) {
      assert.deepEqual(t.annotations?.readOnlyHint, true, t.name);
      assert.equal(t.inputSchema?.type, 'object', t.name);
      assert.equal(typeof t.description, 'string');
    }
  }
  const s = await behandelRpc(rpc('tools/list'), { gebruiker: SALES, bronnen: bron() });
  assert.deepEqual(s.result.tools, []);
  const onbekend = await behandelRpc(rpc('tools/list'), { gebruiker: { id: 'x', rol: 'koning' }, bronnen: bron() });
  assert.deepEqual(onbekend.result.tools, []);
});

test('sales: tools/call -> -32601 en leest geen enkele blob', async () => {
  const b = bron();
  const gelezen = [];
  const get = b.store.get.bind(b.store);
  b.store.get = async (k, o) => { gelezen.push(k); return get(k, o); };
  for (const naam of ZES) {
    const r = await roep(SALES, naam, { id: 'p1', serienummer: '2201-AB', groepeer: 'oorzaak' }, b);
    assert.equal(r.error.code, -32601, naam);
    assert.equal(r.result, undefined);
  }
  assert.deepEqual(gelezen, []);
});

test('onbekend gereedschap -> -32602', async () => {
  const r = await roep(PLANNER, 'rapporten_wissen');
  assert.equal(r.error.code, -32602);
});

// ---------- rapporten + rechten ----------

test('technieker rapporten_tellen groepeer serienummer: enkel eigen (3), planner alles (8)', async () => {
  const t = data(await roep(TECH, 'rapporten_tellen', { groepeer: 'serienummer' }));
  assert.deepEqual(t.groepen, [{ sleutel: '2201-AB', aantal: 3 }]);
  assert.equal(t.totaalRapporten, 3);
  const p = data(await roep(PLANNER, 'rapporten_tellen', { groepeer: 'serienummer' }));
  assert.deepEqual(p.groepen, [{ sleutel: '2201-AB', aantal: 8 }, { sleutel: '9999-ZZ', aantal: 1 }]);
});

test('technieker: filter op technieker van een collega geeft niets terug (filter staat vóór het zoeken)', async () => {
  const z = data(await roep(TECH, 'rapporten_zoeken', { technieker: 'Piet' }));
  assert.equal(z.totaal, 0);
  const t = data(await roep(TECH, 'rapporten_tellen', { groepeer: 'oorzaak' }));
  assert.deepEqual(t.groepen, [{ sleutel: 'Component defect', aantal: 3 }]);
});

test('rapport_lezen: technieker eigen ok; collega en onbekend -> isError met dezelfde tekst', async () => {
  const eigen = data(await roep(TECH, 'rapport_lezen', { id: 'j3' }));
  assert.equal(eigen.rapport.id, 'j3');
  assert.equal(eigen.rapport.serienummer, '2201-AB');
  const collega = await roep(TECH, 'rapport_lezen', { id: 'p1' });
  const onbekend = await roep(TECH, 'rapport_lezen', { id: 'bestaat-niet' });
  assert.equal(collega.result.isError, true);
  assert.equal(onbekend.result.isError, true);
  assert.equal(collega.result.content[0].text, onbekend.result.content[0].text);
  assert.ok(!JSON.stringify(collega).includes('Piet'));
  assert.equal(data(await roep(PLANNER, 'rapport_lezen', { id: 'p1' })).rapport.technieker, 'Piet Janssens');
});

test('rapport_lezen: het volledige rapport (ook installateur en andere velden) zonder foto\'s, handtekeningen of HTML', async () => {
  const zwaar = rap('z1', 'Jan Peeters', { datum: '2026-03-07', facturatie: 'Klant', prioriteit: 'Hoog' }, {
    installateur: 'Elektro Peeters', probleemtype: 'Laadt niet', garantieStatus: 'In garantie',
    _html: '<html>rapport</html>', handtekeningTech: 'data:image/png;base64,AAAA', handtekeningKlant: 'data:image/png;base64,BBBB',
    fotos: ['data:image/jpeg;base64,CCCC'], extra: { schets: 'data:image/png;base64,DDDD', opmerking: 'ok' },
  });
  const blobs = basisBlobs({ rapportlijst: { versie: 1, rapports: [...RAPPORTEN, zwaar] } });
  const r = data(await roep(TECH, 'rapport_lezen', { id: 'z1' }, bron(blobs))).rapport;
  assert.equal(r.id, 'z1');
  assert.equal(r.serienummer, '2201-AB');
  assert.equal(r.facturatie, 'Klant');
  assert.equal(r.prioriteit, 'Hoog');
  assert.equal(r.rapportData.installateur, 'Elektro Peeters');
  assert.equal(r.rapportData.probleem, 'Laadt niet');
  assert.equal(r.rapportData.extra.opmerking, 'ok');
  for (const k of ['_html', 'handtekeningTech', 'handtekeningKlant', 'fotos']) assert.equal(Object.hasOwn(r.rapportData, k), false, k);
  const tekst = JSON.stringify(r);
  assert.ok(!tekst.includes('data:'), 'geen data-URL in het antwoord');
  assert.ok(!tekst.includes('<html>'));
  // nog steeds het technieker-filter: een rapport van een collega blijft onzichtbaar
  assert.equal((await roep(TECH, 'rapport_lezen', { id: 'p1' }, bron(blobs))).result.isError, true);
});

test('paal_historiek: technieker enkel eigen bezoeken', async () => {
  const t = data(await roep(TECH, 'paal_historiek', { serienummer: ' 2201-ab ' }));
  assert.equal(t.serienummer, '2201-AB');
  assert.deepEqual(t.bezoeken.map(b => b.id), ['j1', 'j2', 'j3']);
  assert.deepEqual(t.oorzaken, [{ sleutel: 'Component defect', aantal: 3 }]);
  const p = data(await roep(PLANNER, 'paal_historiek', { serienummer: '2201-AB' }));
  assert.equal(p.bezoeken.length, 8);
  assert.equal((await roep(PLANNER, 'paal_historiek', {})).result.isError, true);
});

test('rapporten_zoeken: filters en limiet; afgekapt op 200', async () => {
  const z = data(await roep(PLANNER, 'rapporten_zoeken', { serienummer: '9999-zz' }));
  assert.deepEqual(z.resultaten.map(r => r.id), ['p9']);
  assert.equal(z.afgekapt, false);
  const veel = Array.from({ length: 250 }, (_, i) => rap('v' + i, 'Jan Peeters'));
  const v = data(await roep(PLANNER, 'rapporten_zoeken', {}, bron(basisBlobs({ rapportlijst: { versie: 1, rapports: veel } }))));
  assert.equal(v.resultaten.length, 200);
  assert.equal(v.totaal, 250);
  assert.equal(v.afgekapt, true);
  const l = data(await roep(PLANNER, 'rapporten_zoeken', { limiet: 2 }));
  assert.equal(l.resultaten.length, 2);
});

test('rapporten_tellen: onbekende groepering, foute datum of minimum -> isError (nooit een uitzondering)', async () => {
  for (const args of [{ groepeer: 'kleur' }, {}, { groepeer: 'oorzaak', van: 'gisteren' }, { groepeer: 'oorzaak', van: '2026-05-01', tot: '2026-01-01' },
    { groepeer: 'oorzaak', minimum: 0 }, { groepeer: 'oorzaak', minimum: 'veel' }, { groepeer: 'oorzaak', serienummer: 5 }]) {
    const r = await roep(PLANNER, 'rapporten_tellen', args);
    assert.equal(r.result.isError, true, JSON.stringify(args));
    assert.equal(r.result.content[0].type, 'text');
  }
  // Eigen validatie (niet de algemene vangnet-fout): Claude krijgt de toegelaten groeperingen terug.
  const kleur = await roep(PLANNER, 'rapporten_tellen', { groepeer: 'kleur' });
  assert.match(kleur.result.content[0].text, /groepeer moet een van deze zijn: oorzaak, serienummer/);
});

test('rapporten_tellen: elke groepering uit het schema werkt (geen isError)', async () => {
  for (const groepeer of ['oorzaak', 'serienummer', 'technieker', 'maand', 'klant', 'interventieType', 'probleemtype', 'garantieStatus']) {
    const r = data(await roep(PLANNER, 'rapporten_tellen', { groepeer }));
    assert.equal(r.groeperingOp, groepeer);
    assert.equal(r.totaalRapporten, 9, groepeer);
    assert.ok(r.groepen.length > 0, groepeer);
  }
});

test('rapporten_tellen: minimum en groepen afgekapt op 200', async () => {
  const p = data(await roep(PLANNER, 'rapporten_tellen', { groepeer: 'serienummer', minimum: 3 }));
  assert.deepEqual(p.groepen, [{ sleutel: '2201-AB', aantal: 8 }]);
  const veel = Array.from({ length: 230 }, (_, i) => rap('s' + i, 'Jan Peeters', {}, { serienummer: 'S' + i }));
  const v = data(await roep(PLANNER, 'rapporten_tellen', { groepeer: 'serienummer' }, bron(basisBlobs({ rapportlijst: { versie: 1, rapports: veel } }))));
  assert.equal(v.groepen.length, 200);
  assert.equal(v.totaalGroepen, 230);
  assert.equal(v.afgekapt, true);
});

test('onleesbaar jaararchief -> ontbrekendeJaren + waarschuwing', async () => {
  const b = bron(basisBlobs({ 'rapportlijst-archief-2025': '{kapot' }));
  const z = data(await roep(PLANNER, 'rapporten_tellen', { groepeer: 'oorzaak', van: '2025-01-01', tot: '2026-12-31' }, b));
  assert.deepEqual(z.ontbrekendeJaren, [2025]);
  assert.match(z.waarschuwing, /onvolledig/);
  const ok = data(await roep(PLANNER, 'rapporten_tellen', { groepeer: 'oorzaak', van: '2026-01-01' }));
  assert.equal(ok.ontbrekendeJaren, undefined);
  assert.equal(ok.waarschuwing, undefined);
});

// ---------- tickets ----------

test('tickets_open: alle lijsten uit de momentopname, met filters; technieker krijgt hetzelfde als de planner', async () => {
  const p = data(await roep(PLANNER, 'tickets_open'));
  assert.deepEqual(p.tickets.map(t => t.id).sort(), ['t1', 't2', 't3', 't4', 't5']);
  assert.equal(p.totaal, 5);
  assert.equal(p.tickets.find(t => t.id === 't3').lijst, 'wacht op bevestiging');
  assert.equal(p.tickets.find(t => t.id === 't1').lijst, 'in te plannen');
  assert.equal(p.tickets.find(t => t.id === 't4').lijst, 'gepland');
  assert.equal(p.momentopname, new Date(SNAPSHOT.op).toISOString());
  assert.deepEqual(data(await roep(TECH, 'tickets_open')), p);
  const s = data(await roep(PLANNER, 'tickets_open', { serienummer: '2201-AB' }));
  assert.deepEqual(s.tickets.map(t => t.id).sort(), ['t1', 't3', 't4', 't5']);
  const st = data(await roep(PLANNER, 'tickets_open', { status: 'geplande service' }));
  assert.deepEqual(st.tickets.map(t => t.id).sort(), ['t4', 't5']);
  const tk = data(await roep(PLANNER, 'tickets_open', { tekst: 'firma t2' }));
  assert.deepEqual(tk.tickets.map(t => t.id), ['t2']);
});

test('tickets_open: geen of ongeldige momentopname -> isError, nooit Zoho', async () => {
  for (const extra of [{ 'tickets-snapshot': undefined }, { 'tickets-snapshot': { v: 1, tickets: [] } }]) {
    const blobs = basisBlobs(extra);
    if (extra['tickets-snapshot'] === undefined) delete blobs['tickets-snapshot'];
    const r = await roep(PLANNER, 'tickets_open', {}, bron(blobs));
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /Geen ticketgegevens beschikbaar/);
  }
});

// ---------- planning ----------

test('planning_lezen planner: tickets met interventiedatum (Brusselse tijd) + afspraken, met voorstel uit het register', async () => {
  const p = data(await roep(PLANNER, 'planning_lezen', { van: '2026-11-12', tot: '2026-11-14' }));
  const sleutels = p.items.map(i => `${i.soort}:${i.id}:${i.datum}:${i.uur ?? '-'}`);
  assert.deepEqual(sleutels, [
    'ticket:t3:2026-11-12:09:00',
    'afspraak:a2:2026-11-12:10:00',
    'afspraak:a1:2026-11-12:13:00',
    'ticket:t5:2026-11-13:-',
    'ticket:t4:2026-11-13:10:30',
    'afspraak:a3:2026-11-14:-',
  ]);
  const t3 = p.items.find(i => i.id === 't3');
  assert.equal(t3.technieker, 'Jan Peeters');
  assert.equal(t3.voorstel.tijdslot, '09:00–11:00');
  assert.deepEqual(p.items.find(i => i.id === 't4').voorstel.bevestigd, { door: 'klant', tijdstip: 1 });
  const filter = data(await roep(PLANNER, 'planning_lezen', { van: '2026-11-12', tot: '2026-11-14', technieker: 'piet' }));
  assert.deepEqual(filter.items.map(i => i.id), ['a2', 't4']);
});

test('planning_lezen technieker: eigen naam plus afspraken zonder persoon (voor iedereen, zoals de kalender), nooit van een collega', async () => {
  const t = data(await roep(TECH, 'planning_lezen', { van: '2026-11-12', tot: '2026-11-14' }));
  assert.deepEqual(t.items.map(i => i.id), ['t3', 'a1', 't5', 'a3']);
  assert.equal(t.items.find(i => i.id === 'a3').technieker, null);
  assert.ok(!t.items.some(i => i.id === 'a2' || i.id === 't4'), 'geen afspraak of ticket van collega Piet');
  const viaFilter = data(await roep(TECH, 'planning_lezen', { van: '2026-11-12', tot: '2026-11-14', technieker: 'Piet' }));
  assert.deepEqual(viaFilter.items, []);
});

test('planning_lezen technieker: afspraak met lege persoon zichtbaar, ticket zonder technieker niet', async () => {
  const snapshot = structuredClone(SNAPSHOT);
  snapshot.plannedTickets.push(ticket('t9', { status: 'Geplande service', assignee: '', interventieDatum: '2026-11-13T09:30:00.000Z' }));
  const afspraken = structuredClone(AFSPRAKEN);
  afspraken.afspraken.push({ id: 'a9', titel: 'Feestdag', datum: '2026-11-13', uur: '', einduur: '', type: 'Overige', persoon: '', notitie: '' });
  const t = data(await roep(TECH, 'planning_lezen', { van: '2026-11-13', tot: '2026-11-13' }, bron(basisBlobs({ 'tickets-snapshot': snapshot, afspraken }))));
  assert.deepEqual(t.items.map(i => i.id), ['a9', 't5']);
  const p = data(await roep(PLANNER, 'planning_lezen', { van: '2026-11-13', tot: '2026-11-13' }, bron(basisBlobs({ 'tickets-snapshot': snapshot, afspraken }))));
  assert.ok(p.items.some(i => i.id === 't9'), 'de planner ziet het niet-toegewezen ticket wel');
});

test('planning_lezen: zonder momentopname enkel afspraken + waarschuwing; foute periode -> isError', async () => {
  const blobs = basisBlobs();
  delete blobs['tickets-snapshot'];
  const p = data(await roep(PLANNER, 'planning_lezen', { van: '2026-11-12', tot: '2026-11-12' }, bron(blobs)));
  assert.deepEqual(p.items.map(i => i.id), ['a2', 'a1']);
  assert.match(p.waarschuwing, /ticket/i);
  for (const args of [{ van: '12/11/2026' }, { van: '2026-11-20', tot: '2026-11-10' }, { van: '2026-01-01', tot: '2027-12-31' }]) {
    assert.equal((await roep(PLANNER, 'planning_lezen', args)).result.isError, true, JSON.stringify(args));
  }
});

test('planning_lezen: zonder periode vanaf vandaag (Brussel) twee weken', async () => {
  const p = data(await roep(PLANNER, 'planning_lezen'));
  assert.equal(p.van, '2026-11-10');
  assert.equal(p.tot, '2026-11-23');
  assert.ok(p.items.every(i => i.datum >= '2026-11-10' && i.datum <= '2026-11-23'));
});

test('gereedschapfout (store gooit) -> isError met vaste tekst, geen details', async () => {
  const b = bron();
  b.store.get = async () => { throw new Error('geheime blobsdetail'); };
  for (const naam of ['rapporten_zoeken', 'tickets_open', 'planning_lezen']) {
    const r = await roep(PLANNER, naam, { van: '2026-11-12', tot: '2026-11-13' }, b);
    assert.equal(r.result.isError, true, naam);
    assert.ok(!r.result.content[0].text.includes('geheime'), naam);
  }
});

// ---------- endpoint /api/mcp ----------

async function opzetEndpoint() {
  const gebruikers = [
    { ...PLANNER, email: 'an@b.be', actief: true, sessieVersie: 1, wachtwoordHash: 'x' },
    { ...TECH, email: 'jan@b.be', actief: true, sessieVersie: 1, wachtwoordHash: 'x' },
    { ...SALES, email: 'sam@b.be', actief: true, sessieVersie: 1, wachtwoordHash: 'x' },
  ];
  const store = maakNepStore({ gebruikers: { versie: 1, gebruikers }, ...basisBlobs() });
  const c = await registreerClient(store, { redirect_uris: [REDIRECT], client_name: 'Claude' });
  const tokens = {};
  for (const g of gebruikers) {
    const code = await maakCode(store, { clientId: c.client_id, redirectUri: REDIRECT, codeChallenge: CHALLENGE, uid: g.id, sessieVersie: 1 }, T0);
    tokens[g.rol] = (await wisselCode(store, { code, clientId: c.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER }, T0 + 1000)).access_token;
  }
  store._schrijfacties.length = 0;
  // Meer dan 5 minuten na de toekenning: vereisMcpGebruiker schrijft dan echt laatstGebruikt (mcp-gebruikt-*).
  const h = maakHandler({ getStore: async () => store, nu: () => T0 + 10 * 60 * 1000 });
  return { store, tokens, h };
}

const post = (h, body, { token, headers = {} } = {}) => h(new Request(`${ORIGIN}/api/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), {});

test('config: pad /api/mcp', () => {
  assert.deepEqual(config, { path: '/api/mcp' });
});

test('standaard-export (beveiligV2-rij open): OPTIONS 204, GET 405, POST zonder token 401 met WWW-Authenticate', async () => {
  const o = await mcpStandaard(new Request(`${ORIGIN}/api/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://claude.ai' } }), {});
  assert.equal(o.status, 204);
  assert.equal(o.headers.get('access-control-allow-origin'), 'https://claude.ai');
  assert.equal((await mcpStandaard(new Request(`${ORIGIN}/api/mcp`), {})).status, 405);
  const p = await post(mcpStandaard, rpc('tools/list'));
  assert.equal(p.status, 401);
  assert.equal(p.headers.get('www-authenticate'), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
});

test('endpoint: geen of ongeldige token -> 401 met WWW-Authenticate resource_metadata', async () => {
  const { h } = await opzetEndpoint();
  for (const token of [undefined, 'onbekend']) {
    const r = await post(h, rpc('tools/list'), { token });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('www-authenticate'), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  }
  // Ook met onleesbare body: eerst de token.
  assert.equal((await post(h, '{kapot')).status, 401);
});

test('endpoint: GET -> 405, OPTIONS -> 204 met CORS voor claude.ai', async () => {
  const { h, tokens } = await opzetEndpoint();
  const g = await h(new Request(`${ORIGIN}/api/mcp`, { headers: { Authorization: `Bearer ${tokens.planner}` } }), {});
  assert.equal(g.status, 405);
  const o = await h(new Request(`${ORIGIN}/api/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://claude.ai' } }), {});
  assert.equal(o.status, 204);
  assert.equal(o.headers.get('access-control-allow-origin'), 'https://claude.ai');
  const kop = o.headers.get('access-control-allow-headers');
  for (const k of ['Authorization', 'Content-Type', 'Mcp-Protocol-Version']) assert.ok(kop.includes(k), k);
  assert.match(o.headers.get('access-control-allow-methods'), /POST/);
});

test('endpoint: initialize -> 200 JSON zonder sessie-ID; notificatie -> 202 zonder body', async () => {
  const { h, tokens } = await opzetEndpoint();
  const r = await post(h, rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } }), { token: tokens.planner });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal(r.headers.get('mcp-session-id'), null);
  assert.equal((await r.json()).result.protocolVersion, '2025-06-18');
  const n = await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' }, { token: tokens.planner });
  assert.equal(n.status, 202);
  assert.equal(await n.text(), '');
});

test('endpoint: ongeldige JSON -> -32700; batch -> elk element apart', async () => {
  const { h, tokens } = await opzetEndpoint();
  const r = await post(h, '{kapot', { token: tokens.planner });
  assert.equal(r.status, 400);
  const b = await r.json();
  assert.equal(b.error.code, -32700);
  assert.equal(b.id, null);
  const batch = await post(h, [rpc('ping', undefined, 1), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc('tools/list', undefined, 2)], { token: tokens.planner });
  assert.equal(batch.status, 200);
  const lijst = await batch.json();
  assert.deepEqual(lijst.map(x => x.id), [1, 2]);
  assert.equal(lijst[1].result.tools.length, 6);
  const enkelNotif = await post(h, [{ jsonrpc: '2.0', method: 'notifications/initialized' }], { token: tokens.planner });
  assert.equal(enkelNotif.status, 202);
  const leeg = await post(h, [], { token: tokens.planner });
  assert.equal((await leeg.json()).error.code, -32600);
});

test('endpoint: rol uit de token (technieker telt enkel eigen, sales krijgt geen gereedschappen)', async () => {
  const { h, tokens } = await opzetEndpoint();
  const t = await (await post(h, rpc('tools/call', { name: 'rapporten_tellen', arguments: { groepeer: 'serienummer' } }), { token: tokens.technieker })).json();
  assert.deepEqual(t.result.structuredContent.groepen, [{ sleutel: '2201-AB', aantal: 3 }]);
  const s = await (await post(h, rpc('tools/list'), { token: tokens.sales })).json();
  assert.deepEqual(s.result.tools, []);
  const sc = await (await post(h, rpc('tools/call', { name: 'rapporten_zoeken', arguments: {} }), { token: tokens.sales })).json();
  assert.equal(sc.error.code, -32601);
});

test('endpoint: tools/call schrijft niets behalve de eigen mcp-*-blobs', async () => {
  const { h, tokens, store } = await opzetEndpoint();
  const oproepen = [
    ['rapporten_zoeken', {}], ['rapport_lezen', { id: 'j1' }], ['rapporten_tellen', { groepeer: 'oorzaak' }],
    ['paal_historiek', { serienummer: '2201-AB' }], ['tickets_open', {}], ['planning_lezen', { van: '2026-11-01', tot: '2026-11-30' }],
  ];
  for (const rol of ['planner', 'technieker']) {
    for (const [name, args] of oproepen) {
      const r = await post(h, rpc('tools/call', { name, arguments: args }), { token: tokens[rol] });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).result.isError, undefined, `${rol} ${name}`);
    }
  }
  assert.ok(store._schrijfacties.length > 0, 'laatstGebruikt hoort geschreven te zijn (spy werkt)');
  const vreemd = store._schrijfacties.filter(s => !s.key.startsWith('mcp-'));
  assert.deepEqual(vreemd, []);
});

// ---------- batch: grens en één lezing van de rapporten per verzoek (I4) ----------

test('endpoint: batch van 6 berichten -> -32600, batch van 5 wordt verwerkt', async () => {
  const { h, tokens } = await opzetEndpoint();
  const zes = await post(h, [1, 2, 3, 4, 5, 6].map(i => rpc('ping', undefined, i)), { token: tokens.planner });
  assert.equal(zes.status, 400);
  assert.equal((await zes.json()).error.code, -32600);
  const vijf = await post(h, [1, 2, 3, 4, 5].map(i => rpc('ping', undefined, i)), { token: tokens.planner });
  assert.equal(vijf.status, 200);
  assert.equal((await vijf.json()).length, 5);
});

test('endpoint: een batch van 5 rapportgereedschappen leest de rapportlijst en elk jaararchief maar één keer', async () => {
  const { h, tokens, store } = await opzetEndpoint();
  await store.setJSON('rapportlijst-archief-2025', { versie: 1, rapports: [rap('oud1', 'Jan Peeters', { datum: '2025-06-01' })] });
  const gelezen = [];
  const get = store.get.bind(store);
  store.get = async (key, o) => { gelezen.push(key); return get(key, o); };
  const batch = [
    rpc('tools/call', { name: 'rapporten_zoeken', arguments: {} }, 1),
    rpc('tools/call', { name: 'rapport_lezen', arguments: { id: 'oud1' } }, 2),
    rpc('tools/call', { name: 'rapporten_tellen', arguments: { groepeer: 'oorzaak' } }, 3),
    rpc('tools/call', { name: 'paal_historiek', arguments: { serienummer: '2201-AB' } }, 4),
    rpc('tools/call', { name: 'rapporten_zoeken', arguments: { van: '2025-01-01', tot: '2025-12-31' } }, 5),
  ];
  const r = await post(h, batch, { token: tokens.planner });
  assert.equal(r.status, 200);
  const lijst = await r.json();
  assert.equal(lijst.length, 5);
  for (const x of lijst) assert.equal(x.result.isError, undefined, JSON.stringify(x));
  assert.equal(lijst[1].result.structuredContent.rapport.id, 'oud1');
  assert.equal(gelezen.filter(k => k === 'rapportlijst').length, 1);
  assert.equal(gelezen.filter(k => k === 'rapportlijst-archief-2025').length, 1);
  assert.equal(gelezen.filter(k => k === 'rapportlijst-archief-2026').length, 1);

  // Een volgend verzoek leest opnieuw (geen cache over verzoeken heen).
  await post(h, rpc('tools/call', { name: 'rapporten_zoeken', arguments: {} }), { token: tokens.planner });
  assert.equal(gelezen.filter(k => k === 'rapportlijst').length, 2);
});

test('rapporten_zoeken filtert op probleemtype en garantieStatus; rapporten_tellen groepeert, oude rapporten (onbekend)', async () => {
  const lijst = [
    rap('x1', 'Jan Peeters', { probleemtype: 'Laadt niet', garantieStatus: 'Binnen garantie' }),
    rap('x2', 'Jan Peeters', { probleemtype: 'Display' }),
    rap('x3', 'Jan Peeters'),
  ];
  const b = bron(basisBlobs({ rapportlijst: { versie: 1, rapports: lijst } }));
  const z = data(await roep(PLANNER, 'rapporten_zoeken', { probleemtype: 'laadt niet' }, b));
  assert.deepEqual(z.resultaten.map(x => x.id), ['x1']);
  assert.equal(z.resultaten[0].garantieStatus, 'Binnen garantie');
  const z2 = data(await roep(PLANNER, 'rapporten_zoeken', { garantieStatus: 'binnen garantie' }, b));
  assert.deepEqual(z2.resultaten.map(x => x.id), ['x1']);
  const t = data(await roep(PLANNER, 'rapporten_tellen', { groepeer: 'probleemtype' }, b));
  assert.deepEqual(t.groepen, [{ sleutel: '(onbekend)', aantal: 1 }, { sleutel: 'Display', aantal: 1 }, { sleutel: 'Laadt niet', aantal: 1 }]);
  const g = data(await roep(PLANNER, 'rapporten_tellen', { groepeer: 'garantieStatus' }, b));
  assert.deepEqual(g.groepen, [{ sleutel: '(onbekend)', aantal: 2 }, { sleutel: 'Binnen garantie', aantal: 1 }]);
});
