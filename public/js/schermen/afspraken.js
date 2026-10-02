// schermen/afspraken.js — eigen afspraken (etappe 5b): laden, bewaren, het manuele formulier, het lokale detail en de import.
// De code is letterlijk uit index.html verhuisd (D12: ook saveAfspraken, die naar de backend schrijft met 409-merge en één retry
// via kern.api.bewaarMetVersie). Enkel de voorvoegsels zijn nieuw: `afh.` voor het klassieke script en andere schermen,
// `toestand.get/set/raak` voor localEvents, tickets en de actieve technieker (telkens op het moment van gebruik gelezen, nooit
// over een await heen bewaard), en imports. `localEventsVersie`, `_pendingImport` en `_localDetEvent` zijn module-privé.
// De pure delen (matchRespToPerson, technieklijst, de reviewrijen en de duplicaatfilter) staan in afspraken-logica.js.
// Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe. De knoppen en de technieker-select
// van de import lopen via data-actie/data-wijzig-delegatie; elke overlay sluit via registreerBackdrop.
import { toestand } from '../kern/toestand.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { toast, escHtml, registreerActies, registreerWijzigActies, registreerBackdrop, strengeAfh } from '../kern/ui.js';
import { apiJson, bewaarMetVersie } from '../kern/api.js';
import { fmtDate } from '../kern/tijd.js';
import { persoonOfNull } from '../kern/selecties.js';
import { registreerVenster } from '../venster.js';
import { telNummer } from './ticketdetail-logica.js';
import { matchRespToPerson, technieklijst, bouwImportRijen, nieuweImportItems } from './afspraken-logica.js';

export { matchRespToPerson };

// Afhankelijkheden uit het klassieke script en andere schermen (ingevuld door initAfspraken); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('afspraken: initAfspraken() is niet aangeroepen'); } });

export function initAfspraken(afhankelijkheden) {
  afh = strengeAfh('afspraken', afhankelijkheden);
  registreerActies(document.body, {
    'afspraak-nieuw':   () => openManueelModal(),
    'import-kies':      () => document.getElementById('import-file-input').click(),
    'import-sluit':     () => closeImportModal(),
    'import-bevestig':  () => confirmImport(),
    'local-sluit':      () => closeLocalDet(),
    'local-foto':       () => afh.openFotoModal(_localDetEvent?.id),
    'local-aankomst':   () => afh.registerArrival(_localDetEvent?.id, _localDetEvent?.datum),
    'local-rapport':    () => afh.openRapport(_localDetEvent?.id, _localDetEvent?.datum),
    'local-bewerk':     () => editFromLocalDet(),
    'local-verwijder':  () => deleteFromLocalDet(),
    'manueel-sluit':    () => closeManueelModal(),
    'manueel-opslaan':  () => saveManueelAfspraak(),
  });
  registreerWijzigActies(document.body, {
    'import-bestand':   (el) => handleImportFile(el),
    'import-persoon':   (el, e, arg) => { _pendingImport[Number(arg)].persoon = el.value || null; },
  });
  for (const [id, sluit] of [['import-overlay', closeImportModal], ['local-det-overlay', closeLocalDet], ['manueel-overlay', closeManueelModal]]) {
    const overlay = document.getElementById(id);
    registreerBackdrop(overlay, sluit);
    registreerVenster({ el: overlay, sluit: () => sluit() });
  }
}

let localEventsVersie  = 0;
let _pendingImport     = []; // staging area voor import review

const AFG_API = '/api/afspraken';

export async function loadAfspraken() {
  afh.sjLog('loadAfspraken'); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  if (!TEST_MODE) {
    const cached = afh.loadFromCache('blitz_afspraken_cache');
    if (cached) {
      toestand.set('localEvents', cached.afspraken || []);
      localEventsVersie = cached.versie || 0;
      // renderKalender volgt via koppelRenders (omhuld door metBehoudScroll)
    }
  }
  try {
    const data = await apiJson(AFG_API);
    toestand.set('localEvents', data.afspraken || []);
    localEventsVersie = data.versie    || 0;
    if (!TEST_MODE) afh.saveToCache('blitz_afspraken_cache', { afspraken: toestand.get('localEvents'), versie: localEventsVersie });
  } catch (err) {
    console.warn('Afspraken laden mislukt:', err);
    // Bewuste gedragswijziging (Blok 1D): bij een fout NIET meer terugvallen naar een lege staat
    // als er al cache-data toegepast werd hierboven; enkel als er ook geen cache was, resetten we
    // (zelfde gedrag als pre-Blok-1D in dat specifieke geval).
    if (TEST_MODE || !afh.loadFromCache('blitz_afspraken_cache')) {
      toestand.set('localEvents', []);
      localEventsVersie = 0;
    }
  }
}

// Bij een 409 (collega schreef net) wordt de eigen wijziging over de server-stand gelegd en één keer
// opnieuw bewaard (kern.api.bewaarMetVersie). Lukt ook dat niet (tweede 409): waarschuwing + server-stand.
// Geeft 'ok', 'conflict' (localEvents is door de server-stand vervangen) of 'fout' (andere mislukking).
export async function saveAfspraken({ toegevoegd = [], gewijzigd = [], verwijderd = [] } = {}) {
  try {
    const result = await bewaarMetVersie({
      pad: AFG_API, veld: 'afspraken', versie: localEventsVersie, waarde: toestand.get('localEvents'),
      voegSamen: (server) => {
        let lijst = [...(server || [])];
        if (verwijderd.length) lijst = lijst.filter(e => !verwijderd.includes(e.id));
        for (const w of gewijzigd) {
          const i = lijst.findIndex(e => e.id === w.id);
          if (i === -1) lijst.push(w); else lijst[i] = w;
        }
        for (const t of toegevoegd) {
          if (!lijst.some(e => e.id === t.id)) lijst.push(t);
        }
        return lijst;
      },
    });
    if (!result.ok && result.reden === 'conflict') {
      // Tweede 409: toon de server-stand, niet onze mislukte poging.
      if (result.laatsteServer !== undefined) {
        toestand.set('localEvents', result.laatsteServer || []);
        localEventsVersie = result.laatsteVersie || 0;
      } else {
        toestand.set('localEvents', result.waarde || []);
        localEventsVersie = result.versie || 0;
      }
      toast('⚠ Iemand anders wijzigde dit net. De afspraken zijn opnieuw geladen.', 3000);
      return 'conflict';
    }
    // Enkel na een 409-merge is `waarde` een nieuwe (samengevoegde) stand; anders is het de array die we verstuurden
    // en kan localEvents tijdens het await al opnieuw toegewezen zijn (dan niet overschrijven).
    if (result.samengevoegd) toestand.set('localEvents', result.waarde);
    localEventsVersie = result.versie;
    if (!result.ok) throw new Error(result.reden === 'netwerk' ? 'netwerk' : 'HTTP ' + result.status);
    return 'ok';
  } catch (err) {
    console.error('Afspraken opslaan mislukt:', err);
    toast('✕ Afspraken opslaan mislukt', 3000);
    return 'fout';
  }
}

// File-input handler
export function handleImportFile(input) {
  const file = input.files[0];
  input.value = ''; // reset zodat hetzelfde bestand opnieuw kan
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      startImport(data);
    } catch {
      toast('✕ Ongeldig JSON-bestand', 3000);
    }
  };
  reader.readAsText(file);
}

function startImport(data) {
  const afspraken = data.afspraken || data; // tolereer ook bare array
  if (!Array.isArray(afspraken) || !afspraken.length) {
    toast('⚠ Geen afspraken gevonden in bestand', 3000);
    return;
  }

  // Huidige agents uit tickets
  const agents = technieklijst(toestand.get('allTickets'), toestand.get('allGepland'), toestand.get('allPending'), toestand.get('localEvents'));

  _pendingImport = bouwImportRijen(afspraken, agents, () => crypto.randomUUID());

  renderImportModal(agents);
  document.getElementById('import-overlay').classList.add('open');
}

function renderImportModal(agents) {
  const sub  = document.getElementById('import-subtitle');
  const list = document.getElementById('import-list');
  if (!sub || !list) return;

  const unmatched = _pendingImport.filter(a => !a.persoon).length;
  sub.textContent = `${afh.meervoud(_pendingImport.length, 'afspraak', 'afspraken')} · ${unmatched} onbekende technicus`;

  const agentOpts = (agents || []).map(a => `<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('');

  list.innerHTML = _pendingImport.map((a, i) => {
    const matched = !!a.persoon;
    const dateLabel = a.datum
      ? new Date(a.datum + 'T12:00:00').toLocaleDateString('nl-BE', { weekday:'short', day:'numeric', month:'short' })
      : '?';
    const tijdLabel = a.uur ? `${a.uur}${a.einduur ? '–' + a.einduur : ''}` : '';
    return `<div class="imp-item">
      <div class="imp-item-title">${escHtml(a.titel)}</div>
      <div class="imp-item-meta">${dateLabel}${tijdLabel ? ' · ' + tijdLabel : ''}${a.notitie ? ' · ' + escHtml(a.notitie) : ''}</div>
      <div class="imp-person-row">
        <span class="imp-person-label">Technieker:</span>
        <select class="imp-person-sel" aria-label="Toewijzen aan technieker" data-wijzig="import-persoon" data-arg="${i}"
          data-idx="${i}">
          <option value="">— Niet toewijzen —</option>
          ${agents.map(ag => `<option value="${escHtml(ag)}"${a.persoon === ag ? ' selected' : ''}>${escHtml(ag)}</option>`).join('')}
        </select>
        <span class="imp-match-tag ${matched ? 'ok' : 'mis'}">${matched ? '✓ Match' : '⚠ Handmatig'}</span>
      </div>
    </div>`;
  }).join('');
}

export function closeImportModal(e) {
  if (e && e.target !== document.getElementById('import-overlay')) return;
  document.getElementById('import-overlay').classList.remove('open');
  _pendingImport = [];
}

async function confirmImport() {
  // Duplicaten overslaan op basis van datum+titel+uur
  const nieuweItems = nieuweImportItems(_pendingImport, toestand.get('localEvents'));

  if (!nieuweItems.length) {
    toast('Alle afspraken zijn al aanwezig', 2000);
    document.getElementById('import-overlay').classList.remove('open');
    return;
  }

  toestand.get('localEvents').push(...nieuweItems);
  toestand.raak('localEvents'); // in-place push
  document.getElementById('import-overlay').classList.remove('open');
  _pendingImport = [];

  const res = await saveAfspraken({ toegevoegd: nieuweItems });
  if (res !== 'ok') {
    toestand.set('localEvents', toestand.get('localEvents').filter(e => !nieuweItems.some(n => n.id === e.id)));
  } else {
    toast(`✓ ${afh.meervoud(nieuweItems.length, 'afspraak', 'afspraken')} geïmporteerd`, 2500);
  }
}

// ── Manuele afspraak ──────────────────────────────────────────────────────

export function openManueelModal(prefillDate) {
  const agents = technieklijst(toestand.get('allTickets'), toestand.get('allGepland'), toestand.get('allPending'), toestand.get('localEvents'));

  const sel = document.getElementById('man-persoon');
  if (sel) {
    const myPerson = persoonOfNull(toestand.get('activeAssigneeFilter'));
    sel.innerHTML = `<option value="">— Geen —</option>` +
      agents.map(a => `<option value="${escHtml(a)}"${a === myPerson ? ' selected' : ''}>${escHtml(a)}</option>`).join('');
  }
  if (prefillDate) {
    const datEl = document.getElementById('man-datum');
    if (datEl) datEl.value = prefillDate;
  }
  // Reset edit mode
  const editId = document.getElementById('man-edit-id');
  if (editId) editId.value = '';
  const typeElReset = document.getElementById('man-type');
  if (typeElReset) typeElReset.value = 'Service';
  const titleEl = document.getElementById('manueel-modal-title');
  if (titleEl) titleEl.textContent = '➕ Afspraak toevoegen';
  document.getElementById('manueel-overlay').classList.add('open');
}

export function openManueelModalEdit(ev) {
  if (!ev) return;
  // Populate agents list
  openManueelModal(null);
  // Override with event values
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('man-edit-id', ev.id);
  set('man-titel',   ev.titel   || '');
  set('man-datum',   ev.datum   || '');
  set('man-van',     ev.uur     || '');
  set('man-tot',     ev.einduur || '');
  set('man-adres',   ev.adres   || '');
  set('man-telefoon',ev.telefoon|| '');
  set('man-email',   ev.email   || '');
  set('man-notitie', ev.notitie || '');
  // Type
  const typeEl = document.getElementById('man-type');
  if (typeEl && ev.type) typeEl.value = ev.type;
  // Persoon
  const selEl = document.getElementById('man-persoon');
  if (selEl && ev.persoon) selEl.value = ev.persoon;
  // Update modal title
  const titleEl = document.getElementById('manueel-modal-title');
  if (titleEl) titleEl.textContent = '✏️ Afspraak bewerken';
  // Close detail modal, keep edit form open
  document.getElementById('local-det-overlay').classList.remove('open');
}

export function closeManueelModal(e) {
  if (e && e.target !== document.getElementById('manueel-overlay')) return;
  document.getElementById('manueel-overlay').classList.remove('open');
}

export async function saveManueelAfspraak() {
  const titel    = document.getElementById('man-titel')?.value?.trim();
  const datum    = document.getElementById('man-datum')?.value;
  const type     = document.getElementById('man-type')?.value || 'Overige';
  const van      = document.getElementById('man-van')?.value || '';
  const tot      = document.getElementById('man-tot')?.value || '';
  const persoon  = document.getElementById('man-persoon')?.value || null;
  const adres    = document.getElementById('man-adres')?.value?.trim()    || '';
  const telefoon = document.getElementById('man-telefoon')?.value?.trim() || '';
  const email    = document.getElementById('man-email')?.value?.trim()    || '';
  const notitie  = document.getElementById('man-notitie')?.value?.trim()  || '';
  const editId   = document.getElementById('man-edit-id')?.value || '';

  if (!titel) { toast('⚠ Voer een titel in', 2000); return; }
  if (!datum) { toast('⚠ Kies een datum', 2000); return; }

  document.getElementById('manueel-overlay').classList.remove('open');
  // Reset formulier
  ['man-titel','man-adres','man-telefoon','man-email','man-notitie','man-edit-id'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  if (editId) {
    // Edit mode: update bestaand event
    const idx = toestand.get('localEvents').findIndex(e => e.id === editId);
    if (idx === -1) { toast('⚠ Afspraak niet gevonden', 2000); return; }
    const oldEvent = { ...toestand.get('localEvents')[idx] };
    const nieuwEvent = { ...oldEvent, titel, datum, uur: van, einduur: tot, type, persoon: persoon || null, adres, notitie, telefoon, email };
    toestand.get('localEvents')[idx] = nieuwEvent;
    toestand.raak('localEvents'); // in-place
    const res = await saveAfspraken({ gewijzigd: [nieuwEvent] });
    if (res !== 'ok') {
      // Rollback op id, en enkel als onze wijziging er nog staat (bij een conflict is de server-stand geladen).
      const nu = toestand.get('localEvents').findIndex(e => e.id === oldEvent.id);
      if (nu !== -1 && toestand.get('localEvents')[nu] === nieuwEvent) {
        toestand.get('localEvents')[nu] = oldEvent;
        toestand.raak('localEvents'); // in-place
      }
    } else {
      toast('✓ Afspraak bijgewerkt', 2000);
    }
  } else {
    // Nieuw event
    const event = {
      id: crypto.randomUUID(),
      titel, datum, uur: van, einduur: tot, type,
      persoon: persoon || null, adres, notitie, telefoon, email,
      bron: 'manueel', origResp: null,
    };
    toestand.get('localEvents').push(event);
    toestand.raak('localEvents'); // in-place push
    const res = await saveAfspraken({ toegevoegd: [event] });
    if (res !== 'ok') {
      toestand.set('localEvents', toestand.get('localEvents').filter(e => e.id !== event.id));
    } else {
      toast('✓ Afspraak opgeslagen', 2000);
    }
  }
}

export async function removeLocalEvent(id) {
  const removed = toestand.get('localEvents').find(e => e.id === id);
  toestand.set('localEvents', toestand.get('localEvents').filter(e => e.id !== id));
  const res = await saveAfspraken({ verwijderd: [id] });
  // Na een conflict is de server-stand geladen: niets terugzetten. Anders enkel als het id niet al aanwezig is.
  if (res === 'fout' && removed && !toestand.get('localEvents').some(e => e.id === id)) {
    toestand.get('localEvents').push(removed);
    toestand.raak('localEvents'); // in-place push
  }
}

// ── Lokale afspraak detail ─────────────────────────────────
let _localDetEvent = null;

export function openLocalEventDetail(ev) {
  _localDetEvent = ev;
  document.getElementById('ld-btn-rapport').style.display = '';
  document.getElementById('ld-type').innerHTML  = `<span class="cal-local-type">${escHtml(ev.type)}</span>`;
  document.getElementById('ld-titel').textContent = ev.titel || '—';

  const datumTijd = [
    ev.datum ? fmtDate(ev.datum) : '',
    ev.uur ? `${ev.uur}${ev.einduur ? '–' + ev.einduur : ''}` : '',
  ].filter(Boolean).join(' · ');
  document.getElementById('ld-datum').textContent = datumTijd;

  const adres = ev.adres || ev.notitie;
  const row = (label, val) => val
    ? `<div class="mrow"><span class="mlabel">${label}</span><span class="mval">${escHtml(val)}</span></div>`
    : '';
  // href moet óók door escHtml: ev.telefoon/ev.email komen uit de (niet-geauthenticeerde)
  // afspraken-blob, en een dubbele quote daarin brak anders uit het href-attribuut. Het
  // schema staat vast in de call-site (tel:/mailto:), dus escapen is hier voldoende —
  // vergelijk de Google-Maps-link hieronder, die de waarde via encodeURIComponent dicht zet.
  const linkRow = (label, val, href) => val
    ? `<div class="mrow"><span class="mlabel">${label}</span><span class="mval"><a href="${escHtml(href)}">${escHtml(val)}</a></span></div>`
    : '';

  const rows = [
    adres
      ? `<div class="mrow"><span class="mlabel">Adres</span><span class="mval"><a href="#" class="mval-nav-link" data-adres="${escHtml(adres)}">${escHtml(adres)} ↗</a></span></div>`
      : '',
    /\d/.test(telNummer(ev.telefoon)) ? linkRow('Telefoon', ev.telefoon, `tel:${telNummer(ev.telefoon)}`) : row('Telefoon', ev.telefoon),
    linkRow('E-mail',   ev.email,    `mailto:${ev.email}`),
    ev.adres && ev.notitie ? row('Notitie', ev.notitie) : '',
    row('Technieker', ev.persoon),
  ].filter(Boolean).join('');

  document.getElementById('ld-body').innerHTML = rows
    || '<div class="mrow"><span class="mval" style="color:var(--muted)">Geen contactgegevens beschikbaar</span></div>';
  document.getElementById('ld-body').querySelector('.mval-nav-link')?.addEventListener('click', e => {
    e.preventDefault();
    afh.navigate(encodeURIComponent(e.currentTarget.dataset.adres));
  });

  document.getElementById('local-det-overlay').classList.add('open');
}

export function closeLocalDet(e) {
  if (e && e.target !== document.getElementById('local-det-overlay')) return;
  document.getElementById('local-det-overlay').classList.remove('open');
}

function editFromLocalDet() {
  if (!_localDetEvent) return;
  openManueelModalEdit(_localDetEvent);
}

async function deleteFromLocalDet() {
  if (!_localDetEvent) return;
  const ev = _localDetEvent;
  if (!confirm(`🗑 "${ev.titel}" verwijderen (${ev.datum ? fmtDate(ev.datum) : ev.datum})?`)) return;
  document.getElementById('local-det-overlay').classList.remove('open');
  _localDetEvent = null;
  await removeLocalEvent(ev.id);
}
