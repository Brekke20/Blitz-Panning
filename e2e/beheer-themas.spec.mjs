// Beheer, tab Thema's: kaarten, upload (nieuw, nieuwe versie, ongeldig), aan/uit, periode, voorbeeld en download.
// Alle gegevens zijn de negen voorgeladen pakketten uit netlify/themas (dezelfde bestanden als de server zaait); /api/themas is hier
// een stateful stub met optimistic locking op `versie`. De klok van de app staat op 5 oktober 2026 (Halloween loopt).
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startApp } from './helpers.mjs';
import { valideerPakket } from '../public/js/kern/themapakket-validatie.js';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const THEMAS_MAP = path.join(MAP, '..', 'netlify', 'themas');
const json = (status, obj) => ({ status, json: obj });
const pakkettenUitBestanden = () => fs.readdirSync(THEMAS_MAP).filter(f => f.endsWith('.blitzthema.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(THEMAS_MAP, f), 'utf8')));

// Een stateful /api/themas. `schrijven` houdt elke POST en PATCH bij (met body), `lezingen` elke GET met ?id.
function themasStub({ weigerId = null } = {}) {
  const pakketten = new Map(pakkettenUitBestanden().map(p => [p.id, p]));
  const rijen = [...pakketten.values()].map(p => ({ id: p.id, naam: p.naam, aan: true, periode: p.periode, periodeOverride: null, pakketHash: `h-${p.id}-1` }));
  let versie = 1;
  const schrijven = [];
  const lezingen = [];
  const stub = ({ methode, body, query }) => {
    if (methode === 'GET') {
      const id = query.get('id');
      if (id !== null) {
        lezingen.push(id);
        return pakketten.has(id) ? json(200, structuredClone(pakketten.get(id))) : json(404, { error: 'Dit thema bestaat niet.' });
      }
      return json(200, { versie, themas: structuredClone(rijen), pakketten: {} });
    }
    schrijven.push({ methode, body: structuredClone(body) });
    if (methode === 'POST') {
      if (body?.id === weigerId) {
        return json(422, { error: 'Het themapakket is ongeldig.', fouten: [{ veld: '<img src=x onerror=window.__xss=1>', fout: 'Onbekend veld <b>vet</b>' }, { veld: 'periode.van.dag', fout: 'Ongeldige dag (1 tot 31).' }] });
      }
      const v = valideerPakket(body);
      if (!v.ok) return json(422, { error: 'Het themapakket is ongeldig.', fouten: v.fouten });
      const bestond = pakketten.has(body.id);
      pakketten.set(body.id, structuredClone(body));
      const i = rijen.findIndex(r => r.id === body.id);
      const vers = { id: body.id, naam: body.naam, aan: true, periode: body.periode, periodeOverride: null, pakketHash: `h-${body.id}-${versie + 1}` };
      if (i === -1) rijen.push(vers); else rijen[i] = { ...vers, aan: rijen[i].aan, periodeOverride: rijen[i].periodeOverride };
      versie += 1;
      return json(200, { ok: true, nieuw: !bestond, versie, themas: structuredClone(rijen) });
    }
    if (methode === 'PATCH') {
      const rij = rijen.find(r => r.id === body?.id);
      if (!rij) return json(404, { error: 'Dit thema bestaat niet.' });
      if (body.versie !== versie) return json(409, { error: 'De themalijst is intussen gewijzigd. Vernieuw en probeer opnieuw.', serverVersie: versie });
      if (body.aan !== undefined) rij.aan = body.aan;
      if (body.periode !== undefined) rij.periodeOverride = body.periode;
      versie += 1;
      return json(200, { ok: true, versie, themas: structuredClone(rijen) });
    }
    return json(405, { error: 'niet toegestaan' });
  };
  stub.schrijven = schrijven;
  stub.lezingen = lezingen;
  stub.rijen = rijen;
  stub.verhoogVersie = () => { versie += 1; }; // een collega wijzigde de lijst tussendoor
  return stub;
}

async function openThemas(page, stub = themasStub(), app = {}) {
  await startApp(page, { ...app, overschrijf: { themas: stub, ...(app.overschrijf ?? {}) } });
  await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
  await page.getByRole('tab', { name: "Thema's", exact: true }).click();
  await expect(page.getByRole('tab', { name: "Thema's", exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.bt-kaart').first()).toBeVisible();
  return stub;
}

const kaart = (page, naam) => page.locator('.bt-kaart').filter({ has: page.getByRole('heading', { name: naam, exact: true }) });
const bevestiging = (page, titel) => page.getByRole('alertdialog', { name: titel });
const pakketBestand = (wijzig) => {
  const p = JSON.parse(fs.readFileSync(path.join(THEMAS_MAP, 'halloween.blitzthema.json'), 'utf8'));
  wijzig?.(p);
  return { name: `${p.id}.blitzthema.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(p)) };
};
const schrijfVerzoeken = (verzoeken) => verzoeken.alle.filter(r => r.pad === '/api/themas' && r.methode !== 'GET');

// Een bedoelde 4xx meldt de browser als HTTP-fout en als consolefout; die halen we weg.
async function verwachtFout(consoleFouten, pad, status) {
  const isDeze = (f) => f.includes(pad) && f.includes(String(status));
  await expect.poll(() => consoleFouten.filter(isDeze).length).toBeGreaterThanOrEqual(1);
  for (const f of consoleFouten.filter(isDeze)) consoleFouten.splice(consoleFouten.indexOf(f), 1);
}

test.describe("Beheer: tab Thema's", () => {
  test("toont één kaart per thema van de server, met naam, periode en status in gewoon Nederlands", async ({ page }) => {
    const stub = await openThemas(page);
    await expect(page.locator('.bt-kaart')).toHaveCount(stub.rijen.length);
    expect(stub.rijen.length).toBeGreaterThanOrEqual(2);
    const halloween = kaart(page, 'Halloween');
    await expect(halloween).toContainText('1 tot 31 oktober');
    await expect(halloween.locator('.bt-status')).toHaveText('Nu actief');
    await expect(halloween.locator('.bt-status')).toHaveAttribute('data-status', 'actief');
    await expect(kaart(page, 'Kerst').locator('.bt-status')).toHaveText('Later dit jaar');
    await expect(kaart(page, 'Kerst')).toContainText('7 tot 31 december');
    await expect(kaart(page, 'Sinterklaas')).toContainText('1 tot 6 december');
    await expect(page.getByRole('switch', { name: 'Halloween aan' })).toBeChecked();
  });

  test('een nieuw geldig pakket uploaden voegt een kaart toe en meldt het', async ({ page, verzoeken }) => {
    const stub = await openThemas(page);
    const voor = stub.rijen.length;
    await page.locator('.bt-bestand').setInputFiles(pakketBestand((p) => { p.id = 'testfeest'; p.naam = 'Testfeest'; }));
    await expect(page.locator('.bt-kaart')).toHaveCount(voor + 1);
    await expect(kaart(page, 'Testfeest')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('Testfeest is toegevoegd');
    const posts = stub.schrijven.filter(s => s.methode === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].body.id).toBe('testfeest');
    expect(schrijfVerzoeken(verzoeken).map(r => r.methode)).toEqual(['POST']);
  });

  test('een ongeldig pakket geeft een foutlijst in het Nederlands en er wordt niets verstuurd', async ({ page, verzoeken }) => {
    await openThemas(page);
    await page.locator('.bt-bestand').setInputFiles(pakketBestand((p) => { p.id = 'kapot'; p.periode = { van: { maand: 13, dag: 1 }, tot: { maand: 1, dag: 1 } }; delete p.kleuren; }));
    const fout = page.locator('.bt-uploadfout');
    await expect(fout).toContainText('Het pakket is niet geüpload');
    await expect(fout.locator('li').filter({ hasText: 'periode' }).first()).toBeVisible();
    expect(await fout.locator('li').count()).toBeGreaterThanOrEqual(2);
    expect(schrijfVerzoeken(verzoeken)).toEqual([]);
    // geen JSON
    await page.locator('.bt-bestand').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('dit is geen json') });
    await expect(fout).toContainText('geen geldige JSON');
    expect(schrijfVerzoeken(verzoeken)).toEqual([]);
  });

  test('een bestand van meer dan 512 kB wordt geweigerd zonder verzoek', async ({ page, verzoeken }) => {
    await openThemas(page);
    await page.locator('.bt-bestand').setInputFiles({ name: 'groot.json', mimeType: 'application/json', buffer: Buffer.alloc(600 * 1024, 0x20) });
    await expect(page.locator('.bt-uploadfout')).toContainText('groter dan 512 kB');
    expect(schrijfVerzoeken(verzoeken)).toEqual([]);
  });

  test('een bestaand id vraagt eerst "Nieuwe versie van Halloween uploaden?"; Terug stuurt niets, Uploaden stuurt één POST', async ({ page, verzoeken }) => {
    const stub = await openThemas(page);
    const voor = stub.rijen.length;
    await page.locator('.bt-bestand').setInputFiles(pakketBestand((p) => { p.versie = '9.9'; }));
    const dialoog = bevestiging(page, 'Nieuwe versie van Halloween uploaden?');
    await expect(dialoog).toBeVisible();
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(dialoog).toHaveCount(0);
    expect(schrijfVerzoeken(verzoeken)).toEqual([]);
    // dezelfde keuze nog eens: kan opnieuw (het bestandsveld is leeggemaakt)
    await page.locator('.bt-bestand').setInputFiles(pakketBestand((p) => { p.versie = '9.9'; }));
    await bevestiging(page, 'Nieuwe versie van Halloween uploaden?').getByRole('button', { name: 'Uploaden' }).click();
    await expect(page.locator('#toast')).toContainText('Nieuwe versie van Halloween geüpload');
    expect(stub.schrijven.map(s => s.methode)).toEqual(['POST']);
    await expect(page.locator('.bt-kaart')).toHaveCount(voor);
  });

  test('een 422 van de server toont de foutregels als gewone tekst (geen HTML, geen script)', async ({ page, consoleFouten }) => {
    await openThemas(page, themasStub({ weigerId: 'weiger' }));
    await page.locator('.bt-bestand').setInputFiles(pakketBestand((p) => { p.id = 'weiger'; p.naam = 'Weiger'; }));
    const fout = page.locator('.bt-uploadfout');
    await expect(fout).toContainText('<img src=x onerror=window.__xss=1>');
    await expect(fout).toContainText('Onbekend veld <b>vet</b>');
    await expect(fout.locator('img, b')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await verwachtFout(consoleFouten, '/api/themas', 422);
  });

  test('uitzetten vraagt bevestiging, stuurt PATCH met aan:false en de versie en toont "Uit"; Terug laat alles staan', async ({ page, verzoeken }) => {
    const stub = await openThemas(page);
    const schakelaar = page.getByRole('switch', { name: 'Halloween aan' });
    await schakelaar.click();
    const dialoog = bevestiging(page, 'Halloween uitzetten?');
    await expect(dialoog).toBeVisible();
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(schakelaar).toBeChecked();
    expect(schrijfVerzoeken(verzoeken)).toEqual([]);

    await schakelaar.click();
    await bevestiging(page, 'Halloween uitzetten?').getByRole('button', { name: 'Uitzetten' }).click();
    await expect(kaart(page, 'Halloween').locator('.bt-status')).toHaveText('Uit');
    await expect(page.getByRole('switch', { name: 'Halloween aan' })).not.toBeChecked();
    expect(stub.schrijven).toEqual([{ methode: 'PATCH', body: { id: 'halloween', aan: false, versie: 1 } }]);
    // weer aanzetten: geen bevestiging, PATCH met de nieuwe versie
    await page.getByRole('switch', { name: 'Halloween aan' }).click();
    await expect(kaart(page, 'Halloween').locator('.bt-status')).toHaveText('Nu actief');
    expect(stub.schrijven[1]).toEqual({ methode: 'PATCH', body: { id: 'halloween', aan: true, versie: 2 } });
  });

  test('een 409 (iemand anders wijzigde de lijst) meldt het, laadt de lijst opnieuw en laat de schakelaar de serverstand tonen', async ({ page, consoleFouten }) => {
    const stub = await openThemas(page);
    stub.verhoogVersie();
    await page.getByRole('switch', { name: 'Kerst aan' }).click();
    await bevestiging(page, 'Kerst uitzetten?').getByRole('button', { name: 'Uitzetten' }).click();
    await expect(page.locator('#toast')).toContainText('intussen door iemand anders gewijzigd');
    await verwachtFout(consoleFouten, '/api/themas', 409);
    await expect(page.getByRole('switch', { name: 'Kerst aan' })).toBeChecked();
    // na het herladen kent de pagina de nieuwe versie: een nieuwe poging slaagt
    await page.getByRole('switch', { name: 'Kerst aan' }).click();
    await bevestiging(page, 'Kerst uitzetten?').getByRole('button', { name: 'Uitzetten' }).click();
    await expect(kaart(page, 'Kerst').locator('.bt-status')).toHaveText('Uit');
    expect(stub.schrijven.map(s => s.body.versie)).toEqual([1, 2]);
  });

  test('Periode aanpassen: een vaste periode met dag en maand; PATCH met de nieuwe periode; "Terug naar standaard" stuurt periode: null', async ({ page }) => {
    const stub = await openThemas(page);
    await kaart(page, 'Halloween').getByRole('button', { name: 'Periode van Halloween aanpassen' }).click();
    const venster = page.getByRole('dialog', { name: 'Periode van Halloween' });
    await expect(venster).toBeVisible();
    await expect(venster.getByRole('button', { name: 'Terug naar standaard' })).toBeDisabled();
    const van = venster.getByRole('group', { name: 'Begint op' });
    const tot = venster.getByRole('group', { name: 'Eindigt op' });
    await expect(van.getByLabel('Dag')).toHaveValue('1');
    await expect(van.getByLabel('Maand')).toHaveValue('10');
    await van.getByLabel('Dag').fill('5');
    await tot.getByLabel('Dag').fill('2');
    await tot.getByLabel('Maand').selectOption('11');
    await expect(venster.locator('.bt-resultaat')).toContainText('5 oktober tot 2 november');
    await venster.getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster).toHaveCount(0);
    await expect(kaart(page, 'Halloween')).toContainText('5 oktober tot 2 november');
    await expect(kaart(page, 'Halloween').locator('.bt-aangepast')).toHaveText('Aangepast');
    expect(stub.schrijven).toEqual([{ methode: 'PATCH', body: { id: 'halloween', periode: { van: { maand: 10, dag: 5 }, tot: { maand: 11, dag: 2 } }, versie: 1 } }]);

    await kaart(page, 'Halloween').getByRole('button', { name: 'Periode van Halloween aanpassen' }).click();
    const tweede = page.getByRole('dialog', { name: 'Periode van Halloween' });
    await expect(tweede.getByLabel('Dag').first()).toHaveValue('5');
    await tweede.getByRole('button', { name: 'Terug naar standaard' }).click();
    await expect(tweede).toHaveCount(0);
    await expect(kaart(page, 'Halloween')).toContainText('1 tot 31 oktober');
    await expect(kaart(page, 'Halloween').locator('.bt-aangepast')).toHaveCount(0);
    expect(stub.schrijven[1]).toEqual({ methode: 'PATCH', body: { id: 'halloween', periode: null, versie: 2 } });
  });

  test('Periode aanpassen: een periode rond Pasen heeft twee getallen; een leeg of ongeldig veld geeft een fout zonder verzoek', async ({ page, verzoeken }) => {
    const stub = await openThemas(page);
    await kaart(page, 'Pasen').getByRole('button', { name: 'Periode van Pasen aanpassen' }).click();
    const venster = page.getByRole('dialog', { name: 'Periode van Pasen' });
    await expect(venster).toContainText('Pasen valt in 2026 op 5 april');
    await expect(venster.getByLabel('Begint (dagen t.o.v. Pasen)')).toHaveValue('-7');
    await expect(venster.getByLabel('Eindigt (dagen t.o.v. Pasen)')).toHaveValue('1');
    await venster.getByLabel('Begint (dagen t.o.v. Pasen)').fill('');
    await venster.getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster.getByRole('alert')).toContainText('geheel aantal dagen');
    expect(schrijfVerzoeken(verzoeken)).toEqual([]);
    await venster.getByLabel('Begint (dagen t.o.v. Pasen)').fill('5');
    await venster.getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster.getByRole('alert')).toContainText('niet voor');
    expect(schrijfVerzoeken(verzoeken)).toEqual([]);
    await venster.getByLabel('Begint (dagen t.o.v. Pasen)').fill('-10');
    await venster.getByLabel('Eindigt (dagen t.o.v. Pasen)').fill('3');
    await venster.getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster).toHaveCount(0);
    expect(stub.schrijven).toEqual([{ methode: 'PATCH', body: { id: 'pasen', periode: { basis: 'pasen', van: -10, tot: 3 }, versie: 1 } }]);
    await expect(kaart(page, 'Pasen')).toContainText('Aangepast');
  });

  test('Voorbeeld: html[data-event] wordt het thema (ook buiten de periode), Stop voorbeeld zet het terug, en er wordt niets geschreven', async ({ page, verzoeken }) => {
    const stub = await openThemas(page);
    const html = page.locator('html');
    stub.lezingen.length = 0; // de app haalt bij het opstarten zelf het pakket van het lopende thema op
    await expect(html).not.toHaveAttribute('data-event', /.+/); // ?test: geen versiering
    await kaart(page, 'Kerst').getByRole('button', { name: 'Voorbeeld' }).click();
    await expect(html).toHaveAttribute('data-event', 'kerst');
    await expect(page.locator('.bt-voorbeeld')).toContainText('Voorbeeld van Kerst');
    await expect(kaart(page, 'Kerst')).toContainText('Je bekijkt dit voorbeeld');
    await expect(page.locator('#event-laag')).toHaveCount(1);
    // een ander voorbeeld vervangt het eerste
    await kaart(page, 'Sinterklaas').getByRole('button', { name: 'Voorbeeld' }).click();
    await expect(html).toHaveAttribute('data-event', 'sinterklaas');
    await page.getByRole('button', { name: 'Stop voorbeeld' }).click();
    await expect(html).not.toHaveAttribute('data-event', /.+/);
    await expect(page.locator('#event-laag')).toHaveCount(0);
    await expect(page.locator('.bt-voorbeeld')).toBeHidden();
    expect(schrijfVerzoeken(verzoeken)).toEqual([]);
    expect(stub.lezingen).toEqual(['kerst', 'sinterklaas']);
  });

  test('Downloaden: een bestand <id>.blitzthema.json met het pakket', async ({ page }) => {
    await openThemas(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      kaart(page, 'Halloween').getByRole('button', { name: 'Halloween downloaden' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('halloween.blitzthema.json');
    const tekst = fs.readFileSync(await download.path(), 'utf8');
    const pakket = JSON.parse(tekst);
    expect(pakket.id).toBe('halloween');
    expect(pakket.naam).toBe('Halloween');
    expect(valideerPakket(pakket).ok).toBe(true);
  });

  test('op een gsm past alles in de breedte (geen horizontale scroll) en de knoppen zijn groot genoeg', async ({ page }) => {
    await openThemas(page, themasStub(), { viewport: { width: 375, height: 812 } });
    const past = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(past).toBe(true);
    const hoogtes = await page.locator('.bt-kaart .btn').evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
    expect(hoogtes.length).toBeGreaterThan(0);
    for (const hoogte of hoogtes) expect(hoogte).toBeGreaterThanOrEqual(43.5);
  });
});
