// tests/skelet.test.mjs — kern/skelet.js: het skelet verschijnt pas na de vertraging, enkel bij een leeg vak, met aria-busy op het vak,
// aria-hidden op het skelet en een visueel verborgen "Laden…"; stop() ruimt alles op. Een kleine nep-DOM volstaat (geen jsdom in het project).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { toonSkelet, bouwSkelet, SKELET_VERTRAGING_MS, SKELET_VORMEN, maakTicketsStand, bouwTicketsSkelet, bouwTicketsMelding, TICKETS_LADEN_ATTR } from '../public/js/kern/skelet.js';

class NepEl {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.tag = tag; this.children = []; this.parent = null; this.attrs = new Map(); this.dataset = {};
    this.style = {}; this.className = ''; this.textContent = '';
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
  }
  get childElementCount() { return this.children.length; }
  append(...kinderen) { for (const k of kinderen) { k.parent = this; this.children.push(k); } }
  prepend(...kinderen) { for (const k of kinderen) k.parent = this; this.children.unshift(...kinderen); }
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

// ── L1: de tickets-stand en het skelet van Kalender, Ingepland en Route ──
// Eén JS-timer per eerste lading zet een attribuut op <html>; CSS toont het skelet enkel onder dat attribuut. Zo stuurt een nepklok
// (page.clock) de 150 ms deterministisch en begint een hertekening tijdens het laden de vertraging nooit opnieuw.
const nepWortel = () => nepDoc().createElement('html');

test('tickets-stand: begint onbekend; het attribuut komt pas na precies 150 ms, via één timer', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const wortel = nepWortel();
    const s = maakTicketsStand({ wortel });
    assert.equal(s.stand(), 'onbekend');
    assert.equal(s.isBekend(), false);
    s.start();
    mock.timers.tick(SKELET_VERTRAGING_MS - 1);
    assert.equal(wortel.hasAttribute(TICKETS_LADEN_ATTR), false);
    mock.timers.tick(1);
    assert.equal(wortel.getAttribute(TICKETS_LADEN_ATTR), 'zichtbaar');
    assert.equal(s.stand(), 'onbekend', 'het attribuut verandert de stand niet');
  } finally { mock.timers.reset(); }
});

test('tickets-stand: start() is idempotent (een tweede aanroep begint de 150 ms niet opnieuw)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const wortel = nepWortel();
    const s = maakTicketsStand({ wortel });
    s.start();
    mock.timers.tick(100);
    s.start(); // bv. een hertekening of een tweede lading tijdens het wachten
    mock.timers.tick(50);
    assert.equal(wortel.getAttribute(TICKETS_LADEN_ATTR), 'zichtbaar', 'nog steeds 150 ms na de EERSTE start');
  } finally { mock.timers.reset(); }
});

test('tickets-stand: bekend() vóór de vertraging: het attribuut komt er nooit; erna wordt het weggehaald', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const wortel = nepWortel();
    const s = maakTicketsStand({ wortel });
    s.start();
    mock.timers.tick(100);
    assert.equal(s.bekend(), true, 'meldt dat dit de overgang onbekend → bekend was');
    assert.equal(s.stand(), 'bekend');
    assert.equal(s.isBekend(), true);
    mock.timers.tick(1000);
    assert.equal(wortel.hasAttribute(TICKETS_LADEN_ATTR), false, 'de timer is opgeruimd');

    const w2 = nepWortel();
    const s2 = maakTicketsStand({ wortel: w2 });
    s2.start();
    mock.timers.tick(200);
    assert.equal(w2.getAttribute(TICKETS_LADEN_ATTR), 'zichtbaar');
    s2.bekend();
    assert.equal(w2.hasAttribute(TICKETS_LADEN_ATTR), false);
    assert.equal(s2.bekend(), false, 'een tweede bekend() is geen overgang meer');
  } finally { mock.timers.reset(); }
});

test('tickets-stand: mislukt() enkel zolang onbekend; wist het attribuut en telt als bekend voor de lege staat', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const wortel = nepWortel();
    const s = maakTicketsStand({ wortel });
    s.start();
    mock.timers.tick(300);
    assert.equal(s.mislukt(), true);
    assert.equal(s.stand(), 'mislukt');
    assert.equal(s.isBekend(), true, 'na een mislukte eerste lading is de lege staat eerlijk: geen skelet meer');
    assert.equal(wortel.hasAttribute(TICKETS_LADEN_ATTR), false);
    assert.equal(s.mislukt(), false);
    // Een latere geslaagde lading (poll) maakt er een gewone bekende stand van, maar is geen overgang uit 'onbekend'.
    assert.equal(s.bekend(), false);
    assert.equal(s.stand(), 'bekend');
    // Een mislukte lading na een geslaagde verandert niets.
    assert.equal(s.mislukt(), false);
    assert.equal(s.stand(), 'bekend');
  } finally { mock.timers.reset(); }
});

test('tickets-stand: bekend() zonder start() (bewaarde kopie) zet nooit een attribuut en start nadien niets meer', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const wortel = nepWortel();
    const s = maakTicketsStand({ wortel });
    s.bekend();
    s.start();
    mock.timers.tick(1000);
    assert.equal(wortel.hasAttribute(TICKETS_LADEN_ATTR), false);
  } finally { mock.timers.reset(); }
});

test('tickets-stand: zonder wortel (node, geen document) geen fout', () => {
  const s = maakTicketsStand({ wortel: null });
  assert.doesNotThrow(() => { s.start(); s.bekend(); s.mislukt(); });
});

test('tickets-skelet: aria-hidden, onzichtbaar tot het attribuut (klasse skelet--tickets), met variant en zonder tekst', () => {
  const doc = nepDoc();
  const el = bouwTicketsSkelet('kaarten', { doc, aantal: 2, variant: 'kal' });
  assert.equal(el.getAttribute('aria-hidden'), 'true');
  assert.equal(el.dataset.skelet, 'kaarten');
  assert.ok(el.className.split(' ').includes('skelet'));
  assert.ok(el.className.split(' ').includes('skelet--tickets'));
  assert.ok(el.className.split(' ').includes('skelet--kal'));
  assert.equal(el.zoek(k => k.className.includes('skelet-kaart') && !k.className.includes('skelet-kaarten')).length, 2);
  assert.equal(el.zoek(k => k.textContent !== '').length, 0);
  assert.equal(bouwTicketsSkelet('kaarten', { doc }).className.includes('skelet--undefined'), false);
});

test('tickets-skelet met kop: een kopblok vóór de kaarten (de dagkop van Ingepland)', () => {
  const doc = nepDoc();
  const el = bouwTicketsSkelet('kaarten', { doc, aantal: 1, metKop: true });
  const eerste = el.children[0];
  assert.ok(eerste.className.includes('skelet-kop'), 'het kopblok staat vooraan in het skelet');
  assert.ok(eerste.className.includes('skelet-blok'));
});

test('tickets-melding: één visueel verborgen "Laden…" met role=status, enkel zichtbaar voor schermlezers onder het attribuut', () => {
  const doc = nepDoc();
  const m = bouwTicketsMelding(doc);
  assert.equal(m.getAttribute('role'), 'status');
  assert.equal(m.textContent, 'Laden…');
  assert.match(m.className, /sr-only/);
  assert.match(m.className, /skelet-melding--tickets/);
  assert.equal(m.getAttribute('aria-hidden'), null);
});
