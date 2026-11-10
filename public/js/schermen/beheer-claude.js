// schermen/beheer-claude.js — blok "Gekoppelde Claude-toegangen": wie Claude (enkel lezen) aan de Blitz-gegevens gekoppeld heeft, met
// het connector-adres om te koppelen en een knop Intrekken per koppeling. API: GET en DELETE /api/mcp-toegangen (alle rollen; de server
// toont de beheerder alle koppelingen en iedereen anders enkel de eigen, en weigert andermans koppeling intrekken met 403).
// Twee plekken: beheertab "Claude" (enkel beheerder) en Instellingen, tab "Dit toestel" (iedereen die geen beheerder is), zodat elke
// rol de eigen koppeling kan intrekken. Beide gebruiken toonClaudeToegangen(container).
// Het blok kan twee keer tegelijk in het document staan (bv. beheerpaneel en sales-venster): elke weergave krijgt eigen id's
// (teller), zodat label for en aria-labelledby altijd naar het eigen veld en de eigen titel wijzen.
// Veiligheid: namen komen uit de server (gebruikers, clients): alles gaat via textContent (h() uit beheer.js), nooit innerHTML.
import { registreerBeheerTab, beheerVerzoek, beheerFoutTekst, h } from './beheer.js';
import { toast } from '../kern/ui.js';

const PAD = '/api/mcp-toegangen';
const UITLEG = 'Met Claude kun je de planning, de open tickets en de rapporten opvragen en laten tellen. Claude kan enkel lezen, nooit iets wijzigen. '
  + 'Koppelen doe je in Claude: voeg een eigen connector toe met het adres hieronder en meld je aan met je Blitz-login. Je wachtwoord ziet Claude nooit. '
  + 'Hier trek je een koppeling in; Claude heeft dan meteen geen toegang meer.';

const datum = (ms) => (Number.isFinite(ms)
  ? new Date(ms).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

let instanties = 0;

export async function toonClaudeToegangen(container) {
  if (!container) return;
  const n = ++instanties;
  const adresId = `bc-adres-${n}`;
  const titelId = `bc-titel-${n}`;
  const adres = `${globalThis.location.origin}/api/mcp`;
  const status = h('p', { class: 'bg-status', role: 'status' });
  const lijst = h('div', { class: 'bg-lijst bc-lijst' });
  let volgnummer = 0;

  const kopieer = async () => {
    try {
      await globalThis.navigator.clipboard.writeText(adres);
      toast('Adres gekopieerd');
    } catch {
      veld.select(); // geen klembord (bv. geen toestemming): de gebruiker kopieert zelf uit het geselecteerde veld
      status.textContent = 'Kopiëren lukte niet; kopieer het geselecteerde adres zelf.';
    }
  };
  const veld = h('input', { class: 'set-input bc-adres', id: adresId, type: 'text', readonly: true, value: adres, 'aria-label': 'Connector-adres voor Claude' });
  const kopieerKnop = h('button', { type: 'button', class: 'btn btn--secondary', 'data-actie': 'claude-kopieer', text: 'Kopiëren', onclick: kopieer });

  async function intrekken(t, knop) {
    knop.disabled = true;
    status.textContent = '';
    const r = await beheerVerzoek(`${PAD}?id=${encodeURIComponent(t.id)}`, { methode: 'DELETE' });
    if (r.ok || r.status === 404) { // 404: al weg (door jezelf of de beheerder): de lijst klopt dan alsnog
      toast('Koppeling ingetrokken');
      await laad();
      return;
    }
    knop.disabled = false;
    status.textContent = beheerFoutTekst(r);
  }

  function teken(toegangen) {
    if (toegangen.length === 0) {
      lijst.replaceChildren(h('p', { class: 'bg-uitleg', text: 'Nog niemand heeft Claude gekoppeld.' }));
      return;
    }
    lijst.replaceChildren(h('table', { class: 'bg-tabel bc-tabel' },
      h('thead', {}, h('tr', {}, ['Gebruiker', 'Gekoppeld op', 'Laatst gebruikt', ''].map(k => h('th', { scope: 'col', text: k })))),
      h('tbody', {}, toegangen.map(t => {
        const knop = h('button', {
          type: 'button', class: 'btn btn--secondary', 'data-actie': 'claude-intrekken', 'data-id': t.id,
          'aria-label': `Koppeling van ${t.gebruikerNaam} intrekken`, text: 'Intrekken', onclick: () => intrekken(t, knop),
        });
        return h('tr', { 'data-toegang': t.id },
          h('td', { 'data-label': 'Gebruiker', class: 'bg-naam' }, t.gebruikerNaam, t.clientNaam ? h('span', { class: 'bg-sub', text: t.clientNaam }) : null),
          h('td', { 'data-label': 'Gekoppeld op', text: datum(t.aangemaakt) }),
          h('td', { 'data-label': 'Laatst gebruikt', text: datum(t.laatstGebruikt) }),
          h('td', { class: 'bg-cel' }, knop));
      }))));
  }

  async function laad() {
    const nr = ++volgnummer;
    const r = await beheerVerzoek(PAD);
    if (nr !== volgnummer) return;
    if (!r.ok || !Array.isArray(r.data?.toegangen)) {
      lijst.replaceChildren();
      status.textContent = beheerFoutTekst(r);
      return;
    }
    status.textContent = '';
    teken(r.data.toegangen);
  }

  container.replaceChildren(h('section', { class: 'bc', 'aria-labelledby': titelId },
    h('h2', { class: 'bg-titel', id: titelId, text: 'Gekoppelde Claude-toegangen' }),
    h('p', { class: 'bg-uitleg', text: UITLEG }),
    h('div', { class: 'set-field' },
      h('label', { class: 'set-label', for: adresId, text: 'Connector-adres' }),
      h('div', { class: 'bg-toolbar' }, veld, kopieerKnop)),
    status,
    lijst));
  status.textContent = 'Laden…';
  await laad();
}

registreerBeheerTab({ id: 'claude', label: 'Claude', render: toonClaudeToegangen });
