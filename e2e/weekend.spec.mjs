import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';
import { startSalesApp } from './sales-hulp.mjs';

// Weekendgedrag (acceptatietest S3): op zaterdag/zondag openen Kalender, Route, Ingepland en "Plan deze week" op de KOMENDE week.
// Klok: zaterdag 10 okt 2026 10:00 (Europe/Brussels); de komende week is 12 okt - 18 okt.
const ZATERDAG = '2026-10-10T10:00:00+02:00';
const ZONDAG = '2026-10-11T20:00:00+02:00';
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });

const lead = (id, naam, i = 0) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93 + i * 0.004, lon: 5.34 + i * 0.004, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null },
});

test.describe('weekend: sales', () => {
  test('Kalender opent op de komende week, Plan deze week plant die week, Route opent op maandag', async ({ page }) => {
    await startSalesApp(page, { nu: ZATERDAG, leads: ['Aerts', 'Bogaert', 'Claes'].map((n, i) => lead(`l${i}`, n, i)), blokken: [] });
    await tab(page, 'Kalender').click();
    const kal = page.locator('#view-sales-kalender');
    await expect(kal.locator('.kal-lbl-tekst')).toHaveText('12 okt – 18 okt');
    await expect(kal.locator('.day-col[data-date="2026-10-12"]')).toBeVisible();
    await kal.getByRole('button', { name: /Plan deze week/ }).click();
    const venster = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await expect(venster).toBeVisible();
    await expect(venster.locator('.result-section', { hasText: 'INGEPLAND (3)' })).toBeVisible();
    await expect(venster).not.toContainText('Geen plaats meer deze week');
    await venster.getByRole('button', { name: 'Sluiten' }).click();

    await tab(page, 'Route').click();
    await expect(page.locator('#view-sales-route .ws-dag.actief')).toHaveAttribute('data-ws', '2026-10-12');
  });

  test('zondag: zelfde gedrag; "Vandaag" in de kalender is de komende maandag', async ({ page }) => {
    await startSalesApp(page, { nu: ZONDAG });
    await tab(page, 'Kalender').click();
    const kal = page.locator('#view-sales-kalender');
    await expect(kal.locator('.kal-lbl-tekst')).toHaveText('12 okt – 18 okt');
    await expect(kal.locator('.kal-week-label')).not.toHaveClass(/niet-vandaag/);
    await kal.getByRole('button', { name: 'Vorige periode' }).click();
    await expect(kal.locator('.kal-week-label')).toHaveClass(/niet-vandaag/);
    await kal.locator('.kal-week-label').click();
    await expect(kal.locator('.kal-lbl-tekst')).toHaveText('12 okt – 18 okt');
  });
});

test.describe('weekend: technieker/planner', () => {
  test('Kalender, Route en Ingepland openen op de komende week; een lege week verwijst naar de week mét service', async ({ page }) => {
    await startApp(page, { nu: ZATERDAG, overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#kal-label')).toContainText('12 okt – 18 okt');
    await page.getByRole('tab', { name: 'Route' }).click();
    await expect(page.getByTestId('route-datum')).toHaveValue('2026-10-12');
    await expect(page.locator('#week-strip .ws-dag.actief')).toContainText('12');

    await page.getByRole('tab', { name: /Ingepland/ }).click();
    await expect(page.locator('#gep-label')).toHaveText('12 okt – 18 okt');
    // Het geplande ticket (wo 14 okt) staat in de komende week: badge en lijst kloppen (acceptatietest: badge 1 boven een lege lijst).
    await expect(page.locator('#cnt-gepland')).toHaveText('1');
    await expect(page.locator('#gep-body .ticket')).toHaveCount(1);
    // De badge telt alle weken; een lege week zegt waar het geplande ticket staat en springt erheen.
    await page.locator('#view-gepland').getByRole('button', { name: 'Vorige periode' }).click();
    await expect(page.locator('#gep-label')).toHaveText('5 okt – 11 okt');
    await expect(page.locator('#gep-body .empty')).toHaveText('Geen geplande service deze week');
    await expect(page.locator('#gep-body .gep-elders')).toContainText('1 ingepland in een andere week');
    await page.locator('#gep-body .gep-elders button').click();
    await expect(page.locator('#gep-label')).toHaveText('12 okt – 18 okt');
    await expect(page.locator('#gep-body .ticket')).toHaveCount(1);
  });
});
