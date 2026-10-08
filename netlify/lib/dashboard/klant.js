// Klant en planning van het performance-dashboard: bevestigingssnelheid van voorstellen, % bevestigd via
// de knop, annulaties, garantie versus klant en "Installateur al langs geweest". Pure functies (geen I/O).
import { berekenLoonkost } from '../../../public/js/kern/loonkost.js';
import { datumInBrussel } from '../bevestigingslink.js';
import { gemiddelde, inPeriode, mediaan, pct } from './gemeenschappelijk.js';
import { waardeTotaal } from './onderdelen.js';

const DOELGROEPEN = ['contact', 'klant', 'installateur'];
const LINK_LEVENSDUUR_MS = 14 * 86400000; // levensduur van de bevestigingslink
const BUCKETS = [
  { label: '<1u', tot: 60 }, { label: '1–4u', tot: 240 }, { label: '4–24u', tot: 1440 },
  { label: '1–3d', tot: 4320 }, { label: '>3d', tot: Infinity },
];

// Leeg of ongeldig tijdstip -> null (new Date(null) zou 1970 zijn).
const ms = iso => { if (iso == null || iso === '') return null; const t = new Date(iso).getTime(); return Number.isNaN(t) ? null : t; };
const afgerond = n => Math.round(n * 10) / 10;

// Voorstellen waarvan het vroegste verzendtijdstip (Brusselse datum) in de periode valt.
// Zonder verzendtijdstip bestaat er geen voorstel. Snelheid = bevestiging min het verzendtijdstip van de
// doelgroep die bevestigde; weg als `door` of dat tijdstip ontbreekt.
export function voorstellen(register, { van, tot, nu }) {
  const nuMs = ms(nu ?? new Date().toISOString());
  const uit = [];
  for (const [ticketId, rij] of Object.entries(register?.status || {})) {
    const verzonden = DOELGROEPEN.map(d => ms(rij?.[d])).filter(t => t !== null);
    if (!verzonden.length) continue;
    const eerste = Math.min(...verzonden);
    const verstuurd = new Date(eerste).toISOString();
    const datum = datumInBrussel(verstuurd);
    if (!inPeriode(datum, van, tot)) continue;
    const bevestigd = rij.bevestigd && ms(rij.bevestigd.tijdstip) !== null ? rij.bevestigd : null;
    const door = bevestigd ? (DOELGROEPEN.includes(bevestigd.door) ? bevestigd.door : null) : null;
    const start = door ? ms(rij[door]) : null;
    const snelheid = bevestigd && start !== null ? Math.round((ms(bevestigd.tijdstip) - start) / 60000) : null;
    uit.push({
      ticketId, verstuurd, datum,
      bevestigdOp: bevestigd ? bevestigd.tijdstip : null,
      door,
      snelheidMin: snelheid !== null && snelheid >= 0 ? snelheid : null,
      lopend: !bevestigd && nuMs !== null && nuMs - eerste < LINK_LEVENSDUUR_MS,
    });
  }
  return uit.sort((a, b) => a.verstuurd.localeCompare(b.verstuurd) || a.ticketId.localeCompare(b.ticketId));
}

function bevestiging(lijst) {
  const bevestigd = lijst.filter(v => v.bevestigdOp);
  const snelheden = bevestigd.map(v => v.snelheidMin).filter(s => s !== null);
  const buckets = BUCKETS.map(b => ({ label: b.label, n: 0 }));
  for (const s of snelheden) buckets[BUCKETS.findIndex(b => s < b.tot)].n++;
  const gem = gemiddelde(snelheden), med = mediaan(snelheden);
  return {
    n: bevestigd.length, mediaanMin: med === null ? null : afgerond(med), gemiddeldeMin: gem === null ? null : afgerond(gem),
    nMetSnelheid: snelheden.length, buckets,
  };
}

// Annulaties uit het activiteitenlog (UTC-tijdstip, dus per Brusselse datum geteld). `beschikbaar` gaat
// enkel over de vergelijking met de vorige periode: het log loopt al sinds voor het begin van de vorige
// periode. `aantal` van de gekozen periode blijft geldig (het log kent niets van vóór `vanaf`, dat toont de UI).
function annulaties({ activiteit, activiteitVanaf, van, tot, vorigeVan, vorigeTot }) {
  const datums = (activiteit || []).filter(a => a?.actie === 'annulatie').map(a => datumInBrussel(a.op)).filter(Boolean);
  const vanaf = datumInBrussel(activiteitVanaf);
  return {
    aantal: datums.filter(d => inPeriode(d, van, tot)).length,
    vorige: vorigeVan && vorigeTot ? datums.filter(d => inPeriode(d, vorigeVan, vorigeTot)).length : 0,
    beschikbaar: vanaf !== null && (vorigeVan ? vorigeVan >= vanaf : van >= vanaf),
    vanaf,
  };
}

function garantie(rapporten) {
  const interventies = rapporten.filter(r => r.interventieType === 'Interventie');
  const groepen = {
    garantie: interventies.filter(r => r.servicetype === 'garantie'),
    overig: interventies.filter(r => r.servicetype !== 'garantie'),
  };
  const loon = lijst => lijst.filter(r => typeof r.werktijdMin === 'number')
    .reduce((s, r) => s + berekenLoonkost(r.servicetype, r.werktijdMin, r.aanrijtijdMin ?? 0).bruto, 0);
  return {
    n: interventies.length,
    garantie: groepen.garantie.length,
    pct: pct(groepen.garantie.length, interventies.length),
    onderdelenWaarde: { garantie: waardeTotaal(groepen.garantie).waarde, overig: waardeTotaal(groepen.overig).waarde },
    loon: { garantie: loon(groepen.garantie), overig: loon(groepen.overig) },
    zonderWerktijd: interventies.filter(r => typeof r.werktijdMin !== 'number').length,
  };
}

function perGroep(bekend, veld) {
  const groepen = new Map();
  for (const r of bekend) {
    if (r[veld] === null) continue;
    const g = groepen.get(r[veld]) || { label: r[veld], n: 0, ja: 0 };
    g.n++;
    if (r.alLangs === true) g.ja++;
    groepen.set(r[veld], g);
  }
  return [...groepen.values()].sort((a, b) => b.n - a.n);
}

// Zoho-veld "Installateur al langs geweest" (Rapport.alLangs): onbekend telt nergens mee. Geldt voor alle
// bezoeken, niet enkel interventies. In `berekenKlant`: dekking.partnerRegioTotaal = rapporten met een
// bekend antwoord (de noemer van de uitsplitsing); partnerRegioMetVeld = daarvan de rapporten waar partner
// of regio is bewaard (oudere rapporten hebben die niet en vallen weg in perPartner/perRegio).
function installateurAlLangs(rapporten) {
  const bekend = rapporten.filter(r => r.alLangs === true || r.alLangs === false);
  const ja = bekend.filter(r => r.alLangs === true).length;
  return {
    n: bekend.length, ja, nee: bekend.length - ja, onbekend: rapporten.length - bekend.length, pct: pct(ja, bekend.length),
    perPartner: perGroep(bekend, 'partner'), perRegio: perGroep(bekend, 'regio'),
    bekend,
  };
}

export function berekenKlant({ rapporten, register, activiteit, activiteitVanaf, van, tot, vorigeVan, vorigeTot, nu }) {
  const lijst = voorstellen(register, { van, tot, nu });
  const lopend = lijst.filter(v => v.lopend);
  const teller = lijst.filter(v => v.bevestigdOp).length;
  const { bekend, ...alLangs } = installateurAlLangs(rapporten);
  const ann = annulaties({ activiteit, activiteitVanaf, van, tot, vorigeVan, vorigeTot });
  return {
    bevestiging: bevestiging(lijst),
    bevestigdViaKnop: { n: lijst.length - lopend.length, bevestigd: teller, pct: pct(teller, lijst.length - lopend.length) },
    annulaties: ann,
    garantie: garantie(rapporten),
    installateurAlLangs: alLangs,
    dekking: {
      voorstellen: lijst.length, lopend: lopend.length, annulatiesVanaf: ann.vanaf, alLangsOnbekend: alLangs.onbekend,
      partnerRegioMetVeld: bekend.filter(r => r.partner !== null || r.regio !== null).length, partnerRegioTotaal: bekend.length,
    },
  };
}
