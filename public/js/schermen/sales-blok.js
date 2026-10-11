// schermen/sales-blok.js — het venster "Blok toevoegen" (verlof, kantoor of afspraak): datum, van/tot of "Hele dag", soort en omschrijving.
// Een hele dag is 00:00–23:59 (zie isHeleDag in sales/blok-regels.js). De server valideert opnieuw (valideerBlok); dit is de weergave.
import { valideerBlok, BLOK_SOORTEN } from '../sales/blok-regels.js';
import { localISO } from '../kern/tijd.js';
import { gekozenDatum, wijzig } from './sales-data.js';
import { openSalesVenster } from './sales-venster.js';
import { foutTekst } from './sales-tekst.js';
import { el, veld } from './sales-dom.js';

const SOORT_LABEL = { verlof: 'Verlof', kantoor: 'Kantoor', afspraak: 'Afspraak' };
const STANDAARD_VAN = '09:00';
const STANDAARD_TOT = '12:00';

/** Opent het venster; `datum` (ISO) vult de datum vooraf in, anders de gekozen dag van de agenda. -> { sluit() } */
export function openBlokVenster({ datum } = {}) {
  return openSalesVenster({
    titel: 'Blok toevoegen',
    bouw(body, sluit) {
      const fout = el('div', { class: 'sales-venster-fout', role: 'alert', hidden: true });
      const toonFout = (tekst) => { fout.textContent = tekst || ''; fout.hidden = !tekst; };

      const dag = veld('Datum', { soort: 'date', value: datum || gekozenDatum() || localISO(new Date()), verplicht: true });
      const heleDagId = 'sales-blok-hele-dag';
      const heleDag = el('input', { type: 'checkbox', id: heleDagId });
      const heleDagRij = el('div', { class: 'sales-veld sales-veld-vink' }, heleDag, el('label', { for: heleDagId, text: 'Hele dag' }));
      const van = veld('Van', { soort: 'time', value: STANDAARD_VAN });
      const tot = veld('Tot', { soort: 'time', value: STANDAARD_TOT });
      const soort = el('select', { id: 'sales-blok-soort' });
      for (const s of BLOK_SOORTEN) soort.append(el('option', { value: s, text: SOORT_LABEL[s] ?? s }));
      const soortVeld = el('div', { class: 'sales-veld' }, el('label', { for: 'sales-blok-soort', text: 'Soort' }), soort);
      const omschrijving = veld('Omschrijving', { value: '', maxlength: 200, autocomplete: 'off' });
      const opslaan = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Opslaan' });

      heleDag.addEventListener('change', () => { van.invoer.disabled = tot.invoer.disabled = heleDag.checked; });

      const form = el('form', { class: 'sales-form', novalidate: true },
        dag.wrap, heleDagRij, el('div', { class: 'sales-rij' }, van.wrap, tot.wrap), soortVeld, omschrijving.wrap,
        el('div', { class: 'sales-acties' }, opslaan));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        toonFout('');
        const blok = {
          datum: dag.invoer.value,
          start: heleDag.checked ? '00:00' : van.invoer.value,
          eind: heleDag.checked ? '23:59' : tot.invoer.value,
          soort: soort.value,
        };
        const tekst = omschrijving.invoer.value.trim();
        if (tekst) blok.omschrijving = tekst;
        const r = valideerBlok(blok);
        if (r.fout) return toonFout(r.fout);
        opslaan.disabled = true;
        const res = await wijzig({ blokken: { toevoegen: [r.blok] } });
        if (!res.ok) { toonFout(foutTekst(res)); opslaan.disabled = false; return; } // het venster blijft open met wat er stond
        sluit();
      });
      body.append(fout, form);
    },
  });
}
