// schermen/sales-resultaat.js — het resultaat van een bezoek ingeven: vier grote knoppen + een notitie in een venster.
// "Opnieuw langsgaan" zet de lead terug op te-plannen (planning weg, het bezoek komt in de historiek); Offerte, Verkocht en Geen interesse
// werken de lead af. De wijziging is enkel de velden die `geefResultaat` (sales/lead-regels.js) berekent; de server is de grens.
// Wordt geopend vanuit de kalender (Task 16). Alle leadgegevens gaan via textContent/value in de DOM (sales-dom.js).
import { toast } from '../kern/ui.js';
import { geefResultaat, RESULTAAT_LABEL } from '../sales/lead-regels.js';
import { salesToestand, wijzig } from './sales-data.js';
import { schrijfbaarNu } from './sales-verkoper.js';
import { openSalesVenster } from './sales-venster.js';
import { naamVan, foutTekst } from './sales-tekst.js';
import { el, veld } from './sales-dom.js';

const MAX_NOTITIE = 1000; // zelfde grens als de server (lead-regels.js)
const SOORTEN = ['offerte', 'verkocht', 'geen-interesse', 'opnieuw']; // volgorde van de knoppen

const zoekLead = (id) => salesToestand().leads.find(l => l.id === id) ?? null;

/**
 * De PATCH-inhoud voor een resultaat, op de actuele stand berekend (na een 409 opnieuw op de verse stand).
 * Geeft null als de lead intussen weg of al afgewerkt is.
 */
function resultaatPatch(leadId, soort, notitie) {
  return (stand) => {
    const lead = stand.leads.find(l => l.id === leadId);
    if (!lead || lead.status === 'afgewerkt') return null;
    const nieuw = geefResultaat(lead, { soort, notitie });
    // `planning: null` en `resultaat: null` wissen het veld (pasLeadToe); enkel een afgewerkte lead heeft een resultaat.
    return { leads: [{ id: leadId, velden: { status: nieuw.status, planning: null, resultaat: nieuw.resultaat ?? null, bezoeken: nieuw.bezoeken } }] };
  };
}

/** Opent het venster Resultaat voor een lead. -> { sluit() } of null (onbekende of al afgewerkte lead, of een alleen-lezen weergave). */
export function openResultaat(leadId) {
  const start = zoekLead(leadId);
  if (!start || start.status === 'afgewerkt' || !schrijfbaarNu()) return null;

  return openSalesVenster({
    titel: `Resultaat — ${naamVan(start)}`,
    bouw(body, sluit) {
      const fout = el('div', { class: 'sales-venster-fout', role: 'alert', hidden: true });
      const toonFout = (tekst) => { fout.textContent = tekst || ''; fout.hidden = !tekst; };
      const notitie = veld('Notitie', { soort: 'textarea', maxlength: MAX_NOTITIE, rows: 3 });
      const knoppen = SOORTEN.map(soort => el('button', {
        type: 'button', class: `btn sales-resultaat-knop sales-resultaat-${soort}`, 'data-soort': soort, text: RESULTAAT_LABEL[soort],
      }));
      let bezig = false;
      const zetBezig = (aan) => { bezig = aan; for (const k of knoppen) k.disabled = aan; };

      for (const knop of knoppen) {
        knop.addEventListener('click', async () => {
          if (bezig) return;
          toonFout('');
          zetBezig(true);
          const soort = knop.dataset.soort;
          const res = await wijzig(resultaatPatch(leadId, soort, notitie.invoer.value.trim()));
          if (!res.ok) { toonFout(foutTekst(res)); zetBezig(false); return; } // het venster blijft open met de notitie
          toast(soort === 'opnieuw' ? 'Resultaat bewaard — de lead staat weer bij "Nog in te plannen"' : `Resultaat bewaard: ${RESULTAAT_LABEL[soort]}`);
          sluit();
        });
      }

      body.append(
        el('p', { class: 'sales-uitleg', text: 'Hoe liep het bezoek? Schrijf eventueel een notitie en kies het resultaat.' }),
        fout,
        notitie.wrap,
        el('div', { class: 'sales-resultaat-knoppen' }, ...knoppen),
      );
    },
  });
}
