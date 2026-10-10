// schermen/sales-detail.js — het leaddetail (venster): adres, notitie en bezoekduur bewerken, de historiek lezen, een vast uur afspreken en
// terug naar te plannen. Door "Leads" geopend en door de kalender/route hergebruikt: openLeadDetail(leadId, { focus: 'vast-uur' }).
// Alleen-lezen modus (schrijfbaarNu() === false): enkel tekst, geen invoer en geen knoppen. De server is de grens; dit is de weergave.
// Alle leadgegevens gaan via textContent/value in de DOM (sales-dom.js).
import { appConfirm } from '../app-dialog.js';
import { toast } from '../kern/ui.js';
import { localISO } from '../kern/tijd.js';
import { isVast, zetVastUur, RESULTAAT_LABEL } from '../sales/lead-regels.js';
import { salesToestand, wijzig, terugNaarTePlannen } from './sales-data.js';
import { schrijfbaarNu } from './sales-verkoper.js';
import { openSalesVenster } from './sales-venster.js';
import { valideerDetail, valideerVastUur, vindBotsingen, wijzigingen, routeHerberekend } from './sales-detail-logica.js';
import { kaartInfo } from './sales-lijst-logica.js';
import { naamVan, dagLabel, foutTekst } from './sales-tekst.js';
import { el, veld, sectie } from './sales-dom.js';

const ADRESVELDEN = ['straat', 'huisnr', 'postcode', 'gemeente'];

const zoekLead = (id) => salesToestand().leads.find(l => l.id === id) ?? null;

function contactRegel(lead) {
  const info = kaartInfo(lead);
  const regel = el('div', { class: 'sales-detail-contact' });
  if (lead.gsm) regel.append(info.telHref ? el('a', { href: info.telHref, text: lead.gsm }) : el('span', { text: lead.gsm }));
  if (lead.email) regel.append(info.mailHref ? el('a', { href: info.mailHref, text: lead.email }) : el('span', { text: lead.email }));
  regel.append(el('span', { class: 'sales-chip', text: info.adresLabel }));
  return regel;
}

function historiek(lead) {
  const bezoeken = (Array.isArray(lead.bezoeken) ? lead.bezoeken : []).slice().sort((a, b) => String(b.op ?? '').localeCompare(String(a.op ?? '')));
  const lijst = el('ul', { class: 'sales-historiek-lijst' });
  for (const b of bezoeken) {
    const regel = el('li', {}, el('strong', { text: `${dagLabel(b.datum)} — ${RESULTAAT_LABEL[b.resultaat] ?? b.resultaat}` }));
    if (b.notitie) regel.append(el('div', { class: 'sales-historiek-notitie', text: b.notitie }));
    lijst.append(regel);
  }
  return sectie('Eerdere bezoeken', 'sales-historiek', bezoeken.length ? lijst : el('p', { class: 'sales-leeg-klein', text: 'Nog geen bezoeken.' }));
}

function leesVeld(naam, waarde) {
  return el('div', { class: 'sales-lees' }, el('span', { class: 'sales-lees-label', text: naam }), el('span', { class: 'sales-lees-waarde', text: waarde || '—' }));
}

/** Opent het detail van een lead. `focus: 'vast-uur'` zet de sectie "Vast uur afspreken" in beeld. -> { sluit() } of null (onbekende lead). */
export function openLeadDetail(leadId, { focus } = {}) {
  const start = zoekLead(leadId);
  if (!start) return null;
  const schrijfbaar = schrijfbaarNu();
  let naFocus = null;

  const handle = openSalesVenster({
    titel: naamVan(start),
    bouw(body, sluit) {
      const fout = el('div', { class: 'sales-venster-fout', role: 'alert', hidden: true });
      const toonFout = (tekst) => {
        fout.textContent = tekst || '';
        fout.hidden = !tekst;
        if (tekst) fout.scrollIntoView?.({ block: 'nearest' });
      };
      const bezig = (knop, aan) => { knop.disabled = aan; };
      body.append(contactRegel(start), fout);

      // ---- eerder verwijderd: de verkoper beslist ----
      if (start.eerderVerwijderd?.op) {
        const tekst = el('span', { text: `Deze klant werd eerder verwijderd (${dagLabel(localISO(new Date(start.eerderVerwijderd.op)))}) en kwam terug via een nieuwe export.` });
        const blok = el('div', { class: 'sales-venster-eerder' }, tekst);
        if (schrijfbaar) {
          const wis = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Label wissen' });
          wis.addEventListener('click', async () => {
            toonFout('');
            bezig(wis, true);
            const r = await wijzig({ leads: [{ id: leadId, velden: { eerderVerwijderd: null } }] });
            if (r.ok) blok.remove(); else { toonFout(foutTekst(r)); bezig(wis, false); }
          });
          blok.append(wis);
        }
        body.append(blok);
      }

      if (!schrijfbaar) {
        const adres = [start.straat && `${start.straat} ${start.huisnr ?? ''}`.trim(), [start.postcode, start.gemeente].filter(Boolean).join(' ')].filter(Boolean).join(', ') || start.adresTekst;
        body.append(
          leesVeld('Adres', adres),
          leesVeld('Bezoekduur', start.duurMin ? `${start.duurMin} min` : ''),
          leesVeld('Notitie', start.notitie),
          historiek(start),
        );
        return;
      }

      // ---- gegevens ----
      const straat = veld('Straat', { value: start.straat, maxlength: 200, autocomplete: 'off' });
      const huisnr = veld('Huisnummer', { value: start.huisnr, maxlength: 200, autocomplete: 'off' });
      const postcode = veld('Postcode', { value: start.postcode, maxlength: 10, inputmode: 'numeric', autocomplete: 'off' });
      const gemeente = veld('Gemeente', { value: start.gemeente, maxlength: 200, autocomplete: 'off' });
      const duur = veld('Bezoekduur (min)', { soort: 'number', value: start.duurMin ?? '', min: 15, inputmode: 'numeric' });
      duur.invoer.placeholder = String(salesToestand().instellingen.bezoekDuurMin);
      const notitie = veld('Notitie', { soort: 'textarea', value: start.notitie, maxlength: 1000, rows: 3 });
      const opslaan = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Opslaan' });
      const form = el('form', { class: 'sales-form', novalidate: true },
        el('div', { class: 'sales-rij' }, straat.wrap, huisnr.wrap),
        el('div', { class: 'sales-rij' }, postcode.wrap, gemeente.wrap),
        duur.wrap, notitie.wrap, el('div', { class: 'sales-acties' }, opslaan));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        toonFout('');
        const voor = zoekLead(leadId) ?? start;
        const r = valideerDetail({ straat: straat.invoer.value, huisnr: huisnr.invoer.value, postcode: postcode.invoer.value, gemeente: gemeente.invoer.value, notitie: notitie.invoer.value, duurMin: duur.invoer.value });
        if (r.fout) return toonFout(r.fout);
        const verschil = wijzigingen(voor, r.velden);
        if (!Object.keys(verschil).length) return sluit();
        bezig(opslaan, true);
        const res = await wijzig({ leads: [{ id: leadId, velden: verschil }] });
        if (!res.ok) { toonFout(foutTekst(res)); bezig(opslaan, false); return; } // het venster blijft open met wat de verkoper intikte
        const na = zoekLead(leadId);
        if (na && routeHerberekend(voor, na)) toast('Adres bijgewerkt — de route van die dag is herberekend. Plan de week opnieuw om de uren te herschikken.');
        else toast(ADRESVELDEN.some(k => k in verschil) ? 'Adres opgeslagen' : 'Opgeslagen');
        sluit();
      });
      body.append(form);

      // ---- vast uur afspreken (voor elke lead die niet afgewerkt is) ----
      if (start.status !== 'afgewerkt') {
        const heeftVast = isVast(start) && start.planning?.datum && start.planning.start;
        const vandaag = localISO(new Date());
        const datum = veld('Datum', { soort: 'date', value: heeftVast ? start.planning.datum : '', min: vandaag });
        const uur = veld('Uur', { soort: 'time', value: heeftVast ? start.planning.start : '' });
        const leg = el('button', { type: 'button', class: 'btn btn--primary', text: heeftVast ? 'Uur wijzigen' : 'Vast uur vastleggen' });
        const kop = sectie('Vast uur afspreken', 'sales-vast',
          el('p', { class: 'sales-uitleg', text: heeftVast ? `Nu vastgelegd: ${dagLabel(start.planning.datum)} ${start.planning.start}.` : 'Leg een dag en uur vast: de planning verschuift dit bezoek niet meer.' }),
          el('div', { class: 'sales-rij' }, datum.wrap, uur.wrap), el('div', { class: 'sales-acties' }, leg));
        leg.addEventListener('click', async () => {
          toonFout('');
          const huidig = zoekLead(leadId) ?? start;
          const check = valideerVastUur({ datum: datum.invoer.value, start: uur.invoer.value, vandaag: localISO(new Date()) });
          if (check.fout) return toonFout(check.fout);
          const st = salesToestand();
          const botsingen = vindBotsingen({ leads: st.leads, blokken: st.blokken, datum: datum.invoer.value, start: uur.invoer.value, duurMin: huidig.duurMin, exceptId: leadId, standaardDuurMin: st.instellingen.bezoekDuurMin });
          if (botsingen.length) {
            const toch = await appConfirm({
              titel: 'Botsing met een andere afspraak',
              tekst: botsingen.map(b => `${b.omschrijving} (${b.soort === 'blok' ? 'blok' : 'bezoek'}) · ${b.start}–${b.eind}`),
              bevestigLabel: 'Toch vastleggen', gevaar: true,
            });
            if (!toch) return;
          }
          bezig(leg, true);
          // Als functie: na een 409 wordt het vaste uur op de verse stand van de lead opnieuw samengesteld (de lead kan intussen weg zijn).
          const res = await wijzig((stand) => {
            const l = stand.leads.find(x => x.id === leadId);
            if (!l || l.status === 'afgewerkt') return null;
            const { status, planning } = zetVastUur(l, { datum: datum.invoer.value, start: uur.invoer.value });
            return { leads: [{ id: leadId, velden: { status, planning } }] };
          });
          if (!res.ok) { toonFout(foutTekst(res)); bezig(leg, false); return; }
          sluit();
        });
        body.append(kop);
        if (focus === 'vast-uur') naFocus = () => { kop.scrollIntoView?.({ block: 'center' }); datum.invoer.focus({ preventScroll: true }); };
      }

      body.append(historiek(start));

      // ---- terug naar te plannen ----
      if (start.status !== 'te-plannen') {
        const terug = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Terug naar te plannen' });
        terug.addEventListener('click', async () => {
          toonFout('');
          bezig(terug, true);
          const res = await terugNaarTePlannen(leadId);
          if (!res.ok) { toonFout(foutTekst(res)); bezig(terug, false); return; }
          sluit();
        });
        body.append(el('div', { class: 'sales-acties sales-acties-terug' }, terug));
      }
    },
  });
  // venster.js zet de focus bij het openen op de eerste knop (in een microtaak): de gewenste focus komt daarna.
  if (naFocus) setTimeout(naFocus, 0);
  return handle;
}
