// tests/server-beveiliging.test.mjs — alle functies achter de rechtentabel (logins T10)
// De wrapper wordt getoetst met de kern-spy (zetKernSpyVoorTests): geen Blobs- of Zoho-aanroep, en een
// weigering van de wrapper is nooit te verwarren met een 403/400 uit de functie zelf.
import { test, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { laadVers, v1Event } from './nep-fetch.mjs';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { RECHTEN, regelVoor } from '../netlify/lib/rechten.js';
import { zetKernSpyVoorTests } from '../netlify/lib/beveiligd.js';

const wortel = join(import.meta.dirname, '..');
const ROLLEN = ['beheerder', 'planner', 'technieker', 'sales'];
const METHODES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const OPEN_FUNCTIES = ['confirm-afspraak', 'planning-export', 'activiteit-opruimen', 'sales-opruimen', 'auth-login', 'auth-uitloggen', 'auth-setup', 'auth-herstel', 'rapport-verwerk-background', 'rapport-vangnet'];
const WRAPPER_FUNCTIES = Object.keys(RECHTEN).filter(n => !OPEN_FUNCTIES.includes(n));

afterEach(() => zetKernSpyVoorTests(null));

// Laadt een functie vers; v1 = { handler }, v2 = default export.
async function laad(naam) {
  const mod = await laadVers(naam);
  if (typeof mod.handler === 'function') return { v1: true, fn: mod.handler };
  assert.equal(typeof mod.default, 'function', `${naam}: geen handler en geen default`);
  return { v1: false, fn: mod.default };
}

const kopSet = { 'x-blitz': '1' };
function roep({ v1, fn }, naam, methode, headers = kopSet) {
  if (v1) return fn({ ...v1Event(methode, undefined, headers), path: `/api/${naam}`, queryStringParameters: {} }, {});
  return fn(new Request(`http://localhost/api/${naam}`, { method: methode, headers }), {});
}
async function ontleed({ v1 }, res) {
  const status = v1 ? res.statusCode : res.status;
  const tekst = v1 ? res.body : await res.text();
  let body;
  try { body = tekst ? JSON.parse(tekst) : undefined; } catch { body = tekst; }
  return { status, body };
}
const spyVoor = ({ v1 }, oproepen) => (a) => {
  oproepen.push(a);
  return v1 ? { statusCode: 200, headers: {}, body: '{}' } : new Response('{}', { status: 200 });
};

test('dekking: de rij-sleutels zijn bestanden in netlify/functions en omgekeerd', () => {
  const bestanden = readdirSync(join(wortel, 'netlify', 'functions'), { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.js')).map(d => d.name.replace(/\.js$/, ''));
  assert.deepEqual(Object.keys(RECHTEN).filter(n => !bestanden.includes(n)), []);
  assert.deepEqual(bestanden.filter(n => !Object.hasOwn(RECHTEN, n)), []);
});

for (const naam of WRAPPER_FUNCTIES) {
  const rij = RECHTEN[naam];
  const methodes = METHODES.filter(m => regelVoor(naam, m) !== undefined);
  const zonderRegel = METHODES.filter(m => regelVoor(naam, m) === undefined);

  test(`${naam}: zonder sessie 401 niet-ingelogd en de kern wordt niet aangeroepen`, async () => {
    const f = await laad(naam);
    for (const methode of methodes) {
      const oproepen = [];
      zetKernSpyVoorTests(spyVoor(f, oproepen));
      const r = await metGeenSessie(async () => ontleed(f, await roep(f, naam, methode)));
      assert.equal(r.status, 401, `${naam} ${methode}`);
      assert.equal(r.body.code, 'niet-ingelogd', `${naam} ${methode}`);
      assert.equal(oproepen.length, 0, `${naam} ${methode}: kern aangeroepen`);
    }
  });

  test(`${naam}: per methode en rol precies de rijen uit de rechtentabel`, async () => {
    const f = await laad(naam);
    for (const methode of methodes) {
      const toegelaten = regelVoor(naam, methode);
      for (const rol of ROLLEN) {
        const oproepen = [];
        zetKernSpyVoorTests(spyVoor(f, oproepen));
        const r = await metRol(rol, async () => ontleed(f, await roep(f, naam, methode)));
        if (toegelaten.includes(rol)) {
          assert.equal(oproepen.length, 1, `${naam} ${methode} ${rol}: kern niet precies 1x aangeroepen`);
          assert.equal(oproepen[0].naam, naam);
          assert.equal(oproepen[0].methode, methode);
          assert.equal(oproepen[0].gebruiker.rol, rol);
          assert.equal(r.status, 200);
        } else {
          assert.equal(oproepen.length, 0, `${naam} ${methode} ${rol}: kern aangeroepen`);
          assert.equal(r.status, 403, `${naam} ${methode} ${rol}`);
          assert.equal(r.body.code, 'geen-recht', `${naam} ${methode} ${rol}`);
        }
      }
    }
  });

  if (zonderRegel.length && !Object.hasOwn(rij, '*')) {
    test(`${naam}: een methode zonder regel krijgt 405 van de wrapper, zonder kern`, async () => {
      const f = await laad(naam);
      for (const methode of zonderRegel) {
        const oproepen = [];
        zetKernSpyVoorTests(spyVoor(f, oproepen));
        const r = await metRol('beheerder', async () => ontleed(f, await roep(f, naam, methode)));
        assert.equal(r.status, 405, `${naam} ${methode}`);
        assert.equal(oproepen.length, 0);
      }
    });
  }
}

test('OPTIONS op elke functie geeft 204 zonder login', async () => {
  // activiteit-opruimen, sales-opruimen en rapport-vangnet zijn geplande functies zonder methodecontrole: OPTIONS zou de taak zelf draaien;
  // rapport-verwerk-background is een achtergrondfunctie (altijd 202, eigen interne sleutel).
  for (const naam of Object.keys(RECHTEN).filter(n => !['activiteit-opruimen', 'sales-opruimen', 'rapport-vangnet', 'rapport-verwerk-background'].includes(n))) {
    const f = await laad(naam);
    const r = await metGeenSessie(async () => ontleed(f, await roep(f, naam, 'OPTIONS', {})));
    assert.equal(r.status, 204, `${naam} OPTIONS`);
  }
});

test('open functies: zonder sessie geen 401 niet-ingelogd van de wrapper', async () => {
  for (const naam of ['auth-login', 'auth-uitloggen', 'auth-setup', 'auth-herstel']) {
    // POST zonder X-Blitz: de eigen CSRF-controle van de functie (403 csrf), nooit de wrapper (geen store nodig)
    const f = await laad(naam);
    const r = await metGeenSessie(async () => ontleed(f, await roep(f, naam, 'POST', {})));
    assert.notEqual(r.body?.code, 'niet-ingelogd', naam);
    assert.equal(r.status, 403, naam);
    assert.equal(r.body?.code, 'csrf', naam);
  }
  // confirm-afspraak GET zonder parameters: eigen 400-pagina
  const c = await laad('confirm-afspraak');
  const rc = await metGeenSessie(async () => ontleed(c, await roep(c, 'confirm-afspraak', 'GET', {})));
  assert.equal(rc.status, 400);
  // planning-export: eigen API-sleutelcontrole, geen sessie-401 van de wrapper
  const p = await laad('planning-export');
  const rp = await metGeenSessie(async () => ontleed(p, await roep(p, 'planning-export', 'GET', {})));
  assert.equal(rp.status, 401);
  assert.equal(rp.body.error, 'Unauthorized');
  assert.equal(rp.body.code, undefined);
  // activiteit-opruimen: enkel de rij ('open'); aanroepen zou het echte log opruimen
  assert.equal(regelVoor('activiteit-opruimen', 'GET'), 'open');
});

test('de service-sleutel- en wijzig-vlaggen staan enkel waar bedoeld', () => {
  assert.deepEqual(Object.keys(RECHTEN).filter(n => RECHTEN[n].service === true).sort(), ['afspraken', 'klantbeschikbaarheid', 'tickets']); // T12: de drie interne aanroepen van planning-export
  assert.deepEqual(Object.keys(RECHTEN).filter(n => RECHTEN[n].ookBijWijzigen === true).sort(), ['auth-ik', 'auth-wachtwoord']);
});
