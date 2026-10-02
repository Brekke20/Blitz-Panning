// Productietests (etappe 7, taak 1): karakterisering van de Excel-export (TicketLog) vóór ExcelJS lazy geladen wordt (T3).
// De export leest enkel het lokale rapportarchief en schrijft niets terug: er zijn geen schrijfverzoeken buiten de opstart.
// ExcelJS komt van de CDN (GET toegelaten, net als alle andere bibliotheken van de app).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { test, expect, startAppProductie, verwachtSchrijven, zohoStubs, OPSTART_SCHRIJVEN } from '../productie-hulp.mjs';

const RAPPORTEN = {
  versie: 3,
  rapports: [
    { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Tim', interventieType: 'Interventie', prioriteit: 'high', rapportData: { probleem: 'Laadpaal start niet', acties: 'Contactor vervangen' } },
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
    const inhoud = zip['xl/worksheets/sheet1.xml'].toString('utf8') + (zip['xl/sharedStrings.xml']?.toString('utf8') ?? '');
    expect(inhoud).toContain('1001');
    expect(inhoud).toContain('1002');
    expect(inhoud).toContain('TICKETLOG');
    expect(inhoud).toContain('Contactor vervangen');
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
    const inhoud = zip['xl/worksheets/sheet1.xml'].toString('utf8') + (zip['xl/sharedStrings.xml']?.toString('utf8') ?? '');
    expect(inhoud).toContain('1002');
    expect(inhoud).not.toContain('1001');
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
});
