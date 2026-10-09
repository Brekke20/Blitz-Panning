// schermen/sales-lead-toevoegen.js — het venster "Lead toevoegen" (knop "+ Lead" in Leads): de verkoper tikt een lead zelf in (telefoon,
// beurs, doorverwijzing). Minimum: een naam (voornaam of naam), een gsm-nummer of e-mailadres en een postcode; de rest is optioneel en later aan te
// vullen in de fiche. De lead gaat als export-object met bron 'manueel' naar POST /api/sales-import (dezelfde herkenning, grafstenen en geocoding
// als een JSON-export; de server dwingt het minimum ook af). Bestaat de klant al: melding en de bestaande fiche openen, niets dubbel.
// Alle invoer gaat enkel via value/textContent (sales-dom.js).
import { toast } from '../kern/ui.js';
import { valideerManueleLead, bouwManueelExport, zoekBestaandeLead } from '../sales/manueel.js';
import { salesToestand, importeer, vulLocatiesAan } from './sales-data.js';
import { openSalesVenster } from './sales-venster.js';
import { openLeadDetail } from './sales-detail.js';
import { foutTekst } from './sales-tekst.js';
import { el, veld } from './sales-dom.js';

const MAX_AANVUL_RONDES = 3; // één lead: een paar rondes volstaan; daarna probeert een volgende import of wijziging het opnieuw

/** Opent het venster. `terugFocus()` zet de focus terug op de knop "+ Lead" na het sluiten. -> { sluit() } */
export function openLeadToevoegen({ terugFocus } = {}) {
  let naFocus = null;
  const handle = openSalesVenster({
    titel: 'Lead toevoegen',
    bouw(body, sluit) {
      const voornaam = veld('Voornaam', { value: '', maxlength: 200, autocomplete: 'off', verplicht: true });
      const naam = veld('Naam', { value: '', maxlength: 200, autocomplete: 'off', verplicht: true });
      const gsm = veld('Gsm', { soort: 'tel', maxlength: 200, autocomplete: 'off', inputmode: 'tel', verplicht: true });
      const email = veld('E-mail', { soort: 'email', maxlength: 200, autocomplete: 'off', inputmode: 'email', verplicht: true });
      const postcode = veld('Postcode', { maxlength: 10, autocomplete: 'off', inputmode: 'numeric', verplicht: true });
      const gemeente = veld('Gemeente', { maxlength: 200, autocomplete: 'off' });
      const straat = veld('Straat', { maxlength: 200, autocomplete: 'off' });
      const huisnr = veld('Huisnr', { maxlength: 200, autocomplete: 'off' });
      const notitie = veld('Notitie', { soort: 'textarea', maxlength: 1000, rows: 3 });
      const velden = { voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, notitie };

      const fout = el('div', { class: 'sales-venster-fout', role: 'alert', hidden: true });
      const opslaan = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Opslaan' });
      const annuleer = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Annuleren' });
      annuleer.addEventListener('click', () => sluit());

      const form = el('form', { class: 'sales-form', novalidate: true },
        el('p', { class: 'sales-uitleg', text: '* verplicht: een naam (voornaam of naam volstaat), een gsm-nummer of e-mailadres (één van de twee volstaat) en een postcode.' }),
        el('div', { class: 'sales-rij' }, voornaam.wrap, naam.wrap),
        el('div', { class: 'sales-rij' }, gsm.wrap, email.wrap),
        el('div', { class: 'sales-rij' }, postcode.wrap, gemeente.wrap),
        el('div', { class: 'sales-rij' }, straat.wrap, huisnr.wrap),
        notitie.wrap,
        fout,
        el('div', { class: 'sales-acties' }, annuleer, opslaan));
      body.append(form);

      const waarden = () => Object.fromEntries(Object.entries(velden).map(([k, v]) => [k, v.invoer.value]));
      // Een fout per veld; "Vul een naam in" hoort bij Naam, "Vul een gsm-nummer of e-mailadres in" bij Gsm, "Straat én huisnummer" bij Straat.
      const toon = (f) => {
        const teksten = { voornaam: f.voornaam, naam: f.naam, gsm: f.gsm ?? f.contact, email: f.email, postcode: f.postcode, gemeente: f.gemeente, straat: f.straat ?? f.huisnr, huisnr: undefined, notitie: f.notitie };
        for (const [k, v] of Object.entries(velden)) v.zetFout(teksten[k]);
        // De tweede van een paar (naam / gsm-e-mail) kleurt mee zonder eigen tekst.
        if (f.naam === 'Vul een naam in') voornaam.invoer.setAttribute('aria-invalid', 'true');
        if (f.contact) email.invoer.setAttribute('aria-invalid', 'true');
        if (f.straat || f.huisnr) huisnr.invoer.setAttribute('aria-invalid', 'true');
        return Object.entries(velden).find(([, v]) => v.invoer.getAttribute('aria-invalid') === 'true')?.[1] ?? null;
      };
      const zetFormFout = (tekst) => { fout.textContent = tekst || ''; fout.hidden = !tekst; };

      let bezig = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (bezig) return;
        zetFormFout('');
        const r = valideerManueleLead(waarden());
        const eerste = toon(r.fouten ?? {});
        if (r.fouten) { eerste?.invoer.focus(); return; }
        bezig = true;
        opslaan.disabled = true;
        let res;
        try { res = await importeer(bouwManueelExport(r.lead)); } finally { bezig = false; opslaan.disabled = false; }
        if (!res.ok) { zetFormFout(foutTekst(res)); return; } // het venster blijft open met wat de verkoper intikte
        const s = res.samenvatting ?? {};
        const bestaand = zoekBestaandeLead(salesToestand().leads, r.lead);
        sluit();
        if (!(s.nieuw > 0) && s.alAanwezig > 0) {
          toast('Deze klant staat al in je lijst');
          if (bestaand) setTimeout(() => openLeadDetail(bestaand.id), 0); // na het sluiten (venster.js herstelt eerst de focus)
          return;
        }
        toast(s.eerderVerwijderd > 0 ? 'Lead toegevoegd. Let op: deze klant was eerder verwijderd.' : 'Lead toegevoegd');
        terugFocus?.();
        if (res.open > 0) vulLocatiesAan(res.open, { max: MAX_AANVUL_RONDES });
      });
      // Enter in het laatste veld (de notitie) bewaart ook; Shift+Enter geeft een nieuwe regel.
      notitie.invoer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
      });
      naFocus = () => voornaam.invoer.focus({ preventScroll: true });
    },
  });
  // venster.js focust bij het openen de eerste knop (in een microtaak); een invoerscherm begint bij het eerste veld.
  if (naFocus) setTimeout(naFocus, 0);
  return handle;
}
