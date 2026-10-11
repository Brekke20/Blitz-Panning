// tests/server-activiteit-logging.test.mjs — de ticketfuncties loggen elke GESLAAGDE schrijfactie met naam in
// `activiteit/<maand>` van de ECHTE store (logins T12). Nooit bij een fout, nooit bij een testverzoek, nooit
// blokkerend; de uitgaande Zoho-aanroepen blijven identiek (zie de karakteriseringstests). Geen echt netwerk.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';
import { maakNepStore } from './nep-blobs.mjs';
import { metRol } from './auth-hulp.mjs';
import { beveiligV1, beveiligV2 } from '../netlify/lib/beveiligd.js';

const NU = Date.parse('2026-10-08T10:00:00.000Z');
const MAAND = 'activiteit/2026-10';
const TEKST = 'GEHEIME KLANTTEKST met naam en adres';
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

let herstelEnv;
test.beforeEach(() => {
  herstelEnv = zetEnv({
    ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC',
    ZOHO_FROM_EMAIL: 'service@blitz.test', CONFIRM_LINK_SECRET: 'geheim-voor-test', URL: 'https://planning.test',
    NETLIFY_BLOBS_CONTEXT: undefined,
  });
  mock.timers.enable({ apis: ['Date'], now: NU });
  mock.method(console, 'error', () => {});
});
test.afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  herstelEnv();
});

// Twee stores: de echte (`blitz-data`) en de teststore; een testverzoek mag nergens een logregel achterlaten.
function maakWinkels() {
  const echt = maakNepStore();
  const testStore = maakNepStore();
  return { echt, testStore, getStore: ({ name }) => (name === 'blitz-data' ? echt : testStore) };
}
const regels = async w => (await w.echt.get(MAAND, { type: 'json' }))?.items ?? [];
const geenLog = async w => {
  assert.deepEqual(await regels(w), []);
  assert.deepEqual([...w.testStore._data.keys()].filter(k => k.startsWith('activiteit/')), []);
};
// ---------------- scenario's per functie ----------------
// Elk scenario: (w, opties) -> { status, ... }. opties: { kop (extra headers), zohoFout, rol-wrapper via metRol door de test }.
const TICKET3 = { contact: { email: 'contact@x.be', name: 'Testcontact' }, cf: { cf_e_mail_eindklant: 'klant@x.be' } };

async function draaiV1(naam, w, event, router, { stores = w.getStore } = {}) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers(naam);
  const res = await metGlobaleFetch(fn, () => mod.maakHandler({ getStore: stores })(event));
  return { status: res.statusCode, body: JSON.parse(res.body), calls };
}
async function draaiV2(naam, w, req, router, { stores = w.getStore } = {}) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers(naam);
  const res = await metGlobaleFetch(fn, () => mod.maakHandler({ getStore: stores })(req, {}));
  return { status: res.status, calls };
}

const SCENARIOS = {
  plan: {
    rol: 'planner', actie: 'plannen', onderwerp: '123', details: '2026-06-23',
    async draai(w, { kop = {}, fout = false, stores } = {}) {
      return draaiV1('plan', w,
        v1Event('POST', { ticketId: '123', date: '2026-06-23', utcInterventieDatum: '2026-06-22T22:00:00.000Z' }, kop),
        url => (url.endsWith('/tickets/123') ? json({}, fout ? 500 : 200) : undefined), { stores });
    },
  },
  'plan-datum': {
    rol: 'planner', actie: 'plannen', onderwerp: '123', details: '2026-06-23', // Brusselse dag van 22:00Z
    async draai(w, { kop = {}, fout = false, stores } = {}) {
      const req = new Request('http://localhost/api/plan-datum', {
        method: 'POST', headers: { 'content-type': 'application/json', ...kop },
        body: JSON.stringify({ ticketId: '123', utcInterventieDatum: '2026-06-22T22:00:00.000Z' }),
      });
      return draaiV2('plan-datum', w, req, url => (url.endsWith('/tickets/123') ? json({}, fout ? 500 : 200) : undefined), { stores });
    },
  },
  propose: {
    rol: 'planner', actie: 'voorstel-verstuurd', onderwerp: '555', details: '2026-10-14',
    async draai(w, { kop = {}, fout = false, stores } = {}) {
      let up = 0;
      const router = (url, opts = {}) => {
        const m = opts.method || 'GET';
        if (url.endsWith('/tickets/555') && m === 'GET') return json(TICKET3);
        if (url.endsWith('/tickets/555') && m === 'PATCH') return json({}, fout ? 500 : 200);
        if (url.endsWith('/uploads')) return json({ id: `ATT${++up}` });
        if (url.endsWith('/sendReply')) return json({});
        return undefined;
      };
      return draaiV1('propose', w, v1Event('POST', {
        ticketId: '555', date: '2026-10-14', time: '09:10', recipientName: 'Jan', subject: 'Laadpaal', serienummer: 'SN1',
        utcInterventieDatum: '2026-10-14T07:15:00.000Z',
      }, kop), router, { stores });
    },
  },
  annuleer: {
    rol: 'planner', actie: 'annulatie', onderwerp: '555', details: 'weer',
    async draai(w, { kop = {}, fout = false, stores } = {}) {
      const router = (url, opts = {}) => {
        const m = opts.method || 'GET';
        if (url.endsWith('/tickets/555') && m === 'GET') {
          return json({ status: 'Wachten op bevestiging planning', cf: { cf_interventie_datm: '2026-10-14T06:30:00.000Z' }, contact: { email: 'contact@x.be' } });
        }
        if (url.endsWith('/tickets/555') && m === 'PATCH') return json({}, fout ? 500 : 200);
        if (url.endsWith('/sendReply') || url.endsWith('/comments')) return json({});
        return undefined;
      };
      const { fn, calls } = maakNepFetch(router);
      const mod = await laadVers('annuleer');
      const h = beveiligV2('annuleer', mod.maakHandler({ getStore: stores ?? w.getStore, fetch: fn }));
      const req = new Request('http://x/api/annuleer', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...kop },
        body: JSON.stringify({ ticketId: '555', reden: 'weer', toelichting: TEKST, mailKlant: true, door: 'Brent' }),
      });
      const res = await h(req, {});
      return { status: res.status, calls };
    },
  },
  'send-rapport': {
    rol: 'technieker', actie: 'rapport-verstuurd', onderwerp: '555', details: 'mail',
    async draai(w, { kop = {}, fout = false, mailFout = false, stores } = {}) {
      let up = 0;
      const router = (url, opts = {}) => {
        const m = opts.method || 'GET';
        if (url.endsWith('/tickets/555') && m === 'GET') return json(TICKET3, fout ? 500 : 200);
        if (url.endsWith('/tickets/555') && m === 'PATCH') return json({});
        if (url.endsWith('/uploads')) return json({ id: `ATT${++up}` });
        if (url.endsWith('/sendReply')) return json({}, mailFout ? 500 : 200);
        return undefined;
      };
      const { fn, calls } = maakNepFetch(router);
      const mod = await laadVers('send-rapport');
      const h = beveiligV1('send-rapport', mod.maakHandler({ fetch: fn, maakPdf: async () => Buffer.from('PDF'), getStore: stores ?? w.getStore }));
      const res = await h(v1Event('POST', { ticketId: '555', html: '<p>rapport</p>', ticketNumber: '12345' }, kop), {});
      return { status: res.statusCode, calls };
    },
  },
  rapport: { rol: 'technieker', actie: 'rapport-verstuurd', onderwerp: '555', details: 'pdf-bijlage' }, // draai: zie onder
  fotos: {
    rol: 'technieker', actie: 'foto-toegevoegd', onderwerp: '555', details: "1 foto's",
    async draai(w, { kop = {}, fout = false, stores } = {}) {
      const req = new Request('http://localhost/api/fotos', {
        method: 'PUT', headers: { 'content-type': 'application/json', ...kop },
        body: JSON.stringify({ ticketId: '555', versie: fout ? 7 : 0, fotos: [{ id: 'f1', dataUrl: 'data:image/png;base64,AAAA', caption: TEKST }] }),
      });
      return draaiV2('fotos', w, req, () => undefined, { stores });
    },
  },
  comment: {
    rol: 'technieker', actie: 'notitie-toegevoegd', onderwerp: '555', details: null,
    async draai(w, { kop = {}, fout = false, stores } = {}) {
      return draaiV1('comment', w, v1Event('POST', { ticketId: '555', content: TEKST }, kop),
        url => (url.endsWith('/tickets/555') ? json({}, fout ? 500 : 200) : undefined), { stores });
    },
  },
};

// rapport: de PDF-generatie (Chromium) vervangen door een nep (maakPdf).
SCENARIOS.rapport.draai = async (w, { kop = {}, fout = false, stores, verzendId } = {}) => {
  const router = (url, opts = {}) => (url.endsWith('/tickets/555/attachments') && opts.method === 'POST'
    ? json(fout ? { error: 'stuk' } : { id: 'ATT9' }, fout ? 500 : 200) : undefined);
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers('rapport');
  const h = mod.maakHandler({ getStore: stores ?? w.getStore, maakPdf: async () => Buffer.from('PDF') });
  const res = await metGlobaleFetch(fn, () => h(v1Event('POST', { ticketId: '555', html: '<p>rapport</p>', verzendId }, kop), {}));
  return { status: res.statusCode, calls };
};

const NAMEN = Object.keys(SCENARIOS);

// ---------------- een geslaagde actie: precies één regel, met naam ----------------
for (const naam of NAMEN) {
  const s = SCENARIOS[naam];
  test(`${naam}: geslaagde actie schrijft één regel met actie, onderwerp en naam in de ECHTE store`, async () => {
    const w = maakWinkels();
    const r = await s.draai(w);
    assert.equal(r.status, 200);
    const log = await regels(w);
    assert.equal(log.length, 1);
    assert.equal(log[0].actie, s.actie);
    assert.equal(log[0].onderwerp, s.onderwerp);
    assert.equal(log[0].details, s.details);
    assert.equal(log[0].naam, 'Test Beheerder');
    assert.equal(log[0].gebruikerId, 'test-beheerder');
    assert.equal(log[0].op, new Date(NU).toISOString());
    assert.deepEqual([...w.testStore._data.keys()].filter(k => k.startsWith('activiteit/')), []);
  });

  test(`${naam}: ${s.rol} die dezelfde actie uitvoert krijgt geen 403, de regel staat met zijn naam erin`, async () => {
    const w = maakWinkels();
    const r = await metRol(s.rol, () => s.draai(w), { zohoNaam: 'Roel' });
    assert.equal(r.status, 200);
    const log = await regels(w);
    assert.equal(log.length, 1);
    assert.equal(log[0].gebruikerId, s.rol === 'planner' ? 'test-planner' : 'test-technieker');
    assert.equal(log[0].naam, s.rol === 'planner' ? 'Test Planner' : 'Test Technieker');
  });

  test(`${naam}: een mislukte actie (Zoho/versiefout) schrijft niets`, async () => {
    const w = maakWinkels();
    const r = await s.draai(w, { fout: true });
    assert.notEqual(r.status, 200);
    assert.deepEqual(await regels(w), []);
  });

  test(`${naam}: een testverzoek (X-Blitz-Test: 1) schrijft niets`, async () => {
    const w = maakWinkels();
    const r = await s.draai(w, { kop: { 'X-Blitz-Test': '1' } });
    assert.equal(r.status, 200);
    await geenLog(w);
  });

  test(`${naam}: een store waarvan het loggen faalt verandert het antwoord niet`, async () => {
    const w = maakWinkels();
    // Enkel het schrijven naar activiteit/* gooit; al het andere (register, foto's, ...) werkt gewoon.
    const gedeeld = ({ name }) => {
      if (name !== 'blitz-data') return w.testStore;
      return new Proxy(w.echt, {
        get(doel, prop) {
          if (prop === 'setJSON') {
            return async (k, v) => { if (String(k).startsWith('activiteit/')) throw new Error('opslag stuk'); return doel.setJSON(k, v); };
          }
          return doel[prop].bind(doel);
        },
      });
    };
    const basis = await s.draai(maakWinkels());
    const r = await s.draai(w, { stores: gedeeld });
    assert.equal(r.status, basis.status);
    assert.equal(r.status, 200);
    assert.deepEqual(await regels(w), []);
  });
}

test('een getStore die zelf gooit verandert het antwoord niet (functies zonder eigen opslag)', async () => {
  for (const naam of ['plan', 'plan-datum', 'propose', 'comment', 'send-rapport']) {
    const r = await SCENARIOS[naam].draai(maakWinkels(), { stores: () => { throw new Error('geen opslag'); } });
    assert.equal(r.status, 200, naam);
  }
});

test('geen enkele regel bevat de vrije tekst of de fotodata', async () => {
  for (const naam of ['annuleer', 'fotos', 'comment']) {
    const w = maakWinkels();
    await SCENARIOS[naam].draai(w);
    const ruw = JSON.stringify([...w.echt._data.get(MAAND) ? [w.echt._data.get(MAAND)] : []]);
    assert.ok(!ruw.includes('GEHEIME'), `${naam}: vrije tekst in het log`);
    assert.ok(!ruw.includes('data:image'), `${naam}: fotodata in het log`);
  }
});

// ---------------- plan: uitplannen en idempotente herhaling van rapport ----------------
test("plan: uitplannen (date: null) logt details 'uitgepland'", async () => {
  const w = maakWinkels();
  const r = await draaiV1('plan', w, v1Event('POST', { ticketId: '123', date: null }), url => (url.endsWith('/tickets/123') ? json({}) : undefined));
  assert.equal(r.status, 200);
  const log = await regels(w);
  assert.equal(log.length, 1);
  assert.equal(log[0].details, 'uitgepland');
});

test('rapport: een idempotente herhaling met een al verwerkte verzendId schrijft geen tweede regel', async () => {
  const w = maakWinkels();
  const verzendId = '0d6f4a52-5b0e-4e0b-9f6e-123456789abc';
  const r1 = await SCENARIOS.rapport.draai(w, { verzendId });
  assert.equal(r1.status, 200);
  const r2 = await SCENARIOS.rapport.draai(w, { verzendId });
  assert.equal(r2.status, 200);
  assert.equal(r2.calls.length, 0, 'tweede keer geen Zoho-aanroepen');
  assert.equal((await regels(w)).length, 1);
});

// ---------------- send-rapport ----------------
test('send-rapport: een voorbeeld (preview) schrijft niets', async () => {
  const w = maakWinkels();
  const router = (url, opts = {}) => (url.endsWith('/tickets/555') && (opts.method || 'GET') === 'GET' ? json(TICKET3) : undefined);
  const { fn } = maakNepFetch(router);
  const mod = await laadVers('send-rapport');
  const h = beveiligV1('send-rapport', mod.maakHandler({ fetch: fn, maakPdf: async () => Buffer.from('PDF'), getStore: w.getStore }));
  const res = await h(v1Event('POST', { ticketId: '555', html: '<p>r</p>', ticketNumber: '1', preview: true }), {});
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).preview, true);
  assert.deepEqual(await regels(w), []);
});

test('send-rapport: als er geen enkele mail verstuurd is (200 zonder succes) wordt niets gelogd', async () => {
  const w = maakWinkels();
  const r = await SCENARIOS['send-rapport'].draai(w, { mailFout: true });
  assert.equal(r.status, 200); // Zoho-sendReply faalt per ontvanger: nog steeds een 200 met fouten
  assert.deepEqual(await regels(w), []);
});

// ---------------- enkel lezen ----------------
test('mail-check en fotos GET schrijven niets', async () => {
  const w = maakWinkels();
  const { fn } = maakNepFetch(url => (url.includes('/threads') ? json({ data: [] }) : undefined));
  const mc = await laadVers('mail-check');
  const h = beveiligV2('mail-check', mc.maakHandler({ fetch: fn }));
  const res = await metGlobaleFetch(fn, () => h(new Request('http://localhost/api/mail-check?ticketId=555&verlopenMs=60000'), {}));
  assert.equal(res.status, 200);

  const ft = await laadVers('fotos');
  const g = await ft.maakHandler({ getStore: w.getStore })(new Request('http://localhost/api/fotos?ticketId=555'), {});
  assert.equal(g.status, 200);
  assert.deepEqual(await regels(w), []);
});
