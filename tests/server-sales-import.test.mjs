// tests/server-sales-import.test.mjs — POST /api/sales-import en importeerExport (Task 12).
// Alle namen, e-mails en nummers zijn verzonnen. Nep-stores, nep-fetch en een vaste klok.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakNepFetch } from './nep-fetch.mjs';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { maakHandler } from '../netlify/functions/sales-import.js';
import { maakHandler as maakSalesHandler } from '../netlify/functions/sales.js';
import { importeerExport } from '../netlify/lib/sales-import-server.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { hashSleutel } from '../netlify/lib/sales-grafsteen.js';

process.env.TZ = 'Europe/Brussels';
const NU0 = Date.parse('2026-10-08T10:00:00.000Z');
const GEHEIM = 'test-geheim-0123456789';
const EIGEN = 'test-sales'; // het id van de testrol 'sales' (metRol)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const exportBestand = (extra = {}) => ({
  geexporteerdOp: '2026-10-08T08:00:00.000Z',
  verantwoordelijke: 'Test Verkoper',
  statussen: ['Nieuw', '1e contactpoging gedaan'],
  aantal: 6,
  leads: [
    { naam: 'Verzonnen', voornaam: 'Annelies', gsm: '+32 470 11 22 33', email: 'annelies@voorbeeld.test', adres: '3640' },
    { naam: 'Bedacht', voornaam: 'Boris', gsm: '0478 44 55 66', email: 'boris@voorbeeld.test', adres: 'Teststraat 5, 2830 Willebroek' },
    { naam: 'Fictief', voornaam: 'Carla', gsm: '+32000000', email: 'carla@voorbeeld.test', adres: 'bij de oude molen' },
    { naam: 'Nagemaakt', voornaam: 'Dirk', gsm: '0499 77 88 99', adres: '9000' },
    { naam: 'Gespeeld', voornaam: 'Els', email: 'els@voorbeeld.test', adres: '2000' },
    { naam: 'Proef', voornaam: 'Fons', adres: '3500' },
  ],
  ...extra,
});

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const router = () => url => {
  if (url.includes('/geocode/')) return json({ results: [{ position: { lat: 51.5, lon: 5.5 } }] });
  if (url.includes('structuredGeocode')) {
    const pc = /postalCode=(\d+)/.exec(url)[1];
    return json({ results: [{ position: { lat: 50.5, lon: 4.5 }, address: { postalCode: pc, municipality: 'Gemeente ' + pc } }] });
  }
  return undefined;
};

function opzet({ begin = {}, testBegin = {}, geheim = () => GEHEIM, wrap, fetchFn } = {}) {
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers: [{ id: 'u-bea', naam: 'Bea', rol: 'beheerder', actief: true }] }, ...begin });
  const test = maakNepStore(testBegin);
  const { fn, calls } = maakNepFetch(router());
  const gets = [];
  const getStore = opties => { gets.push(opties.name); return (wrap ?? (s => s))(opties.name === 'blitz-data' ? echt : test, opties.name); };
  const h = maakHandler({ getStore, fetch: fetchFn ?? fn, nu: () => NU0, sleutel: () => 'NEP', geheim });
  const hSales = maakSalesHandler({ getStore, fetch: fn, nu: () => NU0, sleutel: () => 'NEP', geheim });
  return { echt, test, h, hSales, calls, gets };
}

const req = (methode, { body, rauw, headers = {}, pad = 'sales-import', zoek = '' } = {}) => new Request(`http://localhost/api/${pad}${zoek}`, {
  method: methode,
  headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers },
  body: rauw ?? (body === undefined ? undefined : JSON.stringify(body)),
});
const post = (exp, o = {}) => req('POST', { body: { export: exp }, ...o });
const lees = async res => ({ status: res.status, body: res.status === 204 ? undefined : await res.json(), headers: res.headers });
const importeer = async (h, exp = exportBestand(), o = {}) => lees(await metRol('sales', () => h(post(exp, o))));
const blobVan = (store, id = EIGEN) => JSON.parse(store._data.get(`sales/${id}`));
const logItems = echt => JSON.parse(echt._data.get('activiteit/2026-10') ?? '{"items":[]}').items;
const schrijvenNaar = (store, sleutel) => store._schrijfacties.filter(a => a.key === sleutel).length;

// ---------------- rechten ----------------
test('rechtenrij: sales-import enkel POST, voor beheerder (enkel een manuele lead, in de functie afgedwongen) en sales', () => {
  assert.deepEqual([...RECHTEN['sales-import'].POST].sort(), ['beheerder', 'sales']);
  assert.equal(RECHTEN['sales-import']['*'], undefined);
  for (const m of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.equal(RECHTEN['sales-import'][m], undefined, m);
});

test('toegang: beheerder (met een echt exportbestand), planner en technieker -> 403 geen-recht, geen store aangeraakt', async () => {
  for (const rol of ['beheerder', 'planner', 'technieker']) {
    const { h, gets } = opzet();
    const r = await metRol(rol, async () => lees(await h(post(exportBestand()))));
    assert.equal(r.status, 403, rol);
    assert.equal(r.body.code, 'geen-recht', rol);
    assert.deepEqual(gets, [], rol);
  }
});

test('toegang: zonder sessie -> 401; OPTIONS -> 204 zonder login en zonder store', async () => {
  const { h, gets } = opzet();
  const r = await metGeenSessie(async () => lees(await h(post(exportBestand()))));
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'niet-ingelogd');
  const o = await metGeenSessie(async () => h(new Request('http://localhost/api/sales-import', { method: 'OPTIONS' })));
  assert.equal(o.status, 204);
  assert.match(o.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(o.headers.get('Access-Control-Allow-Headers'), /X-Blitz-Test/);
  assert.deepEqual(gets, []);
});

test('toegang: GET -> 405 van de wrapper', async () => {
  const { h } = opzet();
  const r = await metRol('sales', async () => lees(await h(req('GET'))));
  assert.equal(r.status, 405);
});

test('toegang: een verkoper die een ander id meegeeft -> 403, niets geschreven (ook niet in het eigen blob); het eigen id mag', async () => {
  const { h, echt } = opzet({ begin: { 'sales/u-sam': { versie: 1, leads: [], blokken: [], grafstenen: [] } } });
  for (const exp of [exportBestand(), manueel()]) {
    const r = await importeer(h, exp, { zoek: '?gebruiker=u-sam' });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'geen-recht');
  }
  assert.equal(echt._data.get(`sales/${EIGEN}`), undefined);
  assert.deepEqual(blobVan(echt, 'u-sam').leads, []);
  const eigen = await importeer(h, exportBestand(), { zoek: `?gebruiker=${EIGEN}` });
  assert.equal(eigen.status, 200);
  assert.equal(blobVan(echt).leads.length, 6);
});

// ---------------- de import ----------------
test('import van de fixture: samenvatting, antwoordvorm, blob met locaties en id\'s zonder persoonsgegevens', async () => {
  const { h, echt } = opzet();
  const r = await importeer(h);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.samenvatting, { nieuw: 6, alAanwezig: 0, adresNakijken: 1, eerderVerwijderd: 0, overgeslagen: 0 });
  assert.deepEqual(r.body.export, {
    verantwoordelijke: 'Test Verkoper', geexporteerdOp: '2026-10-08T08:00:00.000Z', aantal: 6, statussen: ['Nieuw', '1e contactpoging gedaan'],
  });
  assert.equal(r.body.versie, blobVan(echt).versie);
  assert.equal(r.body.open, 0);
  assert.ok(!JSON.stringify(r.body).includes('grafstenen'));
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const b = blobVan(echt);
  assert.equal(b.leads.length, 6);
  const metPostcode = b.leads.filter(l => l.postcode);
  assert.equal(metPostcode.length, 5);
  assert.ok(metPostcode.every(l => l.locatie && Number.isFinite(l.locatie.lat)), 'locatie via geocoding');
  assert.equal(b.leads.find(l => l.voornaam === 'Boris').locatie.bron, 'adres');
  assert.equal(b.leads.find(l => l.voornaam === 'Carla').adresTekst, 'bij de oude molen');
  for (const l of b.leads) {
    assert.match(l.id, UUID, 'willekeurig id');
    assert.equal(l.status, 'te-plannen');
    assert.equal(l.geimporteerdOp, new Date(NU0).toISOString());
    assert.deepEqual(l.bronExport, { verantwoordelijke: 'Test Verkoper', geexporteerdOp: '2026-10-08T08:00:00.000Z' });
  }
  assert.equal(new Set(b.leads.map(l => l.id)).size, 6);
});

test('import: het activiteitenlog bevat één regel sales-import met enkel aantallen en geen persoonsgegevens', async () => {
  const { h, echt } = opzet();
  await importeer(h);
  const items = logItems(echt);
  assert.equal(items.length, 1);
  assert.equal(items[0].actie, 'sales-import');
  assert.equal(items[0].gebruikerId, EIGEN);
  assert.deepEqual(JSON.parse(items[0].details), { nieuw: 6, alAanwezig: 0, adresNakijken: 1, eerderVerwijderd: 0 });
  const heleLog = JSON.stringify(echt._data.get('activiteit/2026-10')).toLowerCase();
  for (const geheim of ['verzonnen', 'annelies', 'bedacht', 'boris', 'voorbeeld.test', '470 11', '32470', 'willebroek', 'teststraat', 'molen']) {
    assert.ok(!heleLog.includes(geheim), `"${geheim}" staat in het log`);
  }
  // ook de lead-id's (willekeurig) staan er niet in
  for (const l of blobVan(echt).leads) assert.ok(!heleLog.includes(l.id));
});

test('import: lead-id\'s zijn willekeurig (twee importen van hetzelfde bestand in aparte blobs geven andere id\'s)', async () => {
  const a = opzet(); const b = opzet();
  await importeer(a.h); await importeer(b.h);
  const idsA = blobVan(a.echt).leads.map(l => l.id);
  const idsB = blobVan(b.echt).leads.map(l => l.id);
  assert.equal(idsA.filter(id => idsB.includes(id)).length, 0);
});

test('tweede import van hetzelfde bestand: nieuw 0 en de blobversie blijft gelijk (geen schrijfactie op het blob)', async () => {
  const { h, echt } = opzet();
  const eerste = await importeer(h);
  const acties = schrijvenNaar(echt, `sales/${EIGEN}`);
  const tweede = await importeer(h);
  assert.equal(tweede.status, 200);
  assert.equal(tweede.body.samenvatting.nieuw, 0);
  assert.equal(tweede.body.samenvatting.alAanwezig, 6);
  assert.equal(tweede.body.versie, eerste.body.versie);
  assert.equal(blobVan(echt).versie, eerste.body.versie);
  assert.equal(schrijvenNaar(echt, `sales/${EIGEN}`), acties);
  assert.equal(blobVan(echt).leads.length, 6);
});

test('twee gelijktijdige importen van hetzelfde bestand: samen precies 6 leads, geen dubbels', async () => {
  const { h, echt } = opzet();
  const [a, b] = await metRol('sales', () => Promise.all([
    h(post(exportBestand())).then(lees), h(post(exportBestand())).then(lees),
  ]));
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.body.samenvatting.nieuw + b.body.samenvatting.nieuw, 6);
  const leads = blobVan(echt).leads;
  assert.equal(leads.length, 6);
  assert.equal(new Set(leads.map(l => l.id)).size, 6);
  assert.equal(new Set(leads.map(l => l.email ?? l.gsm ?? l.voornaam)).size, 6);
});

test('import in twee stappen: een aangevuld bestand voegt enkel de nieuwe leads toe', async () => {
  const { h, echt } = opzet();
  const half = exportBestand(); half.leads = half.leads.slice(0, 3);
  await importeer(h, half);
  const r = await importeer(h);
  assert.deepEqual([r.body.samenvatting.nieuw, r.body.samenvatting.alAanwezig], [3, 3]);
  assert.equal(blobVan(echt).leads.length, 6);
});

test('een export van een andere verantwoordelijke wordt niet geblokkeerd en staat in export.verantwoordelijke', async () => {
  const { h } = opzet();
  const r = await importeer(h, exportBestand({ verantwoordelijke: 'Iemand Anders' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.export.verantwoordelijke, 'Iemand Anders');
});

test('overgeslagen items (zonder naam, gsm of e-mail) worden geteld', async () => {
  const { h } = opzet();
  const exp = exportBestand(); exp.leads = [...exp.leads.slice(0, 2), {}, { adres: '3000' }, 'tekst', null];
  const r = await importeer(h, exp);
  assert.equal(r.status, 200);
  assert.equal(r.body.samenvatting.nieuw, 2);
  assert.equal(r.body.samenvatting.overgeslagen, 4);
});

// ---------------- grafstenen (besluit a) ----------------
test('grafsteen: een verwijderde lead komt bij herimport terug mét eerderVerwijderd; de grafsteen is verbruikt; derde import nieuw 0', async () => {
  const { h, hSales, echt } = opzet();
  await importeer(h);
  const doel = blobVan(echt).leads.find(l => l.voornaam === 'Boris');
  const del = await metRol('sales', async () => lees(await hSales(req('DELETE', { pad: 'sales', zoek: `?lead=${doel.id}` }))));
  assert.equal(del.status, 200);
  assert.equal(blobVan(echt).grafstenen.length, 1);
  const r = await importeer(h);
  assert.equal(r.status, 200);
  assert.equal(r.body.samenvatting.nieuw, 1);
  assert.equal(r.body.samenvatting.eerderVerwijderd, 1);
  assert.ok(!JSON.stringify(r.body).includes('grafstenen'));
  const b = blobVan(echt);
  assert.equal(b.leads.length, 6);
  const terug = b.leads.find(l => l.voornaam === 'Boris');
  assert.match(terug.eerderVerwijderd.op, /^2026-10-08T/);
  assert.notEqual(terug.id, doel.id);
  assert.deepEqual(b.grafstenen, [], 'grafsteen verbruikt');
  assert.deepEqual(JSON.parse(logItems(echt).at(-1).details), { nieuw: 1, alAanwezig: 5, adresNakijken: 0, eerderVerwijderd: 1 });
  const derde = await importeer(h);
  assert.equal(derde.body.samenvatting.nieuw, 0);
  assert.equal(derde.body.samenvatting.eerderVerwijderd, 0);
});

test('grafsteen: een lead die enkel nog op gsm of enkel op e-mail overeenkomt krijgt het label ook', async () => {
  const { h, hSales, echt } = opzet();
  await importeer(h);
  const leads = blobVan(echt).leads;
  for (const v of ['Annelies', 'Els']) {
    await metRol('sales', async () => hSales(req('DELETE', { pad: 'sales', zoek: `?lead=${leads.find(l => l.voornaam === v).id}` })));
  }
  assert.equal(blobVan(echt).grafstenen.length, 2);
  // Annelies: zelfde gsm (ander formaat), nieuw e-mailadres; Els: enkel nog het e-mailadres (hoofdletters)
  const exp = exportBestand();
  exp.leads = [
    { naam: 'Verzonnen', voornaam: 'Annelies', gsm: '0470/11.22.33', email: 'nieuw-adres@voorbeeld.test', adres: '3640' },
    { naam: 'Gespeeld', voornaam: 'Els', email: 'ELS@voorbeeld.test', adres: '2000' },
  ];
  const r = await importeer(h, exp);
  assert.equal(r.body.samenvatting.nieuw, 2);
  assert.equal(r.body.samenvatting.eerderVerwijderd, 2);
  assert.equal(blobVan(echt).leads.filter(l => l.eerderVerwijderd).length, 2);
});

test('grafsteen: zonder SESSIE_GEHEIM wordt er niet gehasht en dus geen label gezet (de import slaagt)', async () => {
  const { h, hSales, echt } = opzet({ geheim: () => undefined });
  await importeer(h);
  // zonder geheim maakt DELETE geen grafsteen; een herimport zet de lead terug als gewone nieuwe lead
  const doel = blobVan(echt).leads.find(l => l.voornaam === 'Boris');
  await metRol('sales', async () => hSales(req('DELETE', { pad: 'sales', zoek: `?lead=${doel.id}` })));
  const r = await importeer(h);
  assert.equal(r.status, 200);
  assert.equal(r.body.samenvatting.nieuw, 1);
  assert.equal(r.body.samenvatting.eerderVerwijderd, 0);
});

test('grafsteen: gehasht met het geheim en het verkoper-id (sleutelvorm e:/g:/n:)', async () => {
  const { h, hSales, echt } = opzet();
  await importeer(h);
  const doel = blobVan(echt).leads.find(l => l.voornaam === 'Fons');
  await metRol('sales', async () => hSales(req('DELETE', { pad: 'sales', zoek: `?lead=${doel.id}` })));
  assert.deepEqual(blobVan(echt).grafstenen[0].h, [hashSleutel('n:fons|proef|3500', EIGEN, GEHEIM)]);
});

// ---------------- ongeldige invoer ----------------
test('kapotte export: 400 met de tekst uit leesExport; blob onaangeroerd', async () => {
  const { h, echt } = opzet();
  for (const [exp, tekst] of [
    [{ geen: 'leads' }, 'Geen geldige export: "leads" ontbreekt'],
    [{ leads: 'x' }, 'Geen geldige export: "leads" ontbreekt'],
  ]) {
    const r = await importeer(h, exp);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, tekst);
  }
  assert.ok(!echt._data.has(`sales/${EIGEN}`));
  assert.deepEqual(logItems(echt), []);
});

test('meer dan 500 leads -> 400', async () => {
  const { h } = opzet();
  const exp = { leads: Array.from({ length: 501 }, (_, i) => ({ naam: 'N' + i, voornaam: 'V', email: `x${i}@voorbeeld.test` })) };
  const r = await importeer(h, exp);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Maximaal 500 leads per bestand');
});

test('exact 500 leads is nog toegestaan', async () => {
  const { h, echt } = opzet();
  const exp = { leads: Array.from({ length: 500 }, (_, i) => ({ naam: 'N' + i, voornaam: 'V', email: `x${i}@voorbeeld.test` })) };
  const r = await importeer(h, exp);
  assert.equal(r.status, 200);
  assert.equal(blobVan(echt).leads.length, 500);
});

test('body groter dan 3 MB -> 413 met de bestandsgroottetekst, zonder iets te schrijven', async () => {
  const { h, echt } = opzet();
  const groot = JSON.stringify({ export: { leads: [], vulling: 'a'.repeat(3 * 1024 * 1024 + 10) } });
  const r = await metRol('sales', async () => lees(await h(req('POST', { rauw: groot }))));
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'Het bestand is groter dan 2 MB');
  assert.ok(!echt._data.has(`sales/${EIGEN}`));
});

test('Content-Length boven 3 MB -> 413 vóór het lezen van de body, zonder store-toegang (de controle na het lezen blijft gelden)', async () => {
  const { h, gets } = opzet();
  const r = await metRol('sales', async () => lees(await h(req('POST', { rauw: '{"export":{"leads":[]}}', headers: { 'content-length': String(3 * 1024 * 1024 + 1) } }))));
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'Het bestand is groter dan 2 MB');
  assert.deepEqual(gets, []);
  // een gelogen kleine Content-Length met een te grote body wordt door de controle na het lezen alsnog tegengehouden
  const groot = JSON.stringify({ export: { leads: [], vulling: 'a'.repeat(3 * 1024 * 1024 + 10) } });
  const r2 = await metRol('sales', async () => lees(await h(req('POST', { rauw: groot, headers: { 'content-length': '10' } }))));
  assert.equal(r2.status, 413);
});

test('Content-Length ontbreekt of is onzin: de gewone controle beslist (kleine import slaagt)', async () => {
  const { h } = opzet();
  const rauw = JSON.stringify({ export: exportBestand() });
  for (const cl of [undefined, 'abc', '-5']) {
    const r = await metRol('sales', async () => lees(await h(req('POST', { rauw, headers: cl === undefined ? {} : { 'content-length': cl } }))));
    assert.equal(r.status, 200, String(cl));
  }
});

test('ongeldige body: geen JSON, geen object, export ontbreekt of is geen object -> 400', async () => {
  const { h } = opzet();
  for (const rauw of ['{kapot', '[]', 'null', '"tekst"', '{}', '{"export":null}', '{"export":[]}', '{"export":"{\\"leads\\":[]}"}', '{"export":5}']) {
    const r = await metRol('sales', async () => lees(await h(req('POST', { rauw }))));
    assert.equal(r.status, 400, rauw);
    assert.equal(typeof r.body.error, 'string');
  }
});

test('__proto__-sleutels (overal in het bestand) -> 400, niets geschreven en het prototype blijft schoon', async () => {
  const { h, echt } = opzet();
  const lek = '{"export":{"leads":[{"naam":"Proef","voornaam":"Gert","email":"g@voorbeeld.test","__proto__":{"gepolluteerd":true}}]}}';
  const diep = '{"export":{"leads":[],"statussen":[{"a":{"b":{"__proto__":{"x":1}}}}]}}';
  for (const rauw of [lek, diep]) {
    const r = await metRol('sales', async () => lees(await h(req('POST', { rauw }))));
    assert.equal(r.status, 400);
  }
  assert.equal({}.gepolluteerd, undefined);
  assert.ok(!echt._data.has(`sales/${EIGEN}`));
});

test('de velden van een lead worden afgekapt en nooit als iets anders dan tekst bewaard', async () => {
  const { h, echt } = opzet();
  const exp = { leads: [{ naam: 'x'.repeat(5000), voornaam: { toString: 'boem' }, email: 'lang@voorbeeld.test', adres: '3640' }] };
  const r = await importeer(h, exp);
  assert.equal(r.status, 200);
  const l = blobVan(echt).leads[0];
  assert.equal(l.naam.length, 200);
  assert.equal(l.voornaam, null);
});

// ---------------- uitval ----------------
test('TomTom valt uit (fetch gooit): de import slaagt, de leads staan er zonder locatie en open = aantal leads met postcode', async () => {
  const { h, echt } = opzet({ fetchFn: async () => { throw new Error('netwerk weg'); } });
  const r = await importeer(h);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.samenvatting.nieuw, 6);
  const b = blobVan(echt);
  assert.equal(b.leads.length, 6);
  const zonder = b.leads.filter(l => l.postcode && !l.locatie);
  assert.equal(zonder.length, 5);
  assert.equal(r.body.open, 5);
});

const kapotLezen = s => ({ ...s, get: async (k, o) => { if (k.startsWith('sales/')) throw new Error('blobs onbereikbaar'); return s.get(k, o); } });
const kapotSchrijven = s => ({ ...s, setJSON: async k => { if (k.startsWith('sales/')) throw new Error('blobs onbereikbaar'); throw new Error('onverwacht'); } });

test('opslagstoring (lezen of schrijven): 503 opslag-storing, het blob blijft leeg (geen gedeeltelijke import) en niets gelogd', async () => {
  for (const [naam, wrap] of [['lezen', kapotLezen], ['schrijven', kapotSchrijven]]) {
    const { h, echt } = opzet({ wrap: (s, n) => (n === 'blitz-data' ? wrap(s) : s) });
    const r = await importeer(h);
    assert.equal(r.status, 503, naam);
    assert.equal(r.body.code, 'opslag-storing', naam);
    assert.ok(!echt._data.has(`sales/${EIGEN}`), naam);
    assert.deepEqual(logItems(echt), [], naam);
  }
});

test('getStore zelf faalt -> 503 opslag-storing; de foutlog bevat enkel het fouttype', async () => {
  const fouten = [];
  const oud = console.error; console.error = (...a) => fouten.push(a.join(' '));
  try {
    const h = maakHandler({ getStore: () => { throw new Error('geheim detail van blobs'); }, fetch: async () => { throw new Error('x'); }, nu: () => NU0, geheim: () => GEHEIM });
    const r = await metRol('sales', async () => lees(await h(post(exportBestand()))));
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'opslag-storing');
  } finally { console.error = oud; }
  assert.ok(fouten.length >= 1);
  assert.ok(!fouten.join('\n').includes('geheim detail'));
});

// ---------------- testmodus ----------------
test('testmodus: X-Blitz-Test -> teststore, geen TomTom, geen activiteitenlog in de echte store', async () => {
  const { h, echt, test: teststore, calls } = opzet({ testBegin: {} });
  const r = await importeer(h, exportBestand(), { headers: { 'x-blitz-test': '1' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(calls.length, 0);
  assert.equal(r.body.open, 0);
  assert.equal(blobVan(teststore).leads.length, 6);
  assert.ok(!echt._data.has(`sales/${EIGEN}`));
  assert.deepEqual(logItems(echt), []);
});

// ---------------- importeerExport (rechtstreeks) ----------------
test('importeerExport: geeft { status, json } volgens het contract en gebruikt de aangereikte nieuwId en log', async () => {
  const echt = maakNepStore();
  const log = [];
  let n = 0;
  const r = await importeerExport({
    store: echt, doelId: 'u-x', gebruiker: { id: 'u-x', rol: 'sales' }, body: { export: exportBestand() }, nu: () => NU0,
    nieuwId: () => 'id-' + (++n), deps: { fetch: maakNepFetch(router()).fn, sleutel: 'NEP', testModus: false, geheim: () => GEHEIM },
    log: async d => log.push(d),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['export', 'open', 'samenvatting', 'versie']);
  assert.deepEqual(blobVan(echt, 'u-x').leads.map(l => l.id), ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6']);
  assert.deepEqual(log, [{ actie: 'sales-import', details: { nieuw: 6, alAanwezig: 0, adresNakijken: 1, eerderVerwijderd: 0 } }]);
});

// ---------------- een lead manueel toevoegen (Task 14b): bron 'manueel' ----------------
const manueel = (extra = {}, lead = {}) => ({
  bron: 'manueel', verantwoordelijke: null, geexporteerdOp: null, aantal: 1, statussen: [],
  leads: [{ voornaam: 'Greet', naam: 'Peeters', gsm: '0470 11 22 33', email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, notitie: 'Bel na vijf uur', ...lead }],
  ...extra,
});

test('manueel: één lead met het minimum wordt een nieuwe lead met notitie, herkomst "manueel" en een postcode-locatie', async () => {
  const { h, echt } = opzet();
  const r = await importeer(h, manueel());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.samenvatting, { nieuw: 1, alAanwezig: 0, adresNakijken: 0, eerderVerwijderd: 0, overgeslagen: 0 });
  const [l] = blobVan(echt).leads;
  assert.equal(l.voornaam, 'Greet');
  assert.equal(l.notitie, 'Bel na vijf uur');
  assert.equal(l.status, 'te-plannen');
  assert.equal(l.postcode, '3500');
  assert.deepEqual(l.bronExport, { verantwoordelijke: null, geexporteerdOp: null, bron: 'manueel' });
  assert.equal(l.locatie.bron, 'postcode');
  assert.match(l.id, UUID);
});

test('manueel: het minimum wordt ook op de server afgedwongen (400 met een Nederlandse tekst, niets bewaard)', async () => {
  const { h, echt } = opzet();
  const gevallen = [
    [{ voornaam: '', naam: '' }, 'Vul een naam in'],
    [{ gsm: null, email: null }, 'Vul een gsm-nummer of e-mailadres in'],
    [{ postcode: null }, 'Vul een postcode in'],
    [{ postcode: '35' }, 'Postcode bestaat uit 4 cijfers'],
    [{ gsm: '0470 11', email: null }, 'Dit gsm-nummer lijkt niet te kloppen'],
    [{ straat: 'Dorpsstraat' }, 'Vul straat én huisnummer in'],
  ];
  for (const [lead, tekst] of gevallen) {
    const r = await importeer(h, manueel({}, lead));
    assert.equal(r.status, 400, JSON.stringify(lead));
    assert.equal(r.body.error, tekst);
  }
  assert.equal(echt._data.get(`sales/${EIGEN}`), undefined, 'niets bewaard');
});

test('manueel: precies één lead (nul of meerdere -> 400); een gewone export met een onbekende bron blijft een gewone export', async () => {
  const { h, echt } = opzet();
  const leeg = await importeer(h, manueel({ leads: [] }));
  assert.equal(leeg.status, 400);
  const twee = manueel();
  twee.leads.push({ ...twee.leads[0], gsm: '0471 22 33 44' });
  assert.equal((await importeer(h, twee)).status, 400);
  assert.equal(echt._data.get(`sales/${EIGEN}`), undefined);
  const gewoon = await importeer(h, exportBestand({ bron: 'iets-anders' }));
  assert.equal(gewoon.status, 200);
  assert.equal(gewoon.body.samenvatting.nieuw, 6);
});

test('manueel: dezelfde gsm of hetzelfde e-mailadres als een bestaande lead -> al aanwezig, geen dubbele lead', async () => {
  const { h, echt } = opzet();
  await importeer(h, manueel());
  const nogmaals = await importeer(h, manueel({}, { voornaam: 'Greta', gsm: '+32 470 11 22 33', notitie: 'andere notitie' }));
  assert.equal(nogmaals.status, 200);
  assert.deepEqual([nogmaals.body.samenvatting.nieuw, nogmaals.body.samenvatting.alAanwezig], [0, 1]);
  const leads = blobVan(echt).leads;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].voornaam, 'Greet'); // wat er al stond blijft
  assert.equal(leads[0].notitie, 'Bel na vijf uur');
  // ook een lead uit een gewone export wordt herkend
  const { h: h2, echt: echt2 } = opzet();
  await importeer(h2, exportBestand());
  const r = await importeer(h2, manueel({}, { voornaam: 'Dirk', naam: 'Nagemaakt', gsm: '0499 77 88 99', postcode: '9000', notitie: null }));
  assert.equal(r.body.samenvatting.alAanwezig, 1);
  assert.equal(blobVan(echt2).leads.length, 6);
});

test('manueel: een eerder verwijderde klant komt terug met het label "eerder verwijderd" (grafsteen)', async () => {
  const { h, hSales, echt } = opzet();
  await importeer(h, manueel());
  const [doel] = blobVan(echt).leads;
  const del = await metRol('sales', async () => lees(await hSales(req('DELETE', { pad: 'sales', zoek: `?lead=${doel.id}` }))));
  assert.equal(del.status, 200);
  const terug = await importeer(h, manueel());
  assert.equal(terug.body.samenvatting.nieuw, 1);
  assert.equal(terug.body.samenvatting.eerderVerwijderd, 1);
  const l = blobVan(echt).leads[0];
  assert.match(l.eerderVerwijderd.op, /^2026-10-08T/);
  assert.equal(l.bronExport.bron, 'manueel');
});

test('manueel: het activiteitenlog bevat enkel aantallen en de bron, nooit persoonsgegevens', async () => {
  const { h, echt } = opzet();
  await importeer(h, manueel());
  const items = logItems(echt);
  assert.equal(items.length, 1);
  assert.equal(items[0].actie, 'sales-import');
  assert.deepEqual(JSON.parse(items[0].details), { nieuw: 1, alAanwezig: 0, adresNakijken: 0, eerderVerwijderd: 0, bron: 'manueel' });
  const heleLog = JSON.stringify(echt._data.get('activiteit/2026-10')).toLowerCase();
  for (const geheim of ['greet', 'peeters', '470 11', '32470', 'hasselt', 'bel na vijf']) assert.ok(!heleLog.includes(geheim), `"${geheim}" staat in het log`);
});

test('manueel: een volledig adres wordt gegeocodeerd (adres-locatie); de notitie blijft bij een latere export staan', async () => {
  const { h, echt } = opzet();
  await importeer(h, manueel({}, { straat: 'Teststraat', huisnr: '5', postcode: '2830', gemeente: 'Willebroek' }));
  const l = blobVan(echt).leads[0];
  assert.equal(l.straat, 'Teststraat');
  assert.equal(l.locatie.bron, 'adres');
  // dezelfde persoon (zelfde gsm) in een gewone export: de lead blijft één lead met zijn notitie
  const r = await importeer(h, exportBestand({ aantal: 1, leads: [{ naam: 'Peeters', voornaam: 'Greet', gsm: '+32 470 11 22 33', adres: '2830 Willebroek' }] }));
  assert.equal(r.body.samenvatting.alAanwezig, 1);
  assert.equal(blobVan(echt).leads.length, 1);
  assert.equal(blobVan(echt).leads[0].notitie, 'Bel na vijf uur');
});

// ---------------- de beheerder voegt een manuele lead toe voor een verkoper ----------------
const GEBRUIKERS = { versie: 1, gebruikers: [
  { id: 'u-bea', naam: 'Bea', rol: 'beheerder', actief: true },
  { id: 'u-sam', naam: 'Sam', rol: 'sales', actief: true },
  { id: 'u-weg', naam: 'Wim', rol: 'sales', actief: false },
  { id: 'u-tim', naam: 'Tim', rol: 'technieker', actief: true },
] };
const alsBeheerder = async (h, exp, zoek) => lees(await metRol('beheerder', () => h(post(exp, { zoek }))));
const opzetBeheer = () => opzet({ begin: { gebruikers: GEBRUIKERS, 'sales/u-sam': { versie: 1, leads: [], blokken: [], grafstenen: [] } } });

test('beheerder: een manuele lead voor een actieve verkoper komt in het blob van die verkoper (niet in dat van de beheerder), met een logregel', async () => {
  const { h, echt } = opzetBeheer();
  const r = await alsBeheerder(h, manueel(), '?gebruiker=u-sam');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.samenvatting.nieuw, 1);
  const l = blobVan(echt, 'u-sam').leads;
  assert.equal(l.length, 1);
  assert.equal(l[0].voornaam, 'Greet');
  assert.equal(l[0].bronExport.bron, 'manueel');
  assert.equal(echt._data.get('sales/test-beheerder'), undefined);
  const items = logItems(echt);
  assert.equal(items.length, 1);
  assert.equal(items[0].actie, 'sales-import');
  assert.equal(items[0].gebruikerId, 'test-beheerder'); // wie
  assert.equal(items[0].onderwerp, 'u-sam');            // voor welke verkoper
  assert.deepEqual(JSON.parse(items[0].details), { nieuw: 1, alAanwezig: 0, adresNakijken: 0, eerderVerwijderd: 0, bron: 'manueel', voorVerkoper: true });
});

test('beheerder: zonder verkoper, met een niet-verkoper of onbekend id -> 404; met een geblokkeerde verkoper -> 403 geblokkeerd; niets geschreven', async () => {
  for (const [zoek, status, code] of [['', 404], ['?gebruiker=u-tim', 404], ['?gebruiker=u-bea', 404], ['?gebruiker=bestaat-niet', 404], ['?gebruiker=u-weg', 403, 'geblokkeerd']]) {
    const { h, echt } = opzetBeheer();
    const r = await alsBeheerder(h, manueel(), zoek);
    assert.equal(r.status, status, zoek);
    if (code) assert.equal(r.body.code, code, zoek);
    assert.equal(echt._data.get('sales/u-weg'), undefined, zoek);
    assert.deepEqual(blobVan(echt, 'u-sam').leads, [], zoek);
    assert.deepEqual(logItems(echt), [], zoek);
  }
});

test('beheerder: een echt exportbestand (of een andere bron) -> 403, ook met een geldige verkoper; "Export laden" blijft voor de verkoper zelf', async () => {
  for (const exp of [exportBestand(), { ...manueel(), bron: 'anders' }, { ...manueel(), bron: undefined }]) {
    const { h, echt } = opzetBeheer();
    const r = await alsBeheerder(h, exp, '?gebruiker=u-sam');
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'geen-recht');
    assert.deepEqual(blobVan(echt, 'u-sam').leads, []);
  }
});

test('beheerder: het minimum van een manuele lead blijft gelden (400), en testverzoek met test-sales is geldig', async () => {
  const { h, echt } = opzetBeheer();
  const slecht = await alsBeheerder(h, manueel({}, { voornaam: null, naam: null }), '?gebruiker=u-sam');
  assert.equal(slecht.status, 400);
  assert.deepEqual(blobVan(echt, 'u-sam').leads, []);
  const proef = await metRol('beheerder', async () => lees(await h(post(manueel(), { zoek: '?gebruiker=test-sales', headers: { 'x-blitz-test': '1' } }))));
  assert.equal(proef.status, 200, JSON.stringify(proef.body));
});
