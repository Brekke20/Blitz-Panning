// Activiteitenlog: één blob per maand, `activiteit/<YYYY-MM>` = { versie, items: [Activiteit] }.
// Activiteit = { op: ISO, gebruikerId, naam, actie, onderwerp, details }. Maanden volgen UTC (zoals `op`).
import { wijzigBlob } from './blob-wijzig.js';
import { isTestVerzoek } from './testmodus.js';

const PREFIX = 'activiteit/';
const MAX_DETAILS = 500;
const MAX_RESULTATEN = 1000;
const MAAND_RE = /^activiteit\/(\d{4})-(\d{2})$/;

const maandSleutel = ms => PREFIX + new Date(ms).toISOString().slice(0, 7);
const maandIndex = (jaar, maand) => jaar * 12 + (maand - 1);

function maakDetails(details) {
  if (details == null) return null;
  const tekst = typeof details === 'string' ? details : (JSON.stringify(details) ?? String(details));
  return tekst.slice(0, MAX_DETAILS);
}

// Best-effort: gooit nooit (een mislukte log mag de eigenlijke actie niet breken).
// `uniek: true`: staat er in dezelfde maandblob al een regel van dezelfde gebruiker met dezelfde actie, hetzelfde onderwerp en dezelfde
// details, dan wordt er niets bijgeschreven (voor acties die een client eindeloos herhaalt, zoals een geweigerd rapport in de outbox).
export async function logActiviteit(store, { gebruiker, actie, onderwerp = null, details = null, uniek = false }, { nu = () => Date.now() } = {}) {
  try {
    const ms = nu();
    const item = {
      op: new Date(ms).toISOString(),
      gebruikerId: gebruiker?.id ?? null,
      naam: gebruiker?.naam ?? null,
      actie,
      onderwerp: onderwerp ?? null,
      details: maakDetails(details),
    };
    const r = await wijzigBlob(store, maandSleutel(ms), {
      leeg: { versie: 0, items: [] },
      wijzig: (blob) => {
        const items = blob.items ?? [];
        if (uniek && items.some(i => i.gebruikerId === item.gebruikerId && i.actie === item.actie && i.onderwerp === item.onderwerp && i.details === item.details)) return null;
        return { ...blob, items: [...items, item] };
      },
    });
    if (!r.ok) console.error(`[activiteit] loggen mislukt na herhaling (actie ${String(actie).slice(0, 60)})`);
  } catch (err) {
    console.error('[activiteit] loggen mislukt:', err?.message || err);
  }
}

// Testverzoeken (header X-Blitz-Test) loggen niets; anders altijd naar de ECHTE store.
export async function logVoorVerzoek(reqOfEvent, gebruiker, { actie, onderwerp, details, uniek }, { getStore, nu } = {}) {
  try {
    if (isTestVerzoek(reqOfEvent)) return;
    const store = getStore({ name: 'blitz-data', consistency: 'strong' });
    await logActiviteit(store, { gebruiker, actie, onderwerp, details, uniek }, nu ? { nu } : undefined);
  } catch (err) {
    console.error('[activiteit] loggen mislukt:', err?.message || err);
  }
}

const naarMs = w => (w == null || w === '' ? null : (typeof w === 'number' ? w : Date.parse(w)));

// Nieuwste eerst, max 1000.
export async function leesActiviteit(store, { van, tot, gebruikerId, actie } = {}) {
  const vanMs = naarMs(van), totMs = naarMs(tot);
  const vanIdx = vanMs == null || Number.isNaN(vanMs) ? null : maandIndex(new Date(vanMs).getUTCFullYear(), new Date(vanMs).getUTCMonth() + 1);
  const totIdx = totMs == null || Number.isNaN(totMs) ? null : maandIndex(new Date(totMs).getUTCFullYear(), new Date(totMs).getUTCMonth() + 1);
  const { blobs = [] } = (await store.list({ prefix: PREFIX })) ?? {};
  const alle = [];
  for (const { key } of blobs) {
    const m = MAAND_RE.exec(key);
    if (!m) continue;
    const idx = maandIndex(Number(m[1]), Number(m[2]));
    if ((vanIdx != null && idx < vanIdx) || (totIdx != null && idx > totIdx)) continue;
    const blob = await store.get(key, { type: 'json' });
    // binnen een maand staat het nieuwste laatst: omkeren, zodat een stabiele sortering nieuwste-eerst blijft
    for (const it of [...(blob?.items ?? [])].reverse()) alle.push(it);
  }
  return alle
    .filter(it => {
      const t = Date.parse(it.op);
      if (vanMs != null && !(t >= vanMs)) return false;
      if (totMs != null && !(t <= totMs)) return false;
      if (gebruikerId && it.gebruikerId !== gebruikerId) return false;
      if (actie && it.actie !== actie) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.op) - Date.parse(a.op))
    .slice(0, MAX_RESULTATEN);
}

// Verwijdert maand-blobs ouder dan `maanden` maanden; geeft de verwijderde sleutels terug.
export async function ruimActiviteitOp(store, { nu, maanden = 12 } = {}) {
  const d = new Date(nu ?? Date.now());
  const grens = maandIndex(d.getUTCFullYear(), d.getUTCMonth() + 1) - maanden;
  const { blobs = [] } = (await store.list({ prefix: PREFIX })) ?? {};
  const weg = [];
  for (const { key } of blobs) {
    const m = MAAND_RE.exec(key);
    if (m && maandIndex(Number(m[1]), Number(m[2])) < grens) {
      await store.delete(key);
      weg.push(key);
    }
  }
  return weg;
}
