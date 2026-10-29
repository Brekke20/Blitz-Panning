// De balk "Gegevens van HH:MM — Zoho even niet bereikbaar" (kern/gegevens-stand.js, app.js: zetVerouderdBalk) en de knop Vernieuwen
// (?vers=1). Productiemodus: /api/tickets is gestubd en kan de koppen van de echte server nabootsen.
// Klok: maandag 5 okt 2026 09:00 Brusselse tijd (VASTE_NU); een momentopname van 600 s oud is dus van 08:50.
import {
  test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, OPSTART_SCHRIJVEN, settle, TICKETS_STUB,
} from '../productie-hulp.mjs';

const balk = (page) => page.locator('#tickets-verouderd');
const OUD = { 'X-Blitz-Bron': 'snapshot', 'X-Blitz-Leeftijd': '600', 'X-Blitz-Verouderd': '1' };

// Een tickets-stub met een wachtrij van antwoorden; elke aanvraag wordt (met zijn querystring) onthouden.
function ticketsStub(antwoorden) {
  const t = { queries: [], stub: ({ query }) => {
    t.queries.push(query.toString());
    const a = antwoorden[Math.min(t.queries.length - 1, antwoorden.length - 1)];
    return { status: 200, json: structuredClone(TICKETS_STUB), ...a };
  } };
  return t;
}

test.describe('tickets uit een oude momentopname (Zoho even niet bereikbaar)', () => {
  test('zonder de kop X-Blitz-Verouderd staat er geen balk', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    const t = ticketsStub([{ headers: { 'X-Blitz-Bron': 'snapshot', 'X-Blitz-Leeftijd': '60' } }]);
    await startAppProductie(page, { overschrijf: { tickets: t.stub } });
    await settle(page);
    await expect(balk(page)).toBeHidden();
    await expect(balk(page)).toHaveText('');
  });

  test('met X-Blitz-Verouderd: 1 toont de app het tijdstip van de gegevens; Vernieuwen vraagt ?vers=1 en haalt de balk weg zodra Zoho weer antwoordt', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    const t = ticketsStub([{ headers: OUD }, {}]);
    await startAppProductie(page, { overschrijf: { tickets: t.stub } });
    await expect(balk(page)).toBeVisible();
    await expect(balk(page)).toHaveText('Gegevens van 08:50 — Zoho even niet bereikbaar');
    expect(t.queries[0]).toBe(''); // de gewone lading vraagt geen verse Zoho-lading af

    await page.locator('[data-actie="vernieuw"]').click();
    await expect.poll(() => t.queries.length).toBe(2);
    expect(t.queries[1]).toBe('vers=1'); // Vernieuwen = echt Zoho lezen
    await expect(balk(page)).toBeHidden();
    await settle(page);
  });

  test('blijft Zoho onbereikbaar na Vernieuwen, dan blijft de balk staan met het (nieuwe) tijdstip', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    const t = ticketsStub([{ headers: OUD }, { headers: { ...OUD, 'X-Blitz-Leeftijd': '660' } }]);
    await startAppProductie(page, { overschrijf: { tickets: t.stub } });
    await expect(balk(page)).toHaveText('Gegevens van 08:50 — Zoho even niet bereikbaar');
    await page.locator('[data-actie="vernieuw"]').click();
    await expect.poll(() => t.queries.length).toBe(2);
    await expect(balk(page)).toBeVisible();
    await expect(balk(page)).toHaveText('Gegevens van 08:49 — Zoho even niet bereikbaar'); // 660 s oud: 09:00 min 11 minuten
    await settle(page);
  });
});

test.describe('een Zoho-fout van de server (500 met { error })', () => {
  const MELDING = 'Sessie met Zoho verlopen. Meld dit aan Brent; de koppeling moet opnieuw ingesteld worden.';
  const leeg = (page) => page.locator('#empty-tickets');
  const fout = (tekst) => ({ tickets: () => ({ status: 500, json: { error: tekst } }) });

  test('een tokenfout of 401 van Zoho toont "Sessie met Zoho verlopen" (de client leest de foutbody)', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    verwachtHttpFout(verzoeken, [{ pad: '/api/tickets', status: 500 }]);
    await startAppProductie(page, { wachtOpApp: false, overschrijf: fout('Token refresh mislukt: {"error":"invalid_code"}') });
    await expect(leeg(page)).toHaveText(MELDING);
    await expect(balk(page)).toBeHidden();
  });

  test('een 401 van Zoho bij het ophalen van de lijst geeft dezelfde melding', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    verwachtHttpFout(verzoeken, [{ pad: '/api/tickets', status: 500 }]);
    await startAppProductie(page, { wachtOpApp: false, overschrijf: fout('Zoho tickets-ophalen mislukt (401): {"errorCode":"INVALID_OAUTH"}') });
    await expect(leeg(page)).toHaveText(MELDING);
  });

  test('een gewone serverfout (met een ticketnummer dat toevallig 401 bevat) is GEEN sessiemelding maar de gewone foutmelding', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    verwachtHttpFout(verzoeken, [{ pad: '/api/tickets', status: 500 }]);
    await startAppProductie(page, { wachtOpApp: false, overschrijf: fout('Zoho ticketdetail 4000000401234 mislukt (500): {}') });
    await expect(leeg(page)).toContainText('Kon tickets niet laden');
    await expect(leeg(page)).not.toContainText('Sessie met Zoho verlopen');
  });
});
