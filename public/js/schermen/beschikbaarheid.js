// schermen/beschikbaarheid.js — blokkeringen (beschikbaarheid van technici en uitzonderingen) (etappe 5b): laden, bewaren,
// het blokkeringsvenster vanuit de kalender en de tab "Beschikbaarheden" in de instellingen.
// De code is letterlijk uit index.html verhuisd (D12: ook saveAvailability en elke schrijfactie op avExceptions, die naar de
// backend schrijven met 409 -> server-stand overnemen, zonder retry). Enkel de voorvoegsels zijn nieuw: `afh.` voor het
// klassieke script, `toestand.get/set/raak` voor avExceptions, settings, tickets en de actieve technieker, en imports.
// `avVersie` en de formulierstatus (_avForm*, _bav*) zijn module-privé. De pure delen (nextWorkday, groupExceptionsForDisplay)
// staan in beschikbaarheid-logica.js. De twee formulieren (venster en tab) blijven bewust afzonderlijke functies.
// Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe. De knoppen en velden van beide
// formulieren lopen via data-actie/data-wijzig-delegatie; de overlay sluit via registreerBackdrop (inhoudsklik sluit niet).
// De verwijderknoppen van bestaande blokkeringen blijven addEventListener: hun id komt uit de (niet-geauthenticeerde) blob.
import { toestand } from '../kern/toestand.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { toast, escHtml, registreerActies, registreerWijzigActies, registreerBackdrop, strengeAfh } from '../kern/ui.js';
import { apiJson, apiVerzoek, leesFout } from '../kern/api.js';
import { localISO } from '../kern/tijd.js';
import { persoonOfNull } from '../kern/selecties.js';
import { registreerVenster } from '../venster.js';
import { groupExceptionsForDisplay } from './beschikbaarheid-logica.js';

// Afhankelijkheden uit app.js (ingevuld door initBeschikbaarheid); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('beschikbaarheid: initBeschikbaarheid() is niet aangeroepen'); } });

export function initBeschikbaarheid(afhankelijkheden) {
  afh = strengeAfh('beschikbaarheid', afhankelijkheden);
  _bavFormDate = localISO(new Date());
  registreerActies(document.body, {
    'blok-sluit':        () => closeBlock(),
    'av-scope':          (el) => avSetScope(el.dataset.arg),
    'av-kind':           (el) => avSetKind(el.dataset.arg),
    'av-toevoegen':      () => avAddException(),
    'bav-scope':         (el) => bavSetScope(el.dataset.arg),
    'bav-kind':          (el) => bavSetKind(el.dataset.arg),
    'bav-toevoegen':     () => avAddExceptionFromSettings(),
  });
  registreerWijzigActies(document.body, {
    'av-multiday':       (el) => avSetMultiDay(el.checked),
    'av-datum':          (el) => { _avFormDate = el.value; },
    'av-datum-tot':      (el) => { _avFormDateTot = el.value; },
    'bav-multiday':      (el) => bavSetMultiDay(el.checked),
    'bav-datum':         (el) => { _bavFormDate = el.value; },
    'bav-datum-tot':     (el) => { _bavFormDateTot = el.value; },
    'bav-filter-persoon': (el) => bavSetFilterPerson(el.value),
  });
  const overlay = document.getElementById('block-overlay');
  registreerBackdrop(overlay, closeBlock);
  registreerVenster({ el: overlay, sluit: () => closeBlock() });
}

// avExceptions: { id, scope, person, date, kind, from, to, reason }  (in de toestand)
let avVersie = 0;
export function versie() { return avVersie; }

const AV_API = '/api/availability';

// zonderCache: de bewaarde kopie niet toepassen (resync na een onzeker resultaat, N7).
export async function loadAvailability({ zonderCache = false } = {}) {
  afh.sjLog('loadAvailability'); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  if (!TEST_MODE && !zonderCache) {
    const cached = afh.loadFromCache('blitz_availability_cache');
    if (cached) {
      toestand.set('avExceptions', cached.exceptions || []);
      avVersie     = cached.versie || 0;
      // renderKalender volgt via koppelRenders (omhuld door metBehoudScroll)
    }
  }
  try {
    const data = await apiJson(AV_API);
    toestand.set('avExceptions', data.exceptions || []);
    avVersie     = data.versie     || 0;
    // Live lezen na de await: de toestand kan sinds de fetch gewijzigd zijn.
    if (!TEST_MODE) afh.saveToCache('blitz_availability_cache', { exceptions: toestand.get('avExceptions'), versie: avVersie });
  } catch (err) {
    console.warn('Beschikbaarheid laden mislukt:', err);
    // Bewuste gedragswijziging (Blok 1D): bij een fout NIET meer terugvallen naar een lege staat
    // als er al cache-data toegepast werd hierboven; enkel als er ook geen cache was, resetten we
    // (zelfde gedrag als pre-Blok-1D in dat specifieke geval).
    if (!zonderCache && (TEST_MODE || !afh.loadFromCache('blitz_availability_cache'))) { // een mislukte resync wist de huidige stand niet
      toestand.set('avExceptions', []);
      avVersie     = 0;
    }
  }
}

export async function saveAvailability() {
  try {
    const res = await apiVerzoek(AV_API, { methode: 'PUT', body: { versie: avVersie, exceptions: toestand.get('avExceptions') } });
    if (res.status === 409 && res.data?.data) {
      // Conflict: herladen en opnieuw toepassen
      toestand.set('avExceptions', res.data?.data?.exceptions || []);
      avVersie     = res.data?.data?.versie     || 0;
      toast('⚠ Iemand anders wijzigde dit net. De gegevens zijn opnieuw geladen.', 3000);
      renderBlockModal();
      return false;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    avVersie = res.data.versie;
    return true;
  } catch (err) {
    console.error('Beschikbaarheid opslaan mislukt:', err);
    toast('✕ Opslaan is niet gelukt. Controleer je verbinding en probeer opnieuw.', 3000);
    // W5-fix (N7): onzeker resultaat (de server kan het toch bewaard hebben): ná de rollback van de oproeper de serverstand ophalen.
    if (leesFout(err).onzeker) setTimeout(resyncNaOnzeker, 0);
    return false;
  }
}

async function resyncNaOnzeker() {
  await loadAvailability({ zonderCache: true });
  // Live lezen na de await: de open formulieren tonen de nieuwe stand.
  if (document.getElementById('block-overlay')?.classList.contains('open')) renderBlockModal();
  renderBeschikbaarhedenTab();
}

// Status: welke knop actief is in het formulier
let _avFormKind     = 'fullday'; // 'fullday' | 'range'
let _avFormScope    = 'person';  // 'person'  | 'global'
let _avFormDate     = null;
let _avFormDateTot  = null;      // einde datumrange (alleen bij fullday + meerdere dagen)
let _avFormMultiDay = false;     // true = verlof over meerdere werkdagen

export function openBlockModal(dateStr) {
  _avFormDate     = dateStr;
  _avFormDateTot  = null;
  _avFormMultiDay = false;
  _avFormKind     = 'fullday';
  _avFormScope    = toestand.get('activeAssigneeFilter') !== 'all' ? 'person' : 'global';
  const d = new Date(dateStr + 'T12:00:00');
  document.getElementById('block-date-label').textContent =
    d.toLocaleDateString('nl-BE', { weekday:'long', day:'numeric', month:'long' });
  renderBlockModal();
  document.getElementById('block-overlay').classList.add('open');
}

export function closeBlock(e) {
  if (e && e.target !== document.getElementById('block-overlay')) return;
  document.getElementById('block-overlay').classList.remove('open');
}

function renderBlockModal() {
  const dateStr   = _avFormDate;
  const myPerson  = persoonOfNull(toestand.get('activeAssigneeFilter'));
  const body      = document.getElementById('block-modal-body');
  if (!body || !dateStr) return;

  // Bestaande uitzonderingen voor deze dag
  const existing = toestand.get('avExceptions').filter(e => e.date === dateStr);

  const existingHtml = existing.length === 0
    ? `<div class="av-empty">Geen blokkeringen voor deze dag.</div>`
    : existing.map(e => {
        const whoLabel = e.scope === 'global' ? 'Iedereen' : (e.person || '?');
        const kindLabel = e.kind === 'fullday'
          ? '🔒 Hele dag'
          : `⏱ ${e.from}–${e.to}`;
        const reasonPart = e.reason ? ` — ${escHtml(e.reason)}` : '';
        return `<div class="av-item">
          <span class="av-item-label">${kindLabel}${reasonPart} <span class="av-item-who">(${escHtml(whoLabel)})</span></span>
          <button class="av-item-del" data-exception-id="${escHtml(e.id)}" title="Verwijderen" aria-label="Blokkering verwijderen">✕</button>
        </div>`;
      }).join('');

  const defaultVan = toestand.get('settings').vanTijd || '08:00';
  const defaultTot = toestand.get('settings').totTijd || '17:00';
  const personName = myPerson || 'Ik';
  const scopeOptions = myPerson
    ? `<button class="av-radio-btn ${_avFormScope === 'person' ? 'active' : ''}" aria-pressed="${_avFormScope === 'person'}" data-actie="av-scope" data-arg="person">👤 ${escHtml(myPerson.split(' ')[0])}</button>
       <button class="av-radio-btn ${_avFormScope === 'global' ? 'active' : ''}" aria-pressed="${_avFormScope === 'global'}" data-actie="av-scope" data-arg="global">👥 Iedereen</button>`
    : `<button class="av-radio-btn active" aria-pressed="true" disabled>👥 Iedereen</button>`;

  body.innerHTML = `
    <div class="av-section-title" role="heading" aria-level="3">Bestaande blokkeringen</div>
    <div class="av-existing">${existingHtml}</div>

    <div class="av-form">
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Type</div>
        <div class="av-radio-group">
          <button class="av-radio-btn ${_avFormKind === 'fullday' ? 'active' : ''}" aria-pressed="${_avFormKind === 'fullday'}" data-actie="av-kind" data-arg="fullday">🔒 Hele dag</button>
          <button class="av-radio-btn ${_avFormKind === 'range'   ? 'active' : ''}" aria-pressed="${_avFormKind === 'range'}" data-actie="av-kind" data-arg="range">⏱ Tijdvak</button>
        </div>
      </div>
      ${_avFormKind === 'fullday' ? `
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Periode</div>
        <div class="av-time-row" style="gap:8px;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer">
            <input type="checkbox" id="av-multiday" data-wijzig="av-multiday" ${_avFormMultiDay ? 'checked' : ''} />
            Meerdere werkdagen (verlof)
          </label>
        </div>
        ${_avFormMultiDay ? `
        <div class="av-time-row" style="gap:8px;margin-top:8px">
          <span style="font-size:0.8rem;color:var(--muted)">Van</span>
          <input type="date" class="av-time-input" id="av-date-van" aria-label="Van datum" value="${_avFormDate}" data-wijzig="av-datum" />
          <span style="font-size:0.8rem;color:var(--muted)">Tot</span>
          <input type="date" class="av-time-input" id="av-date-tot" aria-label="Tot datum" value="${_avFormDateTot || ''}" data-wijzig="av-datum-tot" />
        </div>` : ''}
      </div>` : `
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Tijdvak</div>
        <div class="av-time-row">
          <span style="font-size:0.8rem;color:var(--muted)">Van</span>
          <input class="av-time-input" id="av-van" aria-label="Van (tijd)" type="time" value="${defaultVan}" />
          <span style="font-size:0.8rem;color:var(--muted)">Tot</span>
          <input class="av-time-input" id="av-tot" aria-label="Tot (tijd)" type="time" value="${defaultTot}" />
        </div>
      </div>`}
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Voor</div>
        <div class="av-radio-group">${scopeOptions}</div>
      </div>
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Reden <span style="font-weight:400;text-transform:none;letter-spacing:0">(optioneel)</span></div>
        <input class="av-reden-input" id="av-reden" aria-label="Reden" type="text" placeholder="bv. Verlof, dokter, opleiding…" />
      </div>
      <button class="av-add-btn" data-actie="av-toevoegen">➕ Toevoegen</button>
    </div>`;

  // e.id komt uit de beschikbaarheid-blob (niet-geauthenticeerd) — data-attribuut +
  // addEventListener i.p.v. inline onclick (zelfde reden als .btn-navigeer-knoppen).
  body.querySelectorAll('.av-item-del').forEach(btn => {
    btn.addEventListener('click', () => avRemoveException(btn.dataset.exceptionId || ''));
  });
}

function avSetKind(kind) {
  _avFormKind = kind;
  if (kind !== 'fullday') _avFormMultiDay = false; // multiday alleen bij fullday
  renderBlockModal();
}

function avSetScope(scope) {
  _avFormScope = scope;
  renderBlockModal();
}

function avSetMultiDay(checked) {
  _avFormMultiDay = checked;
  if (!checked) _avFormDateTot = null;
  renderBlockModal();
}

async function avAddException() {
  const myPerson = persoonOfNull(toestand.get('activeAssigneeFilter'));
  const scope    = (myPerson && _avFormScope === 'person') ? 'person' : 'global';
  const from     = _avFormKind === 'range' ? (document.getElementById('av-van')?.value || toestand.get('settings').vanTijd) : null;
  const to       = _avFormKind === 'range' ? (document.getElementById('av-tot')?.value || toestand.get('settings').totTijd) : null;
  const reason   = document.getElementById('av-reden')?.value?.trim() || '';

  if (_avFormKind === 'range' && from >= to) {
    toast('⚠ Eindtijd moet na begintijd liggen', 2500);
    return;
  }

  // Meerdere werkdagen (verlof-range)
  if (_avFormKind === 'fullday' && _avFormMultiDay && _avFormDateTot) {
    const vanDate = new Date(_avFormDate   + 'T12:00:00');
    const totDate = new Date(_avFormDateTot + 'T12:00:00');
    if (totDate < vanDate) {
      toast('⚠ Einddatum moet na startdatum liggen', 2500);
      return;
    }
    const newExceptions = [];
    const cur = new Date(vanDate);
    while (cur <= totDate) {
      // Alleen werkdagen opnemen
      if (toestand.get('settings').werkdagen.includes(cur.getDay())) {
        newExceptions.push({
          id:     crypto.randomUUID(),
          scope,
          person: scope === 'person' ? myPerson : null,
          date:   cur.toISOString().split('T')[0],
          kind:   'fullday',
          from:   null,
          to:     null,
          reason,
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    if (!newExceptions.length) {
      toast('⚠ In deze periode zijn er geen werkdagen. Kies andere data.', 2500);
      return;
    }
    toestand.get('avExceptions').push(...newExceptions);
    toestand.raak('avExceptions'); // in-place push
    _avFormMultiDay = false;
    _avFormDateTot  = null;
    renderBlockModal();
    const ok = await saveAvailability();
    if (!ok) {
      // Rollback alle toegevoegde exceptions
      const ids = new Set(newExceptions.map(e => e.id));
      toestand.set('avExceptions', toestand.get('avExceptions').filter(e => !ids.has(e.id)));
      renderBlockModal();
    }
    return;
  }

  // Enkelvoudige dag (bestaand gedrag)
  const ex = {
    id:     crypto.randomUUID(),
    scope,
    person: scope === 'person' ? myPerson : null,
    date:   _avFormDate,
    kind:   _avFormKind,
    from,
    to,
    reason,
  };

  toestand.get('avExceptions').push(ex);
  toestand.raak('avExceptions'); // in-place push
  renderBlockModal();
  const ok = await saveAvailability();
  if (!ok) {
    // Rollback lokale toevoeging bij fout
    toestand.set('avExceptions', toestand.get('avExceptions').filter(e => e.id !== ex.id));
    renderBlockModal();
  }
}

async function avRemoveException(id) {
  const removed = toestand.get('avExceptions').find(e => e.id === id);
  toestand.set('avExceptions', toestand.get('avExceptions').filter(e => e.id !== id));
  renderBlockModal();
  const ok = await saveAvailability();
  if (!ok && removed) {
    toestand.get('avExceptions').push(removed);
    toestand.raak('avExceptions'); // in-place push
    renderBlockModal();
  }
}

// Fix 6 (finale review): localISO() i.p.v. toISOString().split('T')[0] -- toISOString() geeft
// UTC terug, en tussen lokale middernacht en 01:00/02:00 (België is UTC+1/+2) resolveerde dat naar
// GISTEREN, wat zowel het default-datumveld hieronder als de "upcoming"-filter in
// renderBeschikbaarhedenTab() liet knallen.
let _bavFormDate  = null; // gezet in initBeschikbaarheid (vroeger in DOMContentLoaded)
let _bavFormDateTot = null;
let _bavFormMultiDay = false;
let _bavFormKind  = 'fullday';
let _bavFormScope = 'global';
// Post-launch feedback (2026-08-17): een platte lijst die iedereens uitzonderingen door elkaar
// toont was onoverzichtelijk. _bavFilterPerson is een EIGEN, tab-lokale "welke persoon bekijk ik"
// -- losstaand van de globale activeAssigneeFilter (dat bepaalt wiens PERSOONLIJKE app-weergave
// actief is; dit bepaalt enkel wat deze tab toont/voor wie je toevoegt). Filteren op een persoon
// bepaalt ook meteen voor wie een nieuwe uitzondering wordt aangemaakt (zie scopeOptions/
// avAddExceptionFromSettings hieronder) -- kiezen "Kursat Deniz" en dan toevoegen hoeft dus niet
// meer via de globale technieker-wissel.
let _bavFilterPerson = 'all';

function bavSetFilterPerson(person) {
  _bavFilterPerson = person;
  _bavFormScope = person === 'all' ? 'global' : 'person';
  renderBeschikbaarhedenTab();
}

async function avRemoveExceptionGroup(ids) {
  // Analoog aan de bestaande batch-toevoeg-/rollback-logica van meerdaags verlof (zie
  // avAddExceptionFromSettings) -- één PUT voor de hele periode i.p.v. N losse aanroepen.
  const idSet = new Set(ids);
  const removed = toestand.get('avExceptions').filter(e => idSet.has(e.id));
  toestand.set('avExceptions', toestand.get('avExceptions').filter(e => !idSet.has(e.id)));
  renderBeschikbaarhedenTab();
  const ok = await saveAvailability();
  if (!ok) {
    toestand.get('avExceptions').push(...removed);
    toestand.raak('avExceptions'); // in-place push
    renderBeschikbaarhedenTab();
  }
}

export function renderBeschikbaarhedenTab() {
  const body = document.getElementById('set-tab-beschikbaarheden');
  if (!body) return;

  // Bekende personen: iedereen die al eens een ticket toegewezen kreeg, aangevuld met elke
  // persoon die al in avExceptions voorkomt (dekt ook namen die (nog) geen ticket hebben).
  const knownAgents = [...new Set([
    ...toestand.get('allTickets').map(t => t.assignee),
    ...toestand.get('allGepland').map(t => t.assignee),
    ...toestand.get('allPending').map(t => t.assignee),
    ...toestand.get('avExceptions').map(e => e.person),
  ])].filter(Boolean).sort();

  const today = localISO(new Date()); // Fix 6 (finale review): lokale datum, niet UTC (zie boven)
  const upcoming = toestand.get('avExceptions')
    .filter(e => e.date >= today)
    .filter(e => _bavFilterPerson === 'all' || e.scope === 'global' || e.person === _bavFilterPerson)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.person || '').localeCompare(b.person || ''));

  const groups = groupExceptionsForDisplay(upcoming, toestand.get('settings').werkdagen);
  const fmtShort = d => new Date(d + 'T12:00:00').toLocaleDateString('nl-BE', { day:'numeric', month:'short', year:'numeric' });

  const existingHtml = groups.length === 0
    ? `<div class="av-empty">Geen geplande beschikbaarheids-uitzonderingen${_bavFilterPerson === 'all' ? '' : ` voor ${escHtml(_bavFilterPerson)}`}.</div>`
    : groups.map(g => {
        const whoLabel = g.scope === 'global' ? 'Iedereen' : (g.person || '?');
        const kindLabel = g.kind === 'fullday' ? '🔒 Hele dag' : `⏱ ${g.items[0].from}–${g.items[0].to}`;
        const dateLabel = g.items.length > 1 ? `${fmtShort(g.startDate)} – ${fmtShort(g.endDate)}` : fmtShort(g.startDate);
        const reasonPart = g.reason ? ` — ${escHtml(g.reason)}` : '';
        const idsAttr = escHtml(g.items.map(e => e.id).join(','));
        return `<div class="av-item">
          <span class="av-item-label">${escHtml(dateLabel)} · ${kindLabel}${reasonPart} <span class="av-item-who">(${escHtml(whoLabel)})</span></span>
          <button class="av-item-del" data-exception-ids="${idsAttr}" title="Verwijderen" aria-label="Blokkering verwijderen">✕</button>
        </div>`;
      }).join('');

  const myPerson = _bavFilterPerson === 'all' ? null : _bavFilterPerson;
  const defaultVan = toestand.get('settings').vanTijd || '08:00';
  const defaultTot = toestand.get('settings').totTijd || '17:00';
  const scopeOptions = myPerson
    ? `<button class="av-radio-btn ${_bavFormScope === 'person' ? 'active' : ''}" aria-pressed="${_bavFormScope === 'person'}" data-actie="bav-scope" data-arg="person">👤 ${escHtml(myPerson.split(' ')[0])}</button>
       <button class="av-radio-btn ${_bavFormScope === 'global' ? 'active' : ''}" aria-pressed="${_bavFormScope === 'global'}" data-actie="bav-scope" data-arg="global">👥 Iedereen</button>`
    : `<button class="av-radio-btn active" aria-pressed="true" disabled>👥 Iedereen</button>`;

  body.innerHTML = `
    <div>
      <div class="av-section-title" role="heading" aria-level="3">Filter op persoon</div>
      <select class="av-time-input" id="bav-filter-person" aria-label="Filter op persoon" data-wijzig="bav-filter-persoon" style="width:100%">
        <option value="all" ${_bavFilterPerson === 'all' ? 'selected' : ''}>Alle personen</option>
        ${knownAgents.map(a => `<option value="${escHtml(a)}" ${_bavFilterPerson === a ? 'selected' : ''}>${escHtml(a)}</option>`).join('')}
      </select>
    </div>
    <div class="av-form" style="margin-top:10px">
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Datum</div>
        <input type="date" class="av-time-input" id="bav-date" aria-label="Datum" value="${_bavFormDate}" data-wijzig="bav-datum" />
      </div>
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Type</div>
        <div class="av-radio-group">
          <button class="av-radio-btn ${_bavFormKind === 'fullday' ? 'active' : ''}" aria-pressed="${_bavFormKind === 'fullday'}" data-actie="bav-kind" data-arg="fullday">🔒 Hele dag</button>
          <button class="av-radio-btn ${_bavFormKind === 'range'   ? 'active' : ''}" aria-pressed="${_bavFormKind === 'range'}" data-actie="bav-kind" data-arg="range">⏱ Tijdvak</button>
        </div>
      </div>
      ${_bavFormKind === 'fullday' ? `
      <div>
        <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer">
          <input type="checkbox" id="bav-multiday" data-wijzig="bav-multiday" ${_bavFormMultiDay ? 'checked' : ''} />
          Meerdere werkdagen (verlof)
        </label>
        ${_bavFormMultiDay ? `
        <div class="av-time-row" style="gap:8px;margin-top:8px">
          <span style="font-size:0.8rem;color:var(--muted)">Tot</span>
          <input type="date" class="av-time-input" id="bav-date-tot" aria-label="Tot datum" value="${_bavFormDateTot || ''}" data-wijzig="bav-datum-tot" />
        </div>` : ''}
      </div>` : `
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Tijdvak</div>
        <div class="av-time-row">
          <span style="font-size:0.8rem;color:var(--muted)">Van</span>
          <input class="av-time-input" id="bav-van" aria-label="Van (tijd)" type="time" value="${defaultVan}" />
          <span style="font-size:0.8rem;color:var(--muted)">Tot</span>
          <input class="av-time-input" id="bav-tot" aria-label="Tot (tijd)" type="time" value="${defaultTot}" />
        </div>
      </div>`}
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Voor</div>
        <div class="av-radio-group">${scopeOptions}</div>
      </div>
      <div>
        <div class="av-section-title" role="heading" aria-level="3">Reden <span style="font-weight:400;text-transform:none;letter-spacing:0">(optioneel)</span></div>
        <input class="av-reden-input" id="bav-reden" aria-label="Reden" type="text" placeholder="bv. Verlof, dokter, opleiding…" />
      </div>
      <button class="av-add-btn" data-actie="bav-toevoegen">➕ Toevoegen</button>
    </div>
    <div class="av-section-title" role="heading" aria-level="3" style="margin-top:14px">Geplande uitzonderingen</div>
    <div class="av-existing">${existingHtml}</div>`;

  body.querySelectorAll('.av-item-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ids = (btn.dataset.exceptionIds || '').split(',').filter(Boolean);
      if (ids.length) await avRemoveExceptionGroup(ids);
    });
  });
}

function bavSetKind(kind) {
  _bavFormKind = kind;
  if (kind !== 'fullday') _bavFormMultiDay = false;
  renderBeschikbaarhedenTab();
}

function bavSetScope(scope) {
  _bavFormScope = scope;
  renderBeschikbaarhedenTab();
}

function bavSetMultiDay(checked) {
  _bavFormMultiDay = checked;
  if (!checked) _bavFormDateTot = null;
  renderBeschikbaarhedenTab();
}

async function avAddExceptionFromSettings() {
  const myPerson = _bavFilterPerson === 'all' ? null : _bavFilterPerson;
  const scope    = (myPerson && _bavFormScope === 'person') ? 'person' : 'global';
  const from     = _bavFormKind === 'range' ? (document.getElementById('bav-van')?.value || toestand.get('settings').vanTijd) : null;
  const to       = _bavFormKind === 'range' ? (document.getElementById('bav-tot')?.value || toestand.get('settings').totTijd) : null;
  const reason   = document.getElementById('bav-reden')?.value?.trim() || '';

  if (_bavFormKind === 'range' && from >= to) {
    toast('⚠ Eindtijd moet na begintijd liggen', 2500);
    return;
  }

  if (_bavFormKind === 'fullday' && _bavFormMultiDay && _bavFormDateTot) {
    const vanDate = new Date(_bavFormDate    + 'T12:00:00');
    const totDate = new Date(_bavFormDateTot + 'T12:00:00');
    if (totDate < vanDate) {
      toast('⚠ Einddatum moet na startdatum liggen', 2500);
      return;
    }
    const newExceptions = [];
    const cur = new Date(vanDate);
    while (cur <= totDate) {
      if (toestand.get('settings').werkdagen.includes(cur.getDay())) {
        newExceptions.push({
          id: crypto.randomUUID(), scope, person: scope === 'person' ? myPerson : null,
          date: cur.toISOString().split('T')[0], kind: 'fullday', from: null, to: null, reason,
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    if (!newExceptions.length) {
      toast('⚠ In deze periode zijn er geen werkdagen. Kies andere data.', 2500);
      return;
    }
    toestand.get('avExceptions').push(...newExceptions);
    toestand.raak('avExceptions'); // in-place push
    _bavFormMultiDay = false;
    _bavFormDateTot  = null;
    renderBeschikbaarhedenTab();
    const ok = await saveAvailability();
    if (!ok) {
      const ids = new Set(newExceptions.map(e => e.id));
      toestand.set('avExceptions', toestand.get('avExceptions').filter(e => !ids.has(e.id)));
      renderBeschikbaarhedenTab();
    }
    return;
  }

  const ex = {
    id: crypto.randomUUID(), scope, person: scope === 'person' ? myPerson : null,
    date: _bavFormDate, kind: _bavFormKind, from, to, reason,
  };
  toestand.get('avExceptions').push(ex);
  toestand.raak('avExceptions'); // in-place push
  renderBeschikbaarhedenTab();
  const ok = await saveAvailability();
  if (!ok) {
    toestand.set('avExceptions', toestand.get('avExceptions').filter(e => e.id !== ex.id));
    renderBeschikbaarhedenTab();
  }
}
