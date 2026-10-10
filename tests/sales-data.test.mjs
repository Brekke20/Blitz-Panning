// Client-gegevenslaag voor de sales-schermen (Task 10): fetch via zetFetch, timers via mock.timers. Verzonnen gegevens.
process.env.TZ = 'Europe/Brussels';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { zetFetch } from '../public/js/kern/api.js';
import {
  salesToestand, onSalesWijziging, laadSales, laadInstellingen, bewaarInstellingen, wijzig, importeer,
  verwijderMetOngedaan, spoelUitgesteld, terugNaarTePlannen, gekozenDatum, zetGekozenDatum, SALES_STANDAARD, resetSales, instellingenGeladenVoor,
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

beforeEach(() => resetSales({ abonnees: true }));
afterEach(() => { resetSales({ abonnees: true }); zetFetch(null); mock.timers.reset(); });

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

test('laadInstellingen: werkuren die vóór 16:00 eindigen geven als standaard laatste start de eindtijd', async () => {
  zetFetch(nepFetch({ status: 200, json: { versie: 1, instellingen: { vanTijd: '08:00', totTijd: '15:00' } } }));
  await laadInstellingen();
  assert.equal(salesToestand().instellingen.laatsteStart, '15:00');
  zetFetch(nepFetch({ status: 200, json: { versie: 1, instellingen: { vanTijd: '08:00', totTijd: '15:00', laatsteStart: '14:00' } } }));
  await laadInstellingen();
  assert.equal(salesToestand().instellingen.laatsteStart, '14:00');
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

test('terugNaarTePlannen: PATCH met status te-plannen, planning en resultaat leeg (zelfde actie als het detail en het ✕ op de kaarten)', async () => {
  const f = nepFetch(
    { status: 200, json: blob(3, [lead('a', { status: 'bevestigd', planning: { datum: '2026-10-12', start: '09:00' } })]) },
    { status: 200, json: blob(4, [lead('a')]) },
  );
  zetFetch(f);
  await laadSales();
  const r = await terugNaarTePlannen('a');
  assert.equal(r.ok, true);
  assert.deepEqual(f.aanroepen[1].body, { versie: 3, leads: [{ id: 'a', velden: { status: 'te-plannen', planning: null, resultaat: null } }] });
  assert.equal(salesToestand().leads[0].status, 'te-plannen');
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

test('wijzig met een functie: na een 409 wordt de patch opnieuw berekend op de verse stand (bv. een bezoek toevoegen aan de nieuwe historiek)', async () => {
  const oud = { datum: '2026-10-01', resultaat: 'opnieuw', op: '2026-10-01T08:00:00.000Z' };
  const nieuwBezoek = { datum: '2026-10-02', resultaat: 'offerte', op: '2026-10-02T08:00:00.000Z' };
  const f = nepFetch(
    { status: 200, json: blob(3, [lead('a')]) },
    { status: 409, json: { error: 'Versiematch mislukt', serverVersie: 4, data: blob(4, [lead('a', { bezoeken: [oud] })]) } },
    { status: 200, json: blob(5, [lead('a', { bezoeken: [oud, nieuwBezoek] })]) },
  );
  zetFetch(f);
  await laadSales();
  const gezien = [];
  const r = await wijzig((staat) => {
    const l = staat.leads.find(x => x.id === 'a');
    gezien.push((l.bezoeken ?? []).length);
    return { leads: [{ id: 'a', velden: { bezoeken: [...(l.bezoeken ?? []), nieuwBezoek] } }] };
  });
  assert.equal(r.ok, true);
  assert.deepEqual(gezien, [0, 1]); // eerst op de oude stand, na de 409 op de verse
  assert.deepEqual(f.aanroepen[1].body.leads[0].velden.bezoeken, [nieuwBezoek]);
  assert.deepEqual(f.aanroepen[2].body.leads[0].velden.bezoeken, [oud, nieuwBezoek]);
  assert.equal(f.aanroepen[2].body.versie, 4);
});

test('wijzig met een functie die null geeft (lead intussen weg): niets versturen, reden "vervallen"', async () => {
  const f = nepFetch({ status: 200, json: blob(3, [lead('a')]) });
  zetFetch(f);
  await laadSales();
  const r = await wijzig(() => null);
  assert.deepEqual([r.ok, r.reden], [false, 'vervallen']);
  assert.equal(f.aanroepen.length, 1);
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
  zetGekozenDatum('2031-03-05');
  assert.equal(gekozenDatum(), '2031-03-05');
  assert.equal(salesToestand().gekozenDatum, '2031-03-05');
  assert.equal(n, 1);
  zetGekozenDatum('2031-03-05');
  assert.equal(n, 1);
  zetGekozenDatum('morgen');
  zetGekozenDatum(null);
  assert.equal(gekozenDatum(), '2031-03-05');
  assert.equal(n, 1);
});

// ---- fix-ronde review ----

test('resetSales() houdt de abonnees (state-only) en meldt; resetSales({ abonnees:true }) wist ze', async () => {
  zetFetch(nepFetch({ status: 200, json: blob(3, [lead('a')]) }, { status: 200, json: blob(4) }, { status: 200, json: blob(5) }));
  let n = 0;
  onSalesWijziging(() => n++);
  await laadSales();
  assert.equal(n, 1);
  resetSales();
  assert.equal(n, 2); // melding van de reset
  assert.equal(salesToestand().versie, 0);
  assert.deepEqual(salesToestand().leads, []);
  await laadSales();
  assert.equal(n, 3); // de abonnee draait nog
  resetSales({ abonnees: true });
  await laadSales();
  assert.equal(n, 3);
});

test('409 waarvan data geen leads/blokken heeft wist de toestand niet en geeft reden http zonder herpoging', async () => {
  const f = nepFetch({ status: 200, json: blob(3, [lead('a')]) }, { status: 409, json: { data: {} } });
  zetFetch(f);
  await laadSales();
  const r = await wijzig({ aanvullen: true });
  assert.deepEqual([r.ok, r.reden, r.status], [false, 'http', 409]);
  assert.equal(f.aanroepen.length, 2);
  assert.equal(salesToestand().versie, 3);
  assert.equal(salesToestand().leads.length, 1);
});

test('SALES_STANDAARD is bevroren en de samengevoegde werkdagen zijn een eigen kopie; bewaarde null overschrijft de standaard niet', async () => {
  assert.ok(Object.isFrozen(SALES_STANDAARD) && Object.isFrozen(SALES_STANDAARD.werkdagen));
  const t = salesToestand();
  assert.notEqual(t.instellingen.werkdagen, SALES_STANDAARD.werkdagen);
  t.instellingen.werkdagen.push(6); // geen TypeError en de standaard blijft heel
  assert.deepEqual(SALES_STANDAARD.werkdagen, [1, 2, 3, 4, 5]);
  zetFetch(nepFetch({ status: 200, json: { instellingen: { vanTijd: null, totTijd: '18:00' } } }));
  await laadInstellingen();
  assert.equal(salesToestand().instellingen.vanTijd, '08:00');
  assert.equal(salesToestand().instellingen.totTijd, '18:00');
});

test('een null-body bij 200 gooit nooit en wist niets', async () => {
  zetFetch(nepFetch({ status: 200, json: blob(2, [lead('a')]) }, { status: 200, json: null }, { status: 200, json: null }, { status: 200, json: null }, { status: 200, json: null }, { status: 200, json: null }));
  await laadSales();
  assert.deepEqual(await laadSales(), { ok: false, status: 200 });
  assert.equal((await wijzig({ aanvullen: true })).ok, false);
  assert.equal((await laadInstellingen()).ok, false); // geen bruikbare lading: geen geladen instellingen
  assert.equal(salesToestand().instellingenGeladen, false);
  assert.equal((await importeer({})).ok, true); // import zelf slaagde; de herlaad (null) niet
  assert.equal(salesToestand().versie, 2);
  assert.equal(salesToestand().leads.length, 1);
});

test('een versie in de patch overschrijft de lokale versie niet', async () => {
  const f = nepFetch({ status: 200, json: blob(3) }, { status: 200, json: blob(4) });
  zetFetch(f);
  await laadSales();
  await wijzig({ versie: 99, aanvullen: true });
  assert.equal(f.aanroepen[1].body.versie, 3);
});

test('importeer meldt of de herlaad lukte', async () => {
  zetFetch(nepFetch({ status: 200, json: { versie: 2, samenvatting: {} } }, { status: 500 }));
  assert.equal((await importeer({})).herladen, false);
});

test('DELETE (timerpad) wacht op een lopend PATCH: het late PATCH-antwoord zet de verwijderde lead niet terug', async () => {
  await metLeads('a');
  mock.timers.enable({ apis: ['setTimeout'] });
  let geefPatch;
  const patchAntwoord = new Promise(r => { geefPatch = r; });
  const aanroepen = [];
  zetFetch(async (pad, init) => {
    aanroepen.push({ pad, init });
    if (init.method === 'PATCH') { await patchAntwoord; return { ok: true, status: 200, json: async () => blob(2, [lead('a', { notitie: 'x' })]) }; }
    return { ok: true, status: 200, json: async () => ({ versie: 3 }) };
  });
  const p = wijzig({ leads: [{ id: 'a', velden: { notitie: 'x' } }] });
  verwijderMetOngedaan('a');
  mock.timers.tick(5000);
  await tick();
  assert.equal(aanroepen.filter(a => a.init.method === 'DELETE').length, 0); // wacht op de PATCH
  geefPatch();
  await p;
  await tick();
  assert.equal(aanroepen.filter(a => a.init.method === 'DELETE').length, 1);
  assert.deepEqual(salesToestand().leads, []);
  assert.ok(!salesToestand().uitgesteld.has('a'));
});

test('DELETE van een ander blob (verkoperwissel binnen het venster) raakt de huidige toestand en versie niet', async () => {
  zetFetch(nepFetch({ status: 200, json: blob(1, [lead('a')]) }));
  await laadSales({ gebruikerId: 'u-A' });
  mock.timers.enable({ apis: ['setTimeout'] });
  verwijderMetOngedaan('a'); // doel = u-A
  zetFetch(nepFetch({ status: 200, json: blob(1, [lead('a')]) }));
  await laadSales({ gebruikerId: 'u-B' }); // de beheerder wisselt: zelfde lead-id 'a' en dezelfde versie bij B
  const f = nepFetch({ status: 200, json: { versie: 2 } });
  zetFetch(f);
  mock.timers.tick(5000);
  await tick();
  assert.equal(f.aanroepen[0].pad, '/api/sales?lead=a&gebruiker=u-A');
  assert.equal(salesToestand().leads.length, 1); // B's lead 'a' blijft
  assert.equal(salesToestand().versie, 1);       // A's versie wordt niet overgenomen
});

// ---- vulLocatiesAan (Task 14) ----
import { vulLocatiesAan } from '../public/js/schermen/sales-data.js';

test('vulLocatiesAan: herhaalt wijzig({ aanvullen }) tot er niets meer open staat en meldt de voortgang', async () => {
  const f = nepFetch(
    { status: 200, json: blob(1, [lead('a')]) },
    { status: 200, json: { ...blob(2, [lead('a')]), open: 3 } },
    { status: 200, json: { ...blob(3, [lead('a')]), open: 1 } },
    { status: 200, json: { ...blob(4, [lead('a')]), open: 0 } },
  );
  zetFetch(f);
  await laadSales();
  const gezien = [];
  const rest = await vulLocatiesAan(5, { voortgang: (n) => gezien.push(n) });
  assert.equal(rest, 0);
  assert.deepEqual(gezien, [5, 3, 1]);
  assert.deepEqual(f.aanroepen.slice(1).map(a => a.body.aanvullen), [true, true, true]);
});

test('vulLocatiesAan: stopt zonder vooruitgang, bij een fout en na het maximum aantal rondes (nooit eindeloos)', async () => {
  let f = nepFetch({ status: 200, json: blob(1) }, { status: 200, json: { ...blob(2), open: 4 } });
  zetFetch(f);
  await laadSales();
  assert.equal(await vulLocatiesAan(4), 4); // 4 -> 4: geen vooruitgang
  assert.equal(f.aanroepen.length, 2);

  f = nepFetch({ status: 200, json: blob(1) }, STORING);
  zetFetch(f);
  await laadSales();
  assert.equal(await vulLocatiesAan(2), 2); // mislukt: het oude aantal blijft

  f = nepFetch({ status: 200, json: blob(1) }, ...[9, 8, 7, 6].map((o, i) => ({ status: 200, json: { ...blob(2 + i), open: o } })));
  zetFetch(f);
  await laadSales();
  assert.equal(await vulLocatiesAan(10, { max: 3 }), 7); // drie rondes
  assert.equal(f.aanroepen.length, 4);
  assert.equal(await vulLocatiesAan(0), 0); // niets te doen: geen verzoek
  assert.equal(f.aanroepen.length, 4);
});

// ---- eindreview I1: instellingen nooit als geladen beschouwen zonder serverlading, nooit die van een andere verkoper ----

test('I1: instellingenGeladenVoor: pas na een geslaagde lading, voor precies dat doel', async () => {
  assert.equal(instellingenGeladenVoor(), false);
  zetFetch(nepFetch({ status: 200, json: { versie: 1, instellingen: { vanTijd: '09:00' } } }));
  await laadInstellingen();
  assert.equal(instellingenGeladenVoor(), true);
  assert.equal(instellingenGeladenVoor('u-7'), false);
  zetFetch(nepFetch({ status: 200, json: { versie: 1, instellingen: null } }));
  await laadInstellingen({ gebruikerId: 'u-7' });
  assert.equal(instellingenGeladenVoor('u-7'), true);
  assert.equal(instellingenGeladenVoor(), false);
});

test('I1: een mislukte lading (503/500/netwerk/onleesbaar) zonder eerdere lading: niet geladen, standaarden', async () => {
  zetFetch(nepFetch(STORING, { status: 500 }, new TypeError('offline'), { status: 200, json: { instellingen: [1] } }, { status: 200, json: null }));
  for (let i = 0; i < 5; i++) assert.equal((await laadInstellingen()).ok, false);
  assert.equal(instellingenGeladenVoor(), false);
  assert.deepEqual(salesToestand().instellingen, SALES_STANDAARD);
  assert.deepEqual(salesToestand().instellingenRuw, {});
});

test('I1: een mislukte lading voor een ANDERE verkoper wist de instellingen van de vorige (nooit A\'s instellingen bij B)', async () => {
  zetFetch(nepFetch({ status: 200, json: { versie: 1, instellingen: { vanTijd: '10:00', startlocatie: 'Hasselt', werkdagen: [1, 2] } } }, { status: 503, json: STORING.json }));
  await laadInstellingen({ gebruikerId: 'u-A' });
  assert.equal(salesToestand().instellingen.startlocatie, 'Hasselt');
  assert.equal((await laadInstellingen({ gebruikerId: 'u-B' })).ok, false);
  assert.equal(instellingenGeladenVoor('u-A'), false);
  assert.equal(instellingenGeladenVoor('u-B'), false);
  assert.deepEqual(salesToestand().instellingen, SALES_STANDAARD);
  assert.deepEqual(salesToestand().instellingenRuw, {});
});

test('I1: een mislukte HERlading voor hetzelfde doel houdt de eerder geladen instellingen (enkel mogelijk verouderd)', async () => {
  zetFetch(nepFetch({ status: 200, json: { versie: 1, instellingen: { vanTijd: '10:00' } } }, { status: 500 }));
  await laadInstellingen();
  assert.equal((await laadInstellingen()).ok, false);
  assert.equal(instellingenGeladenVoor(), true);
  assert.equal(salesToestand().instellingen.vanTijd, '10:00');
});

test('I1: laadSales van een andere verkoper wist geladen instellingen van de vorige; van hetzelfde doel niet', async () => {
  zetFetch(nepFetch({ status: 200, json: { versie: 1, instellingen: { vanTijd: '10:00' } } }, { status: 200, json: blob(1, [], [], { gebruikerId: 'u-A' }) }, { status: 200, json: blob(1, [], [], { gebruikerId: 'u-B' }) }));
  await laadInstellingen({ gebruikerId: 'u-A' });
  await laadSales({ gebruikerId: 'u-A' });
  assert.equal(instellingenGeladenVoor('u-A'), true);
  await laadSales({ gebruikerId: 'u-B' });
  assert.equal(instellingenGeladenVoor('u-A'), false);
  assert.deepEqual(salesToestand().instellingen, SALES_STANDAARD);
});

test('I1: bewaarInstellingen zet de instellingen als geladen voor de eigen verkoper', async () => {
  zetFetch(nepFetch({ status: 200, json: { versie: 5 } }));
  assert.equal((await bewaarInstellingen({ vanTijd: '07:30' })).ok, true);
  assert.equal(instellingenGeladenVoor(), true);
});

// ---- eindreview M2: een laat schrijfantwoord van een vorige verkoper wordt genegeerd ----

test('M2: een laat PATCH-antwoord voor verkoper A na een wissel naar B verandert de getoonde leads (B) niet', async () => {
  let antwoordA;
  const f = async (pad, init) => {
    if (init?.method === 'PATCH') await new Promise((r) => { antwoordA = r; });
    const json = init?.method === 'PATCH' ? blob(6, [lead('a1', { notitie: 'x' })], [], { gebruikerId: 'u-A' }) : pad.includes('u-B') ? blob(1, [lead('b1')], [], { gebruikerId: 'u-B' }) : blob(5, [lead('a1')], [], { gebruikerId: 'u-A' });
    return { ok: true, status: 200, json: async () => json };
  };
  zetFetch(f);
  await laadSales({ gebruikerId: 'u-A' });
  const lopend = wijzig({ leads: [{ id: 'a1', velden: { notitie: 'x' } }] });
  await new Promise((r) => setTimeout(r, 0));
  await laadSales({ gebruikerId: 'u-B' });
  assert.deepEqual(salesToestand().leads.map((l) => l.id), ['b1']);
  antwoordA();
  assert.equal((await lopend).ok, true);
  assert.equal(salesToestand().gebruikerId, 'u-B');
  assert.deepEqual(salesToestand().leads.map((l) => l.id), ['b1']);
  assert.equal(salesToestand().versie, 1);
});

test('gekozenDatum: vaste klok op een zaterdag -> de verse toestand opent op maandag van de komende week', async () => {
  const echteDatum = globalThis.Date;
  const vast = new echteDatum(2026, 9, 10, 10, 0, 0); // za 10 okt 2026
  globalThis.Date = class extends echteDatum {
    constructor(...a) { if (a.length) super(...a); else super(vast.getTime()); }
    static now() { return vast.getTime(); }
  };
  try {
    const vers = await import('../public/js/schermen/sales-data.js?weekend=' + Math.random());
    assert.equal(vers.gekozenDatum(), '2026-10-12');
  } finally { globalThis.Date = echteDatum; }
});
