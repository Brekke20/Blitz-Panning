// Rapport openen op id (doorklik herhaalbezoek) + herOpenRapport ongewijzigd.
// rapport-archief.js is een browsermodule: minimale document/window-stubs vóór de import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch } from './nep-fetch.mjs';

const toastEl = { textContent: '', classList: { add() {}, remove() {} } };
const geopend = []; // elk window.open('', '_blank') levert een nep-venster
globalThis.document = {
  body: { addEventListener() {} },
  getElementById: (id) => (id === 'toast' ? toastEl : null),
  addEventListener() {},
};
globalThis.window = {
  addEventListener() {},
  open(url, doel) { const w = maakVenster(url, doel); geopend.push(w); return w; },
};

function maakVenster(url, doel) {
  const frame = { attrs: {}, style: {}, srcdoc: undefined, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} };
  const w = {
    url, doel, gesloten: false, geschreven: '', frame, ingevoegd: [],
    close() { this.gesloten = true; },
    document: {
      write(s) { w.geschreven += s; }, close() {},
      createElement: () => frame,
      body: { appendChild: (el) => w.ingevoegd.push(el) },
    },
  };
  return w;
}

const { _rapportArchief, herOpenRapport, openRapportOpId } = await import('../public/js/rapport-archief.js');
const { wisInhoudCache } = await import('../public/js/rapport-inhoud.js');

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function reset() {
  _rapportArchief.length = 0;
  geopend.length = 0;
  toastEl.textContent = '';
  wisInhoudCache();
}

test('openRapportOpId: entry in de lijst met inline _html, geen fetch, sandbox-iframe', async () => {
  reset();
  _rapportArchief.push({ id: 'r1', rapportData: { _html: '<p>inline</p>' } });
  const { fn, calls } = maakNepFetch();
  await metGlobaleFetch(fn, () => openRapportOpId('r1'));
  assert.equal(calls.length, 0);
  assert.equal(geopend.length, 1);
  const w = geopend[0];
  assert.equal(w.doel, '_blank');
  assert.equal(w.gesloten, false);
  assert.equal(w.frame.srcdoc, '<p>inline</p>');
  assert.equal(w.frame.attrs.sandbox, 'allow-same-origin');
  assert.deepEqual(w.ingevoegd, [w.frame]);
});

test('openRapportOpId: entry in de lijst zonder _html -> haalRapportHtml gebruikt die entry (GET op zijn id)', async () => {
  reset();
  _rapportArchief.push({ id: 'r2', inhoudBeschikbaar: true, rapportData: {} });
  const { fn, calls } = maakNepFetch((u) => u.includes('inhoud=r2') ? json({ id: 'r2', html: '<p>server</p>' }) : undefined);
  await metGlobaleFetch(fn, () => openRapportOpId('r2'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/rapport-archief?inhoud=r2');
  assert.equal(geopend[0].frame.srcdoc, '<p>server</p>');
});

test('openRapportOpId: id niet in de lijst (ouder dan de 500) -> GET beslist, geen voorcontrole', async () => {
  reset();
  const { fn, calls } = maakNepFetch((u) => u.includes('inhoud=oud%201') ? json({ html: '<p>oud</p>' }) : undefined);
  await metGlobaleFetch(fn, () => openRapportOpId('oud 1'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/rapport-archief?inhoud=oud%201');
  assert.equal(geopend[0].frame.srcdoc, '<p>oud</p>');
  assert.equal(geopend[0].gesloten, false);
});

test('openRapportOpId: 404 -> venster dicht en toast', async () => {
  reset();
  const { fn } = maakNepFetch(() => json({}, 404));
  await metGlobaleFetch(fn, () => openRapportOpId('weg'));
  assert.equal(geopend.length, 1);
  assert.equal(geopend[0].gesloten, true);
  assert.equal(geopend[0].frame.srcdoc, undefined);
  assert.equal(toastEl.textContent, 'Geen opgeslagen HTML beschikbaar');
});

test('openRapportOpId: lege inhoud -> venster dicht en toast', async () => {
  reset();
  const { fn } = maakNepFetch(() => json({ html: '' }));
  await metGlobaleFetch(fn, () => openRapportOpId('leeg'));
  assert.equal(geopend[0].gesloten, true);
  assert.equal(toastEl.textContent, 'Geen opgeslagen HTML beschikbaar');
});

test('openRapportOpId: window.open synchroon vóór de fetch; geblokkeerd venster -> toast, geen fetch', async () => {
  reset();
  const volgorde = [];
  const { fn } = maakNepFetch((u) => { volgorde.push('fetch'); return json({ html: '<p>x</p>' }); });
  const origOpen = globalThis.window.open;
  globalThis.window.open = (...a) => { volgorde.push('open'); return origOpen(...a); };
  try {
    await metGlobaleFetch(fn, async () => {
      const p = openRapportOpId('z');
      assert.equal(volgorde[0], 'open'); // open al gebeurd vóór de eerste await (fetch volgt daarna)
      await p;
    });
    assert.deepEqual(volgorde, ['open', 'fetch']);

    // geblokkeerd
    volgorde.length = 0;
    globalThis.window.open = () => null;
    wisInhoudCache();
    await metGlobaleFetch(fn, () => openRapportOpId('z'));
    assert.deepEqual(volgorde, []);
    assert.match(toastEl.textContent, /geblokkeerd/);
  } finally { globalThis.window.open = origOpen; }
});

test('herOpenRapport(idx): ongewijzigd (inline html, geen inhoud -> toast zonder venster)', async () => {
  reset();
  _rapportArchief.push({ id: 'a', rapportData: { _html: '<p>a</p>' } }, { id: 'b', rapportData: {} });
  await herOpenRapport(0);
  assert.equal(geopend.length, 1);
  assert.equal(geopend[0].frame.srcdoc, '<p>a</p>');
  assert.equal(geopend[0].frame.attrs.sandbox, 'allow-same-origin');
  assert.match(geopend[0].geschreven, /<title>Service rapport<\/title>/);
  await herOpenRapport(1);
  assert.equal(geopend.length, 1); // geen venster geopend
  assert.equal(toastEl.textContent, 'Geen opgeslagen HTML beschikbaar');
});
