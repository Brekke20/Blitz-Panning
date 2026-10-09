// schermen/beheer-systeemstatus.js — beheertab Systeemstatus (logins T18): Zoho-verbinding (groen/rood met tijdstip), de laatste
// fouten van de app (tabel) en mislukte rapporten. API: GET /api/systeemstatus (enkel beheerder).
// Per mislukt rapport staat een knop "Opnieuw versturen" (Task 11b, beslissing Brent 2026-10-09): POST /api/rapport-archief { opnieuw: id }
// zet het rapport op de server terug op 'wacht' en start de achtergrondverwerking; de server logt dat als 'rapport-opnieuw'.
// Veiligheid: foutteksten komen van de server/clients en kunnen vrije tekst bevatten: alles gaat via textContent (h() uit beheer.js).
import { registreerBeheerTab, beheerVerzoek, beheerFoutTekst, h } from './beheer.js';
import { formatDatumTijd } from './beheer-activiteit-logica.js';
import { opnieuwUitkomst, OPNIEUW_BEVESTIGING } from './beheer-systeemstatus-logica.js';
import { appConfirm } from '../app-dialog.js';
import { toast } from '../kern/ui.js';

const HERLAAD_NA_MS = 10000; // na een geslaagd "Opnieuw versturen" herlaadt de lijst vanzelf (de verwerking loopt op de achtergrond)

const tekst = (w, leeg = '—') => (typeof w === 'string' && w !== '' ? w : leeg);

function zohoBlok(zoho) {
  const ok = zoho?.ok === true;
  const test = zoho?.test === true;
  const chip = h('span', { class: `bg-chip ${ok ? 'bg-chip--actief' : 'bg-chip--geblokkeerd'}`, text: ok ? (test ? 'Testmodus' : 'Verbonden') : 'Niet bereikbaar' });
  return h('section', { class: 'bs-zoho', 'data-status': ok ? 'ok' : 'fout', 'aria-labelledby': 'bs-zoho-kop' },
    h('h3', { class: 'bs-kop', id: 'bs-zoho-kop', text: 'Zoho' }),
    h('p', { class: 'bs-zoho-regel' }, chip, h('span', { class: 'bs-sub', text: `Gecontroleerd op ${formatDatumTijd(zoho?.tijdstip)}` })),
    test ? h('p', { class: 'bg-uitleg', text: 'Testmodus: de verbinding met Zoho wordt niet gecontroleerd.' }) : null,
    !ok && typeof zoho?.fout === 'string' && zoho.fout ? h('p', { class: 'beheer-fout', text: zoho.fout }) : null);
}

function tabel(klasse, kolommen, rijen) {
  return h('div', { class: 'bg-lijst' }, h('table', { class: `bg-tabel ${klasse}` },
    h('thead', {}, h('tr', {}, kolommen.map(k => h('th', { scope: 'col', text: k })))),
    h('tbody', {}, rijen.map(cellen => h('tr', {}, cellen.map((c, i) => (c instanceof Node
      ? h('td', { 'data-label': kolommen[i] }, c)
      : h('td', { 'data-label': kolommen[i], text: c }))))))));
}

function foutenBlok(fouten) {
  return h('section', { 'aria-labelledby': 'bs-fouten-kop' },
    h('h3', { class: 'bs-kop', id: 'bs-fouten-kop', text: 'Laatste fouten' }),
    fouten.length === 0
      ? h('p', { class: 'bg-uitleg', text: 'Geen recente fouten.' })
      : tabel('bs-fouten', ['Tijdstip', 'Ticket', 'Stap', 'Fout'],
        fouten.map(f => [formatDatumTijd(f?.tijdstip), tekst(f?.ticketId), tekst(f?.stap), tekst(f?.fout)])));
}

// bezig: ids waarvoor nu een aanvraag loopt; opnieuw: ids die net opnieuw in de wachtrij gezet zijn (rij toont "opnieuw in behandeling").
function actieCel(r, { opnieuw, verstuur }) {
  const id = typeof r?.id === 'string' ? r.id : '';
  if (id !== '' && opnieuw.has(id)) return h('span', { class: 'bs-sub', 'data-opnieuw': id, text: 'opnieuw in behandeling' });
  const knop = h('button', { type: 'button', class: 'btn btn--secondary', 'data-actie': 'opnieuw', 'data-id': id, text: 'Opnieuw versturen' });
  if (id === '') knop.disabled = true; // zonder id is er niets om opnieuw te laten verwerken
  knop.addEventListener('click', () => verstuur(id, knop));
  return knop;
}

function rapportenBlok(mislukt, ctx) {
  return h('section', { 'aria-labelledby': 'bs-rapporten-kop' },
    h('h3', { class: 'bs-kop', id: 'bs-rapporten-kop', text: 'Mislukte rapporten' }),
    mislukt.length === 0
      ? h('p', { class: 'bg-uitleg', text: 'Geen mislukte rapporten.' })
      : tabel('bs-rapporten', ['Ticket', 'Technieker', 'Datum', 'Laatste fout', 'Actie'],
        mislukt.map(r => [tekst(r?.ticketNumber), tekst(r?.technieker), tekst(r?.datum), tekst(r?.laatsteFout), actieCel(r, ctx)])));
}

async function render(container) {
  const inhoud = h('div', { class: 'bs-inhoud' });
  const status = h('p', { class: 'bg-status', role: 'status' });
  const vernieuw = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Vernieuwen' });
  let volgnummer = 0;
  let herlaadTimer = null;
  let laatsteData = null;
  const bezig = new Set();
  const opnieuw = new Set();

  function teken() {
    const d = laatsteData ?? {};
    inhoud.replaceChildren(
      zohoBlok(d.zoho),
      foutenBlok(Array.isArray(d.foutenlog) ? d.foutenlog : []),
      rapportenBlok(Array.isArray(d.rapporten?.mislukt) ? d.rapporten.mislukt : [], { bezig, opnieuw, verstuur }));
  }

  // Een dubbelklik (of een tweede klik terwijl de bevestiging openstaat) stuurt nooit twee aanvragen: `bezig` per rapport-id.
  async function verstuur(id, knop) {
    if (id === '' || bezig.has(id)) return;
    bezig.add(id);
    knop.disabled = true;
    try {
      const ja = await appConfirm({ ...OPNIEUW_BEVESTIGING });
      if (!ja) { knop.disabled = false; return; }
      knop.textContent = 'Bezig…';
      const r = await beheerVerzoek('/api/rapport-archief', { methode: 'POST', body: { opnieuw: id } });
      const uit = opnieuwUitkomst(r);
      toast(uit.toast);
      if (uit.rijOpnieuw) {
        opnieuw.add(id);
        teken();
        clearTimeout(herlaadTimer);
        herlaadTimer = setTimeout(() => { if (inhoud.isConnected) laad(); }, HERLAAD_NA_MS);
      } else if (knop.isConnected) {
        knop.disabled = !uit.knopBruikbaar;
        knop.textContent = 'Opnieuw versturen';
      }
    } finally {
      bezig.delete(id);
    }
  }

  async function laad() {
    const mijn = ++volgnummer;
    opnieuw.clear(); // een verse lijst van de server is leidend: staat het rapport er nog als mislukt in, dan mag het opnieuw
    clearTimeout(herlaadTimer);
    vernieuw.disabled = true;
    status.textContent = 'Laden…';
    const r = await beheerVerzoek('/api/systeemstatus');
    if (mijn !== volgnummer) return;
    vernieuw.disabled = false;
    status.textContent = '';
    if (!r.ok) {
      inhoud.replaceChildren(h('p', { class: 'beheer-fout', role: 'alert', text: beheerFoutTekst(r) }));
      return;
    }
    laatsteData = r.data ?? {};
    teken();
  }

  vernieuw.addEventListener('click', laad);
  container.replaceChildren(h('div', { class: 'bs' },
    h('div', { class: 'bg-kop' }, h('h3', { class: 'bg-titel', text: 'Systeemstatus' }), h('div', { class: 'bg-toolbar' }, vernieuw)),
    status, inhoud));
  await laad();
}

registreerBeheerTab({ id: 'systeemstatus', label: 'Systeemstatus', render });
