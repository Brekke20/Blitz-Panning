// schermen/beheer-activiteit.js — beheertab Activiteitenlog (logins T18): wie deed wat en wanneer, gefilterd op persoon, actie en periode,
// per dag gegroepeerd (Brusselse kalenderdag, nieuwste eerst). API: GET /api/activiteit (enkel beheerder, max. 1000 items).
// Veiligheid: naam, onderwerp en details komen uit de log en kunnen vrije tekst bevatten: alles gaat via textContent (h() uit beheer.js).
import { registreerBeheerTab, beheerVerzoek, beheerFoutTekst, h } from './beheer.js';
import {
  ACTIES, actieLabel, bouwActiviteitUrl, groepeerPerDag, standaardPeriode, formatDagKop, formatUur,
} from './beheer-activiteit-logica.js';

const SERVER_MAX = 1000;

async function render(container) {
  const periode = standaardPeriode(new Date());
  const veldVan = h('input', { class: 'set-input', id: 'ba-van', type: 'date', value: periode.van });
  const veldTot = h('input', { class: 'set-input', id: 'ba-tot', type: 'date', value: periode.tot });
  const persoon = h('select', { class: 'set-input', id: 'ba-persoon' }, h('option', { value: '', text: 'Iedereen' }));
  const actie = h('select', { class: 'set-input', id: 'ba-actie' },
    h('option', { value: '', text: 'Alle acties' }),
    ACTIES.map(a => h('option', { value: a, text: actieLabel(a) })));
  const lijst = h('div', { class: 'ba-lijst', tabindex: '-1' });
  const melding = h('p', { class: 'bg-status', role: 'status' });
  const filterVeld = (label, invoer) => h('div', { class: 'ba-filter' }, h('label', { class: 'set-label', for: invoer.id, text: label }), invoer);
  let volgnummer = 0;

  // Houdt de gekozen persoon staan, ook als die in het nieuwe resultaat niet (meer) voorkomt.
  function vulPersonen(gebruikers) {
    const gekozen = persoon.value;
    const opties = Array.isArray(gebruikers) ? gebruikers.filter(g => g && typeof g.id === 'string') : [];
    if (gekozen && !opties.some(g => g.id === gekozen)) opties.push({ id: gekozen, naam: persoon.selectedOptions[0]?.textContent || gekozen });
    persoon.replaceChildren(
      h('option', { value: '', text: 'Iedereen' }),
      ...opties.map(g => h('option', { value: g.id, text: typeof g.naam === 'string' && g.naam ? g.naam : g.id })));
    persoon.value = gekozen;
  }

  function tekenItems(items) {
    if (items.length === 0) {
      lijst.replaceChildren(h('p', { class: 'bg-uitleg', text: 'Geen activiteit gevonden voor deze filters.' }));
      return;
    }
    const groepen = groepeerPerDag(items).map(g => h('section', { class: 'ba-dag' },
      h('h3', { class: 'ba-dagkop', text: formatDagKop(g.dag) }),
      h('div', { class: 'bg-lijst' }, h('table', { class: 'bg-tabel ba-tabel' },
        h('thead', {}, h('tr', {}, ['Tijd', 'Persoon', 'Actie', 'Onderwerp', 'Details'].map(k => h('th', { scope: 'col', text: k })))),
        h('tbody', {}, g.items.map(it => h('tr', { class: 'ba-rij' },
          h('td', { 'data-label': 'Tijd', class: 'ba-tijd', text: formatUur(it.op) }),
          h('td', { 'data-label': 'Persoon', text: typeof it.naam === 'string' && it.naam ? it.naam : '—' }),
          h('td', { 'data-label': 'Actie' }, h('span', { class: 'ba-actie', text: actieLabel(it.actie) })),
          h('td', { 'data-label': 'Onderwerp', text: typeof it.onderwerp === 'string' && it.onderwerp ? it.onderwerp : '—' }),
          h('td', { 'data-label': 'Details', class: 'ba-details', text: typeof it.details === 'string' && it.details ? it.details : '—' }),
        )))))));
    if (items.length >= SERVER_MAX) {
      groepen.push(h('p', { class: 'bg-uitleg', text: `Enkel de ${SERVER_MAX} nieuwste meldingen worden getoond. Kies een kortere periode of een filter om oudere te zien.` }));
    }
    lijst.replaceChildren(...groepen);
  }

  async function laad() {
    const mijn = ++volgnummer;
    melding.textContent = 'Laden…';
    lijst.setAttribute('aria-busy', 'true');
    const r = await beheerVerzoek(bouwActiviteitUrl({ van: veldVan.value, tot: veldTot.value, gebruiker: persoon.value, actie: actie.value }));
    if (mijn !== volgnummer) return; // een nieuwere filterkeuze is onderweg
    lijst.removeAttribute('aria-busy');
    melding.textContent = '';
    if (!r.ok) {
      lijst.replaceChildren(h('p', { class: 'beheer-fout', role: 'alert', text: beheerFoutTekst(r) }));
      return;
    }
    vulPersonen(r.data?.gebruikers);
    tekenItems(Array.isArray(r.data?.items) ? r.data.items : []);
  }

  for (const el of [veldVan, veldTot, persoon, actie]) el.addEventListener('change', laad);
  container.replaceChildren(h('div', { class: 'ba' },
    h('div', { class: 'bg-kop' }, h('h3', { class: 'bg-titel', text: 'Activiteitenlog' })),
    h('div', { class: 'ba-filters' },
      filterVeld('Persoon', persoon), filterVeld('Actie', actie), filterVeld('Van', veldVan), filterVeld('Tot', veldTot)),
    melding, lijst));
  await laad();
}

registreerBeheerTab({ id: 'activiteit', label: 'Activiteitenlog', render });
