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

export const SALES_STANDAARD = { vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00', werkdagen: [1, 2, 3, 4, 5], bezoekDuurMin: 60 };
const WACHT_MS = 5000;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

// ---- module-privé toestand ----

const nieuweToestand = () => ({
  gebruikerId: null, versie: 0, leads: [], blokken: [],
  instellingenRuw: {}, instellingen: { ...SALES_STANDAARD },
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

/** Enkel voor tests en voor een gebruikerswissel/uitloggen: alles terug op nul (annuleert openstaande verwijderingen NIET naar de server). */
export function resetSales() {
  for (const e of uitstel.values()) e.wis();
  uitstel.clear();
  staat = nieuweToestand();
  doel = null;
  abonnees.clear();
  wijzigKeten = Promise.resolve();
}

// ---- hulpen ----

const query = (...delen) => { const d = delen.filter(Boolean); return d.length ? '?' + d.join('&') : ''; };
const gebruikerQuery = id => (id ? 'gebruiker=' + encodeURIComponent(id) : '');
const isOpslag = r => r.status === 503 && r.data?.code === 'opslag-storing';

// Een antwoord van de server (GET/PATCH/409-data) -> toestand.
function neemOver(d) {
  staat.gebruikerId = d.gebruikerId ?? staat.gebruikerId;
  staat.versie = typeof d.versie === 'number' ? d.versie : staat.versie;
  staat.leads = Array.isArray(d.leads) ? d.leads : [];
  staat.blokken = Array.isArray(d.blokken) ? d.blokken : [];
}

function zetInstellingen(ruw) {
  const o = ruw && typeof ruw === 'object' && !Array.isArray(ruw) ? ruw : {};
  staat.instellingenRuw = o;
  staat.instellingen = { ...SALES_STANDAARD, ...o };
}

// ---- lezen ----

export async function laadSales({ gebruikerId } = {}) {
  let r;
  try { r = await apiVerzoek('/api/sales' + query(gebruikerQuery(gebruikerId))); }
  catch { return { ok: false, status: 0 }; }
  if (!r.ok) return isOpslag(r) ? { ok: false, status: r.status, opslag: true } : { ok: false, status: r.status };
  doel = gebruikerId || null;
  neemOver(r.data);
  meld();
  return { ok: true, status: r.status, open: r.data.open };
}

export async function laadInstellingen({ gebruikerId } = {}) {
  let r;
  try { r = await apiVerzoek('/api/instellingen' + query(gebruikerQuery(gebruikerId))); }
  catch { return { ok: false, status: 0 }; }
  if (!r.ok) return isOpslag(r) ? { ok: false, status: r.status, opslag: true } : { ok: false, status: r.status };
  zetInstellingen(r.data?.instellingen);
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
  zetInstellingen(r.data?.instellingen && typeof r.data.instellingen === 'object' ? r.data.instellingen : instellingen);
  meld();
  return { ok: true };
}

// ---- schrijven ----

async function wijzigNu(patch) {
  let tweede = false;
  for (;;) {
    let r;
    try { r = await apiVerzoek('/api/sales' + query(gebruikerQuery(doel)), { methode: 'PATCH', body: { versie: staat.versie, ...patch } }); }
    catch { return { ok: false, reden: 'netwerk' }; }
    if (r.ok) { neemOver(r.data); meld(); return { ok: true, open: r.data.open }; }
    if (r.status !== 409) return fout(r, r.data?.fouten ? { fouten: r.data.fouten } : {});
    const server = r.data?.data;
    if (!server || typeof server !== 'object') return fout(r);   // 409 zonder leesbare serverstand: niet raden
    neemOver(server);                                           // de server-stand is de waarheid, ook bij de laatste 409
    meld();
    if (tweede) return { ok: false, reden: 'conflict', status: 409 };
    tweede = true;                                              // EENMAAL opnieuw, dezelfde veld-patch op de verse versie
  }
}

/** patch = { leads?: [{ id, velden }], blokken?: { toevoegen?, wijzig?, verwijder? }, aanvullen? } -> { ok, open? } | { ok:false, reden, status?, fouten?, fout? } */
export function wijzig(patch) {
  const p = wijzigKeten.then(() => wijzigNu(patch));
  wijzigKeten = p.catch(() => {});
  return p;
}

export async function importeer(exportObject) {
  let r;
  try { r = await apiVerzoek('/api/sales-import', { methode: 'POST', body: { export: exportObject } }); }
  catch { return { ok: false, reden: 'netwerk' }; }
  if (!r.ok) return fout(r);
  await laadSales({ gebruikerId: doel });
  return { ok: true, samenvatting: r.data.samenvatting, export: r.data.export, open: r.data.open };
}

// ---- uitgestelde verwijdering (5 s ongedaan maken) ----

async function stuurDelete(leadId, doelId, keepalive) {
  let r;
  try { r = await apiVerzoek('/api/sales' + query('lead=' + encodeURIComponent(leadId), gebruikerQuery(doelId)), { methode: 'DELETE', keepalive }); }
  catch { r = null; }
  staat.uitgesteld.delete(leadId);
  if (r && (r.ok || r.status === 404)) { // een 404 betekent: al weg
    staat.leads = staat.leads.filter(l => l.id !== leadId);
    // De server verhoogde de versie; enkel overnemen als wij er niets tussen misten (anders geeft de volgende PATCH een 409 en laden we bij).
    if (r.ok && typeof r.data?.versie === 'number' && r.data.versie === staat.versie + 1) staat.versie = r.data.versie;
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
  e.timer = zet(() => { if (uitstel.get(leadId) === e) { uitstel.delete(leadId); stuurDelete(leadId, e.doel, false); } }, wacht);
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
