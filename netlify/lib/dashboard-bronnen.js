// Enige I/O van het performance-dashboard: leest de ruwe bronnen uit de blobs en bewaart de ringgrenzen.
// De berekening zelf staat in dashboard-metrics.js (puur). Elke bron staat in een eigen `try`: faalt een
// nevenbron (log, register, prijslijst, sales, een archiefjaar), dan blijft de rest werken en komt de naam in
// `fouten` (nooit een 500 om één blok). Enkel de rapportlijst is een hoofdbron: die gooit door (503 in de handler).
import { LIJST_KEY, LEGE_LIJST } from './rapportlijst.js';
import { archiefJaren, leesArchieven } from './rapport-jaararchief.js';
import { leesRegister } from './voorstelregister.js';
import { leesActiviteit } from './activiteit.js';
import { leesGebruikers } from './gebruikers.js';
import { TESTGEBRUIKERS } from './lokale-dev.js';
import { wijzigBlob } from './blob-wijzig.js';
import { maakSerieel } from './serieel.js';
import { STANDAARD_GRENZEN, valideerGrenzen } from '../../public/js/kern/dashboard-grenzen.js';

const DAG_MS = 86400000;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const TERUGBLIK_DAGEN = 90; // terugblik voor herhaalbezoeken: een eerder bezoek mag ruim vóór de periode liggen
const MAAND_RE = /^activiteit\/(\d{4})-(\d{2})$/;
const MAX_ACTIVITEIT = 1000; // grens van leesActiviteit: bereikt = mogelijk afgekapt

const dagPlus = (datum, n) => new Date(Date.parse(`${datum}T00:00:00Z`) + n * DAG_MS).toISOString().slice(0, 10);

// Actieve lijst + de jaar-archieven van de periode, ontdubbeld (de actieve lijst wint) en gesorteerd op datum, dan id.
// Het archief wordt overgeslagen als de actieve lijst al tot vanDatum (of verder) terugreikt. Jaar 'onbekend' wordt
// nooit gelezen (archiefJaren levert enkel getallen). Een archiefjaar dat faalt komt als `archief-<jaar>` in `fouten`.
// -> { rapporten, fouten, bronnen: { actief, archief, archiefJaren } }
export async function leesRapportenVoorDashboard(store, { vanDatum, totDatum }) {
  const lijst = (await store.get(LIJST_KEY, { type: 'json' })) ?? LEGE_LIJST;
  // Een bestaande maar onbruikbare lijst is een storing (503), geen lege lijst met stille nullen.
  if (!Array.isArray(lijst.rapports)) throw new Error('rapportlijst onleesbaar (geen rapports-array)');
  const actief = lijst.rapports.filter(e => e && typeof e === 'object');
  const oudste = actief.map(e => String(e.datum ?? '')).filter(d => DATUM_RE.test(d)).sort()[0] ?? null;
  const gedekt = oudste !== null && oudste <= vanDatum;
  const jaren = gedekt ? [] : archiefJaren(vanDatum, totDatum);
  const { rapports: uitArchief, fouten } = jaren.length ? await leesArchieven(store, jaren) : { rapports: [], fouten: [] };

  const ids = new Set(actief.map(e => String(e.id)));
  const ticketDagen = new Set(actief.filter(e => e.ticketId).map(e => `${e.ticketId}|${e.datum}`));
  const archief = [];
  for (const e of uitArchief) {
    if (!e || typeof e !== 'object' || e.id === undefined || e.id === null || e.id === '') continue;
    const id = String(e.id);
    const ticketDag = e.ticketId ? `${e.ticketId}|${e.datum}` : null;
    if (ids.has(id) || (ticketDag && ticketDagen.has(ticketDag))) continue;
    ids.add(id);
    if (ticketDag) ticketDagen.add(ticketDag);
    archief.push(e);
  }
  const opDatum = (a, b) => String(a.datum ?? '').localeCompare(String(b.datum ?? '')) || String(a.id).localeCompare(String(b.id));
  return {
    rapporten: [...actief, ...archief].sort(opDatum),
    fouten: fouten.map(jaar => `archief-${jaar}`),
    bronnen: { actief: actief.length, archief: archief.length, archiefJaren: jaren },
  };
}

// Oudste tijdstip in het log: de oudste maandblob, één `get` (leesActiviteit kapt af op de 1000 nieuwste).
async function oudsteActiviteit(echteStore) {
  const { blobs = [] } = (await echteStore.list({ prefix: 'activiteit/' })) ?? {};
  const oudste = blobs.map(b => b.key).filter(k => MAAND_RE.test(k)).sort()[0];
  if (!oudste) return null;
  const ops = ((await echteStore.get(oudste, { type: 'json' }))?.items ?? []).map(i => i?.op).filter(Boolean).sort();
  return ops[0] ?? null;
}

// Annulaties in het logvenster van de (vorige) periode. Testmodus: geen log (dat staat enkel in de echte opslag).
async function leesLog(echteStore, testModus, { tot, vorigeVan }) {
  if (testModus) return { activiteit: [], activiteitVanaf: null, activiteitAfgekapt: false };
  const items = await leesActiviteit(echteStore, {
    van: new Date(Date.parse(`${dagPlus(vorigeVan, -1)}T00:00:00Z`)).toISOString(),
    tot: new Date(Date.parse(`${dagPlus(tot, 2)}T00:00:00Z`)).toISOString(),
    actie: 'annulatie',
  });
  return { activiteit: items, activiteitVanaf: await oudsteActiviteit(echteStore), activiteitAfgekapt: items.length >= MAX_ACTIVITEIT };
}

// Sales-blobs per verkoper. Gedeactiveerde verkopers tellen mee (hun bezoeken horen bij de periode).
// Testmodus: de gebruikerslijst staat daar niet in de teststore, dus de sleutels van `sales/` zelf.
async function leesSales(store, echteStore, testModus) {
  let verkopers;
  if (testModus) {
    const { blobs = [] } = (await store.list({ prefix: 'sales/' })) ?? {};
    verkopers = blobs.map(b => b.key.slice('sales/'.length)).filter(Boolean).map(id => ({
      id, naam: id === 'test-sales' ? TESTGEBRUIKERS['test-sales'].salesNaam : id,
    }));
  } else {
    verkopers = (await leesGebruikers(echteStore)).filter(g => g?.rol === 'sales' && g.id)
      .map(g => ({ id: g.id, naam: g.salesNaam || g.naam }));
  }
  const uit = [];
  for (const { id, naam } of verkopers) {
    const blob = await store.get('sales/' + id, { type: 'json' });
    uit.push({ verkoper: naam, leads: Array.isArray(blob?.leads) ? blob.leads : [] });
  }
  return uit;
}

// store = de store van het verzoek (rapportlijst, register, prijslijst, sales); echteStore = altijd de echte opslag
// (gebruikers en activiteitenlog).
// deel: 'alles' | 'techniekers' (geen sales-blobs lezen) | 'sales' (enkel de sales-blobs; geen rapporten, register, log of prijslijst).
export async function leesBronnen({ store, echteStore, testModus }, { tot, vorigeVan, deel = 'alles' }) {
  const fouten = [];
  const probeer = async (naam, werk, terugval) => {
    try { return await werk(); } catch (e) {
      console.error(`dashboard: bron ${naam} mislukt (${e?.name || 'Error'})`);
      fouten.push(naam);
      return terugval;
    }
  };
  if (deel === 'sales') {
    return {
      rapporten: [], register: null, activiteit: [], activiteitVanaf: null, activiteitAfgekapt: false,
      salesBlobs: await probeer('sales', () => leesSales(store, echteStore, testModus), []),
      prijslijst: null, fouten, rapportBronnen: {},
    };
  }
  const lijst = await leesRapportenVoorDashboard(store, { vanDatum: dagPlus(vorigeVan, -TERUGBLIK_DAGEN), totDatum: tot });
  fouten.push(...lijst.fouten);
  const log = await probeer('activiteit', () => leesLog(echteStore, testModus, { tot, vorigeVan }),
    { activiteit: [], activiteitVanaf: null, activiteitAfgekapt: false });
  return {
    rapporten: lijst.rapporten,
    register: await probeer('register', () => leesRegister(store, { gooiFout: true }), { versie: 0, status: {} }),
    ...log,
    salesBlobs: deel === 'techniekers' ? [] : await probeer('sales', () => leesSales(store, echteStore, testModus), []),
    prijslijst: await probeer('prijslijst', () => store.get('prijslijst', { type: 'json' }), null),
    fouten,
    rapportBronnen: lijst.bronnen,
  };
}

// ---- ringgrenzen: blob `dashboard-instellingen` = { versie, grenzen } met optimistische locking ----
const GRENZEN_KEY = 'dashboard-instellingen';
const serieelGrenzen = maakSerieel();
const LEGE_GRENZEN = () => ({ versie: 0, grenzen: structuredClone(STANDAARD_GRENZEN) });

// Een onbruikbare opgeslagen waarde valt terug op de standaard (de versie blijft staan, zodat bewaren weer kan).
function leesBlob(blob) {
  const versie = Number.isInteger(blob?.versie) ? blob.versie : 0;
  const gecontroleerd = valideerGrenzen(blob?.grenzen ?? {});
  return { versie, grenzen: gecontroleerd.ok ? gecontroleerd.waarde : structuredClone(STANDAARD_GRENZEN) };
}

export async function leesGrenzen(store) {
  return leesBlob(await store.get(GRENZEN_KEY, { type: 'json' }));
}

// -> { ok: true, versie } | { ok: false, status: 400, fout } | { ok: false, status: 409, data: { versie, grenzen } }
// (409: `versie` was niet meer de huidige; `data` is de serverstand voor bewaarMetVersie.)
export async function schrijfGrenzen(store, grenzen, versie) {
  const gecontroleerd = valideerGrenzen(grenzen);
  if (!gecontroleerd.ok) return { ok: false, status: 400, fout: gecontroleerd.fout };
  let conflict = null;
  const r = await serieelGrenzen(() => wijzigBlob(store, GRENZEN_KEY, {
    leeg: LEGE_GRENZEN(),
    wijzig: huidig => {
      const stand = leesBlob(huidig);
      if (stand.versie !== versie) { conflict = stand; return null; }
      return { versie: stand.versie + 1, grenzen: gecontroleerd.waarde };
    },
    controleer: (terug, geschreven) => terug?.versie === geschreven.versie
      && JSON.stringify(terug.grenzen) === JSON.stringify(geschreven.grenzen),
  }));
  if (conflict) return { ok: false, status: 409, data: conflict };
  if (!r.ok) throw new Error('grenzen bewaren mislukt (terugleescontrole)');
  return { ok: true, versie: r.waarde.versie };
}
