import { test, expect, startApp } from './helpers.mjs';

test.describe('ticketdetail', () => {
  test('ticket openen toont gegevens en sinds-datum', async ({ page, verzoeken }) => {
    await startApp(page);

    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const venster = page.getByRole('dialog', { name: /Laadpaal offline na stroomuitval/ });
    await expect(venster).toBeVisible();
    await expect(venster.getByTestId('detail-nummer')).toHaveText('#1001');
    await expect(venster).toContainText('Antwerpseweg 50, 2440 Geel');
    // In testmodus komt de waarde uit DUMMY_DATA (nu - 1 dag, met de vaste klok 5 okt -> 4 okt), niet uit
    // de stub: laadPlanningSinds() keert in TEST_MODE meteen terug (index.html:1231).
    await expect(venster.getByTestId('detail-rij').filter({ hasText: 'In planning sinds' }).getByTestId('detail-waarde'))
      .toHaveText('4 okt');
    expect(verzoeken.van('/api/planning-sinds')).toEqual([]);
  });

  test('detailvenster sluit', async ({ page }) => {
    await startApp(page);
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const venster = page.getByRole('dialog', { name: /Laadpaal offline/ });
    await expect(venster).toBeVisible();

    await venster.getByRole('button', { name: 'Sluiten' }).click();
    await expect(venster).toBeHidden();
  });
});

// ── Karakterisering (etappe 5a, taak 4) ───────────────────────────────────────
// Pint het huidige gedrag van het ticketdetail vast, vóór ticketdetail, voorstel en annuleren in
// taak 6-8 naar schermen/ verhuizen. Alles in ?test: Zoho-schrijfpaden worden nooit geraakt.
// Gemeten waarden staan met commentaar "Gemeten".
//
// DUMMY_DATA: #1001 (t1) staat in de wachtrij, #1004 (p1) staat ingepland op 7 okt (wacht op bevestiging),
// #1005 (p2) staat zonder datum in "Wacht bevestiging".

const detailVan = (page, naam) => page.getByRole('dialog', { name: naam });
const toast = (page) => page.locator('#toast');
// Negatieve controles: eerst de klok voorbij elke debounce, dan een microtaak-flush, pas dan een gewone expect.
const settle = async (page) => { await page.clock.runFor(1000); await page.evaluate(() => Promise.resolve()); };

// #1004 openen vanuit de kalender (ingepland op woensdag 7 okt).
async function open1004(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
  const detail = detailVan(page, /Energiemeting klopt niet/);
  await expect(detail).toBeVisible();
  return detail;
}

async function open1001(page) {
  await page.getByRole('button', { name: 'Open ticket #1001' }).click();
  const detail = detailVan(page, /Laadpaal offline na stroomuitval/);
  await expect(detail).toBeVisible();
  return detail;
}

test.describe('ticketdetail: tags, contact en navigatie', () => {
  test('#1001: tags, contactknoppen en adres-navigatie', async ({ page }) => {
    await startApp(page);
    const detail = await open1001(page);

    const tags = detail.locator('#d-tags');
    await expect(tags.locator('.mtag.status')).toHaveText('Service in te plannen');
    await expect(tags.locator('.prtag.high')).toHaveText('Hoog');
    await expect(tags.locator('.mtag.assignee')).toHaveText('Tim');

    const contact = detail.locator('#d-contact');
    await expect(contact.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:0475123456');
    await expect(contact.locator('a[href^="mailto:"]')).toHaveAttribute('href', 'mailto:jan@test.be');
    await expect(contact.locator('.btn-navigeer-groot')).toHaveAttribute('data-adres', 'Antwerpseweg 50, 2440 Geel');

    // window.open wordt gestubd: er laadt niets.
    await page.evaluate(() => { window.__open = []; window.open = (u) => { window.__open.push(u); return null; }; });
    await contact.locator('.btn-navigeer-groot').click();
    await expect.poll(() => page.evaluate(() => window.__open)).toHaveLength(1);
    const url = (await page.evaluate(() => window.__open))[0];
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('Antwerpseweg 50, 2440 Geel') + '&travelmode=driving');
    // Navigeren sluit het detail niet.
    await settle(page);
    await expect(detail).toBeVisible();

    // De adresregel in de klantgegevens navigeert op dezelfde manier.
    await detail.locator('.mval-nav-link').click();
    await expect.poll(() => page.evaluate(() => window.__open.length)).toBe(2);
    expect((await page.evaluate(() => window.__open))[1]).toBe(url);
    await settle(page);
    await expect(detail).toBeVisible();
  });

  test('telefoonnummer met (0): de tel:-link laat het weg', async ({ page }) => {
    await startApp(page);
    await page.evaluate(() => {
      const t = kern.toestand.get('allTickets').find(x => x.id === 't1');
      t.telefoonEindklant = '+32 (0)9 123 45 67';
      kern.toestand.raak('allTickets');
    });
    const detail = await open1001(page);
    await expect(detail.locator('#d-contact a[href^="tel:"]')).toHaveAttribute('href', 'tel:+3291234567');
  });
});

test.describe('ticketdetail: knoppen per toestand', () => {
  test('wachtrij-ticket (#1001): enkel de plan-knop, geen knoppen voor ingeplande tickets', async ({ page }) => {
    await startApp(page);
    const detail = await open1001(page);
    await expect(detail.locator('#d-plan-btn')).toBeVisible();
    await expect(detail.locator('#d-plan-btn')).toHaveText('+ Voeg toe aan planning');
    for (const id of ['d-btn-arrival', 'd-btn-proposal', 'd-btn-fotos', 'd-btn-rapport', 'd-btn-reschedule', 'd-btn-annuleer']) {
      await expect(detail.locator('#' + id), id).toBeHidden();
    }
  });

  test('ingepland ticket (#1004): alle knoppen behalve annuleren; plan-knop is "Uit planning halen"', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    for (const id of ['d-btn-arrival', 'd-btn-proposal', 'd-btn-fotos', 'd-btn-rapport', 'd-btn-reschedule']) {
      await expect(detail.locator('#' + id), id).toBeVisible();
    }
    await expect(detail.locator('#d-plan-btn')).toHaveText('✕ Uit planning halen');
    await expect(detail.locator('#d-plan-btn')).toHaveClass(/btn--danger/);
    await expect(detail.locator('#d-btn-annuleer')).toBeHidden();
  });

  test('lopend voorstel: "Afspraak annuleren" vervangt "Uit planning halen"', async ({ page }) => {
    await startApp(page);
    await page.evaluate(() => {
      kern.toestand.get('voorstelStatus').p1 = { contact: '2026-10-05T07:00:00.000Z' };
      kern.toestand.raak('voorstelStatus');
    });
    const detail = await open1004(page);
    await expect(detail.locator('#d-btn-annuleer')).toBeVisible();
    await expect(detail.locator('#d-btn-annuleer')).toHaveText('Afspraak annuleren');
    await expect(detail.locator('#d-plan-btn')).toBeHidden();
  });

  test('bevestigingslabel verschijnt in de tags zodra het voorstel bevestigd is', async ({ page }) => {
    await startApp(page);
    await page.evaluate(() => {
      kern.toestand.get('voorstelStatus').p1 = { contact: '2026-10-05T07:00:00.000Z', bevestigd: { door: 'klant', tijdstip: '2026-10-05T08:00:00.000Z' } };
      kern.toestand.raak('voorstelStatus');
    });
    const detail = await open1004(page);
    await expect(detail.locator('#d-tags .mtag.confirmed-by')).toHaveText('✓ Bevestigd door klant');
  });
});

test.describe('ticketdetail: plannen en uitplannen', () => {
  test('"+ Voeg toe aan planning": toast, detail sluit, ticket staat in planning', async ({ page, verzoeken }) => {
    await startApp(page);
    const detail = await open1001(page);
    await detail.locator('#d-plan-btn').click();

    // Gemeten: maandag 5 okt 09:00 (vaste klok) -> eerstvolgende beschikbare dag is dezelfde dag.
    await expect(toast(page)).toHaveText('✓ Toegevoegd aan 5 okt');
    await expect(detail).toBeHidden();
    const plek = await page.evaluate(() => Object.entries(kern.toestand.get('planning'))
      .filter(([, stops]) => stops.some(s => s.ticket.id === 't1')).map(([d]) => d));
    expect(plek).toEqual(['2026-10-05']);
    await settle(page);
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });

  test('"✕ Uit planning halen": Annuleren laat alles staan', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-plan-btn').click();

    const dialoog = page.getByRole('alertdialog', { name: 'Ticket #1004 uit de planning halen?' });
    await expect(dialoog).toBeVisible();
    await expect(dialoog).toContainText('Het ticket gaat terug naar de wachtrij.');
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(dialoog).toBeHidden();

    await settle(page);
    await expect(detail).toBeVisible();
    const staatIn = await page.evaluate(() => (kern.toestand.get('planning')['2026-10-07'] || []).map(s => s.ticket.id));
    expect(staatIn).toEqual(['p1']);
  });
});

test.describe('ticketdetail: aankomst registreren', () => {
  test('eerste klik registreert, tweede klik vraagt overschrijven (weigeren en accepteren)', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);

    await detail.locator('#d-btn-arrival').click();
    // De klok loopt door vanaf 09:00 (vaste start): de minuten kunnen oplopen, het uur niet.
    await expect(toast(page)).toHaveText(/^⏱ Aankomst geregistreerd: 09:\d\d$/);
    const eerste = await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_arrivals')));
    expect(Object.keys(eerste)).toEqual(['2026-10-07__p1']);
    expect(eerste['2026-10-07__p1']).toMatch(/^09:\d\d$/);

    // Tweede klik, weigeren: waarde blijft.
    const berichten = [];
    page.once('dialog', async d => { berichten.push(d.message()); await d.dismiss(); });
    await detail.locator('#d-btn-arrival').click();
    await expect.poll(() => berichten).toHaveLength(1);
    expect(berichten[0]).toBe(`Aankomst al geregistreerd om ${eerste['2026-10-07__p1']}. Overschrijven?`);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_arrivals')))).toEqual(eerste);

    // Tweede klik, accepteren: er wordt overschreven (met de dan geldende tijd).
    await page.clock.runFor(120000);
    page.once('dialog', async d => { berichten.push(d.message()); await d.accept(); });
    await detail.locator('#d-btn-arrival').click();
    await expect.poll(() => berichten).toHaveLength(2);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('blitz_arrivals'))['2026-10-07__p1']))
      .not.toBe(eerste['2026-10-07__p1']);
    // Het detail blijft open na het registreren.
    await expect(detail).toBeVisible();
  });
});

test.describe('ticketdetail: verzetten (?test)', () => {
  test('venster opent met de huidige datum en tijd; Opslaan verhuist het ticket lokaal', async ({ page, verzoeken }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-reschedule').click();

    const venster = detailVan(page, '📅 Nieuwe datum/tijd');
    await expect(venster).toBeVisible();
    // Gemeten: #1004 heeft interventieDatum = nu + 2 dagen (7 okt 09:00).
    await expect(venster.getByLabel('Nieuwe datum')).toHaveValue('2026-10-07');
    await expect(venster.getByLabel('Nieuw tijdstip')).toHaveValue('09:00');

    await venster.getByLabel('Nieuwe datum').fill('2026-10-08');
    await venster.getByLabel('Nieuw tijdstip').fill('14:30');
    await venster.getByRole('button', { name: '✓ Opslaan' }).click();

    await expect(toast(page)).toHaveText('🧪 Testmodus — niet opgeslagen');
    await expect(venster).toBeHidden();
    await expect(detail).toBeHidden(); // sluitDetailStil
    const stand = await page.evaluate(() => {
      const p = kern.toestand.get('planning');
      return {
        oud: (p['2026-10-07'] || []).map(s => s.ticket.id),
        nieuw: (p['2026-10-08'] || []).map(s => [s.ticket.id, s.uur, s.ticket.status]),
        iso: p['2026-10-08']?.[0].ticket.interventieDatum,
        pending: kern.toestand.get('allPending').filter(t => t.id === 'p1').length,
      };
    });
    expect(stand.oud).toEqual([]);
    expect(stand.nieuw).toEqual([['p1', '14:30', 'Wachten op bevestiging planning']]);
    expect(stand.iso).toBe('2026-10-08T12:30:00.000Z'); // 14:30 Brusselse zomertijd
    expect(stand.pending).toBe(1);
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });

  test('een bevestigd ticket (#1006) gaat bij verzetten terug naar "Wachten op bevestiging planning"', async ({ page }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.locator('.day-col[data-date="2026-10-09"]').getByRole('button', { name: 'Open ticket #1006' }).click();
    const detail = detailVan(page, /Periodiek onderhoud laadpalen/);
    await expect(detail).toBeVisible();
    await detail.locator('#d-btn-reschedule').click();
    const venster = detailVan(page, '📅 Nieuwe datum/tijd');
    await venster.getByLabel('Nieuwe datum').fill('2026-10-12');
    await venster.getByRole('button', { name: '✓ Opslaan' }).click();
    await expect(toast(page)).toHaveText('🧪 Testmodus — niet opgeslagen');

    const stand = await page.evaluate(() => ({
      status: kern.toestand.get('planning')['2026-10-12']?.[0].ticket.status,
      inGepland: kern.toestand.get('allGepland').some(t => t.id === 'g1'),
      inPending: kern.toestand.get('allPending').some(t => t.id === 'g1'),
    }));
    expect(stand).toEqual({ status: 'Wachten op bevestiging planning', inGepland: false, inPending: true });
  });

  test('lege datum: toast "Selecteer een datum", het venster blijft open', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-reschedule').click();
    const venster = detailVan(page, '📅 Nieuwe datum/tijd');
    await venster.getByLabel('Nieuwe datum').fill('');
    await venster.getByRole('button', { name: '✓ Opslaan' }).click();
    await expect(toast(page)).toHaveText('⚠ Selecteer een datum');
    await expect(venster).toBeVisible();
    await expect(detail).toBeVisible();
  });

  test('feestdag: confirm; weigeren laat alles staan, accepteren verzet', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-reschedule').click();
    const venster = detailVan(page, '📅 Nieuwe datum/tijd');
    await venster.getByLabel('Nieuwe datum').fill('2026-11-11');

    const berichten = [];
    page.once('dialog', async d => { berichten.push(d.message()); await d.dismiss(); });
    await venster.getByRole('button', { name: '✓ Opslaan' }).click();
    await expect.poll(() => berichten).toHaveLength(1);
    expect(berichten[0]).toBe('🎌 Wapenstilstand is een wettelijke feestdag (11 nov).\nToch inplannen?');
    await expect(venster).toBeVisible();
    expect(await page.evaluate(() => Object.keys(kern.toestand.get('planning')).sort())).toEqual(['2026-10-07', '2026-10-09']);

    page.once('dialog', async d => { berichten.push(d.message()); await d.accept(); });
    await venster.getByRole('button', { name: '✓ Opslaan' }).click();
    await expect(toast(page)).toHaveText('🧪 Testmodus — niet opgeslagen');
    expect(await page.evaluate(() => Object.keys(kern.toestand.get('planning')).sort())).toEqual(['2026-10-09', '2026-11-11']);
  });
});

test.describe('ticketdetail: voorstel (?test)', () => {
  test('voorstel versturen: lokale tak met toast en register-entry', async ({ page, verzoeken }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-proposal').click();

    const modal = detailVan(page, '📨 Afspraakvoorstel');
    await expect(modal).toBeVisible();
    await expect(detail).toBeHidden(); // openProposal sluit het detail stil
    await modal.getByLabel(/Tijdstip/).fill('10:00');
    await modal.getByRole('button', { name: '✉️ Verstuur voorstel' }).click();
    // Knop toont "Bezig..." tijdens de kunstmatige wachttijd van 600 ms (setTimeout): klok vooruit.
    await expect(modal.locator('#proposal-send-btn')).toHaveText('Bezig...');
    await page.clock.runFor(600);

    await expect(toast(page)).toHaveText('🧪 Testmodus — voorstel verstuurd (demo)');
    await expect(modal).toBeHidden();
    const vs = await page.evaluate(() => kern.toestand.get('voorstelStatus').p1);
    // luc@test.be is zowel contact als eindklant: beide doelgroepen krijgen een tijdstip.
    expect(Object.keys(vs).sort()).toEqual(['contact', 'klant', 'tijdslot', 'tijdslotDatum']);
    expect(vs.contact).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(vs.klant).toBe(vs.contact);
    expect(vs.tijdslotDatum).toBe('2026-10-07');
    // Gemeten: tijdstip 10:00 met de standaard tijdslotgrootte (3 u) geeft 09:30–12:30.
    expect(vs.tijdslot).toBe('09:30–12:30');
    expect(verzoeken.van('/api/propose')).toEqual([]);
    expect(verzoeken.van('/api/voorstel-status', 'POST')).toEqual([]);
  });

  test('invoervelden (data-invoer): een bubbelend input-event ververst het voorbeeld; het voorbeeld-anker is inert', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-proposal').click();
    const modal = detailVan(page, '📨 Afspraakvoorstel');
    await expect(modal).toBeVisible();
    // Een echt, bubbelend input-event op het tijdveld (niet via een inline handler): delegatie op document.body.
    await page.evaluate(() => {
      const el = document.getElementById('proposal-time');
      el.value = '15:30';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Gemeten: 15:30 met de standaard tijdslotgrootte (3 u) en werkdag 08-17 geeft 14:00-17:00.
    await expect(modal.locator('#proposal-preview')).toContainText('14:00–17:00');
    await page.evaluate(() => {
      const el = document.getElementById('proposal-time');
      el.value = '09:00';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(modal.locator('#proposal-preview')).toContainText('08:30–11:30');
    // Het anker "Bevestig deze afspraak" is inert: geen navigatie (geen #-hash) en het venster blijft open.
    await modal.locator('#proposal-preview a[data-actie="voorstel-inert"]').click();
    expect(await page.evaluate(() => location.hash)).toBe('');
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
  });
});

test.describe("ticketdetail: foto's", () => {
  test("knop opent #foto-overlay en toont de foto's uit GET /api/fotos", async ({ page, verzoeken }) => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await startApp(page, {
      overschrijf: {
        fotos: ({ methode }) => ({
          status: 200,
          json: methode === 'GET' ? { versie: 1, fotos: [{ id: 'f1', dataUrl: PNG, caption: 'Voor' }, { id: 'f2', dataUrl: PNG, caption: '' }] } : { versie: 2, fotos: [] },
        }),
      },
    });
    const detail = await open1004(page);
    await detail.locator('#d-btn-fotos').click();

    const overlay = page.locator('#foto-overlay');
    await expect(overlay).toHaveClass(/open/);
    await expect(overlay.locator('.foto-thumb')).toHaveCount(2);
    await expect(overlay.locator('.foto-caption').first()).toHaveValue('Voor');
    const gets = verzoeken.van('/api/fotos', 'GET');
    expect(gets).toHaveLength(1);
    // Het detail blijft eronder open (gestapeld).
    await expect(detail).toBeVisible();
    await overlay.getByRole('button', { name: 'Sluiten' }).click();
    await expect(overlay).not.toHaveClass(/open/);
  });

  test("zonder foto's: lege melding", async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-fotos').click();
    await expect(page.locator('#foto-grid')).toHaveText("Nog geen foto's toegevoegd.");
  });
});

test.describe('ticketdetail: klantbeschikbaarheid en sluiten', () => {
  test('ongeopgeslagen wijziging: Sluiten toont de waarschuwing; Terug houdt het detail, Weggooien sluit', async ({ page }) => {
    await startApp(page);
    const detail = await open1001(page);
    await detail.getByLabel('Datum waarop de klant niet kan').fill('2026-10-09');
    await detail.getByRole('button', { name: '+ Datum toevoegen' }).click();

    await detail.getByRole('button', { name: 'Sluiten' }).click();
    const waarschuwing = page.getByRole('alertdialog', { name: 'Niet-opgeslagen wijzigingen' });
    await expect(waarschuwing).toBeVisible();
    await expect(waarschuwing).toContainText('Je hebt wijzigingen in de klantbeschikbaarheid die nog niet zijn opgeslagen. Wil je ze weggooien?');
    await waarschuwing.getByRole('button', { name: 'Terug' }).click();
    await expect(waarschuwing).toBeHidden();
    await expect(detail).toBeVisible();

    await detail.getByRole('button', { name: 'Sluiten' }).click();
    await waarschuwing.getByRole('button', { name: 'Weggooien' }).click();
    await expect(detail).toBeHidden();
  });

  test('zonder wijziging sluit het detail meteen, ook via een klik op de achtergrond', async ({ page }) => {
    await startApp(page);
    const detail = await open1001(page);
    await page.locator('#det-overlay').click({ position: { x: 5, y: 5 } });
    await expect(detail).toBeHidden();
    await expect(page.locator('.app-dialog-overlay')).toHaveCount(0);
  });
});

test.describe('ticketdetail: toewijzen (?test)', () => {
  test('📅 Toewijzen > Opslaan: toast, ticket staat in planning, geen /api/plan-datum', async ({ page, verzoeken }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const paneel = page.locator('#kal-no-date-section');
    // Beginstand: het "zonder datum"-paneel is dicht; de pil opent het.
    await expect(paneel).not.toHaveClass(/open/);
    await page.locator('#kal-pending-pill').click();
    await expect(paneel).toHaveClass(/open/);
    const kaart = paneel.locator('.ticket').filter({ hasText: '#1005' });
    await kaart.getByRole('button', { name: '📅 Toewijzen' }).click();
    await kaart.getByLabel('Datum toewijzen').fill('2026-10-08');
    await kaart.getByLabel('Tijd toewijzen').fill('13:00');
    await kaart.getByRole('button', { name: '✓ Opslaan' }).click();

    await expect(toast(page)).toHaveText('🧪 Testmodus — niet opgeslagen');
    const stand = await page.evaluate(() => (kern.toestand.get('planning')['2026-10-08'] || []).map(s => [s.ticket.id, s.uur]));
    expect(stand).toEqual([['p2', '13:00']]);
    await settle(page);
    expect(verzoeken.van('/api/plan-datum')).toEqual([]);
  });
});

test.describe('ticketdetail: toetsenbord', () => {
  test('Enter op een gefocuste kaart opent het detail, Escape sluit het en de focus keert terug', async ({ page }) => {
    await startApp(page);
    const kaart = page.getByRole('button', { name: 'Open ticket #1001' });
    await kaart.focus();
    await page.keyboard.press('Enter');
    const detail = detailVan(page, /Laadpaal offline na stroomuitval/);
    await expect(detail).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    await expect(kaart).toBeFocused();
  });
});

test.describe('ticketdetail: rapport', () => {
  test('📋 Rapport sluit het detail en opent de wizard (enkel openen)', async ({ page, verzoeken }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-rapport').click();
    const wizard = detailVan(page, '📋 Service Rapport');
    await expect(wizard).toHaveClass(/open/);
    await expect(detail).toBeHidden();
    expect(verzoeken.verboden).toEqual([]);
  });
});

// ── Fix-ronde 1 ───────────────────────────────────────────────────────────────
const rijen = (page, selector) => page.evaluate((s) => [...document.querySelectorAll(s + ' .mrow')].map(r => [...r.children].map(c => c.textContent)), selector);
const actieveTab = (page) => page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.id));

test.describe('ticketdetail: veldweergave (openDetail)', () => {
  test('#1001: nummer, titel, klantgegevens en ticketdetails met exacte teksten', async ({ page }) => {
    await startApp(page);
    await open1001(page);
    await expect(page.locator('#d-num')).toHaveText('#1001');
    await expect(page.locator('#d-title')).toHaveText('Laadpaal offline na stroomuitval');
    expect(await rijen(page, '#d-klant')).toEqual([
      ['Contact', 'Jan Peeters'], ['Bedrijf', 'EV Park Geel'], ['E-mail', 'jan@test.be'],
      ['Telefoon', '0475123456'], ['Adres', 'Antwerpseweg 50, 2440 Geel ↗'],
    ]);
    // E-mail en telefoon zijn links.
    await expect(page.locator('#d-klant a[href="mailto:jan@test.be"]')).toHaveText('jan@test.be');
    await expect(page.locator('#d-klant a[href="tel:0475123456"]')).toHaveText('0475123456');
    // Gemeten: interventieDatum = nu - 2 dagen (vaste klok), aangemaakt 18 jun, planning sinds nu - 1 dag.
    expect(await rijen(page, '#d-ticket')).toEqual([
      ['Probleemtype', 'Verbindingsfout'], ['Serienummer', 'CHARX-2291'], ['Partner', 'Proxes'], ['Regio', 'Kempen'],
      ['Interventiedatum', 'za 3 okt 2026'], ['In planning sinds', '4 okt'], ['Aangemaakt', 'do 18 jun 2026'],
    ]);
  });

  test('#1003 zonder adres en lege velden: lege rijen vallen weg, "Geen adres bekend"', async ({ page }) => {
    await startApp(page);
    await page.getByRole('button', { name: 'Open ticket #1003' }).click();
    await expect(page.locator('#d-num')).toHaveText('#1003');
    expect(await rijen(page, '#d-klant')).toEqual([['Bedrijf', 'Residentie Turnhout'], ['Adres', 'Geen adres bekend']]);
    await expect(page.locator('#d-klant .mval.miss')).toHaveText('Geen adres bekend');
    expect(await rijen(page, '#d-ticket')).toEqual([
      ['Probleemtype', 'Foutcode'], ['In planning sinds', '10 sep'], ['Aangemaakt', 'zo 21 jun 2026'],
    ]);
    // Zonder telefoon, mail en adres geen contactknoppen.
    await expect(page.locator('#d-contact .contact-acties')).toHaveCount(0);
  });

  test('alle ticketvelden leeg: "—" als terugval en "—" als titel', async ({ page }) => {
    await startApp(page);
    await page.evaluate(() => {
      const t = kern.toestand.get('allTickets').find(x => x.id === 't3');
      Object.assign(t, { subject: '', probleemtype: '', createdTime: null, inPlanningSinds: null });
      kern.toestand.raak('allTickets');
    });
    await page.getByRole('button', { name: 'Open ticket #1003' }).click();
    await expect(page.locator('#d-title')).toHaveText('—');
    expect(await rijen(page, '#d-ticket')).toEqual([['—']]);
  });

  test('HTML in ticketvelden wordt als tekst getoond (escaping)', async ({ page }) => {
    await startApp(page);
    await page.evaluate(() => {
      const t = kern.toestand.get('allTickets').find(x => x.id === 't1');
      Object.assign(t, { subject: '<b>Vet</b> & "aanhalingstekens"', account: '<i>Bedrijf</i>', regio: '<img src=x onerror=window.__xss=1>', address: 'Straat <u>1</u>, 2440 Geel' });
      kern.toestand.raak('allTickets');
    });
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const detail = page.locator('#det-overlay');
    await expect(detail).toHaveClass(/open/);
    await expect(page.locator('#d-title')).toHaveText('<b>Vet</b> & "aanhalingstekens"');
    expect(await rijen(page, '#d-klant')).toContainEqual(['Bedrijf', '<i>Bedrijf</i>']);
    expect(await rijen(page, '#d-klant')).toContainEqual(['Adres', 'Straat <u>1</u>, 2440 Geel ↗']);
    expect(await rijen(page, '#d-ticket')).toContainEqual(['Regio', '<img src=x onerror=window.__xss=1>']);
    await expect(detail.locator('#d-title b, #d-klant i, #d-klant u, #d-ticket img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('ticketdetail: uitplannen bevestigen en annuleerknop', () => {
  test('"✕ Uit planning halen" bevestigen: ticket terug in de wachtrij, detail dicht, planning bijgewerkt', async ({ page, verzoeken }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-plan-btn').click();
    const dialoog = page.getByRole('alertdialog', { name: 'Ticket #1004 uit de planning halen?' });
    await dialoog.getByRole('button', { name: 'Uit planning halen' }).click();

    await expect(detail).toBeHidden();
    await expect(dialoog).toBeHidden();
    const stand = await page.evaluate(() => ({
      planning: Object.fromEntries(Object.entries(kern.toestand.get('planning')).map(([d, s]) => [d, s.map(x => x.ticket.id)])),
      wachtrij: kern.toestand.get('allTickets').map(t => t.id).sort(),
      pending: kern.toestand.get('allPending').map(t => t.id),
      datum: kern.toestand.get('allTickets').find(t => t.id === 'p1').interventieDatum,
      teller: document.getElementById('cnt-tickets').textContent,
    }));
    expect(stand.planning).toEqual({ '2026-10-09': ['g1'] });
    expect(stand.wachtrij).toEqual(['p1', 't1', 't2', 't3']);
    expect(stand.pending).toEqual(['p2']);
    expect(stand.datum).toBeNull();
    expect(stand.teller).toBe('4');
    // De kalender toont #1004 niet meer op 7 okt, de wachtrij wel.
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' })).toHaveCount(0);
    await page.getByRole('tab', { name: /Wachtrij/ }).click();
    await expect(page.getByRole('button', { name: 'Open ticket #1004' })).toBeVisible();
    // Gemeten: in testmodus is er geen toast bij uitplannen en geen verzoek naar Zoho.
    await page.clock.runFor(1000);
    await page.evaluate(() => Promise.resolve());
    expect(verzoeken.van('/api/plan')).toEqual([]);
    await expect(page.locator('#toast')).not.toContainText('Toegevoegd');
  });

  test('"Afspraak annuleren" opent het annuleervenster (enkel de bedrading; productiepaden: productie/annuleren)', async ({ page }) => {
    await startApp(page);
    await page.evaluate(() => {
      kern.toestand.get('voorstelStatus').p1 = { contact: '2026-10-05T07:00:00.000Z' };
      kern.toestand.raak('voorstelStatus');
      // De redenenlijst staat gecached: zo is er geen (verboden) GET /api/annuleer nodig.
      kern.annuleren.zetRedenenVoorTest([{ code: 'andere', label: 'Andere' }]);
    });
    const detail = await open1004(page);
    await detail.locator('#d-btn-annuleer').click();
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    await expect(page.locator('#annuleer-label')).toContainText('#1004 — Luc Wouters');
    await expect(page.locator('#annuleer-redenen label')).toHaveText(['Andere']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#annuleer-overlay')).not.toHaveClass(/open/);
  });
});

test.describe('ticketdetail: tabblad en staat na sluiten', () => {
  test('vanuit de wachtrij: tab Wachtrij blijft actief, kaart krijgt de focus terug', async ({ page }) => {
    await startApp(page);
    expect(await actieveTab(page)).toEqual(['tab-tickets']);
    const kaart = page.getByRole('button', { name: 'Open ticket #1001' });
    const scrollVoor = await page.evaluate(() => [window.scrollY, document.getElementById('hoofdinhoud').scrollTop]);
    await kaart.click();
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
    expect(await actieveTab(page)).toEqual(['tab-tickets']);
    await expect(kaart).toBeFocused();
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    expect(await page.evaluate(() => [window.scrollY, document.getElementById('hoofdinhoud').scrollTop])).toEqual(scrollVoor);
  });

  test('vanuit de kalender: tab Kalender, week en dag blijven staan', async ({ page }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#kal-label')).toContainText('5 okt – 11 okt');
    await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    await page.getByRole('button', { name: 'Sluiten' }).first().click();
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
    expect(await actieveTab(page)).toEqual(['tab-kalender']);
    await expect(page.locator('#kal-label')).toContainText('5 okt – 11 okt');
    expect(await page.locator('.day-col[data-date]').evaluateAll(els => els.map(e => e.dataset.date)))
      .toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' })).toBeFocused();
  });

  test('een volgende kalenderweek blijft gekozen na openen en sluiten van een detail', async ({ page }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.evaluate(() => {
      const p = kern.toestand.get('planning');
      const t = kern.toestand.get('allPending').find(x => x.id === 'p1');
      (p['2026-10-13'] ??= []).push({ ticket: { ...t, id: 'x1', number: '1099', subject: 'Volgende week' }, address: t.address, uur: '10:00' });
      kern.toestand.raak('planning');
      kern.toestand.raak('allPending');
    });
    await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    await expect(page.locator('#kal-label')).toContainText('12 okt – 18 okt');
    await page.locator('.day-col[data-date="2026-10-13"]').getByRole('button', { name: 'Open ticket #1099' }).click();
    await expect(page.locator('#d-num')).toHaveText('#1099');
    await page.keyboard.press('Escape');
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#kal-label')).toContainText('12 okt – 18 okt');
    expect(await actieveTab(page)).toEqual(['tab-kalender']);
  });

  test('na "+ Voeg toe aan planning" blijft de wachtrij-tab actief', async ({ page }) => {
    await startApp(page);
    const detail = await open1001(page);
    await detail.locator('#d-plan-btn').click();
    await expect(detail).toBeHidden();
    expect(await actieveTab(page)).toEqual(['tab-tickets']);
  });

  test('na verzetten blijft de kalender-tab actief', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-reschedule').click();
    const venster = detailVan(page, '📅 Nieuwe datum/tijd');
    await venster.getByLabel('Nieuwe datum').fill('2026-10-08');
    await venster.getByRole('button', { name: '✓ Opslaan' }).click();
    await expect(detail).toBeHidden();
    expect(await actieveTab(page)).toEqual(['tab-kalender']);
    await expect(page.locator('.day-col[data-date="2026-10-08"]').getByRole('button', { name: 'Open ticket #1004' })).toBeVisible();
  });
});

test.describe('ticketdetail: voorstel, voorbeeld en ontvangers (?test)', () => {
  test('voorinvulling uit de aankomsttijd en livevoorbeeld bij wijzigen van datum en tijd', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-proposal').click();
    const modal = detailVan(page, '📨 Afspraakvoorstel');
    // Gemeten: #1004 heeft een vast uur 09:00, dus aankomstMin = 540 en het tijdstip wordt 09:00.
    await expect(modal.getByLabel('Datum')).toHaveValue('2026-10-07');
    await expect(modal.getByLabel(/Tijdstip/)).toHaveValue('09:00');
    await expect(modal.locator('#proposal-ticket-label')).toHaveText('#1004 — Luc Wouters');
    const voorbeeld = modal.locator('#proposal-preview');
    await expect(voorbeeld).toContainText('Geachte Luc Wouters,');
    await expect(voorbeeld).toContainText('woensdag 7 oktober 2026');
    await expect(voorbeeld).toContainText('tussen 08:30–11:30 uur');
    await expect(modal.locator('#proposal-outside-workday')).toBeHidden();

    // Tijdstip wijzigen: het voorbeeld volgt. Gemeten: 13:07 rondt af naar 13:15 en geeft tijdslot 12:30–15:30.
    await modal.getByLabel(/Tijdstip/).fill('13:07');
    await expect(voorbeeld).toContainText('tussen 12:30–15:30 uur');
    // Buiten de werkdag: waarschuwing.
    await modal.getByLabel(/Tijdstip/).fill('06:00');
    await expect(modal.locator('#proposal-outside-workday')).toBeVisible();
    await modal.getByLabel(/Tijdstip/).fill('09:00');
    await expect(modal.locator('#proposal-outside-workday')).toBeHidden();
    // Datum wijzigen en leegmaken.
    await modal.getByLabel('Datum').fill('2026-10-08');
    await expect(voorbeeld).toContainText('donderdag 8 oktober 2026');
    await modal.getByLabel('Datum').fill('');
    await expect(voorbeeld.locator('div[style*="font-size:15px"]')).toHaveText('—');
  });

  test('voorinvulling bij een berekende aankomsttijd zonder vast uur (ticket zonder uur in de planning)', async ({ page }) => {
    await startApp(page);
    // #1001 via de plan-knop op 5 okt zetten (geen vast uur), daarna zijn voorstel openen vanuit de kalender.
    await (await open1001(page)).locator('#d-plan-btn').click();
    await page.getByRole('tab', { name: 'Kalender' }).click();
    // Een ticket zonder uur staat als chip in de dagkop.
    await page.locator('.zu-chip').filter({ hasText: '#1001' }).click();
    await page.locator('#d-btn-proposal').click();
    const modal = detailVan(page, '📨 Afspraakvoorstel');
    await expect(modal.getByLabel('Datum')).toHaveValue('2026-10-05');
    // Gemeten: zonder route valt de berekening terug op vertrek 08:00 + 30 min rit = 08:30 (kwartier-afgerond).
    await expect(modal.getByLabel(/Tijdstip/)).toHaveValue('08:30');
  });

  test('zonder contactmail maar met eindklant en installateur: ontvangerslijst en register-entry', async ({ page, verzoeken }) => {
    await startApp(page);
    await page.evaluate(() => {
      for (const lijst of ['allPending']) {
        const t = kern.toestand.get(lijst).find(x => x.id === 'p1');
        Object.assign(t, { email: '', emailEindklant: 'klant@test.be', emailInstallateur: 'inst@test.be' });
      }
    });
    const detail = await open1004(page);
    await detail.locator('#d-btn-proposal').click();
    const modal = detailVan(page, '📨 Afspraakvoorstel');
    await expect(modal.locator('#proposal-email')).toHaveText('Wordt verstuurd naar: klant@test.be, inst@test.be');
    await expect(modal.locator('#proposal-no-email')).toBeHidden();
    await modal.getByRole('button', { name: '✉️ Verstuur voorstel' }).click();
    await page.clock.runFor(600);
    await expect(page.locator('#toast')).toHaveText('🧪 Testmodus — voorstel verstuurd (demo)');
    const vs = await page.evaluate(() => kern.toestand.get('voorstelStatus').p1);
    // Geen contact-sleutel: de contactmail is leeg.
    expect(Object.keys(vs).sort()).toEqual(['installateur', 'klant', 'tijdslot', 'tijdslotDatum']);
    await page.clock.runFor(1000);
    expect(verzoeken.van('/api/propose')).toEqual([]);
  });

  test('zonder enkel e-mailadres: waarschuwing, toast "status bijgewerkt (geen e-mail)" en register zonder doelgroepen', async ({ page, verzoeken }) => {
    await startApp(page);
    await page.evaluate(() => {
      const t = kern.toestand.get('allPending').find(x => x.id === 'p1');
      Object.assign(t, { email: '', emailEindklant: '', emailInstallateur: '' });
    });
    const detail = await open1004(page);
    await detail.locator('#d-btn-proposal').click();
    const modal = detailVan(page, '📨 Afspraakvoorstel');
    await expect(modal.locator('#proposal-email')).toHaveText('Geen gekend e-mailadres — ticket wordt bijgewerkt maar er wordt geen mail verstuurd.');
    await expect(modal.locator('#proposal-no-email')).toBeVisible();
    await modal.getByRole('button', { name: '✉️ Verstuur voorstel' }).click();
    await page.clock.runFor(600);
    await expect(page.locator('#toast')).toHaveText('🧪 Testmodus — status bijgewerkt (geen e-mail)');
    await expect(modal).toBeHidden();
    const vs = await page.evaluate(() => kern.toestand.get('voorstelStatus').p1);
    expect(vs).toEqual({ tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-07' });
    await page.clock.runFor(1000);
    expect(verzoeken.van('/api/propose')).toEqual([]);
  });

  test('verzenden zonder datum: toast "Selecteer een datum", venster blijft open', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-proposal').click();
    const modal = detailVan(page, '📨 Afspraakvoorstel');
    await modal.getByLabel('Datum').fill('');
    await modal.getByRole('button', { name: '✉️ Verstuur voorstel' }).click();
    await expect(page.locator('#toast')).toHaveText('⚠ Selecteer een datum');
    await expect(modal).toBeVisible();
  });
});

test.describe('ticketdetail: klik in de inhoud sluit niet, klik op de achtergrond wel', () => {
  test('detail: titel, sectiekop, label, invoerveld en navigeerknop laten het venster open', async ({ page }) => {
    await startApp(page);
    const detail = await open1001(page);
    await page.evaluate(() => { window.__open = []; window.open = (u) => { window.__open.push(u); return null; }; });
    const open = () => page.evaluate(() => document.getElementById('det-overlay').classList.contains('open'));

    await page.locator('#d-title').click();
    expect(await open()).toBe(true);
    await detail.getByRole('heading', { name: 'Klantgegevens' }).click();
    expect(await open()).toBe(true);
    await detail.locator('#d-klant .mlabel').first().click();
    expect(await open()).toBe(true);
    const invoer = detail.getByLabel('Datum waarop de klant niet kan');
    await invoer.click();
    await expect(invoer).toBeFocused();
    expect(await open()).toBe(true);
    // Een knop met eigen handler (stopPropagation + window.open): venster blijft open.
    await detail.locator('.btn-navigeer-groot').click();
    await expect.poll(() => page.evaluate(() => window.__open.length)).toBe(1);
    expect(await open()).toBe(true);
    await page.clock.runFor(1000);
    await page.evaluate(() => Promise.resolve());
    expect(await open()).toBe(true);

    await page.locator('#det-overlay').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
  });

  test('voorstel: label, datum- en tijdveld, voorbeeld en ontvangersregio laten het venster open', async ({ page }) => {
    await startApp(page);
    const detail = await open1004(page);
    await detail.locator('#d-btn-proposal').click();
    const modal = detailVan(page, '📨 Afspraakvoorstel');
    const open = () => page.evaluate(() => document.getElementById('proposal-overlay').classList.contains('open'));

    await modal.locator('#proposal-titel').click();
    expect(await open()).toBe(true);
    await modal.locator('label[for="proposal-date"]').click();
    expect(await open()).toBe(true);
    await modal.getByLabel('Datum').click();
    expect(await open()).toBe(true);
    await modal.getByLabel(/Tijdstip/).click();
    await expect(modal.getByLabel(/Tijdstip/)).toBeFocused();
    expect(await open()).toBe(true);
    await modal.locator('#proposal-email').click();
    expect(await open()).toBe(true);
    await modal.locator('#proposal-preview').click({ position: { x: 20, y: 20 } });
    expect(await open()).toBe(true);
    await page.clock.runFor(1000);
    await page.evaluate(() => Promise.resolve());
    expect(await open()).toBe(true);

    await page.locator('#proposal-overlay').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('#proposal-overlay')).not.toHaveClass(/open/);
  });
});
