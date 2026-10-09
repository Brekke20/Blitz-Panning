// Sales-planner: adapter van leads naar het bestaande planner-brein (`planWeek` in planner.js, ongewijzigd). Puur: geen DOM, geen globals.
// De adapter roept `planWeek` zelf niet aan (dat doet het scherm). Een vaste lead (`isVast`: vastgezet uur of bevestigd)
// is nooit kandidaat: hij staat als bestaand bezoek met uur in `bestaandPerDag`, dus het brein plant eromheen en verschuift hem nooit.
import { bouwDagen, haversine } from '../planner.js';
import { isVast, isVerlopenVoorstel } from './lead-regels.js';
import { isHeleDag } from './blok-regels.js';
import { standaardLaatsteStart } from '../kern/instellingen-regels.js';

export const STANDAARD_BEZOEKDUUR_MIN = 60;

// Dezelfde standaardwaarden als de planning van de technieker (DEFAULT_SETTINGS in schermen/instellingen.js, dat DOM-afhankelijk is
// en daarom hier niet geimporteerd wordt; een test bewaakt dat de waarden gelijk blijven).
const STANDAARD_WERKDAGEN = [1, 2, 3, 4, 5];
const STANDAARD_MAX_PER_DAG = 4;
const STANDAARD_MAX_REISTIJD_MIN = 45;
const naarMin = (u) => Number(u.slice(0, 2)) * 60 + Number(u.slice(3));

function isoPlusDagen(datum, n) {
  const d = new Date(datum + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const duurVan = (lead, standaardDuurMin) => lead.duurMin ?? standaardDuurMin;

/** Een lead als kandidaat voor het brein: altijd prioriteit 'medium', wachttijd vanaf de import. */
export function leadNaarKandidaat(lead, { standaardDuurMin = STANDAARD_BEZOEKDUUR_MIN } = {}) {
  return {
    id: lead.id,
    number: lead.id,
    priority: 'medium',
    interventieDatum: null,
    inPlanningSinds: lead.geimporteerdOp,
    lat: lead.locatie?.lat ?? null,
    lon: lead.locatie?.lon ?? null,
    duurMin: duurVan(lead, standaardDuurMin),
  };
}

// Ontbrekende of null-waarden krijgen een standaard, zodat `bouwDagen` en `planWeek` nooit crashen.
// Gedrag zoals de technieker-instellingen (instellingen-logica.js): maxPerDag 0 of ontbrekend -> standaard 4; maxReistijdMin
// ontbrekend -> 45, maar een expliciete 0 blijft 0 (zoals daar; het brein weigert dan elke rit).
function metStandaarden(instellingen) {
  const i = instellingen ?? {};
  const vanTijd = i.vanTijd || '08:00';
  return {
    werkdagen: Array.isArray(i.werkdagen) ? i.werkdagen : STANDAARD_WERKDAGEN,
    vanTijd,
    laatsteStart: i.laatsteStart || standaardLaatsteStart(vanTijd, i.totTijd),
    maxPerDag: i.maxPerDag > 0 ? i.maxPerDag : STANDAARD_MAX_PER_DAG,
    maxReistijdMin: Number.isFinite(i.maxReistijdMin) && i.maxReistijdMin >= 0 ? i.maxReistijdMin : STANDAARD_MAX_REISTIJD_MIN,
    bezoekDuurMin: i.bezoekDuurMin > 0 ? i.bezoekDuurMin : STANDAARD_BEZOEKDUUR_MIN,
  };
}

/**
 * Bouwt de invoer voor `planWeek`. weekStart/vandaag zijn ISO 'YYYY-MM-DD'.
 * Kandidaten: te-plannen leads die niet vast zijn, plus voorgestelde leads in deze week vanaf vandaag en verlopen voorstellen (dag voorbij zonder
 * bevestiging, ongeacht de week; eindreview I2) (`vrijgegeven`: mogen herschikt worden en vallen terug op te-plannen als er geen plaats is).
 * -> { invoer, vrijgegeven: lead-id's }
 */
export function bouwPlanInvoer({ leads, blokken = [], instellingen, weekStart, vandaag, depot = null, reistijden, feestdag }) {
  const inst = metStandaarden(instellingen);
  const weekEinde = isoPlusDagen(weekStart, 6);
  const lijst = Array.isArray(leads) ? leads : [];

  const heleDagen = new Set((blokken ?? []).filter(isHeleDag).map((b) => b.datum));
  const uitgesloten = (d) => !!(feestdag && feestdag(d)) || heleDagen.has(d);
  const { dagen, extraVoor } = bouwDagen({ weekStart, vandaag, werkdagen: inst.werkdagen, uitgesloten, voorkeuren: [] });

  const kandidaatLeads = [];
  const vrijgegeven = [];
  for (const lead of lijst) {
    if (isVast(lead)) continue;
    if (lead.status === 'te-plannen') kandidaatLeads.push(lead);
    else if (lead.status === 'voorgesteld') {
      const datum = lead.planning?.datum;
      if (isVerlopenVoorstel(lead, vandaag) || (datum && datum >= weekStart && datum <= weekEinde && datum >= vandaag)) {
        kandidaatLeads.push(lead);
        vrijgegeven.push(lead.id);
      }
    }
  }

  const bestaandPerDag = {};
  for (const lead of lijst) {
    if (!isVast(lead) || lead.status === 'afgewerkt' || !lead.planning?.start) continue;
    const dag = lead.planning.datum;
    if (!dagen.includes(dag)) continue;
    (bestaandPerDag[dag] ||= []).push({
      id: lead.id, uur: lead.planning.start, duurMin: duurVan(lead, inst.bezoekDuurMin),
      lat: lead.locatie?.lat ?? null, lon: lead.locatie?.lon ?? null,
    });
  }
  for (const dag of Object.keys(bestaandPerDag)) bestaandPerDag[dag].sort((a, b) => naarMin(a.uur) - naarMin(b.uur));

  const eigenAfspraken = {};
  const blokkeringen = {};
  for (const blok of blokken ?? []) {
    if (isHeleDag(blok) || !blok?.datum || !blok.start || !blok.eind) continue; // hele dagen vallen al weg uit `dagen`
    if (blok.lat != null && blok.lon != null) {
      (eigenAfspraken[blok.datum] ||= []).push({ uur: blok.start, duurMin: naarMin(blok.eind) - naarMin(blok.start), lat: blok.lat, lon: blok.lon });
    } else {
      (blokkeringen[blok.datum] ||= []).push({ van: blok.start, tot: blok.eind });
    }
  }

  return {
    invoer: {
      kandidaten: kandidaatLeads.map((l) => leadNaarKandidaat(l, { standaardDuurMin: inst.bezoekDuurMin })),
      dagen,
      extraVoor,
      bestaandPerDag,
      eigenAfspraken,
      blokkeringen,
      klant: {},
      instellingen: {
        vanTijd: inst.vanTijd, laatsteStart: inst.laatsteStart, maxPerDag: inst.maxPerDag, maxReistijdMin: inst.maxReistijdMin,
      },
      depot,
      vandaag,
      reistijden,
    },
    vrijgegeven,
  };
}

/**
 * Zet de uitkomst van `planWeek` om in lead-wijzigingen. Een vaste lead komt hier nooit in voor.
 * -> { wijzigingen: [{ id, velden }], geplaatst, nietGepland: [{ leadId, reden }], waarschuwingen }
 */
export function verwerkUitkomst({ uitkomst, leads, vrijgegeven = [] }) {
  const perId = new Map((leads ?? []).map((l) => [l.id, l]));
  const wijzigingen = [];
  const geplaatstIds = new Set();
  for (const g of uitkomst.geplaatst ?? []) {
    const lead = perId.get(g.ticketId);
    if (!lead || isVast(lead)) continue;
    geplaatstIds.add(lead.id);
    wijzigingen.push({ id: lead.id, velden: { status: 'voorgesteld', planning: { datum: g.datum, start: g.verwachteAankomst, vast: false } } });
  }
  for (const id of vrijgegeven) {
    const lead = perId.get(id);
    if (!lead || isVast(lead) || geplaatstIds.has(id)) continue;
    wijzigingen.push({ id, velden: { status: 'te-plannen', planning: null } });
  }
  return {
    wijzigingen,
    geplaatst: geplaatstIds.size,
    nietGepland: (uitkomst.nietGepland ?? []).map((n) => ({ leadId: n.ticketId, reden: n.reden })),
    waarschuwingen: uitkomst.waarschuwingen ?? [],
  };
}

/**
 * Reistijden voor het brein: async (van, naar, vertrekIso) => Map<id, minuten|null>. Gooit nooit; een fout geeft overal null
 * (het brein rekent dan met een schatting). In testmodus: haversine x 1,3 zonder netwerkaanroep.
 */
export function maakReistijdenAdapter({ apiVerzoek, testModus }) {
  return async (van, naar, vertrekIso) => {
    if (testModus) return new Map(naar.map((n) => [n.id, haversine(van.lat, van.lon, n.lat, n.lon) * 1.3]));
    const alleNull = () => new Map(naar.map((n) => [n.id, null]));
    try {
      const res = await apiVerzoek('/api/matrix', {
        methode: 'POST',
        body: {
          origin: { lat: van.lat, lon: van.lon },
          destinations: naar.map((n) => ({ lat: n.lat, lon: n.lon })),
          departAt: vertrekIso,
        },
      });
      if (!res?.ok) return alleNull();
      const resultaten = res.data?.results ?? [];
      return new Map(naar.map((n, i) => {
        const s = resultaten[i]?.travelTimeSeconds;
        return [n.id, typeof s === 'number' && isFinite(s) ? s / 60 : null];
      }));
    } catch {
      return alleNull();
    }
  };
}
