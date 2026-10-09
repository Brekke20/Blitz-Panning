// schermen/beheer-systeemstatus.js — beheertab Systeemstatus (logins T18): Zoho-verbinding (groen/rood met tijdstip), de laatste
// fouten van de app (tabel) en mislukte rapporten. API: GET /api/systeemstatus (enkel beheerder).
// De mislukte rapporten zijn ALLEEN LEZEN: een knop "Opnieuw versturen" is bewust niet gebouwd (beslissing later met Brent).
// Veiligheid: foutteksten komen van de server/clients en kunnen vrije tekst bevatten: alles gaat via textContent (h() uit beheer.js).
import { registreerBeheerTab, beheerVerzoek, beheerFoutTekst, h } from './beheer.js';
import { formatDatumTijd } from './beheer-activiteit-logica.js';

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
    h('tbody', {}, rijen.map(cellen => h('tr', {}, cellen.map((c, i) => h('td', { 'data-label': kolommen[i], text: c })))))));
}

function foutenBlok(fouten) {
  return h('section', { 'aria-labelledby': 'bs-fouten-kop' },
    h('h3', { class: 'bs-kop', id: 'bs-fouten-kop', text: 'Laatste fouten' }),
    fouten.length === 0
      ? h('p', { class: 'bg-uitleg', text: 'Geen recente fouten.' })
      : tabel('bs-fouten', ['Tijdstip', 'Ticket', 'Stap', 'Fout'],
        fouten.map(f => [formatDatumTijd(f?.tijdstip), tekst(f?.ticketId), tekst(f?.stap), tekst(f?.fout)])));
}

function rapportenBlok(mislukt) {
  return h('section', { 'aria-labelledby': 'bs-rapporten-kop' },
    h('h3', { class: 'bs-kop', id: 'bs-rapporten-kop', text: 'Mislukte rapporten' }),
    mislukt.length === 0
      ? h('p', { class: 'bg-uitleg', text: 'Geen mislukte rapporten.' })
      : tabel('bs-rapporten', ['Ticket', 'Technieker', 'Datum', 'Laatste fout'],
        mislukt.map(r => [tekst(r?.ticketNumber), tekst(r?.technieker), tekst(r?.datum), tekst(r?.laatsteFout)])));
}

async function render(container) {
  const inhoud = h('div', { class: 'bs-inhoud' });
  const status = h('p', { class: 'bg-status', role: 'status' });
  const vernieuw = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Vernieuwen' });
  let volgnummer = 0;

  async function laad() {
    const mijn = ++volgnummer;
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
    const d = r.data ?? {};
    inhoud.replaceChildren(
      zohoBlok(d.zoho),
      foutenBlok(Array.isArray(d.foutenlog) ? d.foutenlog : []),
      rapportenBlok(Array.isArray(d.rapporten?.mislukt) ? d.rapporten.mislukt : []));
  }

  vernieuw.addEventListener('click', laad);
  container.replaceChildren(h('div', { class: 'bs' },
    h('div', { class: 'bg-kop' }, h('h3', { class: 'bg-titel', text: 'Systeemstatus' }), h('div', { class: 'bg-toolbar' }, vernieuw)),
    status, inhoud));
  await laad();
}

registreerBeheerTab({ id: 'systeemstatus', label: 'Systeemstatus', render });
