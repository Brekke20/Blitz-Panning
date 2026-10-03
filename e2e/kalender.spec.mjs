import { test, expect, startApp } from './helpers.mjs';
import { seed, dag, voegStopsToe, afspraak } from './kalender-hulp.mjs';

// Wat de kalender toont bij de vaste klok (maandag 5 okt 2026) en DUMMY_DATA:
//   wo 7 okt: #1004 (wacht op bevestiging, 08:30-11:30, gepland 09:00)
//   vr 9 okt: #1006 (bevestigd, 08:30-11:30, gepland 09:00)
// Daarbovenop zaaien we een eigen afspraak en een geblokkeerde dag via de nep-backend.
// Slepen in de kalender bestaat niet in de app (geen drag/drop-code buiten de route-tab): niet te testen.

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
    // Brent-besluit (proefperiode): 0/4 i.p.v. 0/3 (capaciteit = echte vrije tijd, begrensd door maxPerDag).
    await expect(dinsdag.getByText('0/4 stops')).toBeVisible();
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


// ══════════════════════════════════════════════════════════════════════════════
// Etappe 4, taak 1: karakterisering van de kalender-tab (week, maand, zonder uur, tijdlijn, panelen)
// en de Ingepland-tab. Alle verwachtingen beschrijven het gedrag van vóór de verhuizing.
// ══════════════════════════════════════════════════════════════════════════════

const voegAfsprakenToe = (page, lijst) => page.evaluate((l) => {
  kern.toestand.get('localEvents').push(...l);
  kern.toestand.raak('localEvents');
}, lijst);

const klikPlanDezeWeek = async (page) => {
  await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
  return page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
};
const volgende = (page) => page.getByRole('button', { name: 'Volgende periode' }).first();

test.describe('kalender: capaciteitskop per dag', () => {
  test('stops tellen mee in n/cap en ±uren; een volle dag krijgt class full', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const cap = dag(page, '2026-10-06').locator('.day-cap');
    // Brent-besluit (proefperiode): de capaciteit volgt de echte vrije tijd (aankomst 08:30, 11:00, 13:30, 16:00, begrensd door maxPerDag 4): 0/4 i.p.v. 0/3.
    await expect(cap).toHaveText('0/4 stops · ±0u');
    await expect(cap).not.toHaveClass(/full/);

    await voegStopsToe(page, [{ id: 'x1', nummer: '9001', datum: '2026-10-06', uur: '09:00' }]);
    // Gemeten: 1 stop van 3; ±(120 + 30) / 60 = 2,5 uur (echte vrije tijd: 2 extra tickets passen nog, dus cap 3).
    await expect(cap).toHaveText('1/3 stops · ±2.5u');
    await expect(cap).not.toHaveClass(/full/);

    await voegStopsToe(page, [
      { id: 'x2', nummer: '9002', datum: '2026-10-06', uur: '12:00' },
      { id: 'x3', nummer: '9003', datum: '2026-10-06', uur: '15:00' },
    ]);
    await expect(cap).toHaveText('3/3 stops · ±7.5u');
    await expect(cap).toHaveClass(/full/);
  });

  test('tijdvak-blokkade verlaagt de capaciteit; een hele-dag-blokkade toont het slot', async ({ page }) => {
    const bereik = { id: 'b2', scope: 'global', person: null, date: '2026-10-06', kind: 'range', from: '10:00', to: '17:00', reason: 'Opleiding' };
    await startApp(page, { overschrijf: seed({ blokkades: [bereik] }) });
    await page.getByRole('tab', { name: 'Kalender' }).click();

    // Gemeten: 08:00-17:00 min 10:00-17:00 = 120 min < 150 per stop, dus capaciteit 0.
    const dinsdag = dag(page, '2026-10-06');
    await expect(dinsdag.locator('.day-cap')).toHaveText('0/0 stops · ±0u');
    await expect(dinsdag.locator('.day-block-btn')).toHaveText('⏱ 1 uitzondering');
    await expect(dinsdag.locator('.day-body')).not.toHaveClass(/blocked-day/);

    // Hele dag (donderdag, uit de seed): slot in kop en knop.
    const donderdag = dag(page, '2026-10-08');
    await expect(donderdag.locator('.day-cap')).toHaveText('🔒 Geblokkeerd');
    await expect(donderdag.locator('.day-cap')).toHaveClass(/full/);
    await expect(donderdag.locator('.day-block-btn')).toHaveText('🔓 Blokkade beheren');
  });

  test('een tijdvak van een andere persoon telt niet mee voor de gekozen technieker', async ({ page }) => {
    const roel = { id: 'b3', scope: 'person', person: 'Roel', date: '2026-10-06', kind: 'range', from: '10:00', to: '17:00', reason: '' };
    await startApp(page, { technieker: 'Tim', overschrijf: seed({ blokkades: [roel] }) });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const dinsdag = dag(page, '2026-10-06');
    // Brent-besluit (proefperiode): 0/4 i.p.v. 0/3 (echte vrije tijd, zie hierboven).
    await expect(dinsdag.locator('.day-cap')).toHaveText('0/4 stops · ±0u');
    await expect(dinsdag.locator('.day-block-btn')).toHaveText('⏱ Beschikbaar');
  });

  test('een feestdag toont de naam in kop en knop en kleurt de dag', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    for (let i = 0; i < 5; i++) await volgende(page).click();
    await expect(page.locator('#kal-label')).toContainText('9 nov – 15 nov');
    const woensdag = dag(page, '2026-11-11');
    await expect(woensdag.locator('.day-cap')).toHaveText('🎌 Wapenstilstand');
    await expect(woensdag.locator('.day-block-btn')).toHaveText('🎌 Wapenstilstand');
    await expect(woensdag.locator('.day-block-btn')).toHaveClass(/holiday/);
    await expect(woensdag.locator('.day-body')).toHaveClass(/holiday-day/);
    // Positief tegenstuk: de dag ervoor is gewoon.
    await expect(dag(page, '2026-11-10').locator('.day-body')).not.toHaveClass(/holiday-day/);
  });
});

test.describe('kalender: weergavewissel week en maand', () => {
  test('maandweergave: raster, chips, +N meer, navigatie en terug naar week', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const weekKnop = page.locator('#kal-view-week'), maandKnop = page.locator('#kal-view-month');
    await expect(weekKnop).toHaveAttribute('aria-pressed', 'true');
    await expect(maandKnop).toHaveAttribute('aria-pressed', 'false');

    await voegAfsprakenToe(page, [1, 2, 3, 4, 5].map(n => ({
      id: `m${n}`, titel: `Meerdaags ${n}`, datum: '2026-10-06', uur: `0${n}:00`, einduur: `0${n}:30`,
      type: 'Afspraak', persoon: null, adres: '', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null,
    })));
    await maandKnop.click();
    await expect(maandKnop).toHaveAttribute('aria-pressed', 'true');
    await expect(weekKnop).toHaveAttribute('aria-pressed', 'false');
    await expect(maandKnop).toHaveClass(/active/);
    await expect(page.locator('#kal-label-tekst')).toHaveText('Oktober 2026');
    await expect(page.locator('#week-grid')).toHaveClass(/month-grid/);
    await expect(page.locator('.month-cell')).toHaveCount(42);
    await expect(page.locator('.month-dow-hdr')).toHaveText(['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']);

    // Vandaag (5 okt) is gemarkeerd.
    await expect(page.locator('.today-cell')).toHaveCount(1);
    await expect(page.locator('.today-cell .month-cell-num')).toHaveText('5');

    // Chips: wacht-bevestiging-ticket, bevestigd ticket, eigen afspraak (met tijdprefix), blokkade.
    await expect(page.locator('.month-chip.pending')).toHaveCount(1);
    await expect(page.locator('.month-chip.pending')).toContainText('#1004 Energiemeting klopt niet');
    await expect(page.locator('.month-chip.confirmed')).toContainText('#1006 Periodiek onderhoud laadpalen');
    await expect(page.locator('.month-chip.local').filter({ hasText: 'Teamoverleg' })).toHaveText('14:00 Teamoverleg');
    await expect(page.locator('.month-chip.blocked')).toHaveText('🔒 Geblokkeerd');

    // Vijf eigen afspraken op één dag: vier chips en "+1 meer".
    const dinsdag = page.locator('.month-cell').filter({ has: page.locator('.month-cell-num', { hasText: /^6$/ }) }).first();
    await expect(dinsdag.locator('.month-chip')).toHaveCount(4);
    await expect(dinsdag.locator('.month-more')).toHaveText('+1 meer');

    // › gaat een maand verder, de label-knop brengt terug naar vandaag.
    await volgende(page).click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('November 2026');
    await expect(page.locator('.month-cell')).toHaveCount(42);
    await expect(page.locator('.today-cell')).toHaveCount(0);
    await page.locator('#kal-label').click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('Oktober 2026');

    // Brent-verzoek (proefperiode): wisselen van weergave behoudt de gedeelde gekozen datum (5 nov na een maand verder), dus de
    // weekweergave toont de week van die datum (2 nov – 8 nov) in plaats van terug te springen naar de huidige week.
    await volgende(page).click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('November 2026');
    await weekKnop.click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('2 nov – 8 nov');
    await expect(weekKnop).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.month-cell')).toHaveCount(0);
    await expect(page.locator('#week-grid')).toHaveClass(/tl-mode/);
  });
});

test.describe('kalender: items zonder uur', () => {
  test('na Plan deze week staan #1001 en #1002 als chips in de dagkop; een klik opent het detail', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const resultaat = await klikPlanDezeWeek(page);
    await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await resultaat.getByRole('button', { name: 'Sluiten' }).click();
    await expect(resultaat).toBeHidden();

    const chips = dag(page, '2026-10-05').locator('.day-hdr-zonderuur .zu-chip');
    await expect(chips).toHaveText(['#1001', '#1002']);
    await expect(dag(page, '2026-10-05').locator('.zu-label')).toHaveText('Zonder uur:');
    await expect(chips.first()).toHaveAttribute('title', 'Laadpaal offline na stroomuitval');
    // Zonder uur zijn het geen tijdlijnblokken.
    await expect(dag(page, '2026-10-05').locator('.tl-ticket')).toHaveCount(0);

    await chips.first().click();
    await expect(page.locator('#d-num')).toHaveText('#1001');
  });

  test('vijf stops zonder uur: vier chips en "+1 meer" met de rest in de titel', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await voegStopsToe(page, [1, 2, 3, 4, 5].map(n => ({ id: `z${n}`, nummer: `900${n}`, datum: '2026-10-06' })));
    const kop = dag(page, '2026-10-06').locator('.day-hdr-zonderuur');
    await expect(kop.locator('.zu-chip')).toHaveText(['#9001', '#9002', '#9003', '#9004']);
    await expect(kop.locator('.zu-meer')).toHaveText('+1 meer');
    await expect(kop.locator('.zu-meer')).toHaveAttribute('title', '#9005');
  });
});

test.describe('kalender: tijdlijn', () => {
  test('overlappende afspraken staan in twee lanen', async ({ page }) => {
    const afspraken = [afspraak('o1', '2026-10-06', '14:00', '15:30'), afspraak('o2', '2026-10-06', '15:00', '16:00')];
    await startApp(page, { overschrijf: seed({ afspraken }) });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const events = dag(page, '2026-10-06').locator('.tl-event');
    await expect(events).toHaveCount(2);
    // Gemeten: de browser normaliseert de calc()-waarden uit de code (laanbreedte (100% - 12px) / 2 - 2px).
    for (const i of [0, 1]) await expect(events.nth(i)).toHaveAttribute('style', /width: calc\(50% - 8px\)/);
    // De twee lanen: de eerste links, de tweede rechts ervan.
    await expect(events.nth(0)).toHaveAttribute('style', /left: calc\(0% \+ 6px\)/);
    await expect(events.nth(1)).toHaveAttribute('style', /left: calc\(50% \+ 0px\)/);
    // Positief tegenstuk: een enkele afspraak (woensdag) krijgt geen laanbreedte.
    await expect(dag(page, '2026-10-07').locator('.tl-event')).not.toHaveAttribute('style', /width/);
  });

  test('een late afspraak blijft binnen de tijdlijn; buiten-werkurenbanden; rode nu-lijn; gridhoogte', async ({ page }) => {
    const laat = afspraak('l1', '2026-10-06', '23:30', '23:59');
    await startApp(page, { overschrijf: seed({ afspraken: [laat] }) });
    await page.getByRole('tab', { name: 'Kalender' }).click();

    const dinsdag = dag(page, '2026-10-06');
    const wrap = dinsdag.locator('.tl-wrap');
    // Gemeten: 1440 min x 1,3 px = 1872 px.
    await expect(wrap).toHaveCSS('height', '1872px');
    const blok = dinsdag.locator('.tl-event');
    await expect(blok).toHaveCount(1);
    const { top, hoogte } = await blok.evaluate(el => ({ top: parseFloat(el.style.top), hoogte: parseFloat(el.style.height) }));
    expect(top + hoogte).toBeLessThanOrEqual(1872);
    // Gemeten: minimale blokhoogte 155 px, dus top = 1872 - 155.
    expect(hoogte).toBe(155);
    expect(top).toBe(1872 - 155);

    // Twee donkere banden per dagkolom (voor 08:30 en vanaf 17:00).
    await expect(dinsdag.locator('.tl-offhours')).toHaveCount(2);

    // De rode nu-lijn staat enkel in de kolom van vandaag, met het uur als label.
    await expect(page.locator('.tl-now')).toHaveCount(1);
    await expect(dag(page, '2026-10-05').locator('.tl-now .tl-now-label')).toHaveText(/^09:\d\d$/);
    await expect(dinsdag.locator('.tl-now')).toHaveCount(0);

    // Het grid krijgt een inline hoogte in px (minstens 400).
    const gridHoogte = await page.locator('#week-grid').evaluate(el => el.style.height);
    expect(gridHoogte).toMatch(/^\d+px$/);
    expect(parseInt(gridHoogte, 10)).toBeGreaterThanOrEqual(400);
  });
});

test.describe('kalender: zonder-datum-paneel', () => {
  test('pil met aantal, paneel openen en sluiten, kaart opent het detail', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const pil = page.locator('#kal-pending-pill');
    const paneel = page.locator('#kal-no-date-section');
    await expect(pil).toBeVisible();
    await expect(page.locator('#kal-pending-count')).toHaveText('1');
    await expect(pil).toHaveAttribute('aria-expanded', 'false');
    await expect(paneel).not.toHaveClass(/open/);

    await pil.click();
    await expect(pil).toHaveAttribute('aria-expanded', 'true');
    await expect(paneel).toHaveClass(/open/);
    await expect(paneel.locator('.kal-pending-hdr')).toHaveText('Wacht bevestiging — zonder datum');
    const kaart = paneel.locator('.ticket');
    await expect(kaart).toHaveCount(1);
    await expect(kaart).toContainText('#1005');
    await expect(kaart).toContainText('Wacht bevestiging');
    await expect(kaart).toContainText('Firmware update mislukt');

    await kaart.locator('.tsub').click();
    await expect(page.locator('#d-num')).toHaveText('#1005');
    await page.keyboard.press('Escape');
    await expect(page.locator('#d-num')).toBeHidden();

    await pil.click();
    await expect(pil).toHaveAttribute('aria-expanded', 'false');
    await expect(paneel).not.toHaveClass(/open/);
  });

  test('Toewijzen klapt de rij uit zonder het detail te openen; Sluiten verbergt ze', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.locator('#kal-pending-pill').click();
    const rij = page.locator('#assign-row-p2');
    await expect(rij).toBeHidden();

    await page.getByRole('button', { name: '📅 Toewijzen' }).click();
    await expect(rij).toBeVisible();
    await expect(page.locator('#assign-date-p2')).toHaveValue('2026-10-05');
    // Een klik op Toewijzen opent het detail niet.
    await expect(page.locator('#d-num')).toBeHidden();

    await rij.getByRole('button', { name: 'Sluiten' }).click();
    await expect(rij).toBeHidden();
    await expect(page.locator('#d-num')).toBeHidden();
  });
});

test.describe('kalender: uit planning halen met ✕', () => {
  const kruis = (page) => dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-unplan-x');

  test('bevestigen: blok weg, ticket terug in de wachtrij; het detail opent niet', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    await kruis(page).click();

    const bevestig = page.getByRole('alertdialog', { name: 'Ticket #1004 uit de planning halen?' });
    await expect(bevestig).toBeVisible();
    await expect(page.locator('#d-num')).toBeHidden();
    await bevestig.getByRole('button', { name: 'Uit planning halen' }).click();

    await expect(dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(0);
    await expect(page.locator('#cnt-tickets')).toHaveText('4');
    await expect(page.locator('#d-num')).toBeHidden();
    await page.getByRole('tab', { name: /Wachtrij/ }).click();
    await expect(page.locator('#ticket-list .ticket').filter({ hasText: '#1004' })).toHaveCount(1);
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });

  test('annuleren laat alles staan', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await kruis(page).click();
    const bevestig = page.getByRole('alertdialog', { name: 'Ticket #1004 uit de planning halen?' });
    await expect(bevestig).toBeVisible();
    await bevestig.getByRole('button', { name: 'Terug' }).click();
    await expect(bevestig).toBeHidden();

    await expect(dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(1);
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    await expect(page.locator('#d-num')).toBeHidden();
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });
});

test.describe('kalender: Plan deze week volgt de getoonde week (spec C13)', () => {
  test('weekweergave: na › naar 12-18 okt wordt die week gepland', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await volgende(page).click();
    await expect(page.locator('#kal-label')).toContainText('12 okt – 18 okt');

    const resultaat = await klikPlanDezeWeek(page);
    await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await expect(resultaat.getByText(/#1001 Laadpaal offline na stroomuitval → .*12 okt/)).toBeVisible();
    await expect(resultaat.getByText(/#1002 Controller reageert niet op OCPP commando → .*12 okt/)).toBeVisible();
    await resultaat.getByRole('button', { name: 'Sluiten' }).click();

    // De getoonde week heeft de tickets; de huidige week niet.
    await expect(dag(page, '2026-10-12').locator('.zu-chip')).toHaveText(['#1001', '#1002']);
    await page.getByRole('button', { name: 'Vorige periode' }).first().click();
    await expect(page.locator('#kal-label')).toContainText('5 okt – 11 okt');
    await expect(page.locator('.zu-chip').filter({ hasText: /#100[12]/ })).toHaveCount(0);

    // Het matrix-verzoek (reistijd tussen de twee stops) bevat de bestemming van #1002.
    const matrix = verzoeken.van('/api/matrix', 'POST');
    expect(matrix.length).toBeGreaterThanOrEqual(1);
    expect(matrix[0].body.destinations).toEqual([{ lat: 50.9307, lon: 5.3325 }]);
  });

  // Brent-verzoek (proefperiode): "Plan deze week" plant de week van de gedeelde gekozen datum. In de maandweergave is dat de week
  // waarin de gekozen dag valt (niet langer "een maand = een week", C3/B15), met een melding. Eén maand verder = 5 nov -> week van 2-8 nov.
  test('maandweergave: één maand verder wordt de week van de gekozen dag (2-8 nov) gepland, met melding', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.locator('#kal-view-month').click();
    await volgende(page).click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('November 2026');

    const resultaat = await klikPlanDezeWeek(page);
    await expect(resultaat).toContainText('Maandweergave: je plant de week van'); // in het resultaatvenster (een toast kon overschreven worden)
    await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await expect(resultaat.getByText(/#1001 Laadpaal offline na stroomuitval → .*2 nov/)).toBeVisible();
    await expect(resultaat.getByText(/#1002 Controller reageert niet op OCPP commando → .*2 nov/)).toBeVisible();
  });

  test('Route-tab: een andere dag kiezen en "Plan deze week" plant de week van die dag', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByTestId('route-datum').fill('2026-10-14');
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#kal-label')).toContainText('12 okt – 18 okt');
    const resultaat = await klikPlanDezeWeek(page);
    await expect(resultaat.getByText(/#1001 Laadpaal offline na stroomuitval → .*12 okt/)).toBeVisible();
  });
});

test.describe('tab Ingepland: details', () => {
  test('tijdregel met tijdslot en geplande tijd; contactknoppen openen het detail niet', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    // Telefoon in Belgische notatie: "(0)" valt weg in de tel:-link.
    await page.evaluate(() => {
      kern.toestand.get('allGepland')[0].telefoonEindklant = '+32 (0)479 56 78 90';
      kern.toestand.raak('allGepland');
    });
    await page.getByRole('tab', { name: /Ingepland/ }).click();
    const kaart = page.locator('#gep-body .ticket');
    await expect(kaart).toHaveCount(1);
    await expect(kaart).toContainText('🕐 08:30–11:30 (gepland 09:00)');

    const bel = kaart.locator('.contact-acties a[href^="tel:"]');
    await expect(bel).toHaveAttribute('href', 'tel:+32479567890');
    const mail = kaart.locator('.contact-acties a[href^="mailto:"]');
    await expect(mail).toHaveAttribute('href', 'mailto:peter@test.be');
    // Navigeer: window.open wordt gestubd, zodat er niets de pagina verlaat.
    await page.evaluate(() => { window.__open = []; window.open = (u) => { window.__open.push(u); return null; }; });
    const navigeer = kaart.locator('.btn-navigeer-groot');
    await expect(navigeer).toHaveAttribute('data-adres', 'Groenplaats 1, 2000 Antwerpen');
    await navigeer.click();
    // Het navigatie-effect gebeurde (kaart-URL met het geëncodeerde adres) en het detail opent niet (C8).
    await expect.poll(() => page.evaluate(() => window.__open)).toHaveLength(1);
    expect((await page.evaluate(() => window.__open))[0]).toContain('destination=' + encodeURIComponent('Groenplaats 1, 2000 Antwerpen'));
    await expect(page.locator('#d-num')).toBeHidden();

    // Echt navigeren naar tel:/mailto: voorkomen; de stopPropagation van de knoppen zelf blijft intact.
    await page.evaluate(() => document.addEventListener('click', e => e.preventDefault(), true));
    await bel.click();
    await mail.click();
    await expect(page.locator('#d-num')).toBeHidden();
    // Positief tegenstuk: de kaart zelf opent het detail wel.
    await kaart.locator('.tsub').click();
    await expect(page.locator('#d-num')).toHaveText('#1006');
  });

  test('een lege week toont de lege tekst; de badge blijft het gefilterde totaal', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: /Ingepland/ }).click();
    await expect(page.locator('#cnt-gepland')).toHaveText('1');
    await page.locator('#view-gepland').getByRole('button', { name: 'Volgende periode' }).click();
    await expect(page.locator('#gep-label')).toHaveText('12 okt – 18 okt');
    await expect(page.locator('#gep-body .empty')).toHaveText('Geen geplande service deze week');
    await expect(page.locator('#cnt-gepland')).toHaveText('1');
  });

  test('technieker zonder geplande tickets: lege lijst en badge 0', async ({ page }) => {
    await startApp(page, { technieker: 'Roel', overschrijf: seed() });
    await expect(page.locator('#cnt-gepland')).toHaveText('0');
    await page.getByRole('tab', { name: /Ingepland/ }).click();
    await expect(page.locator('#gep-body .ticket')).toHaveCount(0);
    await expect(page.locator('#gep-body .empty')).toHaveText('Geen geplande service deze week');
    await expect(page.locator('#cnt-gepland')).toHaveText('0');
  });
});

test.describe('kalender: ✕ op een eigen afspraak (data-actie, etappe 4)', () => {
  test('✕ verwijdert de afspraak (PUT met het id) en opent het detail niet', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const kaart = dag(page, '2026-10-07').locator('.cal-local-event');
    await expect(kaart).toHaveCount(1);
    await kaart.locator('.cal-local-del').click();
    await expect(dag(page, '2026-10-07').locator('.cal-local-event')).toHaveCount(0);
    await expect.poll(() => verzoeken.van('/api/afspraken', 'PUT').length).toBe(1);
    expect(verzoeken.van('/api/afspraken', 'PUT')[0].body.afspraken.map(a => a.id)).not.toContain('a1');
    await expect(page.locator('#local-det-overlay')).not.toHaveClass(/open/);
  });
});

// Eén klik op ‹ ›, of op het label (Vandaag), verschuift de weergave precies één keer (geen dubbele handler:
// de statische onclick-knoppen zijn vervangen door data-actie-delegatie).
test.describe('kalender: navigatie verschuift precies één keer per klik', () => {
  test('› volgende week, ‹ vorige week, label brengt terug naar vandaag', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const label = page.locator('#kal-label-tekst');
    await expect(label).toHaveText('5 okt – 11 okt');

    await volgende(page).click();
    await expect(label).toHaveText('12 okt – 18 okt'); // een dubbele handler gaf '19 okt – 25 okt'
    await rust(page);
    await expect(label).toHaveText('12 okt – 18 okt');

    await vorigeKnop(page).click();
    await expect(label).toHaveText('5 okt – 11 okt');
    await vorigeKnop(page).click();
    await expect(label).toHaveText('28 sep – 4 okt'); // een dubbele handler gaf '21 sep – 27 sep'
    await rust(page);
    await expect(label).toHaveText('28 sep – 4 okt');

    // kal-vandaag zet de offset op 0 en is dus idempotent: een dubbele handler blijkt niet uit het label. Start daarom
    // vanaf een verschoven week (twee klikken voorbij de huidige: landt weer exact op de huidige week) en tel de hertekeningen: precies één per klik.
    await volgende(page).click();
    await volgende(page).click();
    await expect(label).toHaveText('12 okt – 18 okt'); // vanaf 28 sep: twee stappen vooruit
    await rust(page);
    const voor = await page.evaluate(() => kern.kalender.renderTelling());
    await page.locator('#kal-label').click();
    await expect(label).toHaveText('5 okt – 11 okt');
    await rust(page);
    expect(await page.evaluate(() => kern.kalender.renderTelling()) - voor).toBe(1);
  });
});
const vorigeKnop = (page) => page.getByRole('button', { name: 'Vorige periode' }).first();
const rust = (page) => page.evaluate(() => new Promise((klaar) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const kanaal = new MessageChannel();
    kanaal.port1.onmessage = () => klaar(true);
    kanaal.port2.postMessage(0);
  }));
}));
