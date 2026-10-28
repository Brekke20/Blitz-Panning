import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// v2.1.6: "de chips van Oorzaak storing zijn niet zichtbaar op de tablet". Echte tablet-emulatie (isMobile + touch: data-apparaat
// tablet, data-aanraak ja), liggend en staand, een nieuw rapport en een hervat concept met een oude waarde. De indeling bleek in orde
// (de oorzaak was de service worker die versies mengde, zie tests/sw-strategie.test.mjs); deze test houdt de tabletweergave vast.
// Taak 17 (Brent, 2026-10-28): een tablet rechtop is een gsm in de hele app; liggend blijft hij een tablet.
for (const vp of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
  test.describe(`tablet ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    for (const concept of [false, true]) {
      test(`Oorzaak storing toont de groepen en chips (${concept ? 'hervat concept' : 'nieuw rapport'})`, async ({ page }) => {
        await startApp(page, { overschrijf: seed() });
        expect(await page.evaluate(() => [document.documentElement.dataset.apparaat, document.documentElement.dataset.aanraak])).toEqual([vp.width > vp.height ? 'tablet' : 'gsm', 'ja']);
        await page.getByRole('tab', { name: 'Kalender' }).click();
        await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
        if (concept) {
          await page.evaluate(() => {
            const t = [...kern.toestand.get('allTickets'), ...Object.values(kern.toestand.get('planning')).flat().map(p => p.ticket)].find(x => String(x.number) === '1004');
            localStorage.setItem(`blitz_test_rapportconcept:${t.id}:2026-10-07`, JSON.stringify({ v: 1, opgeslagen: new Date().toISOString(), stap: 'omschrijving', R: { interventieType: 'Interventie', aanrijtijdMin: 20, aanrijtijdBron: 'handmatig', oorzaakStoring: ['Productfout'] } }));
          });
        }
        await page.locator('#d-btn-rapport').click();
        if (concept) await page.getByRole('button', { name: 'Hervatten' }).click();
        const volgende = page.locator('#wiz-btn-next');
        for (let i = 0; i < 8 && !(await page.locator('#oorzaak-wrap').count()); i++) await volgende.click();
        const wrap = page.locator('#oorzaak-wrap');
        await expect(wrap.locator('.wiz-oorz-kop')).toHaveCount(4);
        const chip = wrap.getByRole('button', { name: 'Component defect', exact: true });
        await chip.scrollIntoViewIfNeeded();
        await expect(chip).toBeVisible();
        // Binnen het zichtbare deel van de wizard (niet onder de voettekst of buiten beeld).
        const box = await chip.boundingBox();
        const ftr = await page.locator('.wiz-ftr').boundingBox();
        expect(box.y + box.height).toBeLessThanOrEqual(ftr.y);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        await chip.tap();
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        if (concept) await expect(wrap.locator('.wiz-oorz-chip.oud')).toHaveText(/\(oud\) Productfout/);
      });
    }
  });
}
