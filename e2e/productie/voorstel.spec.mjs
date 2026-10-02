// Productietests (etappe 5a, taak 3): het afspraakvoorstel (sendProposal) zonder testmodus, met de exacte
// payloads van POST /api/propose (verstuurt mail naar de klant via Zoho) en /api/voorstel-status (register).
// Karakterisering: het huidige gedrag staat vast, ook de eigenaardigheden (gemarkeerd met HUIDIG GEDRAG (bug?)).
// Alle uitgaande schrijfverzoeken worden per test exact opgesomd (`schrijfLijst`): een ontbrekend of extra
// verzoek laat de test falen. Foutantwoorden zijn per test expliciet toegelaten met `verwachtHttpFout`.
// Echte foutvormen (netlify/functions/propose.js, voorstel-status.js): propose geeft 400/404/500 met `{ error }`,
// een trage Zoho kan een Netlify-gateway 502 met HTML-body geven; voorstel-status geeft 409 `{ error, serverVersie }`.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, zohoStubs, OPSTART_SCHRIJVEN, settle, openKalender, metParserfout } from '../productie-hulp.mjs';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const TICKETS = JSON.parse(fs.readFileSync(path.join(MAP, '..', 'fixtures', 'tickets.json'), 'utf8'));
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
// `voorstelStatus` is een `let` in het klassieke script (globaal lexicaal bereik): bereikbaar als kale naam.
const registerLokaal = (page) => page.evaluate(() => JSON.parse(JSON.stringify(voorstelStatus)));
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

  test('tweede 409 in een rij: geen derde POST en het register blijft lokaal leeg', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/propose', '/api/voorstel-status'], register: { versie: 7, status: {} },
      httpFouten: [{ pad: '/api/voorstel-status', status: 409 }],
    });
    z.forceerConflicten(2);
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('✓ Voorstel verstuurd naar contactpersoon');
    await expect.poll(() => z.opnames['voorstel-status'].filter(o => o.methode === 'POST').length).toBe(2);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE, STATUS_POST, STATUS_POST]);
    // HUIDIG GEDRAG (bug?): de mail is verstuurd en het ticket staat bijgewerkt, maar het register is niet geschreven
    // en de gebruiker krijgt geen waarschuwing (enkel console.warn).
    expect(await registerLokaal(page)).toEqual({});
    expect(z.register().status).toEqual({});
    expect(await planningVan(page)).toEqual({ '2026-10-08': ['p1'], '2026-10-09': ['g1'] });
  });

  test('propose faalt na het versturen (Zoho-PATCH 500): foutmelding, knop terug, geen registerverzoek, ticket ongewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose'], httpFouten: [{ pad: '/api/propose', status: 500 }] });
    z.zetAntwoord('propose', { status: 500, json: { error: 'Zoho PATCH fout (500): {"message":"Zoho kapot"}' } });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();

    // HUIDIG GEDRAG (bug?): in propose.js komt deze 500 ook voor ná het verzenden van de mails (enkel de PATCH faalde);
    // de gebruiker ziet dan alleen de technische fouttekst, zonder waarschuwing dat de klant al gemaild kan zijn
    // (anders dan bij annuleren), en het register wordt niet geschreven.
    await expect(toastTekst(page)).toHaveText('✕ Zoho PATCH fout (500): {"message":"Zoho kapot"}');
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
    await expect(verstuurKnop(page)).toBeEnabled();
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
    expect(z.opnames.propose).toEqual([{ methode: 'POST', body: PROPOSE_BODY, query: {} }]);
    expect(z.opnames['voorstel-status'].filter(o => o.methode !== 'GET')).toEqual([]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, PROPOSE]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    expect(await lijstenVan(page)).toEqual({ tickets: ['t1', 't2', 't3'], pending: ['p1', 'p2'] });
    expect(await registerLokaal(page)).toEqual({});
    expect(await page.evaluate(() => kern.toestand.get('allPending').find(x => x.id === 'p1').interventieDatum)).toBe('2026-10-07T07:00:00.000Z');
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

  test('502 met HTML-body (gateway-timeout): toast met de technische parserfout, niets gewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/propose'], httpFouten: [{ pad: '/api/propose', status: 502 }] });
    z.zetAntwoord('propose', { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await openVoorstel(page);
    await vulIn(page, '2026-10-08', '10:00');
    await verstuurKnop(page).click();

    // HUIDIG GEDRAG (bug?): technische JSON-parserfout in de toast; bovendien kan de mail al verstuurd zijn
    // (gateway-timeout tijdens de Zoho-aanroepen) zonder dat de gebruiker dat te horen krijgt.
    await expect(toastTekst(page)).toHaveText(metParserfout('✕ '));
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur voorstel');
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
