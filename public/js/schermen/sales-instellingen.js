// schermen/sales-instellingen.js — het instellingenvenster van de verkoper (⚙ Instellingen in de verkoperbalk): startadres, werkuren,
// laatste start en standaard bezoekduur van de verkoper zelf. Bewaart via PUT /api/instellingen (zonder `gebruiker` = de eigen instellingen);
// de server vervangt het hele object, daarom vertrekt het bewaarde object van de ruwe instellingen (bouwBewaardObject).
// Een gewijzigd startadres wist niets in de leads: "Plan deze week" geocodeert het nieuwe adres bij de volgende planning.
// Alle invoer gaat via .value/textContent (sales-dom.js).
import { toast } from '../kern/ui.js';
import { salesToestand, bewaarInstellingen, laadInstellingen, instellingenGeladenVoor } from './sales-data.js';
import { kanImporteren } from './sales-verkoper.js';
import { openSalesVenster } from './sales-venster.js';
import { formulierWaarden, valideerSalesInstellingen, bouwBewaardObject } from './sales-instellingen-logica.js';
import { foutTekst } from './sales-tekst.js';
import { el, veld } from './sales-dom.js';

export const INSTELLINGEN_NIET_GELADEN = 'Je instellingen konden niet geladen worden, dus je kunt ze nu niet wijzigen. Probeer het opnieuw.';

/** Opent het venster. -> { sluit() } of null als dit niet de eigen leads van de verkoper zijn (beheerder, weergave van een collega). */
export function openSalesInstellingen() {
  if (!kanImporteren()) return null;
  const geladen = instellingenGeladenVoor(); // eigen instellingen (de knop bestaat enkel bij de eigen leads)
  const w = formulierWaarden(salesToestand().instellingen);

  return openSalesVenster({
    titel: 'Instellingen',
    bouw(body, sluit) {
      // Eindreview I1: zijn de instellingen niet van de server geladen, dan tonen we geen formulier met standaarden (bewaren zou de echte
      // instellingen overschrijven) maar een melding met "Opnieuw proberen" (laadt opnieuw en opent dan het venster) en Sluiten.
      if (!geladen) {
        const opnieuw = el('button', { type: 'button', class: 'btn btn--primary sales-instellingen-opnieuw', text: 'Opnieuw proberen' });
        const dicht = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Sluiten' });
        dicht.addEventListener('click', () => sluit());
        opnieuw.addEventListener('click', async () => {
          opnieuw.disabled = true;
          const r = await laadInstellingen();
          if (r.ok) { sluit(); openSalesInstellingen(); return; }
          opnieuw.disabled = false;
          toonFoutTekst(INSTELLINGEN_NIET_GELADEN);
        });
        const melding = el('div', { class: 'sales-venster-fout', role: 'alert', text: INSTELLINGEN_NIET_GELADEN });
        const toonFoutTekst = (tekst) => { melding.textContent = tekst; };
        body.append(melding, el('div', { class: 'sales-acties' }, dicht, opnieuw));
        return;
      }
      const fout = el('div', { class: 'sales-venster-fout', role: 'alert', hidden: true });
      const toonFout = (tekst) => { fout.textContent = tekst || ''; fout.hidden = !tekst; };

      const startadres = veld('Startadres', { value: w.startlocatie, maxlength: 200, autocomplete: 'off' });
      const hint = el('div', { class: 'sales-uitleg', text: 'Straat + nummer + plaats, of enkel een postcode.' });
      const van = veld('Werkuren van', { soort: 'time', value: w.vanTijd });
      const tot = veld('Werkuren tot', { soort: 'time', value: w.totTijd });
      const laatste = veld('Laatste start', { soort: 'time', value: w.laatsteStart });
      const duur = veld('Standaard bezoekduur (min)', { value: w.bezoekDuurMin, inputmode: 'numeric', autocomplete: 'off' });

      const bewaar = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Bewaren' });
      const annuleer = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Annuleren' });
      annuleer.addEventListener('click', () => sluit());
      const form = el('form', { class: 'sales-form', novalidate: true },
        startadres.wrap, hint,
        el('div', { class: 'sales-rij' }, van.wrap, tot.wrap),
        el('div', { class: 'sales-rij' }, laatste.wrap, duur.wrap),
        el('div', { class: 'sales-acties' }, annuleer, bewaar));

      let bezig = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (bezig) return;
        toonFout('');
        if (!instellingenGeladenVoor()) { toonFout(INSTELLINGEN_NIET_GELADEN); return; } // nooit bewaren zonder de geladen serverinstellingen
        const ingevoerd = {
          startlocatie: startadres.invoer.value, vanTijd: van.invoer.value, totTijd: tot.invoer.value,
          laatsteStart: laatste.invoer.value, bezoekDuurMin: duur.invoer.value,
        };
        const r = valideerSalesInstellingen(ingevoerd);
        if (r.fout) { toonFout(r.fout); return; }
        bezig = true;
        bewaar.disabled = true;
        const res = await bewaarInstellingen(bouwBewaardObject(salesToestand().instellingenRuw, r.waarden, ingevoerd));
        if (!res.ok) { // 400-tekst van de server, 403 of opslagstoring: in het venster, dat open blijft met wat er stond
          toonFout(foutTekst(res));
          bezig = false;
          bewaar.disabled = false;
          return;
        }
        toast('Instellingen bewaard');
        sluit();
        laadInstellingen().catch(() => {}); // de server bewaart een opgeschoond object: de toestand volgt de serverstand
      });
      body.append(fout, form);
    },
  });
}
