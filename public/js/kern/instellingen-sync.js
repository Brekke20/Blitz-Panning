// kern/instellingen-sync.js — instellingen komen van de server; localStorage (settingsKey) blijft de snelle, synchrone cache
// zodat loadPersonSettings ongewijzigd werkt (logins T16). Raakt geen `window` aan: opslag en api worden meegegeven.
//
// Stroom: bij de start (na de login, vóór opstart) haalt `synchroniseerInstellingen` het overzicht op en zet de serverwaarden in de
// cache; `savePersonSettings` (schermen/instellingen.js) schrijft lokaal én roept `bewaarOpServer` aan.
//
// Een gedeeld toestel: de cache hoort bij één gebruiker (marker `blitz_instellingen_eigenaar`). Hoort ze bij een ANDERE gebruiker,
// dan wordt ze gewist vóór er iets gebeurt (ook zonder verbinding): de lokale waarde van een ander gaat nooit omhoog als de mijne.
// Zonder marker (vóór deze versie of net gewist) geldt de lokale waarde als de mijne en gaat ze eenmalig omhoog als de server nog
// niets van mij heeft. Op een planner-/beheerdertoestel gaan ook de lokaal bewaarde waarden van een TECHNIEKER eenmalig omhoog als de
// server voor die technieker nog niets heeft (eindreview I3); heeft de server wel waarden, dan wint de server.
//
// Vuil-markering (`blitz_instellingen_vuil` = { [persoon]: true }): een PUT die niet lukte door een netwerk- of opslagprobleem.
// De volgende synchronisatie laadt voor zo'n persoon EERST de lokale waarde op; pas als dat lukt (of de server het definitief
// weigert) mag er weer iets van de server in de cache komen. Zo gaat een offline gemaakte wijziging nooit stil verloren.
// De markering wordt VÓÓR de PUT gezet (write-ahead) en na een geslaagde of definitief geweigerde PUT gewist: sluit de app midden
// in de PUT, dan blijft het spoor staan.
//
// Tijdsbudget: de app start pas na de synchronisatie; daarom loopt ze in totaal maximaal SYNC_BUDGET_MS. Daarna keert ze terug en
// schrijft ze niets meer (ook niet als een late fetch later nog antwoordt): de app start met de lokale cache.
import { apiJson as standaardApiJson, apiVerzoek as standaardApiVerzoek } from './api.js';
import { settingsKey } from '../schermen/instellingen-logica.js';

export const MARKER_SLEUTEL = 'blitz_instellingen_eigenaar';
export const VUIL_SLEUTEL = 'blitz_instellingen_vuil';
export const SYNC_BUDGET_MS = 7000;
export const OPSTART_TOTAAL_MS = 8000; // auth-ik (≤ 5 s met cache) + synchronisatie samen (eindreview I2)
export const MIN_SYNC_BUDGET_MS = 1000;
// Het budget dat nog over is voor de synchronisatie als de opstart al `netwerkMs` op auth-ik wachtte.
export function resterendSyncBudget(netwerkMs) {
  const rest = OPSTART_TOTAAL_MS - (Number.isFinite(netwerkMs) && netwerkMs > 0 ? netwerkMs : 0);
  return Math.max(MIN_SYNC_BUDGET_MS, Math.min(SYNC_BUDGET_MS, rest));
}
const LAATSTE_START_SLEUTEL = 'blitz_laatste_start';
const SETTINGS_VOORVOEGSEL = 'blitz_settings';
const PAD = '/api/instellingen';
const STOP = Symbol('instellingen-sync-stop');

const isObject = b => Boolean(b) && typeof b === 'object' && !Array.isArray(b);
const isTijd = v => /^\d{2}:\d{2}$/.test(v || '');

// De overzicht-cache van de laatste geslaagde synchronisatie: wie ik ben en welk gebruikerId bij welke technieker hoort.
// null = nog niet (of niet meer) geladen.
let overzichtCache = null; // { eigenId, eigenPersoon, techniekers: { [zohoNaam]: gebruikerId } }

// ── opslag-hulp (nooit gooien: geen opslag of vol is niet fataal) ──
const leesTekst = (opslag, k) => { try { return opslag?.getItem(k) ?? null; } catch { return null; } };
const schrijfTekst = (opslag, k, v) => { try { opslag?.setItem(k, v); } catch { /* geen opslag of vol */ } };
const verwijder = (opslag, k) => { try { opslag?.removeItem(k); } catch { /* geen opslag */ } };
function leesJson(opslag, k) {
  const t = leesTekst(opslag, k);
  if (t === null) return null;
  try { const w = JSON.parse(t); return isObject(w) ? w : null; } catch { return null; }
}
function sleutelsMet(opslag, voorvoegsel) {
  const lijst = [];
  try {
    if (typeof opslag?.length === 'number' && typeof opslag.key === 'function') {
      for (let i = 0; i < opslag.length; i++) { const k = opslag.key(i); if (typeof k === 'string' && k.startsWith(voorvoegsel)) lijst.push(k); }
    } else {
      for (const k of Object.keys(opslag || {})) if (k.startsWith(voorvoegsel)) lijst.push(k);
    }
  } catch { /* geen opslag */ }
  return lijst;
}

function leesVuil(opslag) { return leesJson(opslag, VUIL_SLEUTEL) ?? {}; }
function zetVuil(opslag, persoon, vuil) {
  const nu = leesVuil(opslag);
  if (vuil) nu[persoon] = true; else delete nu[persoon];
  if (Object.keys(nu).length) schrijfTekst(opslag, VUIL_SLEUTEL, JSON.stringify(nu)); else verwijder(opslag, VUIL_SLEUTEL);
}

// Staat er nog een wijziging die niet naar de server ging? (Voor de waarschuwing bij het afmelden.)
export function heeftVuileInstellingen(opslag = globalThis.localStorage) {
  return Object.keys(leesVuil(opslag)).length > 0;
}

// Alles wat bij de instellingen van een gebruiker hoort (zie wisInstellingenCache): de eigenaar-marker niet.
function wisInstellingen(opslag) {
  for (const k of sleutelsMet(opslag, SETTINGS_VOORVOEGSEL)) verwijder(opslag, k);
  verwijder(opslag, LAATSTE_START_SLEUTEL);
  verwijder(opslag, VUIL_SLEUTEL);
}

// De lokale cache hoort bij een ANDER dan `mijnId`: weg (ook de vuil-markering: nooit als de mijne omhoog) en de marker wordt de mijne,
// zodat een wijziging die ik offline maak bij de volgende synchronisatie niet als "van een ander" wordt gewist. Geeft true bij wissen.
function neemCacheOver(opslag, mijnId) {
  const marker = leesTekst(opslag, MARKER_SLEUTEL);
  if (marker === null || marker === mijnId) return false;
  wisInstellingen(opslag);
  schrijfTekst(opslag, MARKER_SLEUTEL, mijnId);
  return true;
}

// Afmeldhaak (door schermen/rol-schil.js geregistreerd): alle lokale instellingen, de marker en de vuil-markering weg,
// en de overzicht-cache in het geheugen vergeten.
export function wisInstellingenCache(opslag) {
  wisInstellingen(opslag);
  verwijder(opslag, MARKER_SLEUTEL);
  overzichtCache = null;
}

// De persoon van wie de instellingen onder mijn eigen gebruikerId staan: een technieker zijn zohoNaam, anders 'all'.
const eigenPersoonVan = gebruiker => (gebruiker?.rol === 'technieker' && typeof gebruiker.zohoNaam === 'string' && gebruiker.zohoNaam ? gebruiker.zohoNaam : 'all');
// Alle persoonssleutels (settingsKey) die het ÉÉNE serverrecord van mijn account weerspiegelen (merge-review I1). Een planner of beheerder met een
// Zoho-naam ziet zijn eigen werk onder die naam en "Alle" onder 'all': beide lezen en schrijven hetzelfde record (de cache houdt ze gelijk).
// Een technieker: enkel zijn naam; anders enkel 'all'. Sales heeft geen Zoho-naam.
export function eigenSleutels(gebruiker) {
  const naam = typeof gebruiker?.zohoNaam === 'string' ? gebruiker.zohoNaam.trim() : '';
  if (gebruiker?.rol === 'technieker') return [eigenPersoonVan(gebruiker)];
  return naam && gebruiker?.rol !== 'sales' ? ['all', naam] : ['all'];
}
export const isEigen = (persoon, gebruiker) => !persoon || persoon === 'all' || eigenSleutels(gebruiker).includes(persoon);

// Schrijft een eigen record ook onder de andere eigen sleutels (zie eigenSleutels), zodat 'Alle' en de eigen naam nooit uit elkaar lopen.
export function spiegelEigen(persoon, gebruiker, { opslag = globalThis.localStorage } = {}) {
  if (!isEigen(persoon, gebruiker)) return;
  const tekst = leesTekst(opslag, settingsKey(persoon === undefined || persoon === null || persoon === '' ? 'all' : persoon));
  if (tekst === null) return;
  for (const sleutel of eigenSleutels(gebruiker)) {
    if (sleutel !== (persoon || 'all')) schrijfTekst(opslag, settingsKey(sleutel), tekst);
  }
}

// De beheerder bewaarde via de beheerpagina de instellingen van zijn EIGEN account op de server (PUT geslaagd): de lokale cache volgt,
// anders schrijft de volgende savePersonSettings de oude set terug en draait de serverwaarde stil terug (logins T18 fix 1).
// Geeft de persoon terug onder wiens sleutel het bewaard werd ('all' of de zohoNaam van een technieker).
export function neemEigenOver(instellingen, gebruiker, { opslag = globalThis.localStorage } = {}) {
  const persoon = eigenPersoonVan(gebruiker);
  const kopie = JSON.parse(JSON.stringify(instellingen ?? {}));
  for (const sleutel of eigenSleutels(gebruiker)) { // alle eigen sleutels volgen het ene serverrecord (I1)
    schrijfTekst(opslag, settingsKey(sleutel), JSON.stringify(kopie));
    zetVuil(opslag, sleutel, false); // de server heeft nu de nieuwste stand: een eerdere mislukte PUT mag niet meer terugkomen
  }
  if (isTijd(kopie.laatsteStart)) schrijfTekst(opslag, LAATSTE_START_SLEUTEL, kopie.laatsteStart);
  return persoon;
}

// De beheerder bewaarde via de beheerpagina de instellingen van een TECHNIEKER: de lokale cache van die persoon volgt, anders schrijft een
// latere savePersonSettings (bv. routekleur in het toestelvenster) de oude set terug. De globale laatsteStart blijft buiten beeld.
export function neemPersoonOver(persoon, instellingen, { opslag = globalThis.localStorage } = {}) {
  const kopie = JSON.parse(JSON.stringify(instellingen ?? {}));
  delete kopie.laatsteStart;
  schrijfTekst(opslag, settingsKey(persoon), JSON.stringify(kopie));
  zetVuil(opslag, persoon, false);
}

// Het instellingen-object dat omhoog gaat: een kopie; bij de eigen persoon met de globale laatsteStart (blitz_laatste_start),
// bij een ander zonder (het is een instelling van het toestel, niet van die persoon).
function lichaamVoor(persoon, instellingen, gebruiker, opslag) {
  const kopie = { ...instellingen };
  if (!isEigen(persoon, gebruiker)) { delete kopie.laatsteStart; return kopie; }
  const l = leesTekst(opslag, LAATSTE_START_SLEUTEL);
  if (isTijd(l)) kopie.laatsteStart = l;
  return kopie;
}

// I2: de server VERVANGT het hele record van een gebruiker. Voor een ANDERE persoon (technieker) vertrekt de body daarom van het record dat de
// server nu heeft; enkel de velden van de lokale set komen erbovenop. Velden die het formulier niet toont (laatsteStart, bezoekDuurMin, ...)
// en niet in de lokale set staan, blijven zo behouden.
const voegSamenOpServer = (serverRecord, lichaam) => (isObject(serverRecord) ? { ...serverRecord, ...lichaam } : lichaam);

// Eén PUT, geclassificeerd: { ok } of { ok:false, reden }.
//   403 geen-recht · 404 geen-account · 400/422 ongeldig (de server weigert de waarde: opnieuw proberen heeft geen zin)
//   al het andere (geen verbinding, time-out, 5xx, 429, 401 na een mislukte herlogin) is 'netwerk': later opnieuw.
function naarReden(status) {
  if (status === 403) return 'geen-recht';
  if (status === 404) return 'geen-account';
  if (status === 400 || status === 422) return 'ongeldig';
  return 'netwerk';
}
async function stuur(verstuur, lichaam) {
  try {
    const r = await verstuur(lichaam);
    if (r?.ok) return { ok: true };
    return { ok: false, reden: naarReden(r?.status) };
  } catch (fout) {
    return { ok: false, reden: naarReden(typeof fout?.status === 'number' ? fout.status : 0) };
  }
}
// Verwerkt de uitkomst voor de vuil-markering. geen-recht, geen-account en ongeldig zijn definitief: de markering verdwijnt (anders
// blijft de persoon voor altijd vastzitten op een lokale waarde die nooit meer omhoog mag); enkel 'netwerk' laat ze staan.
function verwerkUitkomst(opslag, persoon, r) {
  if (r.ok || r.reden === 'geen-recht' || r.reden === 'geen-account' || r.reden === 'ongeldig') zetVuil(opslag, persoon, false);
  else zetVuil(opslag, persoon, true);
}

// Zoekt het gebruikerId van een technieker in de overzicht-cache (exact, daarna zonder hoofdletters/spaties).
function idVoorTechnieker(naam) {
  const t = overzichtCache?.techniekers || {};
  if (Object.hasOwn(t, naam)) return t[naam];
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const sleutel = Object.keys(t).find(k => norm(k) === norm(naam));
  return sleutel === undefined ? null : t[sleutel];
}

// Geeft true als de synchronisatie volledig liep, false bij een mislukking, een onverwacht antwoord of het verlopen van het budget.
export async function synchroniseerInstellingen(gebruiker, { apiJson = standaardApiJson, opslag = globalThis.localStorage, budgetMs = SYNC_BUDGET_MS } = {}) {
  // Een vreemde marker ook zonder verbinding opruimen: een toestel dat offline start toont nooit de instellingen van een ander.
  if (typeof gebruiker?.id === 'string' && gebruiker.id) neemCacheOver(opslag, gebruiker.id);

  let gestopt = false;
  let timer;
  const stop = new Promise((resolve) => { timer = setTimeout(() => { gestopt = true; resolve(STOP); }, budgetMs); });
  // `gestopt` verandert enkel tijdens een await: na elke wacht volstaat een controle om te garanderen dat er daarna niets meer geschreven wordt.
  const wacht = (belofte) => Promise.race([belofte, stop]);
  try {
    return await voerSynchronisatieUit(gebruiker, apiJson, opslag, wacht, () => gestopt);
  } finally {
    clearTimeout(timer);
  }
}

async function voerSynchronisatieUit(gebruiker, apiJson, opslag, wacht, isGestopt) {
  let overzicht;
  try { overzicht = await wacht(apiJson(`${PAD}?overzicht=1`)); } catch { return false; } // geen verbinding of 503: de app start met de lokale cache
  if (isGestopt() || !isObject(overzicht) || !isObject(overzicht.eigen)) return false;

  const mijnId = typeof gebruiker?.id === 'string' && gebruiker.id ? gebruiker.id : overzicht.eigen.gebruikerId;
  if (typeof mijnId !== 'string' || !mijnId) return false;
  neemCacheOver(opslag, mijnId);

  const eigenPersoon = eigenPersoonVan(gebruiker);
  const techniekers = isObject(overzicht.techniekers) ? overzicht.techniekers : {};
  overzichtCache = { eigenId: mijnId, eigenPersoon, techniekers: {} };
  for (const [naam, t] of Object.entries(techniekers)) {
    if (isObject(t) && typeof t.gebruikerId === 'string') overzichtCache.techniekers[naam] = t.gebruikerId;
  }

  const verstuur = lichaam => apiJson(PAD, { methode: 'PUT', body: lichaam }).then(() => ({ ok: true }), (f) => ({ ok: false, status: f?.status }));
  // Wie staat er in het overzicht: ik (eigenPersoon) en de techniekers (een technieker staat er ook zelf in; dubbel overslaan).
  // Mijn ene serverrecord staat onder alle sleutels van eigenSleutels (planner/beheerder met Zoho-naam: 'all' én de naam, I1).
  const eigenKeys = eigenSleutels(gebruiker);
  const eigenServer = isObject(overzicht.eigen.instellingen) ? overzicht.eigen.instellingen : null;
  const personen = eigenKeys.map(persoon => ({ persoon, id: mijnId, server: eigenServer, eigen: true }));
  for (const [naam, t] of Object.entries(techniekers)) {
    if (eigenKeys.includes(naam) || !isObject(t) || typeof t.gebruikerId !== 'string') continue;
    personen.push({ persoon: naam, id: t.gebruikerId, server: isObject(t.instellingen) ? t.instellingen : null, eigen: false });
  }

  // Een vuile persoon die niet (meer) in het overzicht staat (account verwijderd) kan nooit meer omhoog: de markering weg.
  const vuil = leesVuil(opslag);
  const bekend = new Set(personen.map(p => p.persoon));
  for (const persoon of Object.keys(vuil)) if (!bekend.has(persoon)) { zetVuil(opslag, persoon, false); delete vuil[persoon]; }

  // Ronde 1: mislukte PUT's van vroeger. Eerst ALLE vuile lokale waarden omhoog, vóór er iets van de server in de opslag komt;
  // enkel bij succes of een definitieve weigering mag de server voor die persoon weer winnen.
  const blijftLokaal = new Set();
  let eigenOpgeladen = false; // mijn ene record gaat hooguit één keer omhoog, ook als twee eigen sleutels vuil zijn
  for (const { persoon, id, server, eigen } of personen) {
    if (vuil[persoon] !== true) continue;
    const lokaal = leesJson(opslag, settingsKey(persoon));
    if (!lokaal) { zetVuil(opslag, persoon, false); continue; } // niets (meer) om op te laden
    if (eigen && eigenOpgeladen) { zetVuil(opslag, persoon, false); continue; } // de eerste eigen sleutel regelde het record
    // I2: een technieker die ik beheer: de body vertrekt van het serverrecord uit het overzicht, zodat velden buiten de lokale set niet verdwijnen.
    const lichaam = eigen ? lichaamVoor(persoon, lokaal, gebruiker, opslag) : voegSamenOpServer(server, lichaamVoor(persoon, lokaal, gebruiker, opslag));
    const r = await wacht(stuur(verstuur, { ...(eigen ? {} : { gebruiker: id }), instellingen: lichaam }));
    if (isGestopt()) return false;
    verwerkUitkomst(opslag, persoon, r);
    if (r.ok || r.reden === 'netwerk') {
      blijftLokaal.add(persoon); // gelukt: lokaal = server; netwerk: lokaal blijft staan, niets overschrijven
      if (eigen) { // de andere eigen sleutels volgen dit record
        eigenOpgeladen = true;
        spiegelEigen(persoon, gebruiker, { opslag });
        for (const k of eigenKeys) { blijftLokaal.add(k); if (k !== persoon && r.ok) zetVuil(opslag, k, false); }
      }
    }
  }
  // Ronde 2: de server is de bron; of, voor mij, de eenmalige overgang van een lokale waarde.
  const magTechniekerSchrijven = gebruiker?.rol === 'planner' || gebruiker?.rol === 'beheerder';
  let eigenMigratieGedaan = false;
  for (const { persoon, id, server, eigen } of personen) {
    if (blijftLokaal.has(persoon)) continue;
    const sleutel = settingsKey(persoon);
    if (server) {
      schrijfTekst(opslag, sleutel, JSON.stringify(server));
      if (eigen && isTijd(server.laatsteStart)) schrijfTekst(opslag, LAATSTE_START_SLEUTEL, server.laatsteStart);
    } else if (eigen) {
      // De server heeft nog niets van mij maar lokaal staat er iets (en het is het mijne: een andere eigenaar is al gewist).
      const lokaal = leesJson(opslag, sleutel);
      if (lokaal && Object.keys(lokaal).length && !eigenMigratieGedaan) {
        eigenMigratieGedaan = true; // één PUT voor mijn ene record; de andere eigen sleutels volgen het
        await wacht(stuur(verstuur, { instellingen: lichaamVoor(persoon, lokaal, gebruiker, opslag) })); // mislukt: volgende start opnieuw
        if (isGestopt()) return false;
        spiegelEigen(persoon, gebruiker, { opslag });
      }
    } else if (magTechniekerSchrijven) {
      // Migratie (eindreview I3): de waarden die de planner vóór de release op ZIJN toestel per technieker instelde gaan eenmalig omhoog
      // als de server voor die technieker nog niets heeft. Heeft de server wel waarden, dan wint de server (hierboven). Na een gelukte
      // PUT heeft de server waarden en gebeurt dit nooit meer; mislukt hij, dan volgt een nieuwe poging bij de volgende start.
      const lokaal = leesJson(opslag, sleutel);
      if (lokaal && Object.keys(lokaal).length) {
        await wacht(stuur(verstuur, { gebruiker: id, instellingen: lichaamVoor(persoon, lokaal, gebruiker, opslag) }));
        if (isGestopt()) return false;
      }
    }
  }
  schrijfTekst(opslag, MARKER_SLEUTEL, mijnId);
  return true;
}

// Bewaart de instellingen van `persoon` op de server. Faalt nooit hard: geeft { ok } of { ok:false, reden } terug.
// Per persoon na elkaar (een promise-keten): twee snelle opslagen geven geen PUT's die in de verkeerde volgorde aankomen; een PUT die
// moest wachten stuurt de dan actuele waarde uit de opslag (de nieuwste lokale stand), niet de waarde van het moment van de aanroep.
const ketens = new Map(); // persoon -> laatste (nooit falende) belofte
export function bewaarOpServer(persoon, instellingen, gebruiker, opties = {}) {
  const sleutel = String(persoon ?? 'all');
  const kopie = JSON.parse(JSON.stringify(instellingen ?? {}));
  const wachtend = ketens.has(sleutel);
  const taak = (ketens.get(sleutel) ?? Promise.resolve()).then(() => bewaar(persoon, kopie, gebruiker, opties, wachtend));
  const staart = taak.then(() => {}, () => {});
  ketens.set(sleutel, staart);
  staart.then(() => { if (ketens.get(sleutel) === staart) ketens.delete(sleutel); });
  return taak;
}

// opties.velden (optioneel, enkel voor een ANDERE persoon): bewaar enkel deze velden uit de lokale set; de rest blijft zoals de server het heeft
// (merge-review M4: de beheerder wijzigt in ⚙ enkel de persoonlijke velden en overschrijft de werkwaarden niet met een oude lokale kopie).
async function bewaar(persoon, instellingen, gebruiker, { apiVerzoek = standaardApiVerzoek, opslag = globalThis.localStorage, velden }, wachtend) {
  const eigen = isEigen(persoon, gebruiker);
  let doelId = null;
  if (eigen) doelId = gebruiker?.id ?? overzichtCache?.eigenId ?? null;
  else if (overzichtCache) doelId = idVoorTechnieker(persoon);
  else { // overzicht nog niet geladen (offline start): later opladen via de vuil-markering
    zetVuil(opslag, persoon, true);
    return { ok: false, reden: 'netwerk' };
  }
  if (!doelId) return { ok: false, reden: 'geen-account' };

  const actueel = wachtend ? (leesJson(opslag, settingsKey(persoon)) ?? instellingen) : instellingen;
  zetVuil(opslag, persoon, true); // write-ahead: sluit de app midden in de PUT, dan blijft dit spoor staan
  let lichaam = lichaamVoor(persoon, actueel, gebruiker, opslag);
  if (!eigen) {
    // I2: eerst het actuele serverrecord van die technieker ophalen (het overzicht mag ook de planner lezen) en de lokale velden daarop leggen.
    let vers;
    try { vers = await apiVerzoek(`${PAD}?overzicht=1`); } catch (fout) { vers = { ok: false, status: typeof fout?.status === 'number' ? fout.status : 0 }; }
    if (!vers?.ok) {
      const mislukt = { ok: false, reden: naarReden(vers?.status) };
      verwerkUitkomst(opslag, persoon, mislukt);
      return mislukt;
    }
    const serverRecord = vers.data?.techniekers?.[persoon]?.instellingen
      ?? Object.entries(vers.data?.techniekers ?? {}).find(([, t]) => t?.gebruikerId === doelId)?.[1]?.instellingen ?? null;
    if (Array.isArray(velden)) lichaam = Object.fromEntries(Object.entries(lichaam).filter(([k]) => velden.includes(k)));
    lichaam = voegSamenOpServer(serverRecord, lichaam);
  }
  const r = await stuur(lichaam2 => apiVerzoek(PAD, { methode: 'PUT', body: lichaam2 }), { ...(eigen ? {} : { gebruiker: doelId }), instellingen: lichaam });
  verwerkUitkomst(opslag, persoon, r);
  return r;
}
