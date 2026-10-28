import { test, expect } from './helpers.mjs';
import { ROLLEN, startRol } from './kliktest-hulp.mjs';

// Open dag, taak 16 (feedback van Brent): op pc (kolom) staat de paginatitel, met of zonder ondertitel, mooi in het midden van het ZICHTBARE
// glas van de zwevende bovenbalk (de `::before`-rechthoek van .topbar-sticky, niet het element zelf), en de linkerrand van de tekst staat
// minstens zo ver van de glasrand als de boven- en onderrand. Voor elk tabblad van elke rol, op 1366 × 768.
const TOLERANTIE = 2; // px
const MIN_LINKS = 14; // px

const tabNaam = (naam) => new RegExp('^' + naam + '(\\s|$)');

/** Meet glas en tekstblok in viewportcoördinaten. */
const meet = (page) => page.evaluate(() => {
  const kop = document.querySelector('.topbar-sticky');
  const r = kop.getBoundingClientRect();
  const cs = getComputedStyle(kop, '::before');
  const glas = { l: r.left + parseFloat(cs.left), t: r.top + parseFloat(cs.top), b: r.top + parseFloat(cs.top) + parseFloat(cs.height) };
  // het tekstblok: de unie van de zichtbare tekstregels (titel en eventueel de ondertitel), niet de flexbox eromheen
  const boxen = [];
  for (const id of ['paginatitel', 'paginasub']) {
    const el = document.getElementById(id);
    if (!el || el.hidden || !el.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const b = range.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    boxen.push({ l: b.left, t: eb.top, b: eb.bottom, tl: b.left });
  }
  const blok = { l: Math.min(...boxen.map((x) => x.l)), t: Math.min(...boxen.map((x) => x.t)), b: Math.max(...boxen.map((x) => x.b)) };
  return { glas, blok, titel: document.getElementById('paginatitel').textContent, sub: document.getElementById('paginasub').textContent, zichtbaar: boxen.length };
});

for (const rol of ROLLEN) {
  test(`pc: titel gecentreerd in het glas van de bovenbalk (${rol.naam})`, async ({ page }) => {
    await startRol(page, rol, 'pc');
    await expect(page.locator('.tabs-inner .tab:visible'), 'alle tabbladen van de rol staan er').toHaveCount(rol.tabs.length);
    const fouten = [];
    for (const naam of rol.tabs) {
      await page.locator('.tabs-inner .tab:visible', { hasText: tabNaam(naam) }).click();
      await expect(page.locator('#paginatitel')).toHaveText(naam);
      const m = await meet(page);
      const boven = m.blok.t - m.glas.t;
      const onder = m.glas.b - m.blok.b;
      const links = m.blok.l - m.glas.l;
      const midden = (m.blok.t + m.blok.b) / 2 - (m.glas.t + m.glas.b) / 2;
      const beschrijving = `${naam} (${m.sub ? 'met' : 'zonder'} ondertitel): boven ${boven.toFixed(1)}, onder ${onder.toFixed(1)}, links ${links.toFixed(1)}, afwijking midden ${midden.toFixed(1)}`;
      if (Math.abs(midden) > TOLERANTIE) fouten.push(`${beschrijving}: niet verticaal gecentreerd`);
      if (links < MIN_LINKS) fouten.push(`${beschrijving}: links minder dan ${MIN_LINKS} px`);
      if (links < Math.min(boven, onder) - TOLERANTIE) fouten.push(`${beschrijving}: links krapper dan boven en onder`);
      if (process.env.PK_LOG) console.log(rol.sleutel, beschrijving);
    }
    expect(fouten, fouten.join('\n')).toEqual([]);
  });
}
