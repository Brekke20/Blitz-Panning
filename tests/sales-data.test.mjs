// Client-gegevenslaag voor de sales-schermen (Task 10): fetch via zetFetch, timers via mock.timers. Verzonnen gegevens.
process.env.TZ = 'Europe/Brussels';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { zetFetch } from '../public/js/kern/api.js';
import {
  salesToestand, onSalesWijziging, laadSales, laadInstellingen, bewaarInstellingen, wijzig, importeer,
  verwijderMetOngedaan, spoelUitgesteld, gekozenDatum, zetGekozenDatum, SALES_STANDAARD, resetSales,
} from '../public/js/schermen/sales-data.js';

// Nep-fetch: antwoorden in volgorde (Error => netwerkfout); onthoudt de aanroepen.
function nepFetch(...antwoorden) {
  const aanroepen = [];
  const fn = async (pad, init) => {
    aanroepen.push({ pad, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const a = antwoorden.shift();
    if (a === undefined) throw new Error('onverwachte aanroep ' + pad);
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => { if (a.json === undefined) throw new Error('geen json'); return a.json; } };
  };
  fn.aanroepen = aanroepen;
  return fn;
}
const lead = (id, extra = {}) => ({ id, naam: 'Test ' + id, status: 'te-plannen', ...extra });
const blob = (versie, leads = [], blokken = [], extra = {}) => ({ gebruikerId: 'u-1', versie, leads, blokken, ...extra });
const STORING = { status: 503, json: { error: 'Opslag niet bereikbaar', code: 'opslag-storing' } };

beforeEach(() => resetSales());
afterEach(() => { resetSales(); zetFetch(null); mock.timers.reset(); });

// ---- laadSales ----

test('laadSales zonder gebruikerId: GET /api/sales, vult leads, blokken, versie en gebruikerId', async () => {
  const f = nepFetch({ status: 200, json: blob(4, [lead('a')], [{ id: 'b1' }]) });
  zetFetch(f);
  const r = await laadSales();
  assert.equal(r.ok, true);
  assert.equal(f.aanroepen[0].pad, '/api/sales');
  const t = salesToestand();
  assert.equal(t.versie, 4);
  assert.equal(t.gebruikerId, 'u-1');
  assert.deepEqual(t.leads.map(l => l.id), ['a']);
  assert.deepEqual(t.blokken, [{ id: 'b1' }]);
});

test('laadSales met gebruikerId: ?gebruiker=<id> (url-gecodeerd)', async () => {
  const f = nepFetch({ status: 200, json: blob(1) });
  zetFetch(f);
  await laadSales({ gebruikerId: 'u 2&x' });
  assert.equal(f.aanroepen[0].pad, '/api/sales?gebruiker=u%202%26x');
});

test('laadSales: 503 opslag-storing -> { ok:false, status:503, opslag:true } en de toestand blijft staan', async () => {
  zetFetch(nepFetch({ status: 200, json: blob(2, [lead('a')]) }, STORING));
  await laadSales();
  assert.deepEqual(await laadSales(), { ok: false, status: 503, opslag: true });
  assert.equal(salesToestand().versie, 2);
  assert.equal(salesToestand().leads.length, 1);
});

test('laadSales: andere fouten en netwerkfout gooien niet', async () => {
  zetFetch(nepFetch({ status: 500 }, new TypeError('offline'), { status: 503, json: { error: 'x' } }));
  assert.deepEqual(await laadSales(), { ok: false, status: 500 });
  assert.deepEqual(await laadSales(), { ok: false, status: 0 });
  assert.deepEqual(await laadSales(), { ok: false, status: 503 }); // 503 zonder opslag-storing-code: geen opslag-vlag
});

test('laadSales meldt de abonnees', async () => {
  zetFetch(nepFetch({ status: 200, json: blob(1) }));
  let n = 0;
  onSalesWijziging(() => n++);
  await laadSales();
  assert.equal(n, 1);
});

// ---- instellingen ----

test('laadInstellingen: null -> SALES_STANDAARD (nooit null)', async () => {
  const f = nepFetch({ status: 200, json: { versie: 3, instellingen: null } });
  zetFetch(f);
  assert.equal((await laadInstellingen()).ok, true);
  assert.equal(f.aanroepen[0].pad, '/api/instellingen');
  const t = salesToestand();
  assert.deepEqual(t.instellingen, SALES_STANDAARD);
  assert.deepEqual(t.instellingenRuw, {});
  assert.deepEqual(SALES_STANDAARD, { vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00', werkdagen: [1, 2, 3, 4, 5], bezoekDuurMin: 60 });
});

test('laadInstellingen: bewaarde waarden worden met de standaardwaarden samengevoegd; gebruikerId -> ?gebruiker=', async () => {
  const f = nepFetch({ status: 200, json: { versie: 1, instellingen: { vanTijd: '09:00', startlocatie: 'Hasselt', bezoekDuurMin: 45 } } });
  zetFetch(f);
  await laadInstellingen({ gebruikerId: 'u-7' });
  assert.equal(f.aanroepen[0].pad, '/api/instellingen?gebruiker=u-7');
  const t = salesToestand();
  assert.deepEqual(t.instellingenRuw, { vanTijd: '09:00', startlocatie: 'Hasselt', bezoekDuurMin: 45 });
  assert.deepEqual(t.instellingen, { ...SALES_STANDAARD, vanTijd: '09:00', startlocatie: 'Hasselt', bezoekDuurMin: 45 });
  assert.deepEqual(t.instellingen.werkdagen, [1, 2, 3, 4, 5]);
});

test('laadInstellingen: fout gooit niet en laat de toestand staan; 503 opslag-storing -> opslag:true', async () => {
  zetFetch(nepFetch(STORING, { status: 500 }));
  assert.deepEqual(await laadInstellingen(), { ok: false, status: 503, opslag: true });
  assert.deepEqual(await laadInstellingen(), { ok: false, status: 500 });
  assert.deepEqual(salesToestand().instellingen, SALES_STANDAARD);
});

test('bewaarInstellingen: PUT-body is exact { instellingen }; bij 200 bijgewerkt en gemeld', async () => {
  const f = nepFetch({ status: 200, json: { versie: 5 } });
  zetFetch(f);
  let n = 0;
  onSalesWijziging(() => n++);
  const invoer = { vanTijd: '07:30', startlocatie: '3500' };
  const r = await bewaarInstellingen(invoer);
  assert.equal(r.ok, true);
  const a = f.aanroepen[0];
  assert.equal(a.pad, '/api/instellingen');
  assert.equal(a.init.method, 'PUT');
  assert.deepEqual(a.body, { instellingen: invoer });
  assert.deepEqual(Object.keys(a.body), ['instellingen']);
  assert.deepEqual(salesToestand().instellingenRuw, invoer);
  assert.deepEqual(salesToestand().instellingen, { ...SALES_STANDAARD, ...invoer });
  assert.equal(n, 1);
});

test('bewaarInstellingen: 400 met error -> { ok:false, fout }; 503 -> reden opslag; netwerk -> reden netwerk; toestand ongewijzigd', async () => {
  zetFetch(nepFetch({ status: 400, json: { error: 'Ongeldig uur' } }, STORING, new TypeError('offline'), { status: 500 }));
  const r1 = await bewaarInstellingen({ vanTijd: 'x' });
  assert.equal(r1.ok, false);
  assert.equal(r1.fout, 'Ongeldig uur');
  assert.equal(r1.reden, 'http');
  assert.equal((await bewaarInstellingen({})).reden, 'opslag');
  assert.equal((await bewaarInstellingen({})).reden, 'netwerk');
  assert.equal((await bewaarInstellingen({})).reden, 'http');
  assert.deepEqual(salesToestand().instellingen, SALES_STANDAARD);
});

// ---- wijzig ----

test('wijzig: stuurt { versie, ...patch } naar PATCH /api/sales en neemt het antwoord over', async () => {
  const f = nepFetch(
    { status: 200, json: blob(3, [lead('a')]) },
    { status: 200, json: blob(4, [lead('a', { status: 'gepland' })], [], { open: 2 }) },
  );
  zetFetch(f);
  await laadSales();
  const r = await wijzig({ leads: [{ id: 'a', velden: { status: 'gepland' } }] });
  assert.deepEqual(r, { ok: true, open: 2 });
  const a = f.aanroepen[1];
  assert.equal(a.pad, '/api/sales');
  assert.equal(a.init.method, 'PATCH');
  assert.deepEqual(a.body, { versie: 3, leads: [{ id: 'a', velden: { status: 'gepland' } }] });
  assert.equal(salesToestand().versie, 4);
  assert.equal(salesToestand().leads[0].status, 'gepland');
});

test('wijzig gebruikt ?gebruiker= als laadSales er een kreeg', async () => {
  const f = nepFetch({ status: 200, json: blob(1) }, { status: 200, json: blob(2) });
  zetFetch(f);
  await laadSales({ gebruikerId: 'u-9' });
  await wijzig({ aanvullen: true });
  assert.equal(f.aanroepen[1].pad, '/api/sales?gebruiker=u-9');
  assert.deepEqual(f.aanroepen[1].body, { versie: 1, aanvullen: true });
});

test('wijzig: 409 met data -> server-stand overnemen en de patch EENMAAL opnieuw sturen met de nieuwe versie', async () => {
  const patch = { leads: [{ id: 'a', velden: { notitie: 'mijn' } }] };
  const f = nepFetch(
    { status: 200, json: blob(3, [lead('a')]) },
    { status: 409, json: { error: 'Versiematch mislukt', serverVersie: 5, data: blob(5, [lead('a'), lead('nieuw')]) } },
    { status: 200, json: blob(6, [lead('a', { notitie: 'mijn' }), lead('nieuw')]) },
  );
  zetFetch(f);
  await laadSales();
  const r = await wijzig(patch);
  assert.equal(r.ok, true);
  assert.equal(f.aanroepen.length, 3);
  assert.deepEqual(f.aanroepen[1].body, { versie: 3, ...patch });
  assert.deepEqual(f.aanroepen[2].body, { versie: 5, ...patch }); // dezelfde veld-patch, verse versie
  assert.equal(salesToestand().versie, 6);
  assert.equal(salesToestand().leads.length, 2);
});

test('wijzig: tweede 409 -> { ok:false, reden:"conflict" }, de server-stand is overgenomen, geen derde poging', async () => {
  const f = nepFetch(
    { status: 200, json: blob(3, [lead('a')]) },
    { status: 409, json: { data: blob(4, [lead('a')]) } },
    { status: 409, json: { data: blob(7, [lead('a'), lead('x')]) } },
  );
  zetFetch(f);
  await laadSales();
  const r = await wijzig({ leads: [{ id: 'a', velden: {} }] });
  assert.equal(r.ok, false);
  assert.equal(r.reden, 'conflict');
  assert.equal(f.aanroepen.length, 3);
  assert.equal(salesToestand().versie, 7);
  assert.equal(salesToestand().leads.length, 2);
});

test('wijzig: 409 zonder leesbare server-stand -> reden http (geen herpoging)', async () => {
  const f = nepFetch({ status: 409, json: { error: 'x' } });
  zetFetch(f);
  const r = await wijzig({ aanvullen: true });
  assert.deepEqual([r.ok, r.reden, r.status], [false, 'http', 409]);
  assert.equal(f.aanroepen.length, 1);
});

test('wijzig: 400 met fouten wordt doorgegeven; toestand ongewijzigd', async () => {
  zetFetch(nepFetch({ status: 200, json: blob(3, [lead('a')]) }, { status: 400, json: { error: 'Ongeldig', fouten: ['Lead a: status'] } }));
  await laadSales();
  const r = await wijzig({ leads: [{ id: 'a', velden: { status: 'x' } }] });
  assert.equal(r.ok, false);
  assert.equal(r.reden, 'http');
  assert.deepEqual(r.fouten, ['Lead a: status']);
  assert.equal(salesToestand().versie, 3);
});

test('wijzig: netwerkfout -> reden netwerk; 503 opslag-storing -> reden opslag zonder tweede poging', async () => {
  const f = nepFetch(new TypeError('offline'), STORING);
  zetFetch(f);
  assert.equal((await wijzig({ aanvullen: true })).reden, 'netwerk');
  assert.equal((await wijzig({ aanvullen: true })).reden, 'opslag');
  assert.equal(f.aanroepen.length, 2);
});

test('wijzig: gelijktijdige aanroepen lopen na elkaar (de tweede gebruikt de nieuwe versie)', async () => {
  const f = nepFetch(
    { status: 200, json: blob(1) },
    { status: 200, json: blob(2) },
    { status: 200, json: blob(3) },
  );
  zetFetch(f);
  await laadSales();
  const [r1, r2] = await Promise.all([wijzig({ aanvullen: true }), wijzig({ aanvullen: true })]);
  assert.deepEqual([r1.ok, r2.ok], [true, true]);
  assert.deepEqual(f.aanroepen.slice(1).map(a => a.body.versie), [1, 2]);
});

// ---- importeer ----

test('importeer: POST /api/sales-import { export }, herlaadt daarna de toestand', async () => {
  const f = nepFetch(
    { status: 200, json: { versie: 2, samenvatting: { nieuw: 1, alAanwezig: 0, adresNakijken: 0, eerderVerwijderd: 0, overgeslagen: 0 }, export: { verantwoordelijke: 'Test', aantal: 1 }, open: 0 } },
    { status: 200, json: blob(2, [lead('n')]) },
  );
  zetFetch(f);
  const exp = { leads: [] };
  const r = await importeer(exp);
  assert.equal(r.ok, true);
  assert.equal(r.samenvatting.nieuw, 1);
  assert.equal(r.export.aantal, 1);
  assert.equal(f.aanroepen[0].pad, '/api/sales-import');
  assert.equal(f.aanroepen[0].init.method, 'POST');
  assert.deepEqual(f.aanroepen[0].body, { export: exp });
  assert.equal(f.aanroepen[1].pad, '/api/sales');
  assert.deepEqual(salesToestand().leads.map(l => l.id), ['n']);
});

test('importeer: 400 -> { ok:false, fout }; 503 opslag -> reden opslag; geen herlaad', async () => {
  const f = nepFetch({ status: 400, json: { error: 'Kapotte export' } }, STORING, new TypeError('offline'));
  zetFetch(f);
  const r1 = await importeer({});
  assert.deepEqual([r1.ok, r1.fout], [false, 'Kapotte export']);
  assert.equal((await importeer({})).reden, 'opslag');
  assert.equal((await importeer({})).reden, 'netwerk');
  assert.equal(f.aanroepen.length, 3);
});

// ---- uitgestelde verwijdering ----

async function metLeads(...ids) {
  zetFetch(nepFetch({ status: 200, json: blob(1, ids.map(i => lead(i))) }));
  await laadSales();
}
const tick = () => new Promise(r => setImmediate(r));

test('verwijderMetOngedaan: lead meteen uit de weergave; na 4 999 ms nog geen DELETE; na 5 000 ms precies één', async () => {
  await metLeads('a', 'b');
  mock.timers.enable({ apis: ['setTimeout'] });
  const f = nepFetch({ status: 200, json: { versie: 2 } });
  zetFetch(f);
  let n = 0;
  onSalesWijziging(() => n++);
  verwijderMetOngedaan('a');
  assert.ok(salesToestand().uitgesteld.has('a'));
  assert.equal(n, 1);
  mock.timers.tick(4999);
  await tick();
  assert.equal(f.aanroepen.length, 0);
  mock.timers.tick(1);
  await tick();
  assert.equal(f.aanroepen.length, 1);
  assert.equal(f.aanroepen[0].pad, '/api/sales?lead=a');
  assert.equal(f.aanroepen[0].init.method, 'DELETE');
  assert.equal(f.aanroepen[0].init.keepalive, undefined);
  assert.deepEqual(salesToestand().leads.map(l => l.id), ['b']);
  assert.ok(!salesToestand().uitgesteld.has('a'));
  assert.equal(salesToestand().versie, 2);
  mock.timers.tick(20000);
  await tick();
  assert.equal(f.aanroepen.length, 1);
});

test('verwijderMetOngedaan: ongedaan() vóór 5 000 ms -> nooit een DELETE en de lead is terug', async () => {
  await metLeads('a');
  mock.timers.enable({ apis: ['setTimeout'] });
  const f = nepFetch();
  zetFetch(f);
  const h = verwijderMetOngedaan('a');
  assert.ok(salesToestand().uitgesteld.has('a'));
  mock.timers.tick(4999);
  assert.equal(h.ongedaan(), true);
  assert.ok(!salesToestand().uitgesteld.has('a'));
  mock.timers.tick(60000);
  await tick();
  assert.equal(f.aanroepen.length, 0);
  assert.deepEqual(salesToestand().leads.map(l => l.id), ['a']);
});

test('verwijderMetOngedaan: eigen timerfuncties en wachttijd; gebruiker-doel in de URL', async () => {
  const geplaatst = [];
  const setTimeoutFn = (fn, ms) => { geplaatst.push({ fn, ms }); return geplaatst.length; };
  const gewist = [];
  const clearTimeoutFn = id => gewist.push(id);
  zetFetch(nepFetch({ status: 200, json: blob(1, [lead('a')]) }));
  await laadSales({ gebruikerId: 'u-3' });
  const f = nepFetch({ status: 200, json: { versie: 2 } });
  zetFetch(f);
  const h = verwijderMetOngedaan('a', { wacht: 1234, setTimeoutFn, clearTimeoutFn });
  assert.equal(geplaatst[0].ms, 1234);
  h.ongedaan();
  assert.deepEqual(gewist, [1]);
  verwijderMetOngedaan('a', { setTimeoutFn, clearTimeoutFn });
  assert.equal(geplaatst[1].ms, 5000);
  geplaatst[1].fn();
  await tick();
  assert.equal(f.aanroepen[0].pad, '/api/sales?lead=a&gebruiker=u-3');
});

test('verwijderMetOngedaan: 404 telt als geslaagd', async () => {
  await metLeads('a');
  mock.timers.enable({ apis: ['setTimeout'] });
  zetFetch(nepFetch({ status: 404, json: { error: 'Lead niet gevonden' } }));
  verwijderMetOngedaan('a');
  mock.timers.tick(5000);
  await tick();
  assert.deepEqual(salesToestand().leads, []);
  assert.ok(!salesToestand().uitgesteld.has('a'));
});

test('verwijderMetOngedaan: mislukte DELETE -> lead terug zichtbaar en { ok:false } via onSalesWijziging', async () => {
  await metLeads('a');
  mock.timers.enable({ apis: ['setTimeout'] });
  zetFetch(nepFetch(STORING, new TypeError('offline')));
  const meldingen = [];
  onSalesWijziging(d => meldingen.push(d));
  verwijderMetOngedaan('a');
  mock.timers.tick(5000);
  await tick();
  assert.deepEqual(salesToestand().leads.map(l => l.id), ['a']);
  assert.ok(!salesToestand().uitgesteld.has('a'));
  const mislukt = meldingen.filter(m => m && m.ok === false);
  assert.equal(mislukt.length, 1);
  assert.equal(mislukt[0].leadId, 'a');
  assert.equal(mislukt[0].reden, 'opslag');
  // netwerkfout
  verwijderMetOngedaan('a');
  mock.timers.tick(5000);
  await tick();
  assert.equal(meldingen.filter(m => m && m.ok === false).at(-1).reden, 'netwerk');
  assert.deepEqual(salesToestand().leads.map(l => l.id), ['a']);
});

test('spoelUitgesteld: verstuurt openstaande deletes onmiddellijk met keepalive; de timer doet daarna niets meer', async () => {
  await metLeads('a', 'b', 'c');
  mock.timers.enable({ apis: ['setTimeout'] });
  const f = nepFetch({ status: 200, json: { versie: 2 } }, { status: 200, json: { versie: 3 } });
  zetFetch(f);
  verwijderMetOngedaan('a');
  verwijderMetOngedaan('b');
  await spoelUitgesteld();
  assert.equal(f.aanroepen.length, 2);
  assert.deepEqual(f.aanroepen.map(a => a.pad).sort(), ['/api/sales?lead=a', '/api/sales?lead=b']);
  assert.ok(f.aanroepen.every(a => a.init.keepalive === true && a.init.method === 'DELETE'));
  mock.timers.tick(10000);
  await tick();
  assert.equal(f.aanroepen.length, 2);
  assert.deepEqual(salesToestand().leads.map(l => l.id), ['c']);
});

test('spoelUitgesteld zonder openstaande verwijderingen doet niets', async () => {
  const f = nepFetch();
  zetFetch(f);
  await spoelUitgesteld();
  assert.equal(f.aanroepen.length, 0);
});

test('verwijderMetOngedaan: dezelfde lead tweemaal geeft één DELETE', async () => {
  await metLeads('a');
  mock.timers.enable({ apis: ['setTimeout'] });
  const f = nepFetch({ status: 200, json: { versie: 2 } });
  zetFetch(f);
  verwijderMetOngedaan('a');
  verwijderMetOngedaan('a');
  mock.timers.tick(5000);
  await tick();
  assert.equal(f.aanroepen.length, 1);
});

// ---- abonnees, gekozen datum ----

test('onSalesWijziging meldt af correct', async () => {
  zetFetch(nepFetch({ status: 200, json: blob(1) }, { status: 200, json: blob(2) }));
  let n = 0;
  const af = onSalesWijziging(() => n++);
  await laadSales();
  assert.equal(n, 1);
  af();
  af(); // tweede keer is onschadelijk
  await laadSales();
  assert.equal(n, 1);
});

test('een falende abonnee verhindert de andere niet', async () => {
  zetFetch(nepFetch({ status: 200, json: blob(1) }));
  let n = 0;
  onSalesWijziging(() => { throw new Error('stuk'); });
  onSalesWijziging(() => n++);
  await laadSales();
  assert.equal(n, 1);
});

test('gekozenDatum: standaard vandaag (lokaal), zetGekozenDatum meldt enkel bij verandering en weigert rommel', () => {
  assert.match(gekozenDatum(), /^\d{4}-\d{2}-\d{2}$/);
  let n = 0;
  onSalesWijziging(() => n++);
  zetGekozenDatum('2026-10-12');
  assert.equal(gekozenDatum(), '2026-10-12');
  assert.equal(salesToestand().gekozenDatum, '2026-10-12');
  assert.equal(n, 1);
  zetGekozenDatum('2026-10-12');
  assert.equal(n, 1);
  zetGekozenDatum('morgen');
  zetGekozenDatum(null);
  assert.equal(gekozenDatum(), '2026-10-12');
  assert.equal(n, 1);
});
