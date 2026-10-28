import { test, expect, startApp, kiesHoofdtab } from './helpers.mjs';

// Meldgrens per product (v2.4.0): een product onder zijn grens kleurt oranje, een leeg product rood; het tabcijfer telt enkel die
// producten (oranje of rood). De grens staat in Bewerken naast het belletje, enkel op pc en tablet. Bij de opstart krijgt wie zelf
// een wagen heeft één keer "Check je voorraad".

const VOORRAAD = {
  Tim: {
    'meter-sdm54-m': { aantal: 1, gedempt: false, drempel: 2 },     // bijna op
    'meter-sdm72d-m': { aantal: 0, gedempt: false, drempel: 0 },    // op
    'meter-tcpip-direct': { aantal: 5, gedempt: false, drempel: 2 }, // ok
    'meter-tcpip-indirect': { aantal: 0, gedempt: true, drempel: null }, // geen melding
  },
};
const inventaris = (wagenvoorraad = VOORRAAD) => () => ({ status: 200, json: { versie: 3, wagenvoorraad, log: [] } });
const rij = (page, naam) => page.locator('.inv-raster .inv-row', { hasText: naam });

async function openInventaris(page, opties = {}) {
  await startApp(page, { technieker: 'Tim', overschrijf: { inventaris: inventaris(opties.wagenvoorraad) }, ...opties });
  await kiesHoofdtab(page, /Inventaris/); // Open dag: in een smal venster staat Inventaris in "Meer"
  await expect(page.locator('#inv-edit-btn')).toBeVisible();
}

test('oranje bij bijna op, rood bij op, niets zonder melding; de grens staat naast het aantal', async ({ page }) => {
  await openInventaris(page);
  await expect(rij(page, 'SDM54-M')).toHaveClass(/inv-bijna/);
  await expect(rij(page, 'SDM54-M').locator('.inv-row-grens')).toHaveText('≤ 2');
  await expect(rij(page, 'SDM72D-M')).toHaveClass(/inv-low/);
  await expect(rij(page, 'SDM72D-M').locator('.inv-row-grens')).toHaveCount(0); // grens 0: geen hint
  await expect(rij(page, 'TCP/IP Direct')).not.toHaveClass(/inv-(low|bijna)/);
  await expect(rij(page, 'TCP/IP Indirect')).not.toHaveClass(/inv-(low|bijna)/);
  // Een product zonder voorraadregel (nooit in de wagen) meldt niet
  await expect(page.locator('.inv-raster .inv-row.inv-low, .inv-raster .inv-row.inv-bijna')).toHaveCount(2);
});

test('tabcijfer: telt enkel producten onder hun grens; rood als iets op is, anders oranje', async ({ page }) => {
  await openInventaris(page);
  const cijfer = page.locator('#cnt-inventaris');
  await expect(cijfer).toHaveText('2');
  await expect(cijfer).toHaveClass(/badge--op/);

  await openInventaris(page, { wagenvoorraad: { Tim: { 'meter-sdm54-m': { aantal: 1, gedempt: false, drempel: 2 } } } });
  await expect(cijfer).toHaveText('1');
  await expect(cijfer).toHaveClass(/badge--bijna/);
  await expect(cijfer).not.toHaveClass(/badge--op/);

  await openInventaris(page, { wagenvoorraad: {} });
  await expect(cijfer).toBeHidden();
});

test('Bewerken op pc: belletje met meldgrens; belletje uit verbergt de grens, aan toont ze weer', async ({ page }) => {
  await openInventaris(page, { viewport: { width: 1280, height: 900 } });
  await page.locator('#inv-edit-btn').click();
  const sdm54 = page.locator('.inv-cat-row', { hasText: 'SDM54-M' });
  await expect(sdm54.locator('.inv-bell-btn')).toBeVisible();
  await expect(sdm54.locator('.inv-drempel-input')).toHaveValue('2');
  await expect(sdm54.locator('.inv-melding')).toBeVisible();

  const indirect = page.locator('.inv-cat-row', { hasText: 'TCP/IP Indirect' });
  await expect(indirect.locator('.inv-bell-btn')).toHaveText('🔕');
  await expect(indirect.locator('.inv-melding')).toBeHidden();
  await indirect.locator('.inv-bell-btn').click();
  await expect(indirect.locator('.inv-melding')).toBeVisible();
  await expect(indirect.locator('.inv-drempel-input')).toHaveValue('0');

  await sdm54.locator('.inv-bell-btn').click();
  await expect(sdm54.locator('.inv-melding')).toBeHidden();
  // Geen horizontale scroll door het extra veld
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Bewerken op de gsm: geen belletje en geen meldgrens, aantallen wel', async ({ page }) => {
  await openInventaris(page, { viewport: { width: 375, height: 800 } });
  await page.evaluate(() => window.zetWeergave('gsm'));
  await page.locator('#inv-edit-btn').click();
  const sdm54 = page.locator('.inv-cat-row', { hasText: 'SDM54-M' });
  await expect(sdm54.locator('.inv-qty-input')).toBeVisible();
  await expect(sdm54.locator('.inv-bell-btn')).toBeHidden();
  await expect(sdm54.locator('.inv-melding')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Bewerken op een tablet: belletje en meldgrens zichtbaar', async ({ page }) => {
  await openInventaris(page, { viewport: { width: 1024, height: 768 } });
  await page.evaluate(() => window.zetWeergave('tablet'));
  await page.locator('#inv-edit-btn').click();
  const sdm54 = page.locator('.inv-cat-row', { hasText: 'SDM54-M' });
  await expect(sdm54.locator('.inv-bell-btn')).toBeVisible();
  await expect(sdm54.locator('.inv-drempel-input')).toBeVisible();
});

test('opstartmelding: wie zelf een wagen heeft met producten onder de grens krijgt "Check je voorraad"', async ({ page }) => {
  await startApp(page, { technieker: 'Tim', loginGebruiker: { zohoNaam: 'Tim' }, overschrijf: { inventaris: inventaris() } });
  // Eerst de opstartmelding van de tickets (één meldingsvak), pas daarna de voorraad
  await expect(page.locator('#toast')).toHaveText('🧪 Testmodus actief — dummy data geladen');
  await page.clock.runFor(5000);
  await expect(page.locator('#toast')).toHaveText('⚠ Check je voorraad: 2 producten bijna op of op');
  await page.clock.runFor(60000);
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
});

test('geen opstartmelding zonder eigen wagen of zonder iets onder de grens', async ({ page }) => {
  await startApp(page, { technieker: 'Tim', overschrijf: { inventaris: inventaris() } }); // beheerder zonder Zoho-naam
  await kiesHoofdtab(page, /Inventaris/); // Open dag: in een smal venster staat Inventaris in "Meer"
  await expect(page.locator('#cnt-inventaris')).toHaveText('2'); // inventaris geladen
  await page.clock.runFor(5000);
  await expect(page.locator('#toast')).not.toContainText('Check je voorraad');

  await startApp(page, { technieker: 'Tim', loginGebruiker: { zohoNaam: 'Tim' }, overschrijf: { inventaris: inventaris({ Tim: { 'meter-sdm54-m': { aantal: 5, gedempt: false, drempel: 2 } } }) } });
  await kiesHoofdtab(page, /Inventaris/); // Open dag: in een smal venster staat Inventaris in "Meer"
  await expect(rij(page, 'SDM54-M')).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.locator('#toast')).not.toContainText('Check je voorraad');
});
