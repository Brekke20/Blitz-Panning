// MCP-leesconnector (Claude): JSON-RPC-afhandeling en de zes leesgereedschappen, per rol.
// De HTTP-kant (Bearer-controle, POST, batch, 202) staat in netlify/functions/mcp.js; hier enkel één bericht.
//
// Rechten (fail-closed):
//   - enkel beheerder, planner en technieker krijgen gereedschappen; elke andere rol (sales, onbekend) krijgt een lege
//     tools/list en -32601 op tools/call, VOOR er ook maar één blob gelezen wordt (filterRapportenVoor laat sales alles zien).
//   - technieker: rapporten eerst door filterRapportenVoor (eigen rapporten), dan pas zoeken/tellen/historiek/opzoeken.
//     Planning enkel met zijn eigen naam (isEigenNaam). Tickets: hetzelfde als GET /api/tickets hem geeft (ongefilterd).
// Enkel lezen: geen enkele functie hier schrijft naar de store; tickets komen enkel uit de bewaarde momentopname (nooit Zoho).
// Foutteksten aan Claude zijn vast; een uitzondering logt enkel het fouttype (Blobs-fouten kunnen details bevatten).
import pkg from '../../package.json' with { type: 'json' };
import { laadRapporten, vlakRapport, zoekRapporten, telRapporten, paalHistoriek, normSerie, MAX_RESULTATEN } from './mcp-data.js';
import { filterRapportenVoor, isEigenNaam } from './eigen.js';
import { SNAPSHOT_SLEUTEL, geldigeSnapshot } from './tickets-snapshot.js';
import { leesRegister } from './voorstelregister.js';
import { OORZAAK_LABELS } from '../../public/js/rapport-oorzaak.js';

export const PROTOCOL_VERSIES = Object.freeze(['2025-06-18', '2025-03-26']);
const STANDAARD_VERSIE = '2025-06-18';
const LEESROLLEN = new Set(['beheerder', 'planner', 'technieker']);
export const GROEPERINGEN = Object.freeze(['oorzaak', 'serienummer', 'technieker', 'maand', 'klant', 'interventieType']);
const PLANNING_STANDAARD_DAGEN = 14;
const PLANNING_MAX_DAGEN = 366;
const MAX_TEKST = 200;

const INSTRUCTIES = [
  'Blitz Planning is de plannings- en rapporttool van Blitz Power voor service aan laadpalen. Je kan enkel lezen.',
  'Rapporten zijn interventie- en installatierapporten van techniekers (actief + jaararchieven); open tickets komen uit een momentopname van Zoho Desk (veld momentopname = tijdstip); planning = tickets met een interventiedatum en handmatige afspraken.',
  `De oorzaak van een storing komt uit een vaste lijst (${OORZAAK_LABELS.join(', ')}; oude rapporten kunnen nog Productfout of Configuratiefout hebben) en is dus betrouwbaar om te tellen.`,
  'Probleem en acties zijn vrije tekst: lees ze, maar tel er niet op. Serienummers worden genormaliseerd (spaties weg, hoofdletters).',
  'Je ziet enkel wat de gekoppelde gebruiker in de tool mag zien (een technieker enkel zijn eigen rapporten en planning). Antwoorden zijn afgekapt op 200 items (afgekapt: true, totaal).',
].join('\n');

// ---------- JSON-RPC ----------
const antwoord = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcFout = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const geldigId = id => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
const isObject = o => !!o && typeof o === 'object' && !Array.isArray(o);
const magLezen = gebruiker => LEESROLLEN.has(gebruiker?.rol);

// Eén JSON-RPC-bericht. null = geen antwoord (notificatie, of een antwoord van de client).
export async function behandelRpc(bericht, { gebruiker, bronnen } = {}) {
  if (!isObject(bericht) || bericht.jsonrpc !== '2.0') return rpcFout(null, -32600, 'Invalid Request');
  const heeftId = Object.hasOwn(bericht, 'id');
  if (!Object.hasOwn(bericht, 'method')) {
    // Een antwoord van de client op een verzoek van ons (wij sturen er nooit): negeren.
    if (Object.hasOwn(bericht, 'result') || Object.hasOwn(bericht, 'error')) return null;
    return rpcFout(heeftId && geldigId(bericht.id) ? bericht.id : null, -32600, 'Invalid Request');
  }
  if (typeof bericht.method !== 'string') return rpcFout(heeftId && geldigId(bericht.id) ? bericht.id : null, -32600, 'Invalid Request');
  if (heeftId && !geldigId(bericht.id)) return rpcFout(null, -32600, 'Invalid Request');
  if (!heeftId) return null; // notificatie (notifications/initialized, notifications/cancelled, ...): nooit een antwoord

  const id = bericht.id;
  const params = isObject(bericht.params) ? bericht.params : {};
  switch (bericht.method) {
    case 'initialize': {
      const gevraagd = params.protocolVersion;
      return antwoord(id, {
        protocolVersion: PROTOCOL_VERSIES.includes(gevraagd) ? gevraagd : STANDAARD_VERSIE,
        capabilities: { tools: {} },
        serverInfo: { name: 'blitz-planning', version: pkg.version },
        instructions: INSTRUCTIES,
      });
    }
    case 'ping':
      return antwoord(id, {});
    case 'tools/list':
      return antwoord(id, { tools: magLezen(gebruiker) ? GEREEDSCHAPPEN.map(({ uitvoer, ...def }) => def) : [] });
    case 'tools/call': {
      if (!magLezen(gebruiker)) return rpcFout(id, -32601, 'Method not found');
      const g = GEREEDSCHAPPEN.find(t => t.name === params.name);
      if (!g) return rpcFout(id, -32602, 'Onbekend gereedschap.');
      return antwoord(id, await voerUit(g, params.arguments, gebruiker, bronnen));
    }
    default:
      return rpcFout(id, -32601, 'Method not found');
  }
}

// ---------- gereedschap-uitvoer ----------
class InvoerFout extends Error {}

const gelukt = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
const mislukt = tekst => ({ isError: true, content: [{ type: 'text', text: tekst }] });

async function voerUit(g, args, gebruiker, bronnen) {
  try {
    if (args !== undefined && args !== null && !isObject(args)) throw new InvoerFout('De argumenten moeten een object zijn.');
    return await g.uitvoer(args ?? {}, { gebruiker, store: bronnen.store, nu: bronnen.nu instanceof Date ? bronnen.nu : new Date() });
  } catch (e) {
    if (e instanceof InvoerFout) return mislukt(e.message);
    console.error(`mcp: gereedschap ${g.name} mislukt (${e?.name || 'Error'})`);
    return mislukt('Er ging iets mis bij het lezen van de gegevens. Probeer het zo meteen opnieuw.');
  }
}

// ---------- invoer ----------
function tekstArg(args, sleutel, { verplicht = false } = {}) {
  const w = args[sleutel];
  if (w === undefined || w === null || w === '') {
    if (verplicht) throw new InvoerFout(`${sleutel} is verplicht.`);
    return undefined;
  }
  if (typeof w !== 'string') throw new InvoerFout(`${sleutel} moet tekst zijn.`);
  if (w.length > MAX_TEKST) throw new InvoerFout(`${sleutel} is te lang.`);
  const t = w.trim();
  if (verplicht && !t) throw new InvoerFout(`${sleutel} is verplicht.`);
  return t || undefined;
}

const DATUM_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function geldigeDatum(t) {
  const m = DATUM_RE.exec(t);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
function periodeArg(args) {
  const van = tekstArg(args, 'van');
  const tot = tekstArg(args, 'tot');
  for (const [k, w] of [['van', van], ['tot', tot]]) {
    if (w !== undefined && !geldigeDatum(w)) throw new InvoerFout(`${k} moet een datum zijn in de vorm JJJJ-MM-DD.`);
  }
  if (van && tot && van > tot) throw new InvoerFout('van ligt na tot.');
  return { van, tot };
}

const RAPPORTFILTERS = ['serienummer', 'ticketNumber', 'technieker', 'oorzaak', 'interventieType', 'hersteld', 'tekst'];
function filtersArg(args) {
  const f = periodeArg(args);
  for (const k of RAPPORTFILTERS) f[k] = tekstArg(args, k);
  return Object.fromEntries(Object.entries(f).filter(([, w]) => w !== undefined));
}

function getalArg(args, sleutel, { min, max }) {
  const w = args[sleutel];
  if (w === undefined || w === null) return undefined;
  if (typeof w !== 'number' || !Number.isInteger(w) || w < min || w > max) {
    throw new InvoerFout(`${sleutel} moet een geheel getal zijn van ${min} tot ${max}.`);
  }
  return w;
}

// ---------- rapporten (rechten vóór de data-functie) ----------
async function eigenRapporten({ store, gebruiker, nu }, periode = {}) {
  const { rapporten, ontbrekendeJaren } = await laadRapporten(store, periode, { nu });
  return { rapporten: filterRapportenVoor(gebruiker, rapporten), ontbrekendeJaren };
}

function metWaarschuwing(data, ontbrekendeJaren) {
  if (!ontbrekendeJaren?.length) return data;
  return {
    ...data,
    ontbrekendeJaren,
    waarschuwing: `Let op: het rapportarchief van ${ontbrekendeJaren.join(', ')} kon niet gelezen worden; resultaten en tellingen zijn onvolledig.`,
  };
}

function kap(lijst, { laatste = false } = {}) {
  const totaal = lijst.length;
  const afgekapt = totaal > MAX_RESULTATEN;
  const deel = afgekapt ? (laatste ? lijst.slice(-MAX_RESULTATEN) : lijst.slice(0, MAX_RESULTATEN)) : lijst;
  return { deel, totaal, afgekapt };
}

async function rapportenZoeken(args, ctx) {
  const filters = filtersArg(args);
  const limiet = getalArg(args, 'limiet', { min: 1, max: MAX_RESULTATEN }) ?? MAX_RESULTATEN;
  const { rapporten, ontbrekendeJaren } = await eigenRapporten(ctx, { van: filters.van, tot: filters.tot });
  return gelukt(metWaarschuwing(zoekRapporten(rapporten, filters, { limiet }), ontbrekendeJaren));
}

async function rapportLezen(args, ctx) {
  const id = tekstArg(args, 'id', { verplicht: true });
  const { rapporten, ontbrekendeJaren } = await eigenRapporten(ctx);
  const gevonden = rapporten.find(r => r && String(r.id ?? '') === id);
  // Zelfde tekst voor een onbekend id en een rapport van een collega: verraadt niet dat het bestaat.
  if (!gevonden) {
    const extra = ontbrekendeJaren.length ? ` (let op: het archief van ${ontbrekendeJaren.join(', ')} kon niet gelezen worden)` : '';
    return mislukt(`Rapport niet gevonden${extra}.`);
  }
  return gelukt(metWaarschuwing({ rapport: vlakRapport(gevonden) }, ontbrekendeJaren));
}

async function rapportenTellen(args, ctx) {
  const groepeer = tekstArg(args, 'groepeer', { verplicht: true });
  if (!GROEPERINGEN.includes(groepeer)) throw new InvoerFout(`groepeer moet een van deze zijn: ${GROEPERINGEN.join(', ')}.`);
  const minimum = getalArg(args, 'minimum', { min: 1, max: 1_000_000 }) ?? 1;
  const filters = filtersArg(args);
  const { rapporten, ontbrekendeJaren } = await eigenRapporten(ctx, { van: filters.van, tot: filters.tot });
  const { groepen, totaalRapporten } = telRapporten(rapporten, { ...filters, groepeer, minimum });
  const { deel, totaal, afgekapt } = kap(groepen);
  return gelukt(metWaarschuwing({ groeperingOp: groepeer, groepen: deel, totaalGroepen: totaal, afgekapt, totaalRapporten }, ontbrekendeJaren));
}

async function paalHistoriekLezen(args, ctx) {
  const serienummer = tekstArg(args, 'serienummer', { verplicht: true });
  if (!normSerie(serienummer)) throw new InvoerFout('serienummer is verplicht.');
  const { rapporten, ontbrekendeJaren } = await eigenRapporten(ctx);
  const h = paalHistoriek(rapporten, serienummer);
  const { deel, totaal, afgekapt } = kap(h.bezoeken, { laatste: true }); // oud -> nieuw: bij afkappen de nieuwste houden
  return gelukt(metWaarschuwing({ serienummer: h.serienummer, bezoeken: deel, totaalBezoeken: totaal, afgekapt, oorzaken: h.oorzaken }, ontbrekendeJaren));
}

// ---------- tickets (enkel de bewaarde momentopname) ----------
const klein = v => String(v ?? '').trim().toLowerCase();
const LIJSTEN = [['tickets', 'in te plannen'], ['pendingTickets', 'wacht op bevestiging'], ['plannedTickets', 'gepland']];
const GEEN_TICKETS = 'Geen ticketgegevens beschikbaar (de momentopname van Zoho Desk ontbreekt). Probeer het later opnieuw.';

async function leesSnapshot(store) {
  const s = await store.get(SNAPSHOT_SLEUTEL, { type: 'json' });
  return geldigeSnapshot(s) ? s : null;
}

const alleTickets = s => LIJSTEN.flatMap(([sleutel, lijst]) => s[sleutel].filter(isObject).map(t => ({ ...t, lijst })));

async function ticketsOpen(args, { store }) {
  const serienummer = tekstArg(args, 'serienummer');
  const status = tekstArg(args, 'status');
  const tekst = tekstArg(args, 'tekst');
  const s = await leesSnapshot(store);
  if (!s) return mislukt(GEEN_TICKETS);
  // Technieker: GET /api/tickets filtert niet per gebruiker (tickets.js, rechten.js 'tickets': INTERN), dus hier ook niet.
  let lijst = alleTickets(s);
  if (serienummer) lijst = lijst.filter(t => normSerie(t.serienummer) === normSerie(serienummer));
  if (status) lijst = lijst.filter(t => klein(t.status) === klein(status) || klein(t.lijst) === klein(status));
  if (tekst) {
    const n = klein(tekst);
    const velden = ['number', 'subject', 'contact', 'account', 'address', 'naamEindklant', 'serienummer', 'probleemtype', 'partner', 'assignee', 'regio'];
    lijst = lijst.filter(t => velden.some(v => klein(t[v]).includes(n)));
  }
  const { deel, totaal, afgekapt } = kap(lijst);
  return gelukt({ momentopname: new Date(s.op).toISOString(), tickets: deel, totaal, afgekapt });
}

// ---------- planning ----------
const BRUSSEL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function brussel(dt) {
  const p = Object.fromEntries(BRUSSEL.formatToParts(dt).map(x => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, uur: `${p.hour}:${p.minute}` };
}
function plusDagen(datum, n) {
  const [j, m, d] = datum.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d + n, 12));
  return dt.toISOString().slice(0, 10);
}
const dagenTussen = (van, tot) => Math.round((Date.parse(tot + 'T12:00:00Z') - Date.parse(van + 'T12:00:00Z')) / 86_400_000);

function voorstelVan(entry) {
  if (!isObject(entry)) return undefined;
  const v = {};
  const verstuurdNaar = ['contact', 'klant', 'installateur'].filter(k => entry[k] !== undefined && entry[k] !== null);
  if (verstuurdNaar.length) v.verstuurdNaar = verstuurdNaar;
  for (const k of ['tijdslot', 'tijdslotDatum', 'bevestigd', 'afgewezen', 'herinnering']) if (entry[k] !== undefined) v[k] = entry[k];
  return Object.keys(v).length ? v : undefined;
}

function ticketItem(t, register) {
  if (!t.interventieDatum) return null;
  const dt = new Date(t.interventieDatum);
  if (Number.isNaN(dt.getTime())) return null;
  const { datum, uur } = brussel(dt);
  const item = {
    soort: 'ticket', id: String(t.id ?? ''), ticketnummer: t.number ?? null, datum,
    uur: uur === '00:00' ? null : uur, // middernacht = ingepland zonder uur (zoals de kalender en planning-export)
    technieker: t.assignee || null, status: t.status || null, lijst: t.lijst,
    klant: t.account || t.naamEindklant || t.contact || null, contact: t.contact || null, telefoon: t.phone || t.telefoonEindklant || null,
    adres: t.address || null, onderwerp: t.subject || null, serienummer: t.serienummer || null, probleemtype: t.probleemtype || null,
  };
  const voorstel = voorstelVan(register.status?.[item.id]);
  if (voorstel) item.voorstel = voorstel;
  return item;
}

function afspraakItem(a) {
  if (!isObject(a) || typeof a.datum !== 'string') return null;
  return {
    soort: 'afspraak', id: String(a.id ?? ''), titel: a.titel || null, datum: a.datum, uur: a.uur || null, einduur: a.einduur || null,
    type: a.type || null, technieker: a.persoon || null, adres: a.adres || null, notitie: a.notitie || null,
    telefoon: a.telefoon || null, email: a.email || null,
  };
}

async function planningLezen(args, { gebruiker, store, nu }) {
  let { van, tot } = periodeArg(args);
  const technieker = tekstArg(args, 'technieker');
  van ??= tot ? plusDagen(tot, -(PLANNING_STANDAARD_DAGEN - 1)) : brussel(nu).datum;
  tot ??= plusDagen(van, PLANNING_STANDAARD_DAGEN - 1);
  if (dagenTussen(van, tot) >= PLANNING_MAX_DAGEN) throw new InvoerFout(`De periode mag hoogstens ${PLANNING_MAX_DAGEN} dagen zijn.`);

  const [afsprakenBlob, register, snapshot] = await Promise.all([
    store.get('afspraken', { type: 'json' }), leesRegister(store), leesSnapshot(store),
  ]);
  const afspraken = Array.isArray(afsprakenBlob?.afspraken) ? afsprakenBlob.afspraken : [];
  let items = [
    ...(snapshot ? alleTickets(snapshot).map(t => ticketItem(t, register)) : []),
    ...afspraken.map(afspraakItem),
  ].filter(i => i && i.datum >= van && i.datum <= tot);
  // Technieker: enkel items op zijn eigen naam (ook geen afspraken zonder persoon). Planner/beheerder: alles.
  if (gebruiker?.rol === 'technieker') items = items.filter(i => isEigenNaam(gebruiker, i.technieker));
  if (technieker) items = items.filter(i => klein(i.technieker).includes(klein(technieker)));
  items.sort((a, b) => (a.datum + (a.uur || '')).localeCompare(b.datum + (b.uur || '')) || a.id.localeCompare(b.id));

  const { deel, totaal, afgekapt } = kap(items);
  const data = { van, tot, items: deel, totaal, afgekapt };
  if (snapshot) data.momentopname = new Date(snapshot.op).toISOString();
  else data.waarschuwing = 'Geen ticketgegevens beschikbaar (momentopname ontbreekt): enkel handmatige afspraken, geen ingeplande tickets.';
  return gelukt(data);
}

// ---------- definities ----------
const s = (description, extra = {}) => ({ type: 'string', description, ...extra });
const PERIODE = {
  van: s('Vanaf deze datum (JJJJ-MM-DD), inclusief.'),
  tot: s('Tot en met deze datum (JJJJ-MM-DD).'),
};
const FILTERS = {
  ...PERIODE,
  serienummer: s('Serienummer van de laadpaal; spaties en hoofdletters maken niet uit.'),
  ticketNumber: s('Zoho-ticketnummer.'),
  technieker: s('Naam (of een deel ervan) van de technieker.'),
  oorzaak: s(`Oorzaak van de storing, exact een waarde uit de vaste lijst: ${OORZAAK_LABELS.join(', ')}.`),
  interventieType: s('Type bezoek: Interventie of Installatie.'),
  hersteld: s('Definitief hersteld: ja of nee.'),
  tekst: s('Zoekt (hoofdletterongevoelig) in probleem, acties, klant en adres.'),
};
const LEZEN = { readOnlyHint: true };

const GEREEDSCHAPPEN = [
  {
    name: 'rapporten_zoeken',
    title: 'Rapporten zoeken',
    description: 'Zoekt interventie- en installatierapporten (nieuwste eerst) op periode, serienummer, ticket, technieker, oorzaak, type bezoek, hersteld of tekst. Hoogstens 200 resultaten (afgekapt, totaal).',
    inputSchema: { type: 'object', properties: { ...FILTERS, limiet: { type: 'integer', minimum: 1, maximum: MAX_RESULTATEN, description: 'Maximum aantal resultaten (standaard 200).' } } },
    annotations: LEZEN,
    uitvoer: rapportenZoeken,
  },
  {
    name: 'rapport_lezen',
    title: 'Rapport lezen',
    description: 'Eén rapport volledig (zonder foto\'s en handtekeningen), op id (uit rapporten_zoeken).',
    inputSchema: { type: 'object', properties: { id: s('Id van het rapport.') }, required: ['id'] },
    annotations: LEZEN,
    uitvoer: rapportLezen,
  },
  {
    name: 'rapporten_tellen',
    title: 'Rapporten tellen',
    description: 'Telt rapporten per oorzaak, serienummer, technieker, maand, klant of type bezoek (aflopend), met dezelfde filters als rapporten_zoeken. Een rapport met twee oorzaken telt in beide. minimum: enkel groepen met minstens zoveel rapporten (bv. palen met 3 of meer bezoeken).',
    inputSchema: {
      type: 'object',
      properties: {
        groepeer: { type: 'string', enum: [...GROEPERINGEN], description: 'Waarop groeperen.' },
        minimum: { type: 'integer', minimum: 1, description: 'Enkel groepen met minstens zoveel rapporten (standaard 1).' },
        ...FILTERS,
      },
      required: ['groepeer'],
    },
    annotations: LEZEN,
    uitvoer: rapportenTellen,
  },
  {
    name: 'paal_historiek',
    title: 'Historiek van een laadpaal',
    description: 'Alle bezoeken (oud naar nieuw) en de oorzaken voor één serienummer.',
    inputSchema: { type: 'object', properties: { serienummer: s('Serienummer van de laadpaal; spaties en hoofdletters maken niet uit.') }, required: ['serienummer'] },
    annotations: LEZEN,
    uitvoer: paalHistoriekLezen,
  },
  {
    name: 'tickets_open',
    title: 'Open tickets',
    description: 'Huidige open servicetickets uit Zoho Desk (in te plannen, wacht op bevestiging, gepland), met serienummer en probleemtype. Uit de laatste momentopname (veld momentopname).',
    inputSchema: {
      type: 'object',
      properties: {
        serienummer: s('Serienummer van de laadpaal.'),
        status: s('Zoho-status (Service in te plannen, Wachten op planning, Wachten op bevestiging planning, Geplande service, Geplande support) of lijst (in te plannen, wacht op bevestiging, gepland).'),
        tekst: s('Zoekt (hoofdletterongevoelig) in nummer, onderwerp, klant, adres, serienummer, probleemtype, installateur, technieker en regio.'),
      },
    },
    annotations: LEZEN,
    uitvoer: ticketsOpen,
  },
  {
    name: 'planning_lezen',
    title: 'Planning lezen',
    description: 'Ingeplande tickets (met voorstel- en bevestigingsstatus) en handmatige afspraken per dag, in Brusselse tijd. Zonder periode: vandaag en de 13 dagen erna; hoogstens 366 dagen.',
    inputSchema: { type: 'object', properties: { ...PERIODE, technieker: s('Naam (of een deel ervan) van de technieker.') } },
    annotations: LEZEN,
    uitvoer: planningLezen,
  },
];
