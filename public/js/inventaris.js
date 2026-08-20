// public/js/inventaris.js
// Wagenvoorraad per technieker (Fase 2) + supervisor-neemlog. Weergave hangt af van de
// bestaande persoon-kiezer (activeAssigneeFilter in index.html), die als parameter
// doorgegeven wordt door renderInventaris()/updateInventarisBadge() — deze module leest
// activeAssigneeFilter niet rechtstreeks (het is een `let` in een classic script, dus geen
// impliciete window-global, in tegenstelling tot function-declarations zoals toast/escHtml).
// Zie docs/superpowers/specs/2026-08-20-inventarissysteem-design.md.

export let _invData = { versie: 0, wagenvoorraad: {}, log: [] };
let _invPersoon  = null; // technieker voor wie de "+ Materiaal"-modal momenteel open staat
let _invSelected = null; // { id, naam } van het gekozen materiaal in die modal, of null tijdens het zoeken

const INV_API       = '/api/inventaris';
const INV_CACHE_KEY = 'blitz_inventaris_cache';

const TYPE_LABEL = { aanvulling: 'Aanvulling', correctie: 'Correctie', verbruik: 'Verbruik' };

function materiaalNaamVoorId(id) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  return src.onderdelen.find(o => o.id === id)?.naam || id;
}

// ── Laden ──
export async function loadInventaris() {
  const cached = loadFromCache(INV_CACHE_KEY);
  if (cached) _invData = cached;
  try {
    const res = await fetch(INV_API);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _invData = data;
    saveToCache(INV_CACHE_KEY, data);
  } catch (err) {
    console.warn('Inventaris laden mislukt, laatst gekende stand blijft staan:', err);
  }
}

// ── Weergave ──
export function renderInventaris(persoon) {
  const body = document.getElementById('inventaris-body');
  if (!body) return;

  if (persoon === 'all') {
    body.innerHTML = renderSupervisorLog();
    body.querySelectorAll('.inv-log-verwerkt-btn').forEach(btn => {
      btn.addEventListener('click', () => markVerwerkt(btn.dataset.logId));
    });
  } else {
    body.innerHTML = renderEigenVoorraad(persoon);
    body.querySelector('#inv-add-btn')?.addEventListener('click', () => openInventarisAddModal(persoon));
  }
}

function renderEigenVoorraad(persoon) {
  const stock = _invData.wagenvoorraad[persoon] || {};
  const ids = Object.keys(stock).sort((a, b) => materiaalNaamVoorId(a).localeCompare(materiaalNaamVoorId(b)));

  const rijen = ids.length
    ? ids.map(id => {
        const aantal = stock[id];
        return `<div class="inv-row${aantal <= 0 ? ' inv-low' : ''}">
          <span class="inv-row-naam">${escHtml(materiaalNaamVoorId(id))}</span>
          <span class="inv-row-aantal">${aantal}</span>
        </div>`;
      }).join('')
    : '<div class="inv-empty">Nog geen materiaal geregistreerd voor deze technieker.</div>';

  return `<div class="inv-toolbar"><button class="btn-primary" id="inv-add-btn">+ Materiaal</button></div>
    <div class="inv-list">${rijen}</div>`;
}

function renderSupervisorLog() {
  const entries = [...(_invData.log || [])].sort((a, b) => new Date(b.datum) - new Date(a.datum));

  const rijen = entries.length
    ? entries.map(e => `<div class="inv-log-row">
        <span class="inv-log-type inv-log-${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
        <span class="inv-log-technieker">${escHtml(e.technieker)}</span>
        <span class="inv-log-materiaal">${escHtml(e.materiaalNaam)}</span>
        <span class="inv-log-aantal">${e.aantal > 0 ? '+' : ''}${e.aantal}</span>
        <span class="inv-log-datum">${fmtDateShort(new Date(e.datum))}</span>
        ${e.type === 'aanvulling'
          ? (e.status === 'nieuw'
              ? `<button class="btn-sec inv-log-verwerkt-btn" data-log-id="${e.id}">Verwerkt</button>`
              : '<span class="inv-log-status-done">✓ verwerkt</span>')
          : ''}
      </div>`).join('')
    : '<div class="inv-empty">Nog geen bewegingen.</div>';

  return `<div class="inv-list">${rijen}</div>`;
}

export function updateInventarisBadge(persoon) {
  const el = document.getElementById('cnt-inventaris');
  if (!el) return;
  let count;
  if (persoon === 'all') {
    count = (_invData.log || []).filter(e => e.type === 'aanvulling' && e.status === 'nieuw').length;
  } else {
    const stock = _invData.wagenvoorraad[persoon] || {};
    count = Object.values(stock).filter(a => a <= 0).length;
  }
  el.textContent = String(count);
  el.style.display = count > 0 ? '' : 'none';
}

// ── Verwerkt-actie (supervisor) ──
async function markVerwerkt(logId) {
  try {
    const res = await fetch(INV_API, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: _invData.versie, id: logId }),
    });
    if (res.status === 409) {
      const body = await res.json();
      _invData = body.data || _invData;
      toast('⚠ Conflict — inventaris herladen, probeer opnieuw', 3000);
      renderInventaris('all');
      updateInventarisBadge('all');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
    renderInventaris('all');
    updateInventarisBadge('all');
    toast('✓ Gemarkeerd als verwerkt', 2500);
  } catch (err) {
    toast('❌ Verwerkt-markering mislukt: ' + err.message, 4000);
  }
}

// ── "+ Materiaal"-modal ──
export function openInventarisAddModal(persoon) {
  _invPersoon  = persoon;
  _invSelected = null;
  document.getElementById('inv-add-overlay').classList.add('open');
  _invRenderAddModal();
}

export function closeInventarisAddModal(e) {
  if (e && e.target !== document.getElementById('inv-add-overlay')) return;
  document.getElementById('inv-add-overlay').classList.remove('open');
}

export function invZoekOpnieuw() {
  _invSelected = null;
  _invRenderAddModal();
}

export function invZoekInput() {
  _invUpdateZoekResults();
}

export function invSubmitAdd() {
  const aantal = parseInt(document.getElementById('inv-aantal')?.value, 10);
  if (!aantal) { toast('⚠️ Vul een aantal in (niet 0)', 3000); return; }
  submitInventarisMutatie(_invSelected.id, _invSelected.naam, aantal);
}

function _invRenderAddModal() {
  const body = document.getElementById('inv-add-body');
  if (!_invSelected) {
    body.innerHTML = `
      <div class="wiz-cat-search-wrap">
        <span class="wiz-cat-search-icon">🔍</span>
        <input class="wiz-cat-search" id="inv-zoek-q" type="search"
          placeholder="Zoek op naam of tag…" oninput="invZoekInput()" autocomplete="off" />
      </div>
      <div class="wiz-cat-results" id="inv-zoek-results"></div>`;
    _invUpdateZoekResults();
  } else {
    body.innerHTML = `
      <div class="inv-gekozen-naam" style="font-weight:600;margin-bottom:10px">${escHtml(_invSelected.naam)}</div>
      <label class="wiz-field-label" for="inv-aantal">Aantal (negatief = correctie: kapot, verloren, telfout)</label>
      <input class="man-input" id="inv-aantal" type="number" step="1" value="1" />
      <div class="mftr" style="padding:12px 0 0">
        <button class="btn-cancel" onclick="invZoekOpnieuw()">‹ Ander materiaal</button>
        <button class="btn-save" onclick="invSubmitAdd()">Toevoegen</button>
      </div>`;
    document.getElementById('inv-aantal')?.focus();
  }
}

function _invUpdateZoekResults() {
  const q = document.getElementById('inv-zoek-q')?.value || '';
  const resultEl = document.getElementById('inv-zoek-results');
  if (!resultEl) return;
  const resultaten = zoekOnderdelen(q, []);
  if (!resultaten.length) {
    resultEl.innerHTML = '<div class="wiz-cat-empty">Geen onderdelen gevonden</div>';
    return;
  }
  resultEl.innerHTML = resultaten.slice(0, 20).map(o =>
    `<div class="wiz-cat-item" data-ond-id="${escHtml(o.id)}">
      <span class="wiz-cat-item-naam">${escHtml(o.naam)}</span>
    </div>`
  ).join('');
  resultEl.querySelectorAll('.wiz-cat-item').forEach(item => {
    item.addEventListener('click', () => invKiesMateriaal(item.dataset.ondId || ''));
  });
}

function invKiesMateriaal(id) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const o = src.onderdelen.find(x => x.id === id);
  if (!o) return;
  _invSelected = { id: o.id, naam: o.naam };
  _invRenderAddModal();
}

async function submitInventarisMutatie(materiaalId, materiaalNaam, aantal) {
  const technieker = _invPersoon;
  try {
    const res = await fetch(INV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versie: _invData.versie,
        technieker,
        actie: 'mutatie',
        items: [{ materiaalId, materiaalNaam, aantal }],
      }),
    });
    if (res.status === 409) {
      const body = await res.json();
      _invData = body.data || _invData;
      toast('⚠ Conflict — inventaris herladen, probeer opnieuw', 3000);
      closeInventarisAddModal();
      renderInventaris(technieker);
      updateInventarisBadge(technieker);
      return;
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || ('HTTP ' + res.status));
    }
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
    closeInventarisAddModal();
    renderInventaris(technieker);
    updateInventarisBadge(technieker);
    toast(aantal > 0 ? '✓ Toegevoegd aan wagenvoorraad' : '✓ Correctie geregistreerd', 2500);
  } catch (err) {
    toast('❌ Opslaan mislukt: ' + err.message, 4000);
  }
}

// ── Window-bridge ──
// Zelfde patroon als prijzen.js/rapport-wizard.js: functies die vanuit index.html (onclick=,
// setTab/selectPerson/DOMContentLoaded) aangeroepen worden, moeten expliciet op window staan
// (modules maken geen impliciete globals).
window.loadInventaris        = loadInventaris;
window.renderInventaris      = renderInventaris;
window.updateInventarisBadge = updateInventarisBadge;
window.closeInventarisAddModal = closeInventarisAddModal;
window.invZoekInput            = invZoekInput;
window.invZoekOpnieuw          = invZoekOpnieuw;
window.invSubmitAdd            = invSubmitAdd;
