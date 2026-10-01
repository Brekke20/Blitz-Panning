// Karakterisering van tickets, planning-sinds en planning-export (etappe 6, taak 3).
// Elke test controleert de VOLLEDIGE lijst uitgaande aanroepen en het volledige antwoord
// (een onbekende URL geeft stil 404 {}). Nooit echte netwerkaanroepen.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';

const NU = Date.parse('2026-10-01T10:00:00.000Z');
const CORS_V1 = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const CORS_V2 = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Blitz-Test',
  'content-type': 'application/json',
};
const DESK = 'https://desk.zoho.eu/api/v1';
const TOKEN_CALL = {
  method: 'POST',
  url: 'https://accounts.zoho.eu/oauth/v2/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'refresh_token=RT&client_id=CID&client_secret=SEC&grant_type=refresh_token',
};
const ORG_CALL = { method: 'GET', url: `${DESK}/organizations`, headers: { Authorization: 'Zoho-oauthtoken TOK' }, body: undefined };
const H = { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' };
const get = (pad, headers = H) => ({ method: 'GET', url: DESK + pad, headers, body: undefined });

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const uit = calls => calls.map(c => ({ method: c.method, url: c.url, headers: c.headers, body: c.body }));
const ontleed = res => ({ status: res.statusCode, headers: { ...res.headers }, body: JSON.parse(res.body) });
const NETWERKFOUT = () => { throw new Error('netwerk'); };
const tick = () => new Promise(r => setImmediate(r));

let herstelEnv;
test.beforeEach(() => {
  herstelEnv = zetEnv({
    ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC',
    PLANNING_EXPORT_API_KEY: 'SLEUTEL',
  });
  mock.timers.enable({ apis: ['Date'], now: NU });
});
test.afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  herstelEnv();
});

// ======================= tickets =======================
async function draaiTickets(event, router) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers('tickets');
  const res = await metGlobaleFetch(fn, () => mod.handler(event));
  return { res, calls: uit(calls), mod, fn };
}

const AGENTS = { data: [{ id: 'A1', name: 'Jan' }, { id: 'A2', firstName: 'Piet', lastName: 'Pols' }, { id: 'A3' }] };

function ticketsRouter({ paginas, details, agents = AGENTS }) {
  return (url) => {
    if (url === `${DESK}/agents?limit=50`) return json(agents);
    const p = url.match(/\/tickets\?limit=100&from=(\d+)$/);
    if (p) return json({ data: paginas[Number(p[1]) / 100] || [] });
    const d = url.match(/\/tickets\/(\w+)$/);
    if (d) return details[d[1]] ? json(details[d[1]]) : json({}, 404);
    return undefined;
  };
}

const DETAILS = {
  1: {
    id: '1', ticketNumber: '101', subject: 'Laadpaal stuk', status: 'Service in te plannen', priority: 'High',
    assigneeId: 'A1', createdTime: '2026-09-01T08:00:00.000Z',
    contact: { name: 'Klant Een', email: 'een@x.be', phone: '011' },
    account: { name: 'Bedrijf' },
    cf: {
      cf_adres: 'Straat 1, Gent', cf_naam_eindklant: 'Eind', cf_e_mail_eindklant: 'e@e.be', cf_telefoon_eindklant: '022',
      cf_serienummer: 'SN1', cf_partner_installateur: 'Partner', cf_e_mail_installateur: 'i@i.be',
      cf_probleemtype: 'Hardware', cf_regio: 'Oost', cf_interventie_datm: '2026-10-02T08:00:00.000Z',
      cf_garantie_status: 'Ja', cf_installateur_al_langs_geweest: 'Nee',
    },
  },
  2: {
    id: '2', ticketNumber: '102', status: 'Wachten op bevestiging planning', assigneeId: 'A2',
    contact: { firstName: 'Piet', lastName: 'Pols', emailId: 'p@x.be', mobile: '0477' },
    account: { accountName: 'Acc' }, email: 'ignored@x.be',
    cf: { cf_adres_eindklant: 'Laan 2', cf_regio: '-Geen-' },
  },
  3: {
    id: '3', ticketNumber: '103', status: 'Geplande service', assigneeId: 'ONBEKEND', email: 'top@x.be', phone: '099',
    contact: { fullName: 'Vol Naam', firstName: 'Enkel' },
    cf: { cf_extra_adres_veld: 'Zijstraat 3', cf_regio: 'West' },
  },
  5: { id: '5', ticketNumber: '105', status: 'Wachten op planning', contact: { firstName: 'Z' }, cf: {} },
  6: { id: '6', ticketNumber: '106', status: 'Geplande support' },
};

const MAP_1 = {
  id: '1', number: '101', subject: 'Laadpaal stuk', status: 'Service in te plannen', priority: 'High', assignee: 'Jan',
  contact: 'Klant Een', email: 'een@x.be', phone: '011', account: 'Bedrijf', address: 'Straat 1, Gent', hasAddress: true,
  naamEindklant: 'Eind', emailEindklant: 'e@e.be', telefoonEindklant: '022', serienummer: 'SN1', partner: 'Partner',
  emailInstallateur: 'i@i.be', probleemtype: 'Hardware', regio: 'Oost', interventieDatum: '2026-10-02T08:00:00.000Z',
  garantieStatus: 'Ja', installateurAlLangsGeweest: 'Nee', createdTime: '2026-09-01T08:00:00.000Z',
};
const MAP_2 = {
  id: '2', number: '102', subject: '', status: 'Wachten op bevestiging planning', priority: '', assignee: 'Piet Pols',
  contact: 'Piet Pols', email: 'p@x.be', phone: '0477', account: 'Acc', address: 'Laan 2', hasAddress: true,
  naamEindklant: '', emailEindklant: '', telefoonEindklant: '', serienummer: '', partner: '', emailInstallateur: '',
  probleemtype: '', regio: '', interventieDatum: null, garantieStatus: '', installateurAlLangsGeweest: '', createdTime: null,
};
const MAP_3 = {
  id: '3', number: '103', subject: '', status: 'Geplande service', priority: '', assignee: '',
  contact: 'Vol Naam', email: 'top@x.be', phone: '099', account: '', address: 'Zijstraat 3', hasAddress: true,
  naamEindklant: '', emailEindklant: '', telefoonEindklant: '', serienummer: '', partner: '', emailInstallateur: '',
  probleemtype: '', regio: 'West', interventieDatum: null, garantieStatus: '', installateurAlLangsGeweest: '', createdTime: null,
};
const MAP_5 = {
  id: '5', number: '105', subject: '', status: 'Wachten op planning', priority: '', assignee: '',
  contact: 'Z', email: '', phone: '', account: '', address: '', hasAddress: false,
  naamEindklant: '', emailEindklant: '', telefoonEindklant: '', serienummer: '', partner: '', emailInstallateur: '',
  probleemtype: '', regio: '', interventieDatum: null, garantieStatus: '', installateurAlLangsGeweest: '', createdTime: null,
};
const MAP_6 = { ...MAP_5, id: '6', number: '106', status: 'Geplande support', contact: '' };

const lijst = (n, status, start = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: String(start + i + 1000), status }));

test('tickets: succes, volledige aanroepenreeks en mapTicket-vorm', async () => {
  const pagina = [
    { id: '1', status: 'Service in te plannen' }, { id: '2', status: 'Wachten op bevestiging planning' },
    { id: '3', status: 'Geplande service' }, { id: '4', status: 'Gesloten' },
    { id: '5', status: 'Wachten op planning' }, { id: '6', status: 'Geplande support' },
  ];
  const { res, calls } = await draaiTickets(v1Event('GET'), ticketsRouter({ paginas: [pagina], details: DETAILS }));
  assert.deepEqual(calls, [
    TOKEN_CALL, ORG_CALL,
    get('/agents?limit=50'), get('/tickets?limit=100&from=0'),
    get('/tickets/1'), get('/tickets/2'), get('/tickets/3'), get('/tickets/5'), get('/tickets/6'),
  ]);
  assert.deepEqual(ontleed(res), {
    status: 200, headers: CORS_V1,
    body: { tickets: [MAP_1, MAP_5], pendingTickets: [MAP_2], plannedTickets: [MAP_3, MAP_6] },
  });
});

test('tickets: OPTIONS wordt niet speciaal behandeld en loopt gewoon door naar Zoho', async () => {
  const { res, calls } = await draaiTickets(v1Event('OPTIONS'), ticketsRouter({ paginas: [[]], details: {} }));
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, get('/agents?limit=50'), get('/tickets?limit=100&from=0')]);
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS_V1, body: { tickets: [], pendingTickets: [], plannedTickets: [] } });
});

test('tickets: ook een POST (geen methodecontrole) loopt door naar Zoho', async () => {
  const { res, calls } = await draaiTickets(v1Event('POST', {}), ticketsRouter({ paginas: [[]], details: {} }));
  assert.equal(calls.length, 4);
  assert.equal(res.statusCode, 200);
});

test('tickets: paginering stopt na twee opeenvolgende pagina\'s zonder relevante tickets', async () => {
  const { res, calls } = await draaiTickets(v1Event('GET'), ticketsRouter({
    paginas: [lijst(100, 'Gesloten'), lijst(100, 'Gesloten', 100), lijst(100, 'Gesloten', 200)], details: {},
  }));
  assert.deepEqual(calls, [
    TOKEN_CALL, ORG_CALL, get('/agents?limit=50'),
    get('/tickets?limit=100&from=0'), get('/tickets?limit=100&from=100'),
  ]);
  assert.deepEqual(ontleed(res).body, { tickets: [], pendingTickets: [], plannedTickets: [] });
});

test('tickets: een relevante pagina zet de lege-teller terug en een kortere pagina is de laatste', async () => {
  const p0 = lijst(100, 'Gesloten');
  const p1 = [{ id: '1', status: 'Service in te plannen' }, ...lijst(99, 'Gesloten', 100)];
  const p2 = lijst(100, 'Gesloten', 200);
  const p3 = [{ id: '2', status: 'Wachten op bevestiging planning' }];
  const { res, calls } = await draaiTickets(v1Event('GET'), ticketsRouter({ paginas: [p0, p1, p2, p3], details: DETAILS }));
  assert.deepEqual(calls, [
    TOKEN_CALL, ORG_CALL, get('/agents?limit=50'),
    get('/tickets?limit=100&from=0'), get('/tickets?limit=100&from=100'),
    get('/tickets?limit=100&from=200'), get('/tickets?limit=100&from=300'),
    get('/tickets/1'), get('/tickets/2'),
  ]);
  assert.deepEqual(ontleed(res).body, { tickets: [MAP_1], pendingTickets: [MAP_2], plannedTickets: [] });
});

test('tickets: maximaal 6 pagina\'s (600 tickets), ook bij steeds volle relevante pagina\'s', async () => {
  const paginas = Array.from({ length: 8 }, (_, i) => lijst(100, 'Gesloten', i * 100).map((t, k) => (k === 0 ? { ...t, status: 'Geplande service' } : t)));
  const { calls } = await draaiTickets(v1Event('GET'), ticketsRouter({ paginas, details: {} }));
  const pagCalls = calls.filter(c => c.url.includes('/tickets?limit=100'));
  assert.deepEqual(pagCalls.map(c => c.url.split('from=')[1]), ['0', '100', '200', '300', '400', '500']);
});

test('tickets: detailaanvragen in batches van vijf', async () => {
  const pagina = Array.from({ length: 7 }, (_, i) => ({ id: String(i + 10), status: 'Geplande service' }));
  let bezig = 0; let max = 0; const afgerond = [];
  const basis = ticketsRouter({ paginas: [pagina], details: {} });
  const router = async (url) => {
    const d = url.match(/\/tickets\/(\d+)$/);
    if (!d) return basis(url);
    bezig++; max = Math.max(max, bezig);
    await tick();
    bezig--; afgerond.push(d[1]);
    return json({ id: d[1], status: 'Geplande service' });
  };
  const { res, calls } = await draaiTickets(v1Event('GET'), router);
  assert.equal(max, 5);
  assert.deepEqual(calls.slice(4).map(c => c.url), [10, 11, 12, 13, 14, 15, 16].map(i => `${DESK}/tickets/${i}`));
  assert.deepEqual(afgerond, ['10', '11', '12', '13', '14', '15', '16']);
  assert.deepEqual(ontleed(res).body.plannedTickets.map(t => t.id), ['10', '11', '12', '13', '14', '15', '16']);
});

test('tickets: een falende agents-aanvraag (JSON-fout) stopt niets; assignee blijft leeg', async () => {
  const pagina = [{ id: '1', status: 'Service in te plannen' }];
  const { res, calls } = await draaiTickets(v1Event('GET'), (url) => {
    if (url.endsWith('/agents?limit=50')) return json({ errorCode: 'X' }, 500);
    return ticketsRouter({ paginas: [pagina], details: DETAILS })(url);
  });
  assert.equal(calls.length, 5);
  assert.equal(ontleed(res).body.tickets[0].assignee, '');
});

test('tickets: paginafout geeft 500 met status en foutbody', async () => {
  const { res, calls } = await draaiTickets(v1Event('GET'), (url) => {
    if (url.includes('/tickets?limit=100&from=0')) return json({ message: 'kapot' }, 500);
    return ticketsRouter({ paginas: [], details: {} })(url);
  });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, get('/agents?limit=50'), get('/tickets?limit=100&from=0')]);
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS_V1, body: { error: 'Zoho tickets-ophalen mislukt (500): {"message":"kapot"}' } });
});

test('tickets: paginafout met niet-JSON-body geeft {} in de foutmelding', async () => {
  const { res } = await draaiTickets(v1Event('GET'), (url) => {
    if (url.includes('/tickets?limit=100')) return new Response('<html>', { status: 502 });
    return ticketsRouter({ paginas: [], details: {} })(url);
  });
  assert.deepEqual(ontleed(res).body, { error: 'Zoho tickets-ophalen mislukt (502): {}' });
});

test('tickets: paginafout met lege body geeft {} in de foutmelding', async () => {
  const { res } = await draaiTickets(v1Event('GET'), (url) => {
    if (url.includes('/tickets?limit=100')) return new Response('', { status: 401 });
    return ticketsRouter({ paginas: [], details: {} })(url);
  });
  assert.deepEqual(ontleed(res).body, { error: 'Zoho tickets-ophalen mislukt (401): {}' });
});

test('tickets: pagina met ongeldige JSON op een 200 telt als lege pagina', async () => {
  const { res, calls } = await draaiTickets(v1Event('GET'), (url) => {
    if (url.includes('/tickets?limit=100')) return new Response('geen json', { status: 200 });
    return ticketsRouter({ paginas: [], details: {} })(url);
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(ontleed(res).body, { tickets: [], pendingTickets: [], plannedTickets: [] });
});

test('tickets: ticketdetail-fout geeft 500 en alle batchaanvragen zijn al verstuurd', async () => {
  const pagina = [{ id: '1', status: 'Service in te plannen' }, { id: '2', status: 'Geplande service' }, { id: '3', status: 'Geplande service' }];
  const { res, calls } = await draaiTickets(v1Event('GET'), (url) => {
    if (url.endsWith('/tickets/2')) return json({ errorCode: 'NOPE' }, 404);
    return ticketsRouter({ paginas: [pagina], details: DETAILS })(url);
  });
  assert.deepEqual(calls.slice(3), [get('/tickets?limit=100&from=0'), get('/tickets/1'), get('/tickets/2'), get('/tickets/3')].slice(0));
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS_V1, body: { error: 'Zoho ticketdetail 2 mislukt (404): {"errorCode":"NOPE"}' } });
});

test('tickets: ticketdetail met lege 200-body geeft een leeg ticket (status ontbreekt) en valt weg', async () => {
  const pagina = [{ id: '1', status: 'Service in te plannen' }];
  const { res } = await draaiTickets(v1Event('GET'), (url) => {
    if (url.endsWith('/tickets/1')) return new Response('', { status: 200 });
    return ticketsRouter({ paginas: [pagina], details: DETAILS })(url);
  });
  assert.deepEqual(ontleed(res).body, { tickets: [], pendingTickets: [], plannedTickets: [] });
});

test('tickets: tokenfout geeft 500 met de Zoho-data in de tekst en verder geen aanroepen', async () => {
  const { res, calls } = await draaiTickets(v1Event('GET'), (url) =>
    url.includes('oauth') ? json({ error: 'invalid_code' }) : undefined);
  assert.deepEqual(calls, [TOKEN_CALL]);
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS_V1, body: { error: 'Token refresh mislukt: {"error":"invalid_code"}' } });
});

test('tickets: orgfout gebruikt de tekst met "Desk"', async () => {
  const { res, calls } = await draaiTickets(v1Event('GET'), (url) =>
    url.endsWith('/organizations') ? json({ data: [] }) : undefined);
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS_V1, body: { error: 'Zoho Desk org ID niet gevonden' } });
});

test('tickets: netwerkfout op de tokenaanvraag geeft 500 met de foutmelding', async () => {
  const { res, calls } = await draaiTickets(v1Event('GET'), (url) => (url.includes('oauth') ? NETWERKFOUT() : undefined));
  assert.deepEqual(calls, [TOKEN_CALL]);
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS_V1, body: { error: 'netwerk' } });
});

test('tickets: netwerkfout op een paginaaanvraag geeft 500', async () => {
  const { res, calls } = await draaiTickets(v1Event('GET'), (url) => {
    if (url.includes('/tickets?limit=100')) return NETWERKFOUT();
    return ticketsRouter({ paginas: [], details: {} })(url);
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(ontleed(res).body, { error: 'netwerk' });
});

test('tickets: token wordt binnen één geladen module hergebruikt, het org-id niet', async () => {
  const { fn, calls } = maakNepFetch(ticketsRouter({ paginas: [[]], details: {} }));
  const mod = await laadVers('tickets');
  await metGlobaleFetch(fn, () => mod.handler(v1Event('GET')));
  await metGlobaleFetch(fn, () => mod.handler(v1Event('GET')));
  const u = uit(calls);
  assert.deepEqual(u.slice(0, 4), [TOKEN_CALL, ORG_CALL, get('/agents?limit=50'), get('/tickets?limit=100&from=0')]);
  assert.deepEqual(u.slice(4), [ORG_CALL, get('/agents?limit=50'), get('/tickets?limit=100&from=0')]);
});

test('tickets: token verloopt na 55 minuten', async () => {
  const { fn, calls } = maakNepFetch(ticketsRouter({ paginas: [[]], details: {} }));
  const mod = await laadVers('tickets');
  await metGlobaleFetch(fn, () => mod.handler(v1Event('GET')));
  mock.timers.setTime(NU + 55 * 60 * 1000 - 1);
  await metGlobaleFetch(fn, () => mod.handler(v1Event('GET')));
  assert.equal(calls.filter(c => c.url.includes('oauth')).length, 1);
  mock.timers.setTime(NU + 55 * 60 * 1000);
  await metGlobaleFetch(fn, () => mod.handler(v1Event('GET')));
  assert.equal(calls.filter(c => c.url.includes('oauth')).length, 2);
});

test('tickets: env wordt bij elke aanroep gelezen (token uit de dan geldende waarden)', async () => {
  herstelEnv();
  herstelEnv = zetEnv({ ZOHO_REFRESH_TOKEN: 'RT2', ZOHO_CLIENT_ID: 'C2', ZOHO_CLIENT_SECRET: 'S2' });
  const { calls } = await draaiTickets(v1Event('GET'), ticketsRouter({ paginas: [[]], details: {} }));
  assert.equal(calls[0].body, 'refresh_token=RT2&client_id=C2&client_secret=S2&grant_type=refresh_token');
});

// ======================= planning-sinds =======================
const ZSINDS_REQ = (body, { methode = 'POST', headers = {} } = {}) =>
  new Request('http://localhost/api/planning-sinds', {
    method: methode, headers,
    body: methode === 'GET' || methode === 'OPTIONS' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });

function nepStore(register, { faalLezen = false, faalSchrijven = false } = {}) {
  const log = { getStoreArgs: [], gets: [], sets: [] };
  const store = {
    get: async (sleutel, opts) => {
      log.gets.push([sleutel, opts]);
      if (faalLezen) throw new Error('lees kapot');
      return register;
    },
    setJSON: async (sleutel, data) => {
      log.sets.push([sleutel, JSON.parse(JSON.stringify(data))]);
      if (faalSchrijven) throw new Error('schrijf kapot');
    },
  };
  const getStore = (args) => { log.getStoreArgs.push(args); return store; };
  return { getStore, log };
}

async function draaiSinds(req, { router, register = {}, storeOpties, handler: bestaande } = {}) {
  const { fn, calls } = maakNepFetch(router);
  const ns = nepStore(register, storeOpties);
  const { maakHandler } = await laadVers('planning-sinds');
  const h = bestaande || maakHandler({ getStore: ns.getStore, fetch: fn });
  const res = await h(req);
  return { res, calls: uit(calls), log: ns.log, h, fn };
}

const verlaat = (eventTime, previousValue = 'Open') => ({
  eventTime, eventInfo: [{ propertyName: 'Status', propertyValue: { previousValue, updatedValue: 'Service in te plannen' } }],
});
const binnen = (eventTime) => verlaat(eventTime, 'Service in te plannen');
const hist = (id, from = 1) => get(`/tickets/${id}/History?fieldName=status&limit=50&from=${from}`);
const sindsRouter = (perId) => (url) => {
  const h = url.match(/\/tickets\/(\d+)\/History\?fieldName=status&limit=50&from=(\d+)$/);
  if (h) { const r = perId[h[1]]; return typeof r === 'function' ? r(Number(h[2])) : (r ? json({ data: r }) : new Response(null, { status: 204 })); }
  const t = url.match(/\/tickets\/(\d+)$/);
  if (t) return json({ createdTime: `C${t[1]}` });
  return undefined;
};
const tekst = async (res) => ({ status: res.status, headers: Object.fromEntries(res.headers), tekst: await res.text() });

test('planning-sinds: OPTIONS geeft 204 met alle vier de CORS-headers, zonder aanroepen', async () => {
  const { res, calls, log } = await draaiSinds(ZSINDS_REQ(undefined, { methode: 'OPTIONS' }));
  assert.deepEqual(await tekst(res), { status: 204, headers: CORS_V2, tekst: '' });
  assert.deepEqual(calls, []);
  assert.deepEqual(log.getStoreArgs, []);
});

test('planning-sinds: GET geeft 405 als tekst met alle vier de CORS-headers', async () => {
  const { res, calls } = await draaiSinds(ZSINDS_REQ(undefined, { methode: 'GET' }));
  assert.deepEqual(await tekst(res), { status: 405, headers: CORS_V2, tekst: 'Method Not Allowed' });
  assert.deepEqual(calls, []);
});

test('planning-sinds: PUT geeft ook 405', async () => {
  const { res } = await draaiSinds(ZSINDS_REQ({}, { methode: 'PUT' }));
  assert.equal(res.status, 405);
});

test('planning-sinds: ongeldige JSON, null en een niet-object geven 400', async () => {
  for (const body of ['{kapot', 'null', '5']) {
    const { res, calls, log } = await draaiSinds(ZSINDS_REQ(body));
    assert.deepEqual(await tekst(res), { status: 400, headers: CORS_V2, tekst: '{"error":"Ongeldige JSON"}' }, body);
    assert.deepEqual(calls, []);
    assert.deepEqual(log.getStoreArgs, []);
  }
});

test('planning-sinds: testmodus geeft 200 { sinds: {} } zonder aanroepen en zonder store', async () => {
  const { res, calls, log } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'], actief: ['1'] }, { headers: { 'X-Blitz-Test': '1' } }));
  assert.deepEqual(await tekst(res), { status: 200, headers: CORS_V2, tekst: '{"sinds":{}}' });
  assert.deepEqual(calls, []);
  assert.deepEqual(log, { getStoreArgs: [], gets: [], sets: [] });
});

test('planning-sinds: testmodus komt NA de JSON-validatie (ongeldige JSON blijft 400)', async () => {
  const { res } = await draaiSinds(ZSINDS_REQ('{kapot', { headers: { 'X-Blitz-Test': '1' } }));
  assert.equal(res.status, 400);
});

test('planning-sinds: opzoeking met verlaat-event, register-hit, opruimen en schrijven', async () => {
  const { res, calls, log } = await draaiSinds(
    ZSINDS_REQ({ opzoeken: ['1', '2', '1', 'abc'], actief: ['1', '2', 'x'] }),
    { register: { 2: { sinds: 'S2' }, 9: { sinds: 'S9' } }, router: sindsRouter({ 1: [verlaat('2026-09-20T08:00:00.000Z')] }) });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, hist('1')]);
  assert.deepEqual(await tekst(res), { status: 200, headers: CORS_V2, tekst: '{"sinds":{"1":"2026-09-20T08:00:00.000Z","2":"S2"}}' });
  assert.deepEqual(log.getStoreArgs, [{ name: 'blitz-data', consistency: 'strong' }]);
  assert.deepEqual(log.gets, [['planning-sinds', { type: 'json' }]]);
  assert.deepEqual(log.sets, [['planning-sinds', { 1: { sinds: '2026-09-20T08:00:00.000Z' }, 2: { sinds: 'S2' } }]]);
});

test('planning-sinds: zonder actief-lijst wordt het register niet opgeruimd en niet geschreven als niets nieuw is', async () => {
  const { res, calls, log } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['2'] }), { register: { 2: { sinds: 'S2' }, 9: { sinds: 'S9' } } });
  assert.deepEqual(calls, []);
  assert.equal((await tekst(res)).tekst, '{"sinds":{"2":"S2"}}');
  assert.deepEqual(log.sets, []);
});

test('planning-sinds: actief gegeven maar niets te wissen schrijft niet', async () => {
  const { log } = await draaiSinds(ZSINDS_REQ({ opzoeken: [], actief: ['9'] }), { register: { 9: { sinds: 'S9' } } });
  assert.deepEqual(log.sets, []);
});

test('planning-sinds: lege history -> createdTime via tickets/<id> met dezelfde headers', async () => {
  const { res, calls, log } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['5'] }), { router: sindsRouter({}) });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, hist('5'), get('/tickets/5')]);
  assert.equal((await tekst(res)).tekst, '{"sinds":{"5":"C5"}}');
  assert.deepEqual(log.sets, [['planning-sinds', { 5: { sinds: 'C5' } }]]);
});

test('planning-sinds: volle history zonder verlaat-event haalt de volgende pagina (from=51) en daarna createdTime', async () => {
  const vol = Array.from({ length: 50 }, (_, i) => binnen(`2026-09-${String(i % 28 + 1).padStart(2, '0')}T08:00:00.000Z`));
  const { res, calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['7'] }), {
    router: sindsRouter({ 7: (from) => (from === 1 ? json({ data: vol }) : json({ data: [] })) }),
  });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, hist('7', 1), hist('7', 51), get('/tickets/7')]);
  assert.equal((await tekst(res)).tekst, '{"sinds":{"7":"C7"}}');
});

test('planning-sinds: history wordt tot maximaal 4 pagina\'s gelezen', async () => {
  const vol = Array.from({ length: 50 }, () => binnen('2026-09-01T08:00:00.000Z'));
  const { calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['7'] }), { router: sindsRouter({ 7: () => json({ data: vol }) }) });
  assert.deepEqual(calls.slice(2), [hist('7', 1), hist('7', 51), hist('7', 101), hist('7', 151), get('/tickets/7')]);
});

test('planning-sinds: history-fout (HTTP) geeft null voor dat ticket en niets te schrijven', async () => {
  const log = mock.method(console, 'error', () => {});
  const { res, calls, log: store } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1', '2'] }), {
    router: (url) => (url.includes('/tickets/1/History') ? json({}, 500) : sindsRouter({ 2: [verlaat('2026-09-02T08:00:00.000Z')] })(url)),
  });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, hist('1'), hist('2')]);
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":null,"2":"2026-09-02T08:00:00.000Z"}}');
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['planning-sinds: ticket 1 mislukt:', 'Zoho history 500']]);
  assert.deepEqual(store.sets, [['planning-sinds', { 2: { sinds: '2026-09-02T08:00:00.000Z' } }]]);
});

test('planning-sinds: ongeldige JSON in history gooit (geen {}-fallback) en geeft null voor dat ticket', async () => {
  const log = mock.method(console, 'error', () => {});
  const { res, calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'] }), {
    router: (url) => (url.includes('/History') ? new Response('geen json', { status: 200 }) : undefined),
  });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, hist('1')]);
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":null}}');
  assert.equal(log.mock.calls.length, 1);
  assert.equal(log.mock.calls[0].arguments[0], 'planning-sinds: ticket 1 mislukt:');
  assert.match(log.mock.calls[0].arguments[1], /JSON/);
});

test('planning-sinds: ticketdetail-fout (HTTP) geeft null', async () => {
  const log = mock.method(console, 'error', () => {});
  const { res, calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'] }), {
    router: (url) => (url.endsWith('/tickets/1') ? json({}, 404) : sindsRouter({})(url)),
  });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, hist('1'), get('/tickets/1')]);
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":null}}');
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['planning-sinds: ticket 1 mislukt:', 'Zoho ticket 404']]);
});

test('planning-sinds: ticketdetail zonder createdTime geeft null en wordt niet in het register gezet', async () => {
  const { res, log } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'] }), {
    router: (url) => (url.endsWith('/tickets/1') ? json({}) : sindsRouter({})(url)),
  });
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":null}}');
  assert.deepEqual(log.sets, []);
});

test('planning-sinds: tokenfout geeft overal null; log bevat "Token refresh mislukt" zonder data', async () => {
  const log = mock.method(console, 'error', () => {});
  const { res, calls, log: store } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1', '2'] }), {
    router: (url) => (url.includes('oauth') ? json({ error: 'invalid_code' }) : undefined),
  });
  assert.deepEqual(calls, [TOKEN_CALL]);
  assert.deepEqual(await tekst(res), { status: 200, headers: CORS_V2, tekst: '{"sinds":{"1":null,"2":null}}' });
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['planning-sinds: Zoho niet bereikbaar:', 'Token refresh mislukt']]);
  assert.deepEqual(store.sets, []);
});

test('planning-sinds: orgfout gebruikt de standaardtekst en geeft overal null', async () => {
  const log = mock.method(console, 'error', () => {});
  const { res, calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'] }), {
    router: (url) => (url.endsWith('/organizations') ? json({ data: [] }) : undefined),
  });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL]);
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":null}}');
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['planning-sinds: Zoho niet bereikbaar:', 'Zoho org ID niet gevonden']]);
});

test('planning-sinds: netwerkfout op de token geeft overal null', async () => {
  const log = mock.method(console, 'error', () => {});
  const { res, calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'] }), { router: (url) => (url.includes('oauth') ? NETWERKFOUT() : undefined) });
  assert.deepEqual(calls, [TOKEN_CALL]);
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":null}}');
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['planning-sinds: Zoho niet bereikbaar:', 'netwerk']]);
});

test('planning-sinds: netwerkfout op een history-aanvraag geeft null voor dat ticket', async () => {
  mock.method(console, 'error', () => {});
  const { res } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'] }), { router: (url) => (url.includes('/History') ? NETWERKFOUT() : undefined) });
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":null}}');
});

test('planning-sinds: maximaal 20 nieuwe opzoekingen, rest null, in batches van vijf', async () => {
  const ids = Array.from({ length: 22 }, (_, i) => String(i + 1));
  let bezig = 0; let max = 0;
  const router = async (url) => {
    const h = url.match(/\/tickets\/(\d+)\/History/);
    if (!h) return undefined;
    bezig++; max = Math.max(max, bezig);
    await tick();
    bezig--;
    return json({ data: [verlaat(`2026-09-01T08:00:${String(h[1]).padStart(2, '0')}.000Z`)] });
  };
  const { res, calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ids }), { router });
  assert.equal(max, 5);
  assert.equal(calls.length, 2 + 20);
  assert.deepEqual(calls.slice(2).map(c => c.url), ids.slice(0, 20).map(id => `${DESK}/tickets/${id}/History?fieldName=status&limit=50&from=1`));
  const sinds = JSON.parse(await res.text()).sinds;
  assert.equal(sinds['20'], '2026-09-01T08:00:20.000Z');
  assert.equal(sinds['21'], null);
  assert.equal(sinds['22'], null);
});

test('planning-sinds: geen nieuwe opzoekingen betekent geen Zoho-verkeer (ook geen token)', async () => {
  const { calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['2'] }), { register: { 2: { sinds: 'S2' } } });
  assert.deepEqual(calls, []);
});

test('planning-sinds: register-entry zonder sinds telt als nieuw', async () => {
  const { calls } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['3'] }), { register: { 3: {} }, router: sindsRouter({}) });
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, hist('3'), get('/tickets/3')]);
});

test('planning-sinds: register lezen mislukt (get gooit) gaat door met leeg register', async () => {
  const { res, log } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'] }), {
    storeOpties: { faalLezen: true }, router: sindsRouter({ 1: [verlaat('2026-09-20T08:00:00.000Z')] }),
  });
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":"2026-09-20T08:00:00.000Z"}}');
  assert.deepEqual(log.sets, [['planning-sinds', { 1: { sinds: '2026-09-20T08:00:00.000Z' } }]]);
});

test('planning-sinds: getStore gooit -> gelogd, geen store, 200 en geen schrijfpoging', async () => {
  const log = mock.method(console, 'error', () => {});
  const { fn, calls } = maakNepFetch(sindsRouter({ 1: [verlaat('2026-09-20T08:00:00.000Z')] }));
  const { maakHandler } = await laadVers('planning-sinds');
  const h = maakHandler({ getStore: () => { throw new Error('geen blobs'); }, fetch: fn });
  const res = await h(ZSINDS_REQ({ opzoeken: ['1'], actief: [] }));
  assert.equal((await tekst(res)).tekst, '{"sinds":{"1":"2026-09-20T08:00:00.000Z"}}');
  assert.equal(calls.length, 3);
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['planning-sinds: register lezen mislukt:', 'geen blobs']]);
});

test('planning-sinds: register schrijven mislukt wordt gelogd en het antwoord blijft 200', async () => {
  const log = mock.method(console, 'error', () => {});
  const { res } = await draaiSinds(ZSINDS_REQ({ opzoeken: ['1'] }), {
    storeOpties: { faalSchrijven: true }, router: sindsRouter({ 1: [verlaat('2026-09-20T08:00:00.000Z')] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['planning-sinds: register schrijven mislukt:', 'schrijf kapot']]);
});

test('planning-sinds: dezelfde handler hergebruikt de token en vraagt het org-id opnieuw; een nieuwe handler krijgt een verse token', async () => {
  const { fn, calls } = maakNepFetch(sindsRouter({}));
  const { maakHandler } = await laadVers('planning-sinds');
  const ns = nepStore({});
  const h1 = maakHandler({ getStore: ns.getStore, fetch: fn });
  await h1(ZSINDS_REQ({ opzoeken: ['1'] }));
  await h1(ZSINDS_REQ({ opzoeken: ['2'] }));
  assert.deepEqual(uit(calls).map(c => c.url.replace(DESK, '')), [
    'https://accounts.zoho.eu/oauth/v2/token', '/organizations', '/tickets/1/History?fieldName=status&limit=50&from=1', '/tickets/1',
    '/organizations', '/tickets/2/History?fieldName=status&limit=50&from=1', '/tickets/2',
  ]);
  const h2 = maakHandler({ getStore: ns.getStore, fetch: fn });
  await h2(ZSINDS_REQ({ opzoeken: ['3'] }));
  assert.equal(calls.filter(c => c.url.includes('oauth')).length, 2);
});

test('planning-sinds: token verloopt na 55 minuten', async () => {
  const { fn, calls } = maakNepFetch(sindsRouter({}));
  const { maakHandler } = await laadVers('planning-sinds');
  const h = maakHandler({ getStore: nepStore({}).getStore, fetch: fn });
  await h(ZSINDS_REQ({ opzoeken: ['1'] }));
  mock.timers.setTime(NU + 55 * 60 * 1000 - 1);
  await h(ZSINDS_REQ({ opzoeken: ['2'] }));
  assert.equal(calls.filter(c => c.url.includes('oauth')).length, 1);
  mock.timers.setTime(NU + 55 * 60 * 1000);
  await h(ZSINDS_REQ({ opzoeken: ['3'] }));
  assert.equal(calls.filter(c => c.url.includes('oauth')).length, 2);
});

// ======================= planning-export =======================
async function draaiExport(event, router) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers('planning-export');
  const res = await metGlobaleFetch(fn, () => mod.handler(event));
  return { res, calls: uit(calls) };
}
const exportEvent = (extra = {}) => ({
  httpMethod: 'GET',
  headers: { host: 'blitz.example', authorization: 'Bearer SLEUTEL' },
  ...extra,
});
const kaal = res => ({ statusCode: res.statusCode, headers: { ...res.headers }, body: res.body });
const EXPORT_TICKETS = {
  tickets: [
    { id: 'T1', number: '1', interventieDatum: '2026-10-02T08:00:00.000Z', assignee: 'Jan', account: 'Bedrijf', naamEindklant: 'Eind', address: 'Straat 1', subject: 'Probleem', status: 'Service in te plannen' },
    { id: 'T2', number: '2', interventieDatum: '2026-10-01T22:00:00.000Z', assignee: '', account: '', naamEindklant: 'Eindklant', address: '', subject: '', status: '' },
    { id: 'T3', interventieDatum: '2026-09-29T08:00:00.000Z' },
    { id: 'T4' },
    { id: 'T5', interventieDatum: 'geen datum' },
  ],
  pendingTickets: [{ id: 'T6', number: '6', interventieDatum: '2026-10-02T21:30:00.000Z', status: 'Wachten' }],
  plannedTickets: [{ id: 'T7', number: '7', interventieDatum: '2026-09-30T23:00:00.000Z', account: 'Gisteren', status: 'Geplande service' }],
};
const EXPORT_KB = { items: { T1: { duurOverride: 90 }, T6: { duurOverride: 0 }, T7: { duurOverride: 'x' } } };
const EXPORT_AFSPRAKEN = {
  afspraken: [
    { id: 'A1', titel: 'Intern', datum: '2026-10-02', uur: '09:00', einduur: '10:00', type: 'Overleg', persoon: 'Piet', notitie: 'Kantoor' },
    { id: 'A2', datum: '2026-09-29', uur: '09:00' },
    { id: 'A3', titel: 'Zonder datum' },
    { id: 'A4', datum: '2026-10-01', adres: 'Adresveld', notitie: 'Notitie' },
  ],
};
const exportRouter = ({ tickets = EXPORT_TICKETS, kb = EXPORT_KB, afspraken = EXPORT_AFSPRAKEN } = {}) => (url) => {
  if (url.endsWith('/api/tickets')) return typeof tickets === 'function' ? tickets() : json(tickets);
  if (url.endsWith('/api/klantbeschikbaarheid')) return typeof kb === 'function' ? kb() : json(kb);
  if (url.endsWith('/api/afspraken')) return typeof afspraken === 'function' ? afspraken() : json(afspraken);
  return undefined;
};
const exportCalls = (basis) => ['tickets', 'klantbeschikbaarheid', 'afspraken']
  .map(n => ({ method: 'GET', url: `${basis}/api/${n}`, headers: {}, body: undefined }));

test('planning-export: OPTIONS geeft 204 met CORS, vóór de authenticatie, zonder aanroepen', async () => {
  const { res, calls } = await draaiExport({ httpMethod: 'OPTIONS', headers: {} });
  assert.deepEqual(kaal(res), { statusCode: 204, headers: CORS_V1, body: undefined });
  assert.deepEqual(calls, []);
});

test('planning-export: niet-GET geeft 405 als JSON', async () => {
  for (const httpMethod of ['POST', 'PUT', 'DELETE']) {
    const { res, calls } = await draaiExport(exportEvent({ httpMethod }));
    assert.deepEqual(ontleed(res), { status: 405, headers: CORS_V1, body: { error: 'Method not allowed' } });
    assert.deepEqual(calls, []);
  }
});

test('planning-export: geen, foute of ontbrekende-sleutel-configuratie geeft 401', async () => {
  const gevallen = [
    exportEvent({ headers: { host: 'h' } }),
    exportEvent({ headers: { host: 'h', authorization: 'Bearer FOUT' } }),
    exportEvent({ headers: { host: 'h', authorization: 'SLEUTEL' } }),
  ];
  for (const ev of gevallen) {
    const { res, calls } = await draaiExport(ev);
    assert.deepEqual(ontleed(res), { status: 401, headers: CORS_V1, body: { error: 'Unauthorized' } });
    assert.deepEqual(calls, []);
  }
  herstelEnv();
  herstelEnv = zetEnv({ PLANNING_EXPORT_API_KEY: undefined, ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC' });
  const { res } = await draaiExport(exportEvent({ headers: { host: 'h', authorization: 'Bearer undefined' } }));
  assert.equal(res.statusCode, 401);
});

test('planning-export: succes, drie aanroepen op https-basis, antwoordvorm en sortering', async () => {
  const { res, calls } = await draaiExport(exportEvent(), exportRouter());
  assert.deepEqual(calls, exportCalls('https://blitz.example'));
  assert.deepEqual(ontleed(res), {
    status: 200, headers: CORS_V1,
    body: [
      { id: 'A4', bron: 'handmatig', ticketnummer: null, type: null, datum: '2026-10-01', starttijd: null, eindtijd: null, technieker: null, klant: 'Notitie', adres: 'Adresveld', omschrijving: null, status: 'gepland' },
      { id: 'T7', bron: 'zoho', ticketnummer: '7', type: 'Interventie', datum: '2026-10-01', starttijd: '01:00', eindtijd: '03:00', technieker: null, klant: 'Gisteren', adres: null, omschrijving: null, status: 'Geplande service' },
      { id: 'T2', bron: 'zoho', ticketnummer: '2', type: 'Interventie', datum: '2026-10-02', starttijd: null, eindtijd: null, technieker: null, klant: 'Eindklant', adres: null, omschrijving: null, status: null },
      { id: 'A1', bron: 'handmatig', ticketnummer: null, type: 'Overleg', datum: '2026-10-02', starttijd: '09:00', eindtijd: '10:00', technieker: 'Piet', klant: 'Kantoor', adres: 'Kantoor', omschrijving: 'Intern', status: 'gepland' },
      { id: 'T1', bron: 'zoho', ticketnummer: '1', type: 'Interventie', datum: '2026-10-02', starttijd: '10:00', eindtijd: '11:30', technieker: 'Jan', klant: 'Bedrijf', adres: 'Straat 1', omschrijving: 'Probleem', status: 'Service in te plannen' },
      { id: 'T6', bron: 'zoho', ticketnummer: '6', type: 'Interventie', datum: '2026-10-02', starttijd: '23:30', eindtijd: '01:30', technieker: null, klant: null, adres: null, omschrijving: null, status: 'Wachten' },
    ],
  });
});

test('planning-export: host met hoofdletter-Host en localhost geeft http-basis', async () => {
  const { calls } = await draaiExport(
    { httpMethod: 'GET', headers: { Host: 'localhost:8888', Authorization: 'Bearer SLEUTEL' } },
    exportRouter({ tickets: {}, kb: {}, afspraken: {} }));
  assert.deepEqual(calls, exportCalls('http://localhost:8888'));
});

test('planning-export: lege antwoorden geven een lege lijst', async () => {
  const { res } = await draaiExport(exportEvent(), exportRouter({ tickets: {}, kb: {}, afspraken: {} }));
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS_V1, body: [] });
});

test('planning-export: tickets-fout geeft 500 met status en body, en stopt na één aanroep', async () => {
  const { res, calls } = await draaiExport(exportEvent(), exportRouter({ tickets: () => json({ x: 1 }, 502) }));
  assert.deepEqual(calls, exportCalls('https://blitz.example').slice(0, 1));
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS_V1, body: { error: 'Tickets ophalen mislukt (502): {"x":1}' } });
});

test('planning-export: tickets-fout met niet-JSON-body geeft {}', async () => {
  const { res } = await draaiExport(exportEvent(), exportRouter({ tickets: () => new Response('<html>', { status: 500 }) }));
  assert.deepEqual(ontleed(res).body, { error: 'Tickets ophalen mislukt (500): {}' });
});

test('planning-export: klantbeschikbaarheid-fout of ongeldige JSON valt terug op 120 minuten', async () => {
  const een = { tickets: { tickets: [EXPORT_TICKETS.tickets[0]] }, afspraken: {} };
  for (const kb of [() => json({}, 500), () => new Response('geen json', { status: 200 })]) {
    const { res, calls } = await draaiExport(exportEvent(), exportRouter({ ...een, kb }));
    assert.equal(calls.length, 3);
    assert.equal(ontleed(res).body[0].eindtijd, '12:00');
  }
});

test('planning-export: afspraken-fout geeft 500', async () => {
  const { res, calls } = await draaiExport(exportEvent(), exportRouter({ afspraken: () => json({ e: 'x' }, 503) }));
  assert.equal(calls.length, 3);
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS_V1, body: { error: 'Afspraken ophalen mislukt (503): {"e":"x"}' } });
});

test('planning-export: netwerkfout geeft 500 met de foutmelding', async () => {
  const { res, calls } = await draaiExport(exportEvent(), exportRouter({ tickets: NETWERKFOUT }));
  assert.equal(calls.length, 1);
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS_V1, body: { error: 'netwerk' } });
});
