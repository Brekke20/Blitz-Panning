// De kliksweep van taak 13: klikt een voor een alle zichtbare, ingeschakelde knoppen en klikbare elementen in een vlak van de pagina
// (een tabblad, de kop, een venster) en controleert na elke klik: geen pageerror of consolefout, geen verzoek buiten de stubs, en een
// zichtbaar gevolg (iets opent, wisselt, verandert van tekst of status, of een stub-verzoek gaat uit). Een knop die een venster opent
// wordt één niveau dieper doorgeklikt (`diepte`); tussen de klikken wordt de toestand hersteld (Escape, het tabblad terug, een herstart).
// Dit bestand omzeilt geen vangnet: de fixture van helpers.mjs blijft elke consolefout en elk onverwacht verzoek aan het eind van de test
// laten falen; hier worden ze enkel per knop toegeschreven, zodat de melding zegt WELKE knop het deed.
import { expect } from './helpers.mjs';

// Alles wat een gebruiker kan aanklikken: knoppen, [data-actie], [role=button], links in de app en uitklapbare koppen.
export const KLIKBAAR = ':is(button, [data-actie], [role=button], a[href], summary):visible:not(:disabled):not([aria-disabled=true])';
const VENSTERS = '[role=dialog], [role=alertdialog], .person-menu.open, .gebruiker-menu.open';
const MARKER = 'data-kt-wortel';

// OVERSLAGLIJST: elke overgeslagen knop heeft hier een reden. Houd ze klein; de volledige lijst staat in het rapport.
export const OVERSLAAN = [
  { patroon: (d) => d.actie === 'gebruiker-uitloggen', reden: 'Uitloggen eindigt de sessie (en wist het toestel); getest in e2e/logins-rechten.spec.mjs en e2e/inloggen.spec.mjs.' },
  { patroon: (d) => /^(tel:|mailto:|https?:)/.test(d.href) && !/^https?:\/\/localhost/.test(d.href), reden: 'Verlaat de app (bellen, mailen, kaarten of de bronvermelding van Leaflet): een externe navigatie, geen app-gedrag.' },
  { patroon: (d) => /Navigeer|↗/.test(d.tekst), reden: 'Opent Google Maps in een nieuw venster (window.open naar een externe site); het vangnet van de fixture weigert dat bewust.' },
  { patroon: (d) => d.actie === 'rapport-export' || d.id === 'inv-export-btn' || d.actie === 'sales-export' || /Excel export/.test(d.tekst), reden: 'Start een bestandsdownload (ExcelJS van het CDN); de export heeft eigen specs (excel-export in e2e/inventaris-weergave.spec.mjs en e2e/rapporten-null-records.spec.mjs).' },
  { patroon: (d) => d.actie === 'import-kies' || d.actie === 'afspraak-import' || d.actie === 'sales-import-kies' || d.actie === 'sales-export-laden', reden: 'Opent de bestandskiezer van het besturingssysteem; het importeren heeft eigen specs (e2e/afspraken.spec.mjs, e2e/sales-import.spec.mjs).' },
  { patroon: (d) => d.actie === 'foto-kies' || /Pakket uploaden|Foto toevoegen/.test(d.tekst), reden: 'Opent de bestandskiezer van het besturingssysteem (foto of themapakket); uploaden heeft eigen specs (e2e/fotos.spec.mjs, e2e/beheer-themas.spec.mjs).' },
  { patroon: (d) => d.actie === 'wizard-print' || /printRapport|window\.print/.test(d.onclick) || /Afdrukken|Printen/.test(d.tekst), reden: 'window.print() opent het afdrukvenster van de browser; afdrukken heeft eigen specs (e2e/rapport-drukkopie-veilig.spec.mjs).' },
];

const beschrijf = (els) => els.map((e) => ({
  tag: e.tagName.toLowerCase(),
  actie: e.dataset.actie ?? '',
  tekst: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  aria: e.getAttribute('aria-label') ?? e.getAttribute('title') ?? '',
  id: e.id,
  href: e.getAttribute('href') ?? '',
  onclick: (e.getAttribute('onclick') || '').slice(0, 40),
  type: e.getAttribute('type') ?? '',
}));

// De sleutel van een knop: stabiel over herrenders heen. De tekst telt enkel mee als niets anders de knop onderscheidt
// (de tekst van "Vandaag" of van een teller verandert met de toestand).
const sleutelVan = (d) => (d.actie || d.aria || d.id || d.onclick ? [d.tag, d.actie, d.aria, d.id, d.onclick, d.href].join('|') : [d.tag, d.tekst, d.href].join('|'));

const vingerafdruk = (page) => metHerlaad(page, () => page.evaluate((marker) => {
  const h = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return x; };
  const opslag = (o) => { try { return JSON.stringify(Object.entries(o).sort()); } catch { return ''; } };
  const html = document.documentElement.outerHTML.split(` ${marker}=""`).join('');
  // De toestand van invoervelden zit in eigenschappen, niet in de HTML (een stepper zet enkel input.value): die tellen ook mee.
  const velden = [...document.querySelectorAll('input, select, textarea')].map((e) => (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value)).join('|');
  return `${h(html)}|${h(velden)}|${h(opslag(localStorage))}|${h(opslag(sessionStorage))}`;
}, MARKER));

// Een klik kan de pagina herladen (bv. "Testgegevens opnieuw kopiëren" in Instellingen, Dit toestel): een evaluate die dan midden in de
// navigatie valt, wacht tot de app weer staat en probeert het opnieuw. Dat is gewenst gedrag van die knop, geen fout.
async function metHerlaad(page, fn) {
  for (let poging = 0; poging < 4; poging++) {
    try { return await fn(); } catch (fout) {
      if (!/Execution context was destroyed|most likely because of a navigation/.test(String(fout?.message))) throw fout;
      await page.waitForLoadState('load');
      await page.locator('.tabs-inner .tab:visible').first().waitFor({ timeout: 15000 });
    }
  }
  return fn();
}

// De vensters die nu zichtbaar zijn (sleutel per venster, in documentvolgorde).
let negeerSel = null; // een venster dat de sweep zelf bedient (de rapportwizard): telt niet als "open venster" en wordt nooit met Escape gesloten
export const negeerVenster = (sel) => { negeerSel = sel; };
const openVensters = (page) => metHerlaad(page, () => page.evaluate(({ sel, negeer }) => [...document.querySelectorAll(sel)]
  .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !(negeer && e.matches(negeer)))
  .map((e) => e.id || e.getAttribute('aria-labelledby') || e.getAttribute('aria-label') || e.className), { sel: VENSTERS, negeer: negeerSel }));

// Wacht kort tot de gevolgen van een klik (microtaken, renders, een stub-antwoord) binnen zijn. Een tijdlus in de pagina, geen waitForTimeout.
const rust = (page, ms = 120) => metHerlaad(page, () => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms));

/** Maakt de context van een sweep. `herstel` brengt de pagina terug in het uitgangspunt (tabblad actief, geen vensters). */
export function maakContext(page, { verzoeken, consoleFouten, herstel, herstart }) {
  negeerSel = null;
  const ctx = {
    page, verzoeken, consoleFouten, herstel, herstart, herstarts: 0, openers: new Map(), nietTerug: new Set(), // sleutels die ook na een herstart niet meer te vinden waren
    geklikt: 0, overgeslagen: [], geenGevolg: [], bevindingen: [], verdwenen: 0, vensters: [], populaties: {},
    gezien: new Set(), // handtekeningen van vensters die al doorgeklikt zijn (een identiek venster wordt niet nog eens doorgelopen)
    dialogen: 0, popups: 0,
  };
  page.on('dialog', async (d) => { ctx.dialogen++; try { await d.accept(); } catch { /* al afgehandeld */ } });
  page.context().on('page', async (p) => { ctx.popups++; try { await p.close(); } catch { /* al gesloten */ } });
  return ctx;
}

// Sluit alle vensters (Escape, dan een sluitknop), haalt de marker weg en laat de context het uitgangspunt herstellen.
export async function herstelBasis(page, ctx) {
  for (let i = 0; i < 6; i++) {
    if ((await openVensters(page)).length === 0) break;
    await page.keyboard.press('Escape');
    await rust(page, 60);
    if (i >= 2 && (await openVensters(page)).length > 0) {
      const sluit = page.locator(`${VENSTERS.split(', ').map((s) => `${s} :is(.mhdr-close, [aria-label=Sluiten], [data-actie$=sluit]):visible`).join(', ')}`).first();
      if (await sluit.count() > 0) await sluit.click({ timeout: 2000 }).catch(() => {});
      else {
        // Een venster zonder sluitkruisje en dat Escape negeert (bv. "Nieuw startwachtwoord": je ziet het wachtwoord maar één keer): de laatste knop sluit het.
        const laatste = page.locator(VENSTERS).filter({ visible: true }).last().getByRole('button', { name: /genoteerd|sluiten|klaar|^ok$/i }).last();
        if (await laatste.count() > 0) await laatste.click({ timeout: 2000 }).catch(() => {});
      }
    }
  }
  await page.evaluate((m) => document.querySelectorAll(`[${m}]`).forEach((e) => e.removeAttribute(m)), MARKER);
  await ctx.herstel?.();
}

// Zet de marker op het eerste zichtbare venster dat er voor de klik nog niet was.
async function markeerNieuwVenster(page, voor) {
  return page.evaluate(({ sel, marker, voor, negeer }) => {
    document.querySelectorAll(`[${marker}]`).forEach((e) => e.removeAttribute(marker));
    const zichtbaar = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !(negeer && e.matches(negeer)));
    const sleutel = (e) => e.id || e.getAttribute('aria-labelledby') || e.getAttribute('aria-label') || e.className;
    const rest = [...voor];
    const nieuw = zichtbaar.find((e) => { const i = rest.indexOf(sleutel(e)); if (i >= 0) { rest.splice(i, 1); return false; } return true; });
    if (!nieuw) return null;
    nieuw.setAttribute(marker, '');
    return sleutel(nieuw);
  }, { sel: VENSTERS, marker: MARKER, voor, negeer: negeerSel });
}

const wortelLocator = (page, wortelSel) => page.locator(wortelSel);

async function lijstIn(page, wortelSel) {
  return metHerlaad(page, () => wortelLocator(page, wortelSel).locator(KLIKBAAR).evaluateAll(beschrijf));
}

// Opent het venster op `pad` opnieuw (de openers vanaf het uitgangspunt), zodat een binnenste knop opnieuw klikbaar is.
async function openPad(page, ctx, basisSel, pad) {
  await herstelBasis(page, ctx);
  let wortelSel = basisSel;
  for (const stap of pad) {
    const lijst = await lijstIn(page, wortelSel);
    const idx = nthVan(lijst, stap.sleutel, stap.n);
    if (idx < 0) return false;
    const voor = await openVensters(page);
    await wortelLocator(page, wortelSel).locator(KLIKBAAR).nth(idx).click({ timeout: 4000 }).catch(() => {});
    await rust(page);
    if (!(await markeerNieuwVenster(page, voor))) return false;
    wortelSel = `[${MARKER}]`;
  }
  return true;
}

function nthVan(lijst, sleutel, n) {
  let teller = 0;
  for (let i = 0; i < lijst.length; i++) {
    if (sleutelVan(lijst[i]) === sleutel) { if (teller === n) return i; teller++; }
  }
  return -1;
}

const beschrijving = (d) => `${d.tag}${d.actie ? `[data-actie=${d.actie}]` : ''}${d.id ? `#${d.id}` : ''} "${d.tekst || d.aria}"`;

/**
 * Klikt alle knoppen in `wortelSel` een voor een. `etiket`: waar we zijn (voor de melding). `pad`: de openers die tot dit vlak leiden
 * (leeg op het uitgangspunt). `diepte`/`maxDiepte`: hoeveel vensters diep. `basisSel`: het vlak van het uitgangspunt (voor openPad).
 */
export async function veeg(ctx, opties) {
  // Tot drie rondes: een klik kan nieuwe knoppen laten verschijnen (een uitgeklapte groep, een nieuwe kaart); die komen in een volgende ronde aan bod.
  const geklikt = new Set(); // sleutels die al aan de beurt kwamen
  for (let ronde = 0; ronde < 3; ronde++) {
    const lijst = await lijstIn(ctx.page, opties.wortelSel);
    if (ronde === 0) ctx.populaties[opties.etiket] = (ctx.populaties[opties.etiket] ?? 0) + lijst.length;
    const nieuw = ronde === 0 ? lijst : lijst.filter((d) => !geklikt.has(sleutelVan(d)));
    if (nieuw.length === 0) break;
    await veegRonde(ctx, opties, nieuw, geklikt);
  }
}

async function veegRonde(ctx, { wortelSel, etiket, pad = [], diepte = 0, maxDiepte = 1, basisSel = wortelSel, filter = () => true }, begin, geklikt) {
  const { page, verzoeken, consoleFouten } = ctx;
  const gezien = new Map();
  for (const d of begin) {
    const sleutel = sleutelVan(d);
    const n = gezien.get(sleutel) ?? 0;
    gezien.set(sleutel, n + 1);
    geklikt.add(sleutel);
    const naam = `${etiket} > ${beschrijving(d)}`;
    if (!filter(d)) continue;
    const overslaan = OVERSLAAN.find((o) => o.patroon(d));
    if (overslaan) { ctx.overgeslagen.push({ naam, reden: overslaan.reden }); continue; }

    // staat het vlak er nog (een venster dat door een eerdere klik sloot)? Anders eerst terug naar dit vlak.
    if (diepte > 0 && (await page.locator(`[${MARKER}]:visible`).count()) === 0) {
      if (!(await openPad(page, ctx, basisSel, pad))) { ctx.verdwenen++; continue; }
    }
    let lijst = await lijstIn(page, wortelSel);
    let idx = nthVan(lijst, sleutel, n);
    if (idx < 0 && diepte > 0) {
      // In een venster: een eerdere klik wisselde van onderdeel (een ander subtabblad): het venster opnieuw openen en nog eens zoeken.
      if (await openPad(page, ctx, basisSel, pad)) { lijst = await lijstIn(page, wortelSel); idx = nthVan(lijst, sleutel, n); }
    }
    if (idx < 0 && diepte === 0 && ctx.herstart && ctx.herstarts < 8 && !ctx.nietTerug.has(sleutel)) {
      // Een eerdere klik veranderde het scherm blijvend (een andere week, de maandweergave, de bewerkstand van Inventaris): terug naar het begin
      // (de opslag van de pagina zoals bij de start, herladen, het tabblad opnieuw openen) en de knop opnieuw zoeken. Hoorde de knop bij een
      // toestand die een eerdere klik opende (bv. "Bewerken"), dan wordt die klikketen herhaald om er weer te komen.
      ctx.herstarts++;
      await ctx.herstart();
      lijst = await lijstIn(page, wortelSel);
      idx = nthVan(lijst, sleutel, n);
      if (idx < 0) {
        const keten = [];
        for (let k = sleutel; ctx.openers.has(k) && keten.length < 3; k = ctx.openers.get(k).sleutel) keten.unshift(ctx.openers.get(k));
        for (const o of keten) {
          const i = nthVan(lijst, o.sleutel, o.n);
          if (i < 0) break;
          await wortelLocator(page, wortelSel).locator(KLIKBAAR).nth(i).click({ timeout: 4000 }).catch(() => {});
          await rust(page);
          lijst = await lijstIn(page, wortelSel);
        }
        idx = nthVan(lijst, sleutel, n);
      }
      if (idx < 0) ctx.nietTerug.add(sleutel);
    }
    if (idx < 0) { ctx.verdwenen++; if (process.env.KT_LOG) console.log('VERDWENEN', naam, 'n=' + n, 'nu=' + lijst.filter((x) => sleutelVan(x) === sleutel).length); continue; } // de lijst is door een eerdere klik veranderd (bv. een verdwenen kaart)

    if (process.env.KT_LOG) console.log('KLIK', naam);
    const voorAfdruk = await vingerafdruk(page);
    const voorVensters = await openVensters(page);
    const nVerz = verzoeken.alle.length;
    const nOnverwacht = verzoeken.onverwacht.length;
    const nVerboden = verzoeken.verboden.length;
    const nBuiten = verzoeken.buitenHost.length;
    const nFouten = consoleFouten.length;
    const nDialogen = ctx.dialogen;
    const nPopups = ctx.popups;

    let klikFout = null;
    // Twee pogingen: bij de eerste die niet lukt (een venster dat nog sluit, een toast die de knop even bedekt) wordt eerst hersteld.
    for (let poging = 0; poging < 2; poging++) {
      try { await wortelLocator(page, wortelSel).locator(KLIKBAAR).nth(idx).click({ timeout: poging === 0 ? 3000 : 4000 }); klikFout = null; break; } catch (e) {
        klikFout = String(e.message).split('\n').filter((r) => /Timeout|intercepts|not visible|not stable|detached|outside/.test(r)).slice(0, 4).map((r) => r.trim()).join(' | ');
        if (poging === 0) {
          await herstelBasis(page, ctx);
          if (diepte > 0) await openPad(page, ctx, basisSel, pad);
          lijst = await lijstIn(page, wortelSel);
          idx = nthVan(lijst, sleutel, n);
          if (idx < 0) break;
        }
      }
    }
    ctx.geklikt++;
    await rust(page);

    if (klikFout && process.env.KT_FOTO) { await page.screenshot({ path: process.env.KT_FOTO + '/fout-' + ctx.geklikt + '.png' }); console.log('VENSTERS', JSON.stringify(await openVensters(page)), await page.evaluate(() => [...document.querySelectorAll('.overlay.open')].map((e) => e.outerHTML.slice(0, 600)))); }
    if (klikFout) { ctx.bevindingen.push({ soort: 'niet aanklikbaar', naam, detail: klikFout }); await herstelBasis(page, ctx); if (diepte > 0) await openPad(page, ctx, basisSel, pad); continue; }
    const nieuweFouten = consoleFouten.slice(nFouten);
    if (nieuweFouten.length) ctx.bevindingen.push({ soort: 'consolefout', naam, detail: nieuweFouten.join(' || ') });
    const onverwacht = [...verzoeken.onverwacht.slice(nOnverwacht), ...verzoeken.verboden.slice(nVerboden), ...verzoeken.buitenHost.slice(nBuiten)];
    if (onverwacht.length) ctx.bevindingen.push({ soort: 'verzoek buiten de stubs', naam, detail: onverwacht.join(', ') });

    const naAfdruk = await vingerafdruk(page);
    const naVensters = await openVensters(page);
    const effect = naAfdruk !== voorAfdruk || verzoeken.alle.length > nVerz || naVensters.join() !== voorVensters.join()
      || ctx.dialogen > nDialogen || ctx.popups > nPopups;
    if (!effect) ctx.geenGevolg.push({ naam, detail: 'geen verandering in de pagina, geen verzoek en geen venster' });

    // Verschenen er door deze klik knoppen die er nog niet waren (Bewerken, een uitgeklapte groep)? Dan is deze klik de opener van die knoppen.
    if (diepte === 0 && naVensters.length <= voorVensters.length) {
      for (const x of await lijstIn(page, wortelSel)) { const k = sleutelVan(x); if (!geklikt.has(k) && !ctx.openers.has(k)) ctx.openers.set(k, { sleutel, n }); }
    }
    // Een venster dat net openging: één niveau dieper doorlopen (elk soort venster één keer per sweep).
    const nieuw = naVensters.length > voorVensters.length ? await markeerNieuwVenster(page, voorVensters) : null;
    if (nieuw && diepte < maxDiepte) {
      const handtekening = `${etiket.split(' > ')[0]}|${nieuw}|${(await lijstIn(page, `[${MARKER}]`)).map(sleutelVan).join(';')}`;
      if (!ctx.gezien.has(handtekening)) {
        ctx.gezien.add(handtekening);
        ctx.vensters.push(`${naam} -> ${nieuw}`);
        await veeg(ctx, { wortelSel: `[${MARKER}]`, etiket: `${naam} [venster ${nieuw}]`, pad: [...pad, { sleutel, n }], diepte: diepte + 1, maxDiepte, basisSel });
      }
    }
    // Op het uitgangspunt altijd herstellen; in een venster enkel opnieuw openen als er een tweede venster over ging
    // (de volgende iteratie opent het venster zelf opnieuw als de klik het sloot).
    if (diepte === 0) await herstelBasis(page, ctx);
    else if (nieuw) await openPad(page, ctx, basisSel, pad);
  }
}

/** Een bevinding of een groep bevindingen als leesbare tekst. */
export function samenvatting(ctx) {
  return {
    geklikt: ctx.geklikt,
    bevindingen: ctx.bevindingen.map((b) => `${b.soort}: ${b.naam} — ${b.detail}`),
    geenGevolg: ctx.geenGevolg.map((b) => b.naam),
    overgeslagen: [...new Set(ctx.overgeslagen.map((o) => `${o.naam} (${o.reden.split(';')[0]})`))],
    vensters: ctx.vensters,
    verdwenen: ctx.verdwenen,
    herstarts: ctx.herstarts,
  };
}

export { expect };
