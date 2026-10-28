import { test, expect } from './helpers.mjs';
import { ROLLEN, startRol } from './kliktest-hulp.mjs';

// Open dag, taak 16 (feedback van Brent: "enkele hoeken recht ipv afgerond, dit zorgt dat het enorm hard uit de boot valt"): op pc (zijkolom,
// 1366 × 768) heeft geen enkel zichtbaar vlak in de hoofdinhoud nog een rechte hoek terwijl de rest afgerond is. De meting loopt per rol over
// elk tabblad (en elk Beheer-subtabblad) en zoekt elk zichtbaar element groter dan 120 × 40 px met een achtergrond, `backdrop-filter` of een rand
// op minstens twee zijden dat op een hoek een `border-radius` van 0 heeft.
//
// Vaste uitzonderingen (de reden staat erbij):
//  1. Een rand op één zijde is een lijn, geen vlak: de onderstreping van de Beheer-tabs, de scheidingslijn van een tabelrij, de lijn van een
//     tabelkop. Zulke elementen tellen niet mee (zie `heeftVlak`).
//  2. Een element binnen een voorouder die afknipt (`overflow` niet `visible`) en zelf een straal heeft: de buitenhoeken knipt die kaart af en de
//     rest is een interne verdeling (kolommen van het weekraster in `#week-grid`, de rijen en cellen van een tabel in `.bg-lijst`, de uurblokken
//     van de dag). Zie `geknipt`.
//  3. De Leaflet-kaart en zijn knoppen, legende en lagenkiezer (`.leaflet-*`): de kaart zit in een afgeronde houder met `overflow: hidden`
//     (`#map-wrap`, `.sales-route-kaartvak`); de bedieningsvakjes tekent Leaflet zelf met een eigen kleine straal en vallen binnen die houder.
//  4. Alles buiten `#hoofdinhoud` (zijkolom, kop, vensters, meldingsbalken): die hebben eigen metingen (e2e/kop-balken.spec.mjs, e2e/navigatie.spec.mjs).
//  5. `svg`-elementen en de panelen die verborgen zijn of 0 dekking hebben.
// Wat daarna nog in `UITZONDERINGEN` staat, is een selector met een eigen reden; die lijst is bewust leeg: er zijn er geen nodig.
const MIN_B = 120, MIN_H = 40;

// Een uitzondering is een CSS-selector (`el.matches`) of { sel, hoeken } als enkel bepaalde hoeken recht mogen zijn.
export const UITZONDERINGEN = [];

const tabNaam = (naam) => new RegExp('^' + naam + '(\\s|$)');

/** Alle elementen met een rechte hoek in het actieve paneel (en de balken eronder), als leesbare beschrijvingen. */
const zoekRechteHoeken = (page, uitzonderingen) => page.evaluate(({ MIN_B, MIN_H, uitzonderingen }) => {
  const alfa = (kleur) => {
    if (!kleur || kleur === 'transparent') return 0;
    const m = kleur.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const d = m[1].split(/[,\s/]+/).filter(Boolean); return d.length >= 4 ? parseFloat(d[3]) : 1; }
    const c = kleur.match(/^color\(.*\/\s*([\d.]+%?)\s*\)$/);
    if (c) return c[1].endsWith('%') ? parseFloat(c[1]) / 100 : parseFloat(c[1]);
    return 1; // een andere kleurnotatie zonder alfa (oklch, lab, ...): ondoorzichtig
  };
  const heeftVlak = (cs) => {
    if (alfa(cs.backgroundColor) > 0.02) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if ((cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none')) return true;
    // Een rand telt als vlak als minstens twee zijden er een hebben; één lijn (onderstreping van een tab, scheidingslijn van een tabelrij) is geen vlak.
    let zijden = 0;
    for (const z of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs[`border${z}Width`]) > 0 && cs[`border${z}Style`] !== 'none' && alfa(cs[`border${z}Color`]) > 0.02) zijden++;
    if (zijden >= 2) return true;
    return false;
  };
  const HOEKEN = [['tl', 'borderTopLeftRadius', 0, 0], ['tr', 'borderTopRightRadius', 1, 0], ['br', 'borderBottomRightRadius', 1, 1], ['bl', 'borderBottomLeftRadius', 0, 1]];
  const straal = (cs, prop) => parseFloat(cs[prop]) || 0;
  const beschrijf = (el) => {
    const stuk = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 3).map((c) => '.' + c).join('');
    const keten = [];
    for (let e = el, n = 0; e && e !== document.body && n < 3; e = e.parentElement, n++) keten.push(stuk(e));
    return keten.join(' < ');
  };
  const ouders = new Map(); // element -> { knipt, cs, r } (eenmaal berekend)
  const ouderInfo = (a) => {
    let i = ouders.get(a);
    if (!i) { const acs = getComputedStyle(a); i = { knipt: acs.overflowX !== 'visible' || acs.overflowY !== 'visible', cs: acs }; ouders.set(a, i); }
    return i;
  };
  // Binnen een voorouder die afknipt (overflow) en een straal heeft (een tabel of kolommenraster in een kaart): de buitenhoeken knipt de kaart af en de
  // rest is een interne verdeling (een kolom, een rij) die geen eigen hoek laat zien.
  const geknipt = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const info = ouderInfo(a);
      if (info.knipt && HOEKEN.some((h) => straal(info.cs, h[1]) > 0)) return true;
    }
    return false;
  };
  const gevonden = [];
  const wortel = document.querySelector('#hoofdinhoud') || document.body;
  for (const el of wortel.querySelectorAll('*')) {
    if (el.closest('svg, .leaflet-tile-pane, .leaflet-marker-pane, .leaflet-overlay-pane, .leaflet-control-container, .leaflet-shadow-pane, .leaflet-popup-pane')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_B || r.height < MIN_H) continue;
    // niet zichtbaar als een voorouder verborgen is (offsetParent is null voor display:none ouders; fixed elementen uitgezonderd)
    if (!el.getClientRects().length) continue;
    if (!heeftVlak(cs)) continue;
    const rechte = HOEKEN.filter((h) => straal(cs, h[1]) === 0 && !geknipt(el)).map((h) => h[0]);
    if (!rechte.length) continue;
    const ui = uitzonderingen.find((u) => el.matches(u.sel) && (!u.hoeken || rechte.every((h) => u.hoeken.includes(h))));
    if (ui) continue;
    gevonden.push(`${beschrijf(el)} [${Math.round(r.width)}×${Math.round(r.height)}] rechte hoeken: ${rechte.join(',')}`);
  }
  return gevonden;
}, { MIN_B, MIN_H, uitzonderingen: uitzonderingen.map((u) => (typeof u === 'string' ? { sel: u } : u)) });

// De route-indeling (technieker en verkoper) heeft drie vlakken die de algemene meting niet allemaal ziet (de samenvatting onderaan is lager dan
// 40 px): de lijstkolom, de kaart en de samenvatting zijn alle drie ronde panelen (--r-kaart, 22 px) met 8 px lucht ertussen.
const controleerRoute = (page) => page.evaluate(() => {
  const actief = document.querySelector('.view.active');
  const vlakken = { lijst: actief.querySelector('#route-list, .sales-route-lijstvak'), kaart: actief.querySelector('#map-wrap, .sales-route-kaartvak'), samenvatting: actief.querySelector('.plan-summary') };
  const uit = {};
  for (const [naam, el] of Object.entries(vlakken)) {
    if (!el) { uit[naam] = 'ontbreekt'; continue; }
    const cs = getComputedStyle(el);
    uit[naam] = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((h) => parseFloat(cs[`border${h}Radius`]));
  }
  const lijst = vlakken.lijst?.getBoundingClientRect(), kaart = vlakken.kaart?.getBoundingClientRect(), som = vlakken.samenvatting?.getBoundingClientRect();
  const kop = actief.querySelector('.route-balk')?.getBoundingClientRect();
  uit.maten = lijst && kaart && som && kop ? { luchtLijstKaart: kaart.left - lijst.right, luchtOnderKaart: som.top - kaart.bottom, rechtsKaart: kop.right - kaart.right, rechtsSamenvatting: kop.right - som.right } : null;
  return uit;
});

/** Wacht tot het actieve paneel niet meer verandert (twee gelijke metingen na elkaar): sommige schermen tekenen na het wisselen nog (kaart, lijst). */
async function wachtOpStabielPaneel(page) {
  let vorige = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => document.querySelector('.view.active')?.innerHTML.length ?? 0);
    const klaar = n > 0 && n === vorige;
    vorige = n;
    return klaar;
  }, { intervals: [150, 150, 250, 250, 500], timeout: 10_000 }).toBe(true);
}

for (const rol of ROLLEN) {
  test(`pc: geen rechte hoeken in de inhoud (${rol.naam})`, async ({ page }) => {
    test.setTimeout(60_000);
    await startRol(page, rol, 'pc');
    await expect(page.locator('.tabs-inner .tab:visible'), 'alle tabbladen van de rol staan er').toHaveCount(rol.tabs.length);
    const fouten = [];
    const meet = async (naam) => {
      for (const f of await zoekRechteHoeken(page, UITZONDERINGEN)) fouten.push(`${naam}: ${f}`);
    };
    for (const naam of rol.tabs) {
      await page.locator('.tabs-inner .tab:visible', { hasText: tabNaam(naam) }).click();
      await expect(page.locator('#paginatitel')).toHaveText(naam);
      if (naam === 'Route') await expect(page.locator('.view.active .plan-body')).toBeVisible();
      await wachtOpStabielPaneel(page);
      if (naam === 'Beheer') {
        const balk = page.locator('.beheer-tabs');
        await expect(balk).toBeVisible();
        await expect(page.locator('#beheer-paneel')).not.toHaveAttribute('aria-busy', 'true');
        for (const sub of rol.beheer) {
          const knop = balk.getByRole('tab', { name: sub, exact: true });
          await knop.click();
          await expect(knop).toHaveAttribute('aria-selected', 'true');
          await expect(page.locator('#beheer-paneel')).not.toHaveAttribute('aria-busy', 'true');
          await meet(`Beheer > ${sub}`);
        }
      } else {
        await meet(naam);
        if (naam === 'Route') {
          const route = await controleerRoute(page);
          for (const vlak of ['lijst', 'kaart', 'samenvatting']) {
            if (!Array.isArray(route[vlak])) fouten.push(`Route: ${vlak} ${route[vlak]}`);
            else if (route[vlak].some((r) => r < 22)) fouten.push(`Route: ${vlak} heeft een hoek onder 22 px (${route[vlak].join('/')})`);
          }
          const m = route.maten;
          if (!m) fouten.push('Route: lijst, kaart, samenvatting of balk ontbreekt');
          else {
            if (Math.abs(m.luchtLijstKaart - 8) > 1) fouten.push(`Route: ${m.luchtLijstKaart} px tussen lijst en kaart (verwacht 8)`);
            if (Math.abs(m.luchtOnderKaart - 8) > 1) fouten.push(`Route: ${m.luchtOnderKaart} px tussen kaart en samenvatting (verwacht 8)`);
            if (Math.abs(m.rechtsKaart) > 1) fouten.push(`Route: de kaart eindigt ${m.rechtsKaart} px naast de balk`);
            if (Math.abs(m.rechtsSamenvatting) > 1) fouten.push(`Route: de samenvatting eindigt ${m.rechtsSamenvatting} px naast de balk`);
          }
        }
      }
    }
    expect(fouten, `elementen met een rechte hoek:\n${[...new Set(fouten)].join('\n')}`).toEqual([]);
  });
}

// Toestanden die de tabbladen hierboven niet tonen: de maandweergave van de Kalender en het uitklappaneel "zonder datum".
test('pc: geen rechte hoeken in de maandweergave en het paneel zonder datum van de Kalender', async ({ page }) => {
  await startRol(page, ROLLEN.find((r) => r.sleutel === 'beheerder-planning'), 'pc');
  await page.locator('.tabs-inner .tab:visible', { hasText: tabNaam('Kalender') }).click();
  await expect(page.locator('#view-kalender')).toHaveClass(/active/);
  await page.locator('#kal-view-month').click();
  await expect(page.locator('#kal-view-month')).toHaveAttribute('aria-pressed', 'true');
  await wachtOpStabielPaneel(page);
  const fouten = (await zoekRechteHoeken(page, UITZONDERINGEN)).map((f) => `maand: ${f}`);
  const pil = page.locator('#kal-pending-pill');
  await expect(pil).toBeVisible();
  await pil.click();
  await expect(page.locator('#kal-no-date-section')).toHaveClass(/open/);
  await wachtOpStabielPaneel(page);
  for (const f of await zoekRechteHoeken(page, UITZONDERINGEN)) fouten.push(`zonder datum: ${f}`);
  expect(fouten, `elementen met een rechte hoek:\n${[...new Set(fouten)].join('\n')}`).toEqual([]);
});
