// L1: laadskelet in Kalender, Ingepland en Route zolang de tickets nog onbekend zijn (geen bewaarde kopie, nog geen geslaagde lading).
// Productiemodus (zonder testmodus), volledig gestubd: de scenario's met een bewaarde kopie, een vertraagde poll en een mislukte eerste lading
// bestaan niet in de testmodus (daar komen de tickets altijd na 400 ms uit de dummydata).
//
// Deterministisch: de 150 ms is één JS-timer in app.js (maakTicketsStand) die `data-tickets-laden="zichtbaar"` op <html> zet; CSS toont het
// skelet enkel onder dat attribuut. De nepklok staat stil vanaf vóór de ticketlading (auth-ik wordt vastgehouden tot de klok stilstaat) en
// loopt enkel via page.clock.runFor: "op t = 100 ms" en "op t = 160 ms" zijn dus echte, vaste tijdstippen. Een skelet is "onzichtbaar" als
// zijn dekking 0 is (het staat dan wel in de DOM: de plaats is gereserveerd); toBeVisible telt dekking 0 als zichtbaar en is hier niet bruikbaar.
import {
  test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, OPSTART_SCHRIJVEN, settle, TICKETS_STUB,
} from '../productie-hulp.mjs';

const AUTH_OK = {
  status: 200,
  json: {
    gebruiker: { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder' },
    rechten: { beheer: true, plannen: true, alleSales: true },
    moetWachtwoordWijzigen: false,
    lokaleDev: false,
  },
};
const TAB = {
  wachtrij: /^Wachtrij(\s|,|$)/,
  kalender: /^Kalender(\s|,|$)/,
  route: /^Route(\s|,|$)/,
  gepland: /^Ingepland(\s|,|$)/,
};
const tab = (page, naam) => page.getByRole('tab', { name: TAB[naam] });
const LEEG_INGEPLAND = 'Geen geplande service deze week';
const LEEG_ROUTE = 'Voeg tickets of installaties toe via de Kalender';

// Een belofte die de test zelf vrijgeeft (de stub wacht erop; de stubs draaien in de testprocessen, dus dit is deterministisch).
function poort() {
  let vrij;
  const belofte = new Promise((r) => { vrij = r; });
  return { belofte, vrij };
}
// Een tickets-stub die de eerste `vasthouden` aanvragen laat wachten tot `geef(antwoord)` en daarna direct antwoordt.
function ticketsStub({ vasthouden = 1 } = {}) {
  const wacht = [];
  const t = {
    aanvragen: 0,
    geef(antwoord = { status: 200, json: structuredClone(TICKETS_STUB) }) { while (wacht.length) wacht.shift()(antwoord); },
    stub: () => {
      t.aanvragen++;
      if (t.aanvragen > vasthouden) return { status: 200, json: structuredClone(TICKETS_STUB) };
      return new Promise((r) => wacht.push(r));
    },
  };
  return t;
}

// Zet de nepklok stil op het huidige moment (relatief aan de nepklok zelf, dus ook robuust bij een trage opstart).
const pauzeerKlok = async (page) => {
  const nu = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(nu + 2000));
};

// Start de app met een vastgehouden ticketlading en een stilstaande nepklok. auth-ik wacht tot de klok stilstaat: de opstart (en dus de
// ticketlading en de 150 ms-timer) begint pas daarna. Geeft de stub terug; `geef()` laat de gegevens binnenkomen.
async function startLaden(page, verzoeken, { technieker = 'all', vasthouden = 1, voorStart } = {}) {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  const auth = poort();
  const t = ticketsStub({ vasthouden });
  if (voorStart) await voorStart();
  await startAppProductie(page, {
    technieker,
    wachtOpApp: false,
    overschrijf: { 'auth-ik': async () => { await auth.belofte; return AUTH_OK; }, tickets: t.stub },
  });
  await pauzeerKlok(page);
  auth.vrij();
  await expect.poll(() => t.aanvragen).toBe(1);
  await expect(page.locator('#ticket-list')).toHaveAttribute('aria-busy', 'true'); // loadTickets is gestart
  await page.clock.runFor(1);
  return t;
}

const attribuut = (page) => page.locator('html').evaluate((el) => el.getAttribute('data-tickets-laden'));
const skeletten = (page, waar) => page.locator(`${waar} .skelet--tickets`);
const heeftSkelet = (page, waar) => skeletten(page, waar).count();

test.describe('laadskelet Kalender, Ingepland en Route (L1)', () => {
  test('Kalender: onzichtbaar tot 150 ms, dan een skelet per dag (aria-hidden, aria-busy), nooit "—" of "0/x"; daarna de echte inhoud', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken);
    await tab(page, 'kalender').click();
    await page.clock.runFor(1);
    const kolommen = page.locator('#week-grid .day-col[data-date]'); // de uren-kolom (gutter) heeft er geen
    const aantalDagen = await kolommen.count();
    expect(aantalDagen).toBeGreaterThanOrEqual(5);
    // t ≈ 0: de plaats is gereserveerd, maar niets is zichtbaar.
    expect(await attribuut(page)).toBeNull();
    await expect(page.locator('#week-grid > .skelet-melding--tickets')).toHaveCount(1);
    await expect(page.locator('#week-grid .day-body > .skelet--tickets')).toHaveCount(aantalDagen);
    await expect(page.locator('#week-grid .day-body > .skelet--tickets').first()).toHaveCSS('opacity', '0');
    await expect(page.locator('#week-grid')).toHaveAttribute('aria-busy', 'true');
    // t = 100 ms: nog steeds niet.
    await page.clock.runFor(100);
    expect(await attribuut(page)).toBeNull();
    await expect(page.locator('#week-grid .day-body > .skelet--tickets').first()).toHaveCSS('opacity', '0');
    // t = 160 ms: zichtbaar.
    await page.clock.runFor(60);
    expect(await attribuut(page)).toBe('zichtbaar');
    await expect(page.locator('#week-grid .day-body > .skelet--tickets').first()).toHaveCSS('opacity', '1');
    await expect(page.locator('#week-grid .day-body > .skelet--tickets').first()).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#week-grid > .skelet-melding--tickets')).toHaveAttribute('role', 'status');
    await expect(page.locator('#week-grid > .skelet-melding--tickets')).toHaveText('Laden…');
    await expect(page.locator('#week-grid .day-empty')).toHaveCount(0); // geen "—" per dag
    expect((await page.locator('#week-grid .day-cap').allInnerTexts()).join(' ')).not.toMatch(/\d\s*\/\s*\d/); // geen "0/x" in de capaciteitskop
    // De gegevens komen binnen: de echte inhoud, geen skelet, geen aria-busy, het attribuut weg.
    t.geef();
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    await expect(page.locator('#week-grid .skelet')).toHaveCount(0);
    await expect(page.locator('#week-grid .skelet-melding--tickets')).toHaveCount(0);
    await expect(page.locator('#week-grid')).not.toHaveAttribute('aria-busy', /.*/);
    expect(await attribuut(page)).toBeNull();
    await expect(page.locator('#week-grid .day-cap').first()).toContainText(/\d\s*\/\s*\d/);
    await settle(page);
  });

  test('een snelle lading (binnen 150 ms) toont nooit een zichtbaar skelet', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken);
    await tab(page, 'kalender').click();
    await page.clock.runFor(1);
    await page.clock.runFor(100);
    t.geef();
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    await page.clock.runFor(500); // ruim voorbij 150 ms: de timer is opgeruimd en zet niets meer
    expect(await attribuut(page)).toBeNull();
    await expect(page.locator('.skelet--tickets')).toHaveCount(0);
    await settle(page);
  });

  test('Ingepland: skelet in plaats van "Geen geplande service deze week", daarna de echte lege staat (ook na tab weg en terug)', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken, { technieker: 'Roel' }); // Roel heeft deze week niets gepland
    await tab(page, 'gepland').click();
    await page.clock.runFor(1);
    const lijst = page.locator('#gep-body');
    await expect(lijst.locator('.skelet--tickets')).toHaveCount(1);
    await expect(lijst.locator('.skelet--tickets')).toHaveCSS('opacity', '0');
    await expect(lijst).toHaveAttribute('aria-busy', 'true');
    await page.clock.runFor(160);
    await expect(lijst.locator('.skelet--tickets')).toHaveCSS('opacity', '1');
    await expect(lijst.locator('.skelet--tickets')).toHaveAttribute('aria-hidden', 'true');
    await expect(lijst.locator('.skelet-melding--tickets')).toHaveCount(1);
    await expect(lijst).not.toContainText(LEEG_INGEPLAND);
    t.geef();
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    await expect(lijst).toContainText(LEEG_INGEPLAND);
    await expect(lijst.locator('.skelet')).toHaveCount(0);
    await expect(lijst).not.toHaveAttribute('aria-busy', /.*/);
    // C-L1-1: tab weg en terug (O3 tekent enkel opnieuw als er iets veranderde): nog steeds de lege staat, nooit een oud skelet.
    await tab(page, 'wachtrij').click();
    await page.clock.runFor(1);
    await tab(page, 'gepland').click();
    await page.clock.runFor(1);
    await expect(lijst).toContainText(LEEG_INGEPLAND);
    await expect(lijst.locator('.skelet')).toHaveCount(0);
    await settle(page);
  });

  test('Kalender: een technieker zonder tickets deze week krijgt na de lading de echte lege dagen ("—"), ook na tab weg en terug', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken, { technieker: 'Roel' });
    await tab(page, 'kalender').click();
    await page.clock.runFor(1);
    await page.clock.runFor(160);
    await expect(page.locator('#week-grid .day-body > .skelet--tickets').first()).toHaveCSS('opacity', '1');
    t.geef();
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    await expect(page.locator('#week-grid .skelet')).toHaveCount(0);
    expect(await page.locator('#week-grid .day-empty').count()).toBeGreaterThanOrEqual(5);
    await tab(page, 'wachtrij').click();
    await page.clock.runFor(1);
    await tab(page, 'kalender').click();
    await page.clock.runFor(1);
    await expect(page.locator('#week-grid .skelet')).toHaveCount(0);
    expect(await page.locator('#week-grid .day-empty').count()).toBeGreaterThanOrEqual(5);
    await settle(page);
  });

  test('Route: skelet in de lijst in plaats van "Voeg tickets ... toe" (de kaart blijft), daarna de echte lege staat', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken, { technieker: 'Roel' });
    await tab(page, 'route').click();
    await page.clock.runFor(1);
    const lijst = page.locator('#route-list');
    await expect(lijst.locator('.skelet--tickets')).toHaveCount(1);
    await expect(lijst.locator('.skelet--tickets')).toHaveCSS('opacity', '0');
    await expect(lijst).toHaveAttribute('aria-busy', 'true');
    await expect(lijst).not.toContainText('Voeg tickets'); // ook de vaste beginregel van index.html staat er niet meer
    await page.clock.runFor(160);
    await expect(lijst.locator('.skelet--tickets')).toHaveCSS('opacity', '1');
    await expect(lijst.locator('.skelet-melding--tickets')).toHaveCount(1);
    await expect(page.locator('#map-wrap')).toBeVisible();
    t.geef();
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    await expect(lijst).toContainText(LEEG_ROUTE);
    await expect(lijst.locator('.skelet')).toHaveCount(0);
    await expect(lijst).not.toHaveAttribute('aria-busy', /.*/);
    await settle(page);
  });

  test('met een bewaarde kopie van de tickets: nooit een skelet, ook niet na 250 ms met een nog vastgehouden lading', async ({ page, verzoeken }) => {
    const kopie = structuredClone(TICKETS_STUB);
    const t = await startLaden(page, verzoeken, {
      technieker: 'Roel',
      voorStart: () => page.addInitScript((k) => { if (window === window.top) localStorage.setItem('blitz_tickets_cache', JSON.stringify(k)); }, kopie),
    });
    // De kopie staat al op het scherm (de Wachtrij toont Roels ticket) terwijl de verse lading nog onderweg is.
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    await tab(page, 'kalender').click();
    await page.clock.runFor(250);
    expect(await attribuut(page)).toBeNull();
    await expect(page.locator('#week-grid .skelet')).toHaveCount(0);
    expect(await page.locator('#week-grid .day-empty').count()).toBeGreaterThanOrEqual(5);
    await tab(page, 'gepland').click();
    await page.clock.runFor(1);
    await expect(page.locator('#gep-body')).toContainText(LEEG_INGEPLAND);
    await expect(page.locator('#gep-body .skelet')).toHaveCount(0);
    await tab(page, 'route').click();
    await page.clock.runFor(1);
    await expect(page.locator('#route-list')).toContainText(LEEG_ROUTE);
    await expect(page.locator('#route-list .skelet')).toHaveCount(0);
    t.geef();
    await settle(page);
  });

  test('een poll met een vertraagd antwoord toont nooit een skelet: de bestaande gegevens blijven staan', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken, { technieker: 'Tim', vasthouden: 2 });
    t.geef(); // de eerste lading slaagt
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    await settle(page);
    await tab(page, 'kalender').click();
    await page.clock.runFor(1);
    const voor = await page.locator('#week-grid .cal-ticket').count();
    expect(voor).toBeGreaterThan(0);
    // 5,5 minuten later vraagt de poll de tickets opnieuw; dat antwoord blijft hangen.
    await page.clock.runFor(5.5 * 60 * 1000);
    await expect.poll(() => t.aanvragen).toBe(2);
    await page.clock.runFor(1000);
    expect(await attribuut(page)).toBeNull();
    await expect(page.locator('.skelet--tickets')).toHaveCount(0);
    await expect(page.locator('#week-grid .cal-ticket')).toHaveCount(voor);
    await expect(page.locator('#week-grid')).not.toHaveAttribute('aria-busy', /.*/);
    t.geef();
    await settle(page);
  });

  test('een mislukte eerste lading zonder kopie: het skelet maakt plaats voor de lege staat en de bestaande foutmelding', async ({ page, verzoeken }) => {
    verwachtHttpFout(verzoeken, [{ pad: '/api/tickets', status: 500 }]);
    const t = await startLaden(page, verzoeken, { technieker: 'Roel' });
    await tab(page, 'gepland').click();
    await page.clock.runFor(1);
    await page.clock.runFor(160);
    const lijst = page.locator('#gep-body');
    await expect(lijst.locator('.skelet--tickets')).toHaveCSS('opacity', '1');
    t.geef({ status: 500, json: { error: 'x' } });
    await expect(page.locator('#empty-tickets')).toContainText('Kon tickets niet laden');
    await expect(lijst).toContainText(LEEG_INGEPLAND);
    await expect(lijst.locator('.skelet')).toHaveCount(0);
    await expect(lijst).not.toHaveAttribute('aria-busy', /.*/);
    expect(await attribuut(page)).toBeNull();
    // De andere schermen ook: Kalender en Route tekenen hun lege staat (Kalender via de O3-markering bij het openen).
    await tab(page, 'kalender').click();
    await page.clock.runFor(1);
    await expect(page.locator('#week-grid .skelet')).toHaveCount(0);
    expect(await page.locator('#week-grid .day-empty').count()).toBeGreaterThanOrEqual(5);
    await tab(page, 'route').click();
    await page.clock.runFor(1);
    await expect(page.locator('#route-list')).toContainText(LEEG_ROUTE);
    await expect(page.locator('#route-list .skelet')).toHaveCount(0);
    await settle(page);
  });

  test('reduced motion: het skelet wordt WEL zichtbaar (stap in dekking) en de blokken hebben geen animatie', async ({ page, verzoeken }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const t = await startLaden(page, verzoeken, { technieker: 'Roel' });
    await tab(page, 'gepland').click();
    await page.clock.runFor(1);
    const sk = page.locator('#gep-body .skelet--tickets');
    await expect(sk).toHaveCSS('opacity', '0');
    await page.clock.runFor(250);
    await expect(sk).toHaveCSS('opacity', '1');
    expect(await sk.locator('.skelet-blok').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    t.geef();
    await settle(page);
  });

  test('de paginakop (breed) beweert tijdens het laden niets over "niets gepland"', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken, { technieker: 'Roel' });
    await tab(page, 'kalender').click();
    await page.clock.runFor(1);
    await expect(page.locator('#paginasub')).not.toContainText('nog niets gepland');
    await tab(page, 'gepland').click();
    await page.clock.runFor(1);
    await expect(page.locator('#paginasub')).not.toContainText('Geen afspraken deze week');
    t.geef();
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    await expect(page.locator('#paginasub')).toContainText('Geen afspraken deze week');
    await settle(page);
  });

  // ── Geen lay-outsprong ──
  // De balk boven de lijst blijft staan en de eerste echte kaart begint op dezelfde hoogte (± 2 px) als het eerste skeletkaartje, met
  // dezelfde breedte. Voor de Kalender op de computer geldt dat enkel voor de kop: de tijdlijn zet echte kaarten op uurposities, dus een
  // skeletkaartje bovenaan de dagkolom heeft daar geen tegenhanger op dezelfde hoogte.
  const doos = (locator) => locator.first().evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, b: r.width, h: r.height }; });
  const dichtbij = (a, b, marge = 2) => expect(Math.abs(a - b), `${a} tegen ${b}`).toBeLessThanOrEqual(marge);

  test('Ingepland: de weekbalk blijft staan en de eerste echte kaart begint waar het eerste skeletkaartje stond', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken, { technieker: 'Tim' });
    await tab(page, 'gepland').click();
    await page.clock.runFor(1);
    await page.clock.runFor(160);
    const sk = page.locator('#gep-body .skelet-kaart');
    await expect(sk.first()).toBeVisible();
    const balkVoor = await doos(page.locator('.gep-week'));
    const skeletKaart = await doos(sk);
    t.geef();
    const echt = page.locator('#gep-body .ticket');
    await expect(echt.first()).toBeVisible();
    await expect(page.locator('#gep-body .skelet')).toHaveCount(0);
    const balkNa = await doos(page.locator('.gep-week'));
    const echteKaart = await doos(echt);
    for (const k of ['x', 'y', 'b', 'h']) dichtbij(balkVoor[k], balkNa[k]);
    dichtbij(skeletKaart.y, echteKaart.y);
    dichtbij(skeletKaart.x, echteKaart.x);
    dichtbij(skeletKaart.b, echteKaart.b);
    await settle(page);
  });

  test('Route: de lijst blijft op zijn plaats en de eerste echte stop begint waar het eerste skeletkaartje stond', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken, { technieker: 'Tim' });
    await page.evaluate(() => kern.toestand.set('gekozenDatum', '2026-10-07')); // woensdag: daar staat p1 (wacht op bevestiging)
    await tab(page, 'route').click();
    await page.clock.runFor(1);
    await page.clock.runFor(160);
    const sk = page.locator('#route-list .skelet-kaart');
    await expect(sk.first()).toBeVisible();
    const lijstVoor = await doos(page.locator('#route-list'));
    const skeletKaart = await doos(sk);
    t.geef();
    const echt = page.locator('#route-list .stop');
    await expect(echt.first()).toBeVisible();
    await expect(page.locator('#route-list .skelet')).toHaveCount(0);
    const lijstNa = await doos(page.locator('#route-list'));
    const echteKaart = await doos(echt);
    for (const k of ['x', 'y', 'b', 'h']) dichtbij(lijstVoor[k], lijstNa[k]);
    dichtbij(skeletKaart.y, echteKaart.y);
    dichtbij(skeletKaart.x, echteKaart.x);
    dichtbij(skeletKaart.b, echteKaart.b);
    await settle(page);
  });

  test('Kalender: de kop (weekbalk en dagkoppen) verspringt niet wanneer de gegevens binnenkomen', async ({ page, verzoeken }) => {
    const t = await startLaden(page, verzoeken, { technieker: 'Tim' });
    await tab(page, 'kalender').click();
    await page.clock.runFor(1);
    await page.clock.runFor(160);
    await expect(page.locator('#week-grid .day-body > .skelet--tickets').first()).toHaveCSS('opacity', '1');
    const balkVoor = await doos(page.locator('.kal-header'));
    const dagkopVoor = await doos(page.locator('#week-grid .day-col[data-date] .day-hdr'));
    const rasterVoor = await doos(page.locator('#week-grid'));
    t.geef();
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    await expect(page.locator('#week-grid .skelet')).toHaveCount(0);
    const balkNa = await doos(page.locator('.kal-header'));
    const dagkopNa = await doos(page.locator('#week-grid .day-col[data-date] .day-hdr'));
    const rasterNa = await doos(page.locator('#week-grid'));
    for (const k of ['x', 'y', 'b', 'h']) dichtbij(balkVoor[k], balkNa[k]);
    for (const k of ['x', 'y', 'b', 'h']) dichtbij(dagkopVoor[k], dagkopNa[k]);
    dichtbij(rasterVoor.y, rasterNa.y);
    await settle(page);
  });
});
