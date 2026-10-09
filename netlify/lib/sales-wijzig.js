// Sales-planner (server): een client-wijziging op het verkoperblob toepassen. Alles of niets: bij elke fout blijft `data`
// ongewijzigd. De server is de grens: elke leadwijziging gaat langs `pasLeadToe` (domeinregels, Task 3), blokken langs
// `valideerBlok`. Daarbovenop (niet in de domeinlogica, want die moet ook het resultaat kunnen voorbereiden):
// - `bezoeken` is een logboek: enkel toevoegen (max. 1 per lead per verzoek), nooit herschrijven, wissen of herordenen;
// - een resultaat ontstaat enkel samen met een nieuw bezoek (zoals `geefResultaat`) en bezoek + resultaat krijgen
//   EXACT dezelfde `op` (de serverklok, één tijdstip twee keer gebruikt);
// - `duurMin` blijft binnen een zinnig bereik (15-480 minuten);
// - de server-velden `adresTeGeocoderen` en `adresPogingen` zijn niet schrijfbaar en worden gewist bij een adreswijziging;
// - elke gewijzigde lead krijgt `gewijzigdOp` (serverklok): de laatste activiteit voor de bewaartermijn (sales-opruimen.js).
import { isDeepStrictEqual } from 'node:util';
import { pasLeadToe, RESULTAAT_LABEL } from '../../public/js/sales/lead-regels.js';
import { valideerBlok } from '../../public/js/sales/blok-regels.js';

export const MAX_ITEMS = 500;
export const MAX_BLOKKEN = 2000;
export const DUUR_MIN = 15;
export const DUUR_MAX = 480;
const BLOKVELDEN = ['datum', 'start', 'eind', 'soort', 'omschrijving', 'lat', 'lon'];
const SERVERVELDEN = ['adresTeGeocoderen', 'adresPogingen'];

const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isId = x => typeof x === 'string' && x !== '';

// ---- vorm van de body ----

function lijstFouten(naam, x) {
  if (x === undefined) return [];
  if (!Array.isArray(x)) return [`${naam} moet een lijst zijn`];
  if (x.length > MAX_ITEMS) return [`${naam}: te veel items (max. ${MAX_ITEMS})`];
  return [];
}

function bodyFouten(body) {
  if (!isObject(body)) return ['Body moet een object zijn'];
  const fouten = [...lijstFouten('leads', body.leads)];
  if (Array.isArray(body.leads) && body.leads.length <= MAX_ITEMS) {
    body.leads.forEach((w, i) => {
      if (!isObject(w)) fouten.push(`leads[${i}] moet een object zijn`);
      else {
        if (!isId(w.id)) fouten.push(`leads[${i}]: id moet tekst zijn`);
        if (!isObject(w.velden)) fouten.push(`leads[${i}]: velden moet een object zijn`);
      }
    });
  }
  if (body.blokken === undefined) return fouten;
  if (!isObject(body.blokken)) return [...fouten, 'blokken moet een object zijn'];
  const { toevoegen, wijzig, verwijder } = body.blokken;
  fouten.push(...lijstFouten('blokken.toevoegen', toevoegen), ...lijstFouten('blokken.wijzig', wijzig), ...lijstFouten('blokken.verwijder', verwijder));
  if (fouten.length) return fouten;
  (toevoegen ?? []).forEach((b, i) => { if (!isObject(b)) fouten.push(`blokken.toevoegen[${i}] moet een object zijn`); });
  (wijzig ?? []).forEach((w, i) => {
    if (!isObject(w) || !isId(w.id) || !isObject(w.velden)) fouten.push(`blokken.wijzig[${i}]: id (tekst) en velden (object) zijn verplicht`);
  });
  (verwijder ?? []).forEach((id, i) => { if (!isId(id)) fouten.push(`blokken.verwijder[${i}]: id moet tekst zijn`); });
  return fouten;
}

// ---- blokken ----

function geldigCoordinaat(x, min, max) {
  return x == null || (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max);
}

// Enkel bekende velden; lat/lon samen of niet; -> { blok } | { fout }
function maakBlok(id, invoer) {
  const kopie = {};
  for (const sleutel of BLOKVELDEN) if (invoer[sleutel] != null) kopie[sleutel] = invoer[sleutel];
  const { blok, fout } = valideerBlok(kopie);
  if (fout) return { fout };
  if (!geldigCoordinaat(blok.lat, -90, 90) || !geldigCoordinaat(blok.lon, -180, 180) || (blok.lat == null) !== (blok.lon == null)) {
    return { fout: 'Ongeldige coördinaten' };
  }
  return { blok: { id, ...blok } };
}

// ---- leads ----

const isIngevuld = (x) => x != null;

// Past de wijzigingen voor één lead toe; -> { lead, adresGewijzigd, resultaat? } | { fouten }
function wijzigLead(lead, velden, opNu) {
  const v = { ...velden };
  const fouten = [];
  if ('duurMin' in v && v.duurMin != null && !(Number.isInteger(v.duurMin) && v.duurMin >= DUUR_MIN && v.duurMin <= DUUR_MAX)) {
    fouten.push(`duurMin moet een geheel getal tussen ${DUUR_MIN} en ${DUUR_MAX} minuten zijn`);
  }
  let bezoek = null; // het nieuw toegevoegde bezoek
  const oud = Array.isArray(lead.bezoeken) ? lead.bezoeken : []; // een lead zonder lijst telt als zonder historiek
  if ('bezoeken' in v) {
    const nieuw = v.bezoeken;
    if (!Array.isArray(nieuw)) fouten.push('bezoeken moet een lijst zijn');
    else if (nieuw.length < oud.length || !oud.every((b, i) => isDeepStrictEqual(b, nieuw[i]))) {
      fouten.push('De bezoekhistoriek kan niet herschreven worden (enkel een bezoek toevoegen)');
    } else if (nieuw.length - oud.length > 1) fouten.push('Per verzoek kan er maar één bezoek toegevoegd worden');
    else if (nieuw.length > oud.length) {
      if (lead.status === 'afgewerkt') fouten.push('Een afgewerkte lead kan geen nieuw bezoek krijgen (zet hem eerst terug naar te plannen)');
      else if (!isObject(nieuw[oud.length]) || !Object.hasOwn(RESULTAAT_LABEL, nieuw[oud.length].resultaat)) fouten.push('Nieuw bezoek: onbekende soort');
      else bezoek = { ...nieuw[oud.length], op: opNu }; // de serverklok
    }
  }
  if (fouten.length) return { fouten };

  if (bezoek) {
    v.bezoeken = [...oud, bezoek];
    if (bezoek.resultaat === 'opnieuw') {
      if (isIngevuld(v.resultaat)) return { fouten: ['Bij opnieuw langsgaan hoort geen resultaat'] };
    } else {
      if (isObject(v.resultaat) && v.resultaat.soort !== bezoek.resultaat) return { fouten: ['Resultaat en bezoek komen niet overeen'] };
      v.resultaat = { soort: bezoek.resultaat, ...(bezoek.notitie != null && bezoek.notitie !== '' ? { notitie: bezoek.notitie } : {}), op: opNu };
    }
  }

  const r = pasLeadToe(lead, v);
  if (r.fouten.length) return { fouten: r.fouten };
  const nieuw = r.lead;

  if (bezoek) {
    const verwachtStatus = bezoek.resultaat === 'opnieuw' ? 'te-plannen' : 'afgewerkt';
    if (nieuw.status !== verwachtStatus) return { fouten: [`Bij resultaat ${bezoek.resultaat} hoort status ${verwachtStatus}`] };
  } else if (nieuw.resultaat !== undefined && !isDeepStrictEqual(nieuw.resultaat, lead.resultaat)) {
    return { fouten: ['Een resultaat kan enkel samen met een nieuw bezoek vastgelegd worden'] };
  }
  if (r.adresGewijzigd) for (const s of SERVERVELDEN) delete nieuw[s];
  return { lead: nieuw, adresGewijzigd: r.adresGewijzigd, resultaat: bezoek ? { soort: bezoek.resultaat } : null };
}

/**
 * body = { leads?: [{ id, velden }], blokken?: { toevoegen?, wijzig?, verwijder? } } (andere sleutels, zoals `versie`, worden genegeerd).
 * -> { data, adresGewijzigd: string[], resultaten: [{ leadId, soort }], fouten: string[] }. Bij een fout blijft `data` ongewijzigd.
 */
export function pasWijzigingToe(data, body, { nu, nieuwBlokId } = {}) {
  const mislukt = fouten => ({ data, adresGewijzigd: [], resultaten: [], fouten });
  const vorm = bodyFouten(body);
  if (vorm.length) return mislukt(vorm);
  const moment = new Date(nu);
  if (Number.isNaN(moment.getTime())) return mislukt(['Ongeldig tijdstip']);
  const opNu = moment.toISOString();

  const nieuw = structuredClone(data);
  const fouten = [];
  const adresGewijzigd = [];
  const resultaten = [];

  for (const { id, velden } of body.leads ?? []) {
    const index = nieuw.leads.findIndex(l => l.id === id);
    if (index < 0) { fouten.push(`Onbekende lead: ${id}`); continue; }
    const r = wijzigLead(nieuw.leads[index], velden, opNu);
    if (r.fouten) { fouten.push(...r.fouten.map(f => `Lead ${id}: ${f}`)); continue; }
    nieuw.leads[index] = { ...r.lead, gewijzigdOp: opNu };
    if (r.adresGewijzigd && !adresGewijzigd.includes(id)) adresGewijzigd.push(id);
    if (r.resultaat) resultaten.push({ leadId: id, ...r.resultaat });
  }

  const b = body.blokken ?? {};
  for (const [i, invoer] of (b.toevoegen ?? []).entries()) {
    const r = maakBlok(nieuwBlokId(), invoer);
    if (r.fout) fouten.push(`Blok ${i + 1}: ${r.fout}`); else nieuw.blokken.push(r.blok);
  }
  for (const { id, velden } of b.wijzig ?? []) {
    const index = nieuw.blokken.findIndex(x => x.id === id);
    if (index < 0) { fouten.push(`Onbekend blok: ${id}`); continue; }
    const vreemd = Object.keys(velden).filter(k => !BLOKVELDEN.includes(k));
    if (vreemd.length) { fouten.push(`Blok ${id}: veld niet toegelaten: ${vreemd.join(', ')}`); continue; }
    const samen = { ...nieuw.blokken[index], ...velden };
    for (const sleutel of ['omschrijving', 'lat', 'lon']) if (samen[sleutel] == null) delete samen[sleutel];
    const r = maakBlok(id, samen);
    if (r.fout) fouten.push(`Blok ${id}: ${r.fout}`); else nieuw.blokken[index] = r.blok;
  }
  for (const id of b.verwijder ?? []) {
    const index = nieuw.blokken.findIndex(x => x.id === id);
    if (index < 0) fouten.push(`Onbekend blok: ${id}`); else nieuw.blokken.splice(index, 1);
  }
  if (nieuw.blokken.length > MAX_BLOKKEN) fouten.push(`Te veel blokken (max. ${MAX_BLOKKEN})`);

  if (fouten.length) return mislukt(fouten);
  return { data: nieuw, adresGewijzigd, resultaten, fouten: [] };
}
