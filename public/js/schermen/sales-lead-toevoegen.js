// schermen/sales-lead-toevoegen.js — het venster "Lead toevoegen" (knop "+ Lead" in Leads): de verkoper tikt een lead zelf in (telefoon,
// beurs, doorverwijzing). Minimum: een naam (voornaam of naam), een gsm-nummer of e-mailadres en een postcode; de rest is optioneel en later aan te
// vullen in de fiche. De lead gaat als export-object met bron 'manueel' naar POST /api/sales-import (dezelfde herkenning, grafstenen en geocoding
// als een JSON-export; de server dwingt het minimum ook af). Bestaat de klant al: melding en de bestaande fiche openen, niets dubbel.
// Optioneel onderaan: Datum + Uur. Beide ingevuld = na het bewaren meteen een vast uur (zetVastUur, dezelfde botsingscontrole en bevestiging
// als "Vast uur afspreken" in de fiche; geen reistijdcontrole, zoals daar); enkel één van de twee = een veldfout, nooit een half plan. Het uur zit
// bewust niet in het importverzoek en wordt nooit op een bestaande klant gezet.
// Alle invoer gaat enkel via value/textContent (sales-dom.js).
import { appConfirm } from '../app-dialog.js';
import { toast } from '../kern/ui.js';
import { localISO } from '../kern/tijd.js';
import { zetVastUur } from '../sales/lead-regels.js';
import { valideerManueleLead, bouwManueelExport, zoekBestaandeLead } from '../sales/manueel.js';
import { salesToestand, importeer, wijzig, vulLocatiesAan } from './sales-data.js';
import { openSalesVenster } from './sales-venster.js';
import { openLeadDetail } from './sales-detail.js';
import { valideerLeadUur, vindBotsingen } from './sales-detail-logica.js';
import { foutTekst, dagLabel } from './sales-tekst.js';
import { el, veld } from './sales-dom.js';

const MAX_AANVUL_RONDES = 3; // één lead: een paar rondes volstaan; daarna probeert een volgende import of wijziging het opnieuw

/**
 * Legt het vaste uur van de zojuist toegevoegde lead vast (botsingen: eerst de bevestigingsvraag, zoals in de fiche).
 * -> 'vastgelegd' | 'afgewezen' (de verkoper koos Terug) | 'mislukt'
 */
async function leggUurVast(leadId, { datum, start }) {
  const st = salesToestand();
  const botsingen = vindBotsingen({ leads: st.leads, blokken: st.blokken, datum, start, duurMin: null, exceptId: leadId, standaardDuurMin: st.instellingen.bezoekDuurMin });
  if (botsingen.length) {
    const toch = await appConfirm({
      titel: 'Botsing met een andere afspraak',
      tekst: botsingen.map(b => `${b.omschrijving} (${b.soort === 'blok' ? 'blok' : 'bezoek'}) · ${b.start}–${b.eind}`),
      bevestigLabel: 'Toch vastleggen', gevaar: true,
    });
    if (!toch) return 'afgewezen';
  }
  // Als functie: na een 409 wordt het uur op de verse stand van de lead opnieuw samengesteld (de lead kan intussen weg zijn).
  const res = await wijzig((stand) => {
    const l = stand.leads.find(x => x.id === leadId);
    if (!l || l.status === 'afgewerkt') return null;
    const { status, planning } = zetVastUur(l, { datum, start });
    return { leads: [{ id: leadId, velden: { status, planning } }] };
  });
  return res.ok ? 'vastgelegd' : 'mislukt';
}

/** Opent het venster. `terugFocus()` zet de focus terug op de knop "+ Lead" na het sluiten. -> { sluit() } */
export function openLeadToevoegen({ terugFocus } = {}) {
  let naFocus = null;
  const handle = openSalesVenster({
    titel: 'Lead toevoegen',
    bouw(body, sluit) {
      const voornaam = veld('Voornaam', { value: '', maxlength: 200, autocomplete: 'off' });
      const naam = veld('Naam', { value: '', maxlength: 200, autocomplete: 'off' });
      const gsm = veld('Gsm', { soort: 'tel', maxlength: 200, autocomplete: 'off', inputmode: 'tel' });
      const email = veld('E-mail', { soort: 'email', maxlength: 200, autocomplete: 'off', inputmode: 'email' });
      const postcode = veld('Postcode', { maxlength: 10, autocomplete: 'off', inputmode: 'numeric', verplicht: true });
      const gemeente = veld('Gemeente', { maxlength: 200, autocomplete: 'off' });
      const straat = veld('Straat', { maxlength: 200, autocomplete: 'off' });
      const huisnr = veld('Huisnr', { maxlength: 200, autocomplete: 'off' });
      const notitie = veld('Notitie', { soort: 'textarea', maxlength: 1000, rows: 3 });
      const velden = { voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, notitie };
      // Optioneel vast uur (zelfde invoer als "Vast uur afspreken" in de fiche); niet in `velden`: het hoort niet bij de lead zelf.
      const datum = veld('Datum', { soort: 'date', min: localISO(new Date()) });
      const uur = veld('Uur', { soort: 'time' });

      const fout = el('div', { class: 'sales-venster-fout', role: 'alert', hidden: true });
      const opslaan = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Opslaan' });
      const annuleer = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Annuleren' });
      annuleer.addEventListener('click', () => sluit());

      const form = el('form', { class: 'sales-form', novalidate: true },
        el('p', { class: 'sales-uitleg', text: 'Nodig: een naam (voornaam of naam volstaat), een gsm-nummer of e-mailadres (één van de twee volstaat) en een postcode (*).' }),
        el('div', { class: 'sales-rij' }, voornaam.wrap, naam.wrap),
        el('div', { class: 'sales-rij' }, gsm.wrap, email.wrap),
        el('div', { class: 'sales-rij' }, postcode.wrap, gemeente.wrap),
        el('div', { class: 'sales-rij' }, straat.wrap, huisnr.wrap),
        notitie.wrap,
        el('p', { class: 'sales-uitleg', text: 'Al een afspraak? Vul dag en uur in, dan staat de lead meteen vast in de agenda. Anders laat je beide leeg.' }),
        el('div', { class: 'sales-rij' }, datum.wrap, uur.wrap),
        fout,
        el('div', { class: 'sales-acties' }, annuleer, opslaan));
      body.append(form);

      const waarden = () => Object.fromEntries(Object.entries(velden).map(([k, v]) => [k, v.invoer.value]));
      // Een fout per veld; "Vul een naam in" hoort bij Naam, "Vul een gsm-nummer of e-mailadres in" bij Gsm, "Straat én huisnummer" bij Straat.
      const toon = (f, uurFouten = {}) => {
        const teksten = { voornaam: f.voornaam, naam: f.naam, gsm: f.gsm ?? f.contact, email: f.email, postcode: f.postcode, gemeente: f.gemeente, straat: f.straat ?? f.huisnr, huisnr: undefined, notitie: f.notitie };
        for (const [k, v] of Object.entries(velden)) v.zetFout(teksten[k]);
        datum.zetFout(uurFouten.datum);
        uur.zetFout(uurFouten.uur);
        // De tweede van een paar (naam / gsm-e-mail) kleurt mee zonder eigen tekst.
        if (f.naam === 'Vul een naam in') voornaam.invoer.setAttribute('aria-invalid', 'true');
        if (f.contact) email.invoer.setAttribute('aria-invalid', 'true');
        if (f.straat || f.huisnr) huisnr.invoer.setAttribute('aria-invalid', 'true');
        return [...Object.values(velden), datum, uur].find(v => v.invoer.getAttribute('aria-invalid') === 'true') ?? null;
      };
      const zetFormFout = (tekst) => { fout.textContent = tekst || ''; fout.hidden = !tekst; };

      let bezig = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (bezig) return;
        zetFormFout('');
        const r = valideerManueleLead(waarden());
        const u = valideerLeadUur({ datum: datum.invoer.value, start: uur.invoer.value, vandaag: localISO(new Date()) });
        const eerste = toon(r.fouten ?? {}, u.fouten);
        if (r.fouten || u.fouten) { eerste?.invoer.focus(); return; }
        bezig = true;
        opslaan.disabled = true;
        let res;
        try { res = await importeer(bouwManueelExport(r.lead)); } finally { bezig = false; opslaan.disabled = false; }
        if (!res.ok) { zetFormFout(foutTekst(res)); return; } // het venster blijft open met wat de verkoper intikte
        const s = res.samenvatting ?? {};
        const bestaand = zoekBestaandeLead(salesToestand().leads, r.lead);
        sluit();
        if (!(s.nieuw > 0) && s.alAanwezig > 0) {
          // Nooit een uur over een bestaande lead heen: de fiche opent (bij een ingevuld uur op "Vast uur afspreken") en de verkoper beslist daar.
          toast(u.vast ? 'Deze klant staat al in je lijst. Het uur is niet vastgelegd: doe dat in de fiche.' : 'Deze klant staat al in je lijst');
          if (bestaand) setTimeout(() => openLeadDetail(bestaand.id, u.vast ? { focus: 'vast-uur' } : {}), 0); // na het sluiten (venster.js herstelt eerst de focus)
          return;
        }
        let melding = s.eerderVerwijderd > 0 ? 'Lead toegevoegd. Let op: deze klant was eerder verwijderd.' : 'Lead toegevoegd';
        if (u.vast) {
          // Het venster is al dicht: de lead bestaat nu. Een mislukte stap twee laat de lead bestaan en wijst naar de fiche (opnieuw proberen
          // in dit venster zou een "bestaat al"-melding geven).
          const nieuweLead = bestaand;
          const uitkomst = nieuweLead ? await leggUurVast(nieuweLead.id, u.vast) : 'mislukt';
          if (uitkomst === 'vastgelegd') melding = `${melding} — vast ingepland op ${dagLabel(u.vast.datum)} om ${u.vast.start}`;
          else if (uitkomst === 'afgewezen') melding = `${melding}, zonder vast uur`;
          else melding = `${melding}, maar het uur kon niet vastgelegd worden: doe het in de fiche`;
        }
        toast(melding);
        terugFocus?.();
        if (res.open > 0) vulLocatiesAan(res.open, { max: MAX_AANVUL_RONDES });
      });
      // Enter in het laatste tekstveld (de notitie) bewaart ook; Shift+Enter geeft een nieuwe regel.
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
