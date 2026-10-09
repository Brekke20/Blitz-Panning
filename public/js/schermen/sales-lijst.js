// schermen/sales-lijst.js — de tab "Te plannen": export laden, de leads als kaartjes (nog in te plannen / ingepland), zoeken en filteren op
// postcodegebied, verwijderen met 5 s "Ongedaan maken" en het leaddetail (sales-detail.js). Werkt in beide plaatsingen: als gewone tab van de
// verkoper en als subtab van de beheerder (de view komt van startScherm; de beheerder krijgt geen import, de server weigert die ook).
// Veiligheid: alle leadgegevens komen via textContent in de DOM (sales-dom.js); de bestandsinhoud wordt nooit geïnterpreteerd.
import { appConfirm } from '../app-dialog.js';
import { toast, registreerActies, maakActiveerbaar } from '../kern/ui.js';
import { MAX_BYTES, leesExport } from '../sales/import.js';
import { startScherm } from './sales-schil.js';
import { salesToestand, onSalesWijziging, importeer, vulLocatiesAan, verwijderMetOngedaan, spoelUitgesteld } from './sales-data.js';
import { kanImporteren, getoondeVerkoper, schrijfbaarNu } from './sales-verkoper.js';
import { openLeadDetail } from './sales-detail.js';
import { openLeadToevoegen } from './sales-lead-toevoegen.js';
import { filterLeads, postcodegebieden, groepeerLijst, kaartInfo, samenvattingTekst, exportTekst, andereVerantwoordelijke } from './sales-lijst-logica.js';
import { naamVan, foutTekst } from './sales-tekst.js';
import { el } from './sales-dom.js';

const MAX_AANVUL_RONDES = 10;
const filter = { zoek: '', gebied: '' };   // blijft staan bij een tabwissel; het zoekveld tekent zichzelf niet opnieuw
const wortels = new WeakMap();             // inhoud -> { el, vul() }
const handles = new Map();                 // leadId -> { ongedaan() } van een nog wachtende verwijdering
let haken = false;

// ---- uitgestelde verwijdering: pagina verbergen of sluiten stuurt meteen; het resultaat van de timer haalt de balk weg ----

const balkRij = (leadId) => [...document.querySelectorAll('.sales-ongedaan-rij')].find(r => r.dataset.lead === leadId) ?? null;

function zorgVoorHaken() {
  if (haken) return;
  haken = true;
  globalThis.addEventListener('pagehide', () => { spoelUitgesteld(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') spoelUitgesteld(); });
  // De detailmelding van onSalesWijziging: de verwijdering is verstuurd (geslaagd of mislukt) -> de "Ongedaan maken"-rij weg.
  onSalesWijziging((detail) => {
    if (detail?.soort !== 'verwijderd' && detail?.soort !== 'verwijder-mislukt') return;
    handles.delete(detail.leadId);
    balkRij(detail.leadId)?.remove();
    if (detail.soort === 'verwijder-mislukt') toast(`Verwijderen mislukt. ${foutTekst({ reden: detail.reden })}`);
  });
}

// ---- kaartjes ----

function maakKaart(lead, kanWissen) {
  const info = kaartInfo(lead);
  const kaart = el('div', { class: 'sales-kaart', 'data-actie': 'sales-open', 'data-arg': lead.id, 'data-lead-id': lead.id });
  maakActiveerbaar(kaart, () => openLeadDetail(lead.id), `Open ${info.titel}`);
  const kop = el('div', { class: 'sales-kaart-kop' }, el('span', { class: 'sales-kaart-titel', text: info.titel }));
  if (kanWissen) kop.append(el('button', { type: 'button', class: 'sales-kaart-wis', 'data-actie': 'sales-verwijder', 'data-arg': lead.id, 'aria-label': `Verwijder ${info.titel}`, text: '✕' }));
  kaart.append(kop);
  if (info.plaats) kaart.append(el('div', { class: 'sales-kaart-plaats', text: info.plaats }));
  const chips = el('div', { class: 'sales-kaart-chips' }, el('span', { class: 'sales-chip', text: info.adresLabel }));
  if (info.vastUur) chips.append(el('span', { class: 'sales-chip sales-chip-vast', text: info.vastUur }));
  if (info.zelfToegevoegd) chips.append(el('span', { class: 'sales-chip sales-chip-manueel', text: 'zelf toegevoegd' }));
  if (info.voorstelVerlopen) chips.append(el('span', { class: 'sales-chip sales-chip-verlopen', text: 'voorstel verlopen' }));
  if (info.eerderVerwijderd) chips.append(el('span', { class: 'sales-chip sales-chip-eerder', text: 'eerder verwijderd' }));
  kaart.append(chips);
  if (info.telHref || info.mailHref) {
    const contact = el('div', { class: 'sales-kaart-contact' });
    if (info.telHref) contact.append(el('a', { href: info.telHref, text: lead.gsm }));
    if (info.mailHref) contact.append(el('a', { href: info.mailHref, text: lead.email }));
    kaart.append(contact);
  }
  return kaart;
}

function maakGroep(titel, leads, kanWissen) {
  return el('section', { class: 'sales-groep' },
    el('h3', { class: 'sales-groep-kop', text: `${titel} (${leads.length})` }),
    el('div', { class: 'sales-kaartlijst' }, ...leads.map(l => maakKaart(l, kanWissen))));
}

// ---- het scherm ----

function bouwWortel(inhoud) {
  zorgVoorHaken();
  const bestand = el('input', { type: 'file', accept: '.json,application/json', class: 'sales-bestand', hidden: true, 'aria-label': 'Exportbestand (.json)' });
  const exportKnop = el('button', { type: 'button', class: 'btn btn--primary', 'data-actie': 'sales-export-laden', text: 'Export laden' });
  const leadKnop = el('button', { type: 'button', class: 'btn btn--secondary', 'data-actie': 'sales-lead-toevoegen', text: '+ Lead' });
  const acties = el('div', { class: 'sales-lijst-acties' });
  const melding = el('div', { class: 'sales-melding', hidden: true });
  const zoek = el('input', { type: 'search', class: 'sales-zoek', 'aria-label': 'Zoeken', placeholder: 'Zoek op naam of gemeente', autocomplete: 'off' });
  const gebied = el('select', { class: 'sales-gebied', 'aria-label': 'Postcodegebied' });
  const filterbalk = el('div', { class: 'sales-filter' }, zoek, gebied);
  const ongedaan = el('div', { class: 'sales-ongedaan' });
  const kaarten = el('div', { class: 'sales-kaarten' });
  const wortel = el('div', { class: 'sales-lijst-wortel' }, acties, melding, filterbalk, ongedaan, kaarten);

  const zetMelding = (regels, { fout = false } = {}) => {
    melding.replaceChildren(...regels.filter(Boolean).map(t => el('p', { text: t })));
    melding.hidden = regels.filter(Boolean).length === 0;
    melding.setAttribute('role', fout ? 'alert' : 'status');
    melding.classList.toggle('sales-melding-fout', fout);
  };

  function tekenKaarten() {
    const st = salesToestand();
    const open = st.leads.filter(l => l.status !== 'afgewerkt' && !st.uitgesteld.has(l.id));
    const kanWissen = schrijfbaarNu();
    if (open.length === 0) {
      kaarten.replaceChildren(el('p', { class: 'sales-leeg', text: kanImporteren() ? 'Nog geen leads. Laad een export of voeg zelf een lead toe.' : 'Nog geen leads.' }));
      return;
    }
    const zichtbaar = filterLeads(open, filter);
    if (zichtbaar.length === 0) { kaarten.replaceChildren(el('p', { class: 'sales-leeg', text: 'Geen leads gevonden voor deze zoekopdracht.' })); return; }
    const { tePlannen, ingepland } = groepeerLijst(zichtbaar);
    kaarten.replaceChildren(...[
      tePlannen.length ? maakGroep('Nog in te plannen', tePlannen, kanWissen) : null,
      ingepland.length ? maakGroep('Ingepland', ingepland, kanWissen) : null,
    ].filter(Boolean));
  }

  function vul() {
    const st = salesToestand();
    const open = st.leads.filter(l => l.status !== 'afgewerkt' && !st.uitgesteld.has(l.id));
    const mag = kanImporteren();
    // De beheerder en de weergave van een andere verkoper: geen import en geen "+ Lead" (de server weigert het ook). Enkel aanpassen bij een
    // wijziging, zodat een knop met focus niet telkens uit de DOM gehaald wordt.
    if ((acties.childElementCount > 0) !== mag) acties.replaceChildren(...(mag ? [exportKnop, leadKnop, bestand] : []));
    // Het postcodegebied: de keuze blijft, tenzij dat gebied er niet meer is.
    const gebieden = postcodegebieden(open);
    if (filter.gebied && !gebieden.some(g => g.gebied === filter.gebied)) filter.gebied = '';
    gebied.replaceChildren(el('option', { value: '', text: 'Alle gebieden' }), ...gebieden.map(g => el('option', { value: g.gebied, text: `${g.gebied}xx (${g.aantal})` })));
    gebied.value = filter.gebied;
    filterbalk.hidden = open.length === 0;
    tekenKaarten();
  }

  // ---- export laden ----
  async function laadExport(bestandsObject) {
    if (!bestandsObject) return;
    if (bestandsObject.size > MAX_BYTES) { zetMelding(['Het bestand is groter dan 2 MB'], { fout: true }); return; }
    let tekst;
    try { tekst = await bestandsObject.text(); } catch { zetMelding(['Het bestand kon niet gelezen worden.'], { fout: true }); return; }
    const gelezen = leesExport(tekst);
    if (!gelezen.ok) { zetMelding([gelezen.fout], { fout: true }); return; }
    const verkoper = getoondeVerkoper();
    if (andereVerantwoordelijke(gelezen.verantwoordelijke, verkoper.salesNaam)) {
      const toch = await appConfirm({ titel: 'Export van iemand anders', tekst: `Deze export is van ${gelezen.verantwoordelijke}. Toch inladen?`, bevestigLabel: 'Toch inladen' });
      if (!toch) return; // niets bewaard
    }
    exportKnop.disabled = true;
    zetMelding(['Bezig met inladen…']);
    try {
      const r = await importeer(JSON.parse(tekst)); // de server leest het bestand zelf nog eens en is de grens
      if (!r.ok) { zetMelding([foutTekst(r)], { fout: true }); return; }
      const regel1 = samenvattingTekst(r.samenvatting);
      const regel2 = exportTekst({ ...r.export, overgeslagen: r.samenvatting?.overgeslagen });
      zetMelding([regel1, regel2]);
      toast(regel1);
      if (r.open > 0) {
        const rest = await vulLocatiesAan(r.open, { max: MAX_AANVUL_RONDES, voortgang: (n) => zetMelding([regel1, regel2, `Locaties bepalen… nog ${n} te gaan`]) });
        zetMelding([regel1, regel2, rest > 0 ? `Voor ${rest} ${rest === 1 ? 'lead' : 'leads'} kon de locatie nog niet bepaald worden; dat wordt later opnieuw geprobeerd.` : null]);
      }
    } finally {
      exportKnop.disabled = false;
    }
  }

  bestand.addEventListener('change', () => {
    const f = bestand.files?.[0];
    bestand.value = ''; // hetzelfde bestand kan opnieuw gekozen worden
    laadExport(f);
  });
  zoek.addEventListener('input', () => { filter.zoek = zoek.value; tekenKaarten(); });
  gebied.addEventListener('change', () => { filter.gebied = gebied.value; tekenKaarten(); });

  // ---- verwijderen met ongedaan maken ----
  async function vraagVerwijder(leadId) {
    const lead = salesToestand().leads.find(l => l.id === leadId);
    if (!lead) return;
    const naam = naamVan(lead);
    const ok = await appConfirm({ titel: 'Lead verwijderen?', tekst: `${naam} uit je lijst verwijderen? Je kan dit nog 5 seconden ongedaan maken.`, bevestigLabel: 'Verwijderen', gevaar: true });
    if (!ok) return;
    handles.set(leadId, verwijderMetOngedaan(leadId));
    const rij = el('div', { class: 'sales-ongedaan-rij', role: 'status', 'data-lead': leadId },
      el('span', { text: `${naam} verwijderd.` }),
      el('button', { type: 'button', class: 'btn btn--secondary', 'data-actie': 'sales-ongedaan', 'data-arg': leadId, text: 'Ongedaan maken' }));
    ongedaan.append(rij);
  }

  registreerActies(inhoud, {
    'sales-export-laden': () => bestand.click(),
    'sales-lead-toevoegen': () => { openLeadToevoegen({ terugFocus: () => leadKnop.focus() }); },
    'sales-verwijder': (_knop, _e, id) => { vraagVerwijder(id); },
    'sales-ongedaan': (knop, _e, id) => {
      // Enkel de bewaarde handle gebruiken: verwijderMetOngedaan opnieuw aanroepen zou een NIEUWE verwijdering starten.
      handles.get(id)?.ongedaan();
      handles.delete(id);
      knop.closest('.sales-ongedaan-rij')?.remove();
    },
    'sales-open': (_k, e, id) => { if (!e.target.closest('a')) openLeadDetail(id); },
  });

  return { el: wortel, vul };
}

function teken(inhoud) {
  let w = wortels.get(inhoud);
  if (!w) { w = bouwWortel(inhoud); wortels.set(inhoud, w); }
  if (w.el.parentNode !== inhoud) inhoud.replaceChildren(w.el); // startScherm kan een melding in `inhoud` gezet hebben
  w.vul();
}

export const toon = (view) => startScherm(view, teken);
