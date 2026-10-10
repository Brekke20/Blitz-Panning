import { test, expect, startApp } from './helpers.mjs';
import { zetInstellingenTim } from './route-hulp.mjs';
import { seed, dag, voegStopsToe } from './kalender-hulp.mjs';

// Proefperiode-bug "ticket na werkuren" (Brent-besluiten B1 t/m B6, A17): een dag die vol zit binnen de werkuren krijgt geen
// extra ticket meer, noch via "+" noch via "Plan deze week". Klok: maandag 5 okt 2026 09:00 (VASTE_NU). Tim heeft #1001 en #1002.
// Werkdag 08:00-17:00, laatsteStart 16:00, duur 120 min, reistijd 30 min per rit (de terugval van "+" en de Route-tab).

const PLUS = 'Inplannen op eerstvolgende vrije dag';
const blok = (id, datum, van = '13:00', tot = '17:00') => ({ id, scope: 'global', person: null, date: datum, kind: 'range', from: van, to: tot, reason: 'Test' });

test.describe('"+" op een volle dag', () => {
  test('twee interventies en geen ruimte meer binnen de werkuren: het ticket gaat naar de eerstvolgende dag met echte vrije tijd', async ({ page, verzoeken }) => {
    // Maandag: 08:00-10:00 en 10:30-12:30 vast, daarna een blokkering van 13:00 tot 17:00. Een nieuw ticket zou na 16:00 aankomen.
    await startApp(page, { technieker: 'Tim', overschrijf: seed({ blokkades: [blok('w1', '2026-10-05')] }) });
    await voegStopsToe(page, [
      { id: 'x1', nummer: '9001', datum: '2026-10-05', uur: '08:00' },
      { id: 'x2', nummer: '9002', datum: '2026-10-05', uur: '10:30' },
    ]);
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 6 okt');
    expect(verzoeken.van('/api/plan')).toEqual([]);

    await page.getByRole('tab', { name: 'Kalender' }).click();
    // Maandag blijft op 2 stops en is vol; het nieuwe ticket staat als chip op dinsdag.
    await expect(dag(page, '2026-10-05').locator('.day-cap')).toHaveText('2/2 stops · ±5u');
    await expect(dag(page, '2026-10-05').locator('.day-cap')).toHaveClass(/full/);
    await expect(dag(page, '2026-10-06').locator('.zu-chip')).toHaveText('#1001');
  });

  test('Brents geval: vaste uren 10:00 en 14:00 met tickets van 2 uur en geen blokkering: geen derde ticket op die dag', async ({ page }) => {
    // 10:00-12:00 en 14:00-16:00: ervoor, ertussen en erna is er geen plek vóór het laatste startuur (16:00) meer.
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await voegStopsToe(page, [
      { id: 'x1', nummer: '9001', datum: '2026-10-05', uur: '10:00' },
      { id: 'x2', nummer: '9002', datum: '2026-10-05', uur: '14:00' },
    ]);
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 6 okt');
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(dag(page, '2026-10-05').locator('.day-cap')).toHaveText('2/2 stops · ±5u');
  });

  test('een eigen afspraak telt mee: met een afspraak van 08:00 tot 17:00 gaat het ticket naar de volgende dag', async ({ page }) => {
    const afspraak = { id: 'ea1', titel: 'Opleiding', datum: '2026-10-05', uur: '08:00', einduur: '17:00', type: 'Afspraak', persoon: null, adres: 'Kantoor', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null };
    await startApp(page, { technieker: 'Tim', overschrijf: seed({ afspraken: [afspraak], basis: false }) });
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 6 okt');
  });

  test('een volle week schuift door naar de eerste dag met echte vrije tijd in de volgende week', async ({ page }) => {
    // Alle werkdagen van 5 t/m 9 okt zijn geblokkeerd van 08:00 tot 17:00 (tijdvak): geen enkele plek in de week.
    const blokkades = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((d, i) => blok('wk' + i, d, '08:00', '17:00'));
    await startApp(page, { technieker: 'Tim', overschrijf: seed({ blokkades }) });
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 12 okt');
  });

  test('een rustige dag blijft gewoon werken: vandaag, voor een vast uur als daar plek is', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await voegStopsToe(page, [{ id: 'x1', nummer: '9001', datum: '2026-10-05', uur: '14:00' }]);
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 5 okt');
    // Het nieuwe ticket (zonder uur) staat in de Route-tab VOOR het vaste uur van 14:00.
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByTestId('route-datum').fill('2026-10-05');
    await expect(page.getByTestId('route-stop-nummer')).toHaveText(['#1001', '#9001']);
  });
});

test.describe('"Plan deze week" op een volle dag', () => {
  test('een dag zonder ruimte binnen de werkuren krijgt niets: niets met aankomst na het laatste startuur', async ({ page, verzoeken }) => {
    // Enkel dinsdag 6 okt is werkdag. Twee vaste interventies (08:00-10:00 en 10:30-12:30) en een blokkering van 13:00 tot 17:00.
    await zetInstellingenTim(page, { werkdagen: [2] });
    await startApp(page, { technieker: 'Tim', overschrijf: seed({ blokkades: [blok('w2', '2026-10-06')] }) });
    await voegStopsToe(page, [
      { id: 'x1', nummer: '9001', datum: '2026-10-06', uur: '08:00' },
      { id: 'x2', nummer: '9002', datum: '2026-10-06', uur: '10:30' },
    ]);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();

    const venster = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await expect(venster.getByText('Niet ingepland (2)', { exact: true })).toBeVisible();
    await expect(venster.getByText(/Ingepland \(/)).toHaveCount(0);
    await expect(venster.getByText('Geen plaats meer deze week')).toHaveCount(2);
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });
});

test.describe('"Plan deze week": Brents geval', () => {
  test('vaste uren 10:00 en 14:00 met tickets van 2 uur: geen derde ticket op die dag', async ({ page, verzoeken }) => {
    await zetInstellingenTim(page, { werkdagen: [2] });
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await voegStopsToe(page, [
      { id: 'x1', nummer: '9001', datum: '2026-10-06', uur: '10:00' },
      { id: 'x2', nummer: '9002', datum: '2026-10-06', uur: '14:00' },
    ]);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    const venster = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await expect(venster.getByText('Niet ingepland (2)', { exact: true })).toBeVisible();
    await expect(venster.getByText(/Ingepland \(/)).toHaveCount(0);
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });
});

test.describe('Route-tab: waarschuwing bij een late aankomst', () => {
  test('een stop zonder uur die niet meer vóór het laatste startuur aankomt, krijgt een duidelijke waarschuwing', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    // Vijf stops zonder uur op dinsdag 6 okt: aankomst ± 08:30, 11:00, 13:30, 16:00 en 18:30. Enkel de vijfde is te laat.
    await voegStopsToe(page, [1, 2, 3, 4, 5].map(i => ({ id: 'z' + i, nummer: '910' + i, datum: '2026-10-06' })));
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByTestId('route-datum').fill('2026-10-06');
    await expect(page.getByTestId('route-stop')).toHaveCount(5);
    const waarschuwing = page.getByTestId('route-stop-laat');
    await expect(waarschuwing).toHaveCount(1);
    await expect(waarschuwing).toContainText('Start na het laatste startuur (16:00)');
    await expect(page.getByTestId('route-stop').nth(4).getByTestId('route-stop-laat')).toHaveCount(1);
  });
});

test.describe('Route-tab: waarschuwing bij een vast uur na het laatste startuur', () => {
  test('een vast uur van 17:00 krijgt dezelfde rode waarschuwing', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await voegStopsToe(page, [{ id: 'f1', nummer: '9301', datum: '2026-10-07', uur: '17:00' }]);
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByTestId('route-datum').fill('2026-10-07');
    await expect(page.getByTestId('route-stop-laat')).toContainText('aankomst 17:00');
  });
});

test.describe('Route-tab: late start vastleggen vraagt bevestiging', () => {
  test('Tijden vastleggen met een aankomst na het laatste startuur: Terug bewaart niets, Toch vastleggen wel', async ({ page }) => {
    await zetInstellingenTim(page, { vanTijd: '15:00' });
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await voegStopsToe(page, [1, 2].map(i => ({ id: 'y' + i, nummer: '920' + i, datum: '2026-10-06' })));
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByTestId('route-datum').fill('2026-10-06');
    await expect(page.getByTestId('route-stop')).toHaveCount(2);
    const knop = page.getByRole('button', { name: 'Tijden vastleggen' });

    await knop.click();
    const dialoog = page.getByRole('alertdialog');
    await expect(dialoog).toContainText('Start na 16:00');
    await expect(dialoog).toContainText('#9202');
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(dialoog).toBeHidden();
    await expect(page.getByText('Niet bewaard')).toBeVisible();
    await expect(knop).toBeVisible(); // nog steeds stops zonder tijdstip

    await knop.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Toch vastleggen' }).click();
    await expect(knop).toHaveCount(0); // tijden vastgelegd
  });
});
