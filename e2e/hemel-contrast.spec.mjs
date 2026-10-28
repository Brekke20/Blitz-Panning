import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startApp, kiesHoofdtab, opslagStub } from './helpers.mjs';
import { startSalesApp, maakSalesBackend, authIkVoor } from './sales-hulp.mjs';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';
import { controleerKaarten, controleerVlakken, controleerLosseTekst, controleerGlasTokens, wachtOpNavigatie, wachtOpFrames, meetReeksen, leesPakket, themaStub } from './contrast-meting.mjs';

// Open dag-stijl, taak 9: elke tekst op glas haalt 4,5:1 over wat er ECHT achter ligt, voor de vier tijdstippen van de hemel (ochtend, middag,
// avond, nacht) × donker en licht × pc (1366x768) en gsm (375x812, blitz_weergave = gsm). Zelfde drempel en zelfde meetwijze als de
// thema-proeven in e2e/versiering.spec.mjs (helpers in e2e/contrast-meting.mjs):
//  - de kaarten (wachtrij en kalender): foto van de achtergrond zonder kaarten, vervaging en saturate zoals het glas, kaartkleur erover,
//    het gemiddelde en de helderste en donkerste vlek, ook met de muis erboven;
//  - de vaste vlakken (zijkolom of dok met de persoonkiezer, de kop en de paginakop, het ticketdetail-venster, de dashboardkaarten en de
//    afgewerkte sales-kaart): de echte pixels, tekst doorzichtig gemaakt en gefotografeerd; elk tekstelement tegen elke pixel van zijn vak.
// Faalt een tekst: eerst de tekstkleur, dan de dekking van het glas (base.css), de hemelkleuren (hemel.css) pas als laatste
// (beslissing 6 van de spec); statuskleuren (--red, --orange, ...) worden nooit overschreven.
// De hemel staat direct op <html data-hemel> (de klok is hier niet nodig); een minuutcontrole van de app kan hem terugzetten, dus elke meting
// zet hem eerst en controleert achteraf dat hij ongewijzigd bleef.
const HEMELS = ['ochtend', 'middag', 'avond', 'nacht'];
const MODI = ['dark', 'light'];
const TOESTELLEN = [
  { naam: 'pc', viewport: { width: 1366, height: 768 }, gsm: false },
  { naam: 'gsm', viewport: { width: 375, height: 812 }, gsm: true },
];
const MAP = path.dirname(url.fileURLToPath(import.meta.url));

// Het toestel en de modus vooraf bewaren (de app leest ze bij de start); sandbox-iframes hebben geen localStorage.
const zetToestel = (page, toestel, modus) => page.addInitScript(([gsm, m]) => {
  if (window !== window.top) return;
  if (gsm) localStorage.setItem('blitz_weergave', 'gsm');
  localStorage.setItem('blitz_theme', m);
}, [toestel.gsm, modus]);

const nieuweVerzamelaar = () => ({ waarde: Infinity, waar: '', perVenster: {} });

// Zet hemel en modus, voert de meting uit en eist dat de hemel intussen niet door de minuutcontrole is teruggezet.
async function metHemel(page, hemel, modus, fn) {
  await page.evaluate(([h, m]) => { document.documentElement.setAttribute('data-hemel', h); document.documentElement.setAttribute('data-theme', m); }, [hemel, modus]);
  await expect(page.locator('html')).toHaveAttribute('data-hemel', hemel);
  await wachtOpFrames(page, 2);
  await fn();
  await expect(page.locator('html'), 'de hemel bleef staan tijdens de meting').toHaveAttribute('data-hemel', hemel);
}

// Geen overgangen of animaties tijdens het meten (een kaart kleurt anders 0,15 s lang van donker naar licht, een venster schuift in).
const stil = (page) => page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });

const rapporteer = (naam, verzamel) => {
  const tekst = `${verzamel.waarde.toFixed(2)}:1 (${verzamel.waar}); per hemel ${Object.entries(verzamel.perVenster).map(([v, c]) => `${v} ${c.toFixed(2)}`).join(', ')}`;
  test.info().annotations.push({ type: `slechtste contrast ${naam}`, description: tekst });
  console.log(`slechtste contrast ${naam}: ${tekst}`);
};

test.describe('hemel en glas: contrast over de echte achtergrond', () => {
  for (const toestel of TOESTELLEN) {
    for (const modus of MODI) {
      for (const hemel of HEMELS) {
        test(`@contrast hemel ${hemel} ${modus} ${toestel.naam}: kaarten, zijkolom of dok, kop en paginakop, ticketdetail houden 4,5:1`, async ({ page }) => {
          test.setTimeout(240000);
          await zetToestel(page, toestel, modus);
          await startApp(page, { viewport: toestel.viewport });
          await stil(page);
          await expect(page.locator('html')).toHaveAttribute('data-apparaat', toestel.gsm ? 'gsm' : 'computer');
          await wachtOpNavigatie(page);
          await expect(page.locator('html')).toHaveAttribute('data-nav', toestel.gsm ? 'dok' : 'kolom');
          const verzamel = nieuweVerzamelaar();
          const label = (wat) => `${hemel} ${modus} ${toestel.naam} ${wat}`;

          // 1. kaarten van de wachtrij en de kalender (de glaswaarden komen uit VERWACHT_GLAS: base.css hoort ze te geven)
          await metHemel(page, hemel, modus, async () => {
            await page.locator('#tab-tickets').click();
            await page.mouse.move(0, 0);
            await expect(page.locator('#view-tickets .ticket').first()).toBeVisible();
            await controleerGlasTokens(page, label('wachtrij'));
            await controleerKaarten(page, '#view-tickets .ticket', label('tickets'), verzamel);
            // dezelfde kaarten nog eens in echte pixels, nu ook de chips met een eigen vlak (status, prioriteit, technieker)
            await controleerVlakken(page, ['#view-tickets .ticket'], label('ticketkaarten'), verzamel, { minimum: 8 });
            // 2. de vaste vlakken bij de wachtrij: zijkolom (pc) of dok (gsm), de kop en, op pc, de paginakop
            const kolomOfDok = toestel.gsm ? ['.topbar-sticky > nav'] : ['.topbar-sticky > nav', '#person-sel'];
            expect(await controleerVlakken(page, kolomOfDok, label(toestel.gsm ? 'dok' : 'zijkolom'), verzamel, { minimum: 4 })).toBeGreaterThanOrEqual(4);
            await controleerVlakken(page, ['.topbar-sticky header'], label('kop'), verzamel, { minimum: 1 });
            if (!toestel.gsm) {
              await expect(page.locator('#paginasub')).toBeVisible();
              expect(await controleerVlakken(page, ['.paginakop'], label('paginakop (titel en samenvatting)'), verzamel, { minimum: 2 })).toBeGreaterThanOrEqual(2);
            }
          });
          await page.locator('#tab-kalender').click();
          await expect(page.locator('#view-kalender .cal-ticket').first()).toBeVisible();
          await metHemel(page, hemel, modus, async () => {
            await page.mouse.move(0, 0);
            await controleerKaarten(page, '#view-kalender .cal-ticket', label('kalender'), verzamel);
            await controleerVlakken(page, ['#view-kalender .cal-ticket'], label('kalenderkaarten'), verzamel, { minimum: 4 });
            await controleerVlakken(page, ['.topbar-sticky > nav'], label('navigatie bij de kalender'), verzamel, { minimum: 3 });
          });

          // 3. het ticketdetail-venster (.modal op --glas-venster): titel en tekst
          await page.locator('#tab-tickets').click();
          await page.locator('#view-tickets .ticket').first().click();
          await expect(page.locator('#det-overlay')).toHaveClass(/open/);
          await expect(page.locator('#d-title')).not.toBeEmpty();
          await metHemel(page, hemel, modus, async () => {
            await page.mouse.move(0, 0);
            expect(await controleerVlakken(page, ['#det-overlay .modal'], label('ticketdetail'), verzamel, { minimum: 6 })).toBeGreaterThanOrEqual(6);
          });
          rapporteer(`${toestel.naam} ${modus} ${hemel}`, verzamel);
        });
      }
    }
  }
});

// ── Dashboard (Beheer > Performance): de tegels en kaarten zijn glas op --glas-venster; de grafiekkleuren zijn afgestemd op een bijna
// effen ondergrond. Planner = techniekersdeel van het dashboard (de stub in e2e/beheer-rollen.spec.mjs, zelfde fixture). ──
const FIXTURE = JSON.parse(fs.readFileSync(path.join(MAP, 'fixtures', 'dashboard.json'), 'utf8'));
const PLANNER = Object.freeze({ id: 'u-test', email: 'p@test.be', naam: 'Test Planner', rol: 'planner', actief: true });
const planner = () => { const d = structuredClone(FIXTURE); delete d.sales; delete d.dekking.sales; d.deel = 'techniekers'; return { status: 200, json: d }; };

async function meetScrollend(page, wortelSels, label, verzamel) {
  const hoogte = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
  const stap = Math.max(200, Math.floor((await page.evaluate(() => innerHeight)) * 0.7));
  let n = 0;
  for (let y = 0; ; y += stap) {
    await page.evaluate((to) => window.scrollTo(0, to), Math.min(y, hoogte));
    await wachtOpFrames(page, 2);
    n += await controleerVlakken(page, wortelSels, `${label} y${Math.min(y, hoogte)}`, verzamel, { minimum: 0 });
    if (y >= hoogte) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return n;
}

test.describe('dashboard op glas', () => {
  for (const toestel of TOESTELLEN) {
    for (const modus of MODI) {
      test(`@contrast dashboard ${modus} ${toestel.naam}: tegels, kaarten en grafiektekst houden 4,5:1 over elk tijdstip van de hemel`, async ({ page }) => {
        test.setTimeout(300000);
        const backend = maakSalesBackend({ gebruiker: PLANNER, verkopers: [] });
        await zetToestel(page, toestel, modus);
        await startApp(page, {
          viewport: toestel.viewport, loginRol: 'planner',
          overschrijf: { 'auth-ik': authIkVoor(PLANNER), ...backend.stubs, dashboard: planner, 'dashboard-instellingen': opslagStub({ versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }, 'grenzen') },
        });
        await stil(page);
        await wachtOpNavigatie(page);
        await kiesHoofdtab(page, 'Beheer');
        await page.getByRole('tab', { name: 'Performance', exact: true }).click();
        await expect(page.locator('.dash .tegel').first()).toBeVisible();
        await expect(page.locator('.dash-kaart').first()).toBeVisible();
        await page.mouse.move(0, 0);
        const verzamel = nieuweVerzamelaar();
        let aantal = 0;
        for (const hemel of HEMELS) {
          await metHemel(page, hemel, modus, async () => {
            await controleerGlasTokens(page, `${hemel} ${modus} ${toestel.naam} dashboard`);
            aantal += await meetScrollend(page, ['.dash .tegel', '.dash-kaart', '.dash-blok-kop', '.dash-noot'], `${hemel} ${modus} ${toestel.naam} dashboard`, verzamel);
          });
        }
        expect(aantal, 'dashboardtekst gemeten').toBeGreaterThan(40);
        // De reekskleuren van de grafieken (legenda-blokjes) tegen de glazen kaart: een meting voor het rapport, geen drempel (de
        // statuskleuren en reekskleuren worden nooit aangepast; zie de spec). Per tijdstip de zwakste reeks.
        const reeksen = [];
        await page.evaluate(() => window.scrollTo(0, 0));
        for (const hemel of HEMELS) {
          await metHemel(page, hemel, modus, async () => {
            for (let y = 0; y < 6000; y += 500) {
              await page.evaluate((to) => window.scrollTo(0, to), y);
              await wachtOpFrames(page, 2);
              reeksen.push(...(await meetReeksen(page)).map((r) => ({ ...r, hemel })));
            }
          });
        }
        if (reeksen.length) {
          const zwakste = Object.values(Object.fromEntries(reeksen.map((r) => [r.naam, reeksen.filter((x) => x.naam === r.naam).sort((a, b) => a.contrast - b.contrast)[0]])));
          const tekst = zwakste.sort((a, b) => a.contrast - b.contrast).map((r) => `${r.naam || 'overige'} ${r.contrast.toFixed(2)}`).join(', ');
          test.info().annotations.push({ type: `reekskleuren tegen de kaart ${toestel.naam} ${modus}`, description: tekst });
          console.log(`reekskleuren tegen de kaart ${toestel.naam} ${modus} (contrast, niet-tekst): ${tekst}`);
        }
        rapporteer(`dashboard ${toestel.naam} ${modus}`, verzamel);
      });
    }
  }
});

// ── Sales: de afgewerkte bezoekkaart in het gsm-dagoverzicht (.sales-afgewerkt-kaart: gedempt glas, opacity .85 en een eigen tekstkleur) ──
const DAG = '2026-10-05';
const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const afgewerkt = (id, naam, op) => lead(id, naam, { status: 'afgewerkt', resultaat: { soort: 'offerte', op }, bezoeken: [{ datum: DAG, resultaat: 'offerte', op }] });
const bevestigd = (id, naam, start) => lead(id, naam, { status: 'bevestigd', planning: { datum: DAG, start, vast: true }, gsm: '32470112233', straat: 'Teststraat', huisnr: '5' });

test.describe('sales-kaart afgewerkt op glas', () => {
  for (const modus of MODI) {
    test(`@contrast sales afgewerkt ${modus} gsm: de gedempte kaart (opacity .85, eigen tekstkleur) houdt 4,5:1 over elk tijdstip`, async ({ page }) => {
      test.setTimeout(240000);
      const toestel = TOESTELLEN[1];
      await zetToestel(page, toestel, modus);
      await startSalesApp(page, {
        viewport: toestel.viewport,
        leads: [afgewerkt('a1', 'Klaar', '2026-10-05T08:15:00+02:00'), bevestigd('b1', 'Vroeg', '07:00'), bevestigd('b2', 'Later', '14:00')],
        blokken: [],
      });
      await stil(page);
      await wachtOpNavigatie(page);
      await page.getByRole('tab', { name: 'Kalender', exact: true }).click();
      const klaar = page.locator(`#view-sales-kalender .day-col[data-date="${DAG}"] .sales-afgewerkt-kaart`);
      await expect(klaar).toBeVisible();
      await expect(klaar).toHaveCSS('opacity', '0.85');
      await klaar.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const verzamel = nieuweVerzamelaar();
      for (const hemel of HEMELS) {
        await metHemel(page, hemel, modus, async () => {
          await controleerGlasTokens(page, `${hemel} ${modus} sales`);
          expect(await controleerVlakken(page, ['.sales-afgewerkt-kaart'], `${hemel} ${modus} gsm sales-afgewerkt`, verzamel, { minimum: 3 })).toBeGreaterThanOrEqual(3);
          // een gewone bezoekkaart ernaast, ter vergelijking (zelfde glas, zonder dempen)
          await controleerVlakken(page, ['.sales-kal-kaart:not(.sales-afgewerkt-kaart)'], `${hemel} ${modus} gsm sales-bezoekkaart`, verzamel, { minimum: 2 });
        });
      }
      rapporteer(`sales afgewerkt ${modus}`, verzamel);
    });
  }
});

// ── Taak 9b: losse tekst. Tekst die zonder eigen glasvlak (of op een dun glasvlak zonder eigen tint) rechtstreeks op de hemel staat:
// kalender-uurlabels en dagkoppen, subtabs van Beheer, lege staten, samenvattingen, tellers, sectiekoppen. De meting neemt ALLE tekst van het
// beeld (`controleerLosseTekst`: body, zonder de routekaart van derden en uitgeschakelde bediening) in de echte pixels, per scherm met een
// minimum aan teksten zodat een leeg beeld niet stil slaagt. Op de scène van een thema enkel de tekst zonder enig eigen vlak (`alleenLos`):
// de accentkleuren van het pakket op knoppen en chips horen bij het pakket zelf. Faalt een tekst: eerst de tekstkleur
// (--tekst-op-hemel, --tekst2-op-hemel in base.css), dan een zachte schaduw of een pil (app.css), de hemelkleuren pas als laatste;
// statuskleuren nooit. ──

// Eén scherm: hoe je het opent en hoeveel teksten het minstens moet geven.
const SCHERMEN = [
  { naam: 'wachtrij', open: async (page) => { await kiesHoofdtab(page, /^Wachtrij/); await expect(page.locator('#view-tickets .ticket').first()).toBeVisible(); }, minimum: 20 },
  { naam: 'wachtrij leeg', open: async (page) => { await kiesHoofdtab(page, /^Wachtrij/); await page.locator('#wq-zoek').fill('zzzzgeenresultaat'); await page.locator('#wq-zoek').blur(); await expect(page.locator('#view-tickets .empty')).toBeVisible(); }, minimum: 10, eind: async (page) => { await page.locator('#wq-zoek').fill(''); } },
  { naam: 'kalender', open: async (page) => { await kiesHoofdtab(page, 'Kalender'); await expect(page.locator('#view-kalender .cal-ticket').first()).toBeVisible(); }, minimum: 30 },
  { naam: 'route', pcOnly: true, open: async (page) => { await kiesHoofdtab(page, 'Route'); await expect(page.locator('#view-planning')).toBeVisible(); }, minimum: 20 },
  { naam: 'ingepland', open: async (page) => { await kiesHoofdtab(page, /^Ingepland/); await expect(page.locator('#view-gepland')).toBeVisible(); }, minimum: 12 },
  { naam: 'inventaris', open: async (page) => { await kiesHoofdtab(page, /^Inventaris/); await expect(page.locator('#view-inventaris')).toBeVisible(); }, minimum: 8 },
  { naam: 'rapporten', open: async (page) => { await kiesHoofdtab(page, 'Rapporten'); await expect(page.locator('#view-rapporten')).toBeVisible(); }, minimum: 10 },
];

async function meetScherm(page, scherm, toestel, modus, verzamel, tellers) {
  await scherm.open(page);
  await page.mouse.move(0, 0);
  for (const hemel of HEMELS) {
    await metHemel(page, hemel, modus, async () => {
      const { aantal } = await controleerLosseTekst(page, `${hemel} ${modus} ${toestel.naam} ${scherm.naam}`, verzamel, { minimum: scherm.minimum });
      tellers.aantal += aantal; tellers.perScherm[scherm.naam] = aantal;
    });
  }
  await scherm.eind?.(page);
}

test.describe('losse tekst op de hemel', () => {
  for (const toestel of TOESTELLEN) {
    for (const modus of MODI) {
      test(`@contrast los ${modus} ${toestel.naam}: tekst zonder glasvlak (wachtrij, kalender, route, ingepland, inventaris, rapporten) houdt 4,5:1 over elk tijdstip`, async ({ page }) => {
        test.setTimeout(600000);
        await zetToestel(page, toestel, modus);
        await startApp(page, { viewport: toestel.viewport });
        await stil(page);
        await wachtOpNavigatie(page);
        const verzamel = nieuweVerzamelaar();
        const tellers = { aantal: 0, perScherm: {} };
        for (const scherm of SCHERMEN) {
          if (scherm.pcOnly && toestel.gsm) continue;
          await meetScherm(page, scherm, toestel, modus, verzamel, tellers);
        }
        console.log(`tekst ${toestel.naam} ${modus}: ${tellers.aantal} teksten; ${JSON.stringify(tellers.perScherm)}`);
        expect(tellers.aantal, 'teksten gemeten').toBeGreaterThan(400);
        rapporteer(`los ${toestel.naam} ${modus}`, verzamel);
      });
    }
  }
});

// Beheer (alle subtabs van de beheerder, ook Performance met het dashboard) en Sales (Leads, Kalender, Route, Afgewerkt): per subtab of tab
// dezelfde meting. De Beheer-subtabs zelf (.beheer-tab) staan los op de hemel.
const BEHEER = (() => { const d = structuredClone(FIXTURE); return () => ({ status: 200, json: structuredClone(d) }); })();

test.describe('losse tekst op de hemel: Beheer en Sales', () => {
  for (const toestel of TOESTELLEN) {
    for (const modus of MODI) {
      test(`@contrast los beheer ${modus} ${toestel.naam}: subtabs en panelen van Beheer houden 4,5:1 over elk tijdstip`, async ({ page }) => {
        test.setTimeout(600000);
        await zetToestel(page, toestel, modus);
        await startApp(page, { viewport: toestel.viewport, overschrijf: { dashboard: BEHEER, 'dashboard-instellingen': opslagStub({ versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }, 'grenzen') } });
        await stil(page);
        await wachtOpNavigatie(page);
        await kiesHoofdtab(page, 'Beheer');
        const subtabs = page.locator('.beheer-tabs [role="tab"]');
        await expect(subtabs.first()).toBeVisible();
        const namen = await subtabs.allTextContents();
        expect(namen.length, 'subtabs van Beheer').toBeGreaterThanOrEqual(5);
        const verzamel = nieuweVerzamelaar();
        const tellers = { aantal: 0, perScherm: {} };
        for (const naam of namen) {
          await page.getByRole('tab', { name: naam, exact: true }).click();
          await expect(page.locator('.beheer-paneel:not([aria-busy])')).toBeVisible();
          await wachtOpFrames(page, 3);
          await page.mouse.move(0, 0);
          const scherm = { naam: `beheer ${naam}`, minimum: 8 };
          for (const hemel of HEMELS) {
            await metHemel(page, hemel, modus, async () => {
              const { aantal } = await controleerLosseTekst(page, `${hemel} ${modus} ${toestel.naam} ${scherm.naam}`, verzamel, { minimum: scherm.minimum });
              tellers.aantal += aantal; tellers.perScherm[scherm.naam] = aantal;
            });
          }
        }
        console.log(`tekst beheer ${toestel.naam} ${modus}: ${tellers.aantal} teksten; ${JSON.stringify(tellers.perScherm)}`);
        expect(tellers.aantal, 'teksten gemeten').toBeGreaterThan(400);
        rapporteer(`los beheer ${toestel.naam} ${modus}`, verzamel);
      });

      test(`@contrast los sales ${modus} ${toestel.naam}: Leads, Kalender, Route en Afgewerkt houden 4,5:1 over elk tijdstip`, async ({ page }) => {
        test.setTimeout(600000);
        await zetToestel(page, toestel, modus);
        await startSalesApp(page, {
          viewport: toestel.viewport,
          leads: [lead('l1', 'Eerste', {}), lead('l2', 'Tweede', {}), afgewerkt('a1', 'Klaar', '2026-10-05T08:15:00+02:00'), bevestigd('b1', 'Vroeg', '07:00')],
          blokken: [],
        });
        await stil(page);
        await wachtOpNavigatie(page);
        const verzamel = nieuweVerzamelaar();
        const tellers = { aantal: 0, perScherm: {} };
        for (const naam of ['Leads', 'Kalender', 'Route', 'Afgewerkt']) {
          // niet elke tab staat op elk toestel in het dok (Route is er niet op een gsm): enkel wat een gebruiker er ziet
          if (await page.getByRole('tab', { name: naam, exact: true }).count() === 0 && !(await page.locator('.dok-meer').isVisible())) continue;
          await kiesHoofdtab(page, naam);
          await wachtOpFrames(page, 3);
          await page.mouse.move(0, 0);
          for (const hemel of HEMELS) {
            await metHemel(page, hemel, modus, async () => {
              const { aantal } = await controleerLosseTekst(page, `${hemel} ${modus} ${toestel.naam} sales ${naam}`, verzamel, { minimum: 1 });
              tellers.aantal += aantal; tellers.perScherm[naam] = aantal;
            });
          }
        }
        console.log(`tekst sales ${toestel.naam} ${modus}: ${tellers.aantal} teksten; ${JSON.stringify(tellers.perScherm)}`);
        expect(tellers.aantal, 'teksten gemeten').toBeGreaterThan(100);
        rapporteer(`los sales ${toestel.naam} ${modus}`, verzamel);
      });
    }
  }
});

// De scène van een thema (Halloween: heldere maan, Sinterklaas: de slechtste uit taak 9) ligt achter dezelfde losse tekst; de hemel is dan
// vervangen door de scène (data-event-achtergrond="ja") en het glas is dichter (VERWACHT_GLAS.thema).
const THEMAS = ['halloween', 'sinterklaas'];
test.describe('losse tekst op de scène van een thema', () => {
  for (const id of THEMAS) {
    for (const toestel of TOESTELLEN) {
      test(`@contrast los thema ${id} ${toestel.naam}: tekst zonder glasvlak houdt 4,5:1 over de scène, in donker en licht`, async ({ page }) => {
        test.setTimeout(600000);
        await zetToestel(page, toestel, 'dark');
        await startApp(page, { viewport: toestel.viewport, query: '?test&versiering=aan', overschrijf: { themas: themaStub(leesPakket(id)) } });
        await expect(page.locator('html')).toHaveAttribute('data-event', id);
        await expect(page.locator('html')).toHaveAttribute('data-event-achtergrond', 'ja');
        await stil(page);
        await wachtOpNavigatie(page);
        const verzamel = nieuweVerzamelaar();
        const tellers = { aantal: 0, perScherm: {} };
        for (const scherm of SCHERMEN) {
          if (scherm.pcOnly && toestel.gsm) continue;
          await scherm.open(page);
          await page.mouse.move(0, 0);
          for (const modus of MODI) {
            await page.evaluate((m) => document.documentElement.setAttribute('data-theme', m), modus);
            await wachtOpFrames(page, 3);
            const { aantal } = await controleerLosseTekst(page, `${id} ${modus} ${toestel.naam} ${scherm.naam}`, verzamel, { minimum: 1, alleenLos: true });
            tellers.aantal += aantal; tellers.perScherm[scherm.naam] = aantal;
          }
          await scherm.eind?.(page);
        }
        console.log(`losse tekst thema ${id} ${toestel.naam}: ${tellers.aantal} losse teksten; ${JSON.stringify(tellers.perScherm)}`);
        expect(tellers.aantal, 'losse teksten gemeten').toBeGreaterThan(20);
        rapporteer(`los thema ${id} ${toestel.naam}`, verzamel);
      });
    }
  }
});
