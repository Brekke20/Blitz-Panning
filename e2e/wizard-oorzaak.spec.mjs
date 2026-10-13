import { test, expect, startApp, opslagStub } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// v2.1.3: Oorzaak storing is een accordion met 4 groepen en chips; één groep tegelijk open. Tablet, touch.
test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

async function openWizard(page, { concept } = {}) {
  await startApp(page, { overschrijf: seed() });
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
  await expect(page.locator('#det-overlay')).toHaveClass(/open/);
  if (concept) {
    await page.evaluate((c) => {
      const t = [...kern.toestand.get('allTickets'), ...Object.values(kern.toestand.get('planning')).flat().map(p => p.ticket)].find(x => String(x.number) === '1004');
      localStorage.setItem(`blitz_test_rapportconcept:${t.id}:2026-10-07`, JSON.stringify({ v: 1, opgeslagen: new Date().toISOString(), stap: c.stap, R: c.R }));
    }, concept);
  }
  await page.locator('#d-btn-rapport').click();
  if (concept) await page.getByRole('button', { name: 'Hervatten' }).click();
  await expect(page.locator('#rapport-wizard')).toHaveClass(/open/);
}

async function naarOmschrijving(page) {
  const volgende = page.locator('#wiz-btn-next');
  for (let i = 0; i < 8 && !(await page.locator('#oorzaak-wrap').count()); i++) await volgende.click();
  await expect(page.locator('#oorzaak-wrap')).toBeVisible();
}

const kop = (page, naam) => page.locator('#oorzaak-wrap').getByRole('button', { name: new RegExp(`^${naam}`) });
const chip = (page, naam) => page.locator('#oorzaak-wrap').getByRole('button', { name: naam, exact: true });

test('de eerste groep staat open en een andere groep openen sluit de eerste', async ({ page }) => {
  await openWizard(page);
  await naarOmschrijving(page);
  await expect(kop(page, 'Toestel')).toHaveAttribute('aria-expanded', 'true');
  await expect(kop(page, 'Communicatie en instellingen')).toHaveAttribute('aria-expanded', 'false');
  await expect(chip(page, 'Component defect')).toBeVisible();
  await expect(chip(page, 'OCPP / CPO')).toBeHidden();

  await kop(page, 'Communicatie en instellingen').click();
  await expect(kop(page, 'Communicatie en instellingen')).toHaveAttribute('aria-expanded', 'true');
  await expect(kop(page, 'Toestel')).toHaveAttribute('aria-expanded', 'false');
  await expect(chip(page, 'OCPP / CPO')).toBeVisible();
  await expect(chip(page, 'Component defect')).toBeHidden();
  await expect(page.locator('#oorzaak-wrap [aria-expanded="true"]')).toHaveCount(1);
  const box = await chip(page, 'OCPP / CPO').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(40);
});

test('chips aantikken werkt de samenvatting in de kop bij, ook als de groep dicht is', async ({ page }) => {
  await openWizard(page);
  await naarOmschrijving(page);
  await chip(page, 'Component defect').click();
  await chip(page, 'Schade').click();
  await expect(chip(page, 'Schade')).toHaveAttribute('aria-pressed', 'true');
  await expect(kop(page, 'Toestel')).toContainText('2 gekozen');
  await kop(page, 'Overig').click();
  await chip(page, 'Andere').click();
  await expect(kop(page, 'Overig')).toContainText('1 gekozen');
  await expect(kop(page, 'Toestel')).toContainText('2 gekozen');
  await expect(kop(page, 'Toestel')).toContainText('Component defect, Schade');
  await chip(page, 'Andere').click();
  await expect(kop(page, 'Overig')).not.toContainText('gekozen');
});

test('zonder keuze blokkeert de stap; met een keuze toont het Overzicht de gekozen labels', async ({ page }) => {
  await openWizard(page);
  await naarOmschrijving(page);
  await page.locator('#wiz-btn-next').click();
  await expect(page.getByText('⚠ Kies minstens één oorzaak.')).toBeVisible();
  await expect(page.locator('#wiz-step-label')).toContainText('Omschrijving');
  await chip(page, 'Component defect').click();
  await kop(page, 'Plaatsing en omgeving').click();
  await chip(page, 'Gebruikersfout').click();
  for (let i = 0; i < 5; i++) await page.locator('#wiz-btn-next').click();
  await expect(page.locator('#wiz-step-label')).toContainText('Overzicht');
  await expect(page.locator('#rapport-wizard')).toContainText('Component defect, Gebruikersfout');
});

test('een concept met Productfout houdt die waarde als "(oud)"-chip en toont ze in het Overzicht', async ({ page }) => {
  await openWizard(page, { concept: { stap: 'omschrijving', R: { interventieType: 'Interventie', aanrijtijdMin: 20, aanrijtijdBron: 'handmatig', oorzaakStoring: ['Productfout', 'Installatiefout'] } } });
  await expect(page.locator('#oorzaak-wrap .wiz-oorz-chip.oud')).toHaveText(/\(oud\) Productfout/);
  await expect(kop(page, 'Plaatsing en omgeving')).toHaveAttribute('aria-expanded', 'true'); // eerste groep met een keuze
  await expect(chip(page, 'Installatiefout')).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 5; i++) await page.locator('#wiz-btn-next').click();
  await expect(page.locator('#wiz-step-label')).toContainText('Overzicht');
  await expect(page.locator('#rapport-wizard')).toContainText('Productfout, Installatiefout');
});

test('een oude waarde kan bewust verwijderd worden', async ({ page }) => {
  await openWizard(page, { concept: { stap: 'omschrijving', R: { interventieType: 'Interventie', aanrijtijdMin: 20, aanrijtijdBron: 'handmatig', oorzaakStoring: ['Productfout'] } } });
  await page.locator('#oorzaak-wrap .wiz-oorz-chip.oud').click();
  await expect(page.locator('#oorzaak-wrap .wiz-oorz-chip.oud')).toHaveCount(0);
  await page.locator('#wiz-btn-next').click();
  await expect(page.getByText('⚠ Kies minstens één oorzaak.')).toBeVisible();
});

test('een oud rapport met Productfout toont de waarde ongewijzigd in het archief', async ({ page }) => {
  const rapport = {
    id: 'r-oud', ticketId: 't-oud', ticketNumber: '1002', datum: '2026-10-07', technieker: 'Tim',
    rapportData: { oorzaakStoring: ['Productfout'], _html: '<html><body><div class="sec">Oorzaak storing</div><div class="block">Productfout</div></body></html>' },
  };
  await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: { 'rapport-archief': opslagStub({ versie: 3, rapports: [rapport] }, 'rapports') } });
  await page.getByRole('tab', { name: 'Rapporten', exact: true }).click();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.locator('#rapp-archief-body').getByRole('button', { name: '📄 Openen' }).click(),
  ]);
  await expect(popup.frameLocator('iframe').locator('body')).toContainText('Productfout');
});
