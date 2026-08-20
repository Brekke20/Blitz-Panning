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

// ── "+ Materiaal"-modal (Task 3 vult dit verder aan — openInventarisAddModal wordt hier al
// aangeroepen vanuit renderEigenVoorraad, dus de functie moet vanaf deze taak al bestaan.
// De modal-markup zelf (#inv-add-overlay) bestaat pas vanaf Task 3 — deze placeholder raakt
// dus bewust geen DOM-elementen aan die nog niet bestaan, enkel een zichtbare toast) ──
export function openInventarisAddModal(persoon) {
  _invPersoon  = persoon;
  _invSelected = null;
  toast('⚠️ "+ Materiaal" komt in de volgende taak — nog niet geïmplementeerd', 3000);
}

// ── Window-bridge ──
// Zelfde patroon als prijzen.js/rapport-wizard.js: functies die vanuit index.html (onclick=,
// setTab/selectPerson/DOMContentLoaded) aangeroepen worden, moeten expliciet op window staan
// (modules maken geen impliciete globals).
window.loadInventaris        = loadInventaris;
window.renderInventaris      = renderInventaris;
window.updateInventarisBadge = updateInventarisBadge;
