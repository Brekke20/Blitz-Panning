// tests/tab-iconen.test.mjs — kern/tab-iconen.js (Open dag, taak 5): één register van tab-id naar icoon (inline SVG, lijnstijl 1,8),
// voor de vaste tabs van index.html en de tabs die rol-schil.js/sales-registratie.js aanmaken. Het icoon is decoratief (aria-hidden,
// niet focusbaar) en verandert de tekst van de tab niet. Een kleine nep-DOM volstaat (geen jsdom in het project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabIcoonSvg, zetTabIconen, ICOON_IDS } from '../public/js/kern/tab-iconen.js';

test('ICOON_IDS: de elf tabs van alle rollen', () => {
  assert.deepEqual(ICOON_IDS, ['tickets', 'kalender', 'planning', 'gepland', 'inventaris', 'rapporten', 'beheer',
    'sales-lijst', 'sales-kalender', 'sales-route', 'sales-afgewerkt']);
});

test('elke id geeft een decoratieve inline SVG in lijnstijl 1,8, zonder tekst', () => {
  for (const id of ICOON_IDS) {
    const svg = tabIcoonSvg(id);
    assert.match(svg, /^<svg\b[^>]*\bclass="tab-icoon"/, id);
    assert.match(svg, /\baria-hidden="true"/, id);
    assert.match(svg, /\bfocusable="false"/, id);
    assert.match(svg, /\bstroke-width="1\.8"/, id);
    assert.match(svg, /\bfill="none"/, id);
    assert.match(svg, /<\/svg>$/, id);
    assert.doesNotMatch(svg, /<title|<text/, `${id}: geen tekst in het icoon (de tab-tekst blijft de toegankelijke naam)`);
    assert.equal(svg.replace(/<[^>]*>/g, '').trim(), '', `${id}: geen tekstknopen`);
  }
});

test('de iconen volgen de mockup: Wachtrij, Kalender, Route, Ingepland, Inventaris, Rapporten, Beheer', () => {
  assert.ok(tabIcoonSvg('tickets').includes('M4 6h16M4 12h16M4 18h10'));
  assert.ok(tabIcoonSvg('kalender').includes('M16 3v4M8 3v4M3 10h18'));
  assert.ok(tabIcoonSvg('planning').includes('M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5'));
  assert.ok(tabIcoonSvg('gepland').includes('M9 15.5l2 2 4-4'));
  assert.ok(tabIcoonSvg('inventaris').includes('M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8'));
  assert.ok(tabIcoonSvg('rapporten').includes('M14 3v5h5M9 13h6M9 17h4'));
  assert.ok(tabIcoonSvg('beheer').includes('M4 7h10M18 7h2M4 17h4M12 17h8'));
  // de sales-tabs: Kalender en Route delen hun icoon met de techniektabs
  assert.equal(tabIcoonSvg('sales-kalender'), tabIcoonSvg('kalender'));
  assert.equal(tabIcoonSvg('sales-route'), tabIcoonSvg('planning'));
  assert.notEqual(tabIcoonSvg('sales-lijst'), tabIcoonSvg('tickets'), 'Leads = lijst met persoon, niet de gewone lijst');
  assert.match(tabIcoonSvg('sales-afgewerkt'), /<circle cx="12" cy="12" r="9"/, 'Afgewerkt = vinkje in een cirkel');
});

test('alle iconen verschillen, behalve de bewust gedeelde (sales-kalender, sales-route)', () => {
  const eigen = ICOON_IDS.filter(id => id !== 'sales-kalender' && id !== 'sales-route').map(tabIcoonSvg);
  assert.equal(new Set(eigen).size, eigen.length);
});

test('een onbekende id geeft een neutraal rondje (ook een SVG), nooit een fout', () => {
  for (const id of ['onbekend', '', undefined, null, '<script>']) {
    const svg = tabIcoonSvg(id);
    assert.match(svg, /^<svg\b[^>]*\bclass="tab-icoon"/);
    assert.match(svg, /<circle\b/);
    assert.doesNotMatch(svg, /script/);
  }
});

// ── zetTabIconen op een nep-DOM ────────────────────────────────────────────────
class NepKnop {
  constructor(arg, { metIcoon = false } = {}) {
    this.dataset = arg === undefined ? {} : { arg };
    this.html = [];
    if (metIcoon) this.html.push('<svg class="tab-icoon"></svg>');
    this.textContent = 'Label';
  }
  insertAdjacentHTML(waar, html) {
    assert.equal(waar, 'afterbegin', 'het icoon komt vóór het label');
    this.html.unshift(html);
  }
  querySelector(sel) {
    assert.equal(sel, '.tab-icoon');
    return this.html.some(h => h.includes('class="tab-icoon"')) ? {} : null;
  }
  get iconen() { return this.html.filter(h => h.includes('class="tab-icoon"')).length; }
}
const nepWortel = (knoppen) => ({
  querySelectorAll(sel) {
    assert.equal(sel, '.tab[data-arg]');
    return knoppen.filter(k => k.dataset.arg !== undefined);
  },
});

test('zetTabIconen zet één icoon als eerste kind van elke tab en is idempotent', () => {
  const knoppen = [new NepKnop('tickets'), new NepKnop('kalender'), new NepKnop('beheer')];
  const wortel = nepWortel(knoppen);
  zetTabIconen(wortel);
  zetTabIconen(wortel);
  for (const k of knoppen) {
    assert.equal(k.iconen, 1, `${k.dataset.arg}: precies één icoon na twee aanroepen`);
    assert.equal(k.html[0], tabIcoonSvg(k.dataset.arg));
    assert.equal(k.textContent, 'Label', 'de tekst van de tab blijft ongemoeid');
  }
});

test('zetTabIconen laat een tab met een icoon ongemoeid en verdraagt een lege of ontbrekende wortel', () => {
  const al = new NepKnop('kalender', { metIcoon: true });
  zetTabIconen(nepWortel([al]));
  assert.equal(al.iconen, 1);
  assert.equal(al.html.length, 1);
  assert.doesNotThrow(() => zetTabIconen(nepWortel([])));
  assert.doesNotThrow(() => zetTabIconen(null));
  assert.doesNotThrow(() => zetTabIconen(undefined));
});
