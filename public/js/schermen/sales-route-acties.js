// schermen/sales-route-acties.js — de schrijfacties achter "⚡ Optimaliseer" en "✕ Leeg" op de Route-tab van de verkoper (de rekenregels staan in
// sales-route-optimaliseer.js). Beide doen ÉÉN wijzig()-schrijfactie op de verse stand (zoals "Plan deze week"): een bezoek dat intussen vast, afgewerkt of
// weg is, blijft ongemoeid. "Bereken tijden" zit in sales-route.js zelf (het berekent enkel de route opnieuw en bewaart niets).
import { toast } from '../kern/ui.js';
import { apiVerzoek } from '../kern/api.js';
import { appConfirm } from '../app-dialog.js';
import { timeStrToMin } from '../kern/tijd.js';
import { huidigeGebruiker } from '../kern/sessie.js';
import { isVast } from '../sales/lead-regels.js';
import { maakReistijdenAdapter } from '../sales/planner-adapter.js';
import { salesToestand, wijzig, laadInstellingen, instellingenGeladenVoor } from './sales-data.js';
import { getoondeVerkoper, schrijfbaarNu } from './sales-verkoper.js';
import { bouwRouteStops, vertrekIso } from './sales-route-logica.js';
import { optimaliseerDag, kiesLeegTeMaken, DEPOT_ID } from './sales-route-optimaliseer.js';
import { dagLabel, foutTekst } from './sales-tekst.js';

const ALLEEN_LEZEN = 'Alleen lezen: je kunt de planning van een andere verkoper niet wijzigen.';
const CONFLICT = 'Niet bewaard: de gegevens waren intussen gewijzigd. Probeer het opnieuw.';
const INSTELLINGEN_FOUT = 'De instellingen van deze verkoper konden niet geladen worden: er is niets gewijzigd. Probeer het opnieuw.';
const bezoeken = (n) => (n === 1 ? '1 bezoek' : `${n} bezoeken`);
const bevestigde = (n) => (n === 1 ? '1 bevestigd bezoek' : `${n} bevestigde bezoeken`);

let bezigOptimaliseren = false;
let bezigLeeg = false;

/** De reistijden tussen alle punten (depot + bezoeken met locatie) als rit(vanId, naarId) -> minuten | null, uit /api/matrix (zoals het planner-brein). */
async function haalRitten({ depot, stops, vertrekIsoTijd }) {
  const knopen = [];
  if (depot) knopen.push({ id: DEPOT_ID, lat: depot.lat, lon: depot.lon });
  for (const s of stops) if (s.locatie) knopen.push({ id: s.leadId, lat: s.locatie.lat, lon: s.locatie.lon });
  const adapter = maakReistijdenAdapter({ apiVerzoek, testModus: false });
  const tabel = new Map();
  await Promise.all(knopen.map(async (van) => {
    const naar = knopen.filter((k) => k.id !== van.id);
    if (!naar.length) return;
    const antwoord = await adapter(van, naar, vertrekIsoTijd);
    for (const [naarId, min] of antwoord) tabel.set(`${van.id}>${naarId}`, min);
  }));
  return (vanId, naarId) => tabel.get(`${vanId}>${naarId}`) ?? null;
}

/**
 * ⚡ Optimaliseer: herordent de bezoeken van `datum` voor de kortste route; vaste bezoeken blijven op hun uur. `depot` = { lat, lon } | null (het startadres).
 * Eén schrijfactie; toast met wat er veranderde. Niets doen (en melden) bij minder dan 2 verschuifbare bezoeken of als de dag niet in de werkdag past.
 */
export async function optimaliseerRoute({ datum, depot }) {
  if (bezigOptimaliseren) return;
  if (!schrijfbaarNu()) return toast(ALLEEN_LEZEN);
  bezigOptimaliseren = true;
  try {
    const verkoper = getoondeVerkoper();
    const gebruikerId = verkoper.id && verkoper.id !== huidigeGebruiker()?.id ? verkoper.id : undefined; // zoals "Plan deze week"
    await laadInstellingen({ gebruikerId });
    if (!instellingenGeladenVoor(gebruikerId)) return toast(INSTELLINGEN_FOUT, 6000);
    const stand = salesToestand();
    const inst = stand.instellingen;
    const stops = bouwRouteStops(stand.leads, datum, { standaardDuurMin: inst.bezoekDuurMin });
    if (stops.filter((s) => !s.vast).length < 2) return toast('Minstens 2 verschuifbare bezoeken nodig om te optimaliseren');

    toast('Route optimaliseren...', 8000);
    const vanTijd = inst.vanTijd || '08:00';
    const rit = await haalRitten({ depot, stops, vertrekIsoTijd: vertrekIso(datum, depot ? timeStrToMin(vanTijd) : stops[0]?.startMin) });
    const r = optimaliseerDag({ stops, depot, rit, vanTijd, laatsteStart: inst.laatsteStart });
    if (!r.ok) {
      return toast(r.reden === 'te-laat'
        ? `⚠ Optimaliseren past niet binnen de werkdag (laatste start ${r.laatsteStart}) — niets gewijzigd`
        : 'Minstens 2 verschuifbare bezoeken nodig om te optimaliseren', 6000);
    }
    const vastAantal = r.volgorde.filter((v) => v.vast).length;
    const vastTekst = vastAantal ? ` · ${bevestigde(vastAantal)} ${vastAantal === 1 ? 'blijft op zijn' : 'blijven op hun'} uur` : '';
    if (!r.wijzigingen.length) return toast(`✓ De route staat al op de kortste volgorde — niets gewijzigd${vastTekst}`, 5000);

    // Eén schrijfactie, alles of niets: is er intussen een bezoek vast, afgewerkt of weg (409), dan stopt het hier in plaats van een halve herordening te bewaren.
    const w = await wijzig((nu) => {
      const klaar = r.wijzigingen.every((x) => {
        const l = nu.leads.find((y) => y.id === x.leadId);
        return l && !isVast(l) && l.status === 'voorgesteld' && l.planning?.datum === datum;
      });
      return klaar ? { leads: r.wijzigingen.map((x) => ({ id: x.leadId, velden: { status: 'voorgesteld', planning: { datum, start: x.start, vast: false } } })) } : null;
    });
    if (!w.ok) return toast(w.reden === 'conflict' || w.reden === 'vervallen' ? CONFLICT : foutTekst(w), 6000);
    const rijtijd = r.rijtijdNa < r.rijtijdVoor ? ` · rijtijd ${r.rijtijdVoor} → ${r.rijtijdNa} min` : '';
    toast(`✓ Route geoptimaliseerd: ${bezoeken(r.wijzigingen.length)} herordend${rijtijd}${vastTekst}`, 6000);
  } catch (fout) {
    toast(`✕ Optimaliseren is mislukt: ${fout?.message ?? 'onbekende fout'}`, 6000);
  } finally {
    bezigOptimaliseren = false;
  }
}

/**
 * ✕ Leeg: alle niet-vaste bezoeken van `datum` gaan terug naar "Nog in te plannen", na bevestiging. Vaste (bevestigde of vastgezette) bezoeken blijven staan.
 */
export async function maakDagLeeg({ datum }) {
  if (bezigLeeg) return;
  if (!schrijfbaarNu()) return toast(ALLEEN_LEZEN);
  const { vrij, vast } = kiesLeegTeMaken(salesToestand().leads, datum);
  if (!vrij.length) {
    if (vast) toast(`${bevestigde(vast)} niet verwijderd — zet ze afzonderlijk terug`, 7000);
    return;
  }
  bezigLeeg = true;
  try {
    const doorgaan = await appConfirm({
      titel: 'Dag leegmaken',
      tekst: `${bezoeken(vrij.length)} van ${dagLabel(datum)} terug naar Nog in te plannen?`,
      bevestigLabel: 'Terugzetten',
      gevaar: true,
    });
    if (!doorgaan) return;
    // Op de verse stand opnieuw bepaald (na een 409 of een wijziging tijdens het venster): enkel wat nog niet vast is.
    let teruggezet = 0;
    let blijft = 0;
    const w = await wijzig((nu) => {
      const k = kiesLeegTeMaken(nu.leads, datum);
      teruggezet = k.vrij.length;
      blijft = k.vast;
      return k.vrij.length ? { leads: k.vrij.map((id) => ({ id, velden: { status: 'te-plannen', planning: null, resultaat: null } })) } : null;
    });
    if (!w.ok) return toast(w.reden === 'conflict' || w.reden === 'vervallen' ? CONFLICT : foutTekst(w), 6000);
    const rest = blijft ? ` · ${bevestigde(blijft)} niet verwijderd — zet ze afzonderlijk terug` : '';
    toast(`✓ ${bezoeken(teruggezet)} van ${dagLabel(datum)} terug naar Nog in te plannen${rest}`, blijft ? 8000 : 5000);
  } catch (fout) {
    toast(`✕ Leegmaken is mislukt: ${fout?.message ?? 'onbekende fout'}`, 6000);
  } finally {
    bezigLeeg = false;
  }
}
