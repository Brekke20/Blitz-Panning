// Productietests: de knop "Bevestigd per mail" in het ticketdetail (ticketdetail.js, bevestigPerMail) zonder testmodus, met de exacte payload
// van POST /api/bevestig-handmatig. De knop staat enkel bij een ticket dat nog op de klant wacht ('Wachten op bevestiging planning'), vraagt
// eerst een bevestiging (appConfirm) en zet het ticket daarna lokaal bij "Bevestigd" (Geplande support) met het label "✓ Bevestigd per mail".
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, zohoStubs, OPSTART_SCHRIJVEN, settle, openKalender } from '../productie-hulp.mjs';

const START = 'POST /api/planning-sinds';
const BEVESTIG = 'POST /api/bevestig-handmatig';

const schrijfLijst = async (page, verzoeken) => {
  await settle(page);
  return verzoeken.alle.filter(r => r.methode !== 'GET').map(r => `${r.methode} ${r.pad}`);
};
const lijstenVan = (page) => page.evaluate(() => ({
  pending: kern.toestand.get('allPending').map(t => t.id),
  gepland: kern.toestand.get('allGepland').map(t => t.id),
}));
const statusVan = (page, id) => page.evaluate((i) => {
  const t = [...kern.toestand.get('allPending'), ...kern.toestand.get('allGepland'), ...kern.toestand.get('allTickets')].find(x => x.id === i);
  return t?.status ?? null;
}, id);
const toastTekst = (page) => page.locator('#toast');
const dag = (page, datum) => page.locator(`.day-col[data-date="${datum}"]`);
const knop = (page) => page.locator('#d-btn-bevestig-mail');

// Gemeten bij VASTE_NU (maandag 5 okt 2026): p1 (#1004) wacht op bevestiging (wo 7 okt), g1 is al gepland (vr 9 okt), t1 staat in de wachtrij.
const SEED = { versie: 4, status: { p1: { contact: '2026-10-04T08:00:00.000Z', tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-07' } } };

async function start(page, verzoeken, { paden = [], httpFouten = [] } = {}) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, ...paden]);
  if (httpFouten.length) verwachtHttpFout(verzoeken, httpFouten);
  const z = zohoStubs({ register: SEED });
  await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: z.overschrijf });
  return z;
}
async function openP1(page) {
  await openKalender(page);
  await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-sub').click();
  await expect(page.locator('#det-overlay')).toHaveClass(/open/);
}

test.describe('Bevestigd per mail', () => {
  test('de knop staat enkel bij "Wachten op bevestiging planning"', async ({ page, verzoeken }) => {
    await start(page, verzoeken);
    await openP1(page);
    await expect(knop(page)).toBeVisible();
    await expect(knop(page)).toHaveText(/Bevestigd per mail/);
    await page.locator('#det-overlay .mhdr-close').click();
    // Een al gepland ticket (g1) heeft de knop niet meer.
    await dag(page, '2026-10-09').locator('.tl-ticket[data-ticket-id="g1"] .cal-sub').click();
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    await expect(knop(page)).toBeHidden();
  });

  test('bevestigen: eerst een dialoog, dan POST met ticketId, het ticket staat bij Bevestigd en toont "✓ Bevestigd per mail"', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/bevestig-handmatig'] });
    await openP1(page);
    expect(await lijstenVan(page)).toEqual({ pending: ['p1', 'p2'], gepland: ['g1'] });
    await knop(page).click();

    const dialoog = page.getByRole('alertdialog', { name: 'Ticket #1004 bevestigd per mail?' });
    await expect(dialoog).toBeVisible();
    await expect(dialoog).toContainText('Geplande support');
    expect(z.opnames['bevestig-handmatig']).toEqual([]); // niets vóór de bevestiging
    await dialoog.getByRole('button', { name: 'Ja, bevestigd per mail' }).click();

    await expect(toastTekst(page)).toHaveText('✓ Ticket #1004 bevestigd per mail');
    expect(z.opnames['bevestig-handmatig']).toEqual([{ methode: 'POST', body: { ticketId: 'p1' }, query: {} }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, BEVESTIG]);
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
    expect(await lijstenVan(page)).toEqual({ pending: ['p2'], gepland: ['g1', 'p1'] });
    expect(await statusVan(page, 'p1')).toBe('Geplande support');

    // Het detail toont nu het label (register: door mail) en de knop is weg.
    await openKalender(page);
    await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-sub').click();
    await expect(page.locator('#d-tags .mtag.confirmed-by')).toHaveText('✓ Bevestigd per mail');
    await expect(knop(page)).toBeHidden();
  });

  test('Terug in de dialoog: geen verzoek en alles blijft zoals het was', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/bevestig-handmatig'] });
    await openP1(page);
    await knop(page).click();
    const dialoog = page.getByRole('alertdialog', { name: 'Ticket #1004 bevestigd per mail?' });
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(dialoog).toBeHidden();
    await settle(page);
    expect(z.opnames['bevestig-handmatig']).toEqual([]);
    expect(await lijstenVan(page)).toEqual({ pending: ['p1', 'p2'], gepland: ['g1'] });
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
  });

  test('409 (het ticket staat intussen niet meer op wachten): toast met de servertekst, niets lokaal gewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/bevestig-handmatig'], httpFouten: [{ pad: '/api/bevestig-handmatig', status: 409 }] });
    z.zetAntwoord('bevestig-handmatig', { status: 409, json: { error: 'Dit ticket staat niet (meer) op "Wachten op bevestiging planning" in Zoho (status: Geplande support). Herlaad de planner.', zohoStatus: 'Geplande support' } });
    await openP1(page);
    await knop(page).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ja, bevestigd per mail' }).click();
    await expect(toastTekst(page)).toContainText('staat niet (meer) op "Wachten op bevestiging planning"');
    expect(await lijstenVan(page)).toEqual({ pending: ['p1', 'p2'], gepland: ['g1'] });
    expect(await statusVan(page, 'p1')).toBe('Wachten op bevestiging planning');
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    await expect(knop(page)).toBeEnabled();
  });
});
