import { test, expect, startApp } from './helpers.mjs';

// Etappe 5b, taak 1: karakterisering van het fotobeheer (openFotoModal, handleFotoFiles, persistFotoChange, loadFotos,
// saveFotos, renderFotoGrid, compressFotoFile) in het fotovenster van het ticketdetail en in de wizardstap "Foto's"
// (die deelt de toestand `_fotoState`). Bestaand (niet dupliceren): het venster opent en toont de foto's uit
// GET /api/fotos, en de lege melding (ticketdetail.spec.mjs); Escape en focus (vensters.spec.mjs).
// compressFotoFile gebruikt een canvas en werkt in headless Chromium. Testklok: maandag 5 okt 2026.

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG_URL = 'data:image/png;base64,' + PNG_1X1.toString('base64');
const bestand = (naam = 'foto.png', buffer = PNG_1X1) => ({ name: naam, mimeType: 'image/png', buffer });
const foto = (id, caption = '') => ({ id, dataUrl: PNG_URL, caption, tijdstip: '2026-10-01T08:00:00.000Z' });
const puts = (verzoeken) => verzoeken.van('/api/fotos', 'PUT');
const toastTekst = (page) => page.locator('#toast');
const overlay = (page) => page.locator('#foto-overlay');
// Echte settle voor "er komt geen verzoek": netwerk stil, en daarna nog twee animatieframes (async bestandsverwerking klaar).
const settle = async (page) => {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};

// Stateful stub met een startlijst (GET geeft die; PUT bewaart ze en geeft versie + 1).
function stubFotos(begin = [], versie = 1) {
  let stand = { versie, fotos: begin };
  return {
    fotos: ({ methode, body }) => {
      if (methode === 'PUT') stand = { versie: stand.versie + 1, fotos: body.fotos };
      return { status: 200, json: stand };
    },
  };
}
// Elke PUT geeft een 409 met de server-stand (die een andere foto bevat) of een 500.
function stubFout(status) {
  const server = { versie: 6, fotos: [foto('srv-1', 'van een collega')] };
  let conflict = false; // na de eerste 409 geeft ook de GET de server-stand
  return {
    fotos: ({ methode }) => {
      if (methode !== 'PUT') return { status: 200, json: conflict ? server : { versie: 1, fotos: [] } };
      conflict = true;
      return status === 409
        ? { status: 409, json: { error: 'Versiematch mislukt', serverVersie: 6, data: server } }
        : { status: 500, json: { error: 'kapot' } };
    },
  };
}
async function verwachtMeldingen(consoleFouten, delen) {
  for (const deel of delen) {
    await expect.poll(() => consoleFouten.filter(f => f.includes(deel)).length, deel).toBeGreaterThan(0);
    for (const f of consoleFouten.filter(f => f.includes(deel))) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  }
}
async function openDetail1004(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
  const detail = page.getByRole('dialog', { name: /Energiemeting klopt niet/ });
  await expect(detail).toBeVisible();
  return detail;
}
async function openFotos(page) {
  const detail = await openDetail1004(page);
  await detail.locator('#d-btn-fotos').click();
  await expect(overlay(page)).toHaveClass(/open/);
  return detail;
}

test.describe("foto's: ticketdetail", () => {
  test('een bestand toevoegen: toast, PUT met de exacte structuur en het venster toont de foto', async ({ page, verzoeken }) => {
    await startApp(page);
    await openFotos(page);
    await page.locator('#foto-file-input').setInputFiles(bestand());
    await expect(toastTekst(page)).toHaveText("📷 1 foto verwerken...");
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(1);
    expect(puts(verzoeken)).toHaveLength(1);
    const body = puts(verzoeken)[0].body;
    expect(Object.keys(body).sort()).toEqual(['fotos', 'ticketId', 'versie']);
    expect(body.ticketId).toBe('p1');
    expect(body.versie).toBe(0);
    expect(body.fotos).toHaveLength(1);
    // De dataUrl-inhoud is een JPEG die het canvas maakte; enkel structuur en veldtypen.
    expect(Object.keys(body.fotos[0]).sort()).toEqual(['caption', 'dataUrl', 'id', 'tijdstip']);
    expect(body.fotos[0]).toEqual({ id: expect.stringMatching(/^\d+-[a-z0-9]+$/), dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/), caption: '', tijdstip: expect.stringMatching(/^2026-10-05T\d\d:\d\d:\d\d\.\d{3}Z$/) });
    expect(new Date(body.fotos[0].tijdstip).toISOString()).toBe(body.fotos[0].tijdstip);
    // De input is gewist (hetzelfde bestand kan opnieuw) en het venster blijft open.
    expect(await page.locator('#foto-file-input').inputValue()).toBe('');
    await expect(overlay(page)).toHaveClass(/open/);
    await expect(overlay(page).locator('.foto-thumb img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(overlay(page).locator('.foto-caption')).toHaveValue('');
  });

  test("meerdere bestanden: één PUT met alle foto's en de meervoudstoast", async ({ page, verzoeken }) => {
    await startApp(page);
    await openFotos(page);
    await page.locator('#foto-file-input').setInputFiles([bestand('a.png'), bestand('b.png')]);
    await expect(toastTekst(page)).toHaveText("📷 2 foto's verwerken...");
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(2);
    expect(puts(verzoeken)).toHaveLength(1);
    const ids = puts(verzoeken)[0].body.fotos.map(f => f.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  test('een grote foto wordt verkleind tot maximaal 1600 px (langste zijde), de verhouding blijft', async ({ page, verzoeken }) => {
    await startApp(page);
    await openFotos(page);
    const groot = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 3200; c.height = 1600;
      const x = c.getContext('2d'); x.fillStyle = '#336699'; x.fillRect(0, 0, 3200, 1600);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#foto-file-input').setInputFiles(bestand('groot.png', Buffer.from(groot, 'base64')));
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(1);
    const dataUrl = puts(verzoeken)[0].body.fotos[0].dataUrl;
    const maat = await page.evaluate((u) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.width, i.height]); i.src = u; }), dataUrl);
    expect(maat).toEqual([1600, 800]);
  });

  test('een bijschrift typen: PUT bij de change-gebeurtenis (blur), de foto blijft staan', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: stubFotos([foto('f1'), foto('f2', 'blijft')], 3) });
    await openFotos(page);
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(2);
    await overlay(page).locator('.foto-caption').first().fill('Voor de reparatie');
    await settle(page);
    expect(puts(verzoeken)).toEqual([]); // nog niets: pas bij change (blur of Enter)
    await overlay(page).locator('.foto-caption').first().press('Tab');
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body).toEqual({ ticketId: 'p1', versie: 3, fotos: [foto('f1', 'Voor de reparatie'), foto('f2', 'blijft')] });
    await expect(overlay(page).locator('.foto-caption').first()).toHaveValue('Voor de reparatie');
  });

  test('verwijderen: PUT zonder die foto en de versie loopt op', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: stubFotos([foto('f1'), foto('f2')], 3) });
    await openFotos(page);
    await overlay(page).locator('.foto-thumb', { has: page.locator('[data-id="f1"]') }).first().getByRole('button', { name: 'Foto verwijderen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body).toEqual({ ticketId: 'p1', versie: 3, fotos: [foto('f2')] });
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(1);
    await overlay(page).getByRole('button', { name: 'Foto verwijderen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(2);
    expect(puts(verzoeken)[1].body).toEqual({ ticketId: 'p1', versie: 4, fotos: [] });
    await expect(overlay(page).locator('#foto-grid')).toHaveText("Nog geen foto's toegevoegd.");
  });

  test('conflict (409): toast, de server-stand wordt herladen en getoond, de eigen wijziging is niet bewaard', async ({ page, verzoeken, consoleFouten }) => {
    await startApp(page, { overschrijf: stubFout(409) });
    await openFotos(page);
    await page.locator('#foto-file-input').setInputFiles(bestand());
    await expect(toastTekst(page)).toHaveText("⚠ Foto's zijn elders gewijzigd — je laatste wijziging is niet opgeslagen, probeer opnieuw");
    expect(puts(verzoeken)).toHaveLength(1);
    expect(puts(verzoeken)[0].body.versie).toBe(1);
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(1);
    await expect(overlay(page).locator('.foto-caption')).toHaveValue('van een collega');
    expect(verzoeken.van('/api/fotos', 'GET')).toHaveLength(2); // openen + herladen na de 409
    // De volgende poging gebruikt de nieuwe versie uit de herlading.
    await overlay(page).locator('.foto-caption').fill('aangevuld');
    await overlay(page).locator('.foto-caption').press('Tab');
    await expect.poll(() => puts(verzoeken).length).toBe(2);
    expect(puts(verzoeken)[1].body.versie).toBe(6);
    await verwachtMeldingen(consoleFouten, ['/api/fotos']);
  });

  test('andere fout (500): toast met de servertekst en het raster blijft zoals het was', async ({ page, verzoeken, consoleFouten }) => {
    await startApp(page, { overschrijf: stubFout(500) });
    await openFotos(page);
    await page.locator('#foto-file-input').setInputFiles(bestand());
    await expect(toastTekst(page)).toHaveText('✕ Foto opslaan mislukt: kapot');
    expect(puts(verzoeken)).toHaveLength(1);
    await expect(overlay(page).locator('#foto-grid')).toHaveText("Nog geen foto's toegevoegd.");
    await verwachtMeldingen(consoleFouten, ['/api/fotos']);
  });

  test("meer dan 30 foto's: toast en geen verzoek; precies 30 mag wel", async ({ page, verzoeken }) => {
    const dertig = Array.from({ length: 29 }, (_, i) => foto(`f${i}`));
    await startApp(page, { overschrijf: stubFotos(dertig, 1) });
    await openFotos(page);
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(29);
    await page.locator('#foto-file-input').setInputFiles([bestand('a.png'), bestand('b.png')]); // 29 + 2 = 31
    await expect(toastTekst(page)).toHaveText("⚠ Maximaal 30 foto's per ticket");
    await settle(page);
    expect(puts(verzoeken)).toEqual([]);
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(29);
    await page.locator('#foto-file-input').setInputFiles(bestand('c.png')); // 29 + 1 = 30
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(30);
    expect(puts(verzoeken)).toHaveLength(1);
    expect(puts(verzoeken)[0].body.fotos).toHaveLength(30);
    // Nu zit het vol: nog één is te veel.
    await page.locator('#foto-file-input').setInputFiles(bestand('d.png'));
    await expect(toastTekst(page)).toHaveText("⚠ Maximaal 30 foto's per ticket");
    expect(puts(verzoeken)).toHaveLength(1);
  });

  test('geen bestand gekozen (annuleren in de kiezer): niets gebeurt', async ({ page, verzoeken }) => {
    await startApp(page);
    await openFotos(page);
    await page.locator('#foto-file-input').setInputFiles([]);
    await settle(page);
    expect(puts(verzoeken)).toEqual([]);
    await expect(overlay(page).locator('#foto-grid')).toHaveText("Nog geen foto's toegevoegd.");
  });

  test('een bestand dat geen afbeelding is: toast "Foto verwerken mislukt" en geen PUT', async ({ page, verzoeken }) => {
    await startApp(page);
    await openFotos(page);
    await page.locator('#foto-file-input').setInputFiles({ name: 'kapot.png', mimeType: 'image/png', buffer: Buffer.from('dit is geen afbeelding') });
    await expect(toastTekst(page)).toHaveText('✕ Foto verwerken mislukt: Afbeelding laden mislukt');
    await settle(page);
    expect(puts(verzoeken)).toEqual([]);
  });

  test('een ander ticket toont zijn eigen foto\'s: GET met de juiste ticketId en versie per ticket', async ({ page, verzoeken }) => {
    const opgevraagd = [];
    await startApp(page, {
      overschrijf: {
        fotos: ({ methode, query }) => {
          if (methode === 'GET') opgevraagd.push(query.get('ticketId'));
          return { status: 200, json: { versie: 0, fotos: [] } };
        },
      },
    });
    await openFotos(page);
    expect(opgevraagd).toEqual(['p1']);
    expect(verzoeken.van('/api/fotos', 'GET')).toHaveLength(1);
  });
});

test.describe("foto's: wizardstap Foto's deelt de toestand", () => {
  async function naarFotoStap(page, detail) {
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
    await wizard.getByLabel('Omschrijving probleem').fill('Test');
    await wizard.getByLabel('Ondernomen acties').fill('Test');
    await wizard.getByText('Productfout', { exact: true }).click();
    await volgende.click();
    await expect(stap).toHaveText("5 / 9 — Foto's");
    return wizard;
  }

  test("een foto uit het fotovenster staat in de wizard; een foto in de wizard gaat via dezelfde PUT en dezelfde versieketen", async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim' });
    // 1. Foto toevoegen via het fotovenster van het detail, dan sluiten.
    const detail = await openFotos(page);
    await page.locator('#foto-file-input').setInputFiles(bestand());
    await expect(overlay(page).locator('.foto-thumb')).toHaveCount(1);
    await overlay(page).getByRole('button', { name: 'Sluiten' }).click();
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(puts(verzoeken)).toHaveLength(1);
    expect(puts(verzoeken)[0].body.versie).toBe(0);

    // 2. De wizard laadt de foto's van hetzelfde ticket (een nieuwe GET) en toont de foto in stap 5.
    const getsVoor = verzoeken.van('/api/fotos', 'GET').length;
    const wizard = await naarFotoStap(page, detail);
    expect(verzoeken.van('/api/fotos', 'GET').length).toBe(getsVoor + 1);
    await expect(wizard.locator('#wiz-foto-grid .foto-thumb')).toHaveCount(1);

    // 3. Een tweede foto in de wizard: dezelfde PUT, met de versie uit de vorige (1) en beide foto's.
    await wizard.locator('#wiz-foto-file-input').setInputFiles(bestand('twee.png'));
    await expect(wizard.locator('#wiz-foto-grid .foto-thumb')).toHaveCount(2);
    expect(puts(verzoeken)).toHaveLength(2);
    expect(puts(verzoeken)[1].body.ticketId).toBe('p1');
    expect(puts(verzoeken)[1].body.versie).toBe(1);
    expect(puts(verzoeken)[1].body.fotos).toHaveLength(2);
    // Het overzicht telt ze mee.
    const volgende = wizard.getByRole('button', { name: 'Volgende →' });
    for (let i = 0; i < 4; i++) await volgende.click();
    await expect(wizard.locator('#wiz-step-label')).toHaveText('9 / 9 — Overzicht');
    await expect(wizard).toContainText("2 foto's");
    expect(verzoeken.verboden).toEqual([]);
  });
});
