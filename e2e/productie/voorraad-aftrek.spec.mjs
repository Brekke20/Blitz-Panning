// Productietests (etappe 7, Q4): de aftrek van de wagenvoorraad na een verzonden rapport. Mislukt ze, dan krijgt de technieker een
// melding; een ZEKERE mislukking (409, eigen 503, offline) wordt later automatisch opnieuw geprobeerd, een onzekere (netwerkfout,
// time-out, 500/502) nooit (de server heeft geen sleutel per aftrek: een herpoging zou dubbel kunnen aftrekken).
// De wizard roept `window.registreerVerbruik(technieker, onderdelen)` aan; de test doet dat rechtstreeks (wizard ongewijzigd, D19).
import {
  test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, verwachtNetwerkFout, zohoStubs, OPSTART_SCHRIJVEN,
} from '../productie-hulp.mjs';

const toastTekst = (page) => page.locator('#toast');
const ONDERDELEN = [{ id: 'm1', naam: 'Kabel', aantal: 2 }, { id: 'vrij-1', naam: 'Vrije regel', aantal: 1 }];
const WACHTRIJ = 'blitz_verbruik_wachtrij';
const OPSLAG_503 = { error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' };
const leeg = (versie) => ({ versie, wagenvoorraad: {}, log: [] });

// inventaris-stub met een script van antwoorden voor de POST's (de GET's geven de basisstand); `posts` houdt elk body bij.
function inventarisStub(antwoorden) {
  const posts = [];
  const stub = ({ methode, body }) => {
    if (methode !== 'POST') return { status: 200, json: leeg(5) };
    posts.push(body);
    const a = antwoorden.shift();
    return typeof a === 'function' ? a(body) : (a ?? { status: 200, json: leeg(body.versie + 1) });
  };
  return { posts, stub, antwoorden };
}

async function start(page, verzoeken, i) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/inventaris']);
  const z = zohoStubs();
  await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, inventaris: i.stub } });
}
const registreer = (page) => page.evaluate((o) => window.registreerVerbruik('Tim', o), ONDERDELEN);
const wachtrij = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), WACHTRIJ);
const gaOnline = (page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

test.describe('voorraad-aftrek na een rapport', () => {
  test('gelukt: één POST met enkel de echte onderdelen, geen melding, wachtrij leeg', async ({ page, verzoeken }) => {
    const i = inventarisStub([]);
    await start(page, verzoeken, i);
    await registreer(page);
    expect(i.posts).toHaveLength(1);
    expect(i.posts[0]).toMatchObject({ technieker: 'Tim', actie: 'verbruik', items: [{ materiaalId: 'm1', materiaalNaam: 'Kabel', aantal: 2 }] });
    await expect(toastTekst(page)).not.toContainText('Wagenvoorraad');
    expect(await wachtrij(page)).toEqual([]);
  });

  test('409 (versie verouderd): meteen opnieuw met de nieuwe versie, geen melding, precies één aftrek', async ({ page, verzoeken }) => {
    verwachtHttpFout(verzoeken, [{ pad: '/api/inventaris', status: 409 }]);
    const i = inventarisStub([{ status: 409, json: { error: 'gewijzigd', serverVersie: 7, data: leeg(7) } }]);
    await start(page, verzoeken, i);
    await registreer(page);
    expect(i.posts.map(p => p.versie)).toEqual([5, 7]);
    await expect(toastTekst(page)).not.toContainText('Wagenvoorraad');
    expect(await wachtrij(page)).toEqual([]);
  });

  test('eigen 503: melding en wachtrij; bij weer online automatisch gelukt, één aftrek, wachtrij leeg', async ({ page, verzoeken }) => {
    verwachtHttpFout(verzoeken, [{ pad: '/api/inventaris', status: 503 }]);
    const i = inventarisStub([{ status: 503, json: OPSLAG_503 }]);
    await start(page, verzoeken, i);
    await registreer(page);
    await expect(toastTekst(page)).toHaveText('⚠ Wagenvoorraad is niet bijgewerkt. De app probeert het later automatisch opnieuw.');
    expect(await wachtrij(page)).toHaveLength(1);
    await gaOnline(page);
    await expect(toastTekst(page)).toHaveText('✓ Wagenvoorraad alsnog bijgewerkt');
    expect(await wachtrij(page)).toEqual([]);
    expect(i.posts).toHaveLength(2);
    await gaOnline(page);
    await page.evaluate(() => Promise.resolve());
    expect(i.posts).toHaveLength(2); // lege wachtrij: geen derde aftrek
  });

  test('netwerkfout na het verzenden (onzeker): melding, nooit opnieuw proberen', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/inventaris', methode: 'POST' }]);
    const i = inventarisStub([{ afbreken: 'failed' }]);
    await start(page, verzoeken, i);
    await registreer(page);
    await expect(toastTekst(page)).toHaveText('⚠ Onzeker of de wagenvoorraad is bijgewerkt (Geen verbinding met de server). Controleer de voorraad in Inventaris.');
    expect(await wachtrij(page)).toEqual([]);
    await gaOnline(page);
    await page.evaluate(() => Promise.resolve());
    expect(i.posts).toHaveLength(1);
  });

  test('502 van een gateway (onzeker): melding, niet opnieuw', async ({ page, verzoeken }) => {
    verwachtHttpFout(verzoeken, [{ pad: '/api/inventaris', status: 502 }]);
    const i = inventarisStub([{ status: 502, raw: '<html>Bad Gateway</html>' }]);
    await start(page, verzoeken, i);
    await registreer(page);
    await expect(toastTekst(page)).toHaveText('⚠ Onzeker of de wagenvoorraad is bijgewerkt (Serverfout (HTTP 502)). Controleer de voorraad in Inventaris.');
    expect(await wachtrij(page)).toEqual([]);
    expect(i.posts).toHaveLength(1);
  });

  test('een wachtrij uit een vorige sessie wordt bij het openen van de voorraad opnieuw geprobeerd', async ({ page, verzoeken }) => {
    const i = inventarisStub([]);
    await start(page, verzoeken, i);
    await page.evaluate(([k, o]) => localStorage.setItem(k, JSON.stringify([{ id: 'oud', technieker: 'Tim', items: o, aangemaakt: 1, pogingen: 1, bezigTot: null }])),
      [WACHTRIJ, [{ materiaalId: 'm1', materiaalNaam: 'Kabel', aantal: 2 }]]);
    await page.locator('#tab-inventaris').click(); // het openen van de tab laadt de voorraad (en verwerkt daarna de wachtrij)
    await expect(toastTekst(page)).toHaveText('✓ Wagenvoorraad alsnog bijgewerkt');
    expect(await wachtrij(page)).toEqual([]);
    expect(i.posts).toHaveLength(1);
  });
});
