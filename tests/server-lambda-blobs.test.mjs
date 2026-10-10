// Regressie: v1-functies (event-handler) krijgen de Blobs-omgeving niet vanzelf. Zonder connectLambda(event) gooit
// getStore() een MissingBlobsEnvironmentError, de login ziet dat als opslagstoring en iedere ingelogde gebruiker
// kreeg op /api/tickets (en plan, propose, ...) 503 'opslag-storing'. Nooit echte netwerkaanroepen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepStore } from './nep-blobs.mjs';
import { maakAuth } from '../netlify/lib/auth.js';
import { beveiligV1 } from '../netlify/lib/beveiligd.js';
import { verbindBlobs } from '../netlify/lib/blobs-context.js';
import { ondertekenToken, COOKIE_NAAM } from '../netlify/lib/sessie-token.js';

const GEHEIM = 'testgeheim-testgeheim';
const NU = Date.parse('2026-10-10T10:00:00.000Z');
const SLEUTEL = 'NETLIFY_BLOBS_CONTEXT';

const gebruiker = extra => ({
  id: 'u-brent', email: 'brent@blitz.test', naam: 'Brent', rol: 'technieker', zohoNaam: 'Brent Calaerts',
  actief: true, sessieVersie: 1, ...extra,
});

// Zoals de echte getStore: zonder Blobs-context (NETLIFY_BLOBS_CONTEXT) en zonder eigen siteID/token een fout.
function maakGetStore(store) {
  return opties => {
    if (!process.env[SLEUTEL] && !(opties.siteID && opties.token)) {
      const e = new Error('The environment has not been configured to use Netlify Blobs.');
      e.name = 'MissingBlobsEnvironmentError';
      throw e;
    }
    return store;
  };
}

// Een Lambda-compat-event zoals Netlify het levert: blobs = base64({ url, token }) + x-nf-*-headers.
function lambdaEvent({ uid = 'u-brent', metBlobs = true, methode = 'GET' } = {}) {
  const token = ondertekenToken({ uid, sv: 1, exp: Math.floor(NU / 1000) + 3600 }, GEHEIM);
  const event = {
    httpMethod: methode,
    headers: { cookie: `${COOKIE_NAAM}=${token}`, 'x-nf-deploy-id': 'dep1', 'x-nf-site-id': 'site1' },
    body: null,
  };
  if (metBlobs) event.blobs = Buffer.from(JSON.stringify({ url: 'https://edge.example', token: 'tok' })).toString('base64');
  return event;
}

async function metSchoneOmgeving(werk) {
  const voor = process.env[SLEUTEL];
  delete process.env[SLEUTEL];
  const errorOrig = console.error;
  console.error = () => {};
  try { return await werk(); } finally {
    console.error = errorOrig;
    if (voor === undefined) delete process.env[SLEUTEL]; else process.env[SLEUTEL] = voor;
  }
}

function opzet(g) {
  const store = maakNepStore({ gebruikers: { versie: 1, gebruikers: [g] } });
  const auth = maakAuth({ getStore: maakGetStore(store), env: { SESSIE_GEHEIM: GEHEIM }, nu: () => NU });
  const aanroepen = [];
  const handler = beveiligV1('tickets', async (event, context, gebr) => {
    aanroepen.push(gebr);
    return { statusCode: 200, body: '{"tickets":[]}' };
  }, { auth });
  return { handler, aanroepen };
}

for (const [titel, extra] of [
  ['technieker zonder magZelfPlannen', {}],
  ['technieker met magZelfPlannen', { magZelfPlannen: true }],
  ['technieker met magZelfPlannen=false', { magZelfPlannen: false }],
  ['technieker met zohoNaam met spatie en niet-ASCII', { zohoNaam: 'Zoë Van Den Bergh', magZelfPlannen: true }],
  ['technieker zonder zohoNaam', { zohoNaam: undefined }],
]) {
  test(`v1 tickets: ${titel} krijgt 200 (Blobs-context via connectLambda)`, () => metSchoneOmgeving(async () => {
    const { handler, aanroepen } = opzet(gebruiker(extra));
    const res = await handler(lambdaEvent(), {});
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(aanroepen.length, 1);
    assert.equal(aanroepen[0].rol, 'technieker');
    assert.equal(aanroepen[0].zohoNaam, 'zohoNaam' in extra ? extra.zohoNaam : 'Brent Calaerts');
  }));
}

test('v1 tickets: beheerder en planner krijgen ook 200', () => metSchoneOmgeving(async () => {
  for (const rol of ['beheerder', 'planner']) {
    const { handler, aanroepen } = opzet(gebruiker({ rol, zohoNaam: undefined }));
    const res = await handler(lambdaEvent(), {});
    assert.equal(res.statusCode, 200, rol);
    assert.equal(aanroepen[0].rol, rol);
  }
}));

test('bewijs van de oorzaak: zonder connectLambda (event zonder blobs) geeft de login 503 opslag-storing', () => metSchoneOmgeving(async () => {
  const { handler, aanroepen } = opzet(gebruiker({}));
  const res = await handler(lambdaEvent({ metBlobs: false }), {});
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).code, 'opslag-storing');
  assert.equal(aanroepen.length, 0);
}));

test('verbindBlobs: zonder event.blobs gebeurt er niets; een fout in connect geeft geen uitzondering', () => metSchoneOmgeving(async () => {
  let n = 0;
  await verbindBlobs({ headers: {} }, { connect: () => { n++; } });
  await verbindBlobs(undefined, { connect: () => { n++; } });
  assert.equal(n, 0);
  await verbindBlobs({ blobs: 'x', headers: {} }, { connect: () => { n++; throw new Error('stuk'); } });
  assert.equal(n, 1);
}));

test('verbindBlobs met de echte @netlify/blobs zet NETLIFY_BLOBS_CONTEXT', () => metSchoneOmgeving(async () => {
  await verbindBlobs(lambdaEvent());
  const ctx = JSON.parse(Buffer.from(process.env[SLEUTEL], 'base64').toString());
  assert.deepEqual(ctx, { deployID: 'dep1', edgeURL: 'https://edge.example', siteID: 'site1', token: 'tok' });
}));
