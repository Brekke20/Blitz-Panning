// Productietests (v2.4.0): de meldgrens per product. Opslaan in Bewerken stuurt `drempel` (null = belletje uit) naar /api/inventaris,
// en na een geslaagde aftrek geeft registreerVerbruik de producten uit het rapport die onder hun grens zitten (de wizard toont ze
// als "Bijna op"; de wizard-afronding zelf is niet bereikbaar in een e2e-test, de tekst staat in tests/voorraad-drempel.test.mjs).
import { test, expect, startAppProductie, verwachtSchrijven, zohoStubs, OPSTART_SCHRIJVEN } from '../productie-hulp.mjs';

const STAND = (versie, tim) => ({ versie, wagenvoorraad: { Tim: tim }, log: [] });
// De prijzen-stub van de fixture heeft een lege catalogus: geef de twee energiemeters mee (zoals in PRIJZEN_DEFAULTS).
const CATALOGUS = [
  { id: 'meter-sdm54-m', naam: 'Energiemeter - Eastron SDM54-M', categorie: 'energiemeter', tags: [], prijs: 160, eenheid: 'stuk' },
  { id: 'meter-sdm72d-m', naam: 'Energiemeter - Eastron SDM72D-M', categorie: 'energiemeter', tags: [], prijs: 160, eenheid: 'stuk' },
];
const prijzen = () => ({ status: 200, json: { versie: 1, bijgewerkt: '2026-10-05T07:00:00.000Z', onderdelen: CATALOGUS, tarieven: [] } });
const BEGIN = { 'meter-sdm54-m': { aantal: 3, gedempt: false, drempel: 0 }, 'meter-sdm72d-m': { aantal: 2, gedempt: false, drempel: 0 } };

function inventarisStub(naPost) {
  const posts = [];
  const stub = ({ methode, body }) => {
    if (methode !== 'POST') return { status: 200, json: STAND(5, BEGIN) };
    posts.push(body);
    return { status: 200, json: naPost(body) };
  };
  return { posts, stub };
}

async function start(page, verzoeken, i) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/inventaris']);
  const z = zohoStubs();
  await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, inventaris: i.stub, prijzen } });
}

test.describe('meldgrens wagenvoorraad', () => {
  test('Bewerken: een grens zetten en een belletje uitzetten stuurt enkel drempel, geen aantal', async ({ page, verzoeken }) => {
    const i = inventarisStub(body => STAND(body.versie + 1, BEGIN));
    await start(page, verzoeken, i);
    await page.locator('#tab-inventaris').click();
    await page.locator('#inv-edit-btn').click();
    await page.locator('.inv-cat-row', { hasText: 'SDM54-M' }).locator('.inv-drempel-input').fill('2');
    await page.locator('.inv-cat-row', { hasText: 'SDM72D-M' }).locator('.inv-bell-btn').click();
    await page.locator('#inv-save-btn').click();
    await expect(page.locator('#toast')).toHaveText('✓ Wagenvoorraad opgeslagen');
    expect(i.posts).toHaveLength(1);
    expect(i.posts[0]).toEqual({
      versie: 5, technieker: 'Tim', actie: 'mutatie',
      items: [
        { materiaalId: 'meter-sdm54-m', materiaalNaam: 'Energiemeter - Eastron SDM54-M', drempel: 2 },
        { materiaalId: 'meter-sdm72d-m', materiaalNaam: 'Energiemeter - Eastron SDM72D-M', drempel: null },
      ],
    });
  });

  test('na een geslaagde aftrek: de producten uit het rapport onder hun grens (enkel die van het rapport)', async ({ page, verzoeken }) => {
    const i = inventarisStub(body => STAND(body.versie + 1, {
      'meter-sdm54-m': { aantal: 1, gedempt: false, drempel: 2 },   // in het rapport, nu bijna op
      'meter-sdm72d-m': { aantal: 0, gedempt: false, drempel: 0 },  // op, maar niet in dit rapport
    }));
    await start(page, verzoeken, i);
    const laag = await page.evaluate(() => window.registreerVerbruik('Tim', [{ id: 'meter-sdm54-m', naam: 'Energiemeter - Eastron SDM54-M', aantal: 2 }], '1001'));
    expect(laag).toEqual([{ id: 'meter-sdm54-m', naam: 'Energiemeter - Eastron SDM54-M', aantal: 1, drempel: 2, status: 'bijna' }]);
    expect(i.posts[0]).toMatchObject({ actie: 'verbruik', ticketNummer: '1001' });
  });

  test('na een aftrek die boven de grens blijft: niets te melden', async ({ page, verzoeken }) => {
    const i = inventarisStub(body => STAND(body.versie + 1, { 'meter-sdm54-m': { aantal: 3, gedempt: false, drempel: 1 } }));
    await start(page, verzoeken, i);
    const laag = await page.evaluate(() => window.registreerVerbruik('Tim', [{ id: 'meter-sdm54-m', naam: 'Energiemeter - Eastron SDM54-M', aantal: 1 }]));
    expect(laag).toEqual([]);
  });
});
