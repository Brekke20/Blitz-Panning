// Productietests (etappe 5b, taak 1, fix-ronde 1): syncOplossingNaarZoho (schermen/rapport-verzenden.js) zet de uitgevoerde acties van een
// rapport als oplossing op het Zoho-ticket (POST /api/comment, W11). Enige aanroeper: de wizard na "Rapport versturen"
// (rapport-wizard.js, `syncOplossingNaarZoho(item.ticket.id, R.acties)`, een import).
// Twee wegen: (1) de echte wizard tot en met "✓ Rapport versturen" (de outbox doet daarna zijn eigen verzoeken);
// (2) directe aanroep van de blootgestelde functie in de pagina voor de randgevallen en foutpaden.
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, OPSTART_SCHRIJVEN, settle } from '../productie-hulp.mjs';

const COMMENT = 'POST /api/comment';
const START = 'POST /api/planning-sinds';

const schrijfLijst = async (page, verzoeken) => {
  await settle(page);
  return verzoeken.alle.filter(r => r.methode !== 'GET').map(r => `${r.methode} ${r.pad}`);
};
const toastTekst = (page) => page.locator('#toast');

// Stub met opname: antwoord is vast of een functie.
function commentStub(antwoord = { status: 200, json: { ok: true } }) {
  const opnames = [];
  return { opnames, comment: ({ methode, body, query }) => { opnames.push({ methode, body, query: Object.fromEntries(query) }); return typeof antwoord === 'function' ? antwoord({ body }) : antwoord; } };
}
const sync = (page, ...args) => page.evaluate((a) => kern.rapportVerzenden.syncOplossingNaarZoho(...a), args);

test.describe('syncOplossingNaarZoho: directe aanroep in productiemodus', () => {
  test('POST /api/comment met exact { ticketId, content } en getrimde inhoud; geen toast bij succes', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/comment']);
    const c = commentStub();
    await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: { comment: c.comment } });
    const toastVoor = await toastTekst(page).textContent();
    await sync(page, 'p1', '  Voeding gecontroleerd en controller herstart \n');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, COMMENT]);
    expect(c.opnames).toEqual([{ methode: 'POST', body: { ticketId: 'p1', content: 'Voeding gecontroleerd en controller herstart' }, query: {} }]);
    expect(Object.keys(c.opnames[0].body)).toEqual(['ticketId', 'content']);
    expect(verzoeken.van('/api/comment', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(await toastTekst(page).textContent()).toBe(toastVoor); // niets nieuws getoond
  });

  test('lege of ontbrekende inhoud of ticketId: vroege terugkeer, geen enkel verzoek (settled)', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    const c = commentStub();
    await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: { comment: c.comment } });
    await sync(page, 'p1', '');
    await sync(page, 'p1', '   \n\t ');
    await sync(page, 'p1', undefined);
    await sync(page, 'p1', null);
    await sync(page, '', 'Wel tekst');
    await sync(page, null, 'Wel tekst');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
    expect(c.opnames).toEqual([]);
    expect(verzoeken.van('/api/comment')).toEqual([]);
  });

  test('500 { error }: toast met de servertekst, het verzoek is wel verstuurd', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/comment']);
    verwachtHttpFout(verzoeken, [{ pad: '/api/comment', status: 500 }]);
    const c = commentStub({ status: 500, json: { error: 'Zoho-comment mislukt' } });
    await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: { comment: c.comment } });
    await sync(page, 'p1', 'Acties');
    await expect(toastTekst(page)).toHaveText('⚠ Oplossing kon niet automatisch bijgewerkt worden in Zoho: Zoho-comment mislukt');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, COMMENT]);
    expect(c.opnames).toHaveLength(1);
  });

  test('502 met HTML-body (gateway): toast met HTTP 502', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/comment']);
    verwachtHttpFout(verzoeken, [{ pad: '/api/comment', status: 502 }]);
    const c = commentStub({ status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: { comment: c.comment } });
    await sync(page, 'p1', 'Acties');
    // W5-fix: was HUIDIG GEDRAG (parserfout)
    await expect(toastTekst(page)).toHaveText('⚠ Oplossing kon niet automatisch bijgewerkt worden in Zoho: HTTP 502');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, COMMENT]);
  });

  test('HUIDIG GEDRAG (bug?): een 200 zonder { error } telt als succes, ook als het antwoord geen ok bevat; een 4xx met { error } toont de fout', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/comment']);
    verwachtHttpFout(verzoeken, [{ pad: '/api/comment', status: 400 }]);
    let n = 0;
    const c = commentStub(() => (++n === 1 ? { status: 200, json: {} } : { status: 400, json: { error: 'ticketId ongeldig' } }));
    await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: { comment: c.comment } });
    const voor = await toastTekst(page).textContent();
    await sync(page, 'p1', 'Eerste');
    await settle(page);
    expect(await toastTekst(page).textContent()).toBe(voor);
    await sync(page, 'p1', 'Tweede');
    await expect(toastTekst(page)).toHaveText('⚠ Oplossing kon niet automatisch bijgewerkt worden in Zoho: ticketId ongeldig');
    expect(c.opnames.map(o => o.body.content)).toEqual(['Eerste', 'Tweede']);
  });
});

test.describe('syncOplossingNaarZoho: via de echte wizard', () => {
  test('rapport versturen vanuit de wizard stuurt één POST /api/comment met ticket-id en de getrimde acties', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/comment', '/api/rapport', '/api/rapport-archief', '/api/optimize', '/api/route']);
    const c = commentStub();
    await startAppProductie(page, { technieker: 'Tim', vasteKlok: true, overschrijf: { comment: c.comment } });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.clock.runFor(1);
    await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
    const detail = page.getByRole('dialog', { name: /Energiemeting klopt niet/ });
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: '📋 Rapport' }).click();
    const wizard = page.getByRole('dialog', { name: '📋 Service Rapport' });
    await expect(wizard).toHaveClass(/open/);
    const volgende = wizard.getByRole('button', { name: 'Volgende →' });
    const stap = wizard.locator('#wiz-step-label');
    await wizard.getByRole('radio', { name: 'Interventie' }).check();
    await volgende.click();
    await volgende.click();
    await volgende.click();
    await expect(stap).toHaveText('4 / 9 — Omschrijving');
    await wizard.getByLabel('Omschrijving probleem').fill('Paal start niet op');
    await wizard.getByLabel('Ondernomen acties').fill('  Voeding gecontroleerd  ');
    await wizard.getByText('Productfout', { exact: true }).click();
    for (let i = 0; i < 5; i++) await volgende.click();
    await expect(stap).toHaveText('9 / 9 — Overzicht');
    expect(c.opnames).toEqual([]); // niets vóór de verzendknop
    await wizard.getByRole('button', { name: '✓ Rapport versturen' }).click();
    // Bevestigingsdialoog van de app: noemt de oplossing-sync bij een echt (niet-lokaal) ticket.
    const dialoog = page.getByRole('alertdialog', { name: 'Rapport versturen?' });
    await expect(dialoog).toContainText('De uitgevoerde acties komen als oplossing op het Zoho-ticket.');
    expect(c.opnames).toEqual([]);
    await dialoog.getByRole('button', { name: 'Versturen' }).click();
    await expect.poll(() => c.opnames.length).toBe(1);
    expect(c.opnames).toEqual([{ methode: 'POST', body: { ticketId: 'p1', content: 'Voeding gecontroleerd' }, query: {} }]);
    // Gemeten volgorde: aanrijtijd (optimize, route), dan de oplossing-sync (niet afgewacht), dan de outbox: archief, PDF-upload (rapport), archief.
    // De outbox werkt in meerdere asynchrone stappen (tussen twee verzoeken staat er kortstondig niets open): wacht daarom op de volledige lijst
    // in plaats van één keer te lezen na `settle`; een extra of ontbrekend verzoek laat de poll op zijn time-out falen met de laatste lijst.
    await expect.poll(() => schrijfLijst(page, verzoeken), { timeout: 15000 })
      .toEqual([START, 'POST /api/optimize', 'POST /api/route', COMMENT, 'POST /api/rapport-archief', 'POST /api/rapport', 'POST /api/rapport-archief']);
  });
});
