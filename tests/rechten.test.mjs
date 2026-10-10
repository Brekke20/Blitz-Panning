// tests/rechten.test.mjs — netlify/lib/rechten.js + netlify/lib/beveiligd.js
import { test, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RECHTEN, rolIsToegelaten, rechtenVoor } from '../netlify/lib/rechten.js';
import { beveiligV1, beveiligV2, zetKernSpyVoorTests } from '../netlify/lib/beveiligd.js';
import { metRol, metGeenSessie } from './auth-hulp.mjs';

const wortel = join(import.meta.dirname, '..');
const B = 'beheerder', P = 'planner', T = 'technieker', S = 'sales';

afterEach(() => zetKernSpyVoorTests(null));

// ---- dekking ----
test('dekking: elke functie onder netlify/functions/ heeft een rij in RECHTEN', () => {
  const functies = readdirSync(join(wortel, 'netlify', 'functions'), { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.js'))
    .map(d => d.name.replace(/\.js$/, ''));
  assert.equal(functies.length, 49); // 42 logins + dashboard, dashboard-instellingen + sales, postcode, sales-import, sales-opruimen + zoho-agenten
  const ontbreekt = functies.filter(f => !Object.hasOwn(RECHTEN, f));
  assert.deepEqual(ontbreekt, []);
});

test('dekking (omgekeerd): elke sleutel van RECHTEN is een bestand in netlify/functions/', () => {
  const functies = readdirSync(join(wortel, 'netlify', 'functions'), { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.js'))
    .map(d => d.name.replace(/.js$/, ''));
  assert.deepEqual(Object.keys(RECHTEN).filter(n => !functies.includes(n)), []);
});

// ---- matrix ----
const rollen = (naam, methode) => [B, P, T, S].filter(r => rolIsToegelaten(naam, methode, r) === true);
const alleVier = [B, P, T, S];

test('matrix: tickets, planning-sinds', () => {
  assert.deepEqual(rollen('tickets', 'GET'), [B, P, T]);
  assert.deepEqual(rollen('planning-sinds', 'POST'), [B, P, T]);
});

test('matrix: plan, propose, annuleer, plan-datum voor beheerder en planner (een technieker enkel via planEigen, zie verder)', () => {
  for (const f of ['plan', 'propose', 'annuleer', 'plan-datum']) assert.deepEqual(rollen(f, 'POST'), [B, P], f);
  assert.deepEqual(rollen('annuleer', 'GET'), [B, P]);
});

test('planEigen: de rijen waar een technieker met "Mag zelf plannen" ook mag (enkel eigen tickets, afgedwongen in de functie)', () => {
  const metPlanEigen = Object.keys(RECHTEN).filter(n => RECHTEN[n].planEigen === true).sort();
  assert.deepEqual(metPlanEigen, ['annuleer', 'klantbeschikbaarheid', 'plan', 'plan-datum', 'propose', 'voorstel-status']);
  // Niets anders krijgt het vlag: beheer, instellingen, TomTom enz. blijven zoals ze waren.
  for (const naam of metPlanEigen) assert.ok(Object.hasOwn(RECHTEN, naam));
  // De rol-lijst zelf blijft ongewijzigd (rolIsToegelaten kent het vlag niet): de wrapper voegt de technieker toe.
  assert.equal(rolIsToegelaten('plan', 'POST', T), false);
});

test('matrix: TomTom-functies voor alle vier', () => {
  for (const f of ['optimize', 'matrix', 'route', 'drukte']) assert.deepEqual(rollen(f, 'POST'), alleVier, f);
});

test('matrix: lijsten met eigen-regel in de functie (afspraken, availability) laten T toe', () => {
  for (const f of ['afspraken', 'availability']) {
    assert.deepEqual(rollen(f, 'GET'), [B, P, T], f);
    assert.deepEqual(rollen(f, 'PUT'), [B, P, T], f);
  }
});

test('matrix: klantbeschikbaarheid, voorstel-status, prijzen, inventaris', () => {
  assert.deepEqual(rollen('klantbeschikbaarheid', 'GET'), [B, P, T]);
  assert.deepEqual(rollen('klantbeschikbaarheid', 'PUT'), [B, P]);
  assert.deepEqual(rollen('voorstel-status', 'GET'), [B, P, T]);
  assert.deepEqual(rollen('voorstel-status', 'POST'), [B, P]);
  assert.deepEqual(rollen('voorstel-status', 'DELETE'), [B, P]);
  assert.deepEqual(rollen('prijzen', 'GET'), [B, P, T]);
  assert.deepEqual(rollen('prijzen', 'PUT'), [B, P]);
  assert.deepEqual(rollen('inventaris', 'GET'), [B, P, T]);
  assert.deepEqual(rollen('inventaris', 'POST'), [B, P, T]);
  assert.deepEqual(rollen('inventaris', 'PATCH'), [B, P]);
});

test('matrix: rapportfuncties voor B P T, nooit S', () => {
  for (const [f, m] of [['rapport-archief', 'GET'], ['rapport-archief', 'POST'], ['rapport-archief', 'DELETE'],
    ['rapport-verzonden', 'POST'], ['rapport', 'POST'], ['send-rapport', 'POST'], ['comment', 'POST'],
    ['fotos', 'GET'], ['fotos', 'PUT'], ['mail-check', 'GET']]) {
    assert.deepEqual(rollen(f, m), [B, P, T], `${f} ${m}`);
  }
});

test('matrix: client-log, testdata, setup', () => {
  assert.deepEqual(rollen('client-log', 'GET'), [B]);
  assert.deepEqual(rollen('client-log', 'POST'), alleVier);
  assert.deepEqual(rollen('testdata', 'POST'), [B]);
  assert.deepEqual(rollen('setup', 'GET'), [B]);
});

test('matrix: zoho-agenten enkel lezen door de beheerder', () => {
  assert.deepEqual(rollen('zoho-agenten', 'GET'), [B]);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.deepEqual(rollen('zoho-agenten', m), [], `zoho-agenten ${m}`);
});

test('matrix: Beheer voor de planner en de sales manager: enkel Instellingen en Performance (lezen) en de beperkte gebruikerslijst; de rest blijft enkel beheerder', () => {
  // de beperkte gebruikerslijst (planner, sales manager) en de eigen-regels per functie: de rol komt door, de functie beperkt verder
  assert.deepEqual(rollen('gebruikers', 'GET'), [B, P, S]);
  for (const m of ['POST', 'PATCH']) assert.deepEqual(rollen('gebruikers', m), [B], `gebruikers ${m}`);
  assert.deepEqual(rollen('instellingen', 'GET'), alleVier);
  assert.deepEqual(rollen('instellingen', 'PUT'), alleVier);
  // Performance: beheerder alles, planner techniekers, sales (enkel met magAlleSales, in de functie) sales; nooit schrijven
  assert.deepEqual(rollen('dashboard', 'GET'), [B, P, S]);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.deepEqual(rollen('dashboard', m), [], `dashboard ${m}`);
  assert.deepEqual(rollen('dashboard-instellingen', 'GET'), [B, P]);
  assert.deepEqual(rollen('dashboard-instellingen', 'PUT'), [B]);
  // alles anders van Beheer: enkel de beheerder
  assert.deepEqual(rollen('activiteit', 'GET'), [B]);
  assert.deepEqual(rollen('systeemstatus', 'GET'), [B]);
  assert.deepEqual(rollen('zoho-agenten', 'GET'), [B]);
  assert.deepEqual(rollen('client-log', 'GET'), [B]);
  assert.deepEqual(rollen('testdata', 'POST'), [B]);
});

test('matrix: sales en postcode enkel voor beheerder en sales', () => {
  for (const m of ['GET', 'PATCH', 'DELETE']) assert.deepEqual(rollen('sales', m), [B, S], `sales ${m}`);
  for (const m of ['POST', 'PUT']) assert.deepEqual(rollen('sales', m), [], `sales ${m}`);
  assert.deepEqual(rollen('postcode', 'GET'), [B, S]);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.deepEqual(rollen('postcode', m), [], `postcode ${m}`);
});

test('matrix: sales-import enkel POST voor beheerder (enkel manuele lead) en sales; sales-opruimen is open', () => {
  assert.deepEqual(rollen('sales-import', 'POST'), [B, S]);
  for (const m of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.deepEqual(rollen('sales-import', m), [], `sales-import ${m}`);
  for (const m of ['GET', 'POST']) assert.equal(rolIsToegelaten('sales-opruimen', m, B), 'open', `sales-opruimen ${m}`);
});

test('matrix: confirm-afspraak en planning-export zijn open', () => {
  for (const f of ['confirm-afspraak', 'planning-export']) {
    for (const m of ['GET', 'POST']) assert.equal(rolIsToegelaten(f, m, S), 'open', `${f} ${m}`);
  }
});

test('rolIsToegelaten: onbekende functie, methode of rol is niet toegelaten (fail-closed)', () => {
  assert.equal(rolIsToegelaten('bestaat-niet', 'GET', B), false);
  assert.equal(rolIsToegelaten('plan-datum', 'PUT', B), false);
  assert.equal(rolIsToegelaten('plan-datum', 'POST', 'root'), false);
  assert.equal(rolIsToegelaten('plan-datum', 'POST', undefined), false);
  assert.equal(rolIsToegelaten('constructor', 'GET', B), false);
  assert.equal(rolIsToegelaten('plan-datum', 'constructor', B), false);
});

test('functies zonder eigen methodecontrole hebben een jokerregel (geen onbeveiligde andere methode)', () => {
  for (const f of ['tickets', 'setup', 'optimize', 'route', 'drukte']) assert.ok(RECHTEN[f]['*'], f);
  assert.equal(RECHTEN.tickets.service, true);
});

// ---- rechtenVoor ----
test('rechtenVoor', () => {
  assert.deepEqual(rechtenVoor({ rol: B }), { beheer: true, plannen: true, alleSales: true, planEigen: false });
  assert.deepEqual(rechtenVoor({ rol: P }), { beheer: false, plannen: true, alleSales: false, planEigen: false });
  assert.deepEqual(rechtenVoor({ rol: T }), { beheer: false, plannen: false, alleSales: false, planEigen: false });
  assert.deepEqual(rechtenVoor({ rol: S }), { beheer: false, plannen: false, alleSales: false, planEigen: false });
  assert.deepEqual(rechtenVoor({ rol: S, magAlleSales: true }), { beheer: false, plannen: false, alleSales: true, planEigen: false });
  assert.deepEqual(rechtenVoor({ rol: P, magAlleSales: 'ja' }), { beheer: false, plannen: true, alleSales: false, planEigen: false });
  // M2: alleSales enkel voor beheerder of een verkoper met het vinkje; een planner of technieker met een achtergebleven vinkje niet
  assert.equal(rechtenVoor({ rol: T, magAlleSales: true }).alleSales, false);
  assert.equal(rechtenVoor({ rol: P, magAlleSales: true }).alleSales, false);
  assert.equal(rechtenVoor({ rol: B, magAlleSales: false }).alleSales, true);
  assert.deepEqual(rechtenVoor(null), { beheer: false, plannen: false, alleSales: false, planEigen: false });
  // planEigen: enkel een technieker met het vinkje (letterlijk true); een planner of beheerder heeft het niet nodig.
  assert.deepEqual(rechtenVoor({ rol: T, magZelfPlannen: true }), { beheer: false, plannen: false, alleSales: false, planEigen: true });
  assert.equal(rechtenVoor({ rol: T }).planEigen, false);
  assert.equal(rechtenVoor({ rol: T, magZelfPlannen: 'ja' }).planEigen, false);
  assert.equal(rechtenVoor({ rol: P, magZelfPlannen: true }).planEigen, false);
  assert.equal(rechtenVoor({ rol: S, magZelfPlannen: true }).planEigen, false);
});

// ---- wrapper ----
const gebruiker = { id: 'u1', rol: P, naam: 'P', email: 'p@b.be' };
function stub(resultaat = { ok: true, gebruiker }) {
  const oproepen = [];
  return { oproepen, vereisGebruiker: async (req, opties) => { oproepen.push(opties); return resultaat; } };
}
const weiger = (status, code) => ({ ok: false, status, fout: 'x', code });
const v2Req = (methode, headers = {}) => new Request('http://localhost/api/x', { method: methode, headers });
function hSpy(antwoord = 'kern') {
  const h = async (req, context, gebr) => { h.oproepen.push({ req, context, gebruiker: gebr }); return antwoord; };
  h.oproepen = [];
  return h;
}

test('wrapper V2: weigering roept de kern niet en geeft 401/403 met { error, code }', async () => {
  for (const [status, code] of [[401, 'niet-ingelogd'], [403, 'geen-recht'], [403, 'csrf'], [503, 'opslag-storing']]) {
    const h = hSpy();
    const res = await beveiligV2('plan-datum', h, { auth: stub(weiger(status, code)) })(v2Req('POST'), {});
    assert.equal(res.status, status);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.deepEqual(Object.keys(await res.json()).sort(), ['code', 'error']);
    assert.equal(h.oproepen.length, 0);
  }
});

test('wrapper V1: weigering geeft statusCode, CORS en { error, code }', async () => {
  const h = hSpy();
  const res = await beveiligV1('plan', h, { auth: stub(weiger(403, 'geen-recht')) })({ httpMethod: 'POST', headers: {} }, {});
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(res.body).code, 'geen-recht');
  assert.equal(h.oproepen.length, 0);
});

test('wrapper: bij succes krijgt de kern (req, context, gebruiker) en wordt het antwoord doorgegeven', async () => {
  const h = hSpy('antwoord');
  const req = v2Req('POST'); const context = { ctx: 1 };
  assert.equal(await beveiligV2('plan-datum', h, { auth: stub() })(req, context), 'antwoord');
  assert.equal(h.oproepen[0].req, req);
  assert.equal(h.oproepen[0].context, context);
  assert.deepEqual(h.oproepen[0].gebruiker, gebruiker);
  const h1 = hSpy('v1');
  const event = { httpMethod: 'POST', headers: {} };
  assert.equal(await beveiligV1('plan', h1, { auth: stub() })(event, {}), 'v1');
  assert.deepEqual(h1.oproepen[0].gebruiker, gebruiker);
});

test('wrapper: rollen uit de rij en schrijven worden doorgegeven; GET is niet schrijvend', async () => {
  const s = stub();
  await beveiligV2('plan-datum', hSpy(), { auth: s })(v2Req('POST'), {});
  assert.deepEqual(s.oproepen[0].rollen, ['beheerder', 'planner', 'technieker']); // plan-datum heeft planEigen: de wrapper laat de technieker toe en controleert het vinkje
  assert.equal(s.oproepen[0].schrijven, true);
  assert.equal(!!s.oproepen[0].service, false);
  assert.equal(!!s.oproepen[0].ookBijWijzigen, false);
  const s2 = stub();
  await beveiligV2('prijzen', hSpy(), { auth: s2 })(v2Req('GET'), {});
  assert.equal(s2.oproepen[0].schrijven, false);
  assert.deepEqual(s2.oproepen[0].rollen, ['beheerder', 'planner', 'technieker']);
});

test('wrapper: service:true wordt doorgegeven voor tickets', async () => {
  const s = stub();
  await beveiligV1('tickets', hSpy(), { auth: s })({ httpMethod: 'GET', headers: {} }, {});
  assert.equal(s.oproepen[0].service, true);
});

test('wrapper: ookBijWijzigen wordt doorgegeven voor een rij met dat veld', async () => {
  RECHTEN['test-ookbijwijzigen'] = { GET: ['beheerder', 'planner', 'technieker', 'sales'], ookBijWijzigen: true };
  try {
    const s = stub();
    await beveiligV2('test-ookbijwijzigen', hSpy(), { auth: s })(v2Req('GET'), {});
    assert.equal(s.oproepen[0].ookBijWijzigen, true);
  } finally { delete RECHTEN['test-ookbijwijzigen']; }
});

test('wrapper: OPTIONS gaat zonder auth door naar de kern', async () => {
  const s = stub(weiger(401, 'niet-ingelogd'));
  const h = hSpy('204');
  assert.equal(await beveiligV2('plan-datum', h, { auth: s })(v2Req('OPTIONS'), {}), '204');
  assert.equal(s.oproepen.length, 0);
  assert.equal(h.oproepen.length, 1);
  const h1 = hSpy('204');
  await beveiligV1('plan', h1, { auth: s })({ httpMethod: 'OPTIONS', headers: {} }, {});
  assert.equal(s.oproepen.length, 0);
  assert.equal(h1.oproepen.length, 1);
});

test('wrapper: methode zonder regel krijgt 405 en de kern wordt niet aangeroepen (ook niet voor auth of spy)', async () => {
  const s = stub(weiger(401, 'niet-ingelogd'));
  const h = hSpy('kern');
  const res = await beveiligV2('plan-datum', h, { auth: s })(v2Req('PUT'), {});
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(h.oproepen.length, 0);
  assert.equal(s.oproepen.length, 0);
  const res1 = await beveiligV1('plan', h, { auth: s })({ httpMethod: 'DELETE', headers: {} }, {});
  assert.equal(res1.statusCode, 405);
  assert.equal(h.oproepen.length, 0);
  let spy = 0;
  zetKernSpyVoorTests(() => { spy++; });
  assert.equal((await beveiligV2('plan-datum', h, { auth: stub() })(v2Req('PUT'), {})).status, 405);
  assert.equal(spy, 0);
});

test('wrapper: een lege rollenlijst in een rij is 403 (vereisGebruiker leest [] als "elke rol")', async () => {
  RECHTEN['test-leeg'] = { GET: [] };
  try {
    const s = stub();
    const h = hSpy();
    const res = await beveiligV2('test-leeg', h, { auth: s })(v2Req('GET'), {});
    assert.equal(res.status, 403);
    assert.equal(h.oproepen.length, 0);
    assert.equal(s.oproepen.length, 0);
  } finally { delete RECHTEN['test-leeg']; }
});

test('OPTIONS op tickets en setup (geen methodecontrole in de functie): wrapper antwoordt 204, kern nooit, auth niet nodig', async () => {
  const s = stub(weiger(401, 'niet-ingelogd'));
  for (const naam of ['tickets', 'setup']) {
    const h = hSpy('LEK');
    const r1 = await beveiligV1(naam, h, { auth: s })({ httpMethod: 'OPTIONS', headers: {} }, {});
    assert.equal(r1.statusCode, 204, naam);
    assert.equal(r1.headers['Access-Control-Allow-Origin'], '*');
    const r2 = await beveiligV2(naam, h, { auth: s })(v2Req('OPTIONS'), {});
    assert.equal(r2.status, 204, naam);
    assert.equal(h.oproepen.length, 0, naam);
  }
  assert.equal(s.oproepen.length, 0);
});

test('tabelgedreven: voor elke rij met jokerregel (niet open) bereikt een OPTIONS zonder login de kern nooit', async () => {
  const jokers = Object.keys(RECHTEN).filter(n => Object.hasOwn(RECHTEN[n], '*') && RECHTEN[n]['*'] !== 'open');
  assert.ok(jokers.length >= 5);
  for (const naam of jokers) {
    const h = hSpy('LEK');
    const s = stub(weiger(401, 'niet-ingelogd'));
    assert.equal((await beveiligV1(naam, h, { auth: s })({ httpMethod: 'OPTIONS', headers: {} }, {})).statusCode, 204, naam);
    assert.equal((await beveiligV2(naam, h, { auth: s })(v2Req('OPTIONS'), {})).status, 204, naam);
    assert.equal(h.oproepen.length, 0, naam);
  }
});

test("OPTIONS op 'open'-jokerrijen gaat naar de functie (eigen CORS)", async () => {
  for (const naam of ['confirm-afspraak', 'planning-export']) {
    const h = hSpy('eigen');
    assert.equal(await beveiligV2(naam, h, { auth: stub(weiger(401, 'niet-ingelogd')) })(v2Req('OPTIONS'), {}), 'eigen', naam);
    assert.equal(h.oproepen.length, 1, naam);
  }
});

test("wrapper: 'open'-regels gaan zonder auth door", async () => {
  const s = stub(weiger(401, 'niet-ingelogd'));
  const h = hSpy('ok');
  assert.equal(await beveiligV2('confirm-afspraak', h, { auth: s })(v2Req('POST'), {}), 'ok');
  assert.equal(s.oproepen.length, 0);
});

test('wrapper: jokerregel geldt voor elke methode, ook een onverwachte', async () => {
  const s = stub(weiger(401, 'niet-ingelogd'));
  const h = hSpy();
  const res = await beveiligV1('tickets', h, { auth: s })({ httpMethod: 'POST', headers: {} }, {});
  assert.equal(res.statusCode, 401);
  assert.equal(h.oproepen.length, 0);
});

test('wrapper: methode is hoofdletterongevoelig', async () => {
  const s = stub(weiger(401, 'niet-ingelogd'));
  const h = hSpy();
  const res = await beveiligV1('plan', h, { auth: s })({ httpMethod: 'post', headers: {} }, {});
  assert.equal(res.statusCode, 401);
  assert.equal(h.oproepen.length, 0);
});

test('wrapper: onbekende functienaam gooit bij het omhullen; verdwenen rij weigert (fail-closed)', async () => {
  assert.throws(() => beveiligV2('bestaat-niet', hSpy()), /rechten/i);
  RECHTEN['tijdelijk'] = { GET: ['beheerder'] };
  const h = hSpy();
  const w = beveiligV2('tijdelijk', h, { auth: stub() });
  delete RECHTEN['tijdelijk'];
  const res = await w(v2Req('GET'), {});
  assert.equal(res.status, 403);
  assert.equal(h.oproepen.length, 0);
});

test('wrapper: een stub die gooit geeft een weigering, nooit een doorgelaten verzoek', async () => {
  const h = hSpy();
  const auth = { vereisGebruiker: async () => { throw new Error('kapot'); } };
  const res = await beveiligV2('plan-datum', h, { auth })(v2Req('POST'), {});
  assert.equal(res.status, 401);
  assert.equal(h.oproepen.length, 0);
});

test('wrapper: een ongeldig auth-resultaat (geen ok:true) is een weigering', async () => {
  const h = hSpy();
  for (const r of [undefined, null, {}, { ok: 'ja', gebruiker }, { ok: true }]) {
    const res = await beveiligV2('plan-datum', h, { auth: { vereisGebruiker: async () => r } })(v2Req('POST'), {});
    assert.equal(res.status, 401, String(JSON.stringify(r)));
  }
  assert.equal(h.oproepen.length, 0);
});

test('zetKernSpyVoorTests: na een geslaagde autorisatie wordt de spy aangeroepen en de kern niet', async () => {
  const h = hSpy();
  const oproepen = [];
  zetKernSpyVoorTests(async info => { oproepen.push(info); return 'spy-antwoord'; });
  assert.equal(await beveiligV2('plan-datum', h, { auth: stub() })(v2Req('POST'), {}), 'spy-antwoord');
  assert.deepEqual(oproepen, [{ naam: 'plan-datum', methode: 'POST', gebruiker }]);
  assert.equal(h.oproepen.length, 0);
  const res = await beveiligV1('plan', h, { auth: stub() })({ httpMethod: 'POST', headers: {} }, {});
  assert.equal(res, 'spy-antwoord');
  assert.equal(oproepen[1].naam, 'plan');
});

test('zetKernSpyVoorTests: bij een weigering geen spy en geen kern; null zet de spy uit', async () => {
  const h = hSpy('kern');
  let spyOproepen = 0;
  zetKernSpyVoorTests(() => { spyOproepen++; return 'spy'; });
  const res = await beveiligV2('plan-datum', h, { auth: stub(weiger(403, 'geen-recht')) })(v2Req('POST'), {});
  assert.equal(res.status, 403);
  assert.equal(spyOproepen, 0);
  assert.equal(h.oproepen.length, 0);
  zetKernSpyVoorTests(null);
  assert.equal(await beveiligV2('plan-datum', h, { auth: stub() })(v2Req('POST'), {}), 'kern');
  assert.equal(spyOproepen, 0);
});

test('zetKernSpyVoorTests: ook open-regels en OPTIONS gaan via de spy (nooit Blobs of Zoho)', async () => {
  const h = hSpy();
  const oproepen = [];
  zetKernSpyVoorTests(info => { oproepen.push(info); return 'spy'; });
  await beveiligV2('confirm-afspraak', h, { auth: stub() })(v2Req('POST'), {});
  await beveiligV2('plan-datum', h, { auth: stub() })(v2Req('OPTIONS'), {});
  assert.deepEqual(oproepen.map(o => [o.naam, o.methode, o.gebruiker]), [['confirm-afspraak', 'POST', undefined], ['plan-datum', 'OPTIONS', undefined]]);
  assert.equal(h.oproepen.length, 0);
});

test('zetKernSpyVoorTests gooit in een Netlify-runtime', () => {
  for (const v of ['NETLIFY', 'AWS_LAMBDA_FUNCTION_NAME', 'LAMBDA_TASK_ROOT']) {
    const oud = process.env[v];
    process.env[v] = v === 'NETLIFY' ? 'true' : 'x';
    try { assert.throws(() => zetKernSpyVoorTests(() => {}), /Netlify/i, v); }
    finally { if (oud === undefined) delete process.env[v]; else process.env[v] = oud; }
  }
});

test('wrapper: standaard auth is de globale vereisGebruiker (de testhulp werkt door)', async () => {
  const h = hSpy('ok');
  const w = beveiligV2('plan-datum', h);
  const post = () => w(v2Req('POST', { 'x-blitz': '1' }), {});
  assert.equal(await metRol('planner', post), 'ok');
  assert.equal((await metRol('technieker', post)).status, 403);
  assert.equal((await metGeenSessie(post)).status, 401);
  assert.equal(h.oproepen.length, 1);
});


// ---- planEigen in de wrapper ----
const technieker = (extra = {}) => ({ id: 'u-t', rol: T, naam: 'T', email: 't@b.be', zohoNaam: 'Tim', ...extra });

test('wrapper planEigen: een technieker mét magZelfPlannen komt door (de functie controleert het ticket); zonder, met false of een niet-boolean krijgt hij 403', async () => {
  for (const [extra, toegelaten] of [[{ magZelfPlannen: true }, true], [{}, false], [{ magZelfPlannen: false }, false], [{ magZelfPlannen: 'ja' }, false], [{ magZelfPlannen: 1 }, false]]) {
    for (const naam of ['plan-datum', 'propose', 'plan', 'annuleer', 'voorstel-status', 'klantbeschikbaarheid']) {
      const methode = naam === 'klantbeschikbaarheid' ? 'PUT' : 'POST';
      const h = hSpy('kern');
      const res = await (naam === 'propose' || naam === 'plan'
        ? beveiligV1(naam, h, { auth: stub({ ok: true, gebruiker: technieker(extra) }) })({ httpMethod: methode, headers: {} }, {})
        : beveiligV2(naam, h, { auth: stub({ ok: true, gebruiker: technieker(extra) }) })(v2Req(methode), {}));
      if (toegelaten) {
        assert.equal(res, 'kern', `${naam} ${JSON.stringify(extra)}`);
        assert.equal(h.oproepen.length, 1);
        assert.equal(h.oproepen[0].gebruiker.zohoNaam, 'Tim'); // de functie krijgt de gebruiker om het ticket te toetsen
      } else {
        assert.equal(res.status ?? res.statusCode, 403, `${naam} ${JSON.stringify(extra)}`);
        assert.equal(h.oproepen.length, 0);
      }
    }
  }
});

test('wrapper planEigen: andere rollen en andere rijen veranderen niet (sales blijft geweigerd; een rij zonder planEigen laat een technieker met het vinkje niet toe)', async () => {
  // sales: het vlag hoort enkel bij technieker
  const s = stub({ ok: true, gebruiker: { id: 'u-s', rol: S, magZelfPlannen: true } });
  const h = hSpy();
  // de auth-stub laat elke rol door; de wrapper zelf mag een sales niet via planEigen binnenlaten
  const res = await beveiligV2('plan-datum', h, { auth: s })(v2Req('POST'), {});
  assert.equal(res.status, 403);
  assert.equal(h.oproepen.length, 0);
  // rij zonder planEigen: de rollenlijst bevat technieker niet, dus vraagt de wrapper er ook niet om
  const s2 = stub();
  await beveiligV2('prijzen', hSpy(), { auth: s2 })(v2Req('PUT'), {});
  assert.deepEqual(s2.oproepen[0].rollen, ['beheerder', 'planner']);
  // een technieker met het vinkje op een gewone coördinatorsrij (prijzen PUT): auth weigert zelf op de rol; de wrapper voegt niets toe
  assert.equal(RECHTEN.prijzen.planEigen, undefined);
});

test('wrapper planEigen: beheerder en planner passeren ongewijzigd, ook zonder vinkje', async () => {
  for (const rol of [B, P]) {
    const h = hSpy('kern');
    assert.equal(await beveiligV2('plan-datum', h, { auth: stub({ ok: true, gebruiker: { id: 'u', rol } }) })(v2Req('POST'), {}), 'kern', rol);
  }
});

test('wrapper planEigen: de GET-regels waar een technieker al in staat (voorstel-status, klantbeschikbaarheid) blijven ongewijzigd', async () => {
  const s = stub({ ok: true, gebruiker: technieker() });
  const h = hSpy('kern');
  assert.equal(await beveiligV2('voorstel-status', h, { auth: s })(v2Req('GET'), {}), 'kern'); // lezen mag elke technieker, ook zonder vinkje
  assert.deepEqual(s.oproepen[0].rollen, ['beheerder', 'planner', 'technieker']);
});
