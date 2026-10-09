// Productietests (etappe 5a, taak 3): het afspraakvoorstel (sendProposal) zonder testmodus, met de exacte
// payloads van POST /api/propose (verstuurt mail naar de klant via Zoho) en /api/voorstel-status (register).
// Karakterisering: het huidige gedrag staat vast, ook de eigenaardigheden (gemarkeerd met HUIDIG GEDRAG (bug?)).
// Alle uitgaande schrijfverzoeken worden per test exact opgesomd (`schrijfLijst`): een ontbrekend of extra
// verzoek laat de test falen. Foutantwoorden zijn per test expliciet toegelaten met `verwachtHttpFout`.
// Echte foutvormen (netlify/functions/propose.js, voorstel-status.js): propose geeft 400/404/500 met `{ error }`,
// een trage Zoho kan een Netlify-gateway 502 met HTML-body geven; voorstel-status geeft 409 `{ error, serverVersie }`.
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, verwachtNetwerkFout, zohoStubs, OPSTART_SCHRIJVEN, settle, laatMailControleHerhalen, mailCheckQuery, openKalender, TICKETS_STUB } from '../productie-hulp.mjs';

const TICKETS = TICKETS_STUB;
const START = 'POST /api/planning-sinds';
const PROPOSE = 'POST /api/propose';
const STATUS_POST = 'POST /api/voorstel-status';

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
const venster = (page) => page.getByRole('dialog', { name: '📨 Afspraakvoorstel' });
const verstuurKnop = (page) => page.locator('#proposal-send-btn');

// Gemeten bij VASTE_NU (maandag 5 okt 2026, Europe/Brussels, UTC+2): p1 (#1004) staat op wo 7 okt.
const BASIS_PLANNING = { '2026-10-07': ['p1'], '2026-10-09': ['g1'] };
// De klok staat vast op VASTE_NU = 5 okt 09:00 lokaal = 07:00 UTC: `tijdstip` in de voorstel-status-POST.
const TIJDSTIP = '2026-10-05T07:00:00.000Z';

// Tickets-stub met aangepaste velden voor #1004 (p1).
const metP1 = (extra) => () => {
  const t = structuredClone(TICKETS);
  Object.assign(t.pendingTickets.find(x => x.id === 'p1'), extra);
  return { status: 200, json: t };
};

async function start(page, verzoeken, { paden = [], stubs = {}, register, httpFouten = [] } = {}) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, ...paden]);
  if (httpFouten.length) verwachtHttpFout(verzoeken, httpFouten);
  const z = zohoStubs({ register });
  await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: { ...z.overschrijf, ...stubs } });
  return z;
}

// Kalender -> detail van #1004 -> "📨 Voorstel": het voorstelvenster staat open (de knop wordt nog niet gebruikt).
async function openVoorstel(page) {
  await openKalender(page);
  await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-sub').click();
  await page.getByRole('button', { name: '📨 Voorstel' }).click();
  await expect(venster(page)).toBeVisible();
}
async function vulIn(page, datum, tijd) {
  await venster(page).locator('#proposal-date').fill(datum);
  await venster(page).locator('#proposal-time').fill(tijd);
}

const PROPOSE_BODY = {
  ticketId: 'p1', date: '2026-10-08', time: '10:00', utcInterventieDatum: '2026-10-08T08:00:00.000Z',
  recipientName: 'Luc Wouters', subject: 'Energiemeting klopt niet', serienummer: 'CHARX-3301',
  // Gemeten: het tijdslot van 10:00 volgens de standaard-instelling (tijdslotVoor).
  appointmentWindow: '09:30–12:30',
};

test.describe('voorstel verzenden (sendProposal)', () => {
  test('#1004, één ontvanger: POST /api/propose, daarna POST /api/voorstel-status met reset en versie', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose', '/api/voorstel-status'], register: { versie: 7, status: {} } });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    // p1 en emailEindklant zijn hetzelfde adres: één ontvanger.
    await expect(venster(page).locator('#proposal-email')).toHaveText('Wordt verstuurd naar: luc@test.be');
    expect(z.opnames.propose).toEqual([]); // niets verstuurd vóór de klik
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Voorstel verstuurd naar contactpersoon');

    expect(z.opnames.propose).toEqual([{ methode: 'POST', body: PROPOSE_BODY, query: {} }]);
    expect(verzoeken.van('/api/propose', 'POST')[0].headers['content-type']).toBe('application/json');
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'POST').length).toBe(1);
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST')).toEqual([{
      methode: 'POST',
      body: { ticketId: 'p1', doelgroepen: ['contact'], tijdstip: TIJDSTIP, reset: true, versie: 7, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' },
      query: {},
    }]);
    expect(verzoeken.van('/api/voorstel-status', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST]);

    // Lokaal: register, lijsten, planning (de oude dag is weg: bugfix 2026-09-22 item E), venster dicht.
    expect(await registerLokaal(page)).toEqual({ p1: { contact: TIJDSTIP, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' } });
    expect(z.register()).toEqual({ versie: 8, status: { p1: { contact: TIJDSTIP, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' } } });
    expect(await planningVan(page)).toEqual({ '2026-10-08': ['p1'], '2026-10-09': ['g1'] });
    expect(await lijstenVan(page)).toEqual({ tickets: ['t1', 't2', 't3'], pending: ['p1', 'p2'] });
    expect(await page.evaluate(() => {
      const t = kern.toestand.get('allPending').find(x => x.id === 'p1');
      return [t.status, t.interventieDatum];
    })).toEqual(['Wachten op bevestiging planning', '2026-10-08T08:00:00.000Z']);
    await expect(page.locator('#proposal-overlay')).not.toHaveClass(/open/);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
    await expect(dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(0);
    await expect(dag(page, '2026-10-08').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(1);
  });

  test('drie ontvangers (verschillende adressen): doelgroepen in de volgorde contact, klant, installateur', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/propose', '/api/voorstel-status'],
      stubs: { tickets: metP1({ emailEindklant: 'klant@test.be', emailInstallateur: 'installateur@test.be' }) },
    });
    z.zetAntwoord('propose', ({ body }) => ({
      status: 200,
      json: {
        success: true, ticketId: body.ticketId, interventieDatum: body.utcInterventieDatum, appointmentTime: body.time,
        emailSent: { contact: true, klant: true, installateur: true }, fouten: [], ontvangers: ['contact', 'klant', 'installateur'],
      },
    }));
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await expect(venster(page).locator('#proposal-email')).toHaveText('Wordt verstuurd naar: luc@test.be, klant@test.be, installateur@test.be');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Voorstel verstuurd naar contactpersoon, klant en installateur');

    expect(z.opnames.propose).toEqual([{ methode: 'POST', body: PROPOSE_BODY, query: {} }]);
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'POST').length).toBe(1);
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body)).toEqual([
      { ticketId: 'p1', doelgroepen: ['contact', 'klant', 'installateur'], tijdstip: TIJDSTIP, reset: true, versie: 0, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' },
    ]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST]);
    expect(await registerLokaal(page)).toEqual({
      p1: { contact: TIJDSTIP, klant: TIJDSTIP, installateur: TIJDSTIP, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' },
    });
  });

  test('enkel een deel van de ontvangers kreeg de mail: alleen die doelgroepen in het register', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/propose', '/api/voorstel-status'],
      stubs: { tickets: metP1({ emailEindklant: 'klant@test.be', emailInstallateur: 'installateur@test.be' }) },
    });
    z.zetAntwoord('propose', ({ body }) => ({
      status: 200,
      json: {
        success: true, ticketId: body.ticketId, interventieDatum: body.utcInterventieDatum, appointmentTime: body.time,
        emailSent: { contact: false, klant: true, installateur: true },
        fouten: [{ doelgroep: 'contact', fout: 'Zoho sendReply fout (500) naar contact' }], ontvangers: ['contact', 'klant', 'installateur'],
      },
    }));
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Voorstel verstuurd naar klant en installateur');
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'POST').length).toBe(1);
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body.doelgroepen)).toEqual([['klant', 'installateur']]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST]);
  });
});

test.describe('voorstel: randgevallen', () => {
  test('geen enkele mail verstuurd: DELETE /api/voorstel-status?ticketId=, geen POST, oude entry weg', async ({ page, verzoeken }) => {
    const oud = { contact: '2026-10-03T08:00:00.000Z', tijdslot: '13:00–16:00', tijdslotDatum: '2026-10-07' };
    const z = await start(page, verzoeken, { paden: ['/api/propose', '/api/voorstel-status'], register: { versie: 3, status: { p1: oud } } });
    z.zetAntwoord('propose', ({ body }) => ({
      status: 200,
      json: {
        success: true, ticketId: body.ticketId, interventieDatum: body.utcInterventieDatum, appointmentTime: body.time,
        emailSent: { contact: false, klant: false, installateur: false },
        fouten: [{ doelgroep: 'contact', fout: 'Zoho sendReply fout (500) naar contact' }], ontvangers: ['contact'],
      },
    }));
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    expect(await registerLokaal(page)).toEqual({ p1: oud });
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Ticket bijgewerkt — e-mail kon niet verstuurd worden via Zoho');

    expect(z.opnames.propose).toEqual([{ methode: 'POST', body: PROPOSE_BODY, query: {} }]);
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'DELETE').length).toBe(1);
    expect(z.opnames['voorstel-status'].filter(o => o.methode !== 'GET')).toEqual([{ methode: 'DELETE', body: null, query: { ticketId: 'p1' } }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, 'DELETE /api/voorstel-status']);
    await expect.poll(() => registerLokaal(page)).toEqual({});
    expect(z.register()).toEqual({ versie: 4, status: {} });
    // Het ticket zelf is wél bijgewerkt (Zoho-PATCH gebeurde in propose).
    expect(await planningVan(page)).toEqual({ '2026-10-08': ['p1'], '2026-10-09': ['g1'] });
  });

  test('ticket zonder e-mailadres: propose met lege recipientName, "Status bijgewerkt (geen e-mailadres)", DELETE', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/propose', '/api/voorstel-status'],
      stubs: { tickets: metP1({ email: '', emailEindklant: '', emailInstallateur: '', contact: '', naamEindklant: '' }) },
    });
    z.zetAntwoord('propose', ({ body }) => ({
      status: 200,
      json: {
        success: true, ticketId: body.ticketId, interventieDatum: body.utcInterventieDatum, appointmentTime: body.time,
        emailSent: { contact: false, klant: false, installateur: false }, fouten: [], ontvangers: [],
      },
    }));
    await openVoorstel(page);
    await expect(venster(page).locator('#proposal-email')).toHaveText('Geen gekend e-mailadres — ticket wordt bijgewerkt maar er wordt geen mail verstuurd.');
    await expect(venster(page).locator('#proposal-no-email')).toBeVisible();
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Status bijgewerkt (geen e-mailadres)');

    expect(z.opnames.propose).toEqual([{ methode: 'POST', body: { ...PROPOSE_BODY, recipientName: '' }, query: {} }]);
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'DELETE').length).toBe(1);
    expect(z.opnames['voorstel-status'].filter(o => o.methode !== 'GET')).toEqual([{ methode: 'DELETE', body: null, query: { ticketId: 'p1' } }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, 'DELETE /api/voorstel-status']);
  });

  test('409 op voorstel-status: register herladen en één keer opnieuw met de nieuwe versie', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/propose', '/api/voorstel-status'], register: { versie: 7, status: {} },
      httpFouten: [{ pad: '/api/voorstel-status', status: 409 }],
    });
    z.forceerConflicten(1); // iemand anders schrijft ertussen: register wordt versie 8
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    const getsVoor = z.opnames['voorstel-status'].filter(o => o.methode === 'GET').length;
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Voorstel verstuurd naar contactpersoon');

    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'POST').length).toBe(2);
    const slot = { tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' };
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body)).toEqual([
      { ticketId: 'p1', doelgroepen: ['contact'], tijdstip: TIJDSTIP, reset: true, versie: 7, ...slot },
      { ticketId: 'p1', doelgroepen: ['contact'], tijdstip: TIJDSTIP, reset: true, versie: 8, ...slot },
    ]);
    // Tussen de twee POSTs precies één GET (loadVoorstelStatus).
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'GET')).toHaveLength(getsVoor + 1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST, STATUS_POST]);
    await expect.poll(() => registerLokaal(page)).toEqual({ p1: { contact: TIJDSTIP, ...slot } });
    expect(z.register().versie).toBe(9);
  });

  test('tweede 409 in een rij: de derde poging zonder versie slaagt en het register is geschreven', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/propose', '/api/voorstel-status'], register: { versie: 7, status: {} },
      httpFouten: [{ pad: '/api/voorstel-status', status: 409 }],
    });
    z.forceerConflicten(2);
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Voorstel verstuurd naar contactpersoon');
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'POST').length).toBe(3);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST, STATUS_POST, STATUS_POST]);
    const slot = { tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' };
    const posts = z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body);
    expect(posts).toHaveLength(3);
    expect('versie' in posts[2]).toBe(false); // de derde zonder versiecontrole (reset vervangt enkel de entry van dit ticket)
    expect(posts[2]).toEqual({ ticketId: 'p1', doelgroepen: ['contact'], tijdstip: TIJDSTIP, reset: true, ...slot });
    await expect.poll(() => registerLokaal(page)).toEqual({ p1: { contact: TIJDSTIP, ...slot } });
    expect(z.register().status).toEqual({ p1: { contact: TIJDSTIP, ...slot } });
    expect(await planningVan(page)).toEqual({ '2026-10-08': ['p1'], '2026-10-09': ['g1'] });
  });

  test('register-POST geeft 500 (niet 409): geen retry en een waarschuwing', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/propose', '/api/voorstel-status'], register: { versie: 7, status: {} },
      httpFouten: [{ pad: '/api/voorstel-status', status: 500 }],
    });
    z.zetAntwoord('voorstel-status', ({ methode }) => methode === 'GET'
      ? { status: 200, json: { versie: 7, status: {} } }
      : { status: 500, json: { error: 'Opslag kapot' } });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('⚠ Voorstel verstuurd, maar de status kon niet bewaard worden — NIET opnieuw versturen, herlaad eerst de pagina');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST]); // precies één POST, geen retry
    // De mail is weg: planning en lijsten zijn wel bijgewerkt, de knop is terug.
    expect(await planningVan(page)).toEqual({ '2026-10-08': ['p1'], '2026-10-09': ['g1'] });
    expect(await lijstenVan(page)).toEqual({ tickets: ['t1', 't2', 't3'], pending: ['p1', 'p2'] });
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
    await expect(verstuurKnop(page)).toBeEnabled();
    // De lokale entry staat er toch (de mail is weg); hij verdwijnt bij de volgende lading van de server.
    expect(await registerLokaal(page)).toEqual({ p1: { contact: TIJDSTIP, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' } });
  });

  test('propose faalt na het versturen (Zoho-PATCH 500): waarschuwing, register geschreven, tickets opnieuw gelezen', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose', '/api/voorstel-status'], httpFouten: [{ pad: '/api/propose', status: 500 }] });
    z.zetAntwoord('propose', { status: 500, json: {
      error: 'Zoho PATCH fout (500): {"message":"Zoho kapot"}',
      emailSent: { contact: true, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'],
    } });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();

    // B2: de mail is weg en enkel de ticket-update faalde: de planner krijgt een duidelijke waarschuwing (geen "ticket bijwerken"-knop).
    await expect(toastTekst(page)).toHaveText('⚠ Voorstel is verstuurd naar contactpersoon, maar Zoho kon het ticket niet bijwerken (Zoho PATCH fout (500): {"message":"Zoho kapot"}). Stuur het voorstel NIET opnieuw: zet de status en de datum in Zoho zelf recht.');
    await expect(page.locator('#proposal-overlay')).not.toHaveClass(/open/);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
    await expect(verstuurKnop(page)).toBeEnabled();
    expect(z.opnames.propose).toEqual([{ methode: 'POST', body: PROPOSE_BODY, query: {} }]);
    const slot = { tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' };
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body)).toEqual([
      { ticketId: 'p1', doelgroepen: ['contact'], tijdstip: TIJDSTIP, reset: true, versie: 0, ...slot },
    ]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST, START]); // START = de tickets opnieuw lezen (planning-sinds)
    expect(await registerLokaal(page)).toEqual({ p1: { contact: TIJDSTIP, ...slot } });
    expect(z.register().status).toEqual({ p1: { contact: TIJDSTIP, ...slot } });
    // Geen lokale verplaatsing naar "Wachten op bevestiging planning": Zoho zegt dat de update faalde, de herlading toont de echte stand.
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    expect(await lijstenVan(page)).toEqual({ tickets: ['t1', 't2', 't3'], pending: ['p1', 'p2'] });
    expect(await page.evaluate(() => kern.toestand.get('allPending').find(x => x.id === 'p1').interventieDatum)).toBe('2026-10-07T07:00:00.000Z');
  });

  test('propose faalt na het versturen: de knop blijft dicht tot het register bewaard is (geen tweede verzending mogelijk)', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/voorstel-status', methode: 'POST' }]);
    const z = await start(page, verzoeken, { paden: ['/api/propose', '/api/voorstel-status'], httpFouten: [{ pad: '/api/propose', status: 500 }] });
    z.zetAntwoord('propose', { status: 500, json: {
      error: 'Zoho PATCH fout (500)', emailSent: { contact: true, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'],
    } });
    z.zetAntwoord('voorstel-status', ({ methode }) => methode === 'GET' ? { status: 200, json: { versie: 0, status: {} } } : { hangen: true });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'POST').length).toBe(1);
    await page.evaluate(() => Promise.resolve());
    // Het register is nog onderweg: knop op slot en venster open, er is nog geen waarschuwing (en dus geen weg naar een tweede verzending).
    await expect(verstuurKnop(page)).toBeDisabled();
    await expect(verstuurKnop(page)).toHaveText('Bezig...');
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
    // Hangt het register, dan eindigt het na de time-out: pas dan komt de waarschuwing (met de zin over de status) en gaat de knop open.
    await page.clock.runFor(25000);
    await page.evaluate(() => Promise.resolve());
    await expect(toastTekst(page)).toHaveText('⚠ Voorstel is verstuurd naar contactpersoon, maar Zoho kon het ticket niet bijwerken (Zoho PATCH fout (500)). Stuur het voorstel NIET opnieuw: zet de status en de datum in Zoho zelf recht. Ook de status in de app kon niet bewaard worden: herlaad de pagina.');
    await expect(verstuurKnop(page)).toBeEnabled();
    await expect(page.locator('#proposal-overlay')).not.toHaveClass(/open/);
    expect(z.opnames.propose).toHaveLength(1);
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST')).toHaveLength(1); // netwerkfout: geen retry
  });

  test('propose faalt na het versturen en één ontvanger kreeg de mail niet: de waarschuwing noemt ook wie niets ontving', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/propose', '/api/voorstel-status'], httpFouten: [{ pad: '/api/propose', status: 500 }],
      stubs: { tickets: metP1({ emailEindklant: 'klant@test.be' }) },
    });
    z.zetAntwoord('propose', { status: 500, json: {
      error: 'Zoho PATCH fout (500)', emailSent: { contact: true, klant: false, installateur: false },
      fouten: [{ doelgroep: 'klant', fout: 'Zoho sendReply fout (422)' }], ontvangers: ['contact', 'klant'],
    } });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('⚠ Voorstel is verstuurd naar contactpersoon, maar Zoho kon het ticket niet bijwerken (Zoho PATCH fout (500)). Stuur het voorstel NIET opnieuw: zet de status en de datum in Zoho zelf recht. Niet verstuurd naar klant: Zoho sendReply fout (422).');
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body.doelgroepen)).toEqual([['contact']]); // enkel wie de mail kreeg
  });

  test('ticket niet gevonden (404): foutmelding van de server, niets gewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose'], httpFouten: [{ pad: '/api/propose', status: 404 }] });
    z.zetAntwoord('propose', { status: 404, json: { error: 'Ticket niet gevonden' } });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✕ Ticket niet gevonden');
    expect(z.opnames.propose).toHaveLength(1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });

  test('502 met HTML-body (gateway-timeout): toast HTTP 502, niets gewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose'], httpFouten: [{ pad: '/api/propose', status: 502 }] });
    z.zetAntwoord('propose', { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();

    // Was HUIDIG GEDRAG (bug?): de mail kon al verstuurd zijn (gateway-timeout tijdens de Zoho-aanroepen) zonder dat de gebruiker dat hoorde;
    // sinds Q1 controleert de app dat (zie hieronder).
    // W5-fix: was HUIDIG GEDRAG (parserfout)
    // W5-fix (Q2): gewone Nederlandse tekst in plaats van de technische foutklasse.
    // T8b (Q1, omgedraaid): een 502 is een onzeker resultaat; de app controleert (enkel lezen) of de mail al weg is. De standaardstub van
    // mail-check zegt "niet verzonden" (I1: pas na de tweede controle); de volledige reeks uitkomsten staat in de describe "onzeker resultaat" hieronder.
    await laatMailControleHerhalen(page, z);
    await expect(toastTekst(page)).toHaveText('⚠ Mail is niet verzonden — je kan veilig opnieuw versturen');
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
    expect(z.opnames['mail-check']).toHaveLength(2);
    expect(z.opnames.propose).toEqual([{ methode: 'POST', body: PROPOSE_BODY, query: {} }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    expect(await registerLokaal(page)).toEqual({});
  });

  test('datum leeg: waarschuwing, geen verzoek, venster blijft open', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: [] });
    await openVoorstel(page);
    await venster(page).locator('#proposal-date').fill('');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('⚠ Selecteer een datum');
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
    expect(z.opnames.propose).toEqual([]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });

  test('zelfde dag, standaardtijd uit de route: ticket staat op precies één dag', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose', '/api/voorstel-status'] });
    await openVoorstel(page);
    // Zonder de velden aan te raken: datum van het detail (wo 7 okt) en de afgeronde aankomsttijd.
    await expect(venster(page).locator('#proposal-date')).toHaveValue('2026-10-07');
    const tijd = await venster(page).locator('#proposal-time').inputValue();
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Voorstel verstuurd naar contactpersoon');
    expect(z.opnames.propose).toHaveLength(1);
    expect(z.opnames.propose[0].body.date).toBe('2026-10-07');
    expect(z.opnames.propose[0].body.time).toBe(tijd);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });
});


// ── T8b (Q1): onzeker resultaat van propose (afgebroken of 502): de app controleert (enkel lezen: GET /api/mail-check) of de mail al weg is ──
// Drie goedgekeurde uitkomsten: verzonden (niets opnieuw), niet verzonden (veilig opnieuw) of onzeker (kijk na in Zoho). Nooit een tweede propose.
const MAILCHECK = '/api/mail-check';
const T_MAIL = '2026-10-05T07:01:00.000Z'; // 09:01 in Brussel
const mailCheckLijst = (verzoeken) => verzoeken.alle.filter(r => r.pad === MAILCHECK).map(r => r.methode);
// Antwoord van mail-check: alle gevraagde adressen kregen een mail op T_MAIL (of enkel `verzonden` van hen).
const mailVerzonden = (verzonden = null) => ({ query }) => {
  const adressen = (query.get('ontvangers') || '').split(',').filter(Boolean);
  return {
    status: 200,
    json: {
      ok: true, twijfel: false, verzonden: adressen.length ? adressen.every(a => !verzonden || verzonden.includes(a)) : true, tijdstip: T_MAIL,
      uitgaand: adressen.filter(a => !verzonden || verzonden.includes(a)).map(a => ({ aan: a, tijdstip: T_MAIL })),
      ontvangers: Object.fromEntries(adressen.map(a => [a, (!verzonden || verzonden.includes(a)) ? { verzonden: true, tijdstip: T_MAIL } : { verzonden: false, tijdstip: null }])),
    },
  };
};
const MAIL_ONZEKER = '⚠ De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt';

async function verstuurAfgebroken(page, verzoeken, mailCheck, { httpFouten = [], netFouten = [], stubs = {}, voorAf = null } = {}) {
  verwachtNetwerkFout(verzoeken, [{ pad: '/api/propose', methode: 'POST' }, ...netFouten]);
  const z = await start(page, verzoeken, { paden: ['/api/propose', '/api/voorstel-status'], httpFouten, stubs });
  z.zetAntwoord('propose', { afbreken: 'failed' });
  z.zetAntwoord('mail-check', mailCheck);
  if (voorAf) voorAf(z);
  await openVoorstel(page);
  await vulIn(page, '2026-10-08', '10:00');
  await verstuurKnop(page).click();
  return z;
}
// Eén POST /api/propose, geen tweede verzending en precies één GET naar mail-check met ticket, begin van de verzending en ontvangers.
// `herlading`: na "verzonden" leest de app de tickets opnieuw; bij elke lading hoort het (alleen-lezen) wachttijdenverzoek POST /api/planning-sinds.
async function eenVerzendingEnEenControle(page, verzoeken, z, { ontvangers = 'luc@test.be', herlading = false, controles = 1, statusPosts = 0 } = {}) {
  expect(z.opnames.propose).toEqual([{ methode: 'POST', body: PROPOSE_BODY, query: {} }]);
  // B4: een teruggevonden mail schrijft eerst het register (statusPosts), pas daarna leest de app de tickets opnieuw (START).
  expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, ...Array(statusPosts).fill(STATUS_POST), ...(herlading ? [START] : [])]);
  expect(mailCheckLijst(verzoeken)).toEqual(Array(controles).fill('GET'));
  expect(z.opnames['mail-check'].map(o => ({ methode: o.methode, query: mailCheckQuery(o) }))).toEqual(
    Array(controles).fill({ methode: 'GET', query: { ticketId: 'p1', verlopenMs: 'N', ontvangers } }),
  );
}

test.describe('voorstel: onzeker resultaat, controle of de mail al weg is (Q1)', () => {
  test('afgebroken en de mail is al verzonden: voorstel wordt als verzonden aangevinkt, venster dicht, tickets opnieuw gelezen, geen tweede verzending', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, mailVerzonden());
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (luc@test.be) — voorstel als verzonden aangevinkt');
    await expect(page.locator('#proposal-overlay')).not.toHaveClass(/open/);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
    await expect(verstuurKnop(page)).toBeEnabled();
    await eenVerzendingEnEenControle(page, verzoeken, z, { herlading: true, statusPosts: 1 });
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(2); // de opstart en één herlading (planResync)
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    const slot = { tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' };
    expect(await registerLokaal(page)).toEqual({ p1: { contact: T_MAIL, ...slot } });
    expect(z.register().status).toEqual({ p1: { contact: T_MAIL, ...slot } });
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body)).toEqual([
      { ticketId: 'p1', doelgroepen: ['contact'], tijdstip: T_MAIL, reset: true, versie: 0, ...slot },
    ]);
  });

  test('afgebroken en de mail is niet verzonden: melding, venster blijft open en de knop kan opnieuw', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, { status: 200, json: { ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [], ontvangers: { 'luc@test.be': { verzonden: false, tijdstip: null } } } });
    await laatMailControleHerhalen(page, z);
    await expect(toastTekst(page)).toHaveText('⚠ Mail is niet verzonden — je kan veilig opnieuw versturen');
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
    await expect(verstuurKnop(page)).toBeEnabled();
    await eenVerzendingEnEenControle(page, verzoeken, z, { controles: 2 });
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(1); // geen herlading
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });

  test('de controle zelf faalt (502): de waarschuwing "kijk dit na in Zoho", venster blijft open', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, { status: 502, json: { error: 'Zoho threads ophalen mislukt (503)' } }, { httpFouten: [{ pad: MAILCHECK, status: 502 }] });
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER);
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
    await expect(verstuurKnop(page)).toBeEnabled();
    await eenVerzendingEnEenControle(page, verzoeken, z);
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(1);
  });

  test('een 502 met HTML-body en de mail is al verzonden: dezelfde melding als bij een afgebroken verzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose', '/api/voorstel-status'], httpFouten: [{ pad: '/api/propose', status: 502 }] });
    z.zetAntwoord('propose', { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    z.zetAntwoord('mail-check', mailVerzonden());
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (luc@test.be) — voorstel als verzonden aangevinkt');
    await eenVerzendingEnEenControle(page, verzoeken, z, { herlading: true, statusPosts: 1 });
  });

  test('tijdens de controle blijft de knop op slot; hangt de controle, dan eindigt ze na 20 s met de waarschuwing', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, { hangen: true }, { netFouten: [{ pad: MAILCHECK, methode: 'GET' }] });
    await expect.poll(() => z.opnames['mail-check'].length).toBe(1);
    await page.evaluate(() => Promise.resolve());
    await expect(toastTekst(page)).toHaveText('Controleren of de mail al vertrokken is…'); // M10: voortgang tot het antwoord er is
    await expect(verstuurKnop(page)).toBeDisabled();
    await expect(verstuurKnop(page)).toHaveText('Bezig...');
    // De nepklok loopt ook in echte tijd door; een "net vóór de limiet"-controle zou dus flaky zijn. Eén sprong voorbij de limiet volstaat.
    await page.clock.runFor(25000);
    await page.evaluate(() => Promise.resolve());
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER);
    await expect(verstuurKnop(page)).toBeEnabled();
    expect(z.opnames.propose).toHaveLength(1);
    expect(z.opnames['mail-check']).toHaveLength(1);
  });

  test('twee ontvangers en enkel de eerste kreeg de mail: geen zekere uitspraak, de waarschuwing', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, mailVerzonden(['luc@test.be']), {
      stubs: { tickets: metP1({ emailEindklant: 'klant@test.be' }) },
    });
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER + ' — voor wie de mail al kreeg is "verzonden" aangevinkt');
    await expect(verstuurKnop(page)).toBeEnabled();
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
    expect(z.opnames.propose).toHaveLength(1);
    expect(z.opnames['mail-check'].map(o => o.query.ontvangers)).toEqual(['luc@test.be,klant@test.be']);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST]);
    expect(await registerLokaal(page)).toEqual({ p1: { contact: T_MAIL, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' } }); // enkel contact
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body.doelgroepen)).toEqual([['contact']]);
  });

  test('een uitgaande mail met onleesbaar adres (twijfel) geeft de waarschuwing, nooit "niet verzonden"', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, { status: 200, json: { ok: true, verzonden: false, twijfel: true, tijdstip: null, uitgaand: [], ontvangers: { 'luc@test.be': { verzonden: false, tijdstip: null } } } });
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER);
    await expect(verstuurKnop(page)).toBeEnabled();
    await eenVerzendingEnEenControle(page, verzoeken, z);
  });

  test('afgebroken, mail gevonden: de knop blijft dicht tot het register bewaard is, daarna pas de melding', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, mailVerzonden(), {
      netFouten: [{ pad: '/api/voorstel-status', methode: 'POST' }],
      voorAf: (zz) => zz.zetAntwoord('voorstel-status', ({ methode }) => methode === 'GET' ? { status: 200, json: { versie: 0, status: {} } } : { hangen: true }),
    });
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'POST').length).toBe(1);
    await page.evaluate(() => Promise.resolve());
    await expect(verstuurKnop(page)).toBeDisabled(); // het register is nog onderweg: geen weg naar een tweede verzending
    await expect(verstuurKnop(page)).toHaveText('Bezig...');
    await page.clock.runFor(25000);
    await page.evaluate(() => Promise.resolve());
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (luc@test.be) — maar kon niet als verzonden aangevinkt worden (herlaad de pagina)');
    await expect(verstuurKnop(page)).toBeEnabled();
    expect(z.opnames.propose).toHaveLength(1);
  });

  test('twee ontvangers en beide kregen de mail: één melding per ontvanger', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, mailVerzonden(), { stubs: { tickets: metP1({ emailEindklant: 'klant@test.be' }) } });
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (luc@test.be); Mail is verzonden om 09:01 (klant@test.be) — voorstel als verzonden aangevinkt');
    expect(await registerLokaal(page)).toEqual({ p1: { contact: T_MAIL, klant: T_MAIL, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' } });
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST').map(o => o.body.doelgroepen)).toEqual([['contact', 'klant']]);
  });

  test('afgebroken, mail gevonden, register-POST geeft 500: "… maar kon niet als verzonden aangevinkt worden (herlaad de pagina)"', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, mailVerzonden(), {
      httpFouten: [{ pad: '/api/voorstel-status', status: 500 }],
      voorAf: (zz) => zz.zetAntwoord('voorstel-status', ({ methode }) => methode === 'GET'
        ? { status: 200, json: { versie: 0, status: {} } }
        : { status: 500, json: { error: 'Opslag kapot' } }),
    });
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (luc@test.be) — maar kon niet als verzonden aangevinkt worden (herlaad de pagina)');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST, START]);
    expect(z.opnames['voorstel-status'].filter(o => o.methode === 'POST')).toHaveLength(1);
    expect(z.opnames.propose).toHaveLength(1); // geen tweede verzending
  });

  test('een definitieve fout (500 { error }) of een ticket zonder e-mailadres start geen controle', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose'], httpFouten: [{ pad: '/api/propose', status: 500 }] });
    z.zetAntwoord('propose', { status: 500, json: { error: 'Zoho PATCH fout (500)' } });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✕ Zoho PATCH fout (500)');
    await expect(verstuurKnop(page)).toBeEnabled();
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE]);
    expect(mailCheckLijst(verzoeken)).toEqual([]);
  });

  test('zonder e-mailadres is er geen mail om te controleren: een afgebroken verzoek geeft enkel de gewone foutmelding', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/propose', methode: 'POST' }]);
    const z = await start(page, verzoeken, { paden: ['/api/propose'], stubs: { tickets: metP1({ email: '', emailEindklant: '', emailInstallateur: '' }) } });
    z.zetAntwoord('propose', { afbreken: 'failed' });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✕ Geen verbinding met de server');
    await expect(verstuurKnop(page)).toBeEnabled();
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE]);
    expect(mailCheckLijst(verzoeken)).toEqual([]);
  });
});
