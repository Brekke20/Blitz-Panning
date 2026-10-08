// Sales-planner: domeinregels voor een lead (pure logica, geen DOM, geen netwerk; geeft nieuwe objecten, muteert nooit).
// Statusflow: te-plannen -> voorgesteld -> bevestigd -> afgewerkt. De verkoper kan voor ELKE lead handmatig dag + uur
// vastleggen (`zetVastUur`): zo'n lead is `bevestigd` en wordt door het planner-brein nooit verplaatst.

export const STATUSSEN = ['te-plannen', 'voorgesteld', 'bevestigd', 'afgewerkt'];
export const RESULTAAT_LABEL = { offerte: 'Offerte', verkocht: 'Verkocht', 'geen-interesse': 'Geen interesse', opnieuw: 'Opnieuw langsgaan' };
export const WIJZIGBARE_VELDEN = ['notitie', 'duurMin', 'straat', 'huisnr', 'postcode', 'gemeente', 'adresTekst', 'status', 'planning', 'resultaat', 'bezoeken', 'eerderVerwijderd'];

const ADRESVELDEN = ['straat', 'huisnr', 'postcode', 'gemeente', 'adresTekst'];
const MAX_VELD = 200;      // zelfde grens als de import (sales/import.js)
const MAX_NOTITIE = 1000;
const MAX_BEZOEKEN = 200;
const AFWERK_SOORTEN = ['offerte', 'verkocht', 'geen-interesse']; // 'opnieuw' maakt een lead nooit afgewerkt
const PLANNING_SLEUTELS = ['datum', 'start', 'vast'];
const TOEGELATEN_OVERGANGEN = {
  'te-plannen': ['voorgesteld', 'bevestigd', 'afgewerkt'],
  voorgesteld: ['te-plannen', 'bevestigd', 'afgewerkt'],
  bevestigd: ['te-plannen', 'afgewerkt'],
  afgewerkt: ['te-plannen'],
};

/** 'YYYY-MM-DD' en een bestaande kalenderdag (ronde-reis via Date: 2026-02-30 en 2026-13-40 vallen af). */
export function isGeldigeDatum(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === d;
}

/** 'HH:MM' tussen 00:00 en 23:59. */
export function isGeldigUur(u) {
  return typeof u === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(u);
}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Fouttekst als `waarde` (indien aanwezig) geen tekst is of langer dan `max`; anders null. */
function tekstFout(naam, waarde, max) {
  if (waarde == null) return null;
  if (typeof waarde !== 'string') return `${naam} moet tekst zijn`;
  if (waarde.length > max) return `${naam} is te lang (max. ${max} tekens)`;
  return null;
}

const zonderSleutels = (obj, ...sleutels) => {
  const kopie = { ...obj };
  for (const s of sleutels) delete kopie[s];
  return kopie;
};

/** Vast = vastgezet uur of bevestigd; het planner-brein verschuift zo'n lead nooit. */
export function isVast(lead) {
  return lead?.planning?.vast === true || lead?.status === 'bevestigd';
}

/** Legt dag + uur vast (ook voor een nog niet ingeplande lead, of om een bevestigd uur te wijzigen). Gooit op 'afgewerkt'. Valideert niet: dat doet `valideerLead`. */
export function zetVastUur(lead, { datum, start }) {
  if (lead?.status === 'afgewerkt') throw new Error('Een afgewerkte lead heeft geen uur');
  return { ...lead, status: 'bevestigd', planning: { datum, start, vast: true } };
}

/** voorgesteld -> bevestigd (het voorgestelde uur wordt vast). */
export function bevestig(lead) {
  if (lead?.status !== 'voorgesteld' || !lead.planning) throw new Error('Enkel een voorgesteld bezoek kan bevestigd worden');
  return { ...lead, status: 'bevestigd', planning: { ...lead.planning, vast: true } };
}

/** Planning weg en status 'te-plannen' (ook het resultaat van een eerdere afronding vervalt: "verkeerde klik herstellen"). */
export function terugNaarTePlannen(lead) {
  return { ...zonderSleutels(lead, 'planning', 'resultaat'), status: 'te-plannen' };
}

// Datum in Brusselse tijd (de bedrijfsdag), los van de tijdzone van de server.
function dagVanNu(nu) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nu);
}

/** Registreert het resultaat van een bezoek. 'opnieuw' zet de lead terug op te-plannen; de andere soorten werken hem af. */
export function geefResultaat(lead, { soort, notitie, nu = new Date() } = {}) {
  if (!Object.hasOwn(RESULTAAT_LABEL, soort)) throw new Error(`Onbekend resultaat: ${soort}`);
  if (lead?.status === 'afgewerkt') throw new Error('Deze lead is al afgewerkt (zet hem eerst terug naar te plannen)');
  const moment = nu instanceof Date ? nu : new Date(nu);
  if (isNaN(moment)) throw new Error('Ongeldig tijdstip');
  const op = typeof nu === 'string' ? nu : moment.toISOString();
  const metNotitie = notitie != null && notitie !== '' ? { notitie } : {};
  const bezoek = { datum: lead?.planning?.datum ?? dagVanNu(moment), resultaat: soort, ...metNotitie, op };
  const basis = zonderSleutels(lead, 'planning', 'resultaat');
  const bezoeken = [...(Array.isArray(lead?.bezoeken) ? lead.bezoeken : []), bezoek];
  if (soort === 'opnieuw') return { ...basis, status: 'te-plannen', bezoeken };
  return { ...basis, status: 'afgewerkt', resultaat: { soort, ...metNotitie, op }, bezoeken };
}

// Resultaat ({ soort, notitie?, op }) of bezoek ({ datum, resultaat, notitie?, op }); onbekende sleutels zijn een fout.
function resultaatFouten(r, naam, soorten, isBezoek = false) {
  if (!isObject(r)) return [`${naam} is ongeldig`];
  const fouten = [];
  const sleutels = isBezoek ? ['datum', 'resultaat', 'notitie', 'op'] : ['soort', 'notitie', 'op'];
  for (const k of Object.keys(r)) if (!sleutels.includes(k)) fouten.push(`${naam}: onbekend veld ${k}`);
  const soort = isBezoek ? r.resultaat : r.soort;
  if (!soorten.includes(soort)) fouten.push(`${naam}: onbekende soort`);
  if (isBezoek && !isGeldigeDatum(r.datum)) fouten.push(`${naam}: ongeldige datum`);
  if (typeof r.op !== 'string' || r.op === '') fouten.push(`${naam}: tijdstip ontbreekt`);
  const f = tekstFout(`${naam}: notitie`, r.notitie, MAX_NOTITIE);
  if (f) fouten.push(f);
  return fouten;
}

/** Invarianten van een lead; lege lijst = geldig. */
export function valideerLead(lead) {
  if (!lead || typeof lead !== 'object') return ['Lead ontbreekt'];
  const fouten = [];
  const { status, planning } = lead;
  if (!STATUSSEN.includes(status)) fouten.push(`Onbekende status: ${status}`);
  const planningOk = () => {
    if (!planning || typeof planning !== 'object') return fouten.push(`Status ${status} vraagt een planning met datum en uur`), false;
    if (!isGeldigeDatum(planning.datum)) fouten.push('Planning: ongeldige datum');
    if (!isGeldigUur(planning.start)) fouten.push('Planning: ongeldig uur');
    return true;
  };
  if (status === 'voorgesteld' && planningOk() && planning.vast === true) fouten.push('Een voorgesteld bezoek mag niet vast zijn');
  if (status === 'bevestigd' && planningOk() && planning.vast !== true) fouten.push('Een bevestigd bezoek moet vast zijn');
  if (status === 'te-plannen' && planning) fouten.push('Een te plannen lead heeft geen planning');
  if (status === 'afgewerkt') {
    if (!lead.resultaat) fouten.push('Een afgewerkte lead heeft een resultaat nodig');
    if (planning) fouten.push('Een afgewerkte lead heeft geen planning');
  }
  if (lead.postcode != null && lead.postcode !== '' && !/^\d{4}$/.test(String(lead.postcode))) fouten.push('Postcode moet 4 cijfers zijn');
  if (lead.duurMin != null && !(typeof lead.duurMin === 'number' && lead.duurMin >= 15)) fouten.push('Duur moet minstens 15 minuten zijn');
  if (lead.eerderVerwijderd != null && typeof lead.eerderVerwijderd?.op !== 'string') fouten.push('eerderVerwijderd moet { op } zijn');

  // Inhoud, niet enkel vorm: dit is ook de bewaker van wat een verkoper via de server kan bewaren.
  for (const veld of ADRESVELDEN) {
    const f = tekstFout(veld, lead[veld], MAX_VELD);
    if (f) fouten.push(f);
  }
  const notitieFout = tekstFout('notitie', lead.notitie, MAX_NOTITIE);
  if (notitieFout) fouten.push(notitieFout);
  if (planning != null && isObject(planning)) {
    for (const sleutel of Object.keys(planning)) if (!PLANNING_SLEUTELS.includes(sleutel)) fouten.push(`Planning: onbekend veld ${sleutel}`);
    if (planning.vast != null && typeof planning.vast !== 'boolean') fouten.push('Planning: vast moet waar of onwaar zijn');
  }
  if (lead.resultaat != null) {
    if (status !== 'afgewerkt') fouten.push('Enkel een afgewerkte lead heeft een resultaat');
    else fouten.push(...resultaatFouten(lead.resultaat, 'Resultaat', AFWERK_SOORTEN));
  }
  if (lead.bezoeken != null) {
    if (!Array.isArray(lead.bezoeken)) fouten.push('Bezoeken moet een lijst zijn');
    else if (lead.bezoeken.length > MAX_BEZOEKEN) fouten.push(`Te veel bezoeken (max. ${MAX_BEZOEKEN})`);
    else lead.bezoeken.forEach((b, i) => {
      const f = resultaatFouten(b, `Bezoek ${i + 1}`, Object.keys(RESULTAAT_LABEL), true);
      fouten.push(...f);
    });
  }
  return fouten;
}

const tekst = (x) => (x == null ? '' : String(x));

/**
 * Past een door de verkoper aangeboden wijziging toe. Enkel WIJZIGBARE_VELDEN; statusovergangen volgens TOEGELATEN_OVERGANGEN
 * (dezelfde status mag altijd); het resultaat moet `valideerLead` halen. Bij een fout blijft de lead ongewijzigd.
 * Adresvelden wijzigen wist `locatie` (opnieuw geocoderen); `adresGewijzigd` meldt dat.
 */
export function pasLeadToe(lead, velden) {
  const onveranderd = (fouten) => ({ lead, adresGewijzigd: false, fouten });
  const fouten = [];
  for (const sleutel of Object.keys(velden ?? {})) {
    if (!WIJZIGBARE_VELDEN.includes(sleutel)) fouten.push(`Veld niet toegelaten: ${sleutel}`);
  }
  if (fouten.length) return onveranderd(fouten);
  if (velden.status !== undefined && velden.status !== lead.status) {
    if (!STATUSSEN.includes(velden.status)) fouten.push(`Onbekende status: ${velden.status}`);
    else if (!(TOEGELATEN_OVERGANGEN[lead.status] ?? []).includes(velden.status)) fouten.push(`Statusovergang niet toegelaten: ${lead.status} -> ${velden.status}`);
  }
  if ('eerderVerwijderd' in velden && velden.eerderVerwijderd !== null) fouten.push('eerderVerwijderd mag enkel gewist worden (null)');
  if (fouten.length) return onveranderd(fouten);

  const nieuw = { ...lead, ...velden };
  for (const sleutel of ['planning', 'resultaat', 'eerderVerwijderd']) if (nieuw[sleutel] == null) delete nieuw[sleutel];
  if (nieuw.status !== 'afgewerkt') delete nieuw.resultaat; // enkel een afgewerkte lead heeft een resultaat
  const adresGewijzigd = ADRESVELDEN.some((v) => v in velden && tekst(velden[v]) !== tekst(lead[v]));
  if (adresGewijzigd) nieuw.locatie = null;
  const ongeldig = valideerLead(nieuw);
  if (ongeldig.length) return onveranderd(ongeldig);
  return { lead: nieuw, adresGewijzigd, fouten: [] };
}
