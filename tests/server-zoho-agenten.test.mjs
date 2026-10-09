// tests/server-zoho-agenten.test.mjs — /api/zoho-agenten: de actieve Zoho-agenten (enkel namen) voor de keuzelijst Zoho-naam in Beheer.
// Nooit echt Zoho: elk uitgaand verzoek loopt via de nep-fetch.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakAuth } from '../netlify/lib/auth.js';
import { maakZoho } from '../netlify/lib/zoho.js';
import { agentNaam } from '../netlify/lib/zoho-agenten.js';
import { maakHandler } from '../netlify/functions/zoho-agenten.js';
import { TESTGEBRUIKERS } from '../netlify/lib/lokale-dev.js';
import { maakNepFetch } from './nep-fetch.mjs';

const DESK = 'https://desk.zoho.eu/api/v1';
const ENV = { ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const AGENTEN = { data: [{ id: 'A1', name: 'Tim Janssens' }, { id: 'A2', firstName: 'Roel', lastName: 'Peeters' }, { id: 'A3' }, { id: 'A4', name: 'Anouk' }] };

function opzet({ router, rol = 'beheerder', nu = () => 1000 } = {}) {
  const { fn, calls } = maakNepFetch(router ?? ((url) => (url.includes('/agents') ? json(AGENTEN) : undefined)));
  const zoho = maakZoho({ fetch: fn, env: ENV });
  const auth = maakAuth({ vasteGebruiker: { ...TESTGEBRUIKERS[`test-${rol}`] }, env: {} });
  const handler = maakHandler({ zoho, nu, auth });
  return { handler, calls, nu };
}
const aanvraag = (methode = 'GET', headers = {}) => new Request('http://localhost/api/zoho-agenten', { method: methode, headers: { 'x-blitz': '1', ...headers } });
const agentenCalls = calls => calls.filter(c => c.url.includes('/agents'));

test('agentNaam: dezelfde naam als de ticketlijst (name, anders voor- en achternaam, anders leeg)', () => {
  assert.equal(agentNaam({ name: 'Tim Janssens', firstName: 'x' }), 'Tim Janssens');
  assert.equal(agentNaam({ firstName: 'Roel', lastName: 'Peeters' }), 'Roel Peeters');
  assert.equal(agentNaam({ firstName: 'Roel' }), 'Roel');
  assert.equal(agentNaam({ id: 'A3' }), '');
  assert.equal(agentNaam(null), '');
});

test('beheerder: enkel { naam } van de actieve agenten, gesorteerd, zonder lege namen, met status=ACTIVE en limit=100', async () => {
  const o = opzet();
  const res = await o.handler(aanvraag());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { agenten: [{ naam: 'Anouk' }, { naam: 'Roel Peeters' }, { naam: 'Tim Janssens' }] });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const a = agentenCalls(o.calls);
  assert.equal(a.length, 1);
  assert.equal(a[0].url, `${DESK}/agents?status=ACTIVE&limit=100&from=0`);
  assert.equal(a[0].method, 'GET'); // enkel lezen
  assert.deepEqual(a[0].headers, { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' });
});

test('meer dan 100 agenten: volgende pagina tot er een kortere pagina komt; namen worden ontdubbeld', async () => {
  const pagina = (van, n) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `a${van + i}`, name: `Agent ${String(van + i).padStart(3, '0')}` })) });
  const o = opzet({ router: (url) => {
    if (url.endsWith('from=0')) return json(pagina(0, 100));
    if (url.endsWith('from=100')) return json({ data: [...pagina(100, 5).data, { id: 'x', name: 'Agent 000' }] });
    return undefined;
  } });
  const res = await o.handler(aanvraag());
  const { agenten } = await res.json();
  assert.equal(agenten.length, 105);
  assert.equal(agentenCalls(o.calls).length, 2);
});

test('cache: de tweede aanroep binnen 10 minuten gebruikt Zoho niet opnieuw; erna wel', async () => {
  let nu = 1000;
  const o = opzet({ nu: () => nu });
  await o.handler(aanvraag());
  nu += 9 * 60 * 1000;
  const tweede = await o.handler(aanvraag());
  assert.equal((await tweede.json()).agenten.length, 3);
  assert.equal(agentenCalls(o.calls).length, 1);
  nu += 2 * 60 * 1000;
  await o.handler(aanvraag());
  assert.equal(agentenCalls(o.calls).length, 2);
});

test('Zoho-fout: 503 zoho-storing, geen cache van de fout; een oude geslaagde lijst blijft bruikbaar na een latere fout niet nodig (geen verouderde namen)', async () => {
  let stuk = true;
  const o = opzet({ router: (url) => (url.includes('/agents') ? (stuk ? json({ message: 'boem' }, 500) : json(AGENTEN)) : undefined) });
  const res = await o.handler(aanvraag());
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'zoho-storing');
  assert.ok(!JSON.stringify(body).includes('boem')); // geen interne Zoho-details naar de browser
  stuk = false;
  const weer = await o.handler(aanvraag());
  assert.equal(weer.status, 200); // een fout wordt niet bewaard
});

test('netwerkfout of een token dat niet lukt: 503 zoho-storing', async () => {
  const o = opzet({ router: (url) => { if (url.includes('oauth')) throw new Error('netwerk'); return undefined; } });
  const res = await o.handler(aanvraag());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'zoho-storing');
});

test('testverzoek (X-Blitz-Test): vaste nep-lijst en NOOIT een Zoho-aanroep', async () => {
  const o = opzet({ router: () => { throw new Error('Zoho mag niet aangeroepen worden'); } });
  const res = await o.handler(aanvraag('GET', { 'x-blitz-test': '1' }));
  assert.equal(res.status, 200);
  const { agenten } = await res.json();
  assert.ok(agenten.length >= 2);
  assert.ok(agenten.every(a => typeof a.naam === 'string' && a.naam));
  assert.equal(o.calls.length, 0);
});

test('rechten: planner, technieker en sales krijgen 403 en Zoho wordt niet aangeroepen; andere methoden 405', async () => {
  for (const rol of ['planner', 'technieker', 'sales']) {
    const o = opzet({ rol });
    const res = await o.handler(aanvraag());
    assert.equal(res.status, 403, rol);
    assert.equal(o.calls.length, 0, rol);
  }
  const o = opzet();
  for (const methode of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await o.handler(aanvraag(methode))).status, 405, methode);
  }
  assert.equal(o.calls.length, 0);
});
