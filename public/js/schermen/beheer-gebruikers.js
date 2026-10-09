// schermen/beheer-gebruikers.js — beheertab Gebruikers (logins T17): lijst, nieuwe gebruiker, bewerken, blokkeren/deblokkeren,
// startwachtwoord opnieuw instellen, overal uitloggen en nieuwe herstelcodes voor het eigen beheerdersaccount.
// API: /api/gebruikers (netlify/functions/gebruikers.js). De server beslist over alles (ook de laatste actieve beheerder);
// de knop spiegelt de regel enkel (kanBlokkeren).
// Veiligheid: alle servergegevens (namen, e-mails, foutteksten) komen via textContent/attributen in de DOM (h() uit beheer.js),
// nooit via innerHTML. Startwachtwoorden en herstelcodes staan enkel in een dwingend venster (closure + <pre>), worden bij het
// sluiten leeggemaakt en gaan nooit naar localStorage/sessionStorage, de URL of de console.
import { registreerBeheerTab, openBeheerVenster, h, beheerVerzoek } from './beheer.js';
import { apiVerzoek } from '../kern/api.js';
import { toast } from '../kern/ui.js';
import { toestand } from '../kern/toestand.js';
import { huidigeGebruiker } from '../kern/sessie.js';
import { appConfirm } from '../app-dialog.js';
import { formatHerstelcodes } from './inloggen-logica.js';
import {
  ROLLEN, rolLabel, sorteerGebruikers, valideerGebruikerFormulier, zohoNaamOpties, zohoNaamKeuzes, ZOHO_ANDERE, kanBlokkeren, formatLaatsteLogin,
} from './beheer-gebruikers-logica.js';

const PAD = '/api/gebruikers';
const KOP = { 'X-Blitz': '1' };
const GEEN_VERBINDING = 'Geen verbinding met de server. Probeer het opnieuw.';
const STORING = 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.';
const ENIGE_BEHEERDER = 'Dit is de enige actieve beheerder: die kan niet geblokkeerd of van rol veranderd worden.';

// Eén verzoek; gooit nooit. -> { ok, status, data, netwerk }
async function roep(methode, body) {
  try {
    const r = await apiVerzoek(PAD, methode === 'GET' ? {} : { methode, body, headers: KOP });
    return { ok: r.ok, status: r.status, data: r.data, netwerk: false };
  } catch {
    return { ok: false, status: 0, data: null, netwerk: true };
  }
}

function foutTekst(r) {
  if (r.netwerk) return GEEN_VERBINDING;
  if (r.status === 503) return STORING;
  if (typeof r.data?.error === 'string' && r.data.error) return r.data.error;
  return `De actie is mislukt (HTTP ${r.status}).`;
}

const ticketsVoorNamen = () => {
  try { return [...toestand.get('allTickets'), ...toestand.get('allPending'), ...toestand.get('allGepland')]; } catch { return []; }
};

// ── Eenmalig getoonde geheimen ──────────────────────────────────────────────────────────────────────────────────
// startWachtwoord en/of herstelcodes: één keer in beeld, kopieerbaar; bij sluiten wordt alles leeggemaakt.
function toonGeheimen({ titel, intro, startWachtwoord, herstelcodes, focusTerug }) {
  const venster = openBeheerVenster({ titel, dwingend: true, focusTerug });
  const teksten = {};
  const status = h('p', { class: 'bg-status', role: 'status' });
  const blok = (sleutel, label, uitleg, tekst) => {
    teksten[sleutel] = tekst;
    const pre = h('pre', { class: 'bg-geheim', 'data-geheim': sleutel });
    pre.textContent = tekst;
    const kopieer = h('button', {
      type: 'button', class: 'btn btn--secondary btn--sm',
      onclick: async () => {
        try { await navigator.clipboard.writeText(teksten[sleutel] ?? ''); status.textContent = `${label}: gekopieerd naar het klembord.`; } catch { status.textContent = 'Kopiëren is niet gelukt. Selecteer de tekst en kopieer ze handmatig.'; }
      },
      text: 'Kopiëren',
    });
    return h('section', { class: 'bg-geheim-blok' }, h('h3', { class: 'bg-geheim-kop', text: label }), uitleg ? h('p', { class: 'bg-uitleg', text: uitleg }) : null, pre, kopieer);
  };
  venster.body.append(h('p', { class: 'bg-uitleg', text: intro }));
  if (typeof startWachtwoord === 'string') {
    venster.body.append(blok('ww', 'Startwachtwoord', 'De gebruiker moet dit bij de eerste login wijzigen.', startWachtwoord));
  }
  if (Array.isArray(herstelcodes)) {
    venster.body.append(blok('codes', 'Herstelcodes', 'Elke code werkt één keer. Bewaar ze op een veilige plek.', formatHerstelcodes(herstelcodes)));
  }
  const klaarKnop = h('button', {
    type: 'button', class: 'btn btn--primary',
    onclick: () => {
      for (const pre of venster.body.querySelectorAll('[data-geheim]')) pre.textContent = '';
      for (const k of Object.keys(teksten)) delete teksten[k];
      venster.sluit();
    },
    text: 'Ik heb het genoteerd',
  });
  venster.body.append(status, h('div', { class: 'beheer-venster-acties' }, klaarKnop));
  klaarKnop.focus();
}

// ── Formulieren (nieuw / bewerken) ──────────────────────────────────────────────────────────────────────────────
function veld(label, invoer) {
  return h('div', { class: 'set-field' }, h('label', { class: 'set-label', for: invoer.id, text: label }), invoer);
}

function toonGebruikerFormulier({ gebruiker = null, lijst, naSucces }) {
  const nieuw = gebruiker === null;
  const laatsteBeheerder = !nieuw && gebruiker.rol === 'beheerder' && gebruiker.actief === true && !kanBlokkeren(lijst, gebruiker.id);
  const venster = openBeheerVenster({ titel: nieuw ? 'Nieuwe gebruiker' : 'Gebruiker bewerken' });

  const email = h('input', { class: 'set-input', id: 'bg-email', type: 'email', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  const naam = h('input', { class: 'set-input', id: 'bg-naam', type: 'text', autocomplete: 'off', maxlength: '100' });
  const rol = h('select', { class: 'set-input', id: 'bg-rol' },
    ROLLEN.map(r => h('option', { value: r, text: rolLabel(r) })));
  const salesNaam = h('input', { class: 'set-input', id: 'bg-sales', type: 'text', autocomplete: 'off' });
  const alleSales = h('input', { type: 'checkbox', id: 'bg-alle-sales' });
  const fout = h('p', { class: 'bg-fout', role: 'alert' });

  // Beginwaarden (via de eigenschap `value`, niet via HTML).
  rol.value = gebruiker?.rol ?? 'planner';
  naam.value = gebruiker?.naam ?? '';
  salesNaam.value = gebruiker?.salesNaam ?? '';
  alleSales.checked = gebruiker?.magAlleSales === true;
  if (laatsteBeheerder) rol.disabled = true;

  // Zoho-naam: elk account behalve sales kan er een hebben (verplicht voor een technieker); een account met een Zoho-naam voert ook zelf
  // interventies uit, bovenop zijn eigen rechten.
  const zohoHulp = h('p', { class: 'bg-uitleg bg-hulp', id: 'bg-zoho-hulp' });
  const zohoVeld = h('div', { class: 'bg-zoho-veld' });
  const groepTechnieker = h('div', { class: 'bg-groep' },
    h('div', { class: 'set-field' }, h('label', { class: 'set-label', for: 'bg-zoho', text: 'Zoho-naam' }), zohoVeld), zohoHulp);

  // Het veld Zoho-naam: een keuzelijst met de actieve Zoho-gebruikers (/api/zoho-agenten) zodra die er is, met "— geen —" en
  // "Andere naam…" (vrije tekst, voor een uitzondering). Zolang de lijst niet geladen is, of bij een Zoho-storing, blijft het een
  // vrij tekstveld met de namen uit de tickets als suggestie. Een naam die al bij een ander account hoort, is niet te kiezen.
  let agenten = null; // [{ naam }] zodra geladen
  let zohoFoutTekst = ''; // aanvulling op de hulptekst als de Zoho-lijst niet beschikbaar is
  const tekstVeld = (waarde) => {
    const veldEl = h('input', { class: 'set-input', id: 'bg-zoho', type: 'text', autocomplete: 'off', list: 'bg-zoho-opties', spellcheck: 'false', 'aria-describedby': 'bg-zoho-hulp' });
    veldEl.value = waarde;
    const opties = h('datalist', { id: 'bg-zoho-opties' }, zohoNaamOpties(ticketsVoorNamen(), gebruiker?.zohoNaam).map(n => h('option', { value: n })));
    return [veldEl, opties];
  };
  const lijstVeld = (waarde) => {
    const keuzes = zohoNaamKeuzes({ agenten, huidige: gebruiker?.zohoNaam, gebruikers: lijst, behalveId: gebruiker?.id });
    const kiesbaar = keuzes.find(k => k.naam === waarde);
    const sel = h('select', { class: 'set-input', id: 'bg-zoho', 'aria-describedby': 'bg-zoho-hulp' },
      h('option', { value: '', text: '— geen —' }),
      keuzes.map(k => h('option', { value: k.naam, text: k.bezetDoor ? `${k.naam} (al gekoppeld aan ${k.bezetDoor})` : k.naam, disabled: k.bezetDoor !== null })),
      h('option', { value: ZOHO_ANDERE, text: 'Andere naam…' }));
    const andere = h('input', { class: 'set-input bg-zoho-andere', id: 'bg-zoho-andere', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Andere naam', placeholder: 'Naam zoals in Zoho' });
    sel.value = waarde === '' ? '' : (kiesbaar ? kiesbaar.naam : ZOHO_ANDERE);
    andere.value = waarde !== '' && !kiesbaar ? waarde : '';
    const toon = () => { andere.hidden = sel.value !== ZOHO_ANDERE; if (!andere.hidden) andere.focus(); };
    sel.addEventListener('change', toon);
    andere.hidden = sel.value !== ZOHO_ANDERE;
    return [sel, andere];
  };
  const leesZoho = () => {
    const sel = zohoVeld.querySelector('select');
    if (!sel) return zohoVeld.querySelector('#bg-zoho')?.value ?? '';
    return sel.value === ZOHO_ANDERE ? (zohoVeld.querySelector('#bg-zoho-andere')?.value ?? '') : sel.value;
  };
  const tekenZoho = (waarde) => zohoVeld.replaceChildren(...(agenten ? lijstVeld(waarde) : tekstVeld(waarde)));
  tekenZoho(gebruiker?.zohoNaam ?? '');
  beheerVerzoek('/api/zoho-agenten').then((r) => {
    if (!zohoVeld.isConnected) return; // het formulier is intussen gesloten
    if (r.ok && Array.isArray(r.data?.agenten)) { agenten = r.data.agenten; tekenZoho(leesZoho().trim()); return; }
    zohoFoutTekst = ' De lijst met Zoho-gebruikers is nu niet beschikbaar: typ de naam in zoals in Zoho.';
    toonRolVelden();
  });
  const groepSales = h('div', { class: 'bg-groep' },
    veld('Naam in export', salesNaam),
    h('label', { class: 'bg-vink', for: 'bg-alle-sales' }, alleSales, h('span', { text: 'Mag alle sales zien' })));
  const toonRolVelden = () => {
    groepTechnieker.hidden = rol.value === 'sales';
    groepSales.hidden = rol.value !== 'sales';
    zohoHulp.textContent = (rol.value === 'technieker'
      ? 'Kies de naam zoals die in Zoho staat bij de tickets van deze technieker.'
      : 'Vul in als deze persoon ook interventies uitvoert.') + zohoFoutTekst;
  };
  rol.addEventListener('change', toonRolVelden);
  toonRolVelden();

  const annuleer = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Annuleren', onclick: venster.sluit });
  const verstuur = h('button', { type: 'submit', class: 'btn btn--primary', text: nieuw ? 'Aanmaken' : 'Opslaan' });
  const form = h('form', { class: 'bg-form', novalidate: true },
    nieuw ? veld('E-mailadres', email) : h('p', { class: 'bg-uitleg' }, 'E-mailadres: ', h('strong', { text: gebruiker.email })),
    veld('Naam', naam),
    veld('Rol', rol),
    laatsteBeheerder ? h('p', { class: 'bg-uitleg', text: ENIGE_BEHEERDER }) : null,
    groepTechnieker, groepSales, fout,
    h('div', { class: 'beheer-venster-acties' }, annuleer, verstuur));
  venster.body.append(form);
  (nieuw ? email : naam).focus();

  let bezig = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (bezig) return;
    fout.textContent = '';
    const invoer = {
      naam: naam.value, zohoNaam: leesZoho(), salesNaam: salesNaam.value, magAlleSales: alleSales.checked,
      ...(nieuw ? { email: email.value } : {}),
    };
    const v = valideerGebruikerFormulier(invoer, rol.value, { gebruikers: lijst, id: gebruiker?.id });
    if (v.fout) { fout.textContent = v.fout; return; }
    // Een leeg veld bij het bewerken ontkoppelt de Zoho-naam (zonder dit veld laat de server de oude staan).
    if (!nieuw && rol.value !== 'sales' && v.waarden.zohoNaam === undefined && gebruiker.zohoNaam) v.waarden.zohoNaam = '';
    bezig = true;
    verstuur.disabled = true; annuleer.disabled = true;
    const r = nieuw ? await roep('POST', { actie: 'maak', ...v.waarden }) : await roep('PATCH', { id: gebruiker.id, ...v.waarden });
    bezig = false;
    verstuur.disabled = false; annuleer.disabled = false;
    if (!r.ok) { fout.textContent = foutTekst(r); return; }
    venster.sluit();
    const wie = r.data?.gebruiker?.naam ?? v.waarden.naam;
    if (nieuw && typeof r.data?.startWachtwoord !== 'string') {
      toast(`${wie} is aangemaakt, maar het startwachtwoord ontbreekt in het antwoord. Gebruik "Startwachtwoord opnieuw instellen".`);
    } else if (nieuw) {
      toonGeheimen({
        titel: 'Gebruiker aangemaakt',
        intro: `${wie} kan nu inloggen. Geef het startwachtwoord door; je ziet het hier maar één keer.`
          + (Array.isArray(r.data?.herstelcodes) ? ' Een beheerder krijgt ook herstelcodes: bewaar ze veilig.' : ''),
        startWachtwoord: r.data?.startWachtwoord,
        herstelcodes: r.data?.herstelcodes,
      });
    } else if (Array.isArray(r.data?.herstelcodes)) {
      toonGeheimen({
        titel: 'Nieuwe beheerder',
        intro: `${wie} is nu beheerder. Bewaar de herstelcodes veilig; je ziet ze hier maar één keer.`,
        herstelcodes: r.data.herstelcodes,
      });
    } else {
      toast(`${wie} is bijgewerkt.`);
    }
    await naSucces();
  });
}

// "Nieuwe herstelcodes maken" voor het eigen beheerdersaccount: vraagt het eigen wachtwoord.
function toonNieuweHerstelcodes() {
  const venster = openBeheerVenster({ titel: 'Nieuwe herstelcodes maken' });
  const wachtwoord = h('input', { class: 'set-input', id: 'bg-eigen-ww', type: 'password', autocomplete: 'current-password' });
  const fout = h('p', { class: 'bg-fout', role: 'alert' });
  const annuleer = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Annuleren', onclick: venster.sluit });
  const verstuur = h('button', { type: 'submit', class: 'btn btn--primary', text: 'Codes maken' });
  const form = h('form', { class: 'bg-form', novalidate: true },
    h('p', { class: 'bg-uitleg', text: 'De oude herstelcodes van je account werken daarna niet meer. Vul je eigen wachtwoord in om te bevestigen.' }),
    veld('Je wachtwoord', wachtwoord), fout,
    h('div', { class: 'beheer-venster-acties' }, annuleer, verstuur));
  venster.body.append(form);
  wachtwoord.focus();
  let bezig = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (bezig) return;
    fout.textContent = '';
    if (wachtwoord.value === '') { fout.textContent = 'Vul je wachtwoord in.'; return; }
    bezig = true;
    verstuur.disabled = true; annuleer.disabled = true;
    const r = await roep('POST', { actie: 'nieuwe-herstelcodes', wachtwoord: wachtwoord.value });
    wachtwoord.value = ''; // het wachtwoord blijft niet in het formulier staan
    bezig = false;
    verstuur.disabled = false; annuleer.disabled = false;
    if (!r.ok) { fout.textContent = foutTekst(r); return; }
    if (!Array.isArray(r.data?.herstelcodes) || r.data.herstelcodes.length === 0) {
      fout.textContent = 'De server gaf geen herstelcodes terug. Probeer het opnieuw.';
      return;
    }
    venster.sluit();
    toonGeheimen({
      titel: 'Nieuwe herstelcodes',
      intro: 'Dit zijn je nieuwe herstelcodes. De oude werken niet meer. Je ziet ze hier maar één keer.',
      herstelcodes: r.data.herstelcodes,
    });
  });
}

// ── De tab ──────────────────────────────────────────────────────────────────────────────────────────────────────
const KOLOMMEN = ['Naam', 'E-mail', 'Rol', 'Status', 'Laatste login', 'Acties'];

async function render(container) {
  let lijst = [];
  const lijstWortel = h('div', { class: 'bg-lijst', tabindex: '-1' });
  const eigenId = () => huidigeGebruiker()?.id ?? null;

  const kop = h('div', { class: 'bg-kop' },
    h('h3', { class: 'bg-titel', text: 'Gebruikers' }),
    h('div', { class: 'bg-toolbar' },
      h('button', { type: 'button', class: 'btn btn--primary', text: 'Nieuwe gebruiker', onclick: () => toonGebruikerFormulier({ lijst, naSucces: laad }) }),
      h('button', { type: 'button', class: 'btn btn--secondary', text: 'Nieuwe herstelcodes maken', onclick: toonNieuweHerstelcodes })));
  container.replaceChildren(kop, lijstWortel);
  lijstWortel.append(h('p', { class: 'bg-uitleg', role: 'status', text: 'Gebruikers laden…' }));

  // Een rij-actie: bevestiging (indien nodig), verzoek, toast, lijst verversen. De knop blijft uit tot het klaar is.
  // Na afloop (lijst hertekend) krijgt de knop van die actie weer de focus, tenzij er een venster openstaat of de focus elders is.
  let laatsteActie = null;
  const WISSEL = { blokkeer: 'deblokkeer', deblokkeer: 'blokkeer' }; // na blokkeren staat op dezelfde plaats "Deblokkeren" (en omgekeerd)
  const zoekKnop = () => {
    if (!laatsteActie) return null;
    const knoppen = [...lijstWortel.querySelectorAll('button[data-id]')].filter(b => b.dataset.id === laatsteActie.id);
    return knoppen.find(b => b.dataset.actie === laatsteActie.actie) ?? knoppen.find(b => b.dataset.actie === WISSEL[laatsteActie.actie]) ?? null;
  };
  const focusTerug = () => zoekKnop() ?? lijstWortel;
  async function actie(knop, werk) {
    if (knop.disabled) return;
    knop.disabled = true;
    laatsteActie = { id: knop.dataset.id, actie: knop.dataset.actie };
    try { await werk(); } finally {
      knop.disabled = false;
      const actief = document.activeElement;
      if (!document.querySelector('.beheer-overlay') && (!actief || actief === document.body || lijstWortel.contains(actief))) focusTerug().focus();
    }
  }
  const verzoekMetToast = async (methode, body, succes) => {
    const r = await roep(methode, body);
    toast(r.ok ? succes : foutTekst(r));
    await laad();
    return r;
  };

  const blokkeer = (g) => async () => {
    const ja = await appConfirm({
      titel: 'Gebruiker blokkeren?', tekst: `${g.naam} kan niet meer inloggen en wordt overal uitgelogd.`, bevestigLabel: 'Blokkeren', gevaar: true,
    });
    if (ja) await verzoekMetToast('PATCH', { id: g.id, actief: false }, `${g.naam} is geblokkeerd.`);
  };
  const deblokkeer = (g) => async () => { await verzoekMetToast('PATCH', { id: g.id, actief: true }, `${g.naam} is gedeblokkeerd.`); };
  const resetWachtwoord = (g) => async () => {
    const ja = await appConfirm({
      titel: 'Startwachtwoord opnieuw instellen?',
      tekst: `${g.naam} krijgt een nieuw startwachtwoord, wordt overal uitgelogd en moet het bij de volgende login wijzigen.`,
      bevestigLabel: 'Opnieuw instellen', gevaar: true,
    });
    if (!ja) return;
    const r = await roep('POST', { actie: 'reset-wachtwoord', id: g.id });
    if (!r.ok || typeof r.data?.startWachtwoord !== 'string') { toast(foutTekst(r)); await laad(); return; }
    toonGeheimen({
      titel: 'Nieuw startwachtwoord',
      intro: `Geef dit startwachtwoord door aan ${g.naam}; je ziet het hier maar één keer. ${g.naam} is overal uitgelogd.`,
      startWachtwoord: r.data.startWachtwoord,
      focusTerug,
    });
    await laad();
  };
  const uitloggenOveral = (g) => async () => {
    // Het eigen account: ook deze sessie wordt beëindigd, dus eerst bevestigen.
    if (g.id === eigenId()) {
      const ja = await appConfirm({ titel: 'Overal uitloggen?', tekst: 'Je wordt ook op dit toestel uitgelogd. Doorgaan?', bevestigLabel: 'Uitloggen', gevaar: true });
      if (!ja) return;
    }
    await verzoekMetToast('POST', { actie: 'uitloggen-overal', id: g.id }, `${g.naam} is overal uitgelogd.`);
  };

  function rij(g) {
    const actief = g.actief === true;
    const eigen = g.id === eigenId();
    const cel = (label, ...inhoud) => h('td', { 'data-label': label }, h('div', { class: 'bg-cel' }, inhoud));
    const details = [g.zohoNaam ? `Zoho: ${g.zohoNaam}` : null, g.salesNaam ? `Export: ${g.salesNaam}` : null, g.magAlleSales ? 'Mag alle sales zien' : null].filter(Boolean);
    const knop = (tekst, naamActie, handler, extra = {}) => {
      const k = h('button', {
        type: 'button', class: `btn btn--secondary btn--sm${extra.klasse ? ' ' + extra.klasse : ''}`, text: tekst,
        'aria-label': `${tekst} ${g.naam}`, 'data-id': g.id, 'data-actie': naamActie, title: extra.titel, 'aria-disabled': extra.uit ? 'true' : null,
      });
      k.addEventListener('click', () => {
        if (extra.uit) { toast(extra.titel); return; }
        actie(k, handler);
      });
      return k;
    };
    const acties = h('div', { class: 'bg-acties' },
      knop('Bewerken', 'bewerk', async () => toonGebruikerFormulier({ gebruiker: g, lijst, naSucces: laad })),
      actief
        ? knop('Blokkeren', 'blokkeer', blokkeer(g), kanBlokkeren(lijst, g.id) ? {} : { uit: true, titel: ENIGE_BEHEERDER, klasse: 'btn--danger' })
        : knop('Deblokkeren', 'deblokkeer', deblokkeer(g)),
      knop('Startwachtwoord opnieuw instellen', 'reset', resetWachtwoord(g)),
      knop('Overal uitloggen', 'uitloggen', uitloggenOveral(g)));
    return h('tr', { class: actief ? null : 'bg-inactief', 'data-id': g.id },
      cel('Naam', h('span', { class: 'bg-naam', text: eigen ? `${g.naam} (jij)` : String(g.naam ?? '') }),
        details.length ? h('small', { class: 'bg-sub', text: details.join(' · ') }) : null),
      cel('E-mail', String(g.email ?? '')),
      cel('Rol', rolLabel(g.rol)),
      cel('Status', h('span', { class: `bg-chip ${actief ? 'bg-chip--actief' : 'bg-chip--geblokkeerd'}`, text: actief ? 'Actief' : 'Geblokkeerd' }),
        g.moetWachtwoordWijzigen ? h('small', { class: 'bg-sub', text: 'Moet het wachtwoord nog wijzigen' }) : null),
      cel('Laatste login', formatLaatsteLogin(g.laatsteLogin)),
      cel('Acties', acties));
  }

  function teken() {
    const actiefEl = document.activeElement;
    const focusSleutel = lijstWortel.contains(actiefEl) && actiefEl.dataset?.id ? { id: actiefEl.dataset.id, actie: actiefEl.dataset.actie } : null;
    if (lijst.length === 0) {
      lijstWortel.replaceChildren(h('p', { class: 'bg-uitleg', text: 'Er zijn nog geen gebruikers.' }));
      return;
    }
    const tabel = h('table', { class: 'bg-tabel' },
      h('caption', { class: 'sr-only', text: 'Gebruikers' }),
      h('thead', {}, h('tr', {}, KOLOMMEN.map(k => h('th', { scope: 'col', text: k })))),
      h('tbody', {}, sorteerGebruikers(lijst).map(rij)));
    lijstWortel.replaceChildren(tabel);
    if (focusSleutel) {
      const terug = [...lijstWortel.querySelectorAll('button[data-id]')].find(b => b.dataset.id === focusSleutel.id && b.dataset.actie === focusSleutel.actie);
      (terug || lijstWortel).focus();
    }
  }

  async function laad() {
    const r = await roep('GET');
    if (!r.ok) {
      const opnieuw = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Opnieuw proberen', onclick: laad });
      lijstWortel.replaceChildren(h('p', { class: 'bg-fout', role: 'alert', text: foutTekst(r) }), opnieuw);
      return;
    }
    lijst = Array.isArray(r.data?.gebruikers) ? r.data.gebruikers.filter(g => g && typeof g === 'object') : [];
    teken();
  }

  await laad();
}

registreerBeheerTab({ id: 'gebruikers', label: 'Gebruikers', render });
