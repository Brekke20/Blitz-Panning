// Statusmachine voor de verwerking van een rapport naar Zoho (entry.verwerking in de rapportlijst):
//   wacht -> bezig -> in-zoho
//                  -> wacht (met volgendePoging, herhaalschema) -> ... -> mislukt
// Verwerking = { status, pogingen, volgendePoging: ISO|null, laatsteFout: string|null, bijgewerkt: ISO }.
// Alle lijst-wijzigingen lopen via wijzigLijst (read-back-controle); de upload zelf (met het
// idempotentie-register) wordt als `upload` geïnjecteerd.

import { LIJST_KEY, MAX_RAPPORTEN, wijzigLijst } from './rapportlijst.js';
import { leesInhoud } from './rapport-inhoud.js';

export const HERHAALSCHEMA_MIN = [5, 15, 30, 60, 120];
export const MAX_POGINGEN = 6; // 1 eerste poging + 5 herhalingen
export const VASTGELOPEN_NA_MIN = 20;
// Een verse 'wacht' (nog geen volgendePoging) is net ontvangen: de trigger is dan nog bezig. Het
// vangnet start pas als de entry al langer dan dit wacht, anders starten trigger en vangnet dubbel.
export const VERSE_WACHT_MIN = 2;
export const EINDSTATUSSEN = ['in-zoho', 'lokaal', 'geannuleerd'];

const MIN_MS = 60_000;

export function nieuweVerwerking(status, nu) {
  return { status, pogingen: 0, volgendePoging: null, laatsteFout: null, bijgewerkt: nu.toISOString() };
}

// Verwerking na een mislukte poging: pogingen + 1; onder het maximum opnieuw 'wacht' met
// een volgendePoging volgens het herhaalschema, anders 'mislukt'.
export function naFout(verwerking, fout, nu, maxPogingen = MAX_POGINGEN) {
  const pogingen = (verwerking?.pogingen ?? 0) + 1;
  const basis = { pogingen, laatsteFout: String(fout), bijgewerkt: nu.toISOString() };
  if (pogingen < maxPogingen) {
    const wachtMin = HERHAALSCHEMA_MIN[Math.min(pogingen, HERHAALSCHEMA_MIN.length) - 1];
    return { ...basis, status: 'wacht', volgendePoging: new Date(nu.getTime() + wachtMin * MIN_MS).toISOString() };
  }
  return { ...basis, status: 'mislukt', volgendePoging: null };
}

export function isVastgelopen(entry, nu) {
  const v = entry?.verwerking;
  if (v?.status !== 'bezig') return false;
  const sinds = Date.parse(v.bijgewerkt);
  return Number.isFinite(sinds) && nu.getTime() - sinds > VASTGELOPEN_NA_MIN * MIN_MS;
}

// Moet het vangnet de verwerking (opnieuw) starten? Entries zonder `verwerking` (oude flow) nooit.
export function moetStarten(entry, nu) {
  const v = entry?.verwerking;
  if (!v) return false;
  if (v.status === 'wacht') {
    if (!v.volgendePoging) {
      const sinds = Date.parse(v.bijgewerkt);
      return !Number.isFinite(sinds) || nu.getTime() - sinds > VERSE_WACHT_MIN * MIN_MS;
    }
    const vanaf = Date.parse(v.volgendePoging);
    return !Number.isFinite(vanaf) || vanaf <= nu.getTime();
  }
  return isVastgelopen(entry, nu);
}

// Zet de verwerking van één entry; geen wijziging als de entry weg is of niet meer wacht/bezig is.
// Gooit als de write niet bevestigd raakt (Netlify herprobeert; het register maakt dat veilig).
async function zetVerwerking(store, id, maakEntry) {
  const res = await wijzigLijst(store, ({ rapports }) => {
    const idx = rapports.findIndex(r => r.id === id);
    if (idx < 0) return null;
    const nieuw = maakEntry(rapports[idx]);
    if (!nieuw) return null;
    const lijst = [...rapports];
    lijst[idx] = nieuw;
    return {
      rapports: lijst,
      controle: terug => {
        const e = terug.find(r => r.id === id);
        return e?.verwerking?.status === nieuw.verwerking.status
          && e.verwerking.bijgewerkt === nieuw.verwerking.bijgewerkt
          && e.verwerking.pogingen === nieuw.verwerking.pogingen;
      },
    };
  });
  if (!res.ok) throw new Error(`Rapportlijst bijwerken mislukt voor ${id}`);
}

// Lost update op de rapportlijst (een gelijktijdige schrijver overschreef de lijst net nadat de
// ontvangst haar entry had toegevoegd): staat de lichte entry nog in de inhoudsblob, dan zetten we ze
// terug, tenzij een andere entry dezelfde ticketId+datum heeft (een vervangen rapport komt niet terug).
async function herstelEntry(store, id) {
  const inhoud = await leesInhoud(store, id);
  const bewaard = inhoud?.entry;
  if (!bewaard || bewaard.id !== id) return null;
  const res = await wijzigLijst(store, ({ rapports }) => {
    if (rapports.some(r => r.id === id)) return null;
    if (bewaard.ticketId && rapports.some(r => r.ticketId === bewaard.ticketId && r.datum === bewaard.datum)) return null;
    return {
      rapports: [bewaard, ...rapports].slice(0, MAX_RAPPORTEN),
      controle: terug => terug.some(r => r.id === id),
    };
  });
  if (!res.ok) throw new Error(`Rapportlijst herstellen mislukt voor ${id}`);
  const lijst = (await store.get(LIJST_KEY, { type: 'json' })) ?? { rapports: [] };
  return lijst.rapports.find(r => r.id === id) ?? null;
}

export async function verwerkRapport(id, { store, upload, nu = () => new Date(), maxPogingen = MAX_POGINGEN }) {
  const lijst = (await store.get(LIJST_KEY, { type: 'json' })) ?? { rapports: [] };
  const entry = lijst.rapports.find(r => r.id === id) ?? await herstelEntry(store, id);
  if (!entry) return { resultaat: 'niet-gevonden' };
  const status = entry.verwerking?.status;
  if (status !== 'wacht' && status !== 'bezig') return { resultaat: 'overgeslagen' };

  const mislukt = async fout => {
    let uitkomst;
    await zetVerwerking(store, id, e => {
      if (e.verwerking?.status !== 'wacht' && e.verwerking?.status !== 'bezig') return null;
      uitkomst = naFout(e.verwerking, fout, nu(), maxPogingen);
      return { ...e, verwerking: uitkomst };
    });
    return { resultaat: uitkomst?.status ?? 'overgeslagen' };
  };

  const inhoud = await leesInhoud(store, id);
  if (!inhoud) return mislukt('Rapportinhoud ontbreekt');

  // Stond de entry al op 'bezig', dan is een eerdere run onderbroken (vangnet na time-out/crash of
  // een automatische Netlify-retry): die run telt als mislukte poging, anders zou een run die
  // telkens crasht nooit 'mislukt' bereiken. Een verse 'wacht'-entry houdt zijn pogingen.
  let onderbrokenMislukt = false;
  await zetVerwerking(store, id, e => {
    onderbrokenMislukt = false;
    const v = e.verwerking;
    if (v?.status !== 'wacht' && v?.status !== 'bezig') return null;
    if (v.status === 'bezig') {
      const na = naFout(v, 'Vorige poging onderbroken', nu(), maxPogingen);
      if (na.status === 'mislukt') {
        onderbrokenMislukt = true;
        return { ...e, verwerking: na };
      }
      return { ...e, verwerking: { ...na, status: 'bezig', volgendePoging: null } };
    }
    return { ...e, verwerking: { ...v, status: 'bezig', bijgewerkt: nu().toISOString() } };
  });
  if (onderbrokenMislukt) return { resultaat: 'mislukt' };

  let uitkomst;
  try {
    uitkomst = await upload({ html: inhoud.html, ticketId: inhoud.ticketId, filename: inhoud.filename, verzendId: id });
  } catch (err) {
    return mislukt(err?.message || String(err));
  }
  if (uitkomst?.inProgress) return { resultaat: 'al-bezig' };

  await zetVerwerking(store, id, e => ({
    ...e,
    verwerking: { ...nieuweVerwerking('in-zoho', nu()), pogingen: e.verwerking?.pogingen ?? 0 },
    zohoUploaded: true,
    zohoAttachmentId: uitkomst?.attachmentId ?? null,
    geannuleerd: false,
  }));
  return { resultaat: 'in-zoho' };
}
