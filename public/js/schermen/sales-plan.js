// schermen/sales-plan.js — "⚡ Plan deze week" voor de verkoper: het planner-brein (planner.js, ongewijzigd) stelt voor, de verkoper belt.
// Stappen: instellingen van de getoonde verkoper laden, depot bepalen (startlocatie), invoer bouwen (sales/planner-adapter.js), planWeek,
// uitkomst omzetten en in ÉÉN wijzig({ leads }) bewaren, daarna het resultaatvenster. Geen Zoho-aanroepen, geen mails.
// Een vaste lead (bevestigd of vastgezet uur) is nooit kandidaat: de adapter zet hem als bestaand bezoek met uur in de planning,
// dus het brein plant eromheen en verschuift hem nooit (ook niet buiten de werkuren of op een volle dag).
import { toast } from '../kern/ui.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { apiVerzoek } from '../kern/api.js';
import { geocacheLookup, geocacheStore } from '../kern/opslag.js';
import { getHolidayName } from '../kern/feestdagen.js';
import { localISO, fmtDateShort } from '../kern/tijd.js';
import { planWeek } from '../planner.js';
import { isVast } from '../sales/lead-regels.js';
import { bouwPlanInvoer, verwerkUitkomst, maakReistijdenAdapter } from '../sales/planner-adapter.js';
import { salesToestand, gekozenDatum, wijzig, laadInstellingen } from './sales-data.js';
import { getoondeVerkoper, schrijfbaarNu } from './sales-verkoper.js';
import { huidigeGebruiker } from '../kern/sessie.js';
import { openSalesVenster } from './sales-venster.js';
import { bouwResultaatRegels, weekStartVan } from './sales-plan-logica.js';
import { foutTekst } from './sales-tekst.js';
import { el, sectie } from './sales-dom.js';

const GEEN_START = 'Geen startlocatie ingesteld: de ritten starten bij het eerste bezoek. Stel je startadres in via ⚙ Instellingen.';
const START_NIET_GEVONDEN = 'De startlocatie kon niet opgezocht worden: de ritten starten bij het eerste bezoek. Controleer je startadres via ⚙ Instellingen.';
const CONFLICT = 'Planning niet bewaard: de gegevens waren intussen gewijzigd. Plan opnieuw.';

let bezig = false;

/** Het depot (lat/lon) van de startlocatie: eerst de geocode-cache, daarna (niet in testmodus) /api/optimize; anders null. */
async function bepaalDepot(startlocatie) {
  const hit = geocacheLookup(startlocatie);
  if (hit) return hit;
  if (TEST_MODE) return null;
  try {
    // /api/optimize vraagt minstens één stop; de startlocatie zelf volstaat (locations[0] is het vertrekpunt).
    const r = await apiVerzoek('/api/optimize', { methode: 'POST', body: { origin: startlocatie, stops: [startlocatie] } });
    const loc = r.ok ? r.data?.locations?.[0] : null;
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
      geocacheStore(startlocatie, loc.lat, loc.lon);
      return { lat: loc.lat, lon: loc.lon };
    }
  } catch { /* geen netwerk: geen depot */ }
  return null;
}

/** Het venster "Planningsresultaat": regels = { ingepland, nietIngepland, waarschuwingen, bericht? } (zie bouwResultaatRegels). */
export function toonPlanResultaat(regels) {
  return openSalesVenster({
    titel: 'Planningsresultaat',
    bouw(body, sluit) {
      if (regels.bericht) body.append(el('p', { class: 'sales-uitleg', text: regels.bericht }));
      for (const w of regels.waarschuwingen ?? []) body.append(el('p', { class: 'sales-uitleg sales-plan-waarschuwing', text: `⚠ ${w}` }));
      const rij = (tekst, extra) => el('li', { class: 'sales-plan-rij' }, el('span', { text: tekst }), extra ? el('div', { class: 'sales-plan-reden', text: extra }) : null);
      if (regels.ingepland?.length) {
        body.append(sectie(`Ingepland (${regels.ingepland.length})`, 'sales-plan-ingepland',
          el('ul', { class: 'sales-plan-lijst' }, ...regels.ingepland.map((r) => rij(`${r.naam} → ${r.datumLabel} ${r.start}`)))));
      }
      if (regels.nietIngepland?.length) {
        body.append(sectie(`Niet ingepland (${regels.nietIngepland.length})`, 'sales-plan-niet',
          el('ul', { class: 'sales-plan-lijst' }, ...regels.nietIngepland.map((r) => rij(r.naam, r.tekst)))));
      }
      if (!regels.ingepland?.length && !regels.nietIngepland?.length) body.append(el('p', { class: 'sales-uitleg', text: 'Er was niets te plannen.' }));
      const ok = el('button', { type: 'button', class: 'btn btn--primary', text: 'Klaar' });
      ok.addEventListener('click', sluit);
      body.append(el('div', { class: 'sales-acties' }, ok));
    },
  });
}

/**
 * Plant de week van de gekozen dag voor de getoonde verkoper. `maandweergave`: de agenda toonde een maand; dan plannen we de week van de
 * gekozen dag en zegt het resultaatvenster dat. Doet niets als er al een planning bezig is of de weergave alleen-lezen is.
 */
export async function planDezeWeek({ maandweergave = false } = {}) {
  if (bezig) return;
  if (!schrijfbaarNu()) return toast('Alleen lezen: je kunt de planning van een andere verkoper niet wijzigen.');
  bezig = true;
  try {
    const verkoper = getoondeVerkoper();
    const gebruikerId = verkoper.id && verkoper.id !== huidigeGebruiker()?.id ? verkoper.id : undefined; // zoals de schil: het eigen blob heeft geen ?gebruiker=
    await laadInstellingen({ gebruikerId }); // een mislukte lading houdt de huidige (of standaard)instellingen
    const stand = salesToestand();
    const inst = stand.instellingen;

    const weekStart = weekStartVan(gekozenDatum());
    const weekEinde = new Date(weekStart);
    weekEinde.setDate(weekStart.getDate() + 6);
    const vandaag = localISO(new Date());
    if (localISO(weekEinde) < vandaag) {
      return toast(`ℹ De week van ${fmtDateShort(weekStart)} t/m ${fmtDateShort(weekEinde)} is voorbij: kies een huidige of latere week`, 5000);
    }
    const bericht = maandweergave ? `ℹ Maandweergave: je plant de week van ${fmtDateShort(weekStart)} t/m ${fmtDateShort(weekEinde)} (de week van de gekozen dag).` : null;

    const startlocatie = typeof inst.startlocatie === 'string' ? inst.startlocatie.trim() : '';
    const depot = startlocatie ? await bepaalDepot(startlocatie) : null;

    const leads = stand.leads;
    const { invoer, vrijgegeven } = bouwPlanInvoer({
      leads, blokken: stand.blokken, instellingen: inst, weekStart: localISO(weekStart), vandaag, depot,
      reistijden: maakReistijdenAdapter({ apiVerzoek, testModus: TEST_MODE }), feestdag: getHolidayName,
    });
    if (!invoer.kandidaten.length) return toast('Geen leads om in te plannen');

    const uitkomst = await planWeek(invoer);
    const overzicht = verwerkUitkomst({ uitkomst, leads, vrijgegeven });

    // Eén schrijfactie. Na een 409 wordt opnieuw gefilterd op de verse stand: een lead die intussen vast, afgewerkt of weg is, blijft ongemoeid.
    if (overzicht.wijzigingen.length) {
      const r = await wijzig((nu) => {
        const bruikbaar = overzicht.wijzigingen.filter((w) => {
          const l = nu.leads.find((x) => x.id === w.id);
          return l && !isVast(l) && (l.status === 'te-plannen' || l.status === 'voorgesteld');
        });
        return bruikbaar.length ? { leads: bruikbaar.map((w) => ({ id: w.id, velden: w.velden })) } : null;
      });
      if (!r.ok) return toast(r.reden === 'conflict' || r.reden === 'vervallen' ? CONFLICT : foutTekst(r), 6000);
    }

    const regels = bouwResultaatRegels({ overzicht, leads, opties: { maxReistijdMin: invoer.instellingen.maxReistijdMin, laatsteStart: invoer.instellingen.laatsteStart } });
    toonPlanResultaat({ ...regels, ...(bericht ? { bericht } : {}) });
    if (!startlocatie) toast(GEEN_START, 8000);
    else if (!depot) toast(START_NIET_GEVONDEN, 8000);
  } catch (fout) {
    toast(`✕ Plannen is mislukt: ${fout?.message ?? 'onbekende fout'}`, 6000);
  } finally {
    bezig = false;
  }
}
