// De persoonskiezer in de kop (wie zijn planning bekijk je) voor beheerder en planner: kiezen werkt op elk toestel, en het
// gebruikersmenu (account) blijft een aparte knop (proefperiode: "de dropdown met mijn naam doet niets meer").
import { test, expect, startApp, TICKETS_STUB } from './helpers.mjs';

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

  // UI/UX P1-5: het account bepaalt de weergave. Een oude toestelkeuze blitz_rol = "technieker" (rol-startparameter van startApp) telt voor een
  // beheerder of planner niet meer: ook op een gsm of tablet krijgt hij de coördinatorweergave en kan hij "Alle technici" kiezen.
  for (const loginRol of ['beheerder', 'planner']) {
    test(`${loginRol} op een gsm met een oude toestelrol "technieker": toch coördinator en kan "Alle technici" kiezen`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
      const page = await context.newPage();
      try {
        await startApp(page, { rol: 'technieker', technieker: 'Tim', loginRol });
        await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
        await expect(page.locator('html')).toHaveAttribute('data-rol', 'coordinator');
        await page.locator('#person-btn').click();
        await expect(kies(page, /Alle technici/)).toBeVisible();
        await kies(page, /Alle technici/).click();
        await expect(page.locator('#person-name-hdr')).toHaveText('Alle');
      } finally { await context.close(); }
    });
  }

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

// Proefperiode: /api/tickets gaf 503 (opslag-storing) en de kiezer bleef leeg ("doet niets"). Ook zonder tickets toont hij minstens
// de eigen Zoho-naam en, voor wie mag plannen, "Alle technici".
test.describe('persoonskiezer als de tickets niet laden', () => {
  const stortIn = { tickets: () => ({ status: 503, json: { error: 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.', code: 'opslag-storing' } }) };

  test('technieker met Zoho-naam met spatie: de kiezer toont minstens zijn eigen naam', async ({ page, consoleFouten }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Brent Calaerts', magZelfPlannen: true }, technieker: 'all', overschrijf: stortIn, wachtOpApp: false });
    await page.locator('#person-btn').click();
    await expect(menu(page)).toHaveClass(/open/);
    await expect(kies(page, /Brent Calaerts/)).toBeVisible();
    await expect(kies(page, /Alle technici/)).toBeHidden();
    await expect(page.locator('#person-name-hdr')).toHaveText('Brent');
    consoleFouten.length = 0; // de 503 op /api/tickets is hier de bedoelde fout
  });

  for (const loginRol of ['beheerder', 'planner']) {
    test(`${loginRol}: de kiezer toont "Alle technici" en de eigen naam, en kiezen werkt`, async ({ page, consoleFouten }) => {
      await startApp(page, { loginRol, loginGebruiker: { zohoNaam: 'Brent Calaerts' }, technieker: 'all', overschrijf: stortIn, wachtOpApp: false });
      await page.locator('#person-btn').click();
      await expect(menu(page)).toHaveClass(/open/);
      await expect(kies(page, /Alle technici/)).toBeVisible();
      await expect(kies(page, /Brent Calaerts/)).toBeVisible();
      await kies(page, /Brent Calaerts/).click();
      await expect(page.locator('#person-name-hdr')).toHaveText('Brent');
      consoleFouten.length = 0;
    });
  }
});

// Kop B, taak 1: één kiezer voor alle rollen (schermen/persoonskiezer.js). De rol achter de naam staat enkel in het menu van de beheerder.
const GEBRUIKERS = [
  { id: 'u-b', naam: 'Brent Calaerts', email: 'brent@blitz.be', rol: 'beheerder', zohoNaam: 'Brent Calaerts', actief: true },
  { id: 'u-j', naam: 'Jens Vermeulen', email: 'jens@blitz.be', rol: 'technieker', zohoNaam: 'Jens Vermeulen', actief: true },
  { id: 'u-k', naam: 'Kris Dons', email: 'kris@blitz.be', rol: 'planner', zohoNaam: 'Kris Dons', actief: true },
  { id: 'u-t', naam: 'Tim P.', email: 'tim@blitz.be', rol: 'technieker', zohoNaam: ' tim ', actief: true },
  { id: 'u-an', naam: 'An Maes', email: 'an@blitz.be', rol: 'sales', salesNaam: 'An Maes', magAlleSales: false, actief: true },
  { id: 'u-sofie', naam: 'Sofie Maes', email: 'sofie@blitz.be', rol: 'sales', salesNaam: 'Sofie Maes', magAlleSales: true, actief: true },
  { id: 'u-tom', naam: 'Tom Peeters', email: 'tom@blitz.be', rol: 'sales', salesNaam: 'Tom P.', magAlleSales: false, actief: false },
];
// Zoals de server: zonder rol alle gebruikers, met ?rol=sales enkel de verkopers (de beheerder krijgt met geblokkeerd=1 ook de geblokkeerde).
const gebruikersLijst = (lijst = GEBRUIKERS) => ({ methode, query }) => {
  if (methode !== 'GET') return { status: 405, json: { error: 'x' } };
  const alleen = query?.get('rol') === 'sales';
  const rijen = structuredClone(lijst).filter(g => !alleen || (g.rol === 'sales' && (g.actief || query.get('geblokkeerd') === '1')));
  return { status: 200, json: { gebruikers: rijen } };
};

test.describe('kop B: persoonskiezer met de rol achter de naam (beheerder)', () => {
  test('beheerder: groepen Techniek en Sales met de rol achter elke naam, "(jij)" bij de eigen naam, "geen login" zonder account, geblokkeerd, geen e-mailadres', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'beheerder', loginGebruiker: { zohoNaam: 'Brent Calaerts' }, technieker: 'Tim', overschrijf: { gebruikers: gebruikersLijst() } });
    await page.locator('#person-btn').click();
    await expect(menu(page)).toHaveClass(/open/);
    await expect(menu(page).locator('.pm-groep-titel')).toHaveText(['Techniek', 'Sales']);
    // de lijst kwam na het eerste openen binnen
    await expect(menu(page).locator('.pm-item-name')).toHaveText(['Alle technici', 'Brent Calaerts (jij)', 'Jens Vermeulen', 'Kris Dons', 'Roel', 'Tim', 'An Maes', 'Sofie Maes', 'Tom Peeters']);
    await expect(menu(page).locator('.pm-item-rol')).toHaveText(['beheerder', 'technieker', 'planner', 'technieker · geen login', 'technieker', 'verkoper', 'sales manager', 'verkoper · geblokkeerd (alleen lezen)']);
    expect(verzoeken.van('/api/gebruikers', 'GET')).toHaveLength(2); // alle gebruikers (rol en Zoho-naam) en de verkopers (?rol=sales&geblokkeerd=1)
    const tekst = await menu(page).evaluate(el => el.textContent);
    expect(tekst).not.toContain('@');
    // opnieuw openen vraagt de lijst niet opnieuw op
    await page.locator('#person-btn').click();
    await page.locator('#person-btn').click();
    expect(verzoeken.van('/api/gebruikers', 'GET')).toHaveLength(2);
  });

  test('een account met een Zoho-naam maar zonder ticket is te kiezen en blijft gekozen na een nieuwe lading', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', overschrijf: { gebruikers: gebruikersLijst() } });
    await page.locator('#person-btn').click();
    await kies(page, /Jens Vermeulen technieker/).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Jens');
    await page.locator('[data-actie="vernieuw"]').click();
    await page.clock.runFor(2000);
    await expect(page.locator('#person-name-hdr')).toHaveText('Jens');
    expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('Jens Vermeulen');
  });

  test('de gebruikerslijst mislukt: de namen uit de tickets zonder rol-labels; kiezen werkt', async ({ page, consoleFouten }) => {
    await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: { gebruikers: () => ({ status: 503, json: { error: 'opslag', code: 'opslag-storing' } }) } });
    await page.locator('#person-btn').click();
    await expect(menu(page).locator('.pm-item-name')).toHaveText(['Alle technici', 'Roel', 'Tim']);
    await expect(menu(page).locator('.pm-item-rol')).toHaveCount(0);
    await expect(menu(page).locator('.pm-melding')).toHaveText('De lijst met verkopers kon niet geladen worden');
    await kies(page, /Roel/).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
    consoleFouten.length = 0; // de 503 op /api/gebruikers is hier de bedoelde fout
  });
});

test.describe('kop B: namen komen enkel als tekst in het menu', () => {
  test('een Zoho-naam met HTML wordt niet uitgevoerd en staat letterlijk in het menu en in de kop', async ({ page }) => {
    const gevaarlijk = '<img src=x onerror="window.__xss=1">Tim';
    // de eigen Zoho-naam van een planner en een account in de lijst van de beheerder: beide komen als tekst in het menu
    await startApp(page, { loginRol: 'planner', loginGebruiker: { zohoNaam: gevaarlijk }, technieker: gevaarlijk });
    await expect(page.locator('#person-name-hdr')).toHaveText('<img');
    await page.locator('#person-btn').click();
    await expect(menu(page).locator('.pm-item-name', { hasText: 'onerror' })).toHaveText(gevaarlijk + ' (jij)');
    await expect(menu(page).locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('beheerder: een gebruikersnaam of Zoho-naam met HTML in de lijst blijft tekst', async ({ page }) => {
    const gevaarlijk = '<img src=x onerror="window.__xss=2">';
    const lijst = [
      { id: 'u-x', naam: gevaarlijk, email: 'x@blitz.be', rol: 'technieker', zohoNaam: gevaarlijk + 'Jan', actief: true },
      { id: 'u-y', naam: gevaarlijk + 'Verkoper', email: 'y@blitz.be', rol: 'sales', salesNaam: 'Y', magAlleSales: false, actief: true },
    ];
    await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: { gebruikers: gebruikersLijst(lijst) } });
    await page.locator('#person-btn').click();
    await expect(menu(page).locator('.pm-item-name', { hasText: 'onerror' })).toHaveText([gevaarlijk + 'Jan', gevaarlijk + 'Verkoper']);
    await expect(menu(page).locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('kop B: toetsenbord en gsm', () => {
  test('Enter opent het menu met de focus op de gekozen persoon, pijltjes verplaatsen de focus, Escape sluit en geeft de focus terug', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', technieker: 'Roel' });
    await page.locator('#person-btn').focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveClass(/open/);
    await expect(menu(page).locator('.pm-item.active')).toBeFocused(); // Roel
    await page.keyboard.press('ArrowDown');
    await expect(kies(page, /Tim/)).toBeFocused();
    await page.keyboard.press('ArrowDown'); // laatste -> terug naar het begin
    await expect(kies(page, /Alle technici/)).toBeFocused();
    await page.keyboard.press('End');
    await expect(kies(page, /Tim/)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(kies(page, /Alle technici/)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(kies(page, /Tim/)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#person-name-hdr')).toHaveText('Tim');
    await expect(menu(page)).not.toHaveClass(/open/);
    await page.locator('#person-btn').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(menu(page)).not.toHaveClass(/open/);
    await expect(page.locator('#person-btn')).toBeFocused();
  });

  test('gsm 375 px (beheerder): het menu past in het scherm, scrolt bij een lange lijst en heeft aanraakmaten', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 600 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      const veel = Array.from({ length: 14 }, (_, i) => ({ id: 'u' + i, naam: 'Technieker ' + String.fromCharCode(65 + i), email: 'x' + i + '@blitz.be', rol: 'technieker', zohoNaam: 'Technieker ' + String.fromCharCode(65 + i), actief: true }));
      await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', overschrijf: { gebruikers: gebruikersLijst(veel) } });
      await page.locator('#person-btn').click();
      await expect(menu(page).locator('.pm-item')).toHaveCount(1 + 14 + 2 + 0); // Alle technici + 14 accounts + Roel en Tim uit de tickets (geen verkopers in deze lijst)
      const m = await page.evaluate(() => {
        const el = document.getElementById('person-menu');
        const r = el.getBoundingClientRect();
        return { rechts: r.right, links: r.left, onder: r.bottom, scherm: window.innerWidth, hoog: window.innerHeight, scrollbaar: el.scrollHeight > el.clientHeight, item: el.querySelector('.pm-item').getBoundingClientRect().height, breed: r.width };
      });
      expect(m.rechts).toBeLessThanOrEqual(m.scherm);
      expect(m.links).toBeGreaterThanOrEqual(0);
      expect(m.breed).toBeLessThanOrEqual(300);
      expect(m.onder).toBeLessThanOrEqual(m.hoog);
      expect(m.scrollbaar).toBe(true);
      expect(m.item).toBeGreaterThanOrEqual(44);
      // op een gsm staat de rol onder de naam, niet ernaast
      await expect(menu(page).locator('.pm-item-rol').first()).toBeHidden();
      await expect(menu(page).locator('.pm-sub-rol').first()).toBeVisible();
    } finally { await context.close(); }
  });
});
