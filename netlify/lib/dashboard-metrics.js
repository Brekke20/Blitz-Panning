// Het performance-dashboard in één functie: ruwe bronnen in, één JSON-antwoord uit. Puur (geen I/O, geen
// klok): de handler (Taak 17) leest de blobs, deze functie rekent. De rapporten worden één keer
// genormaliseerd op de volledige lijst; periode en filters selecteren daarna.
//   - Technieker- en laadpaalfilter: kern, tijd, kwaliteit, onderdelen en de rapportgebonden delen van klant.
//   - Niet gefilterd: voorstelregister, annulatielog en sales (die kennen geen technieker of laadpaal).
//   - Herhaalbezoeken zoeken het eerdere bezoek op de volledige, ongefilterde lijst.
//   - Technieker = Zoho-naam (dashboard/techniekers.js): een rapport met twee techniekers telt in het totaal één keer en per technieker voor elk.
//   - `opties` komen uit de volledige lijst, zodat een filterkeuze nooit uit het menu verdwijnt.
// Het antwoord bevat enkel tellingen en rapportvelden, nooit gegevens van sales-leads.
// `deel` bepaalt wat de aanvrager mag zien: 'alles' (beheerder), 'techniekers' (planner: geen sales) of 'sales' (sales manager:
// enkel sales, geen techniekerdata en geen kosten). Bij een deel dat niet 'alles' is, staat `deel` in het antwoord.
import { berekenKern } from './dashboard/kern.js';
import { berekenTijd } from './dashboard/tijd.js';
import { berekenKwaliteit } from './dashboard/kwaliteit.js';
import { berekenOnderdelen } from './dashboard/onderdelen.js';
import { berekenKlant } from './dashboard/klant.js';
import { berekenSales } from './dashboard/sales.js';
import { maakKoppelaar, techniekerGroepen, NIET_GEKOPPELD } from './dashboard/techniekers.js';
import { dagenTussen, filterRapporten, inPeriode, normaliseerRapport, vorigePeriode } from './dashboard/gemeenschappelijk.js';

const STANDAARD_HERHAAL_DAGEN = 30;
const MAX_ONBEKEND = 50;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;

function controleerDatum(waarde, naam) {
  if (typeof waarde !== 'string' || !DATUM_RE.test(waarde) || new Date(`${waarde}T00:00:00Z`).toISOString().slice(0, 10) !== waarde) {
    throw new RangeError(`${naam} moet een geldige datum zijn (YYYY-MM-DD).`);
  }
}

const alfabetisch = (a, b) => a.localeCompare(b, 'nl');
// Vaste volgorde (alfabetisch): een technieker of type houdt zo dezelfde plek en kleur, ook als de periode wijzigt.
const uniek = waarden => [...new Set(waarden.filter(Boolean))].sort(alfabetisch);

// De keuzelijst Technieker: enkel Zoho-namen (gesorteerd) en, als er rapporten zijn die nergens op passen, 'Niet gekoppeld' helemaal achteraan.
function techniekerOpties(alle) {
  const namen = new Set();
  for (const r of alle) for (const t of techniekerGroepen(r)) namen.add(t);
  const heeftOnbekend = namen.delete(NIET_GEKOPPELD);
  return [...uniek([...namen]), ...(heeftOnbekend ? [NIET_GEKOPPELD] : [])];
}

// Datum, dan id: de uitkomst hangt niet af van de volgorde van de lijst (eerste voorkomen = vaste kleur).
const opDatum = (a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id);

export function berekenDashboard({
  rapporten, register, activiteit, activiteitVanaf, salesBlobs, prijslijst, techniekerBron, filters = {}, nu, deel = 'alles',
} = {}) {
  const { van, tot } = filters;
  controleerDatum(van, 'van');
  controleerDatum(tot, 'tot');
  if (dagenTussen(van, tot) < 0) throw new RangeError('van mag niet na tot liggen.');
  const vorige = vorigePeriode(van, tot);
  const gegenereerd = nu ?? new Date().toISOString();
  if (deel === 'sales') {
    // Enkel het sales-deel: de rapporten (techniekers, prijzen, loonkost) worden niet eens verwerkt.
    const sales = berekenSales({ salesBlobs, van, tot, nu: gegenereerd });
    return { versie: 1, gegenereerd, periode: { van, tot }, vorige, deel, filters: { van, tot }, sales, dekking: { sales: sales.dekking } };
  }
  const technieker = filters.technieker || '';
  const type = filters.type || '';
  const herhaalDagen = Number.isInteger(filters.herhaalDagen) && filters.herhaalDagen > 0 ? filters.herhaalDagen : STANDAARD_HERHAAL_DAGEN;

  const prijzen = new Map((Array.isArray(prijslijst?.onderdelen) ? prijslijst.onderdelen : []).filter(o => o?.id).map(o => [String(o.id), o]));
  // Zoho-namen als technieker (agenten uit Zoho, anders de zohoNaam van de accounts, anders de ruwe tekst in het rapport).
  const koppel = maakKoppelaar(techniekerBron ?? {});
  const alle = (Array.isArray(rapporten) ? rapporten : []).map(e => normaliseerRapport(e, { prijzen, koppel })).filter(Boolean).sort(opDatum);
  const onbekend = koppel ? uniek(alle.flatMap(r => r.techniekerOnbekend ?? [])) : [];

  const gefilterd = filterRapporten(alle, { technieker, type });
  const huidig = gefilterd.filter(r => inPeriode(r.datum, van, tot));
  const ervoor = gefilterd.filter(r => inPeriode(r.datum, vorige.van, vorige.tot));

  const tijd = berekenTijd(huidig);
  const kwaliteit = berekenKwaliteit({ rapporten: huidig, alle, herhaalDagen });
  const onderdelen = berekenOnderdelen(huidig);
  const klant = berekenKlant({
    rapporten: huidig, register, activiteit, activiteitVanaf, van, tot, vorigeVan: vorige.van, vorigeTot: vorige.tot, nu: gegenereerd,
  });
  const metSales = deel !== 'techniekers';
  const sales = metSales ? berekenSales({ salesBlobs, van, tot, nu: gegenereerd }) : null;

  return {
    versie: 1,
    ...(deel === 'techniekers' ? { deel } : {}),
    gegenereerd,
    periode: { van, tot },
    vorige,
    filters: { van, tot, technieker, type, herhaalDagen },
    opties: {
      techniekers: techniekerOpties(alle), types: uniek(alle.map(r => r.type)),
      // Alleen met een koppeling: de originele teksten achter 'Niet gekoppeld' (voor de uitleg in het scherm).
      ...(koppel ? { nietGekoppeld: onbekend.slice(0, MAX_ONBEKEND) } : {}),
    },
    kern: {
      huidig: berekenKern({ rapporten: huidig, alle, herhaalDagen }),
      vorige: berekenKern({ rapporten: ervoor, alle, herhaalDagen }),
    },
    tijd,
    kwaliteit,
    onderdelen,
    klant,
    ...(metSales ? { sales } : {}),
    dekking: { tijd: tijd.dekking, kwaliteit: kwaliteit.dekking, onderdelen: onderdelen.dekking, klant: klant.dekking, ...(metSales ? { sales: sales.dekking } : {}) },
  };
}
