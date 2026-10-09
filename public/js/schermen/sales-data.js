// schermen/sales-data.js — client-gegevenslaag van de sales-schermen: de ENIGE bron van sales-kalender, -route, -lijst en -detail.
// Eigen, kleine module-privé toestand en abonneelijst: kern/toestand.js en de tickets komen er nooit in, en er is geen import van
// kern/sessie.js (dan blijft de laag in node testbaar). De laag past geen domeinregels toe: ze stuurt enkel `velden`; de server is de grens.
// Een 401 en de X-Blitz-header handelt de fetch-omhulling van logins af; deze laag doet er niets mee.
//
// onSalesWijziging(fn): fn krijgt een detailobject (mag genegeerd worden):
//   { soort: 'toestand' }                                              gewone wijziging van de toestand
//   { soort: 'verwijderd', ok: true, leadId }                          uitgestelde verwijdering geslaagd
//   { soort: 'verwijder-mislukt', ok: false, leadId, reden, status? }  de lead staat weer in de weergave (reden: 'http'|'netwerk'|'opslag')

import { apiVerzoek } from '../kern/api.js';
import { localISO } from '../kern/tijd.js';
import { standaardLaatsteStart } from '../kern/instellingen-regels.js';

export const SALES_STANDAARD = Object.freeze({ vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00', werkdagen: Object.freeze([1, 2, 3, 4, 5]), bezoekDuurMin: 60 });
// Standaardwaarden + bewaarde waarden; een bewaarde null/undefined overschrijft de standaard niet; `werkdagen` is altijd een eigen kopie.
function voegSamen(ruw) {
  const o = Object.fromEntries(Object.entries(ruw).filter(([, w]) => w != null));
  const r = { ...SALES_STANDAARD, ...o };
  r.werkdagen = [...r.werkdagen];
  // Zonder eigen laatste start geldt min(16:00, eindtijd): werkuren die vóór 16:00 eindigen krijgen geen onmogelijke standaard.
  if (o.laatsteStart == null) r.laatsteStart = standaardLaatsteStart(r.vanTijd, r.totTijd);
  return r;
}
const WACHT_MS = 5000;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

// ---- module-privé toestand ----

const nieuweToestand = () => ({
  gebruikerId: null, versie: 0, leads: [], blokken: [],
  // instellingenGeladen: de instellingen hieronder komen echt van de server, voor het doel `instellingenDoel` (gebruikerId of null = eigen).
  // Zonder die vlag zijn het enkel standaarden (nooit bewaren) en mag "Plan deze week" ze niet gebruiken (eindreview I1).
  instellingenRuw: {}, instellingen: voegSamen({}), instellingenGeladen: false, instellingenDoel: null,
  gekozenDatum: localISO(new Date()), uitgesteld: new Set(),
});
let staat = nieuweToestand();
let doel = null;                    // het `gebruikerId` dat laadSales kreeg (enkel dan gaat `?gebruiker=` mee); null = eigen blob
const abonnees = new Set();
const uitstel = new Map();          // leadId -> { timer, wis, doel }
let wijzigKeten = Promise.resolve(); // wijzig() loopt serieel: elke aanroep gebruikt de versie van de vorige

/** De live toestand (niet muteren; wijzigen kan enkel via de functies hieronder). */
export function salesToestand() { return staat; }

/** Meldt `fn` aan; geeft de afmeldfunctie terug. Een falende abonnee houdt de andere niet tegen. */
export function onSalesWijziging(fn) {
  abonnees.add(fn);
  return () => { abonnees.delete(fn); };
}
function meld(detail = { soort: 'toestand' }) {
  for (const fn of [...abonnees]) { try { fn(detail); } catch { /* een abonnee mag de laag niet breken */ } }
}

/**
 * Voor een gebruikerswissel/uitloggen en voor tests: de toestand terug op nul. De abonnees BLIJVEN standaard (views abonneren zich
 * een keer) en krijgen een melding; `{ abonnees: true }` wist ook de abonneelijst (tests). Openstaande verwijderingen worden
 * geannuleerd en NIET naar de server gestuurd: roep eerst `await spoelUitgesteld({ keepalive: false })` aan.
 */
export function resetSales({ abonnees: wisAbonnees = false } = {}) {
  for (const e of uitstel.values()) e.wis();
  uitstel.clear();
  staat = nieuweToestand();
  doel = null;
  wijzigKeten = Promise.resolve();
  if (wisAbonnees) abonnees.clear(); else meld();
}

// ---- hulpen ----

const query = (...delen) => { const d = delen.filter(Boolean); return d.length ? '?' + d.join('&') : ''; };
const gebruikerQuery = id => (id ? 'gebruiker=' + encodeURIComponent(id) : '');
const isOpslag = r => r.status === 503 && r.data?.code === 'opslag-storing';

// Een bruikbare serverstand: object met versie en de lijsten (anders mag de toestand er niet door gewist worden).
const isBlob = d => d !== null && typeof d === 'object' && typeof d.versie === 'number' && Array.isArray(d.leads) && Array.isArray(d.blokken);

// Een antwoord van de server (GET/PATCH/409-data, al gecontroleerd met isBlob) -> toestand.
function neemOver(d) {
  staat.gebruikerId = d.gebruikerId ?? staat.gebruikerId;
  staat.versie = d.versie;
  staat.leads = d.leads;
  staat.blokken = d.blokken;
}

function zetInstellingen(ruw, doelId = null) {
  const o = ruw && typeof ruw === 'object' && !Array.isArray(ruw) ? ruw : {};
  staat.instellingenRuw = o;
  staat.instellingen = voegSamen(o);
  staat.instellingenGeladen = true;
  staat.instellingenDoel = doelId || null;
}
// Instellingen van een ander doel (of een mislukte lading) mogen nooit blijven staan: terug op de standaarden, niet geladen.
function wisInstellingen() {
  staat.instellingenRuw = {};
  staat.instellingen = voegSamen({});
  staat.instellingenGeladen = false;
  staat.instellingenDoel = null;
}

/** Staan er echt van de server geladen instellingen voor deze verkoper (gebruikerId; leeg = eigen)? Zo niet: niet bewaren en niet plannen. */
export function instellingenGeladenVoor(gebruikerId) {
  return staat.instellingenGeladen && staat.instellingenDoel === (gebruikerId || null);
}

// ---- lezen ----

export async function laadSales({ gebruikerId } = {}) {
  let r;
  try { r = await apiVerzoek('/api/sales' + query(gebruikerQuery(gebruikerId))); }
  catch { return { ok: false, status: 0 }; }
  if (!r.ok) return isOpslag(r) ? { ok: false, status: r.status, opslag: true } : { ok: false, status: r.status };
  if (!isBlob(r.data)) return { ok: false, status: r.status };
  doel = gebruikerId || null;
  if (staat.instellingenGeladen && staat.instellingenDoel !== doel) wisInstellingen(); // een andere verkoper: de vorige instellingen gelden niet
  neemOver(r.data);
  meld();
  return { ok: true, status: r.status, open: r.data.open };
}

// Een mislukte lading wist geladen instellingen van een ANDER doel (nooit die van de vorige verkoper gebruiken); instellingen van hetzelfde doel
// blijven staan (ze zijn enkel mogelijk verouderd).
function mislukt(wie, status, opslag) {
  if (staat.instellingenDoel !== wie) wisInstellingen();
  meld();
  return opslag ? { ok: false, status, opslag: true } : { ok: false, status };
}

export async function laadInstellingen({ gebruikerId } = {}) {
  const wie = gebruikerId || null;
  let r;
  try { r = await apiVerzoek('/api/instellingen' + query(gebruikerQuery(gebruikerId))); }
  catch { return mislukt(wie, 0); }
  if (!r.ok) return mislukt(wie, r.status, isOpslag(r));
  // Een onleesbaar antwoord (geen object, of instellingen die geen object/null zijn) is geen bruikbare lading: anders zouden standaarden voor
  // de bewaarde waarden doorgaan. `instellingen: null` is wel geldig: er zijn nog geen instellingen bewaard.
  const ins = r.data?.instellingen;
  if (r.data === null || typeof r.data !== 'object' || (ins != null && (typeof ins !== 'object' || Array.isArray(ins)))) return mislukt(wie, r.status);
  zetInstellingen(ins, wie);
  meld();
  return { ok: true, status: r.status };
}

// Gedeelde foutvertaling voor schrijfacties: reden 'opslag' (503 opslag-storing: geen herlogin), 'http' of 'netwerk'.
const fout = (r, extra = {}) => ({ ok: false, reden: isOpslag(r) ? 'opslag' : 'http', status: r.status, ...(r.data?.error ? { fout: r.data.error } : {}), ...extra });

export async function bewaarInstellingen(instellingen /* volledig object */) {
  let r;
  try { r = await apiVerzoek('/api/instellingen', { methode: 'PUT', body: { instellingen } }); }
  catch { return { ok: false, reden: 'netwerk' }; }
  if (!r.ok) return fout(r);
  zetInstellingen(r.data?.instellingen && typeof r.data.instellingen === 'object' ? r.data.instellingen : instellingen, null);
  meld();
  return { ok: true };
}

// ---- schrijven ----

async function wijzigNu(invoer) {
  let tweede = false;
  for (;;) {
    // Een functie berekent de patch op de actuele stand: na een 409 (nieuwe serverstand) opnieuw, zodat bv. een toe te voegen bezoek
    // op de verse historiek aansluit. Geeft ze null, dan is de wijziging vervallen (bv. de lead is intussen weg).
    const patch = invoer instanceof Function ? invoer(staat) : invoer;
    if (patch == null) return { ok: false, reden: 'vervallen' };
    let r;
    try { r = await apiVerzoek('/api/sales' + query(gebruikerQuery(doel)), { methode: 'PATCH', body: { ...patch, versie: staat.versie } }); }
    catch { return { ok: false, reden: 'netwerk' }; }
    if (r.ok) {
      if (!isBlob(r.data)) return fout(r);
      neemOver(r.data); meld(); return { ok: true, open: r.data.open };
    }
    if (r.status !== 409) return fout(r, r.data?.fouten ? { fouten: r.data.fouten } : {});
    const server = r.data?.data;
    if (!isBlob(server)) return fout(r);                        // 409 zonder bruikbare serverstand: niet raden, niets wissen
    neemOver(server);                                           // de server-stand is de waarheid, ook bij de laatste 409
    meld();
    if (tweede) return { ok: false, reden: 'conflict', status: 409 };
    tweede = true;                                              // EENMAAL opnieuw, dezelfde veld-patch op de verse versie
  }
}

// PATCH en DELETE (timerpad) delen een wachtrij, zodat een laat PATCH-antwoord een net verwijderde lead niet terugzet.
function inKeten(werk) {
  const p = wijzigKeten.then(werk);
  wijzigKeten = p.catch(() => {});
  return p;
}

/**
 * patch = { leads?: [{ id, velden }], blokken?: { toevoegen?, wijzig?, verwijder? }, aanvullen? }, of een functie `(salesToestand) => patch | null`
 * die na een 409 opnieuw op de verse stand wordt uitgevoerd.
 * -> { ok, open? } | { ok:false, reden: 'netwerk'|'http'|'opslag'|'conflict'|'vervallen', status?, fouten?, fout? }
 */
export function wijzig(patch) { return inKeten(() => wijzigNu(patch)); }

export async function importeer(exportObject) {
  let r;
  try { r = await apiVerzoek('/api/sales-import', { methode: 'POST', body: { export: exportObject } }); }
  catch { return { ok: false, reden: 'netwerk' }; }
  if (!r.ok) return fout(r);
  const herlaad = await laadSales({ gebruikerId: doel });
  return { ok: true, samenvatting: r.data?.samenvatting, export: r.data?.export, open: r.data?.open, herladen: herlaad.ok };
}

/**
 * Na een import of adreswijziging: bepaalt de nog ontbrekende locaties door wijzig({ aanvullen: true }) te herhalen (de server werkt per
 * ronde binnen een tijdsbudget). Stopt als niets meer open staat, een ronde mislukt, er geen vooruitgang is of na `max` rondes.
 * `voortgang(open)` wordt voor elke ronde aangeroepen. -> het aantal leads dat nog open staat.
 */
export async function vulLocatiesAan(open, { max = 10, voortgang } = {}) {
  let rest = open;
  for (let ronde = 0; ronde < max && rest > 0; ronde++) {
    voortgang?.(rest);
    const r = await wijzig({ aanvullen: true });
    if (!r.ok || !(r.open < rest)) { if (r.ok) rest = r.open; break; }
    rest = r.open;
  }
  return rest;
}

// ---- uitgestelde verwijdering (5 s ongedaan maken) ----

async function stuurDelete(leadId, doelId, keepalive) {
  let r;
  try { r = await apiVerzoek('/api/sales' + query('lead=' + encodeURIComponent(leadId), gebruikerQuery(doelId)), { methode: 'DELETE', keepalive }); }
  catch { r = null; }
  staat.uitgesteld.delete(leadId);
  if (r && (r.ok || r.status === 404)) { // een 404 betekent: al weg
    // Enkel als de toestand nog hetzelfde blob toont (de beheerder kan intussen van verkoper gewisseld zijn).
    if (doelId === doel) {
      staat.leads = staat.leads.filter(l => l.id !== leadId);
      // De server verhoogde de versie; enkel overnemen als wij er niets tussen misten (anders geeft de volgende PATCH een 409 en laden we bij).
      if (r.ok && typeof r.data?.versie === 'number' && r.data.versie === staat.versie + 1) staat.versie = r.data.versie;
    }
    meld({ soort: 'verwijderd', ok: true, leadId });
    return { ok: true };
  }
  const reden = !r ? 'netwerk' : isOpslag(r) ? 'opslag' : 'http';
  meld({ soort: 'verwijder-mislukt', ok: false, leadId, reden, ...(r ? { status: r.status } : {}) });
  return { ok: false, reden };
}

/** Lead meteen uit de weergave (toestand.uitgesteld); na `wacht` ms DELETE. -> { ongedaan() } (true als het nog kon). */
export function verwijderMetOngedaan(leadId, { wacht = WACHT_MS, setTimeoutFn, clearTimeoutFn } = {}) {
  const bestaand = uitstel.get(leadId);
  if (bestaand) return bestaand.handle;
  const zet = setTimeoutFn || ((...a) => globalThis.setTimeout(...a));
  const wisTimer = clearTimeoutFn || ((...a) => globalThis.clearTimeout(...a));
  const e = { doel, timer: null, wis: null, handle: null };
  e.wis = () => wisTimer(e.timer);
  e.timer = zet(() => { if (uitstel.get(leadId) === e) { uitstel.delete(leadId); inKeten(() => stuurDelete(leadId, e.doel, false)); } }, wacht);
  e.handle = {
    ongedaan() {
      if (uitstel.get(leadId) !== e) return false; // al verstuurd (of al ongedaan gemaakt)
      uitstel.delete(leadId);
      e.wis();
      staat.uitgesteld.delete(leadId);
      meld();
      return true;
    },
  };
  uitstel.set(leadId, e);
  staat.uitgesteld.add(leadId);
  meld();
  return e.handle;
}

/** Verstuurt alle openstaande verwijderingen meteen (voor 'pagehide'); met `keepalive` overleeft het verzoek het sluiten van de pagina. */
export function spoelUitgesteld({ keepalive = true } = {}) {
  const open = [...uitstel.entries()];
  uitstel.clear();
  return Promise.all(open.map(([leadId, e]) => { e.wis(); return stuurDelete(leadId, e.doel, keepalive); }));
}

// ---- gekozen datum (gedeeld door kalender en route) ----

export function gekozenDatum() { return staat.gekozenDatum; }
export function zetGekozenDatum(iso) {
  if (typeof iso !== 'string' || !ISO_DATUM.test(iso) || iso === staat.gekozenDatum) return;
  staat.gekozenDatum = iso;
  meld();
}
