// schermen/sales-instellingen.js — het instellingenvenster van de verkoper (⚙ Instellingen in de verkoperbalk): startadres, werkuren,
// laatste start en standaard bezoekduur van de verkoper zelf. Bewaart via PUT /api/instellingen (zonder `gebruiker` = de eigen instellingen);
// de server vervangt het hele object, daarom vertrekt het bewaarde object van de ruwe instellingen (bouwBewaardObject).
// Een gewijzigd startadres wist niets in de leads: "Plan deze week" geocodeert het nieuwe adres bij de volgende planning.
// Alle invoer gaat via .value/textContent (sales-dom.js).
import { toast } from '../kern/ui.js';
import { salesToestand, bewaarInstellingen, laadInstellingen } from './sales-data.js';
import { kanImporteren } from './sales-verkoper.js';
import { openSalesVenster } from './sales-venster.js';
import { formulierWaarden, valideerSalesInstellingen, bouwBewaardObject } from './sales-instellingen-logica.js';
import { foutTekst } from './sales-tekst.js';
import { el, veld } from './sales-dom.js';

/** Opent het venster. -> { sluit() } of null als dit niet de eigen leads van de verkoper zijn (beheerder, weergave van een collega). */
export function openSalesInstellingen() {
  if (!kanImporteren()) return null;
  const w = formulierWaarden(salesToestand().instellingen);

  return openSalesVenster({
    titel: 'Instellingen',
    bouw(body, sluit) {
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
