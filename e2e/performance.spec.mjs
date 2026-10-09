// Beheer → Performance (dashboard T21): zes tegels, vijf blokken, ringen met statuskleur, filters, sales-donut, kleurgrenzen,
// foutpaden (403, 503, grenzen niet geladen of niet bewaard) en de dekking-voetnoten.
// Alles draait tegen stubs op basis van e2e/fixtures/dashboard.json; er verlaat niets de pagina. Alleen de beheerder heeft
// de tab Beheer (en dus Performance): voor de andere rollen controleren we dat die ontbreekt; 403 en 503 worden bij de beheerder gestubd.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startApp, opslagStub } from './helpers.mjs';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(MAP, 'fixtures', 'dashboard.json'), 'utf8'));
const json = (status, obj) => ({ status, json: obj });

// Een verse kopie van de fixture, eventueel aangepast.
const dashboardData = (wijzig) => { const d = structuredClone(FIXTURE); wijzig?.(d); return d; };
const dashboardStub = (wijzig) => () => json(200, dashboardData(wijzig));
const grenzenStub = (begin = { versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }) => opslagStub(begin, 'grenzen');
const OPSLAG_STORING = { error: 'De opslag is tijdelijk niet bereikbaar.', code: 'opslag-storing' };

// Opent Beheer → Performance. Standaard start de beheerpagina meteen op dat tabblad (sessionStorage, zoals na een eerdere keuze);
// met `viaTab` gaat de test echt via de tabbalk (dan is Gebruikers het eerste tabblad en heeft die een stub nodig).
async function openPerformance(page, { dashboard = dashboardStub(), instellingen = grenzenStub(), viaTab = false, app = {} } = {}) {
  if (!viaTab) await page.addInitScript(() => { if (window === window.top) sessionStorage.setItem('blitz_beheer_tab', 'performance'); });
  await startApp(page, {
    ...app,
    overschrijf: { dashboard, 'dashboard-instellingen': instellingen, ...(viaTab ? { gebruikers: () => json(200, { gebruikers: [] }) } : {}), ...app.overschrijf },
  });
  await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
  if (viaTab) await page.getByRole('tab', { name: 'Performance', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Performance', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dash')).toBeVisible();
}

// Een bedoelde 4xx/5xx meldt de browser als HTTP-fout en als consolefout; die halen we na de controle weg (de vangnetten
// laten elke HTTP >= 400 falen). Wacht eerst tot de melding er is, zodat er niets te laat binnenkomt.
async function verwachtFout(consoleFouten, pad, status, minimaal = 1) {
  const isDeze = (f) => f.includes(pad) && f.includes(String(status));
  await expect.poll(() => consoleFouten.filter(isDeze).length).toBeGreaterThanOrEqual(minimaal);
  for (let i = consoleFouten.length - 1; i >= 0; i--) if (isDeze(consoleFouten[i])) consoleFouten.splice(i, 1);
}

const tegel = (page, sleutel) => page.locator(`.tegels > .tegel--${sleutel}`);
const kaartMet = (page, kop) => page.locator('.dash-kaart', { has: page.locator('.dash-kaart-kop', { hasText: kop }) });
const grensVeld = (page, ring, veld) => page.getByLabel(`${ring}: ${veld}`, { exact: true });
const OPTIJD_RING = '% op tijd (alle bezoeken)';
const openInstellingen = async (page) => { await page.locator('.dash-instellingen > summary').click(); await expect(page.locator('.dash-instellingen')).toHaveAttribute('open', ''); };

test.describe('Performance: overzicht', () => {
  test('beheerder opent Beheer → Performance en ziet zes tegels en de vijf blokken in vaste volgorde', async ({ page, verzoeken }) => {
    await openPerformance(page, { viaTab: true });
    await expect(page.locator('#beheer-tab-performance')).toHaveText('Performance');
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
    expect(await page.locator('.tegels > .tegel .tegel-kop').allTextContents()).toEqual([
      'Interventies', 'Gemiddelde duur', '% op tijd (alle bezoeken)', 'First-time-fix', 'Herhaalbezoeken', 'Waarde onderdelen',
    ]);
    await expect(page.locator('.dash-blok')).toHaveCount(5);
    expect(await page.locator('.dash-blok-kop').allTextContents()).toEqual(['Tijd & stiptheid', 'Kwaliteit', 'Onderdelen', 'Klant & planning', 'Sales']);
    await expect(tegel(page, 'interventies').locator('.tegel-waarde')).toHaveText('10');
    expect(verzoeken.van('/api/dashboard', 'GET')).toHaveLength(1);
    // Dekking-voetnoot uit de fixture.
    await expect(page.locator('.dash-voetnoten')).toContainText('Op basis van 10 van 12 rapporten, 2 zonder gepland tijdslot');
    // Bedieningsgegevens van de gebruiker (HTML in namen) komen niet als markup op de pagina.
    await expect(page.locator('.dash img[src="x"]')).toHaveCount(0);
  });

  test('de ring "Op tijd" met 92 % is groen en met 70 % rood; het midden toont het percentage en het bijschrift de verdeling', async ({ page }) => {
    await openPerformance(page, {
      dashboard: dashboardStub((d) => { d.kern.huidig.opTijd = { pct: 92, n: 12, teVroeg: 1, opTijd: 11, teLaat: 0 }; }),
    });
    const ring = tegel(page, 'opTijd');
    await expect(ring.locator('figure.ring')).toHaveClass(/ring--goed/);
    await expect(ring.locator('svg.ring-svg')).toHaveClass(/ring--goed/);
    await expect(ring.locator('.ring-pct')).toHaveText('92%');
    await expect(ring.locator('.ring-sub')).toHaveText('1 te vroeg · 11 op tijd · 0 te laat');
    await expect(ring.locator('.ring-status')).toContainText('Op doel'); // naast de kleur ook woord en icoon
  });

  test('met 70 % op tijd (de fixture) is dezelfde ring rood', async ({ page }) => {
    await openPerformance(page);
    const ring = tegel(page, 'opTijd');
    await expect(ring.locator('figure.ring')).toHaveClass(/ring--slecht/);
    await expect(ring.locator('svg.ring-svg')).toHaveClass(/ring--slecht/);
    await expect(ring.locator('.ring-pct')).toHaveText('70%');
    await expect(ring.locator('.ring-sub')).toHaveText('2 te vroeg · 7 op tijd · 1 te laat');
    await expect(ring.locator('.ring-status')).toContainText('Onder doel');
  });

  test('de sales-donut toont vier legenderijen en het totaal in het midden', async ({ page }) => {
    await openPerformance(page);
    const donut = page.locator('.dash-blok--sales .donut');
    await expect(donut.locator('svg.donut-svg .donut-groot')).toHaveText('4');
    await expect(donut.locator('svg.donut-svg .donut-klein')).toHaveText('bezoeken');
    await expect(donut.locator('.legende li')).toHaveCount(4);
    expect(await donut.locator('.legende .legende-label').allTextContents()).toEqual(['Offerte', 'Verkocht', 'Geen interesse', 'Opnieuw bezoeken']);
    await expect(donut.locator('.legende .legende-aantal').first()).toContainText('1');
  });

  test('de ring "Installateur al langs geweest" toont het aandeel Ja van Ja + Nee; onbekende antwoorden tellen niet mee', async ({ page }) => {
    await openPerformance(page);
    const kaart = kaartMet(page, 'Installateur al langs geweest');
    await expect(kaart.locator('.ring-pct')).toHaveText('70%'); // 7 Ja van (7 Ja + 3 Nee); met de 2 onbekende erbij zou het 58 % zijn
    await expect(kaart.locator('.ring-n')).toHaveText('7 van 10');
    await expect(kaart.locator('.dash-uitleg')).toContainText('2 rapporten zonder antwoord (onbekend) tellen niet mee');
  });

  test('het scherm toont geen consolefouten bij het laden en het doorlopen van de perioden', async ({ page, consoleFouten }) => {
    await openPerformance(page);
    for (const preset of ['Vorige maand', 'Dit kwartaal', 'Dit jaar', 'Deze maand']) {
      await page.getByRole('button', { name: preset, exact: true }).click();
      await expect(page.getByRole('button', { name: preset, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
    expect(consoleFouten).toEqual([]); // het vangnet controleert hetzelfde nog eens na de test
  });
});

test.describe('Performance: filters', () => {
  test('een technieker kiezen stuurt technieker=… mee en hertekent het scherm met de tweede respons', async ({ page, verzoeken }) => {
    const queries = [];
    await openPerformance(page, {
      dashboard: ({ query }) => {
        queries.push(query.toString());
        return json(200, dashboardData((d) => {
          if (query.get('technieker') === 'Roel') {
            d.filters.technieker = 'Roel';
            d.kern.huidig.interventies = { n: 3 };
          }
        }));
      },
    });
    await expect(tegel(page, 'interventies').locator('.tegel-waarde')).toHaveText('10');
    expect(queries[0]).not.toContain('technieker');
    expect(queries[0]).toMatch(/^van=2026-10-01&tot=2026-10-05&herhaal=30$/); // deze maand tot en met de vaste klok

    await page.locator('.dash-filters select[data-arg="technieker"]').selectOption('Roel');
    await expect(tegel(page, 'interventies').locator('.tegel-waarde')).toHaveText('3');
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain('technieker=Roel');
    await expect(page.locator('.dash-filters select[data-arg="technieker"]')).toHaveValue('Roel'); // de keuze blijft staan na het hertekenen
    expect(verzoeken.van('/api/dashboard', 'GET')).toHaveLength(2);
  });
});

test.describe('Performance: licht thema', () => {
  test('dezelfde ring heeft in het lichte thema de ingestelde statuskleur (groen en rood)', async ({ page }) => {
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem('blitz_theme', 'light'); });
    await openPerformance(page, {
      dashboard: dashboardStub((d) => { d.kern.huidig.opTijd = { pct: 92, n: 12, teVroeg: 1, opTijd: 11, teLaat: 0 }; }),
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const kleur = (sleutel) => page.locator(`.tegels > .tegel--${sleutel} svg.ring-svg`).evaluate((el) => {
      const s = getComputedStyle(el);
      return { token: s.getPropertyValue('--ring-kleur').trim(), boog: getComputedStyle(el.querySelector('.ring-boog')).stroke };
    });
    expect(await kleur('opTijd')).toEqual({ token: '#0ca30c', boog: 'rgb(12, 163, 12)' }); // 92 %: groen
    expect(await kleur('firstTimeFix')).toEqual({ token: '#d03b3b', boog: 'rgb(208, 59, 59)' }); // 60 % first-time-fix: rood
  });
});

test.describe('Performance: kleurgrenzen', () => {
  const TWEE_TECHNIEKERS = (d) => {
    d.tijd.opTijdPerTechnieker = [
      { technieker: 'Tim', n: 11, teVroeg: 1, opTijd: 10, teLaat: 0, pct: 91 },
      { technieker: 'Roel', n: 8, teVroeg: 0, opTijd: 7, teLaat: 1, pct: 88 },
    ];
  };
  const ringVan = (page, naam) => kaartMet(page, 'Op tijd per technieker').locator('.dash-ring', { has: page.locator('.dash-ring-kop', { hasText: new RegExp(`^${naam}$`) }) }).locator('svg.ring-svg');

  test('twee ringen met 3 % verschil rond een grens: de aangepaste grens (PUT) verandert de klasse', async ({ page, verzoeken }) => {
    await openPerformance(page, { dashboard: dashboardStub(TWEE_TECHNIEKERS) });
    await expect(ringVan(page, 'Tim')).toHaveClass(/ring--goed/); // 91 >= 90
    await expect(ringVan(page, 'Roel')).toHaveClass(/ring--aandacht/); // 88 < 90, >= 75

    await openInstellingen(page);
    await grensVeld(page, OPTIJD_RING, 'groen vanaf').fill('85');
    await page.getByRole('button', { name: 'Grenzen bewaren' }).click();
    await expect(page.locator('#toast')).toHaveText('Grenzen bewaard');

    const put = verzoeken.van('/api/dashboard-instellingen', 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0].body.versie).toBe(1);
    expect(put[0].body.grenzen.opTijd).toEqual({ groen: 85, oranje: 75, richting: 'hoog' });
    await expect(ringVan(page, 'Roel')).toHaveClass(/ring--goed/); // 88 >= 85
    await expect(ringVan(page, 'Tim')).toHaveClass(/ring--goed/);
    await expect(grensVeld(page, OPTIJD_RING, 'groen vanaf')).toHaveValue('85');
  });

  test('een mislukte bewaring (503) laat de ingetypte waarden staan en de knop weer bruikbaar', async ({ page, consoleFouten }) => {
    const basis = grenzenStub();
    await openPerformance(page, {
      dashboard: dashboardStub(TWEE_TECHNIEKERS),
      instellingen: (z) => (z.methode === 'PUT' ? json(503, OPSLAG_STORING) : basis(z)),
    });
    await openInstellingen(page);
    await grensVeld(page, OPTIJD_RING, 'groen vanaf').fill('85');
    await grensVeld(page, OPTIJD_RING, 'oranje vanaf').fill('70');
    await page.getByRole('button', { name: 'Grenzen bewaren' }).click();
    await expect(page.locator('#toast')).toContainText('De opslag is tijdelijk niet bereikbaar');
    await verwachtFout(consoleFouten, '/api/dashboard-instellingen', 503);
    // Niets is teruggezet naar de bewaarde stand: de getypte waarden staan er nog, de knop is weer actief, de ringen zijn niet gewijzigd.
    await expect(grensVeld(page, OPTIJD_RING, 'groen vanaf')).toHaveValue('85');
    await expect(grensVeld(page, OPTIJD_RING, 'oranje vanaf')).toHaveValue('70');
    await expect(page.getByRole('button', { name: 'Grenzen bewaren' })).toBeEnabled();
    await expect(ringVan(page, 'Roel')).toHaveClass(/ring--aandacht/);
  });

  test('grenzen die niet geladen konden worden: uitleg, standaardkleuren, bewaren uitgeschakeld en "Opnieuw laden" herstelt het', async ({ page, consoleFouten }) => {
    const basis = grenzenStub();
    let lezingen = 0;
    await openPerformance(page, {
      instellingen: (z) => { lezingen += 1; return lezingen === 1 ? json(503, OPSLAG_STORING) : basis(z); },
    });
    // Het scherm zelf werkt, met de standaardkleuren (70 % op tijd is rood).
    await expect(tegel(page, 'opTijd').locator('figure.ring')).toHaveClass(/ring--slecht/);
    await verwachtFout(consoleFouten, '/api/dashboard-instellingen', 503);
    await expect(page.locator('.dash-instellingen > summary')).toContainText('niet geladen');
    await openInstellingen(page);
    await expect(page.locator('.dash-instellingen')).toContainText('De grenzen konden niet geladen worden; standaardkleuren worden gebruikt.');
    await expect(page.getByRole('button', { name: 'Grenzen bewaren' })).toBeDisabled();
    await expect(grensVeld(page, OPTIJD_RING, 'groen vanaf')).toBeDisabled();

    await page.getByRole('button', { name: 'Opnieuw laden' }).click();
    await expect(page.getByRole('button', { name: 'Opnieuw laden' })).toHaveCount(0);
    await expect(page.locator('.dash-instellingen > summary')).not.toContainText('niet geladen');
    await expect(page.getByRole('button', { name: 'Grenzen bewaren' })).toBeEnabled();
    await expect(grensVeld(page, OPTIJD_RING, 'groen vanaf')).toHaveValue('90');
    expect(lezingen).toBe(2);
  });
});

test.describe('Performance: toegang en storingen', () => {
  for (const rol of ['planner', 'technieker', 'sales']) {
    test(`${rol}: geen tab Beheer (dus geen Performance) en geen enkel dashboard-verzoek`, async ({ page, verzoeken }) => {
      await startApp(page, { loginRol: rol, overschrijf: { dashboard: dashboardStub(), 'dashboard-instellingen': grenzenStub() } });
      // De app is klaar: de rol heeft zijn eigen scherm (sales heeft nog geen tabs, enkel een mededeling).
      if (rol === 'sales') await expect(page.getByRole('heading', { name: 'Het sales-gedeelte volgt' })).toBeVisible();
      else await expect(page.locator('.tabs-inner .tab:visible').first()).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Beheer', exact: true })).toHaveCount(0);
      await expect(page.locator('#tab-beheer')).toHaveCount(0);
      await expect(page.locator('#beheer-tab-performance')).toHaveCount(0);
      expect(verzoeken.van('/api/dashboard')).toEqual([]);
      expect(verzoeken.van('/api/dashboard-instellingen')).toEqual([]);
    });
  }

  test('403 van de server: een melding, geen cijfers en geen "Opnieuw proberen"', async ({ page, consoleFouten }) => {
    await openPerformance(page, { dashboard: () => json(403, { error: 'Geen toegang', code: 'geen-recht' }) });
    const melding = page.locator('.dash-meldingen .dash-melding--fout');
    await expect(melding).toContainText('Alleen een beheerder heeft toegang tot het dashboard.');
    await verwachtFout(consoleFouten, '/api/dashboard', 403);
    await expect(page.locator('.tegel')).toHaveCount(0);
    await expect(page.locator('.dash-blok')).toHaveCount(0);
    await expect(page.locator('.ring')).toHaveCount(0);
    await expect(melding.getByRole('button')).toHaveCount(0);
  });

  test('503 van de server: een melding zonder cijfers; "Opnieuw proberen" laadt het dashboard alsnog', async ({ page, consoleFouten }) => {
    let aanroepen = 0;
    await openPerformance(page, {
      dashboard: () => { aanroepen += 1; return aanroepen === 1 ? json(503, OPSLAG_STORING) : json(200, dashboardData()); },
    });
    const melding = page.locator('.dash-meldingen .dash-melding--fout');
    await expect(melding).toContainText('De opslag is tijdelijk niet bereikbaar. Probeer het later opnieuw.');
    await verwachtFout(consoleFouten, '/api/dashboard', 503);
    await expect(page.locator('.tegel')).toHaveCount(0);
    await expect(page.locator('.dash-blok')).toHaveCount(0);

    await melding.getByRole('button', { name: 'Opnieuw proberen' }).click();
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
    await expect(page.locator('.dash-meldingen .dash-melding')).toHaveCount(0);
    expect(aanroepen).toBe(2);
  });
});

test.describe('Performance: dekking en rapporten', () => {
  test('dekking.fouten geeft een voetnoot met de niet-leesbare bronnen; de cijfers blijven staan', async ({ page }) => {
    await openPerformance(page, {
      dashboard: dashboardStub((d) => { d.dekking.fouten = ['rapportlijst-archief-2025', 'voorstel-status']; }),
    });
    await expect(page.locator('.dash-voetnoten')).toContainText('Niet alle bronnen konden gelezen worden (rapportlijst-archief-2025, voorstel-status); de cijfers kunnen onvolledig zijn');
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
  });

  test('zonder dekking.fouten staat die voetnoot er niet', async ({ page }) => {
    await openPerformance(page);
    await expect(page.locator('.dash-voetnoten')).toBeVisible();
    await expect(page.locator('.dash-voetnoten')).not.toContainText('Niet alle bronnen');
    await expect(page.locator('.dash-voetnoten')).not.toContainText('meer dan 1000 logregels');
  });

  test('bronnen.activiteitAfgekapt toont de noot dat annulaties onvolledig kunnen zijn', async ({ page }) => {
    await openPerformance(page, { dashboard: dashboardStub((d) => { d.bronnen = { activiteitAfgekapt: true }; }) });
    await expect(page.locator('.dash-voetnoten')).toContainText('Er zijn meer dan 1000 logregels in deze periode; annulaties kunnen onvolledig zijn.');
  });

  test('"Open rapport" bij een herhaalbezoek opent het rapport via window.open', async ({ page }) => {
    await openPerformance(page);
    // De echte aanroep opent een venster; hier een stub die de argumenten noteert (en null geeft: "geblokkeerd", dus geen extra pagina).
    await page.evaluate(() => { window.__opens = []; window.open = (...a) => { window.__opens.push(a); return null; }; });
    const rij = page.locator('.herhaal-rij').first();
    await expect(rij).toContainText('#h10');
    await rij.getByRole('button', { name: 'Open rapport', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__opens.length)).toBe(1);
    expect(await page.evaluate(() => window.__opens[0])).toEqual(['', '_blank']);
    await expect(page.locator('#toast')).toContainText('PDF-venster werd geblokkeerd'); // de stub gaf null terug
  });
});
