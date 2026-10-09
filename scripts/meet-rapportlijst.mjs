// Meting van een rapportlijst-blob (de actieve lijst of een jaar-archief), enkel lezen.
// Gebruik: node scripts/meet-rapportlijst.mjs <blob.json> [<blob2.json> ...]
// De blob is { versie, rapports: Entry[] } (of een kale array van entries). Per blob:
// aantal entries, gemiddelde bytes per entry, aantal entries met rapportData._html / fotos,
// en een projectie per jaar. Een jaar-archief boven ~8 MB is een signaal om halfjaar-archieven
// te overwegen (blokkeert niets).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const GRENS_MB = 8;
const bytes = v => Buffer.byteLength(JSON.stringify(v));
const mb = n => (n / 1024 / 1024).toFixed(2);

export function meetBlob(blob) {
  const rapports = Array.isArray(blob) ? blob : (blob?.rapports ?? []);
  const totaal = bytes(blob);
  const metHtml = rapports.filter(r => r?.rapportData?._html).length;
  const metFotos = rapports.filter(r => r?.rapportData?.fotos?.length).length;
  const gemiddeld = rapports.length ? Math.round(totaal / rapports.length) : 0;

  // Projectie per jaar: entries per kalenderjaar uit datum (anders aangemaakt), gemiddeld per jaar.
  const perJaar = new Map();
  for (const r of rapports) {
    const j = (/^(\d{4})/.exec(String(r?.datum || r?.aangemaakt || '')) ?? [])[1] ?? 'onbekend';
    perJaar.set(j, (perJaar.get(j) ?? 0) + 1);
  }
  const jaren = [...perJaar.entries()].filter(([j]) => j !== 'onbekend');
  const gemEntriesPerJaar = jaren.length ? Math.round(jaren.reduce((s, [, n]) => s + n, 0) / jaren.length) : rapports.length;
  const projectieBytes = gemEntriesPerJaar * gemiddeld;
  return {
    entries: rapports.length, totaalBytes: totaal, gemiddeldBytes: gemiddeld,
    metHtml, metFotos, perJaar: Object.fromEntries(perJaar),
    projectieJaarBytes: projectieBytes, boven8MB: projectieBytes > GRENS_MB * 1024 * 1024,
  };
}

export function formatteer(naam, m) {
  return [
    `== ${naam}`,
    `entries:                 ${m.entries}`,
    `totaal:                  ${mb(m.totaalBytes)} MB`,
    `gemiddeld per entry:     ${m.gemiddeldBytes} bytes`,
    `met rapportData._html:   ${m.metHtml}`,
    `met rapportData.fotos:   ${m.metFotos}`,
    `entries per jaar:        ${JSON.stringify(m.perJaar)}`,
    `projectie per jaar:      ${mb(m.projectieJaarBytes)} MB${m.boven8MB ? `  (BOVEN ${GRENS_MB} MB: halfjaar-archieven overwegen)` : ''}`,
  ].join('\n');
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const paden = process.argv.slice(2);
  if (!paden.length) { console.error('Gebruik: node scripts/meet-rapportlijst.mjs <blob.json> [...]'); process.exit(1); }
  for (const p of paden) console.log(formatteer(p, meetBlob(JSON.parse(readFileSync(p, 'utf8')))) + '\n');
}
