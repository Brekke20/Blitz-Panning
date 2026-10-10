import { test, expect, startApp, opslagStub } from './helpers.mjs';

// Instellingen van Tim vooraf zetten (zoals de gebruiker ze via Instellingen zou bewaren).
// Alleen in het hoofdvenster en alleen als er nog niets staat, zodat een herlaad ze behoudt.
async function zetInstellingenTim(page, instellingen) {
  await page.addInitScript((i) => {
    if (window !== window.top) return;
    if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify(i));
  }, instellingen);
}

// Matrixstub met één vaste reistijd (minuten) voor elke bestemming.
const matrixMet = (minuten) => ({ body }) => ({
  status: 200,
  json: { results: (body?.destinations || []).map(() => ({ travelTimeSeconds: minuten * 60, distanceMeters: 50000 })) },
});

async function klikPlanDezeWeek(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
}

const resultaat = (page) => page.getByRole('dialog', { name: '⚡ Planningsresultaat' });

test.describe('plan deze week', () => {
  test('plant de tickets van de gekozen technieker', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim' });
    await klikPlanDezeWeek(page);

    const venster = resultaat(page);
    await expect(venster).toBeVisible();
    await expect(venster.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    // Gemeten bij VASTE_NU (maandag 5 okt) en matrix 20 min: beide Tim-tickets op maandag.
    await expect(venster.getByText(/#1001 Laadpaal offline na stroomuitval → .*5 okt/)).toBeVisible();
    await expect(venster.getByText(/#1002 Controller reageert niet op OCPP commando → .*5 okt/)).toBeVisible();
    // Gemeten: alles past, dus geen "Niet ingepland", geen "Overgeslagen" en geen waarschuwing.
    await expect(venster.getByText(/Niet ingepland/)).toHaveCount(0);
    await expect(venster.getByText(/Overgeslagen/)).toHaveCount(0);
    await expect(venster.getByText(/Reistijd kon niet gecontroleerd worden/)).toHaveCount(0);

    // Het brein vroeg de reistijd tussen de twee tickets op (1001 → 1002).
    const matrix = verzoeken.van('/api/matrix', 'POST');
    expect(matrix.length).toBeGreaterThanOrEqual(1);
    expect(matrix[0].body.origin).toEqual({ lat: 51.162, lon: 4.989 });
    expect(matrix[0].body.destinations).toEqual([{ lat: 50.9307, lon: 5.3325 }]);
  });

  test('Iedereen geeft een toast en plant niets', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'all' });
    await klikPlanDezeWeek(page);

    await expect(page.getByText('Kies eerst een technieker')).toBeVisible();
    await expect(resultaat(page)).toBeHidden();
    expect(verzoeken.van('/api/matrix')).toEqual([]);
  });

  test('resultaat toont de reden bij tickets die niet passen', async ({ page, verzoeken }) => {
    // Enkel woensdag 7 okt werkdag: daar staat al #1004 (Beringen, bevestiging in afwachting). Er is dus
    // geen lege dag meer, en elke rit duurt 90 min (> 45): geen van beide tickets past naast #1004.
    await zetInstellingenTim(page, { werkdagen: [3] });
    await startApp(page, { technieker: 'Tim', overschrijf: { matrix: matrixMet(90) } });
    await klikPlanDezeWeek(page);

    const venster = resultaat(page);
    await expect(venster.getByText('Niet ingepland (2)', { exact: true })).toBeVisible();
    await expect(venster.getByText(/#1001 Laadpaal offline na stroomuitval/)).toBeVisible();
    await expect(venster.getByText(/#1002 Controller reageert niet op OCPP commando/)).toBeVisible();
    await expect(venster.getByText('Te ver van de andere afspraken (meer dan 45 min)')).toHaveCount(2);
    await expect(venster.getByText(/Ingepland \(/)).toHaveCount(0);
    expect(verzoeken.van('/api/matrix', 'POST').length).toBeGreaterThanOrEqual(1);
  });

  test('matrix valt uit: waarschuwing', async ({ page, consoleFouten }) => {
    // Hoge maximale reistijd, zodat de schatting (km x 1,3) het ticket toch laat passen.
    await zetInstellingenTim(page, { werkdagen: [1], maxReistijdMin: 300 });
    await startApp(page, { technieker: 'Tim', overschrijf: { matrix: () => ({ status: 500, json: { error: 'matrix stuk' } }) } });
    await klikPlanDezeWeek(page);

    const venster = resultaat(page);
    await expect(venster.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await expect(venster.getByText(/Reistijd kon niet gecontroleerd worden voor 1 tickets/)).toBeVisible();

    // De 500 is hier bedoeld: de browser meldt hem als consolefout en als HTTP 500. Alleen die ene
    // melding over /api/matrix halen we weg; alles anders blijft de vangnetcontrole laten falen.
    const verwacht = consoleFouten.filter(f => /\/api\/matrix/.test(f) && /500/.test(f));
    expect(verwacht.length).toBeGreaterThanOrEqual(1);
    for (const f of verwacht) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  });
});

// Hele-dag-blokkeringen in "Plan deze week" (karakterisering van het filter `uitgesloten` in autoPlan, D21):
// een blokkering telt mee voor de gekozen technieker als ze globaal is of op zijn naam staat; die van een
// andere technieker en een feestdag doen het ook niet/wel. Gemeten bij VASTE_NU (maandag 5 okt), matrix 20 min:
// zonder blokkering staan beide Tim-tickets op maandag 5 okt.
const BLOK = (o) => ({ id: 'x', scope: 'global', person: null, date: '2026-10-05', kind: 'fullday', from: null, to: null, reason: '', ...o });
const metBlokkering = (...exceptions) => ({ availability: opslagStub({ versie: 1, exceptions }, 'exceptions') });

test.describe('plan deze week: hele-dag-blokkeringen', () => {
  test('blokkering op naam van Tim: maandag valt weg, beide tickets op dinsdag', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: metBlokkering(BLOK({ scope: 'person', person: 'Tim' })) });
    await klikPlanDezeWeek(page);
    const venster = resultaat(page);
    await expect(venster.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await expect(venster.getByText(/#1001 Laadpaal offline na stroomuitval → .*6 okt/)).toBeVisible();
    await expect(venster.getByText(/#1002 Controller reageert niet op OCPP commando → .*6 okt/)).toBeVisible();
  });

  test('globale blokkering: maandag valt weg, beide tickets op dinsdag', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: metBlokkering(BLOK({ scope: 'global' })) });
    await klikPlanDezeWeek(page);
    const venster = resultaat(page);
    await expect(venster.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await expect(venster.getByText(/#1001 Laadpaal offline na stroomuitval → .*6 okt/)).toBeVisible();
    await expect(venster.getByText(/#1002 Controller reageert niet op OCPP commando → .*6 okt/)).toBeVisible();
  });

  test('blokkering op naam van Roel: geen invloed op Tim, maandag blijft', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: metBlokkering(BLOK({ scope: 'person', person: 'Roel' })) });
    await klikPlanDezeWeek(page);
    const venster = resultaat(page);
    await expect(venster.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await expect(venster.getByText(/#1001 Laadpaal offline na stroomuitval → .*5 okt/)).toBeVisible();
    await expect(venster.getByText(/#1002 Controller reageert niet op OCPP commando → .*5 okt/)).toBeVisible();
  });

  test('feestdag (woensdag 11 nov, enige werkdag): geen beschikbare dagen', async ({ page }) => {
    await zetInstellingenTim(page, { werkdagen: [3] });
    await startApp(page, { technieker: 'Tim' });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    const venster = resultaat(page);
    await expect(venster.getByText('Geen beschikbare dagen meer deze week')).toBeVisible();
    await expect(venster.getByText(/Niet ingepland \(2\)/)).toBeVisible();
    await expect(venster.getByText(/Ingepland \(/)).toHaveCount(0);
  });
});
