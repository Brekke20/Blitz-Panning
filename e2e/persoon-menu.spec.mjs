// De persoonskiezer in de kop (wie zijn planning bekijk je) voor beheerder en planner: kiezen werkt op elk toestel, en het
// gebruikersmenu (account) blijft een aparte knop (proefperiode: "de dropdown met mijn naam doet niets meer").
import { test, expect, startApp } from './helpers.mjs';

const menu = page => page.locator('#person-menu');
const kies = (page, naam) => menu(page).getByRole('button', { name: naam });

test.describe('persoonskiezer voor wie mag plannen', () => {
  for (const loginRol of ['beheerder', 'planner']) {
    test(`${loginRol}: kiest een technieker en daarna weer "Alle technici"`, async ({ page }) => {
      await startApp(page, { loginRol });
      await page.locator('#person-btn').click();
      await expect(menu(page)).toHaveClass(/open/);
      await expect(kies(page, /Alle technici/)).toBeVisible();
      await kies(page, /Roel/).click();
      await expect(menu(page)).not.toHaveClass(/open/);
      await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
      expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('Roel');
      await page.locator('#person-btn').click();
      await kies(page, /Alle technici/).click();
      await expect(page.locator('#person-name-hdr')).toHaveText('Alle');
      expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('all');
    });
  }

  test('beheerder op een toestel met de toestelrol "technieker" (gsm, tablet) kan nog altijd "Alle technici" kiezen', async ({ page }) => {
    await startApp(page, { rol: 'technieker', technieker: 'Tim', loginRol: 'beheerder' });
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
    await page.locator('#person-btn').click();
    await expect(kies(page, /Alle technici/)).toBeVisible();
    await kies(page, /Alle technici/).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Alle');
  });

  test('een technieker ziet "Alle technici" niet (enkel zijn eigen planning en die van collega\'s)', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker' });
    await page.locator('#person-btn').click();
    await expect(kies(page, /Alle technici/)).toBeHidden();
    await expect(kies(page, /Roel/)).toBeVisible();
  });

  test('de kiezer en het gebruikersmenu zijn twee aparte knoppen die elkaar niet in de weg zitten', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder' });
    await expect(page.locator('#person-btn')).toHaveAttribute('aria-label', /Kies technieker/);
    await expect(page.locator('.gebruiker-btn')).toHaveAttribute('aria-label', /Gebruikersmenu/);
    await page.locator('#person-btn').click();
    await expect(menu(page)).toHaveClass(/open/);
    await page.locator('.gebruiker-btn').click();
    await expect(page.locator('.gebruiker-menu')).toHaveClass(/open/);
    await expect(menu(page)).not.toHaveClass(/open/);
    await expect(page.getByRole('menuitem', { name: 'Uitloggen' })).toBeVisible();
    await expect(page.locator('.gebruiker-menu .gm-naam')).toHaveText('Test Beheerder');
    // en de kiezer werkt daarna gewoon weer
    await page.locator('#person-btn').click();
    await expect(menu(page)).toHaveClass(/open/);
    await expect(page.locator('.gebruiker-menu')).not.toHaveClass(/open/);
  });

  test('een account met een Zoho-naam staat altijd in de lijst, ook zonder ticket op zijn naam, en blijft gekozen na het laden', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', loginGebruiker: { zohoNaam: 'Brent Calaerts' }, technieker: 'Brent Calaerts' });
    await expect(page.locator('#person-name-hdr')).toHaveText('Brent');
    await page.locator('#person-btn').click();
    await expect(kies(page, /Brent Calaerts/)).toBeVisible();
    await kies(page, /Roel/).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
    await page.locator('#person-btn').click();
    await kies(page, /Brent Calaerts/).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Brent');
  });

  test('een beheerder met een Zoho-naam start op zichzelf zolang er nog niets gekozen is', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', loginGebruiker: { zohoNaam: 'Tim' }, technieker: '', wachtOpApp: false });
    await expect(page.locator('#person-name-hdr')).toHaveText('Tim');
  });

  test('een beheerder met een Zoho-naam die eerder "Alle" koos, blijft op Alle', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', loginGebruiker: { zohoNaam: 'Tim' }, technieker: 'all' });
    await expect(page.locator('#person-name-hdr')).toHaveText('Alle');
  });
});

test.describe('kop: persoonskiezer en gebruikersmenu zijn duidelijk verschillend', () => {
  test('de kiezer is een benoemde knop zonder initialenrondje; het gebruikersmenu is het enige rondje met initialen', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim' });
    const kiezer = page.locator('#person-btn');
    await expect(kiezer).toContainText('Planning:');
    await expect(kiezer).toContainText('Tim');
    await expect(kiezer.locator('.person-avatar')).toHaveCount(0);
    await expect(kiezer).toHaveAttribute('aria-label', 'Kies technieker, nu Tim');
    await expect(kiezer).toHaveAttribute('aria-haspopup', 'menu');
    const account = page.locator('.gebruiker-btn');
    await expect(account).toHaveText('TB');
    await expect(account).toHaveAttribute('aria-label', 'Gebruikersmenu van Test Beheerder');
    // het menu heeft enkel account-acties; Beheer is alleen de tab
    await account.click();
    await expect(page.locator('.gebruiker-menu').getByRole('menuitem')).toHaveText(['Wachtwoord wijzigen', 'Uitloggen']);
    await expect(page.locator('#tab-beheer')).toBeVisible();
  });

  test('toetsenbord: de kiezer opent met Enter, de items zijn bereikbaar en Escape sluit het gebruikersmenu', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim' });
    await page.locator('#person-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#person-menu')).toHaveClass(/open/);
    await expect(page.locator('#person-btn')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.gebruiker-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.gebruiker-menu')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.gebruiker-menu')).not.toHaveClass(/open/);
  });

  for (const rol of ['beheerder', 'planner', 'technieker']) {
    test(`375 px (${rol}, lange naam): de kop past, geen horizontale paginascroll en alle knoppen blijven in beeld`, async ({ page }) => {
      await startApp(page, { loginRol: rol, loginGebruiker: { naam: 'Alexandra Vandenbroucke-Peeters' }, technieker: 'Tim', viewport: { width: 375, height: 800 } });
      const meet = () => page.evaluate(() => ({
        pagina: document.documentElement.scrollWidth, scherm: window.innerWidth,
        kop: document.querySelector('header').scrollWidth, kopBreed: document.querySelector('header').clientWidth,
        rechts: Math.max(...[...document.querySelectorAll('header button')].map(b => b.getBoundingClientRect().right)),
      }));
      // zowel met het volledige voorvoegsel (computerweergave op een smal venster) als in de gsm-indeling
      for (const gsm of [false, true]) {
        if (gsm) await page.evaluate(() => window.zetWeergave('gsm'));
        const m = await meet();
        expect(m.pagina, `pagina gsm=${gsm}`).toBeLessThanOrEqual(m.scherm);
        expect(m.kop, `kop gsm=${gsm}`).toBeLessThanOrEqual(m.kopBreed);
        expect(m.rechts, `knoppen gsm=${gsm}`).toBeLessThanOrEqual(m.scherm);
      }
      await expect(page.locator('#person-btn .person-voor')).toBeHidden(); // in de gsm-indeling enkel icoon en naam
      await expect(page.locator('#person-name-hdr')).toBeVisible();
    });
  }
});
