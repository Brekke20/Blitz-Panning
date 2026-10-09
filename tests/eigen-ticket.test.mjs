// tests/eigen-ticket.test.mjs — netlify/lib/eigen-ticket.js: een technieker met "Mag zelf plannen" plant enkel zijn eigen tickets
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { eisEigenTicket } from '../netlify/lib/eigen-ticket.js';

const tim = { id: 'u-tim', rol: 'technieker', zohoNaam: 'Tim Janssens', magZelfPlannen: true };
const res = (status, body) => new Response(JSON.stringify(body ?? {}), { status });

// Nep-Zoho: tickets en agenten per id; onthoudt de aanroepen.
function nepZoho({ tickets = {}, agenten = {}, stuk } = {}) {
  const aanroepen = [];
  return {
    aanroepen,
    haalToegang: async () => { aanroepen.push('toegang'); if (stuk === 'toegang') throw new Error('x'); return { token: 'T', orgId: 'O' }; },
    verzoek: async (pad) => {
      aanroepen.push(pad);
      if (stuk === 'netwerk') throw new Error('netwerk');
      const t = pad.match(/^\/tickets\/(.+)$/);
      if (t) return tickets[t[1]] ? res(200, tickets[t[1]]) : res(stuk === '500' ? 500 : 404);
      const a = pad.match(/^\/agents\/(.+)$/);
      if (a) return agenten[a[1]] ? res(200, agenten[a[1]]) : res(404);
      return res(404);
    },
  };
}
const AGENTEN = { A1: { id: 'A1', name: 'Tim Janssens' }, A2: { id: 'A2', firstName: 'Roel', lastName: 'Peeters' } };

test('beheerder en planner: altijd ok, Zoho wordt niet aangeroepen', async () => {
  for (const rol of ['beheerder', 'planner']) {
    const zoho = nepZoho();
    assert.deepEqual(await eisEigenTicket({ gebruiker: { rol }, ticketId: '1', zoho }), { ok: true });
    assert.deepEqual(zoho.aanroepen, []);
  }
});

test('technieker met het vinkje: een ticket op zijn naam mag, het ticket van een collega niet (403)', async () => {
  const zoho = nepZoho({ tickets: { 11: { assigneeId: 'A1' }, 12: { assigneeId: 'A2' } }, agenten: AGENTEN });
  assert.deepEqual(await eisEigenTicket({ gebruiker: tim, ticketId: '11', zoho }), { ok: true });
  const collega = await eisEigenTicket({ gebruiker: tim, ticketId: '12', zoho });
  assert.equal(collega.ok, false);
  assert.equal(collega.status, 403);
  assert.equal(collega.body.code, 'geen-recht');
});

test('de naam wordt genormaliseerd vergeleken (hoofdletters, spaties); een agent met enkel voor- en achternaam telt ook', async () => {
  const zoho = nepZoho({ tickets: { 11: { assigneeId: 'A1' }, 12: { assigneeId: 'A2' } }, agenten: AGENTEN });
  assert.equal((await eisEigenTicket({ gebruiker: { ...tim, zohoNaam: ' tim   JANSSENS ' }, ticketId: '11', zoho })).ok, true);
  assert.equal((await eisEigenTicket({ gebruiker: { ...tim, zohoNaam: 'roel peeters' }, ticketId: '12', zoho })).ok, true);
});

test('zonder vinkje, met een niet-boolean of zonder zohoNaam: 403 zonder Zoho-aanroep', async () => {
  for (const g of [{ ...tim, magZelfPlannen: false }, { ...tim, magZelfPlannen: undefined }, { ...tim, magZelfPlannen: 'ja' }, { ...tim, zohoNaam: '' }, { ...tim, zohoNaam: undefined }]) {
    const zoho = nepZoho({ tickets: { 11: { assigneeId: 'A1' } }, agenten: AGENTEN });
    const r = await eisEigenTicket({ gebruiker: g, ticketId: '11', zoho });
    assert.equal(r.status, 403, JSON.stringify(g));
    assert.deepEqual(zoho.aanroepen, []);
  }
});

test('een ticket zonder toegewezen agent, of een agent zonder naam, is niet van hem', async () => {
  const zoho = nepZoho({ tickets: { 11: {}, 12: { assigneeId: null }, 13: { assigneeId: 'A9' } }, agenten: { ...AGENTEN, A9: { id: 'A9' } } });
  for (const id of ['11', '12', '13']) assert.equal((await eisEigenTicket({ gebruiker: tim, ticketId: id, zoho })).status, 403, id);
});

test('Zoho-fouten: onbekend ticket 404, een andere fout of netwerkfout 503 zoho-storing; nooit ok', async () => {
  const onbekend = await eisEigenTicket({ gebruiker: tim, ticketId: '99', zoho: nepZoho({ agenten: AGENTEN }) });
  assert.equal(onbekend.status, 404);
  const stuk = await eisEigenTicket({ gebruiker: tim, ticketId: '99', zoho: nepZoho({ stuk: '500' }) });
  assert.equal(stuk.status, 503);
  assert.equal(stuk.body.code, 'zoho-storing');
  for (const stuk2 of ['netwerk', 'toegang']) {
    const r = await eisEigenTicket({ gebruiker: tim, ticketId: '11', zoho: nepZoho({ tickets: { 11: { assigneeId: 'A1' } }, agenten: AGENTEN, stuk: stuk2 }) });
    assert.equal(r.ok, false, stuk2);
    assert.equal(r.status, 503, stuk2);
  }
  // de agent is onbekend/onbereikbaar: niet doorlaten
  const r = await eisEigenTicket({ gebruiker: tim, ticketId: '11', zoho: nepZoho({ tickets: { 11: { assigneeId: 'A5' } }, agenten: AGENTEN }) });
  assert.equal(r.status, 503);
});

test('een al opgehaald ticket en al gevraagde toegang worden hergebruikt (geen dubbele aanroepen)', async () => {
  const zoho = nepZoho({ agenten: AGENTEN });
  const r = await eisEigenTicket({ gebruiker: tim, ticketId: '11', zoho, toegang: { token: 'T', orgId: 'O' }, ticket: { assigneeId: 'A1' } });
  assert.equal(r.ok, true);
  assert.deepEqual(zoho.aanroepen, ['/agents/A1']);
});
