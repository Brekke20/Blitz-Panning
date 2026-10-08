import test from 'node:test';
import assert from 'node:assert/strict';
import verzend from '../public/js/outbox-verzend.js';

const { nextAction, bouwOntvangenBody, vertaalFout, verzendItem, metSlot, verzendAlles } = verzend;

function maakItem(extra = {}) {
  return {
    id: 'item-1',
    ticket: { id: '123', number: '1234', filename: 'rapport.pdf' },
    html: '<html>rapport</html>',
    archiveBody: { id: 'item-1', klant: 'ACME', rapportData: { a: 1, _html: '<big/>', handtekeningTech: 'T', handtekeningKlant: 'K' } },
    ...extra,
  };
}

function nepResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test('bouwOntvangenBody: oud item (archived:true, zohoUploaded:false, rapportData._html gevuld) → body zonder _html en zonder handtekeningen, html = item.html, item onveranderd', () => {
  const item = maakItem({ archived: true, zohoUploaded: false });
  const voor = JSON.stringify(item);
  const body = bouwOntvangenBody(item);
  assert.equal(body.id, 'item-1');
  assert.equal(body.html, '<html>rapport</html>');
  assert.equal(body.ticketId, '123');
  assert.equal(body.filename, 'rapport.pdf');
  assert.equal(body.isLocal, false);
  assert.deepEqual(body.archiveBody.rapportData, { a: 1 });
  assert.equal(body.archiveBody.klant, 'ACME');
  assert.equal(JSON.stringify(item), voor);
  assert.equal(item.archiveBody.rapportData._html, '<big/>');
});

test('bouwOntvangenBody: isLocal true blijft true; ontbrekende rapportData geeft geen crash', () => {
  const body = bouwOntvangenBody(maakItem({ isLocal: true, archiveBody: { id: 'item-1' } }));
  assert.equal(body.isLocal, true);
  assert.equal(body.archiveBody.rapportData, undefined);
});

test('nextAction: nieuw item → ontvangen; oud archived/zohoUploaded item → ontvangen; ontvangen:true → done', () => {
  assert.equal(nextAction(maakItem()), 'ontvangen');
  assert.equal(nextAction(maakItem({ archived: true, zohoUploaded: false })), 'ontvangen');
  assert.equal(nextAction(maakItem({ archived: true, zohoUploaded: true })), 'ontvangen');
  assert.equal(nextAction(maakItem({ ontvangen: true })), 'done');
});

test('vertaalFout: 413, 400, overige, timeout, netwerkfout', () => {
  assert.equal(vertaalFout({ status: 413, data: { error: 'x' } }), "Rapport is te groot om te versturen (te veel foto's). Meld dit aan de planner.");
  assert.equal(vertaalFout({ status: 400, data: { error: 'ticketId ongeldig' } }), 'ticketId ongeldig');
  assert.equal(vertaalFout({ status: 503, data: {} }), 'Server (503)');
  assert.equal(vertaalFout({ status: 500 }), 'Server (500)');
  assert.equal(vertaalFout({ status: 0, timeout: true }), 'Geen antwoord van de server (time-out)');
  assert.equal(vertaalFout({ status: 0, netwerkFout: true }), 'Geen verbinding');
});

test('verzendItem: 200 {ok:true} → ok; juiste URL, methode POST, body = bouwOntvangenBody; geen test-header; testModus-item → X-Blitz-Test: 1; X-Blitz: 1 altijd', async () => {
  const aanroepen = [];
  const nepFetch = async (url, opts) => { aanroepen.push({ url, opts }); return nepResponse(200, { ok: true, id: 'item-1' }); };
  const item = maakItem();
  const res = await verzendItem(item, { fetch: nepFetch });
  assert.deepEqual(res, { ok: true });
  assert.equal(aanroepen[0].url, '/api/rapport-ontvangen');
  assert.equal(aanroepen[0].opts.method, 'POST');
  assert.equal(aanroepen[0].opts.headers['Content-Type'], 'application/json');
  assert.equal(aanroepen[0].opts.headers['X-Blitz'], '1');
  assert.equal(aanroepen[0].opts.headers['X-Blitz-Test'], undefined);
  assert.deepEqual(JSON.parse(aanroepen[0].opts.body), bouwOntvangenBody(item));

  const testAanroepen = [];
  const nepFetch2 = async (url, opts) => { testAanroepen.push(opts); return nepResponse(200, { ok: true }); };
  await verzendItem(maakItem({ testModus: true }), { fetch: nepFetch2 });
  assert.equal(testAanroepen[0].headers['X-Blitz-Test'], '1');
  assert.equal(testAanroepen[0].headers['X-Blitz'], '1');
  assert.equal(testAanroepen[0].headers['Content-Type'], 'application/json');
});

test('verzendItem: HTTP 200 zonder data.ok === true → niet ok', async () => {
  const res = await verzendItem(maakItem(), { fetch: async () => nepResponse(200, {}) });
  assert.equal(res.ok, false);
  assert.equal(res.status, 200);
});

test('verzendItem: 413 → fout met "te groot"; 400 met data.error → die tekst; 503 → "Server (503)"', async () => {
  const r413 = await verzendItem(maakItem(), { fetch: async () => nepResponse(413, { error: "Rapport is te groot om te versturen (te veel foto's)." }) });
  assert.equal(r413.ok, false);
  assert.equal(r413.status, 413);
  assert.match(r413.fout, /te groot/);
  const r400 = await verzendItem(maakItem(), { fetch: async () => nepResponse(400, { error: 'ticketId ongeldig' }) });
  assert.equal(r400.fout, 'ticketId ongeldig');
  assert.equal(r400.status, 400);
  const r503 = await verzendItem(maakItem(), { fetch: async () => ({ ok: false, status: 503, json: async () => { throw new Error('geen json'); } }) });
  assert.equal(r503.fout, 'Server (503)');
  assert.equal(r503.status, 503);
});

test('verzendItem: fetch gooit → "Geen verbinding"; timeout → time-out-tekst; externe signal geaborteerd → afgebroken:true', async () => {
  const r = await verzendItem(maakItem(), { fetch: async () => { throw new TypeError('Failed to fetch'); } });
  assert.deepEqual({ ok: r.ok, fout: r.fout, status: r.status }, { ok: false, fout: 'Geen verbinding', status: 0 });
  assert.equal(r.afgebroken, undefined);

  const wachtOpSignal = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const t = await verzendItem(maakItem(), { fetch: wachtOpSignal, timeoutMs: 10 });
  assert.equal(t.ok, false);
  assert.equal(t.fout, 'Geen antwoord van de server (time-out)');
  assert.equal(t.afgebroken, undefined);

  const ctrl = new AbortController();
  const p = verzendItem(maakItem(), { fetch: wachtOpSignal, signal: ctrl.signal, timeoutMs: 5000 });
  ctrl.abort();
  const a = await p;
  assert.equal(a.ok, false);
  assert.equal(a.afgebroken, true);
});

test('metSlot: lock bezet → uitgevoerd false; zonder navigator.locks → uitgevoerd true', async () => {
  const origineel = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const zet = waarde => Object.defineProperty(globalThis, 'navigator', { value: waarde, configurable: true, writable: true });
  try {
    let gevraagd;
    zet({ locks: { request: async (naam, opts, cb) => { gevraagd = { naam, opts }; return cb(null); } } });
    let liep = false;
    const bezet = await metSlot('abc', async () => { liep = true; return 1; });
    assert.deepEqual(bezet, { uitgevoerd: false });
    assert.equal(liep, false);
    assert.equal(gevraagd.naam, 'blitz-outbox-abc');
    assert.deepEqual(gevraagd.opts, { ifAvailable: true });

    zet({ locks: { request: async (naam, opts, cb) => cb({ name: naam }) } });
    const vrij = await metSlot('abc', async () => 42);
    assert.deepEqual(vrij, { uitgevoerd: true, waarde: 42 });

    zet({});
    const zonder = await metSlot('abc', async () => 7);
    assert.deepEqual(zonder, { uitgevoerd: true, waarde: 7 });
  } finally {
    if (origineel) Object.defineProperty(globalThis, 'navigator', origineel);
    else delete globalThis.navigator;
  }
});

function maakOpslag(items) {
  return {
    items: new Map(items.map(i => [i.id, i])),
    async getAll() { return [...this.items.values()]; },
    async remove(id) { this.items.delete(id); },
    async put(item) { this.items.set(item.id, item); },
  };
}

test('verzendAlles: twee items, één ok één 500 → item 1 verwijderd, item 2 blijft met lastError en attempts+1; verstuurd 1, mislukt 1', async () => {
  const opslag = maakOpslag([maakItem({ id: 'a' }), maakItem({ id: 'b', attempts: 2 })]);
  const nepFetch = async (url, opts) => {
    const id = JSON.parse(opts.body).id;
    return id === 'a' ? nepResponse(200, { ok: true }) : nepResponse(500, { error: 'boem' });
  };
  const slot = async (id, fn) => ({ uitgevoerd: true, waarde: await fn() });
  const res = await verzendAlles({ fetch: nepFetch, opslag, slot });
  assert.deepEqual(res, { verstuurd: 1, mislukt: 1 });
  assert.equal(opslag.items.has('a'), false);
  assert.equal(opslag.items.get('b').lastError, 'boem');
  assert.equal(opslag.items.get('b').attempts, 3);
});

test('verzendAlles: slot bezet → item overgeslagen en niet geteld als mislukt', async () => {
  const opslag = maakOpslag([maakItem({ id: 'c' })]);
  let gefetcht = false;
  const res = await verzendAlles({
    fetch: async () => { gefetcht = true; return nepResponse(200, { ok: true }); },
    opslag,
    slot: async () => ({ uitgevoerd: false }),
  });
  assert.deepEqual(res, { verstuurd: 0, mislukt: 0 });
  assert.equal(gefetcht, false);
  assert.equal(opslag.items.has('c'), true);
});

test('verzendAlles: item met ontvangen:true wordt uit de opslag verwijderd, niet verstuurd, geteld als verstuurd', async () => {
  const opslag = maakOpslag([maakItem({ id: 'd', ontvangen: true })]);
  let gefetcht = false;
  const res = await verzendAlles({
    fetch: async () => { gefetcht = true; return nepResponse(200, { ok: true }); },
    opslag,
    slot: async (id, fn) => ({ uitgevoerd: true, waarde: await fn() }),
  });
  assert.equal(gefetcht, false);
  assert.equal(opslag.items.has('d'), false);
  assert.deepEqual(res, { verstuurd: 1, mislukt: 0 });
});
