import { test, expect } from './helpers.mjs';
import { startSalesApp, SALES_GEBRUIKER, kiesVerkoper } from './sales-hulp.mjs';

// De werkbalk van de Route-tab van de verkoper: dezelfde als bij de technieker (datum, ⚡ Optimaliseer, Bereken tijden, ✕ Leeg), met de weekstrook eronder.
// Klok: maandag 5 okt 2026 09:00. De matrix is hier afstandsgebonden (0,01 graad = 7 min) zodat de beste volgorde duidelijk is. Alle namen zijn verzonnen.
const DAG = '2026-10-05';
const route = (page) => page.locator('#view-sales-route');
const rijen = (page) => route(page).locator('.sales-route-lijst > .sales-route-rij:not(.sales-route-depot)');
const toast = (page) => page.locator('#toast');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const naarRoute = async (page) => { await tab(page, 'Route').click(); await expect(route(page)).toHaveClass(/active/); };
const optimaliseer = (page) => route(page).getByRole('button', { name: '⚡ Optimaliseer' });
const bereken = (page) => route(page).getByRole('button', { name: 'Bereken tijden' });
const leeg = (page) => route(page).getByRole('button', { name: '✕ Leeg' });
const dialoog = (page) => page.getByRole('alertdialog');

const lead = (id, naam, lon, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon, bron: 'adres' }, status: 'te-plannen', bezoeken: [], duurMin: 30,
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const plan = (id, naam, lon, start, extra = {}) => {
  const { datum = DAG, vast = false, ...rest } = extra;
  return lead(id, naam, lon, { status: vast ? 'bevestigd' : 'voorgesteld', planning: { datum, start, vast }, ...rest });
};
const DEPOT_LON = 5.34;
// Ver (+0,10) om 09:00, dichtbij (+0,01) om 10:00, midden (+0,05) om 11:00, en een bevestigd bezoek (+0,03) om 13:00.
const DAGLEADS = () => [
  plan('ver', 'Ver', DEPOT_LON + 0.10, '09:00'),
  plan('dicht', 'Dichtbij', DEPOT_LON + 0.01, '10:00'),
  plan('mid', 'Midden', DEPOT_LON + 0.05, '11:00'),
  plan('vast', 'Vast', DEPOT_LON + 0.03, '13:00', { vast: true }),
];
const INSTELLING = { startlocatie: 'Depotstraat 1, 3500 Hasselt', vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00' };
const metDepot = (page) => page.addInitScript(({ adres, lat, lon }) => {
  if (window !== window.top) return;
  localStorage.setItem('blitz_geocache', JSON.stringify({ [adres.toLowerCase()]: { lat, lon, t: Date.now() } }));
}, { adres: INSTELLING.startlocatie, lat: 50.93, lon: DEPOT_LON });
const matrixStub = ({ body }) => ({
  status: 200,
  json: {
    results: (body?.destinations ?? []).map((d) => {
      const min = Math.round((Math.abs(d.lat - body.origin.lat) + Math.abs(d.lon - body.origin.lon)) * 700);
      return { travelTimeSeconds: min * 60, distanceMeters: min * 1000 };
    }),
  },
});
const start = async (page, extra = {}) => {
  await metDepot(page);
  await startSalesApp(page, { leads: DAGLEADS(), instellingen: INSTELLING, overschrijf: { matrix: matrixStub }, viewport: { width: 1280, height: 800 }, ...extra });
  await naarRoute(page);
  await expect(rijen(page)).toHaveCount(extra.leads ? extra.leads.length : 4);
};
const uren = async (page) => Object.fromEntries(await rijen(page).evaluateAll((els) => els.map((e) => [e.querySelector('.sales-route-naam').textContent.replace('Test ', ''), e.querySelector('.sales-route-uur').textContent.split(' · ')[0]])));
const volgorde = async (page) => (await rijen(page).locator('.sales-route-naam').allTextContents()).map((t) => t.replace('Test ', ''));

test.describe('sales: werkbalk van de Route-tab', () => {
  test('dezelfde werkbalk als de technieker: één balk met 📅, de weekstrook en ⚡ Optimaliseer, Bereken tijden, ✕ Leeg', async ({ page }) => {
    await start(page);
    const balk = route(page).locator('.route-balk');
    await expect(balk).toHaveCount(1);
    await expect(route(page).locator('.plan-header')).toHaveCount(0);
    await expect(balk.locator('input[type="date"]')).toHaveCount(1);
    await expect(balk.getByRole('button', { name: 'Andere datum kiezen' })).toBeVisible();
    await expect(balk.locator('.route-balk-acties button')).toHaveText(['⚡ Optimaliseer', 'Bereken tijden', '✕ Leeg']);
    await expect(optimaliseer(page)).toHaveClass(/btn-primary/);
    await expect(bereken(page)).toHaveClass(/btn-sec/);
    await expect(leeg(page)).toHaveClass(/btn-sec/);
    // Eén regel: de weekstrook staat IN de balk, naast de knoppen (niet eronder), en de balk is één rij hoog.
    const b = await balk.boundingBox();
    const strook = await balk.locator('.week-strip').boundingBox();
    const knop = await optimaliseer(page).boundingBox();
    expect(strook.y).toBeGreaterThanOrEqual(b.y);
    expect(strook.y + strook.height).toBeLessThanOrEqual(b.y + b.height + 1);
    expect(knop.x).toBeGreaterThan(strook.x + strook.width - 1); // de knoppen staan rechts van de strook
    expect(b.height).toBeLessThanOrEqual(60);
    await expect(route(page).locator('.plan-summary')).toContainText('4 bezoeken');
  });

  test('📅 opent de datumkiezer van het onzichtbare datumveld; een andere datum kiezen zet de dag', async ({ page }) => {
    await start(page);
    await page.evaluate(() => { window.__picker = 0; HTMLInputElement.prototype.showPicker = function () { window.__picker++; }; });
    await route(page).getByRole('button', { name: 'Andere datum kiezen' }).click();
    expect(await page.evaluate(() => window.__picker)).toBe(1);
    const veld = route(page).locator('.route-datum-veld');
    await veld.fill('2026-10-07');
    await expect(route(page).locator('.week-strip .ws-dag.actief .ws-naam')).toHaveText('WO 7');
  });

  test('Bereken tijden: de route en de rijtijden worden opnieuw berekend (extra /api/route-aanvraag), er wordt niets bewaard', async ({ page, verzoeken }) => {
    await start(page);
    await expect.poll(() => verzoeken.van('/api/route', 'POST').length).toBe(1);
    await bereken(page).click();
    await expect.poll(() => verzoeken.van('/api/route', 'POST').length).toBe(2);
    await expect(toast(page)).toContainText('Route berekend ✓');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
  });

  test('⚡ Optimaliseer: kortste volgorde, het bevestigde bezoek blijft op zijn uur, één PATCH zonder het bevestigde bezoek, toast met wat er veranderde', async ({ page, verzoeken }) => {
    await start(page);
    expect(await volgorde(page)).toEqual(['Ver', 'Dichtbij', 'Midden', 'Vast']);
    await optimaliseer(page).click();
    await expect(toast(page)).toContainText('Route geoptimaliseerd: 3 bezoeken herordend');
    await expect(toast(page)).toContainText('1 bevestigd bezoek blijft op zijn uur');
    // Dichtbij -> Midden -> Ver -> (vast om 13:00); het bevestigde uur is ongewijzigd en de rest staat in de nieuwe volgorde.
    await expect.poll(() => volgorde(page)).toEqual(['Dichtbij', 'Midden', 'Ver', 'Vast']);
    const u = await uren(page);
    expect(u.Vast).toBe('13:00');
    expect(u.Dichtbij < u.Midden && u.Midden < u.Ver && u.Ver < u.Vast).toBe(true);
    expect(u.Dichtbij >= '08:00').toBe(true);
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body.leads.map((l) => l.id).sort()).toEqual(['dicht', 'mid', 'ver']); // het bevestigde bezoek zit er nooit in
    for (const l of patches[0].body.leads) expect(l.velden).toMatchObject({ status: 'voorgesteld', planning: { datum: DAG, vast: false } });
  });

  test('⚡ Optimaliseer is uitgeschakeld bij minder dan 2 verschuifbare bezoeken', async ({ page }) => {
    await start(page, { leads: [plan('a', 'Alfa', DEPOT_LON + 0.02, '09:00'), plan('v', 'Vast', DEPOT_LON + 0.03, '13:00', { vast: true })] });
    await expect(optimaliseer(page)).toBeDisabled();
    await expect(leeg(page)).toBeEnabled();
    await expect(bereken(page)).toBeEnabled();
  });

  test('een al optimale dag: toast "niets gewijzigd" en geen PATCH', async ({ page, verzoeken }) => {
    await start(page);
    await optimaliseer(page).click();
    await expect.poll(() => verzoeken.van('/api/sales', 'PATCH').length).toBe(1);
    await optimaliseer(page).click();
    await expect(toast(page)).toContainText('niets gewijzigd');
    expect(verzoeken.van('/api/sales', 'PATCH')).toHaveLength(1);
  });

  test('✕ Leeg: bevestiging eerst; annuleren doet niets; bevestigen zet enkel de niet-vaste bezoeken terug (één PATCH) en meldt het bevestigde bezoek', async ({ page, verzoeken }) => {
    await start(page);
    await leeg(page).click();
    await expect(dialoog(page)).toContainText('3 bezoeken van ma 5 okt terug naar Nog in te plannen?');
    await dialoog(page).getByRole('button', { name: 'Terug', exact: true }).click();
    await expect(dialoog(page)).toHaveCount(0);
    await expect(rijen(page)).toHaveCount(4);
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);

    await leeg(page).click();
    await dialoog(page).getByRole('button', { name: 'Terugzetten' }).click();
    await expect(rijen(page)).toHaveCount(1);
    await expect(rijen(page).locator('.sales-route-naam')).toHaveText(['Test Vast']);
    await expect(toast(page)).toContainText('1 bevestigd bezoek niet verwijderd — zet ze afzonderlijk terug');
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body.leads.map((l) => l.id).sort()).toEqual(['dicht', 'mid', 'ver']);
    for (const l of patches[0].body.leads) expect(l.velden).toMatchObject({ status: 'te-plannen', planning: null });
    // De teruggezette bezoeken staan weer bij "Nog in te plannen".
    await tab(page, 'Leads').click();
    await expect(page.locator('#view-sales-lijst').getByRole('heading', { name: 'Nog in te plannen (3)' })).toBeVisible();
  });

  test('✕ Leeg met enkel bevestigde bezoeken: geen bevestiging, enkel de toast', async ({ page, verzoeken }) => {
    await start(page, { leads: [plan('v1', 'Vast1', DEPOT_LON + 0.02, '09:00', { vast: true }), plan('v2', 'Vast2', DEPOT_LON + 0.03, '13:00', { vast: true })] });
    await leeg(page).click();
    await expect(dialoog(page)).toHaveCount(0);
    await expect(toast(page)).toContainText('2 bevestigde bezoeken niet verwijderd — zet ze afzonderlijk terug');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
    await expect(rijen(page)).toHaveCount(2);
  });

  test('alleen-lezen weergave (een collega bekijken): Optimaliseer en Leeg zijn verborgen, Bereken tijden blijft', async ({ page }) => {
    const gebruiker = { ...SALES_GEBRUIKER, magAlleSales: true };
    await metDepot(page);
    await startSalesApp(page, {
      gebruiker, overschrijf: { matrix: matrixStub }, viewport: { width: 1280, height: 800 },
      blobs: { 'sales/u-bea': { versie: 1, leads: DAGLEADS(), blokken: [], grafstenen: [] } },
    });
    await naarRoute(page);
    await expect(optimaliseer(page)).toBeVisible(); // de eigen agenda: wel (ook zonder bezoeken staat de werkbalk er)
    await kiesVerkoper(page, 'u-bea');
    await expect(rijen(page)).toHaveCount(4);
    await expect(optimaliseer(page)).toBeHidden();
    await expect(leeg(page)).toBeHidden();
    await expect(bereken(page)).toBeVisible();
    await expect(bereken(page)).toBeEnabled();
  });
});
