import { test, expect, startApp } from './helpers.mjs';

// Etappe 5b, taak 8: de app-schil (public/js/app.js) die het klassieke script van index.html verving. Dekt wat de andere
// specs niet rechtstreeks raken: de zes hoofdtabs via delegatie (voorheen inline onclick), de knoppen van de Rapporten-kop
// (Excel-export, Herladen) en de wizardknoppen (Vorige, Sluiten), de offline-banner, en het bewaren en herstellen van de
// schermstaat. Testklok: maandag 5 okt 2026. Alle verzoeken zijn gestubd; er wordt niets verzonden of geschreven.

const TABS = [
  ['Wachtrij', 'tickets'], ['Kalender', 'kalender'], ['Route', 'planning'],
  ['Ingepland', 'gepland'], ['Inventaris', 'inventaris'], ['Rapporten', 'rapporten'],
];

test.describe('hoofdtabs', () => {
  test('elke tab activeert zijn view en zet aria-selected, tabindex en de andere tabs uit', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    for (const [naam, id] of TABS) {
      await page.getByRole('tab', { name: naam }).click();
      await expect(page.locator(`#tab-${id}`)).toHaveClass(/active/);
      await expect(page.locator(`#tab-${id}`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator(`#tab-${id}`)).toHaveAttribute('tabindex', '0');
      await expect(page.locator(`#view-${id}`)).toHaveClass(/active/);
      await expect(page.locator('.tab.active')).toHaveCount(1);
      await expect(page.locator('.view.active')).toHaveCount(1);
      await expect(page.locator('.tab[aria-selected="true"]')).toHaveCount(1);
    }
  });

  test('een klik op een tab (ook op de teller in de tab) laat het persoonmenu open: de klik bereikt document niet', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await page.locator('#person-btn').click();
    await expect(page.locator('#person-menu')).toHaveClass(/open/);
    await page.locator('#tab-gepland .badge').click(); // de teller in de Ingepland-tab
    await expect(page.locator('#tab-gepland')).toHaveClass(/active/);
    await expect(page.locator('#person-menu')).toHaveClass(/open/);
    // een klik buiten de tabs sluit het menu nog wel
    await page.locator('h1.sr-only').evaluate(el => el.parentElement.click());
    await expect(page.locator('#person-menu')).not.toHaveClass(/open/);
  });

  test('de tabbalk reageert op de pijltjestoetsen (focus naar de volgende zichtbare tab)', async ({ page }) => {
    await startApp(page, { rol: 'coordinator', loginRol: 'planner' }); // een beheerder heeft er nog een tab (Beheer) achter
    await page.locator('#tab-tickets').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-kalender')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('#tab-rapporten')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#tab-tickets')).toBeFocused();
  });

  test('de tabindicator staat onder de actieve tab', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect.poll(() => page.locator('.tabs').evaluate(el => el.style.getPropertyValue('--ind-width'))).not.toBe('');
    const [links, breedte] = await page.evaluate(() => {
      const t = document.querySelector('.tabs');
      return [parseFloat(t.style.getPropertyValue('--ind-left')), parseFloat(t.style.getPropertyValue('--ind-width'))];
    });
    const tab = await page.locator('#tab-kalender').boundingBox();
    const balk = await page.locator('.tabs').boundingBox();
    expect(Math.abs(links - (tab.x - balk.x))).toBeLessThan(1.5);
    expect(Math.abs(breedte - tab.width)).toBeLessThan(1.5);
  });
});

test.describe('persoonkiezer', () => {
  test('het menu toont de exacte teksten en selectPerson zet de filter en de kop', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await page.locator('#person-btn').click();
    const items = page.locator('#person-menu .pm-item');
    await expect(items).toHaveCount(3); // Alle technici, Roel, Tim (alfabetisch)
    await expect(items.locator('.pm-item-name')).toHaveText(['Alle technici', 'Roel', 'Tim']);
    await expect(items.locator('.pm-item-sub')).toHaveText(['Gecombineerde weergave', 'Persoonlijke planning', 'Persoonlijke planning']);
    await expect(items.locator('.pm-avatar')).toHaveText(['A', 'R', 'T']);
    await expect(items.nth(0)).toHaveClass(/active/);
    await items.nth(2).click(); // Tim
    await expect(page.locator('#person-name-hdr')).toHaveText('Tim');
    await expect(page.locator('#person-avatar-hdr')).toHaveText('T');
    expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('Tim');
    await expect(page.locator('#person-menu')).not.toHaveClass(/open/);
    await page.locator('#person-btn').click();
    await expect(page.locator('#person-menu .pm-item.active .pm-item-name')).toHaveText('Tim');
    await expect(page.locator('#person-menu .pm-item.active .pm-item-sub')).toHaveText('Persoonlijke planning');
  });
});

test.describe('Rapporten-kop en wizardknoppen', () => {
  test('Herladen vraagt het rapportarchief opnieuw op', async ({ page, verzoeken }) => {
    await startApp(page, { rol: 'coordinator' });
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    await expect.poll(() => verzoeken.van('/api/rapport-archief', 'GET').length).toBeGreaterThan(0);
    const voor = verzoeken.van('/api/rapport-archief', 'GET').length;
    await page.getByRole('button', { name: '↺ Herladen' }).click();
    await expect.poll(() => verzoeken.van('/api/rapport-archief', 'GET').length).toBe(voor + 1);
  });

  test('Excel export zonder rapporten toont de melding en start geen download', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    let download = false;
    page.on('download', () => { download = true; });
    await page.getByRole('button', { name: '📊 Excel export' }).click();
    await expect(page.locator('#toast')).toHaveText('Geen rapporten beschikbaar om te exporteren');
    expect(download).toBe(false);
  });

  test('wizard: Volgende, Vorige en ✕ Sluiten werken', async ({ page }) => {
    await startApp(page, { technieker: 'Tim' });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
    const detail = page.getByRole('dialog', { name: /Energiemeting klopt niet/ });
    await detail.getByRole('button', { name: '📋 Rapport' }).click();
    const wizard = page.getByRole('dialog', { name: '📋 Service Rapport' });
    await expect(wizard).toHaveClass(/open/);
    const stap = wizard.locator('#wiz-step-label');
    await expect(stap).toHaveText(/^1 \/ /);
    await expect(wizard.locator('#wiz-btn-back')).toBeHidden();
    await wizard.getByRole('radio', { name: 'Interventie' }).check();
    await wizard.getByRole('button', { name: 'Volgende →' }).click();
    await expect(stap).toHaveText(/^2 \/ /);
    await wizard.getByRole('button', { name: '← Vorige' }).click();
    await expect(stap).toHaveText(/^1 \/ /);
    // closeWizard vraagt eerst een native bevestiging ("Rapport sluiten? Je concept blijft bewaard."): eerst weigeren, dan accepteren.
    const vragen = [];
    page.once('dialog', d => { vragen.push(d.message()); d.dismiss(); });
    await wizard.getByRole('button', { name: 'Sluiten' }).click();
    await expect.poll(() => vragen.length).toBe(1);
    expect(vragen[0]).toBe('Rapport sluiten? Je concept blijft bewaard.');
    await expect(page.locator('#rapport-wizard')).toHaveClass(/open/);
    page.once('dialog', d => d.accept());
    await wizard.getByRole('button', { name: 'Sluiten' }).click();
    await expect(page.locator('#rapport-wizard')).not.toHaveClass(/open/);
  });
});

test.describe('opstart: offline-banner en schermstaat', () => {
  test('de offline-banner volgt de verbinding', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await expect(page.locator('#offline-banner')).toBeHidden();
    await page.context().setOffline(true);
    await expect(page.locator('#offline-banner')).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.locator('#offline-banner')).toBeHidden();
  });

  test('de testbadge staat aan in ?test', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await expect(page.locator('#test-badge')).toBeVisible();
  });

  test('thema-wissel bewaart de keuze en zet de themakleur van de browser', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    const voor = await page.locator('html').getAttribute('data-theme');
    await page.locator('button[data-actie="thema"]').click();
    const na = await page.locator('html').getAttribute('data-theme');
    expect(na).not.toBe(voor);
    expect(await page.evaluate(() => localStorage.getItem('blitz_theme'))).toBe(na);
    await expect(page.locator('#meta-theme-color')).toHaveAttribute('content', na === 'light' ? '#f5f6f7' : '#181e24');
  });

  test('de actieve tab wordt bij het verlaten bewaard en na een herlaad hersteld', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await page.getByRole('tab', { name: 'Ingepland' }).click();
    await expect(page.locator('#tab-gepland')).toHaveClass(/active/);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('blitz_schermstaat')).tab)).toBe('gepland');
    await page.reload();
    await expect(page.locator('#tab-gepland')).toHaveClass(/active/);
    await expect(page.locator('#view-gepland')).toHaveClass(/active/);
  });

  test('een bewaarde Route-tab wordt niet automatisch hersteld (Route rekent bij openen)', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('blitz_schermstaat')).tab)).toBe('planning');
    await page.reload();
    await expect(page.locator('#tab-tickets')).toHaveClass(/active/);
  });

  test('de topbalkhoogte staat in --topbar-h', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    const [css, echt] = await page.evaluate(() => [
      parseFloat(document.documentElement.style.getPropertyValue('--topbar-h')),
      document.querySelector('.topbar-sticky').getBoundingClientRect().height,
    ]);
    expect(css).toBeGreaterThan(0);
    expect(Math.abs(css - echt)).toBeLessThan(1);
  });
});
