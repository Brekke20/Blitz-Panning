// De kleurkeuze van de routelijn (kern/kleur-keuze.js): de vaste reeks, het extra staaltje voor een al bewaarde kleur en de knoppenrij.
// Een minimale nep-DOM: enkel wat de helper aanraakt.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_KLEUREN, kleurNaam, kleurOpties, bouwKleurKeuze, leesKleurKeuze } from '../public/js/kern/kleur-keuze.js';
import { isKleur } from '../public/js/kern/instellingen-regels.js';

function nepElement(tag = 'div') {
  const el = {
    tag, dataset: {}, style: {}, attrs: {}, kinderen: [], luisteraars: {}, textContent: '', className: '', focused: false,
    classList: { add(c) { if (!el.className.split(' ').includes(c)) el.className = (el.className + ' ' + c).trim(); } },
    setAttribute(k, v) { el.attrs[k] = v; },
    addEventListener(naam, fn) { el.luisteraars[naam] = fn; },
    replaceChildren(...k) { el.kinderen = k; },
    querySelector(sel) { const m = /data-kleur="([^"]+)"/.exec(sel); return el.kinderen.find(k => k.dataset.kleur === m[1]) ?? null; },
    focus() { el.focused = true; },
    tik() { el.luisteraars.click(); },
  };
  return el;
}
beforeEach(() => { globalThis.document = { createElement: nepElement }; });
afterEach(() => { delete globalThis.document; });

test('de reeks telt 8 unieke, geldige kleuren met naam en begint met de standaard routekleur (amber, #f59e0b)', () => {
  assert.equal(ROUTE_KLEUREN.length, 8);
  assert.equal(new Set(ROUTE_KLEUREN.map(k => k.hex)).size, 8);
  assert.equal(new Set(ROUTE_KLEUREN.map(k => k.naam)).size, 8);
  for (const k of ROUTE_KLEUREN) { assert.ok(isKleur(k.hex), k.hex); assert.equal(k.hex, k.hex.toLowerCase()); assert.ok(k.naam.length > 0); }
  assert.ok(ROUTE_KLEUREN[0].hex === '#f59e0b');
});

test('kleurNaam: naam uit de reeks (hoofdletterongevoelig), anders "Eigen kleur"', () => {
  assert.equal(kleurNaam('#2563eb'), 'Blauw');
  assert.equal(kleurNaam('#2563EB'), 'Blauw');
  assert.equal(kleurNaam('#123456'), 'Eigen kleur');
  assert.equal(kleurNaam(undefined), 'Eigen kleur');
});

test('kleurOpties: een kleur uit de reeks voegt niets toe; een andere geldige kleur wordt een extra staaltje; ongeldig/leeg niet', () => {
  assert.equal(kleurOpties('#f59e0b').length, 8);
  assert.equal(kleurOpties('#F59E0B').length, 8);
  const extra = kleurOpties('#12AB34');
  assert.equal(extra.length, 9);
  assert.deepEqual(extra[8], { naam: 'Eigen kleur', hex: '#12ab34', extra: true });
  for (const ongeldig of [undefined, null, '', 'rood', '#12', 42]) assert.equal(kleurOpties(ongeldig).length, 8, String(ongeldig));
});

test('bouwKleurKeuze: knoppen met aria-label (kleurnaam) en aria-pressed; de gekozen kleur is aangeduid met een vinkje', () => {
  const doos = nepElement();
  bouwKleurKeuze(doos, '#2563eb');
  assert.equal(doos.kinderen.length, 8);
  assert.deepEqual(doos.kinderen.map(k => k.attrs['aria-label']), ROUTE_KLEUREN.map(k => k.naam));
  for (const k of doos.kinderen) { assert.equal(k.tag, 'button'); assert.equal(k.type, 'button'); }
  const aan = doos.kinderen.filter(k => k.attrs['aria-pressed'] === 'true');
  assert.equal(aan.length, 1);
  assert.equal(aan[0].attrs['aria-label'], 'Blauw');
  assert.equal(aan[0].textContent, '✓');
  assert.equal(aan[0].style.background, '#2563eb');
  assert.equal(leesKleurKeuze(doos), '#2563eb');
});

test('bouwKleurKeuze: een tik kiest, herbouwt de rij, houdt de focus en meldt de hex; niets gekozen valt terug op de standaard', () => {
  const doos = nepElement();
  const gemeld = [];
  bouwKleurKeuze(doos, undefined, (hex) => gemeld.push(hex));
  assert.equal(leesKleurKeuze(doos), ROUTE_KLEUREN[0].hex);
  doos.kinderen.find(k => k.attrs['aria-label'] === 'Groen').tik();
  assert.deepEqual(gemeld, ['#16a34a']);
  assert.equal(leesKleurKeuze(doos), '#16a34a');
  const aan = doos.kinderen.filter(k => k.attrs['aria-pressed'] === 'true');
  assert.equal(aan.length, 1);
  assert.equal(aan[0].attrs['aria-label'], 'Groen');
  assert.equal(aan[0].focused, true);
});

test('bouwKleurKeuze: een bewaarde kleur buiten de reeks verschijnt als extra, gekozen staaltje (niets gaat verloren)', () => {
  const doos = nepElement();
  bouwKleurKeuze(doos, '#12ab34');
  assert.equal(doos.kinderen.length, 9);
  const aan = doos.kinderen.filter(k => k.attrs['aria-pressed'] === 'true');
  assert.equal(aan.length, 1);
  assert.equal(aan[0].attrs['aria-label'], 'Eigen kleur');
  assert.equal(leesKleurKeuze(doos), '#12ab34');
  // Kiest hij daarna een kleur uit de reeks, dan verdwijnt het extra staaltje (de keuze is een bewuste vervanging).
  doos.kinderen.find(k => k.attrs['aria-label'] === 'Rood').tik();
  assert.equal(doos.kinderen.length, 8);
});

test('leesKleurKeuze zonder element of zonder keuze geeft een lege tekst', () => {
  assert.equal(leesKleurKeuze(null), '');
  assert.equal(leesKleurKeuze(nepElement()), '');
});
