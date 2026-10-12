import { test, expect, startApp } from './helpers.mjs';

// Feestelijke versiering (Halloween, v2.1.0): decoratielaag #event-laag, de schakelaar in "Dit toestel" en de uitzonderingen.
// In ?test staat de versiering uit; deze specs dwingen ze af met ?test&versiering=aan (die vlag telt enkel in testmodus).
// Testklok: maandag 5 okt 2026 (binnen het Halloween-venster); "buiten het venster" gebruikt 15 sept.
const AAN = '?test&versiering=aan';
const laag = (page) => page.locator('#event-laag');

async function openToestel(page) {
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '⚙️ Instellingen' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Dit toestel', exact: true }).click();
  await expect(modal.locator('#set-tab-toestel')).toBeVisible();
  return modal;
}

test.describe('versiering op de computer', () => {
  test('met het thema aan bestaat de laag: aria-hidden, niet klikbaar, geen focus, en klikken gaan er dwars door', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(laag(page)).toHaveCount(1);
    await expect(laag(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-event', 'halloween');
    await expect(laag(page)).toHaveCSS('pointer-events', 'none');
    expect(await laag(page).locator('a, button, input, [tabindex]').count()).toBe(0);
    // Bewegende delen op de computer: hoogstens 3 spinnen
    await expect(laag(page).locator('.ev-spin')).toHaveCount(3);
    // Het midden van een knop onder de laag: het element op die plek is de knop zelf, en de klik werkt
    const doel = page.locator('#tab-kalender');
    const box = await doel.boundingBox();
    const bovenaan = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#event-laag') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(bovenaan).toBe(false);
    await doel.click();
    await expect(doel).toHaveAttribute('aria-selected', 'true');
    // Ook onder de webhoeken is niets van de laag te raken
    const wortel = await page.evaluate(() => {
      const r = document.querySelector('#event-laag .ev-web-tl').getBoundingClientRect();
      return document.elementFromPoint(r.left + 10, r.top + 10)?.closest('#event-laag') !== null;
    });
    expect(wortel).toBe(false);
  });

  test('de laag staat onder vensters, is verborgen in print en raakt de rapportvoorbeeld-iframe niet', async ({ page }) => {
    await startApp(page, { query: AAN });
    const z = await laag(page).evaluate(el => Number(getComputedStyle(el).zIndex));
    expect(z).toBeGreaterThan(30);
    expect(z).toBeLessThan(200);
    await page.emulateMedia({ media: 'print' });
    await expect(laag(page)).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(laag(page)).toBeAttached();
    // Geen decoratie in een iframe-document (de rapportvoorbeeld-iframe laadt geen app-CSS of -script)
    expect(await page.evaluate(() => [...document.querySelectorAll('iframe')].filter(f => f.contentDocument?.getElementById('event-laag')).length)).toBe(0);
  });

  test('het pompoenaccent staat op het scherm en de laag werkt ook in licht thema', async ({ page }) => {
    await startApp(page, { query: AAN });
    const donker = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(donker).toBe('#f97316');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(laag(page)).toBeAttached();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#event-laag')).getPropertyValue('--ev-spin').trim())).toBe('#2b2b2b');
  });

  test('de schakelaar in Dit toestel zet de versiering uit en de keuze blijft na herladen', async ({ page }) => {
    await startApp(page, { query: AAN });
    const modal = await openToestel(page);
    const vink = modal.getByLabel('Versiering tonen tijdens feestperiodes');
    await expect(vink).toBeChecked();
    await expect(modal.locator('#set-versiering-uitleg')).toContainText('Halloween');
    await vink.uncheck();
    await expect(laag(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
    expect(await page.evaluate(() => localStorage.getItem('blitz_versiering'))).toBe('uit');
    await page.reload();
    await expect(page.locator('#cnt-tickets')).toBeVisible();
    await expect(laag(page)).toHaveCount(0);
    const modal2 = await openToestel(page);
    await expect(modal2.getByLabel('Versiering tonen tijdens feestperiodes')).not.toBeChecked();
    await modal2.getByLabel('Versiering tonen tijdens feestperiodes').check();
    await expect(laag(page)).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('blitz_versiering'))).toBeNull();
  });

  test('met prefers-reduced-motion bestaan er geen bewegende delen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startApp(page, { query: AAN });
    await expect(laag(page)).toHaveCount(1);
    await expect(laag(page).locator('.ev-web')).toHaveCount(4);
    await expect(laag(page).locator('.ev-beweeg')).toHaveCount(0);
  });

  test('een verborgen tab pauzeert de animaties', async ({ page }) => {
    await startApp(page, { query: AAN });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(laag(page)).toHaveClass(/ev-gepauzeerd/);
    await expect(laag(page).locator('.ev-hang').first()).toHaveCSS('animation-play-state', 'paused');
  });
});

test.describe('geen versiering', () => {
  test('buiten het evenementvenster (15 september) is er niets, ook met de vlag', async ({ page }) => {
    await startApp(page, { query: AAN, nu: '2026-09-15T09:00:00+02:00' });
    await expect(laag(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
  });

  test('in ?test zonder de vlag is er niets, ook midden in oktober', async ({ page }) => {
    await startApp(page);
    await expect(laag(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
    // De vlag hoort bij testmodus: een gewone querystring met enkel de vlag verandert niets aan de uitzondering ?test
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#00dfa3');
  });
});

test.describe('versiering op een telefoon (aanraak, smal)', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('enkel statische webben: geen spinnen, vleermuis of mist, en de laag blokkeert niets', async ({ page }) => {
    await startApp(page, { query: AAN, viewport: { width: 375, height: 812 } });
    await expect(laag(page)).toHaveCount(1);
    await expect(laag(page).locator('.ev-web')).toHaveCount(4);
    await expect(laag(page).locator('.ev-beweeg')).toHaveCount(0);
    await expect(laag(page).locator('.ev-spin')).toHaveCount(0);
    await expect(laag(page)).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('html')).toHaveAttribute('data-event-sober', 'ja');
    // Alle animaties in de laag: geen enkele loopt
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('#event-laag')).length)).toBe(0);
  });
});
