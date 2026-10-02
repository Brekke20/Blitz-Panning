// Productietests (etappe 5a, taak 3): afspraak annuleren (openAnnuleerVenster, annuleerVoorbeeld, verstuurAnnulatie)
// zonder testmodus, met de exacte payloads van GET/POST /api/annuleer (de echte POST mailt de klant en zet het
// ticket in Zoho terug op "Wachten op planning"). Karakterisering: het huidige gedrag staat vast, ook de
// eigenaardigheden (gemarkeerd met HUIDIG GEDRAG (bug?)). Alle uitgaande schrijfverzoeken worden per test exact
// opgesomd (`schrijfLijst`). Echte foutvormen (netlify/functions/annuleer.js): 400/404/500 met `{ error }`, 409
// `{ error, emailSent, nietGepland: true }` (mail gevraagd maar ticket niet meer gepland in Zoho), 502
// `{ error, emailSent, fouten }` (Zoho-PATCH mislukt, mails kunnen al weg zijn), een Netlify-gateway-502 met HTML-body.
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, verwachtNetwerkFout, zohoStubs, OPSTART_SCHRIJVEN, settle, laatMailControleHerhalen, mailCheckQuery, openKalender } from '../productie-hulp.mjs';

const START = 'POST /api/planning-sinds';
const ANNULEER = 'POST /api/annuleer';

const schrijfLijst = async (page, verzoeken) => {
  await settle(page);
  return verzoeken.alle.filter(r => r.methode !== 'GET').map(r => `${r.methode} ${r.pad}`);
};
const planningVan = (page) => page.evaluate(() => Object.fromEntries(
  Object.entries(kern.toestand.get('planning')).map(([d, s]) => [d, s.map(p => p.ticket.id)])));
const lijstenVan = (page) => page.evaluate(() => ({
  tickets: kern.toestand.get('allTickets').map(t => t.id),
  pending: kern.toestand.get('allPending').map(t => t.id),
}));
// `voorstelStatus` leeft in kern.toestand (niet meer als kale naam bereikbaar): lees een kopie via de toestand.
const registerLokaal = (page) => page.evaluate(() => JSON.parse(JSON.stringify(kern.toestand.get('voorstelStatus'))));
const dag = (page, datum) => page.locator(`.day-col[data-date="${datum}"]`);
const toastTekst = (page) => page.locator('#toast');
const venster = (page) => page.locator('#annuleer-modal');
const verstuurKnop = (page) => page.locator('#annuleer-verstuur');
const annuleerPosts = (z, soort) => z.opnames.annuleer.filter(o => o.methode === 'POST' && (soort === 'voorbeeld' ? o.body.voorbeeld === true : o.body.voorbeeld !== true));

// Gemeten bij VASTE_NU (maandag 5 okt 2026, Europe/Brussels, UTC+2): p1 (#1004) staat op wo 7 okt.
const BASIS_PLANNING = { '2026-10-07': ['p1'], '2026-10-09': ['g1'] };
// Lopend voorstel voor #1004: register-entry met tijdslot dat voor de geplande dag geldt.
const TIJDSLOT = '09:30–12:30';
const SEED = { versie: 4, status: { p1: { contact: '2026-10-04T08:00:00.000Z', tijdslot: TIJDSLOT, tijdslotDatum: '2026-10-07' } } };
const REDEN_ZIEK = 'Technieker ziek of onbeschikbaar';
const ZONDER_MAIL = { contact: false, klant: false, installateur: false };

async function start(page, verzoeken, { paden = [], register = SEED, httpFouten = [] } = {}) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, ...paden]);
  if (httpFouten.length) verwachtHttpFout(verzoeken, httpFouten);
  const z = zohoStubs({ register });
  await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: z.overschrijf });
  return z;
}

// Kalender -> detail van #1004 -> "Afspraak annuleren" (enkel zichtbaar bij een lopend voorstel).
async function openViaDetail(page) {
  await openKalender(page);
  await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-sub').click();
  await page.locator('#d-btn-annuleer').click();
  await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
}
const kiesReden = (page, label = REDEN_ZIEK) => venster(page).getByLabel(label).check();

const VERSTUUR_JA = { ticketId: 'p1', reden: 'ziek', toelichting: '', mailKlant: true, door: 'Tim', naam: 'Luc Wouters' };

// Eén test per foutpad deelt deze controle: het venster blijft open en er is lokaal niets gewijzigd.
async function geenLokaleWijziging(page) {
  await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
  expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  expect(await lijstenVan(page)).toEqual({ tickets: ['t1', 't2', 't3'], pending: ['p1', 'p2'] });
  expect(await registerLokaal(page)).toEqual(SEED.status);
  await expect(page.locator('#cnt-tickets')).toHaveText('2');
}
// Na een geslaagde annulering: ticket terug in de wachtrij, venster en detail dicht.
async function naSucces(page) {
  await expect(page.locator('#cnt-tickets')).toHaveText('3');
  await expect(page.locator('#annuleer-overlay')).not.toHaveClass(/open/);
  await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
  expect(await planningVan(page)).toEqual({ '2026-10-09': ['g1'] });
  expect(await lijstenVan(page)).toEqual({ tickets: ['t1', 't2', 't3', 'p1'], pending: ['p2'] });
  expect(await page.evaluate(() => {
    const t = kern.toestand.get('allTickets').find(x => x.id === 'p1');
    return [t.status, t.interventieDatum];
  })).toEqual(['Wachten op planning', null]);
}

test.describe('annuleervenster openen en mailvoorbeeld', () => {
  test('detail: redenen één keer per sessie opgehaald, voorbeeld pas na reden en toelichting', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    await openViaDetail(page);

    // Kop: ticket, klant, dag en het gemailde tijdslot uit het register.
    await expect(page.locator('#annuleer-label')).toContainText('#1004 — Luc Wouters');
    await expect(page.locator('#annuleer-label')).toContainText(TIJDSLOT);
    await expect(venster(page).getByRole('radio', { name: REDEN_ZIEK })).toBeVisible();
    await expect(venster(page).locator('input[name="ann-reden"]')).toHaveCount(6);
    await expect(verstuurKnop(page)).toBeDisabled(); // nog geen reden
    await expect(page.locator('#annuleer-ontvangers')).toHaveText('Wordt verstuurd naar: luc@test.be');
    expect(z.opnames.annuleer).toEqual([{ methode: 'GET', body: null, query: {} }]);

    // Toon mail openen zonder reden: een plaatshouder, geen verzoek.
    await venster(page).getByText('Toon mail').click();
    await expect(page.locator('#annuleer-details')).toHaveJSProperty('open', true);
    await settle(page);
    expect(annuleerPosts(z, 'voorbeeld')).toEqual([]);

    // Reden kiezen: het voorbeeld verschijnt na de debounce (300 ms).
    await kiesReden(page);
    await expect.poll(() => annuleerPosts(z, 'voorbeeld').length).toBe(1);
    await expect(page.frameLocator('#annuleer-frame').locator('p')).toHaveText('Nep-voorbeeld van de annulatiemail');
    // Toelichting typen: opnieuw (oninput) een voorbeeld.
    await venster(page).locator('#annuleer-toelichting').fill('Wegens ziekte');
    await expect.poll(() => annuleerPosts(z, 'voorbeeld').length).toBe(2);
    await settle(page);

    // Gemeten: met een register-tijdslot voor deze dag gaat `tijdslot` mee en `uur` niet.
    const basis = { voorbeeld: true, naam: 'Luc Wouters', datum: '2026-10-07', tijdslot: TIJDSLOT, reden: 'ziek' };
    expect(annuleerPosts(z, 'voorbeeld')).toEqual([
      { methode: 'POST', body: { ...basis, toelichting: '' }, query: {} },
      { methode: 'POST', body: { ...basis, toelichting: 'Wegens ziekte' }, query: {} },
    ]);
    for (const r of verzoeken.van('/api/annuleer', 'POST')) expect(r.headers['content-type']).toBe('application/json');
    expect(annuleerPosts(z, 'echt')).toEqual([]);

    // Terug en opnieuw openen: de redenenlijst wordt niet opnieuw opgehaald.
    await page.locator('#annuleer-terug').click();
    await expect(page.locator('#annuleer-overlay')).not.toHaveClass(/open/);
    await page.locator('#d-btn-annuleer').click();
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    expect(z.opnames.annuleer.filter(o => o.methode === 'GET')).toHaveLength(1);
    expect(verzoeken.van('/api/annuleer', 'GET')).toHaveLength(1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER, ANNULEER]);
    await geenLokaleWijziging(page);
  });

  test('zonder register-tijdslot: het voorbeeld krijgt het uur van de stop in plaats van het tijdslot', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/annuleer'],
      register: { versie: 4, status: { p1: { contact: '2026-10-04T08:00:00.000Z' } } },
    });
    await openViaDetail(page);
    await venster(page).getByText('Toon mail').click();
    await kiesReden(page, 'Weersomstandigheden');
    await expect.poll(() => annuleerPosts(z, 'voorbeeld').length).toBe(1);
    // Gemeten: p1 staat om 07:00 UTC = 09:00 lokaal (stop.uur).
    expect(annuleerPosts(z, 'voorbeeld')).toEqual([{
      methode: 'POST',
      body: { voorbeeld: true, naam: 'Luc Wouters', datum: '2026-10-07', uur: '09:00', reden: 'weer', toelichting: '' },
      query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
  });

  test('✕ in de kalender (lopend voorstel): eerst een bevestiging, dan het annuleervenster, geen /api/plan', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: [] });
    await openKalender(page);
    await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-unplan-x').click();
    const dialoog = page.getByRole('alertdialog', { name: 'Ticket #1004: afspraak annuleren?' });
    await expect(dialoog).toBeVisible();
    await dialoog.getByRole('button', { name: 'Afspraak annuleren' }).click();
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    await expect(page.locator('#annuleer-label')).toContainText('#1004 — Luc Wouters');
    expect(z.opnames.plan).toEqual([]);
    expect(z.opnames.annuleer).toEqual([{ methode: 'GET', body: null, query: {} }]);
    await page.locator('#annuleer-terug').click();
    expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });
});

test.describe('annuleren verzenden (verstuurAnnulatie)', () => {
  test('klant mailen (Ja): POST /api/annuleer met exacte body, ticket terug in de wachtrij', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    await openViaDetail(page);
    await kiesReden(page);
    await expect(verstuurKnop(page)).toBeEnabled();
    expect(annuleerPosts(z, 'echt')).toEqual([]); // niets verstuurd vóór de klik
    const getsVoor = z.opnames['voorstel-status'].filter(o => o.methode === 'GET').length;
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Afspraak geannuleerd — klant verwittigd per mail');

    expect(annuleerPosts(z, 'echt')).toEqual([{ methode: 'POST', body: VERSTUUR_JA, query: {} }]);
    expect(verzoeken.van('/api/annuleer', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await naSucces(page);
    // Het register wordt opnieuw opgehaald (precies één extra GET) en is dan leeg.
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'GET').length).toBe(getsVoor + 1);
    await expect.poll(() => registerLokaal(page)).toEqual({});
    await page.getByRole('tab', { name: /Wachtrij/ }).click();
    await expect(page.locator('#ticket-list .ticket').filter({ hasText: '#1004' })).toHaveCount(1);
  });

  test('klant niet mailen (Nee): body met mailKlant false en andere toast', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    await openViaDetail(page);
    await kiesReden(page, 'Dubbele of foute planning');
    await venster(page).getByLabel('Nee, ik verwittig zelf').check();
    await expect(page.locator('#annuleer-ontvangers')).toHaveText('De klant krijgt geen mail.');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Afspraak geannuleerd — klant niet gemaild');
    expect(annuleerPosts(z, 'echt')).toEqual([{
      methode: 'POST', body: { ...VERSTUUR_JA, reden: 'fout', mailKlant: false }, query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await naSucces(page);
  });

  test('reden "Andere": toelichting verplicht, getrimde toelichting niet; body bevat de toelichting', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    await openViaDetail(page);
    await kiesReden(page, 'Andere');
    await expect(verstuurKnop(page)).toBeDisabled();
    await expect(page.locator('#annuleer-toelichting-label')).toHaveText('Toelichting (verplicht, komt in de mail aan de klant)');
    await venster(page).locator('#annuleer-toelichting').fill('   ');
    await expect(verstuurKnop(page)).toBeDisabled();
    await venster(page).locator('#annuleer-toelichting').fill('Klant is op reis');
    await expect(verstuurKnop(page)).toBeEnabled();
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Afspraak geannuleerd — klant verwittigd per mail');
    // Gemeten: de toelichting gaat ongetrimd mee (de server trimt).
    expect(annuleerPosts(z, 'echt')).toEqual([{
      methode: 'POST', body: { ...VERSTUUR_JA, reden: 'andere', toelichting: 'Klant is op reis' }, query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await naSucces(page);
  });

  test('dubbele aanroep terwijl het verzoek loopt (s.busy) geeft één verzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    let geef;
    const vast = new Promise(r => { geef = r; });
    z.zetAntwoord('annuleer', async ({ methode, body }) => {
      if (methode === 'GET') return { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }, { code: 'andere', label: 'Andere' }] } };
      await vast; // de test houdt het antwoord vast tot hij het zelf vrijgeeft
      return { status: 200, json: { ok: true, emailSent: { ...ZONDER_MAIL, contact: body.mailKlant }, fouten: [] } };
    });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect.poll(() => annuleerPosts(z, 'echt').length).toBe(1);
    await expect(verstuurKnop(page)).toHaveText('Bezig…');
    // De knop is disabled: een klik is een no-op, dus de functie zelf aanroepen (verstuurAnnulatie staat als
    // geëxporteerde functie in kern.annuleren).
    await page.evaluate(async () => { await kern.annuleren.verstuurAnnulatie(); await kern.annuleren.verstuurAnnulatie(); });
    // Tijdens het versturen sluit niets (Terug is disabled, Escape/overlay-klik is een no-op).
    await expect(page.locator('#annuleer-terug')).toBeDisabled();
    expect(annuleerPosts(z, 'echt')).toHaveLength(1);
    geef();
    await expect(toastTekst(page)).toHaveText('Afspraak geannuleerd — klant verwittigd per mail');
    expect(annuleerPosts(z, 'echt')).toEqual([{ methode: 'POST', body: VERSTUUR_JA, query: {} }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await naSucces(page);
  });

  test('ticket wordt nog bijgewerkt (inFlight): "Even geduld", geen annuleerverzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/plan'], register: { versie: 0, status: {} } });
    let geef;
    const vast = new Promise(r => { geef = r; });
    z.zetAntwoord('plan', async ({ body }) => {
      await vast;
      return { status: 200, json: { success: true, ticketId: body.ticketId, date: body.date } };
    });
    // #1001 (t1) toevoegen met een vastgehouden plan-verzoek: t1 is dan in flight.
    await page.locator('#ticket-list .ticket').filter({ hasText: '#1001' }).locator('.btn-add').click();
    await expect.poll(() => z.opnames.plan.length).toBe(1);
    // Het annuleervenster openen voor t1 (de knop zelf verschijnt enkel bij een lopend voorstel).
    await page.evaluate(() => kern.annuleren.openAnnuleerVenster('t1', '2026-10-05'));
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Even geduld — dit ticket wordt nog bijgewerkt.');
    expect(annuleerPosts(z, 'echt')).toEqual([]);
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    await expect(verstuurKnop(page)).toBeEnabled();
    geef();
    await expect(toastTekst(page)).toHaveText('✓ Toegevoegd aan 5 okt');
    await page.locator('#annuleer-terug').click();
    expect(z.opnames.plan).toHaveLength(1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
  });
});

test.describe('annuleervenster: Escape, focus en achtergrondklik', () => {
  const focusBinnen = (page) => page.evaluate(() => document.getElementById('annuleer-overlay').contains(document.activeElement)
    && document.activeElement !== document.getElementById('annuleer-overlay') ? document.activeElement.id : null);

  test('focus binnen bij openen, Tab-val rond, Escape sluit en geeft de focus terug aan de opener', async ({ page, verzoeken }) => {
    await start(page, verzoeken, { paden: ['/api/annuleer'] });
    await openViaDetail(page);
    // Eerste knop (niet het tekstveld) krijgt de focus.
    await expect.poll(() => focusBinnen(page)).toBe('annuleer-sluit');
    // Zonder reden is "Afspraak annuleren" disabled: de laatste focusbare knop is "Terug".
    await page.locator('#annuleer-terug').focus();
    await page.keyboard.press('Tab');
    expect(await focusBinnen(page)).toBe('annuleer-sluit');
    await page.keyboard.press('Shift+Tab');
    expect(await focusBinnen(page)).toBe('annuleer-terug');
    await page.keyboard.press('Escape');
    await expect(page.locator('#annuleer-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#det-overlay')).toHaveClass(/open/); // enkel het bovenste venster sluit
    await expect(page.locator('#d-btn-annuleer')).toBeFocused();
  });

  test('klik op de achtergrond sluit, klik in de inhoud niet', async ({ page, verzoeken }) => {
    await start(page, verzoeken, { paden: ['/api/annuleer'] });
    await openViaDetail(page);
    await venster(page).locator('#annuleer-label').click();
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    await page.locator('#annuleer-overlay').click({ position: { x: 2, y: 2 } });
    await expect(page.locator('#annuleer-overlay')).not.toHaveClass(/open/);
  });

  test('tijdens het versturen (busy) sluiten Escape en achtergrondklik niet', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    let geef;
    const vast = new Promise(r => { geef = r; });
    z.zetAntwoord('annuleer', async ({ methode, body }) => {
      if (methode === 'GET') return { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } };
      await vast;
      return { status: 200, json: { ok: true, emailSent: { ...ZONDER_MAIL, contact: body.mailKlant }, fouten: [] } };
    });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect.poll(() => annuleerPosts(z, 'echt').length).toBe(1);
    await expect(verstuurKnop(page)).toHaveText('Bezig…');
    await page.keyboard.press('Escape');
    await page.locator('#annuleer-overlay').click({ position: { x: 2, y: 2 } });
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    geef();
    await expect(toastTekst(page)).toHaveText('Afspraak geannuleerd — klant verwittigd per mail');
    await naSucces(page);
  });
});

test.describe('annuleren: foutpaden en bijzondere antwoorden', () => {
  test('409 nietGepland: venster blijft open, keuze Nee voorgeselecteerd, daarna opruimen lukt', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten: [{ pad: '/api/annuleer', status: 409 }] });
    const fout = 'Afspraak is niet (meer) gepland in Zoho — klant niet gemaild. Kies "Nee, ik verwittig zelf" om enkel de vergrendeling op te ruimen.';
    z.zetAntwoord('annuleer', ({ methode, body }) => {
      if (methode === 'GET') return { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } };
      if (body.mailKlant) return { status: 409, json: { error: fout, emailSent: ZONDER_MAIL, nietGepland: true } };
      return { status: 200, json: { ok: true, emailSent: ZONDER_MAIL, fouten: [], opgeruimd: true } };
    });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('⚠ ' + fout);
    await expect(venster(page).getByLabel('Nee, ik verwittig zelf')).toBeChecked();
    await expect(verstuurKnop(page)).toBeEnabled();
    await expect(verstuurKnop(page)).toHaveText('Afspraak annuleren');
    await expect(page.locator('#annuleer-ontvangers')).toHaveText('De klant krijgt geen mail.');
    await geenLokaleWijziging(page);
    expect(annuleerPosts(z, 'echt').map(o => o.body)).toEqual([VERSTUUR_JA]);

    // (d) Nu opruimen zonder mail: "Vergrendeling opgeruimd".
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Vergrendeling opgeruimd — ticket stond al niet meer gepland in Zoho');
    expect(annuleerPosts(z, 'echt').map(o => o.body)).toEqual([VERSTUUR_JA, { ...VERSTUUR_JA, mailKlant: false }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER, ANNULEER]);
    await naSucces(page);
  });

  test('500 { error } met mail gevraagd: waarschuwing dat de klant al gemaild kan zijn, niets lokaal gewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten: [{ pad: '/api/annuleer', status: 500 }] });
    z.zetAntwoord('annuleer', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 500, json: { error: 'Zoho kapot' } });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✕ Annuleren mislukt: Zoho kapot De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert.');
    await expect(verstuurKnop(page)).toHaveText('Afspraak annuleren');
    await expect(verstuurKnop(page)).toBeEnabled();
    await expect(page.locator('#annuleer-terug')).toBeEnabled();
    await geenLokaleWijziging(page);
    expect(annuleerPosts(z, 'echt')).toEqual([{ methode: 'POST', body: VERSTUUR_JA, query: {} }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
  });

  test('500 zonder mail gevraagd (Nee): geen mailwaarschuwing', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten: [{ pad: '/api/annuleer', status: 500 }] });
    z.zetAntwoord('annuleer', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 500, json: { error: 'Zoho kapot' } });
    await openViaDetail(page);
    await kiesReden(page);
    await venster(page).getByLabel('Nee, ik verwittig zelf').check();
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✕ Annuleren mislukt: Zoho kapot');
    expect(annuleerPosts(z, 'echt').map(o => o.body)).toEqual([{ ...VERSTUUR_JA, mailKlant: false }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await geenLokaleWijziging(page);
  });

  test('502 { error, emailSent } van de Zoho-PATCH nadat de mail weg is: waarschuwing, niets lokaal gewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten: [{ pad: '/api/annuleer', status: 502 }] });
    z.zetAntwoord('annuleer', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 502, json: { error: 'Zoho PATCH fout (500)', emailSent: { ...ZONDER_MAIL, contact: true }, fouten: [] } });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    // HUIDIG GEDRAG (bug?): de klant heeft de annulatiemail al, maar het ticket staat in Zoho nog op gepland en de planner
    // houdt het ook gepland; enkel een toast raadt aan "te controleren in Zoho".
    await expect(toastTekst(page)).toHaveText('✕ Annuleren mislukt: Zoho PATCH fout (500) De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert.');
    await geenLokaleWijziging(page);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
  });

  test('500 met bekende emailSent (niets verzonden): geen mailwaarschuwing', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten: [{ pad: '/api/annuleer', status: 502 }] });
    z.zetAntwoord('annuleer', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 502, json: { error: 'Zoho PATCH fout (500)', emailSent: ZONDER_MAIL, fouten: [{ doelgroep: 'contact', fout: 'x' }] } });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✕ Annuleren mislukt: Zoho PATCH fout (500)');
    await geenLokaleWijziging(page);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
  });

  test('502 met HTML-body (gateway-timeout): "HTTP 502" plus mailwaarschuwing, niets lokaal gewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten: [{ pad: '/api/annuleer', status: 502 }] });
    z.zetAntwoord('annuleer', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    // Gemeten: hier vangt de code de parserfout op (`res.json().catch`), dus geen technische tekst maar "HTTP 502".
    // W5-fix (Q2): gewone Nederlandse tekst in plaats van de technische foutklasse.
    // T8b (Q1, omgedraaid): een 502 zonder emailSent is een onzeker resultaat; de app controleert (enkel lezen) of de mail al weg is. De
    // standaardstub van mail-check zegt "niet verzonden". De volledige reeks staat in de describe "onzeker resultaat" hieronder.
    // I1: "niet verzonden" pas na de tweede controle, 30 s na de start.
    await laatMailControleHerhalen(page, z);
    await expect(toastTekst(page)).toHaveText('⚠ Mail is niet verzonden — je kan veilig opnieuw versturen');
    expect(z.opnames['mail-check']).toHaveLength(2);
    await geenLokaleWijziging(page);
    expect(annuleerPosts(z, 'echt')).toHaveLength(1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
  });

  test('succes met fouten (klant niet bereikt): geannuleerd, maar verwittig de klant zelf', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    z.zetAntwoord('annuleer', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 200, json: { ok: true, emailSent: ZONDER_MAIL, fouten: [{ doelgroep: 'klant', fout: 'Zoho sendReply fout (500) naar klant' }] } });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Afspraak geannuleerd, maar de mail naar klant kon niet verstuurd worden. Verwittig de klant zelf.');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await naSucces(page);
  });

  test('succes met fouten bij twee doelgroepen: de namen worden samengevoegd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    z.zetAntwoord('annuleer', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 200, json: { ok: true, emailSent: ZONDER_MAIL, fouten: [{ doelgroep: 'contact', fout: 'x' }, { doelgroep: 'installateur', fout: 'y' }] } });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Afspraak geannuleerd, maar de mail naar contactpersoon en installateur kon niet verstuurd worden. Verwittig de klant zelf.');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await naSucces(page);
  });

  test('succes met waarschuwing (register niet bijgewerkt): tekst achter de toast, register komt terug', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    const waarschuwing = 'Afspraak geannuleerd in Zoho, maar het voorstel-register kon niet bijgewerkt worden. Herlaad de planner.';
    z.zetAntwoord('annuleer', ({ methode, body }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 200, json: { ok: true, emailSent: { ...ZONDER_MAIL, contact: body.mailKlant }, fouten: [], waarschuwing } });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Afspraak geannuleerd — klant verwittigd per mail ' + waarschuwing);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await naSucces(page);
    // Het register is op de server nog aanwezig (dat is precies wat de waarschuwing meldt): de herlading haalt het terug.
    await expect.poll(() => registerLokaal(page)).toEqual(SEED.status);
  });

  test('opruimen met waarschuwing: beide teksten achter elkaar', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'] });
    const waarschuwing = 'Vergrendeling opruimen: het voorstel-register kon niet bijgewerkt worden. Herlaad de planner.';
    z.zetAntwoord('annuleer', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } }
      : { status: 200, json: { ok: true, emailSent: ZONDER_MAIL, fouten: [], opgeruimd: true, waarschuwing } });
    await openViaDetail(page);
    await kiesReden(page);
    await venster(page).getByLabel('Nee, ik verwittig zelf').check();
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('Vergrendeling opgeruimd — ticket stond al niet meer gepland in Zoho ' + waarschuwing);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    await naSucces(page);
  });

  test('redenenlijst laden mislukt (500): toast en venster blijft dicht; de volgende poging probeert opnieuw', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: [], httpFouten: [{ pad: '/api/annuleer', status: 500 }] });
    const normaal = { status: 200, json: { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] } };
    let eerste = true;
    z.zetAntwoord('annuleer', () => { if (eerste) { eerste = false; return { status: 500, json: { error: 'x' } }; } return normaal; });
    await openKalender(page);
    await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-sub').click();
    await page.locator('#d-btn-annuleer').click();
    // W5-fix (Q2): gewone Nederlandse tekst in plaats van de technische foutklasse.
    await expect(toastTekst(page)).toHaveText('✕ De redenenlijst laden mislukt. Probeer opnieuw. (Detail: Serverfout (HTTP 500))');
    await expect(page.locator('#annuleer-overlay')).not.toHaveClass(/open/);
    await page.locator('#d-btn-annuleer').click();
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    expect(z.opnames.annuleer.map(o => o.methode)).toEqual(['GET', 'GET']);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
  });
});


// ── T8b (Q1): onzeker resultaat van annuleer met een klantmail (afgebroken of 502 zonder emailSent): de app controleert (enkel lezen:
// GET /api/mail-check) of de mail al weg is. Het venster blijft op slot tot de controle klaar is; nooit een tweede annuleer. ──
const MAILCHECK = '/api/mail-check';
const T_MAIL = '2026-10-05T07:01:00.000Z'; // 09:01 in Brussel
const mailCheckLijst = (verzoeken) => verzoeken.alle.filter(r => r.pad === MAILCHECK).map(r => r.methode);
const MAIL_ONZEKER_BESTAAND = '✕ Annuleren mislukt: Geen verbinding met de server De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert.';
const MAIL_VERZONDEN = { status: 200, json: { ok: true, twijfel: false, verzonden: true, tijdstip: T_MAIL, uitgaand: [{ aan: 'luc@test.be', tijdstip: T_MAIL }] } };
const MAIL_NIET = { status: 200, json: { ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [] } };
const REDENEN_STUB = { redenen: [{ code: 'ziek', label: REDEN_ZIEK }] };

async function annuleerAfgebroken(page, verzoeken, mailCheck, { httpFouten = [], netFouten = [], mailKlant = true } = {}) {
  verwachtNetwerkFout(verzoeken, [{ pad: '/api/annuleer', methode: 'POST' }, ...netFouten]);
  const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten });
  z.zetAntwoord('annuleer', ({ methode, body }) => methode === 'GET'
    ? { status: 200, json: REDENEN_STUB }
    : body.voorbeeld === true ? { status: 200, json: { html: '<p>voorbeeld</p>' } } : { afbreken: 'failed' });
  z.zetAntwoord('mail-check', mailCheck);
  await openViaDetail(page);
  await kiesReden(page);
  if (!mailKlant) await venster(page).getByLabel('Nee, ik verwittig zelf').check();
  await verstuurKnop(page).click();
  return z;
}
// Eén annuleer-POST, geen tweede verzending en precies één GET naar mail-check met ticket en begin van de verzending.
// `herlading`: na "verzonden" leest de app de planning opnieuw; bij elke lading hoort het (alleen-lezen) wachttijdenverzoek POST /api/planning-sinds.
async function eenVerzendingEnEenControle(page, verzoeken, z, { herlading = false, controles = 1 } = {}) {
  expect(annuleerPosts(z, 'echt')).toHaveLength(1);
  expect(await schrijfLijst(page, verzoeken)).toEqual(herlading ? [START, ANNULEER, START] : [START, ANNULEER]);
  expect(mailCheckLijst(verzoeken)).toEqual(Array(controles).fill('GET'));
  expect(z.opnames['mail-check'].map(o => ({ methode: o.methode, query: mailCheckQuery(o) }))).toEqual(Array(controles).fill({ methode: 'GET', query: { ticketId: 'p1', verlopenMs: 'N' } }));
}

test.describe('annuleren: onzeker resultaat, controle of de mail al weg is (Q1)', () => {
  test('afgebroken en de mail is al verzonden: melding met uur, venster en detail dicht, planning opnieuw gelezen', async ({ page, verzoeken }) => {
    const z = await annuleerAfgebroken(page, verzoeken, MAIL_VERZONDEN);
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (luc@test.be)');
    await expect(page.locator('#annuleer-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
    await eenVerzendingEnEenControle(page, verzoeken, z, { herlading: true });
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(2); // de opstart en één herlading (planResync)
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'GET')).toHaveLength(2); // opstart + herlading na de melding
    expect(await planningVan(page)).toEqual(BASIS_PLANNING); // de app volgt de serverstand: de controle wijzigt lokaal niets
  });

  test('afgebroken en de mail is niet verzonden: melding, venster ontgrendeld en niets lokaal gewijzigd', async ({ page, verzoeken }) => {
    const z = await annuleerAfgebroken(page, verzoeken, MAIL_NIET);
    await laatMailControleHerhalen(page, z);
    await expect(toastTekst(page)).toHaveText('⚠ Mail is niet verzonden — je kan veilig opnieuw versturen');
    await expect(verstuurKnop(page)).toHaveText('Afspraak annuleren');
    await expect(page.locator('#annuleer-terug')).toBeEnabled();
    await geenLokaleWijziging(page);
    await eenVerzendingEnEenControle(page, verzoeken, z, { controles: 2 });
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(1);
  });

  test('de controle zelf faalt (502): de bestaande waarschuwing blijft de terugval', async ({ page, verzoeken }) => {
    const z = await annuleerAfgebroken(page, verzoeken, { status: 502, json: { error: 'Zoho threads ophalen mislukt (503)' } }, { httpFouten: [{ pad: MAILCHECK, status: 502 }] });
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER_BESTAAND);
    await expect(verstuurKnop(page)).toHaveText('Afspraak annuleren');
    await geenLokaleWijziging(page);
    await eenVerzendingEnEenControle(page, verzoeken, z);
  });

  test('tijdens de controle blijft het venster op slot; hangt de controle, dan eindigt ze na 20 s met de bestaande waarschuwing', async ({ page, verzoeken }) => {
    const z = await annuleerAfgebroken(page, verzoeken, { hangen: true }, { netFouten: [{ pad: MAILCHECK, methode: 'GET' }] });
    await expect.poll(() => z.opnames['mail-check'].length).toBe(1);
    await page.evaluate(() => Promise.resolve());
    await expect(toastTekst(page)).toHaveText('Controleren of de mail al vertrokken is…'); // M10: voortgang tot het antwoord er is
    await expect(verstuurKnop(page)).toHaveText('Bezig…');
    await expect(page.locator('#annuleer-terug')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.evaluate(() => Promise.resolve());
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/); // een busy venster sluit niet
    // De nepklok loopt ook in echte tijd door; een "net vóór de limiet"-controle zou dus flaky zijn. Eén sprong voorbij de limiet volstaat.
    await page.clock.runFor(25000);
    await page.evaluate(() => Promise.resolve());
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER_BESTAAND);
    await expect(verstuurKnop(page)).toHaveText('Afspraak annuleren');
    await expect(page.locator('#annuleer-terug')).toBeEnabled();
    expect(annuleerPosts(z, 'echt')).toHaveLength(1);
    expect(z.opnames['mail-check']).toHaveLength(1);
  });

  test('een 502 met HTML-body en de mail is al verzonden: dezelfde melding als bij een afgebroken verzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten: [{ pad: '/api/annuleer', status: 502 }] });
    z.zetAntwoord('annuleer', ({ methode, body }) => methode === 'GET'
      ? { status: 200, json: REDENEN_STUB }
      : body.voorbeeld === true ? { status: 200, json: { html: '<p>voorbeeld</p>' } } : { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    z.zetAntwoord('mail-check', MAIL_VERZONDEN);
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (luc@test.be)');
    await eenVerzendingEnEenControle(page, verzoeken, z, { herlading: true });
  });

  test('een 502 { error, emailSent } is al een definitief antwoord van de server: geen controle', async ({ page, verzoeken }) => {
    // Bestaande pin (zie hierboven) blijft: de server meldt zelf welke mails weg zijn; er is niets te controleren.
    const z = await start(page, verzoeken, { paden: ['/api/annuleer'], httpFouten: [{ pad: '/api/annuleer', status: 502 }] });
    z.zetAntwoord('annuleer', ({ methode, body }) => methode === 'GET'
      ? { status: 200, json: REDENEN_STUB }
      : body.voorbeeld === true ? { status: 200, json: { html: '<p>voorbeeld</p>' } }
        : { status: 502, json: { error: 'Zoho PATCH fout (500)', emailSent: { ...ZONDER_MAIL, contact: true }, fouten: [] } });
    await openViaDetail(page);
    await kiesReden(page);
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✕ Annuleren mislukt: Zoho PATCH fout (500) De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert.');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    expect(mailCheckLijst(verzoeken)).toEqual([]);
  });

  test('zonder klantmail ("Nee, ik verwittig zelf") is er niets te controleren: een afgebroken verzoek geeft de gewone foutmelding', async ({ page, verzoeken }) => {
    const z = await annuleerAfgebroken(page, verzoeken, MAIL_VERZONDEN, { mailKlant: false });
    await expect(toastTekst(page)).toHaveText('✕ Annuleren mislukt: Geen verbinding met de server');
    await expect(verstuurKnop(page)).toHaveText('Afspraak annuleren');
    expect(annuleerPosts(z, 'echt')).toHaveLength(1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, ANNULEER]);
    expect(mailCheckLijst(verzoeken)).toEqual([]);
  });
});
