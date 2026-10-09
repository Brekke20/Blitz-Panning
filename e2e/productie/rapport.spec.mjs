// Productietests (etappe 5b, taak 1): rapport verzenden vanuit het Rapporten-tabblad (voorbeeldRapport en
// verstuurRapport) zonder testmodus. W11: dit verstuurt het servicerapport naar klanten via Zoho
// (POST /api/send-rapport) en legt per doelgroep de status vast (POST /api/rapport-verzonden).
// Karakterisering: het huidige gedrag staat vast, ook de eigenaardigheden (gemarkeerd met HUIDIG GEDRAG (bug?)).
// Alle uitgaande schrijfverzoeken worden per test exact opgesomd (`schrijfLijst`); foutantwoorden zijn per test
// expliciet toegelaten met `verwachtHttpFout`. Echte foutvormen (netlify/functions/send-rapport.js,
// rapport-verzonden.js): send-rapport geeft 400/500 met `{ error }`, een trage Zoho kan een Netlify-gateway 502 met
// HTML-body geven; rapport-verzonden geeft 409 `{ error, serverVersie }` of 404 `{ error }`.
// Niet bereikbaar in een e2e-test (W11): wizard-afronding en /api/comment (node-test in taak 6).
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, verwachtNetwerkFout, zohoStubs, OPSTART_SCHRIJVEN, settle, laatMailControleHerhalen, mailCheckQuery } from '../productie-hulp.mjs';

const START = 'POST /api/planning-sinds';
const SEND = 'POST /api/send-rapport';
const VERZONDEN = 'POST /api/rapport-verzonden';
// De klok staat vast op VASTE_NU = 5 okt 09:00 lokaal = 07:00 UTC.
const TIJDSTIP = '2026-10-05T07:00:00.000Z';
const HTML = '<p>Rapport</p>';
const RAPPORT = { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Tim', rapportData: { _html: HTML } };
const SEED = { versie: 4, rapports: [RAPPORT] };

const schrijfLijst = async (page, verzoeken) => {
  await settle(page);
  return verzoeken.alle.filter(r => r.methode !== 'GET').map(r => `${r.methode} ${r.pad}`);
};
const toastTekst = (page) => page.locator('#toast');
const verstuurKnop = (page) => page.locator('.btn-verstuur-rapport');
const overlay = (page) => page.locator('#rapport-preview-overlay');
const lokaleRapporten = (page) => page.evaluate(() => JSON.parse(JSON.stringify(kern.rapportArchief.lijst())));
const SEND_BODY_PREVIEW = { ticketId: 't1', html: HTML, ticketNumber: '1001', preview: true };
const SEND_BODY = { ticketId: 't1', html: HTML, ticketNumber: '1001' };
const ontvanger = (doelgroep, email, naam = 'Naam') => ({ doelgroep, naam, email, html: `<p>mail voor ${doelgroep}</p>` });
const VOORBEELD = (...ontvangers) => ({ status: 200, json: { preview: true, ontvangers } });
const VERZONDEN_OK = (emailSent, extra = {}) => ({
  status: 200,
  json: { success: true, emailSent: { contact: false, klant: false, installateur: false, ...emailSent }, fouten: [], statusUpdated: true, statusFout: null, ...extra },
});

async function start(page, verzoeken, { paden = [], stubs = {}, httpFouten = [] } = {}) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, ...paden]);
  if (httpFouten.length) verwachtHttpFout(verzoeken, httpFouten);
  const z = zohoStubs({ rapporten: SEED });
  await startAppProductie(page, { vasteKlok: true, overschrijf: { ...z.overschrijf, ...stubs } });
  // Rapporten-tab: de hertekening via setTimeout(…, 0) laten lopen, zodat de klik daarna niet weggegooid wordt.
  await page.getByRole('tab', { name: 'Rapporten' }).click();
  await page.clock.runFor(1);
  await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur rapport');
  return z;
}
// Open het voorbeeldvenster (de bevestigknop wordt nog niet gebruikt).
async function openVoorbeeld(page) {
  await verstuurKnop(page).click();
  await expect(overlay(page)).toHaveClass(/open/);
}
async function bevestig(page) {
  await page.locator('#rapport-preview-send-btn').click();
}

test.describe('rapport verzenden: voorbeeld (voorbeeldRapport)', () => {
  test('twee ontvangers: POST send-rapport met preview, venster toont ticket, iframes in een sandbox en labels', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'] });
    z.zetAntwoord('send-rapport', VOORBEELD(ontvanger('contact', 'c@y.be'), ontvanger('klant', 'x@y.be')));
    await openVoorbeeld(page);

    expect(z.opnames['send-rapport']).toEqual([{ methode: 'POST', body: SEND_BODY_PREVIEW, query: {} }]);
    expect(verzoeken.van('/api/send-rapport', 'POST')[0].headers['content-type']).toBe('application/json');
    await expect(page.locator('#rapport-preview-ticket-label')).toHaveText('Ticket #1001');
    const frames = page.locator('#rapport-preview-body iframe');
    await expect(frames).toHaveCount(2);
    expect(await frames.evaluateAll(f => f.map(x => x.getAttribute('sandbox')))).toEqual(['', '']);
    expect(await frames.evaluateAll(f => f.map(x => x.getAttribute('srcdoc')))).toEqual(['<p>mail voor contact</p>', '<p>mail voor klant</p>']);
    await expect(page.locator('#rapport-preview-body')).toContainText('Aan contactpersoon — c@y.be');
    await expect(page.locator('#rapport-preview-body')).toContainText('Aan klant — x@y.be');
    await expect(page.locator('#rapport-preview-send-btn')).toBeEnabled();
    // Het voorbeeld verstuurt niets en zet geen status.
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
    expect(z.archief()).toEqual(SEED);
  });

  test('Annuleren en achtergrondklik sluiten het venster zonder verzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'] });
    z.zetAntwoord('send-rapport', VOORBEELD(ontvanger('contact', 'c@y.be')));
    await openVoorbeeld(page);
    await overlay(page).getByRole('button', { name: 'Annuleren' }).click();
    await expect(overlay(page)).not.toHaveClass(/open/);
    await openVoorbeeld(page);
    await overlay(page).click({ position: { x: 5, y: 5 } });
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]); // enkel de twee voorbeeldverzoeken
    expect(z.opnames['send-rapport'].map(o => o.body.preview)).toEqual([true, true]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
  });

  test('enkel client-karakterisering: een 200 met lege ontvangerslijst geeft toast en geen venster (de echte backend antwoordt dan 400, zie de volgende test)', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'] });
    z.zetAntwoord('send-rapport', VOORBEELD());
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('⚠ Geen gekend e-mailadres (klant of installateur) op dit ticket');
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND]);
  });

  test('echte foutvorm 400 { error } (geen adressen): toast met de servertekst, geen venster', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 400 }] });
    z.zetAntwoord('send-rapport', { status: 400, json: { error: 'Geen gekend e-mailadres (klant of installateur) op dit ticket' } });
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('⚠ Geen gekend e-mailadres (klant of installateur) op dit ticket');
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND]);
  });

  test('500 { error }: toast "⚠ …" en geen venster', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 500 }] });
    z.zetAntwoord('send-rapport', { status: 500, json: { error: 'Zoho tijdelijk niet bereikbaar' } });
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText('⚠ Zoho tijdelijk niet bereikbaar');
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND]);
  });

  test('502 met HTML-body (gateway): toast "✕ Voorbeeld ophalen mislukt" met HTTP 502', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 502 }] });
    z.zetAntwoord('send-rapport', { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await verstuurKnop(page).click();
    // W5-fix: was HUIDIG GEDRAG (parserfout)
    // W5-fix (Q2): gewone Nederlandse tekst in plaats van de technische foutklasse.
    await expect(toastTekst(page)).toHaveText('✕ Voorbeeld ophalen mislukt: Serverfout (HTTP 502)');
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND]);
  });

  test('_previewSeq: een trager eerste voorbeeldverzoek wordt genegeerd als een nieuwere klik het overschrijft', async ({ page, verzoeken }) => {
    let open;
    const poort = new Promise(r => { open = r; });
    let n = 0;
    const z = zohoStubs({ rapporten: SEED });
    const trage = async (arg) => {
      const volgnr = ++n;
      if (volgnr === 1) await poort; // het eerste verzoek blijft hangen tot na het tweede
      return VOORBEELD(ontvanger('contact', volgnr === 1 ? 'eerste@test.be' : 'tweede@test.be'));
    };
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/send-rapport']);
    await startAppProductie(page, { vasteKlok: true, overschrijf: { ...z.overschrijf, 'send-rapport': trage } });
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    await page.clock.runFor(1);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur rapport');

    await verstuurKnop(page).click(); // verzoek 1: blijft hangen
    await expect.poll(() => verzoeken.van('/api/send-rapport', 'POST').length).toBe(1);
    await verstuurKnop(page).click(); // verzoek 2: antwoordt meteen
    await expect(overlay(page)).toHaveClass(/open/);
    await expect(page.locator('#rapport-preview-body')).toContainText('tweede@test.be');
    open(); // nu antwoordt verzoek 1: zijn seq is verouderd, dus het mag het venster niet overschrijven
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    await expect(page.locator('#rapport-preview-body iframe')).toHaveCount(1);
    await expect(page.locator('#rapport-preview-body')).toContainText('tweede@test.be');
    await expect(page.locator('#rapport-preview-body')).not.toContainText('eerste@test.be');
  });
});

test.describe('rapport verzenden: versturen (verstuurRapport)', () => {
  test('contact en klant: één rapport-verzonden per doelgroep met de versieketen 4, 5; badge en toast', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport', '/api/rapport-verzonden'] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'), ontvanger('klant', 'x@y.be'))
      : VERZONDEN_OK({ contact: true, klant: true }));
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar contactpersoon en klant');

    expect(z.opnames['send-rapport']).toEqual([
      { methode: 'POST', body: SEND_BODY_PREVIEW, query: {} },
      { methode: 'POST', body: SEND_BODY, query: {} }, // zonder preview
    ]);
    expect('preview' in z.opnames['send-rapport'][1].body).toBe(false);
    expect(z.opnames['rapport-verzonden']).toEqual([
      { methode: 'POST', body: { id: 'r1', doelgroep: 'contact', tijdstip: TIJDSTIP, versie: 4 }, query: {} },
      { methode: 'POST', body: { id: 'r1', doelgroep: 'klant', tijdstip: TIJDSTIP, versie: 5 }, query: {} },
    ]);
    expect(verzoeken.van('/api/rapport-verzonden', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN, VERZONDEN]);
    expect(z.archief()).toEqual({ versie: 6, rapports: [{ ...RAPPORT, verzondenContact: TIJDSTIP, verzondenKlant: TIJDSTIP }] });
    // Lokaal: velden gevuld, badge op de kaart, venster dicht, de versie in de app is de laatst ontvangen.
    expect(await lokaleRapporten(page)).toEqual([{ ...RAPPORT, verzondenContact: TIJDSTIP, verzondenKlant: TIJDSTIP }]);
    expect(await page.evaluate(() => kern.rapportArchief.versie())).toBe(6);
    await expect(verstuurKnop(page)).toHaveText('✓ Verzonden');
    await expect(verstuurKnop(page)).toBeEnabled();
    await expect(overlay(page)).not.toHaveClass(/open/);
  });

  test('alle drie de doelgroepen: volgorde contact, klant, installateur en versieketen 4, 5, 6', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport', '/api/rapport-verzonden'] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'), ontvanger('klant', 'x@y.be'), ontvanger('installateur', 'i@y.be'))
      : VERZONDEN_OK({ contact: true, klant: true, installateur: true }));
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar contactpersoon, klant en installateur');
    expect(z.opnames['rapport-verzonden'].map(o => [o.body.doelgroep, o.body.versie])).toEqual([['contact', 4], ['klant', 5], ['installateur', 6]]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN, VERZONDEN, VERZONDEN]);
    expect(await lokaleRapporten(page)).toEqual([{ ...RAPPORT, verzondenContact: TIJDSTIP, verzondenKlant: TIJDSTIP, verzondenInstallateur: TIJDSTIP }]);
  });

  test('dubbelklikbeveiliging: de knop is uitgeschakeld zolang het echte verzoek loopt (één send-rapport zonder preview)', async ({ page, verzoeken }) => {
    let open;
    const poort = new Promise(r => { open = r; });
    const z = zohoStubs({ rapporten: SEED });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : VERZONDEN_OK({ contact: true }));
    const gewacht = async (arg) => {
      if (arg.body?.preview !== true) await poort; // het echte verzoek blijft hangen
      return z.overschrijf['send-rapport'](arg);
    };
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/send-rapport', '/api/rapport-verzonden']);
    await startAppProductie(page, { vasteKlok: true, overschrijf: { ...z.overschrijf, 'send-rapport': gewacht } });
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    await page.clock.runFor(1);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur rapport');
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('📤 Rapport versturen...');
    await expect(verstuurKnop(page)).toBeDisabled();
    await expect(page.locator('#rapport-preview-send-btn')).toBeDisabled();
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(verzoeken.van('/api/send-rapport', 'POST').filter(r => r.body.preview !== true)).toHaveLength(1);
    open();
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar contactpersoon');
    // De kaart is opnieuw opgebouwd (renderRapportArchief): knop weer actief, nu met het badge.
    await expect(verstuurKnop(page)).toBeEnabled();
    await expect(verstuurKnop(page)).toHaveText('✓ Verzonden');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN]);
  });

  test('rapport-verzonden faalt (409) voor de klant: geen badge en de NIET-opnieuw-versturen-toast', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport', '/api/rapport-verzonden'], httpFouten: [{ pad: '/api/rapport-verzonden', status: 409 }] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('klant', 'x@y.be'))
      : VERZONDEN_OK({ klant: true }));
    z.zetAntwoord('rapport-verzonden', { status: 409, json: { error: 'Rapportarchief ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: 9 } });
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar klant, maar status kon niet opgeslagen worden — NIET opnieuw versturen, herlaad eerst de pagina');
    expect(z.opnames['rapport-verzonden']).toEqual([{ methode: 'POST', body: { id: 'r1', doelgroep: 'klant', tijdstip: TIJDSTIP, versie: 4 }, query: {} }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN]);
    // Geen badge: lokaal niets gezet en de versie in de app ongewijzigd (HUIDIG GEDRAG: ook geen serverVersie overgenomen).
    expect(await lokaleRapporten(page)).toEqual([RAPPORT]);
    expect(await page.evaluate(() => kern.rapportArchief.versie())).toBe(4);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur rapport');
  });

  test('rapport-verzonden: 502 met HTML-body voor contact, daarna lukt klant niet meer met de oude versie: enkel klant mist', async ({ page, verzoeken }) => {
    // Eerste doelgroep (contact) krijgt een gateway-502 (res.json() faalt), tweede (klant) slaagt met versie 4.
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport', '/api/rapport-verzonden'], httpFouten: [{ pad: '/api/rapport-verzonden', status: 502 }] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'), ontvanger('klant', 'x@y.be'))
      : VERZONDEN_OK({ contact: true, klant: true }));
    let n = 0;
    z.zetAntwoord('rapport-verzonden', () => (++n === 1 ? { status: 502, raw: '<html>Bad Gateway</html>' } : { status: 200, json: { ok: true, versie: 5 } }));
    await openVoorbeeld(page);
    await bevestig(page);
    // B6: één melding met alle mail-weg-doelgroepen en de doelgroep waarvan de status niet opgeslagen werd.
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar contactpersoon en klant, maar status kon niet opgeslagen worden voor contactpersoon — NIET opnieuw versturen, herlaad eerst de pagina');
    // Het contact-status-verzoek faalde: de volgende (klant) gebruikt dezelfde, ongewijzigde versie 4.
    expect(z.opnames['rapport-verzonden'].map(o => [o.body.doelgroep, o.body.versie])).toEqual([['contact', 4], ['klant', 4]]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN, VERZONDEN]);
    expect(await lokaleRapporten(page)).toEqual([{ ...RAPPORT, verzondenKlant: TIJDSTIP }]);
    expect(await page.evaluate(() => kern.rapportArchief.versie())).toBe(5);
    // De kaart toont wel het badge door verzondenKlant.
    await expect(verstuurKnop(page)).toHaveText('✓ Verzonden');
  });

  test('fouten zonder emailSent: toast "geweigerd door Zoho" met alle details en geen status-verzoeken', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'), ontvanger('klant', 'x@y.be'))
      : VERZONDEN_OK({}, { fouten: [{ doelgroep: 'contact', fout: 'Zoho 422' }, { doelgroep: 'klant', fout: 'Zoho 400' }] }));
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('⚠ Rapport versturen geweigerd door Zoho (contact: Zoho 422; klant: Zoho 400)');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
    expect(await lokaleRapporten(page)).toEqual([RAPPORT]);
    await expect(verstuurKnop(page)).toHaveText('✉️ Verstuur rapport');
  });

  test('geen adressen bekend (niemand verstuurd, geen fouten): toast "kon niet verstuurd worden"', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : VERZONDEN_OK({}));
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('⚠ Rapport kon niet verstuurd worden (geen adressen bekend)');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
  });

  test('statusFout: mail verstuurd, maar ticketstatus niet gezet: de waarschuwing staat in dezelfde melding als het succes', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport', '/api/rapport-verzonden'] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : VERZONDEN_OK({ contact: true }, { statusUpdated: false, statusFout: 'Zoho 500' }));
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar contactpersoon ⚠ Ticketstatus in Zoho kon niet naar "Gesloten - ov" gezet worden: Zoho 500');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN]);
    // De mail is wel verstuurd en de status staat opgeslagen: badge.
    expect(await lokaleRapporten(page)).toEqual([{ ...RAPPORT, verzondenContact: TIJDSTIP }]);
    await expect(verstuurKnop(page)).toHaveText('✓ Verzonden');
  });

  test('echt verzoek: 500 { error }: toast "✕ …", geen status-verzoeken en de knop is weer bruikbaar', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 500 }] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : { status: 500, json: { error: 'Zoho upload mislukt' } });
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✕ Zoho upload mislukt');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
    // B5: een 500 met { error } is een definitief antwoord (de server faalde vóór de verzendlus): niets verstuurd, de knop is weer bruikbaar.
    await expect(verstuurKnop(page)).toBeEnabled();
  });

  test('echt verzoek: 400 { error } (geen adressen) maakt de knop weer bruikbaar', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 400 }] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : { status: 400, json: { error: 'Geen gekend e-mailadres (klant of installateur) op dit ticket' } });
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✕ Geen gekend e-mailadres (klant of installateur) op dit ticket');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
    await expect(verstuurKnop(page)).toBeEnabled();
  });

  test('echt verzoek: 502 met HTML-body: toast met HTTP 502', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 502 }] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await openVoorbeeld(page);
    await bevestig(page);
    // W5-fix: was HUIDIG GEDRAG (parserfout)
    // W5-fix (Q2): gewone Nederlandse tekst in plaats van de technische foutklasse.
    // T8b (Q1, omgedraaid): een 502 is een onzeker resultaat; de app controleert (enkel lezen) of de mail al weg is. De standaardstub van
    // mail-check zegt "niet verzonden": de melding en de knop gaan weer open (I1: na de tweede controle). De volledige reeks staat in de describe "onzeker resultaat".
    await laatMailControleHerhalen(page, z);
    await expect(toastTekst(page)).toHaveText('⚠ Mail is niet verzonden — je kan veilig opnieuw versturen');
    await expect(verstuurKnop(page)).toBeEnabled();
    expect(z.opnames['mail-check']).toHaveLength(2);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
  });
});

test.describe('rapport verzenden: vroege controles en ontbrekend ticketnummer', () => {
  // De knop bestaat enkel voor een rapport met id, _html en ticketId; de vroege terugkeer in voorbeeldRapport/verstuurRapport
  // is dus alleen via een directe aanroep van de functies (kern.rapportVerzenden) te bereiken. Er mag dan geen enkel verzoek volgen.
  const R2 = { id: 'r2', ticketNumber: '1002', datum: '2026-10-05', technieker: 'Tim', rapportData: { _html: HTML } }; // geen ticketId
  const R3 = { id: 'r3', ticketId: 't3', ticketNumber: '1003', datum: '2026-10-05', technieker: 'Tim', rapportData: {} }; // geen _html
  const R4 = { id: 'r4', ticketId: 't4', datum: '2026-10-05', technieker: 'Tim', rapportData: { _html: HTML } }; // geen ticketNumber

  async function startMet(page, verzoeken, rapports, paden = []) {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, ...paden]);
    const z = zohoStubs({ rapporten: { versie: 4, rapports } });
    await startAppProductie(page, { vasteKlok: true, overschrijf: z.overschrijf });
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    await page.clock.runFor(1);
    return z;
  }

  for (const functie of ['voorbeeldRapport', 'verstuurRapport']) {
    test(`${functie}: onbekend rapport, zonder ticketId en zonder _html geven elk hun toast en doen geen verzoek`, async ({ page, verzoeken }) => {
      const z = await startMet(page, verzoeken, [RAPPORT, R2, R3]);
      await expect(page.locator('.btn-verstuur-rapport')).toHaveCount(1); // enkel r1 krijgt een knop
      const roep = (id) => page.evaluate(([f, i]) => kern.rapportVerzenden[f](i), [functie, id]);
      await roep('bestaat-niet');
      await expect(toastTekst(page)).toHaveText('⚠ Rapport niet gevonden');
      await roep('r2');
      await expect(toastTekst(page)).toHaveText('⚠ Geen ticket gekoppeld aan dit rapport');
      await roep('r3');
      await expect(toastTekst(page)).toHaveText('⚠ Geen opgeslagen rapport-inhoud om te versturen');
      expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
      expect(z.opnames['send-rapport']).toEqual([]);
      expect(z.opnames['rapport-verzonden']).toEqual([]);
      await expect(overlay(page)).not.toHaveClass(/open/);
    });
  }

  test('zonder ticketNumber: het veld ontbreekt in beide bodies, het label valt terug op het ticket-id', async ({ page, verzoeken }) => {
    const z = await startMet(page, verzoeken, [R4], ['/api/send-rapport', '/api/rapport-verzonden']);
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : VERZONDEN_OK({ contact: true }));
    await openVoorbeeld(page);
    await expect(page.locator('#rapport-preview-ticket-label')).toHaveText('Ticket #t4');
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar contactpersoon');
    expect(z.opnames['send-rapport'].map(o => o.body)).toEqual([
      { ticketId: 't4', html: HTML, preview: true },
      { ticketId: 't4', html: HTML },
    ]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN]);
  });
});


// ── T8b (Q1): onzeker resultaat van send-rapport (afgebroken of 502): de app controleert (enkel lezen: GET /api/mail-check) of de mail al weg is ──
// De rapportwizard en de outbox blijven buiten beeld (D19). Nooit een tweede send-rapport; de status "✓ Verzonden" wordt niet vanzelf gezet.
const MAILCHECK = '/api/mail-check';
const T_MAIL = '2026-10-05T07:01:00.000Z'; // 09:01 in Brussel
const mailCheckLijst = (verzoeken) => verzoeken.alle.filter(r => r.pad === MAILCHECK).map(r => r.methode);
const MAIL_ONZEKER = '⚠ De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt';
const MAIL_VERZONDEN = { status: 200, json: { ok: true, twijfel: false, verzonden: true, tijdstip: T_MAIL, uitgaand: [{ aan: 'c@y.be', tijdstip: T_MAIL }] } };
const MAIL_NIET = { status: 200, json: { ok: true, twijfel: false, verzonden: false, tijdstip: null, uitgaand: [] } };

async function verstuurAfgebroken(page, verzoeken, mailCheck, { httpFouten = [], netFouten = [] } = {}) {
  verwachtNetwerkFout(verzoeken, [{ pad: '/api/send-rapport', methode: 'POST' }, ...netFouten]);
  const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten });
  z.zetAntwoord('send-rapport', ({ body }) => body.preview === true ? VOORBEELD(ontvanger('contact', 'c@y.be')) : { afbreken: 'failed' });
  z.zetAntwoord('mail-check', mailCheck);
  await openVoorbeeld(page);
  await bevestig(page);
  return z;
}
// Eén voorbeeld en één echte verzending, geen status-schrijfacties, precies één GET naar mail-check met ticket en begin van de verzending.
async function eenVerzendingEnEenControle(page, verzoeken, z, { controles = 1 } = {}) {
  expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
  expect(z.opnames['send-rapport'].map(o => 'preview' in o.body)).toEqual([true, false]);
  expect(z.opnames['rapport-verzonden']).toEqual([]);
  expect(mailCheckLijst(verzoeken)).toEqual(Array(controles).fill('GET'));
  expect(z.opnames['mail-check'].map(o => ({ methode: o.methode, query: mailCheckQuery(o) }))).toEqual(Array(controles).fill({ methode: 'GET', query: { ticketId: 't1', verlopenMs: 'N' } }));
}

test.describe('rapport verzenden: onzeker resultaat, controle of de mail al weg is (Q1)', () => {
  test('afgebroken en de mail is al verzonden: melding met uur, de knop blijft uit en er komt geen tweede verzending', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, MAIL_VERZONDEN);
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (c@y.be)');
    await expect(verstuurKnop(page)).toBeDisabled();
    await eenVerzendingEnEenControle(page, verzoeken, z);
    expect(await lokaleRapporten(page)).toEqual([RAPPORT]); // de controle schrijft zelf niets
  });

  test('afgebroken en de mail is niet verzonden: melding en de knop kan opnieuw', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, MAIL_NIET);
    await laatMailControleHerhalen(page, z);
    await expect(toastTekst(page)).toHaveText('⚠ Mail is niet verzonden — je kan veilig opnieuw versturen');
    await expect(verstuurKnop(page)).toBeEnabled();
    await eenVerzendingEnEenControle(page, verzoeken, z, { controles: 2 });
    expect(await lokaleRapporten(page)).toEqual([RAPPORT]);
  });

  test('na "verzonden" vraagt een volgende verzending van hetzelfde rapport eerst een bevestiging: Terug verstuurt niets, bevestigen precies één verzoek', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/send-rapport', methode: 'POST' }]);
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport', '/api/rapport-verzonden'] });
    let echt = 0;
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : (++echt === 1 ? { afbreken: 'failed' } : VERZONDEN_OK({ contact: true })));
    z.zetAntwoord('mail-check', MAIL_VERZONDEN);
    const dialoog = page.getByRole('alertdialog', { name: 'Mail al gedetecteerd' });
    const soorten = () => z.opnames['send-rapport'].map(o => (o.body.preview === true ? 'voorbeeld' : 'echt'));

    await openVoorbeeld(page);
    await bevestig(page); // geen detectie bekend: geen vraag, de verzending zelf valt onzeker uit
    await expect(toastTekst(page)).toHaveText('✓ Mail is verzonden om 09:01 (c@y.be)');
    await expect(verstuurKnop(page)).toBeDisabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_mail_gedetecteerd')))).toEqual({ r1: '2026-10-05T07:01:00.000Z' });
    expect(soorten()).toEqual(['voorbeeld', 'echt']);

    // Een latere hertekening (tabwissel) zet de knop weer open, want de status "Verzonden" is niet geschreven.
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    await page.clock.runFor(1);
    await expect(verstuurKnop(page)).toBeEnabled();

    // Eerste poging: de vraag verschijnt; Terug verstuurt niets (enkel het voorbeeld ging langs de server).
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(dialoog).toBeVisible();
    await expect(dialoog).toContainText('Er is om 09:01 al een mail naar de klant gedetecteerd. Toch opnieuw versturen?');
    await expect(verstuurKnop(page)).toBeDisabled(); // de rijknop is tijdens de vraag al op slot
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(dialoog).toHaveCount(0);
    await expect(verstuurKnop(page)).toBeEnabled(); // Terug: weer bruikbaar
    expect(soorten()).toEqual(['voorbeeld', 'echt', 'voorbeeld']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_mail_gedetecteerd')))).toEqual({ r1: '2026-10-05T07:01:00.000Z' }); // blijft onthouden
    expect(z.opnames['rapport-verzonden']).toEqual([]);

    // Tweede poging: bevestigen verstuurt precies één echt verzoek, en de onthouden detectie is dan gewist.
    await verstuurKnop(page).click();
    await expect(overlay(page)).toHaveClass(/open/);
    await bevestig(page);
    await expect(dialoog).toBeVisible();
    await dialoog.getByRole('button', { name: 'Toch opnieuw versturen' }).click();
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar contactpersoon');
    expect(soorten()).toEqual(['voorbeeld', 'echt', 'voorbeeld', 'voorbeeld', 'echt']);
    expect(z.opnames['rapport-verzonden']).toHaveLength(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_mail_gedetecteerd')))).toEqual({});
    expect(mailCheckLijst(verzoeken)).toEqual(['GET']);
  });

  test('"niet verzonden" of een onzekere controle onthoudt niets: geen vraag bij de volgende verzending', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, MAIL_NIET);
    await laatMailControleHerhalen(page, z);
    await expect(toastTekst(page)).toHaveText('⚠ Mail is niet verzonden — je kan veilig opnieuw versturen');
    expect(await page.evaluate(() => localStorage.getItem('blitz_mail_gedetecteerd'))).toBeNull();
    await eenVerzendingEnEenControle(page, verzoeken, z, { controles: 2 });
  });

  test('onleesbaar adres of een draft-status (twijfel) geeft de waarschuwing, nooit "niet verzonden"', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, { status: 200, json: { ok: true, verzonden: false, twijfel: true, tijdstip: null, uitgaand: [] } });
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER);
    await expect(verstuurKnop(page)).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('blitz_mail_gedetecteerd'))).toBeNull();
    await eenVerzendingEnEenControle(page, verzoeken, z);
  });

  test('de controle zelf faalt (502): de waarschuwing "kijk dit na in Zoho" en de knop blijft uit', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, { status: 502, json: { error: 'Zoho threads ophalen mislukt (503)' } }, { httpFouten: [{ pad: MAILCHECK, status: 502 }] });
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER);
    await expect(verstuurKnop(page)).toBeDisabled();
    await eenVerzendingEnEenControle(page, verzoeken, z);
  });

  test('een antwoord van de controle dat niet te lezen is geeft de waarschuwing, nooit "niet verzonden"', async ({ page, verzoeken }) => {
    const z = await verstuurAfgebroken(page, verzoeken, { status: 200, raw: '<html>Bad Gateway</html>' });
    await expect(toastTekst(page)).toHaveText(MAIL_ONZEKER);
    await expect(verstuurKnop(page)).toBeDisabled();
    await eenVerzendingEnEenControle(page, verzoeken, z);
  });

  test('een 500 { error } (definitief antwoord) start geen controle', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 500 }] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true ? VOORBEELD(ontvanger('contact', 'c@y.be')) : { status: 500, json: { error: 'Zoho tijdelijk niet bereikbaar' } });
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✕ Zoho tijdelijk niet bereikbaar');
    await expect(verstuurKnop(page)).toBeEnabled(); // B5: definitief antwoord, niets verstuurd
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    expect(mailCheckLijst(verzoeken)).toEqual([]);
  });

  // I1: de strengere B5-regel. Een antwoord dat niet als { error } te lezen is, bewijst niet dat er niets verstuurd werd
  // (bv. een afgekapt 200-antwoord nadat de mail al weg was): de knop blijft op slot, geen statusverzoeken, geen mailcontrole.
  for (const [naam, antwoord, toast] of [
    ['een 500 met onleesbare HTML-body', { status: 500, raw: '<html>Internal Server Error</html>' }, '✕ Serverfout (HTTP 500)'],
    ['een 200 met onleesbare (afgekapte) body', { status: 200, raw: '<html>Bad Gateway</html>' }, '✕ Serverfout (HTTP 200)'],
  ]) {
    test(`${naam}: de knop blijft op slot (geen bewijs dat er niets verstuurd is), geen statusverzoeken en geen controle`, async ({ page, verzoeken }) => {
      const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: antwoord.status >= 400 ? [{ pad: '/api/send-rapport', status: antwoord.status }] : [] });
      z.zetAntwoord('send-rapport', ({ body }) => body.preview === true ? VOORBEELD(ontvanger('contact', 'c@y.be')) : antwoord);
      await openVoorbeeld(page);
      await bevestig(page);
      await expect(toastTekst(page)).toHaveText(toast);
      await expect(verstuurKnop(page)).toBeDisabled();
      expect(z.opnames['rapport-verzonden']).toEqual([]);
      expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
      expect(mailCheckLijst(verzoeken)).toEqual([]);
    });
  }
});
