// schermen/sales-bezoek.js — de acties op een bezoek of blok in de agenda (venster): bellen (tel:), navigeren, Bevestigen, Uur wijzigen,
// Terug naar te plannen, Resultaat, Details; bij een blok: Verwijderen. Schrijfknoppen enkel als schrijfbaarNu() (alleen-lezen = enkel bellen,
// navigeren en details). De server is de grens; dit is de weergave. Alle leadgegevens gaan via textContent in de DOM (sales-dom.js).
import { appConfirm } from '../app-dialog.js';
import { toast } from '../kern/ui.js';
import { bevestig, terugNaarTePlannen } from '../sales/lead-regels.js';
import { isHeleDag } from '../sales/blok-regels.js';
import { salesToestand, wijzig } from './sales-data.js';
import { schrijfbaarNu } from './sales-verkoper.js';
import { openSalesVenster } from './sales-venster.js';
import { openLeadDetail } from './sales-detail.js';
import { kaartInfo } from './sales-lijst-logica.js';
import { navigatieAdres, navigatieLink } from './sales-kalender-logica.js';
import { naamVan, dagLabel, blokTitel, foutTekst } from './sales-tekst.js';
import { el } from './sales-dom.js';

const STATUS_LABEL = { voorgesteld: 'Voorgesteld', bevestigd: 'Bevestigd' };
const SOORT_LABEL = { verlof: 'Verlof', kantoor: 'Kantoor', afspraak: 'Afspraak' };

/** Opent de navigatie-app zoals `navigate()` in app.js (die hier niet geïmporteerd wordt): geo: op Android, anders Google Maps. */
export function navigeer(adres) {
  const android = /Android/i.test(globalThis.navigator?.userAgent ?? '');
  const link = navigatieLink(adres, android);
  if (!link) return;
  if (android) globalThis.location.href = link;
  else globalThis.open(link, '_blank');
}

/** Een foutblok bovenaan in het venster: -> toonFout(tekst). */
function foutBlok() {
  const fout = el('div', { class: 'sales-venster-fout', role: 'alert', hidden: true });
  return {
    fout,
    toon(tekst) { fout.textContent = tekst || ''; fout.hidden = !tekst; },
  };
}

const eindUur = (lead, standaardMin) => {
  const [u, m] = lead.planning.start.split(':').map(Number);
  const eind = u * 60 + m + (lead.duurMin ?? standaardMin);
  return `${String(Math.floor(eind / 60) % 24).padStart(2, '0')}:${String(eind % 60).padStart(2, '0')}`;
};

function openLead(lead) {
  const schrijfbaar = schrijfbaarNu();
  const leadId = lead.id;
  const info = kaartInfo(lead);
  const standaard = salesToestand().instellingen.bezoekDuurMin;
  return openSalesVenster({
    titel: naamVan(lead),
    bouw(body, sluit) {
      const { fout, toon } = foutBlok();
      const tijd = lead.planning?.start ? `${dagLabel(lead.planning.datum)} ${lead.planning.start}–${eindUur(lead, standaard)}` : '';
      body.append(
        fout,
        el('p', { class: 'sales-bezoek-wanneer' }, el('strong', { text: tijd }), el('span', { class: 'sales-chip', text: STATUS_LABEL[lead.status] ?? lead.status })),
        el('p', { class: 'sales-uitleg', text: info.plaats || info.adresLabel }),
      );

      // ---- contact en route ----
      const adres = navigatieAdres(lead);
      const contact = el('div', { class: 'sales-acties sales-acties-links' });
      if (info.telHref) contact.append(el('a', { class: 'btn btn--secondary', href: info.telHref, text: '📞 Bellen' }));
      if (adres) {
        const nav = el('button', { type: 'button', class: 'btn btn--secondary', text: '🧭 Navigeer' });
        nav.addEventListener('click', () => navigeer(adres));
        contact.append(nav);
      }
      const details = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Details' });
      details.addEventListener('click', () => { sluit(); openLeadDetail(leadId); });
      contact.append(details);
      body.append(contact);
      if (!schrijfbaar) return;

      // ---- wijzigen ----
      const knoppen = [];
      const actie = (tekst, klasse, doe) => {
        const k = el('button', { type: 'button', class: `btn ${klasse}`, text: tekst });
        k.addEventListener('click', async () => {
          toon('');
          for (const x of knoppen) x.disabled = true; // geen dubbelklik: één PATCH
          const ok = await doe();
          if (ok === true) sluit(); else for (const x of knoppen) x.disabled = false;
        });
        knoppen.push(k);
        return k;
      };
      const schrijf = async (patchVan) => {
        const r = await wijzig(patchVan);
        if (!r.ok) { toon(foutTekst(r)); return false; }
        return true;
      };
      const rij = el('div', { class: 'sales-acties sales-acties-links' });
      if (lead.status === 'voorgesteld') {
        rij.append(actie('Bevestigen', 'btn--primary', () => schrijf((stand) => {
          const l = stand.leads.find((x) => x.id === leadId);
          if (!l || l.status !== 'voorgesteld') return null; // intussen gewijzigd of weg
          const { status, planning } = bevestig(l);
          return { leads: [{ id: leadId, velden: { status, planning } }] };
        })));
      }
      // "Uur wijzigen": dag + uur van elk bezoek handmatig vastleggen of verleggen (het detail bij "Vast uur afspreken").
      const uur = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Uur wijzigen' });
      uur.addEventListener('click', () => { sluit(); openLeadDetail(leadId, { focus: 'vast-uur' }); });
      knoppen.push(uur);
      rij.append(uur);
      const resultaat = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Resultaat' });
      resultaat.addEventListener('click', async () => {
        sluit();
        try { (await import('./sales-resultaat.js')).openResultaat(leadId); }
        catch (e) { console.error('Resultaatvenster laden mislukt:', e); toast('Het resultaatvenster kon niet geladen worden.'); }
      });
      knoppen.push(resultaat);
      rij.append(resultaat);
      rij.append(actie('Terug naar te plannen', 'btn--secondary', () => schrijf((stand) => {
        const l = stand.leads.find((x) => x.id === leadId);
        if (!l || l.status === 'afgewerkt') return null;
        const t = terugNaarTePlannen(l);
        return { leads: [{ id: leadId, velden: { status: t.status, planning: t.planning ?? null, resultaat: t.resultaat ?? null } }] };
      })));
      body.append(rij);
    },
  });
}

function openBlok(blok) {
  const schrijfbaar = schrijfbaarNu();
  return openSalesVenster({
    titel: blokTitel(blok),
    bouw(body, sluit) {
      const { fout, toon } = foutBlok();
      const wanneer = isHeleDag(blok) ? `${dagLabel(blok.datum)} · hele dag` : `${dagLabel(blok.datum)} ${blok.start}–${blok.eind}`;
      body.append(
        fout,
        el('p', { class: 'sales-bezoek-wanneer' }, el('strong', { text: wanneer }), el('span', { class: 'sales-chip', text: SOORT_LABEL[blok.soort] ?? blok.soort })),
      );
      if (blok.omschrijving) body.append(el('p', { class: 'sales-uitleg', text: blok.omschrijving }));
      if (!schrijfbaar) return;
      const wis = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Verwijderen' });
      wis.addEventListener('click', async () => {
        toon('');
        const ja = await appConfirm({ titel: `${blokTitel(blok)} verwijderen?`, tekst: wanneer, bevestigLabel: 'Verwijderen', annuleerLabel: 'Terug', gevaar: true });
        if (!ja) return;
        wis.disabled = true;
        const r = await wijzig({ blokken: { verwijder: [blok.id] } });
        if (r.ok) sluit(); else { toon(foutTekst(r)); wis.disabled = false; }
      });
      body.append(el('div', { class: 'sales-acties sales-acties-links' }, wis));
    },
  });
}

/** Opent de acties van een bezoek (lead-id) of een blok (blok-id) uit de agenda. -> { sluit() } of null (onbekend). */
export function openBezoekActies(id) {
  const stand = salesToestand();
  const lead = stand.leads.find((l) => l.id === id);
  if (lead) return openLead(lead);
  const blok = stand.blokken.find((b) => b.id === id);
  return blok ? openBlok(blok) : null;
}
