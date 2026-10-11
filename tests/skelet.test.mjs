// tests/skelet.test.mjs — kern/skelet.js: het skelet verschijnt pas na de vertraging, enkel bij een leeg vak, met aria-busy op het vak,
// aria-hidden op het skelet en een visueel verborgen "Laden…"; stop() ruimt alles op. Een kleine nep-DOM volstaat (geen jsdom in het project).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { toonSkelet, bouwSkelet, SKELET_VERTRAGING_MS, SKELET_VORMEN } from '../public/js/kern/skelet.js';

class NepEl {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.tag = tag; this.children = []; this.parent = null; this.attrs = new Map(); this.dataset = {};
    this.style = {}; this.className = ''; this.textContent = '';
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
  }
  get childElementCount() { return this.children.length; }
  append(...kinderen) { for (const k of kinderen) { k.parent = this; this.children.push(k); } }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(k => k !== this); this.parent = null; } }
  setAttribute(n, w) { this.attrs.set(n, String(w)); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  hasAttribute(n) { return this.attrs.has(n); }
  removeAttribute(n) { this.attrs.delete(n); }
  zoek(fn, uit = []) { for (const k of this.children) { if (fn(k)) uit.push(k); k.zoek(fn, uit); } return uit; }
}
const nepDoc = () => { const doc = { createElement: (tag) => new NepEl(doc, tag) }; return doc; };
const nieuwVak = () => nepDoc().createElement('div');
const skeletIn = (vak) => vak.children.find(k => k.className === 'skelet');
const meldingIn = (vak) => vak.children.find(k => k.className.includes('skelet-melding'));

test('het skelet verschijnt niet vóór de vertraging (150 ms): een snel antwoord geeft geen flits', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const vak = nieuwVak();
    const s = toonSkelet(vak, { vorm: 'kaarten' });
    assert.equal(SKELET_VERTRAGING_MS, 150);
    mock.timers.tick(SKELET_VERTRAGING_MS - 1);
    assert.equal(skeletIn(vak), undefined);
    assert.equal(s.zichtbaar(), false);
    mock.timers.tick(1);
    assert.ok(skeletIn(vak), 'na 150 ms staat het skelet er');
    assert.equal(s.zichtbaar(), true);
  } finally { mock.timers.reset(); }
});

test('stop() vóór de vertraging: het skelet komt er nooit, de timer is opgeruimd en aria-busy weg', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const vak = nieuwVak();
    const s = toonSkelet(vak);
    assert.equal(vak.getAttribute('aria-busy'), 'true');
    s.stop();
    assert.equal(vak.hasAttribute('aria-busy'), false);
    mock.timers.tick(1000);
    assert.equal(vak.children.length, 0);
  } finally { mock.timers.reset(); }
});

test('aria: het vak is aria-busy, het skelet aria-hidden, en een visueel verborgen "Laden…" meldt het wachten', () => {
  const vak = nieuwVak();
  toonSkelet(vak, { vorm: 'rijen', vertraging: 0 });
  assert.equal(vak.getAttribute('aria-busy'), 'true');
  assert.equal(skeletIn(vak).getAttribute('aria-hidden'), 'true');
  const melding = meldingIn(vak);
  assert.ok(melding);
  assert.match(melding.className, /sr-only/);
  assert.equal(melding.textContent, 'Laden…');
  assert.equal(melding.getAttribute('aria-hidden'), null, 'de melding voor schermlezers is niet verborgen');
});

test('stop() ruimt het skelet, de melding en aria-busy op en is idempotent', () => {
  const vak = nieuwVak();
  const s = toonSkelet(vak, { vertraging: 0 });
  assert.equal(vak.children.length, 2);
  s.stop();
  s.stop();
  assert.equal(vak.children.length, 0);
  assert.equal(vak.hasAttribute('aria-busy'), false);
  assert.equal(s.zichtbaar(), false);
});

test('een vak met inhoud krijgt geen skelet (geen geflikker bij een verversing), wel aria-busy tot stop()', () => {
  const vak = nieuwVak();
  vak.append(vak.ownerDocument.createElement('p'));
  const s = toonSkelet(vak, { vertraging: 0 });
  assert.equal(skeletIn(vak), undefined);
  assert.equal(vak.children.length, 1);
  assert.equal(vak.getAttribute('aria-busy'), 'true');
  s.stop();
  assert.equal(vak.hasAttribute('aria-busy'), false);
  assert.equal(vak.children.length, 1, 'de bestaande inhoud blijft onaangeroerd');
});

test('de leegte wordt gecontroleerd op het moment dat het skelet zou verschijnen (inhoud ertussen: geen skelet)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const vak = nieuwVak();
    toonSkelet(vak);
    vak.append(vak.ownerDocument.createElement('p')); // bv. de bewaarde kopie is intussen getekend
    mock.timers.tick(SKELET_VERTRAGING_MS);
    assert.equal(skeletIn(vak), undefined);
  } finally { mock.timers.reset(); }
});

test('isLeeg en verberg: eigen leegtecheck, en "Laden..."-elementen zijn verborgen zolang het skelet staat', () => {
  const vak = nieuwVak();
  const tekst = vak.ownerDocument.createElement('div');
  vak.append(tekst); // een vak met enkel een "Laden..."-tekst telt als leeg
  const s = toonSkelet(vak, { vertraging: 0, isLeeg: () => true, verberg: [tekst] });
  assert.ok(skeletIn(vak));
  assert.equal(tekst.classList.contains('skelet-weg'), true);
  s.stop();
  assert.equal(tekst.classList.contains('skelet-weg'), false);
});

test('een aria-busy dat de eigenaar zelf zette, blijft staan na stop()', () => {
  const vak = nieuwVak();
  vak.setAttribute('aria-busy', 'true');
  toonSkelet(vak, { vertraging: 0 }).stop();
  assert.equal(vak.getAttribute('aria-busy'), 'true');
});

test('een ontbrekend vak geeft een veilige no-op', () => {
  const s = toonSkelet(null);
  assert.doesNotThrow(() => s.stop());
  assert.equal(s.zichtbaar(), false);
});

test('elke vorm bouwt een aria-hidden skelet met blokken; een onbekende vorm valt terug op rijen', () => {
  const doc = nepDoc();
  for (const vorm of SKELET_VORMEN) {
    const el = bouwSkelet(vorm, { doc });
    assert.equal(el.getAttribute('aria-hidden'), 'true', vorm);
    assert.equal(el.dataset.skelet, vorm);
    assert.ok(el.zoek(k => k.className.includes('skelet-blok')).length > 0, `${vorm}: geen blokken`);
  }
  assert.equal(bouwSkelet('bestaat-niet', { doc }).dataset.skelet, 'rijen');
});

test('het skelet bevat geen tekst (alleen de aparte sr-only melding): geen servergegevens, geen innerHTML', () => {
  const doc = nepDoc();
  for (const vorm of SKELET_VORMEN) assert.equal(bouwSkelet(vorm, { doc }).zoek(k => k.textContent !== '').length, 0, vorm);
});
