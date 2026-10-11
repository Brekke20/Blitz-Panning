// Productietests (etappe 7, taak 1): karakterisering van de Excel-export (TicketLog) vóór ExcelJS lazy geladen wordt (T3).
// De export leest enkel het lokale rapportarchief en schrijft niets terug: er zijn geen schrijfverzoeken buiten de opstart.
// ExcelJS komt van de CDN (GET toegelaten, net als alle andere bibliotheken van de app).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { test, expect, startAppProductie, verwachtSchrijven, zohoStubs, OPSTART_SCHRIJVEN } from '../productie-hulp.mjs';

const LANG_PROBLEEM = 'Laadpaal start niet. '.repeat(5).trim(); // 104 tekens: wrapkolom, twee regels
const RAPPORTEN = {
  versie: 3,
  rapports: [
    { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Tim', interventieType: 'Interventie', prioriteit: 'high', rapportData: { probleem: LANG_PROBLEEM, acties: 'Contactor vervangen' } },
    { id: 'r2', ticketId: 't2', ticketNumber: '1002', datum: '2026-10-06', technieker: 'Roel', interventieType: 'Installatie', prioriteit: 'low', rapportData: { probleem: 'Nieuwe installatie', acties: 'Paal geplaatst' } },
  ],
};

// Minimale zip-lezer (centrale directory + inflateRaw): geen nieuwe dependency.
function leesZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('geen zip: einde van de centrale directory ontbreekt');
  const aantal = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const uit = {};
  for (let n = 0; n < aantal; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('kapotte centrale directory');
    const methode = buf.readUInt16LE(p + 10);
    const gecomprimeerd = buf.readUInt32LE(p + 20);
    const naamLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lokaal = buf.readUInt32LE(p + 42);
    const naam = buf.toString('utf8', p + 46, p + 46 + naamLen);
    const start = lokaal + 30 + buf.readUInt16LE(lokaal + 26) + buf.readUInt16LE(lokaal + 28);
    const data = buf.subarray(start, start + gecomprimeerd);
    uit[naam] = methode === 0 ? data : zlib.inflateRawSync(data);
    p += 46 + naamLen + extraLen + commentLen;
  }
  return uit;
}

// Leest het werkblad als cellen: { A4: '1001', ... }, kolombreedtes en rijhoogtes (uit sheet1.xml + sharedStrings.xml).
const ontXml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function leesWerkblad(zip) {
  const xml = zip['xl/worksheets/sheet1.xml'].toString('utf8');
  const gedeeld = [...(zip['xl/sharedStrings.xml']?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => ontXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const cellen = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = /<v>([\s\S]*?)<\/v>/.exec(m[3] ?? '');
    if (!v) continue;
    cellen[m[1]] = /t="s"/.test(m[2]) ? gedeeld[Number(v[1])] : ontXml(v[1]);
  }
  const breedtes = [];
  for (const m of xml.matchAll(/<col [^>]*>/g)) {
    const [min, max, w] = ['min', 'max', 'width'].map(k => Number(new RegExp(k + '="([0-9.]+)"').exec(m[0])?.[1]));
    for (let c = min; c <= max; c++) breedtes[c - 1] = w;
  }
  const hoogtes = {};
  for (const m of xml.matchAll(/<row r="(\d+)"([^>]*)>/g)) { const h = /ht="([\d.]+)"/.exec(m[2]); if (h) hoogtes[m[1]] = Number(h[1]); }
  return { cellen, breedtes, hoogtes };
}

async function start(page, verzoeken, rapporten) {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  const z = zohoStubs({ rapporten });
  await startAppProductie(page, { overschrijf: z.overschrijf });
  await page.getByRole('tab', { name: 'Rapporten' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => kern.rapportArchief.lijst().length)).toBe(rapporten.rapports.length);
}
const exportKnop = (page) => page.getByRole('button', { name: '📊 Excel export' });

test.describe('Excel-export (TicketLog)', () => {
  test('twee rapporten: download TicketLog_begin_huidig.xlsx met een geldig zip en beide ticketnummers', async ({ page, verzoeken }) => {
    await start(page, verzoeken, RAPPORTEN);
    const download = page.waitForEvent('download');
    await exportKnop(page).click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('TicketLog_begin_huidig.xlsx');
    await expect(page.locator('#toast')).toHaveText('✓ 2 rijen geëxporteerd');

    const bytes = fs.readFileSync(await d.path());
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    const zip = leesZip(bytes);
    expect(Object.keys(zip)).toContain('xl/worksheets/sheet1.xml');
    // ExcelJS bewaart tekst als gedeelde strings; samen met het werkblad staan beide ticketnummers erin.
    const { cellen, breedtes, hoogtes } = leesWerkblad(zip);
    // Het werkblad: titel, kop, en per rapport exact de kolommen Type, Prio, Notities en Actie (mapping uit CLAUDE.md).
    expect(cellen.A1).toBe('TICKETLOG — BLITZ POWER');
    expect(['F3', 'G3', 'U3', 'V3'].map(c => cellen[c])).toEqual(['Type', 'Prio', 'Notities', 'Actie']);
    expect({ A: cellen.A4, D: cellen.D4, F: cellen.F4, G: cellen.G4, U: cellen.U4, V: cellen.V4 })
      .toEqual({ A: '1001', D: 'Tim', F: 'Interventie', G: 'Hoog', U: LANG_PROBLEEM, V: 'Contactor vervangen' });
    expect({ A: cellen.A5, D: cellen.D5, F: cellen.F5, G: cellen.G5, U: cellen.U5, V: cellen.V5 })
      .toEqual({ A: '1002', D: 'Roel', F: 'Installatie', G: 'Laag', U: 'Nieuwe installatie', V: 'Paal geplaatst' });
    expect(cellen.A6).toBeUndefined();
    // Auto-size (CLAUDE.md): kolombreedte max(kop + 2, data + 1, 8), begrensd op 36 (wrapkolom U: 58); kolom J (Status) is 9,
    // de standaardbreedte van ExcelJS, en komt daarom niet als <col> in het bestand.
    expect(Array.from(breedtes, w => w ?? 9)).toEqual([11, 12, 19, 12, 22, 12, 8, 24, 14, 9, 17, 15, 21, 23, 15, 12, 19, 12, 10, 8, 58, 20, 17]);
    // Rijhoogte: 104 tekens in kolom U (58 breed, ~66 tekens per regel) = 2 regels = 30; de korte rij = 16.
    expect([hoogtes[4], hoogtes[5]]).toEqual([30, 16]);
  });

  test('met datumbereik: enkel het rapport binnen het bereik en de bereiklabels in de bestandsnaam', async ({ page, verzoeken }) => {
    await start(page, verzoeken, RAPPORTEN);
    await page.locator('#rapp-van').fill('2026-10-06');
    await page.locator('#rapp-tot').fill('2026-10-31');
    const download = page.waitForEvent('download');
    await exportKnop(page).click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('TicketLog_2026-10-06_2026-10-31.xlsx');
    await expect(page.locator('#toast')).toHaveText('✓ 1 rijen geëxporteerd');
    const zip = leesZip(fs.readFileSync(await d.path()));
    const { cellen } = leesWerkblad(zip);
    expect([cellen.A4, cellen.F4, cellen.G4, cellen.U4, cellen.V4]).toEqual(['1002', 'Installatie', 'Laag', 'Nieuwe installatie', 'Paal geplaatst']);
    expect(cellen.A5).toBeUndefined();
  });

  test('leeg archief: toast "Geen rapporten beschikbaar om te exporteren" en geen download', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    const z = zohoStubs({ rapporten: { versie: 0, rapports: [] } });
    await startAppProductie(page, { overschrijf: z.overschrijf });
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    await page.clock.runFor(1);
    let gedownload = false;
    page.on('download', () => { gedownload = true; });
    await exportKnop(page).click();
    await expect(page.locator('#toast')).toHaveText('Geen rapporten beschikbaar om te exporteren');
    await page.clock.runFor(3000);
    expect(gedownload).toBe(false);
  });

  // Lazy ExcelJS (etappe 7, N2): de bibliotheek wordt pas bij de eerste export opgehaald, en maar één keer.
  test('ExcelJS komt van de CDN pas bij de eerste klik, en een tweede export haalt hem niet opnieuw op', async ({ page, verzoeken }) => {
    const cdn = [];
    page.on('request', r => { if (new URL(r.url()).hostname === 'cdn.jsdelivr.net') cdn.push(r.url()); });
    await start(page, verzoeken, RAPPORTEN);
    expect(cdn, 'bij het opstarten en na het openen van de rapport-tab').toEqual([]);
    expect(await page.evaluate(() => typeof window.ExcelJS)).toBe('undefined');

    const eerste = page.waitForEvent('download');
    await exportKnop(page).click();
    await eerste;
    await expect(page.locator('#toast')).toHaveText('✓ 2 rijen geëxporteerd');
    expect(cdn.filter(u => /exceljs/.test(u)).length).toBe(1);

    const tweede = page.waitForEvent('download');
    await exportKnop(page).click();
    await tweede;
    expect(cdn.filter(u => /exceljs/.test(u)).length).toBe(1);
  });

  // Inventaris-export (tweede ExcelJS-gebruiker, etappe 7): zelfde lazy lader, eigen werkblad "Inventaris".
  test('Inventaris-export: één logregel geeft kop en rij, en precies één ExcelJS-verzoek', async ({ page, verzoeken }) => {
    const cdn = [];
    page.on('request', r => { if (new URL(r.url()).hostname === 'cdn.jsdelivr.net') cdn.push(r.url()); });
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    const inventaris = { versie: 1, wagenvoorraad: {}, log: [
      { id: 'l1', datum: '2026-10-05T07:30:00.000Z', technieker: 'Tim', type: 'aanvulling', materiaalNaam: 'Contactor 25A', aantal: 3, status: 'nieuw' },
    ] };
    const z = zohoStubs({ rapporten: { versie: 0, rapports: [] } });
    await startAppProductie(page, { overschrijf: { ...z.overschrijf, inventaris: () => ({ status: 200, json: inventaris }) } });
    await page.getByRole('tab', { name: /Inventaris/ }).click();
    await page.clock.runFor(1);
    expect(cdn, 'vóór de eerste klik').toEqual([]);
    const download = page.waitForEvent('download');
    await page.locator('#inv-export-btn').click();
    const d = await download;
    await expect(page.locator('#toast')).toHaveText('✓ 1 rijen geëxporteerd');
    expect(d.suggestedFilename()).toBe('Inventaris_begin_huidig.xlsx');
    expect(cdn.filter(u => /exceljs/.test(u)).length).toBe(1);
    const { cellen } = leesWerkblad(leesZip(fs.readFileSync(await d.path())));
    expect(cellen.A1).toBe('INVENTARIS — BLITZ POWER');
    expect(['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3'].map(c => cellen[c])).toEqual(['Datum', 'Tijd', 'Technieker', 'Type', 'Materiaal', 'Aantal', 'Status']);
    // Datum en tijd hangen van de tijdzone van de machine af; de overige cellen niet.
    expect(cellen.A4).toMatch(/\d/);
    expect({ C: cellen.C4, D: cellen.D4, E: cellen.E4, F: cellen.F4, G: cellen.G4 })
      .toEqual({ C: 'Tim', D: 'Aanvulling', E: 'Contactor 25A', F: '3', G: 'Nieuw' });
    expect(cellen.A5).toBeUndefined();
  });
});
