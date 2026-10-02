import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// Karakterisering (etappe 5a, taak 4) van het vensterbeheer (public/js/venster.js) per dialoog, vóór
// ticketdetail, voorstel en annuleren zelf registreren (taak 5-8). Alles in ?test.
//
// Per overlay: (a) de focus staat bij openen binnen het venster, op de eerste knop (nooit een tekstveld);
// (b) Tab vanaf het laatste focusbare element springt naar het eerste, Shift+Tab omgekeerd; (c) Escape sluit
// en de focus keert terug naar de opener; (d) een klik op de achtergrond sluit, een klik in de inhoud niet.
//
// NIET bereikbaar in deze suite:
//  - annuleer-overlay: de enige route is /api/annuleer (verboden pad, E12); dit staat in e2e/productie/annuleren.spec.mjs.
//  - rapport-preview-overlay: opent enkel buiten ?test (voorbeeldRapport roept in testmodus meteen verstuurRapport aan); komt in 5b-1.
//  - app-dialog (appConfirm): heeft zijn eigen Escape en Tab (app-dialog.js) en valt buiten venster.js.

const FOCUSBAAR = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Opent #1004 (ingepland op woensdag 7 okt) vanuit de kalender; het detail is dan open.
async function open1004(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
  await expect(page.locator('#det-overlay')).toHaveClass(/open/);
}
const kalenderTab = (page) => page.getByRole('tab', { name: 'Kalender' }).click();
const instellingen = (page) => page.getByRole('button', { name: 'Instellingen', exact: true });

// Tabel: [overlayId, opener, focusNaSluiten, opties]. `opener(page)` opent het venster en geeft de aangeklikte opener terug.
// `focusNa`: 'opener' = de opener krijgt de focus terug; 'body' = de focus is weg; anders een locator-functie.
const VENSTERS = [
  { id: 'det-overlay', opener: async (page) => { const o = page.getByRole('button', { name: 'Open ticket #1001' }); await o.click(); return o; }, focusNa: 'opener' },
  { id: 'reschedule-overlay', opener: async (page) => { await open1004(page); const o = page.locator('#d-btn-reschedule'); await o.click(); return o; }, focusNa: 'opener' },
  { id: 'set-overlay', opener: async (page) => { const o = instellingen(page); await o.click(); return o; }, focusNa: 'opener' },
  { id: 'block-overlay', opener: async (page) => { await kalenderTab(page); const o = page.locator('.day-col[data-date="2026-10-07"] .day-block-btn'); await o.click(); return o; }, focusNa: 'opener' },
  // HUIDIG GEDRAG (bug?): de opener (📨 Voorstel in het detail) staat in het detail dat openProposal stil sluit;
  // een onzichtbare opener krijgt geen focus terug, dus de focus valt naar <body>.
  { id: 'proposal-overlay', huidig: true, opener: async (page) => { await open1004(page); const o = page.locator('#d-btn-proposal'); await o.click(); return o; }, focusNa: 'body' },
  { id: 'manueel-overlay', opener: async (page) => { await kalenderTab(page); const o = page.getByRole('button', { name: '➕ Afspraak' }); await o.click(); return o; }, focusNa: 'opener' },
  // HUIDIG GEDRAG (bug?): de opener is een niet-focusbare div (.cal-local-event); er was geen focus om terug te zetten,
  // de focus belandt op <main id="hoofdinhoud"> (die kreeg hem bij de klik).
  { id: 'local-det-overlay', huidig: true, opener: async (page) => { await kalenderTab(page); const o = page.locator('.day-col[data-date="2026-10-07"] .cal-local-event'); await o.click(); return o; }, focusNa: (page) => page.locator('#hoofdinhoud') },
  { id: 'foto-overlay', opener: async (page) => { await open1004(page); const o = page.locator('#d-btn-fotos'); await o.click(); return o; }, focusNa: 'opener' },
  // HUIDIG GEDRAG (bug?): openPrijsBeheer() sluit eerst de instellingen, waar de opener (💰 Prijzen) in staat; focus naar <body>.
  { id: 'prijs-overlay', nativeConfirm: true, huidig: true, opener: async (page) => { await instellingen(page).click(); const o = page.locator('#set-overlay .mftr button', { hasText: 'Prijzen' }); await o.click(); return o; }, focusNa: 'body' },
  // Het detail (met 📋 Rapport) is gesloten bij het openen; de focus valt terug op de kaart in de kalender waar het detail mee opende.
  { id: 'rapport-wizard', nativeConfirm: true, opener: async (page) => { await open1004(page); const o = page.locator('#d-btn-rapport'); await o.click(); return o; }, focusNa: (page) => page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }), geenOverlay: true },
  // HUIDIG GEDRAG (bug?): autoPlan zet de knop tijdens het plannen uit (focus weg) voor het resultaat opent: focus naar <body>.
  { id: 'result-overlay', huidig: true, technieker: 'Tim', opener: async (page) => { await kalenderTab(page); const o = page.getByRole('button', { name: '⚡ Plan deze week' }); await o.click(); return o; }, focusNa: 'body' },
  {
    id: 'import-overlay',
    opener: async (page) => {
      await kalenderTab(page);
      const o = page.getByRole('button', { name: '📥 Import' });
      await o.focus();
      const bestand = [{ titel: 'Import X', datum: '2026-10-08', uur: '09:00', einduur: '10:00', type: 'Installatie', resp: 'Tim' }];
      await page.locator('#import-file-input').setInputFiles({ name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bestand)) });
      return o;
    },
    focusNa: 'opener',
  },
];

const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).classList.contains('open'), id);
const focusInfo = (page, id) => page.evaluate(({ i, sel }) => {
  const el = document.getElementById(i);
  const zicht = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const lijst = [...el.querySelectorAll(sel)].filter(zicht);
  return { index: lijst.indexOf(document.activeElement), aantal: lijst.length, binnen: el.contains(document.activeElement) && document.activeElement !== el };
}, { i: id, sel: FOCUSBAAR });
const focusOpLaatste = (page, id) => page.evaluate(({ i, sel }) => {
  const el = document.getElementById(i);
  const zicht = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const lijst = [...el.querySelectorAll(sel)].filter(zicht);
  lijst[lijst.length - 1].focus();
}, { i: id, sel: FOCUSBAAR });
const focusOpEerste = (page, id) => page.evaluate(({ i, sel }) => {
  const el = document.getElementById(i);
  const zicht = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  [...el.querySelectorAll(sel)].filter(zicht)[0].focus();
}, { i: id, sel: FOCUSBAAR });

async function startVoorVenster(page, v) {
  // Enkel de wizard en prijsbeheer vragen een bevestiging via de native confirm (hier geaccepteerd).
  // Voor elk ander venster is een native dialoog onverwacht: genoteerd, en de test faalt erop.
  const onverwacht = [];
  if (v.nativeConfirm) page.on('dialog', d => d.accept());
  else page.on('dialog', d => { onverwacht.push(d.message()); d.dismiss(); });
  await startApp(page, { overschrijf: seed(), technieker: v.technieker ?? 'all' });
  return onverwacht;
}

test.describe('vensters: focus en Escape per dialoog', () => {
  for (const v of VENSTERS) {
    test(`${v.id}: focus bij openen, Tab-val, Escape sluit en zet de focus terug${v.huidig ? ' [HUIDIG GEDRAG (bug?): focus na Escape niet bij de opener]' : ''}`, async ({ page }) => {
      const onverwacht = await startVoorVenster(page, v);
      const opener = await v.opener(page);
      await expect.poll(() => isOpen(page, v.id)).toBe(true);

      // (a) de focus staat in het venster, op de eerste knop ("Sluiten"), nooit op een tekstveld.
      await expect.poll(async () => (await focusInfo(page, v.id)).binnen).toBe(true);
      const actief = await page.evaluate(() => ({ tag: document.activeElement.tagName, label: document.activeElement.getAttribute('aria-label') }));
      expect(actief).toEqual({ tag: 'BUTTON', label: 'Sluiten' });
      expect((await focusInfo(page, v.id)).index).toBe(0);

      // (b) Tab vanaf het laatste element springt naar het eerste; Shift+Tab vanaf het eerste naar het laatste.
      const { aantal } = await focusInfo(page, v.id);
      // Gemeten: het planningsresultaat heeft enkel "Sluiten" als focusbaar element; alle andere vensters meer.
      expect(aantal).toBeGreaterThanOrEqual(1);
      expect(aantal === 1).toBe(v.id === 'result-overlay');
      await focusOpLaatste(page, v.id);
      await page.keyboard.press('Tab');
      expect((await focusInfo(page, v.id)).index).toBe(0);
      await focusOpEerste(page, v.id);
      await page.keyboard.press('Shift+Tab');
      const na = await focusInfo(page, v.id);
      expect(na.index).toBe(na.aantal - 1);
      // Tab vanaf een middenelement blijft binnen het venster (de val laat de gewone volgorde met rust).
      await focusOpEerste(page, v.id);
      await page.keyboard.press('Tab');
      expect((await focusInfo(page, v.id)).index).toBe(aantal > 1 ? 1 : 0);

      // (c) Escape sluit het venster (de wizard en prijsbeheer vragen eerst een bevestiging: hier geaccepteerd).
      await page.keyboard.press('Escape');
      await expect.poll(() => isOpen(page, v.id)).toBe(false);
      if (v.focusNa === 'opener') await expect(opener).toBeFocused();
      else if (v.focusNa === 'body') await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
      else await expect(v.focusNa(page)).toBeFocused();
      expect(onverwacht).toEqual([]);
    });

    test(`${v.id}: achtergrondklik en klik in de inhoud`, async ({ page }) => {
      const onverwacht = await startVoorVenster(page, v);
      await v.opener(page);
      await expect.poll(() => isOpen(page, v.id)).toBe(true);

      if (v.geenOverlay) {
        // De rapportwizard is zelf het schermvullende venster: er is geen achtergrond om op te klikken.
        // Een klik in de inhoud sluit niet.
        await page.locator('#wiz-body').click({ position: { x: 5, y: 5 } });
        expect(await isOpen(page, v.id)).toBe(true);
        return;
      }
      const overlay = page.locator('#' + v.id);
      // Klik in de inhoud (linksboven in het venster zelf): sluit niet.
      await overlay.locator('[role="dialog"]').first().click({ position: { x: 6, y: 6 } });
      expect(await isOpen(page, v.id)).toBe(true);
      // Klik op de achtergrond (de overlay zelf): sluit.
      await overlay.click({ position: { x: 4, y: 4 } });
      await expect.poll(() => isOpen(page, v.id)).toBe(false);
      expect(onverwacht).toEqual([]);
    });
  }
});

test.describe('vensters: bevestiging bij sluiten', () => {
  test('rapportwizard: Escape vraagt bevestiging (native confirm); weigeren houdt de wizard open', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open1004(page);
    await page.locator('#d-btn-rapport').click();
    await expect(page.locator('#rapport-wizard')).toHaveClass(/open/);

    const berichten = [];
    page.once('dialog', async d => { berichten.push(d.message()); await d.dismiss(); });
    await page.keyboard.press('Escape');
    await expect.poll(() => berichten).toEqual(['Rapport sluiten? Je concept blijft bewaard.']);
    expect(await isOpen(page, 'rapport-wizard')).toBe(true);

    page.once('dialog', async d => { berichten.push(d.message()); await d.accept(); });
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'rapport-wizard')).toBe(false);
    expect(berichten).toHaveLength(2);
  });

  test('prijsbeheer: zonder wijziging sluit Escape meteen; met wijziging vraagt het een bevestiging', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await instellingen(page).click();
    await page.locator('#set-overlay .mftr button', { hasText: 'Prijzen' }).click();
    await expect(page.locator('#prijs-overlay')).toHaveClass(/open/);

    // Zonder wijziging: geen dialoog.
    const berichten = [];
    page.on('dialog', async d => { berichten.push(d.message()); await d.dismiss(); });
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'prijs-overlay')).toBe(false);
    expect(berichten).toEqual([]);

    // Met wijziging (markDirty uit prijzen.js): bevestiging; weigeren houdt het venster open.
    await instellingen(page).click();
    await page.locator('#set-overlay .mftr button', { hasText: 'Prijzen' }).click();
    await expect(page.locator('#prijs-overlay')).toHaveClass(/open/);
    await page.evaluate(async () => { (await import('/js/prijzen.js')).markDirty(); });
    await page.keyboard.press('Escape');
    await expect.poll(() => berichten).toEqual(['Je hebt onopgeslagen wijzigingen. Toch sluiten?']);
    expect(await isOpen(page, 'prijs-overlay')).toBe(true);
    page.removeAllListeners('dialog');
    page.once('dialog', d => d.accept());
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'prijs-overlay')).toBe(false);
  });

  test('detail met ongeopgeslagen klantbeschikbaarheid: Escape toont de app-dialoog; Escape erin sluit enkel de dialoog', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const detail = page.locator('#det-overlay');
    await expect(detail).toHaveClass(/open/);
    await page.getByLabel('Datum waarop de klant niet kan').fill('2026-10-09');
    await page.getByRole('button', { name: '+ Datum toevoegen' }).click();

    await page.keyboard.press('Escape');
    const dialoog = page.getByRole('alertdialog', { name: 'Niet-opgeslagen wijzigingen' });
    await expect(dialoog).toBeVisible();
    await expect(detail).toHaveClass(/open/);

    // appConfirm heeft zijn eigen Escape: de dialoog sluit, het detail blijft staan.
    await page.keyboard.press('Escape');
    await expect(dialoog).toBeHidden();
    await expect(detail).toHaveClass(/open/);
  });
});

test.describe('vensters: gestapeld', () => {
  test('detail + verzetvenster: Escape sluit enkel het bovenste, daarna het detail', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open1004(page);
    await page.locator('#d-btn-reschedule').click();
    await expect(page.locator('#reschedule-overlay')).toHaveClass(/open/);
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);

    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'reschedule-overlay')).toBe(false);
    expect(await isOpen(page, 'det-overlay')).toBe(true);
    // De focus keert terug naar de opener in het detail eronder.
    await expect(page.locator('#d-btn-reschedule')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'det-overlay')).toBe(false);
  });

  test("detail + foto's: Escape sluit enkel de foto's; Tab blijft in het bovenste venster", async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open1004(page);
    await page.locator('#d-btn-fotos').click();
    await expect.poll(() => isOpen(page, 'foto-overlay')).toBe(true);

    // De focusval werkt op het bovenste venster: Tab vanaf het laatste element van de foto's gaat naar het eerste van de foto's.
    await focusOpLaatste(page, 'foto-overlay');
    await page.keyboard.press('Tab');
    expect((await focusInfo(page, 'foto-overlay')).index).toBe(0);

    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'foto-overlay')).toBe(false);
    expect(await isOpen(page, 'det-overlay')).toBe(true);
    await expect(page.locator('#d-btn-fotos')).toBeFocused();
  });

  test('detail + verzetvenster: een klik op de achtergrond van het bovenste venster sluit enkel dat', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open1004(page);
    await page.locator('#d-btn-reschedule').click();
    await expect(page.locator('#reschedule-overlay')).toHaveClass(/open/);

    await page.locator('#reschedule-overlay').click({ position: { x: 4, y: 4 } });
    await expect.poll(() => isOpen(page, 'reschedule-overlay')).toBe(false);
    expect(await isOpen(page, 'det-overlay')).toBe(true);
  });
});
