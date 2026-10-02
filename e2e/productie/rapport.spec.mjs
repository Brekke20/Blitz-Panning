// Productietests (etappe 5b, taak 1): rapport verzenden vanuit het Rapporten-tabblad (voorbeeldRapport en
// verstuurRapport) zonder testmodus. W11: dit verstuurt het servicerapport naar klanten via Zoho
// (POST /api/send-rapport) en legt per doelgroep de status vast (POST /api/rapport-verzonden).
// Karakterisering: het huidige gedrag staat vast, ook de eigenaardigheden (gemarkeerd met HUIDIG GEDRAG (bug?)).
// Alle uitgaande schrijfverzoeken worden per test exact opgesomd (`schrijfLijst`); foutantwoorden zijn per test
// expliciet toegelaten met `verwachtHttpFout`. Echte foutvormen (netlify/functions/send-rapport.js,
// rapport-verzonden.js): send-rapport geeft 400/500 met `{ error }`, een trage Zoho kan een Netlify-gateway 502 met
// HTML-body geven; rapport-verzonden geeft 409 `{ error, serverVersie }` of 404 `{ error }`.
// Niet bereikbaar in een e2e-test (W11): wizard-afronding en /api/comment (node-test in taak 6).
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, zohoStubs, OPSTART_SCHRIJVEN, settle, metParserfout } from '../productie-hulp.mjs';

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
const lokaleRapporten = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window._rapportArchief)));
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

  test('zonder ontvangers: toast en geen venster', async ({ page, verzoeken }) => {
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

  test('502 met HTML-body (gateway): toast "✕ Voorbeeld ophalen mislukt" met de parserfout', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 502 }] });
    z.zetAntwoord('send-rapport', { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await verstuurKnop(page).click();
    await expect(toastTekst(page)).toHaveText(metParserfout('✕ Voorbeeld ophalen mislukt: '));
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
    expect(await page.evaluate(() => window._archiefVersie)).toBe(6);
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
    expect(await page.evaluate(() => window._archiefVersie)).toBe(4);
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
    await expect(toastTekst(page)).toHaveText('✓ Rapport verstuurd naar contactpersoon, maar status kon niet opgeslagen worden — NIET opnieuw versturen, herlaad eerst de pagina');
    // Het contact-status-verzoek faalde: de volgende (klant) gebruikt dezelfde, ongewijzigde versie 4.
    expect(z.opnames['rapport-verzonden'].map(o => [o.body.doelgroep, o.body.versie])).toEqual([['contact', 4], ['klant', 4]]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN, VERZONDEN]);
    expect(await lokaleRapporten(page)).toEqual([{ ...RAPPORT, verzondenKlant: TIJDSTIP }]);
    expect(await page.evaluate(() => window._archiefVersie)).toBe(5);
    // HUIDIG GEDRAG (bug?): bij een deels geslaagde status verschijnt enkel de laatste toast; de mislukte doelgroep (contact)
    // staat daarin, de geslaagde (klant) niet meer, en de kaart toont wel het badge door verzondenKlant.
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

  test('statusFout: mail verstuurd, maar ticketstatus niet gezet: de waarschuwing komt na de succestoast', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport', '/api/rapport-verzonden'] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : VERZONDEN_OK({ contact: true }, { statusUpdated: false, statusFout: 'Zoho 500' }));
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('⚠ Mail verstuurd, maar ticketstatus in Zoho kon niet naar "Gesloten - ov" gezet worden: Zoho 500');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND, VERZONDEN]);
    // De mail is wel verstuurd en de status staat opgeslagen: badge.
    expect(await lokaleRapporten(page)).toEqual([{ ...RAPPORT, verzondenContact: TIJDSTIP }]);
    await expect(verstuurKnop(page)).toHaveText('✓ Verzonden');
  });

  test('echt verzoek: 500 { error }: toast "✕ …", geen status-verzoeken en de knop blijft uitgeschakeld', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 500 }] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : { status: 500, json: { error: 'Zoho upload mislukt' } });
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText('✕ Zoho upload mislukt');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
    // HUIDIG GEDRAG (bug?): bij een fout wordt de kaart niet hertekend, dus de knop blijft uitgeschakeld tot herladen
    // (de code zegt "terug inschakelen hoeft niet", maar dat geldt enkel na een geslaagde render).
    await expect(verstuurKnop(page)).toBeDisabled();
  });

  test('echt verzoek: 502 met HTML-body: toast met de parserfout', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/send-rapport'], httpFouten: [{ pad: '/api/send-rapport', status: 502 }] });
    z.zetAntwoord('send-rapport', ({ body }) => body.preview === true
      ? VOORBEELD(ontvanger('contact', 'c@y.be'))
      : { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await openVoorbeeld(page);
    await bevestig(page);
    await expect(toastTekst(page)).toHaveText(metParserfout('✕ '));
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, SEND, SEND]);
    expect(z.opnames['rapport-verzonden']).toEqual([]);
  });
});
