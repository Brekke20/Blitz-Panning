import { test, expect, startApp } from './helpers.mjs';
import { zetInstellingenTim } from './route-hulp.mjs';
import { seed, dag, voegStopsToe, afspraak } from './kalender-hulp.mjs';

// Karakterisering van de kalender per indeling (etappe 4, taak 1): 'smal' (gsm, lijst van kaarten),
// 'tablet-staand' (drie werkdagen, verschuiving per werkdag) en een wissel van apparaat bij een open kalender.
// De indeling volgt uit apparaat.js (blitz_weergave plus viewport), los van pointer-media.
// Klok: maandag 5 okt 2026 09:00; DUMMY_DATA zet #1004 op woensdag 7 okt (09:00), #1006 op vrijdag 9 okt.

const zetWeergave = (page, weergave) => page.addInitScript((w) => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  localStorage.setItem('blitz_weergave', w);
}, weergave);

const datums = (page) => page.locator('.day-col[data-date]').evaluateAll(els => els.map(e => e.dataset.date));
const volgende = (page) => page.getByRole('button', { name: 'Volgende periode' }).first();
const vorige = (page) => page.getByRole('button', { name: 'Vorige periode' }).first();

test.describe('kalender: gsm (indeling smal)', () => {
  test('kaarten in tijdvolgorde, zonder uur achteraan, nu-markering en geen tijdlijn', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    const vroeg = afspraak('v1', '2026-10-07', '07:00', '07:30', { titel: 'Vroege afspraak', telefoon: '0475111222', adres: 'Depot Geel' });
    await startApp(page, { viewport: { width: 390, height: 844 }, overschrijf: seed({ afspraken: [vroeg] }) });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#kal-label')).toContainText('5 okt – 11 okt');
    await voegStopsToe(page, [{ id: 'z1', nummer: '9001', datum: '2026-10-07' }]); // zonder uur

    // Geen tijdlijn: lijst van gestapelde kaarten.
    await expect(page.locator('.tl-wrap')).toHaveCount(0);
    await expect(page.locator('.tl-gutter')).toHaveCount(0);
    await expect(page.locator('#week-grid')).toHaveClass('week-grid');
    await expect(page.locator('#week-grid')).not.toHaveClass(/tl-mode/);

    // Woensdag: 07:00 (eigen afspraak), 09:00 (#1004), 14:00 (Teamoverleg), zonder uur achteraan (99:99).
    const woensdag = dag(page, '2026-10-07');
    const kaarten = woensdag.locator('.day-body > [data-sortkey]');
    await expect(kaarten).toHaveCount(4);
    expect(await kaarten.evaluateAll(els => els.map(e => e.dataset.sortkey))).toEqual(['07:00', '09:00', '14:00', '99:99']);
    await expect(kaarten.nth(0)).toHaveClass(/cal-local-event/);
    await expect(kaarten.nth(1)).toContainText('#1004');
    await expect(kaarten.nth(2)).toContainText('Teamoverleg');
    await expect(kaarten.nth(3)).toContainText('#9001');

    // De afspraak om 07:00 toont de badge "buiten werkuren"; de andere kaarten niet.
    await expect(woensdag.locator('.badge-buitenuren')).toHaveCount(1);
    await expect(kaarten.nth(0).locator('.badge-buitenuren')).toHaveText('buiten werkuren');

    // Nu-markering in de kolom van vandaag (maandag).
    await expect(page.locator('.kal-nu-marker')).toHaveCount(1);
    await expect(dag(page, '2026-10-05').locator('.kal-nu-marker')).toHaveText(/^nu 09:\d\d$/);

    // Het kruisje (uit planning halen) is op de gsm verborgen; bellen en navigeren staan op de kaart.
    await expect(kaarten.nth(1).locator('.cal-unplan-x')).toBeHidden();
    const acties = kaarten.nth(1).locator('.cal-actions');
    await expect(acties.getByText('📞 Bellen')).toBeVisible();
    await expect(acties.getByText('🧭 Navigeer')).toBeVisible();
    // Navigeer klikken: window.open gestubd (niets verlaat de pagina); effect gebeurd, detail blijft dicht (C8).
    await page.evaluate(() => { window.__open = []; window.open = (u) => { window.__open.push(u); return null; }; });
    await acties.getByText('🧭 Navigeer').click();
    await expect.poll(() => page.evaluate(() => window.__open)).toHaveLength(1);
    expect((await page.evaluate(() => window.__open))[0]).toContain('destination=' + encodeURIComponent('Koerselsesteenweg 88, 3580 Beringen'));
    await expect(page.locator('#d-num')).toBeHidden();
    await expect(kaarten.nth(0).locator('.cal-actions').getByText('📞 Bellen')).toBeVisible();

    // Positief tegenstuk: de weekwissel werkt ook in de lijstweergave.
    await volgende(page).click();
    await expect(page.locator('#kal-label')).toContainText('12 okt – 18 okt');
    await expect.poll(() => datums(page)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    await expect(page.locator('.cal-ticket')).toHaveCount(0);
    await expect(page.locator('.kal-nu-marker')).toHaveCount(0);
    await vorige(page).click();
    await expect(page.locator('#kal-label')).toContainText('5 okt – 11 okt');
    await expect(page.locator('.cal-ticket')).toHaveCount(3);
  });

  test('Bellen op de ticketkaart start het gesprek maar opent het detail niet (bugfix W5)', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { viewport: { width: 390, height: 844 }, overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const kaart = dag(page, '2026-10-07').locator('.day-body > [data-sortkey="09:00"]');
    const bellen = kaart.locator('.cal-actions').getByText('📞 Bellen');
    await expect(bellen).toBeVisible();
    // Het tel:-protocol verlaat de pagina niet in de test: een capture-luisteraar op document annuleert de navigatie
    // en onthoudt de href, zodat we zien dat de klik de link bereikte.
    await page.evaluate(() => {
      window.__tel = [];
      document.addEventListener('click', e => {
        const a = e.target.closest?.('a[href^="tel:"]');
        if (a) { window.__tel.push(a.getAttribute('href')); e.preventDefault(); }
      }, true);
    });
    await bellen.click();
    await expect.poll(() => page.evaluate(() => window.__tel)).toHaveLength(1);
    expect((await page.evaluate(() => window.__tel))[0]).toMatch(/^tel:\+?\d+$/);
    await expect(page.locator('#d-num')).toBeHidden();
    // Positief tegenstuk: een klik op de kaart zelf opent het detail wel.
    await kaart.locator('.cal-sub').click();
    await expect(page.locator('#d-num')).toBeVisible();
  });
});

test.describe('kalender: gsm, kaartklik', () => {
  test('een klik op de kaart opent het detail', async ({ page }) => {
    // Het tijdlijnblok (.tl-ticket) heeft zijn positieve tegenstuk al in voorstel-afspraak-blokkering.spec.mjs
    // (openTicket1004, regel 6-13); dit is het tegenstuk voor de gsm-kaart (.cal-ticket).
    await zetWeergave(page, 'gsm');
    await startApp(page, { viewport: { width: 390, height: 844 }, overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await dag(page, '2026-10-07').locator('.cal-ticket').locator('.cal-sub').click();
    await expect(page.locator('#d-num')).toHaveText('#1004');
  });
});

test.describe('kalender: tablet staand', () => {
  const tablet = { width: 820, height: 1180 };

  test('drie werkdagen vanaf vandaag; ‹ en › schuiven één werkdag; het label brengt terug', async ({ page }) => {
    await zetWeergave(page, 'tablet');
    await startApp(page, { viewport: tablet, overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const label = page.locator('#kal-label');
    await expect(page.locator('#kal-label-tekst')).toHaveText('5 okt – 7 okt');
    await expect.poll(() => datums(page)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    await expect(label).not.toHaveClass(/niet-vandaag/);
    // De tijdlijn is er (enkel 'smal' gebruikt de lijst).
    await expect(page.locator('.tl-wrap')).toHaveCount(3);

    await volgende(page).click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('6 okt – 8 okt');
    await expect.poll(() => datums(page)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    await expect(label).toHaveClass(/niet-vandaag/);
    await volgende(page).click();
    await expect.poll(() => datums(page)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    await expect(page.locator('#kal-label-tekst')).toHaveText('7 okt – 9 okt');

    await vorige(page).click();
    await expect.poll(() => datums(page)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    await vorige(page).click();
    await vorige(page).click();
    // Het weekend wordt overgeslagen: één werkdag terug vanaf maandag is vrijdag 2 okt.
    await expect.poll(() => datums(page)).toEqual(['2026-10-02', '2026-10-05', '2026-10-06']);
    await expect(label).toHaveClass(/niet-vandaag/);

    // "↺ Vandaag" (de label-knop) brengt terug.
    await label.click();
    await expect(label).not.toHaveClass(/niet-vandaag/);
    await expect.poll(() => datums(page)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });

  test('in de maandweergave schuift › een maand, los van de dagverschuiving', async ({ page }) => {
    await zetWeergave(page, 'tablet');
    await startApp(page, { viewport: tablet, overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await volgende(page).click(); // dagverschuiving 1
    await expect(page.locator('#kal-label-tekst')).toHaveText('6 okt – 8 okt');

    await page.locator('#kal-view-month').click();
    // Gemeten: het wisselen van weergave zet beide verschuivingen terug.
    await expect(page.locator('#kal-label-tekst')).toHaveText('Oktober 2026');
    await expect(page.locator('#kal-label')).not.toHaveClass(/niet-vandaag/);
    await volgende(page).click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('November 2026');
    await expect(page.locator('#kal-label')).toHaveClass(/niet-vandaag/);
    await page.locator('#kal-label').click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('Oktober 2026');
    await expect(page.locator('#kal-label')).not.toHaveClass(/niet-vandaag/);
  });

  test('vandaag geen werkdag: de eerstvolgende werkdag is het beginpunt', async ({ page }) => {
    // Maandag (de vaste klok) is geen werkdag voor Tim: di, wo, do, vr.
    await zetWeergave(page, 'tablet');
    await zetInstellingenTim(page, { werkdagen: [2, 3, 4, 5] });
    await startApp(page, { viewport: tablet, technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    // Gemeten: dinsdag 6 okt is het beginpunt.
    await expect.poll(() => datums(page)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    await expect(page.locator('#kal-label-tekst')).toHaveText('6 okt – 8 okt');
  });

  test('Plan deze week negeert de dagverschuiving en plant de week van vandaag (bekende eigenaardigheid)', async ({ page }) => {
    // Bekende eigenaardigheid, zie spec C13: autoPlan leest enkel de weekverschuiving (kalOffset), niet de
    // dagverschuiving van de tablet. Twee werkdagen verder bekijken en plannen geeft dus de week van 5 okt.
    await zetWeergave(page, 'tablet');
    await startApp(page, { viewport: tablet, technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await volgende(page).click();
    await volgende(page).click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('7 okt – 9 okt');

    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await expect(resultaat.getByText(/#1001 Laadpaal offline na stroomuitval → .*5 okt/)).toBeVisible();
    await expect(resultaat.getByText(/#1002 Controller reageert niet op OCPP commando → .*5 okt/)).toBeVisible();
  });
});

test.describe('kalender: wissel van apparaat bij een open kalender', () => {
  test('van tijdlijn naar lijst en terug, zonder fout en zonder resten', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('.tl-wrap')).toHaveCount(5);
    await expect(page.locator('#week-grid')).toHaveClass(/tl-mode/);
    await expect(page.locator('.tl-now')).toHaveCount(1);

    await page.evaluate(() => window.zetWeergave('gsm'));
    await expect(page.locator('#week-grid')).not.toHaveClass(/tl-mode/);
    await expect(page.locator('.tl-wrap')).toHaveCount(0);
    await expect(page.locator('.tl-gutter')).toHaveCount(0);
    await expect(page.locator('.tl-now')).toHaveCount(0);
    await expect(page.locator('.tl-offhours')).toHaveCount(0);
    await expect(page.locator('.cal-ticket')).toHaveCount(2);
    await expect(page.locator('.cal-local-event')).toHaveCount(1);
    await expect(page.locator('.kal-nu-marker')).toHaveCount(1);

    // En terug naar de computerweergave: de tijdlijn komt terug, de lijst-resten zijn weg.
    await page.evaluate(() => window.zetWeergave('computer'));
    await expect(page.locator('#week-grid')).toHaveClass(/tl-mode/);
    await expect(page.locator('.tl-wrap')).toHaveCount(5);
    await expect(page.locator('.kal-nu-marker')).toHaveCount(0);
    await expect(page.locator('.tl-now')).toHaveCount(1);
  });
});
