import { test, expect, startApp } from './helpers.mjs';
import { seed, AFSPRAAK_WO } from './kalender-hulp.mjs';

// v2.1.6 (tablet): een eigen afspraak die op de pc verwijderd werd, bleef op de tablet staan. De afspraken werden enkel bij de start
// geladen; de 5-minutenpoll en de terugkeer naar de app (visibilitychange) haalden enkel de Zoho-tickets op.
// Twee pagina's (pc en tablet) op dezelfde gestubde backend (de routes staan op de context).
test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

const kaart = (page, datum, titel) => page.locator(`.day-col[data-date="${datum}"] .cal-local-event`, { hasText: titel });

async function naarKalender(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await expect(page.locator('.day-col[data-date="2026-10-05"]')).toBeVisible();
}

// De tablet: een tweede pagina in dezelfde context (dezelfde nep-backend en klok).
async function openTablet(pc) {
  const tablet = await pc.context().newPage();
  await tablet.goto('/?test');
  await expect(tablet.locator('#cnt-tickets')).toHaveText('3');
  await naarKalender(tablet);
  return tablet;
}

// De pagina naar de achtergrond (of terug): visibilityState en de gebeurtenis, zoals een tablet die de app wegzet en weer opent.
async function zetZichtbaar(page, zichtbaar) {
  await page.evaluate((z) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (z ? 'visible' : 'hidden') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !z });
    document.dispatchEvent(new Event('visibilitychange'));
  }, zichtbaar);
}

async function verwijderOpPc(pc, datum, titel) {
  await naarKalender(pc);
  await kaart(pc, datum, titel).getByRole('button', { name: 'Afspraak verwijderen' }).click();
  await pc.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen' }).click();
  await expect(kaart(pc, datum, titel)).toHaveCount(0);
}

test('een afspraak die op de pc verwijderd wordt, verdwijnt op de tablet bij de volgende poll', async ({ page }) => {
  await startApp(page, { overschrijf: seed() });
  const tablet = await openTablet(page);
  await expect(kaart(tablet, '2026-10-07', AFSPRAAK_WO.titel)).toHaveCount(1);

  await verwijderOpPc(page, '2026-10-07', AFSPRAAK_WO.titel);
  await page.clock.runFor(5 * 60 * 1000 + 31 * 1000); // de poll (elke 30 s, laadt na 5 min)
  await expect(kaart(tablet, '2026-10-07', AFSPRAAK_WO.titel)).toHaveCount(0);
});

test('tablet op de achtergrond: bij terugkeer naar de app is de verwijderde afspraak meteen weg (zonder op de poll te wachten)', async ({ page }) => {
  await startApp(page, { overschrijf: seed() });
  const tablet = await openTablet(page);
  await zetZichtbaar(tablet, false);
  await verwijderOpPc(page, '2026-10-07', AFSPRAAK_WO.titel);
  await page.clock.runFor(2 * 60 * 1000); // de tablet lag even weg; de poll slaat een onzichtbare pagina over
  await expect(kaart(tablet, '2026-10-07', AFSPRAAK_WO.titel)).toHaveCount(1);
  await zetZichtbaar(tablet, true);
  await expect(kaart(tablet, '2026-10-07', AFSPRAAK_WO.titel)).toHaveCount(0);
});

test('een eigen wijziging die nog onderweg is, gaat bij een verversing niet verloren', async ({ page, consoleFouten }) => {
  // De PUT van de tablet blijft hangen tot de test hem loslaat; intussen keert de tablet terug naar de app (verversing).
  const opslag = seed().afspraken;
  let laatLos = null;
  const poort = new Promise((res) => { laatLos = res; });
  let tabletPut = false;
  const afspraken = async (z) => {
    if (z.methode === 'PUT' && !tabletPut && (z.body?.afspraken || []).some(a => a.titel === 'Eigen afspraak')) { tabletPut = true; await poort; }
    return opslag(z);
  };
  await startApp(page, { overschrijf: { ...seed(), afspraken } });
  const tablet = await openTablet(page);
  await verwijderOpPc(page, '2026-10-07', AFSPRAAK_WO.titel);

  // De tablet voegt een afspraak toe (de opslag blijft hangen).
  await tablet.getByRole('button', { name: '➕ Afspraak' }).click();
  const modal = tablet.locator('#manueel-overlay');
  await modal.getByLabel('Titel *').fill('Eigen afspraak');
  await modal.getByLabel('Datum *').fill('2026-10-08');
  await modal.getByLabel('Van *').fill('10:00');
  await modal.getByLabel('Tot *').fill('11:00');
  await modal.getByRole('button', { name: 'Opslaan' }).click();
  await expect.poll(() => tabletPut).toBe(true);
  await expect(kaart(tablet, '2026-10-08', 'Eigen afspraak')).toHaveCount(1);
  // Waakt over de toestand: verdwijnt de eigen afspraak ook maar even (een verversing die de server-stand van vóór de opslag
  // toepast), dan blijft dat genoteerd.
  await tablet.evaluate(() => {
    window.__eigenWeg = false;
    kern.toestand.abonneer(['localEvents'], () => {
      if (!kern.toestand.get('localEvents').some(e => e.titel === 'Eigen afspraak')) window.__eigenWeg = true;
    });
  });
  await zetZichtbaar(tablet, false);
  await zetZichtbaar(tablet, true);
  await tablet.waitForTimeout(800); // ruim de tijd voor een verversing (GET is gestubd en meteen beantwoord)
  expect(await tablet.evaluate(() => window.__eigenWeg), 'de eigen afspraak verdween tijdens de verversing').toBe(false);
  await expect(kaart(tablet, '2026-10-08', 'Eigen afspraak')).toHaveCount(1);
  laatLos();
  // De tablet bewaarde met een verouderde versie: de bedoelde 409 (HTTP-fout + consolemelding) en daarna de merge.
  const is409 = (f) => f.includes('/api/afspraken') && /409/.test(f);
  await expect.poll(() => consoleFouten.filter(is409).length).toBe(2);
  for (const f of consoleFouten.filter(is409)) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  await expect(kaart(tablet, '2026-10-07', AFSPRAAK_WO.titel)).toHaveCount(0); // de 409-merge neemt de verwijdering van de pc over
  await expect(kaart(tablet, '2026-10-08', 'Eigen afspraak')).toHaveCount(1);
  await zetZichtbaar(tablet, false);
  await zetZichtbaar(tablet, true);
  await expect(kaart(tablet, '2026-10-08', 'Eigen afspraak')).toHaveCount(1);
  await expect(kaart(tablet, '2026-10-07', AFSPRAAK_WO.titel)).toHaveCount(0);
});
