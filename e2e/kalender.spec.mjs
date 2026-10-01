import { test, expect, startApp, opslagStub } from './helpers.mjs';

// Wat de kalender toont bij de vaste klok (maandag 5 okt 2026) en DUMMY_DATA:
//   wo 7 okt: #1004 (wacht op bevestiging, 08:30-11:30, gepland 09:00)
//   vr 9 okt: #1006 (bevestigd, 08:30-11:30, gepland 09:00)
// Daarbovenop zaaien we een eigen afspraak en een geblokkeerde dag via de nep-backend.
// Slepen in de kalender bestaat niet in de app (geen drag/drop-code buiten de route-tab): niet te testen.

const AFSPRAAK_WO = {
  id: 'a1', titel: 'Teamoverleg', datum: '2026-10-07', uur: '14:00', einduur: '15:30',
  type: 'Afspraak', persoon: null, adres: 'Kantoor Geel', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null,
};
const BLOKKADE_DO = {
  id: 'b1', scope: 'global', person: null, date: '2026-10-08', kind: 'fullday', from: null, to: null, reason: 'Verlof',
};

const seed = () => ({
  afspraken: opslagStub({ versie: 1, afspraken: [AFSPRAAK_WO] }, 'afspraken'),
  availability: opslagStub({ versie: 1, exceptions: [BLOKKADE_DO] }, 'exceptions'),
});
const dag = (page, datum) => page.locator(`.day-col[data-date="${datum}"]`);

test.describe('kalender: inhoud van een week', () => {
  test('dag met ticket en eigen afspraak: nummer, titel, tijden en volgorde', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#kal-label')).toContainText('5 okt – 11 okt');

    const woensdag = dag(page, '2026-10-07');
    const ticket = woensdag.locator('.tl-ticket[data-ticket-id="p1"]');
    await expect(ticket).toContainText('#1004');
    await expect(ticket).toContainText('Wacht bevestiging');
    await expect(ticket).toContainText('🕐 08:30–11:30 (gepland 09:00)');
    await expect(ticket).toContainText('Energiemeting klopt niet');
    await expect(ticket).toContainText('Koerselsesteenweg 88, 3580 Beringen');

    const afspraak = woensdag.locator('.tl-event');
    await expect(afspraak).toHaveCount(1);
    await expect(afspraak).toContainText('Teamoverleg');
    await expect(afspraak).toContainText('⏱ 14:00–15:30');
    await expect(afspraak).toContainText('Kantoor Geel');

    // Volgorde op de tijdlijn: ticket (09:00) staat boven de afspraak (14:00).
    const yTicket = (await ticket.boundingBox()).y;
    const yAfspraak = (await afspraak.boundingBox()).y;
    expect(yTicket).toBeLessThan(yAfspraak);

    // Positief tegenstuk: de afspraak staat alleen op woensdag, het ticket niet op vrijdag.
    await expect(page.locator('.tl-event')).toHaveCount(1);
    await expect(dag(page, '2026-10-09').getByText('Teamoverleg')).toHaveCount(0);
    await expect(dag(page, '2026-10-09').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(0);
    const vrijdag = dag(page, '2026-10-09').locator('.tl-ticket[data-ticket-id="g1"]');
    await expect(vrijdag).toContainText('#1006');
    await expect(vrijdag).toContainText('Bevestigd');
    await expect(vrijdag).toContainText('🕐 08:30–11:30 (gepland 09:00)');
  });

  test('geblokkeerde dag toont de blokkade', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const donderdag = dag(page, '2026-10-08');
    await expect(donderdag.getByText('🔒 Geblokkeerd')).toBeVisible();
    await expect(donderdag.getByRole('button', { name: '🔓 Blokkade beheren' })).toBeVisible();
    await expect(donderdag.locator('.day-body')).toHaveClass(/blocked-day/);
    // Positief tegenstuk: een niet-geblokkeerde dag toont de capaciteit en de gewone knop.
    const dinsdag = dag(page, '2026-10-06');
    await expect(dinsdag.getByText('🔒 Geblokkeerd')).toHaveCount(0);
    await expect(dinsdag.getByText('0/3 stops')).toBeVisible();
    await expect(dinsdag.getByRole('button', { name: '⏱ Beschikbaar' })).toBeVisible();
    await expect(dinsdag.locator('.day-body')).not.toHaveClass(/blocked-day/);
  });

  test('week vooruit en achteruit wijzigt de getoonde datums', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const label = page.locator('#kal-label');
    const datums = () => page.locator('.day-col[data-date]').evaluateAll(els => els.map(e => e.dataset.date));
    await expect(label).toContainText('5 okt – 11 okt');
    expect(await datums()).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);

    await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    await expect(label).toContainText('12 okt – 18 okt');
    expect(await datums()).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    // Niets van de vorige week blijft staan.
    await expect(page.locator('.tl-ticket')).toHaveCount(0);
    await expect(page.getByText('Teamoverleg')).toHaveCount(0);
    await expect(page.getByText('🔒 Geblokkeerd')).toHaveCount(0);

    await page.getByRole('button', { name: 'Vorige periode' }).first().click();
    await page.getByRole('button', { name: 'Vorige periode' }).first().click();
    await expect(label).toContainText('28 sep – 4 okt');
    expect(await datums()).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    await expect(page.locator('.tl-ticket')).toHaveCount(0);

    // Terug naar de oorspronkelijke week: de inhoud is er weer.
    await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    await expect(label).toContainText('5 okt – 11 okt');
    await expect(page.locator('.tl-ticket')).toHaveCount(2);
    await expect(page.getByText('Teamoverleg')).toBeVisible();
  });
});

test.describe('tab Ingepland', () => {
  test('toont de ingeplande tickets van de week en opent het detail', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await expect(page.locator('#cnt-gepland')).toHaveText('1');
    await page.getByRole('tab', { name: /Ingepland/ }).click();

    const lijst = page.locator('#gep-body');
    await expect(page.locator('#gep-label')).toHaveText('5 okt – 11 okt');
    await expect(lijst.getByText('vrijdag 9 oktober')).toBeVisible();
    const kaart = lijst.locator('.ticket');
    await expect(kaart).toHaveCount(1);
    await expect(kaart).toContainText('#1006');
    await expect(kaart).toContainText('Ingepland');
    await expect(kaart).toContainText('Periodiek onderhoud laadpalen');
    await expect(kaart).toContainText('Groenplaats 1, 2000 Antwerpen');
    // Een ticket uit de wachtrij staat hier niet.
    await expect(lijst.getByText('#1001')).toHaveCount(0);

    await kaart.click();
    const detail = page.getByRole('dialog', { name: /Periodiek onderhoud laadpalen/ });
    await expect(detail).toBeVisible();
    await expect(page.locator('#d-num')).toHaveText('#1006');
  });

  test('een andere week toont geen tickets', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: /Ingepland/ }).click();
    await expect(page.locator('#gep-body .ticket')).toHaveCount(1);
    await page.locator('#view-gepland').getByRole('button', { name: 'Volgende periode' }).click();
    await expect(page.locator('#gep-label')).toHaveText('12 okt – 18 okt');
    await expect(page.locator('#gep-body .ticket')).toHaveCount(0);
  });
});
