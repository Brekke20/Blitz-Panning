// public/js/inventaris.js
// Wagenvoorraad per technieker (Fase 2) + supervisor-neemlog. Weergave hangt af van de
// bestaande persoon-kiezer (activeAssigneeFilter in index.html), die als parameter
// doorgegeven wordt door renderInventaris()/updateInventarisBadge() -- deze module leest
// activeAssigneeFilter niet rechtstreeks (het is een `let` in een classic script, dus geen
// impliciete window-global, in tegenstelling tot function-declarations zoals toast/escHtml).
// Zie docs/superpowers/plans/2026-08-21-inventaris-edit-en-supervisorlog.md.

export let _invData = { versie: 0, wagenvoorraad: {}, log: [] };

let _invEditActive   = false;  // is de technieker-weergave momenteel in Edit-modus?
let _invEditPersoon  = null;   // voor welke technieker die Edit-modus loopt
let _invEditSnapshot = null;   // Map<materiaalId, {aantal, gedempt}> -- stand bij het openen van Edit
let _invEditVersie   = null;   // versie op het moment dat Edit geopend werd (voor Opslaan)
let _invSeenLogIds   = null;   // Set<id> -- null = nog niet ge-baseline'd deze weergave-sessie
let _invExportVan    = '';
let _invExportTot    = '';

const INV_API       = '/api/inventaris';
const INV_CACHE_KEY = 'blitz_inventaris_cache';

const TYPE_LABEL = { aanvulling: 'Aanvulling', correctie: 'Correctie', verbruik: 'Verbruik' };

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
// Aangeroepen van BUITEN deze module (index.html: setTab/selectPerson/poll). Overschrijft de
// DOM bewust NIET zolang er actief bewerkt wordt voor deze persoon -- anders zou een
// achtergrond-verversing (poll, of registreerVerbruik dat toevallig voor dezelfde technieker
// afrondt) ingetikte, nog niet opgeslagen waarden stilzwijgend wegvegen. Interne
// state-overgangen (invStartEdit/invCancelEdit/invSaveEdit) roepen doRenderInventaris()
// rechtstreeks aan en omzeilen deze bewuste bescherming.
export function renderInventaris(persoon) {
  if (_invEditActive && _invEditPersoon === persoon) return;
  if (_invEditActive && _invEditPersoon !== persoon) {
    // Actieve edit-sessie voor een ANDERE technieker dan wie nu getoond wordt -- die sessie is
    // per definitie verweesd (de gebruiker is weggeschakeld zonder op te slaan/te annuleren).
    // Reset ze stil, zodat renderInventaris nooit op de verkeerde technieker blijft
    // "vastzitten" bij een latere terugkeer naar de oorspronkelijke persoon (zie eindreview
    // 2026-08-21, gevonden tijdens de her-review van de vorige fixronde).
    _invEditActive   = false;
    _invEditPersoon  = null;
    _invEditSnapshot = null;
    _invEditVersie   = null;
  }
  doRenderInventaris(persoon);
}

function doRenderInventaris(persoon) {
  const body = document.getElementById('inventaris-body');
  if (!body) return;

  if (persoon === 'all') {
    body.innerHTML = renderSupervisorLog();
    wireSupervisorLog(body);
  } else {
    body.innerHTML = renderEigenVoorraad(persoon);
    wireEigenVoorraad(body, persoon);
  }
}

// ── Technieker-weergave: volledige catalogus + Edit-modus ──
function renderEigenVoorraad(persoon) {
  const stock = _invData.wagenvoorraad[persoon] || {};
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const materialen = [...src.onderdelen].sort((a, b) => a.naam.localeCompare(b.naam));
  const editing = _invEditActive && _invEditPersoon === persoon;

  const rijen = materialen.map(o => {
    const entry  = stock[o.id] || { aantal: 0, gedempt: false };
    const aantal = entry.aantal || 0;
    const gedempt = !!entry.gedempt;
    const laag = aantal <= 0 && !gedempt;

    if (!editing) {
      return `<div class="inv-row${laag ? ' inv-low' : ''}">
        <span class="inv-row-naam">${escHtml(o.naam)}</span>
        <span class="inv-row-aantal">${aantal}</span>
      </div>`;
    }
    return `<div class="inv-row inv-cat-row" data-mat-id="${escHtml(o.id)}" data-mat-naam="${escHtml(o.naam)}">
      <span class="inv-row-naam">${escHtml(o.naam)}</span>
      <div class="inv-qty-edit">
        <button class="inv-qty-btn inv-qty-minus" type="button" title="Verminder">−</button>
        <input class="inv-qty-input" type="number" min="0" step="1" value="${aantal}" />
        <button class="inv-qty-btn inv-qty-plus" type="button" title="Vermeerder">+</button>
        <button class="inv-bell-btn${gedempt ? ' inv-bell-muted' : ''}" type="button" title="Lage-voorraadmelding voor dit item ${gedempt ? 'inschakelen' : 'uitschakelen'}">${gedempt ? '🔕' : '🔔'}</button>
      </div>
    </div>`;
  }).join('');

  const toolbar = editing
    ? `<div class="inv-toolbar">
         <button class="btn-cancel" id="inv-cancel-btn">Annuleren</button>
         <button class="btn-save" id="inv-save-btn">✓ Opslaan</button>
       </div>`
    : `<div class="inv-toolbar"><button class="btn-primary" id="inv-edit-btn">✏️ Edit</button></div>`;

  return toolbar + `<div class="inv-list">${rijen}</div>`;
}

function wireEigenVoorraad(body, persoon) {
  body.querySelector('#inv-edit-btn')?.addEventListener('click', () => invStartEdit(persoon));
  body.querySelector('#inv-cancel-btn')?.addEventListener('click', () => invCancelEdit());
  body.querySelector('#inv-save-btn')?.addEventListener('click', () => invSaveEdit());
  body.querySelectorAll('.inv-cat-row').forEach(row => {
    const input = row.querySelector('.inv-qty-input');
    row.querySelector('.inv-qty-minus')?.addEventListener('click', () => {
      input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
    });
    row.querySelector('.inv-qty-plus')?.addEventListener('click', () => {
      input.value = (parseInt(input.value, 10) || 0) + 1;
    });
    row.querySelector('.inv-bell-btn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const nowMuted = !btn.classList.contains('inv-bell-muted');
      btn.classList.toggle('inv-bell-muted', nowMuted);
      btn.textContent = nowMuted ? '🔕' : '🔔';
    });
  });
}

function invStartEdit(persoon) {
  const stock = _invData.wagenvoorraad[persoon] || {};
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  _invEditSnapshot = new Map();
  src.onderdelen.forEach(o => {
    const entry = stock[o.id] || { aantal: 0, gedempt: false };
    _invEditSnapshot.set(o.id, { aantal: entry.aantal || 0, gedempt: !!entry.gedempt });
  });
  _invEditActive  = true;
  _invEditPersoon = persoon;
  _invEditVersie  = _invData.versie;
  doRenderInventaris(persoon);
}

function invCancelEdit() {
  const persoon = _invEditPersoon;
  _invEditActive   = false;
  _invEditPersoon  = null;
  _invEditSnapshot = null;
  _invEditVersie   = null;
  doRenderInventaris(persoon);
}

async function invSaveEdit() {
  const persoon = _invEditPersoon;
  const versieBijStart = _invEditVersie;
  const body = document.getElementById('inventaris-body');
  const items = [];

  body.querySelectorAll('.inv-cat-row').forEach(row => {
    const id    = row.dataset.matId;
    const naam  = row.dataset.matNaam;
    const input = row.querySelector('.inv-qty-input');
    const bel   = row.querySelector('.inv-bell-btn');

    const nieuweAantal  = Math.max(0, parseInt(input.value, 10) || 0);
    const nieuweGedempt = bel.classList.contains('inv-bell-muted');
    const oud = _invEditSnapshot.get(id) || { aantal: 0, gedempt: false };

    const item = { materiaalId: id, materiaalNaam: naam };
    let gewijzigd = false;
    if (nieuweAantal !== oud.aantal)   { item.aantal  = nieuweAantal - oud.aantal; gewijzigd = true; }
    if (nieuweGedempt !== oud.gedempt) { item.gedempt = nieuweGedempt;             gewijzigd = true; }
    if (gewijzigd) items.push(item);
  });

  if (!items.length) { invCancelEdit(); return; }

  try {
    const res = await fetch(INV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: versieBijStart, technieker: persoon, actie: 'mutatie', items }),
    });
    if (res.status === 409) {
      const errBody = await res.json();
      _invData = errBody.data || _invData;
      toast('⚠ Inventaris ondertussen gewijzigd — je bewerking is niet opgeslagen, herlaad en probeer opnieuw', 4000);
      _invEditActive = false; _invEditPersoon = null; _invEditSnapshot = null; _invEditVersie = null;
      doRenderInventaris(persoon);
      updateInventarisBadge(persoon);
      return;
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || ('HTTP ' + res.status));
    }
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
    _invEditActive = false; _invEditPersoon = null; _invEditSnapshot = null; _invEditVersie = null;
    doRenderInventaris(persoon);
    updateInventarisBadge(persoon);
    toast('✓ Wagenvoorraad opgeslagen', 2500);
  } catch (err) {
    toast('❌ Opslaan mislukt: ' + err.message, 4000);
  }
}

// ── Supervisor-weergave: dag-gegroepeerde log + live nieuw-detectie ──
function renderSupervisorLog() {
  const entries = [...(_invData.log || [])].sort((a, b) => new Date(b.datum) - new Date(a.datum));
  const currentIds = new Set(entries.map(e => e.id));

  let nieuweIds;
  if (_invSeenLogIds === null) {
    nieuweIds = new Set();      // eerste weergave deze sessie: nog niets als 'nieuw' markeren
    _invSeenLogIds = currentIds;
  } else {
    nieuweIds = new Set([...currentIds].filter(id => !_invSeenLogIds.has(id)));
  }

  const toolbar = `<div class="inv-toolbar inv-export-toolbar">
    <input type="date" id="inv-export-van" title="Export van" value="${escHtml(_invExportVan)}" />
    <span style="color:var(--muted);font-size:0.75rem">–</span>
    <input type="date" id="inv-export-tot" title="Export tot" value="${escHtml(_invExportTot)}" />
    <button class="btn-sec" id="inv-export-btn">📊 Excel export</button>
  </div>`;

  if (!entries.length) return toolbar + '<div class="inv-empty">Nog geen bewegingen.</div>';

  let html = '';
  let huidigeDag = null;
  entries.forEach(e => {
    const dag = e.datum.slice(0, 10);
    if (dag !== huidigeDag) {
      huidigeDag = dag;
      const label = new Date(dag + 'T12:00:00').toLocaleDateString('nl-BE', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
      html += `<div class="inv-day-sep">${label}</div>`;
    }
    const tijd = new Date(e.datum).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
    html += `<div class="inv-log-row${nieuweIds.has(e.id) ? ' inv-day-new' : ''}">
      <span class="inv-log-type inv-log-${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
      <span class="inv-log-technieker">${escHtml(e.technieker)}</span>
      <span class="inv-log-materiaal">${escHtml(e.materiaalNaam)}</span>
      <span class="inv-log-aantal">${e.aantal > 0 ? '+' : ''}${e.aantal}</span>
      <span class="inv-log-tijd">${tijd}</span>
      ${e.type === 'aanvulling'
        ? (e.status === 'nieuw'
            ? `<button class="btn-sec inv-log-verwerkt-btn" data-log-id="${e.id}">Verwerkt</button>`
            : '<span class="inv-log-status-done">✓ verwerkt</span>')
        : ''}
    </div>`;
  });

  return toolbar + `<div class="inv-list">${html}</div>`;
}

function wireSupervisorLog(body) {
  body.querySelectorAll('.inv-log-verwerkt-btn').forEach(btn => {
    btn.addEventListener('click', () => markVerwerkt(btn.dataset.logId));
  });
  body.querySelector('#inv-export-btn')?.addEventListener('click', () => exportInventarisLog());
  body.querySelector('#inv-export-van')?.addEventListener('change', e => { _invExportVan = e.target.value; });
  body.querySelector('#inv-export-tot')?.addEventListener('change', e => { _invExportTot = e.target.value; });
}

// Aangeroepen vanuit public/index.html's setTab() zodra een ANDER tabblad dan Inventaris
// geopend wordt -- maakt de volgende weergave van de supervisor-log weer een schone baseline
// (geen pulserende gloed meer), exact zoals afgesproken: "gloed gaat weg als men van tabblad
// wisselt".
export function resetInvSeenLog() {
  _invSeenLogIds = null;
}

export function updateInventarisBadge(persoon) {
  const el = document.getElementById('cnt-inventaris');
  if (!el) return;
  let count;
  if (persoon === 'all') {
    count = (_invData.log || []).filter(e => e.type === 'aanvulling' && e.status === 'nieuw').length;
  } else {
    const stock = _invData.wagenvoorraad[persoon] || {};
    const src = PRIJZEN || PRIJZEN_DEFAULTS;
    count = src.onderdelen.filter(o => {
      const entry = stock[o.id] || { aantal: 0, gedempt: false };
      return entry.aantal <= 0 && !entry.gedempt;
    }).length;
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

// ── Excel-export van de volledige log (aanvulling + correctie + verbruik) ──
export async function exportInventarisLog() {
  const vanVal = document.getElementById('inv-export-van')?.value;
  const totVal = document.getElementById('inv-export-tot')?.value;

  let rows = _invData.log || [];
  if (vanVal) rows = rows.filter(e => e.datum.slice(0, 10) >= vanVal);
  if (totVal) rows = rows.filter(e => e.datum.slice(0, 10) <= totVal);
  rows = [...rows].sort((a, b) => new Date(a.datum) - new Date(b.datum));

  if (!rows.length) return toast('Geen bewegingen in dit datumbereik', 2500);

  toast('📊 Excel wordt opgemaakt…', 3000);

  const vanLabel = vanVal || 'begin';
  const totLabel = totVal || 'huidig';

  const headers = ['Datum', 'Tijd', 'Technieker', 'Type', 'Materiaal', 'Aantal', 'Status'];
  const ncols = headers.length;

  const data = rows.map(e => {
    const d = new Date(e.datum);
    return [
      d.toLocaleDateString('nl-BE'),
      d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }),
      e.technieker,
      TYPE_LABEL[e.type] || e.type,
      e.materiaalNaam,
      e.aantal,
      e.type === 'aanvulling' ? (e.status === 'verwerkt' ? 'Verwerkt' : 'Nieuw') : '',
    ];
  });

  const colWidths = headers.map((h, i) => {
    const hLen   = h.length + 2;
    const maxVal = data.reduce((m, row) => Math.max(m, String(row[i] ?? '').length + 1), 0);
    return Math.min(Math.max(hLen, maxVal, 8), 36);
  });

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Blitz Planning';
    const ws = wb.addWorksheet('Inventaris');
    ws.columns = colWidths.map(w => ({ width: w }));
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, activeCell: 'A4' }];

    const r1 = ws.addRow(Array(ncols).fill(''));
    r1.height = 26;
    ws.mergeCells(1, 1, 1, ncols);
    Object.assign(r1.getCell(1), {
      value:     'INVENTARIS — BLITZ POWER',
      font:      { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101820' } },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });

    const r2 = ws.addRow(Array(ncols).fill(''));
    r2.height = 16;
    ws.mergeCells(2, 1, 2, ncols);
    Object.assign(r2.getCell(1), {
      value:     `Periode: ${vanLabel} → ${totLabel}  |  Export: ${new Date().toLocaleDateString('nl-BE')}  |  ${rows.length} record${rows.length !== 1 ? 's' : ''}`,
      font:      { size: 9, color: { argb: 'FFAAAAAA' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101820' } },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });

    const r3 = ws.addRow(headers);
    r3.height = 22;
    for (let c = 1; c <= ncols; c++) {
      const cell     = r3.getCell(c);
      cell.font      = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border    = { bottom: { style: 'medium', color: { argb: 'FF00DFA3' } } };
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: ncols } };

    data.forEach((rowData, ri) => {
      const row = ws.addRow(rowData);
      row.height = 15;
      const rowBg = ri % 2 === 0 ? 'FFFFFFFF' : 'FFEEF2F7';
      for (let c = 1; c <= ncols; c++) {
        const cell     = row.getCell(c);
        cell.font      = { size: 9 };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.alignment = { vertical: 'middle' };
        cell.border    = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
      }
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href       = url;
    a.download   = `Inventaris_${vanLabel}_${totLabel}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast(`✓ ${rows.length} rijen geëxporteerd`, 2500);
  } catch (err) {
    toast(`❌ Export mislukt: ${err.message}`, 4000);
    console.error('exportInventarisLog:', err);
  }
}

// ── Automatische aftrek bij rapport-afronding ──
// Aangeroepen (niet afgewacht, best-effort) vanuit public/js/rapport-wizard.js's printRapport().
// 'vrije regel'-onderdelen (id begint met 'vrij-') zijn handmatig ingevoerde tekst zonder
// koppeling aan de prijzencatalogus -- die hebben geen materiaalId om tegen af te boeken, en
// worden dus bewust overgeslagen (geen fout, gewoon genegeerd).
export async function registreerVerbruik(technieker, onderdelen) {
  if (!technieker) return;
  const items = (onderdelen || [])
    .filter(p => p.naam && !String(p.id || '').startsWith('vrij-') && (parseInt(p.aantal) || 0) > 0)
    .map(p => ({ materiaalId: p.id, materiaalNaam: p.naam, aantal: parseInt(p.aantal) || 1 }));
  if (!items.length) return;

  try {
    const res = await fetch(INV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: _invData.versie, technieker, actie: 'verbruik', items }),
    });
    if (!res.ok) { console.warn('Inventaris-aftrek (verbruik) niet gelukt, HTTP', res.status); return; }
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
  } catch (err) {
    console.warn('Inventaris-aftrek (verbruik) niet gelukt:', err);
  }
}

// ── Window-bridge ──
// Zelfde patroon als prijzen.js/rapport-wizard.js: functies die vanuit index.html (setTab/
// selectPerson/DOMContentLoaded/rapport-wizard.js) aangeroepen worden, moeten expliciet op
// window staan (modules maken geen impliciete globals). Functies die enkel via addEventListener
// vanuit dit bestand zelf aangeroepen worden (invStartEdit, invSaveEdit, invCancelEdit,
// markVerwerkt, exportInventarisLog, ...) hebben GEEN bridge nodig.
// Live getter (net als PRIJZEN in prijzen.js): _invData wordt bij elke lading/mutatie volledig
// vervangen, dus een statische window-toewijzing zou een verouderd versienummer vastzetten.
// Gebruikt door index.html's poll om een overbodige re-render over te slaan als er niets
// gewijzigd is (zie eindreview 2026-08-21).
Object.defineProperty(window, '_invVersie', {
  get: () => _invData.versie,
  configurable: true,
});
window.loadInventaris        = loadInventaris;
window.renderInventaris      = renderInventaris;
window.updateInventarisBadge = updateInventarisBadge;
window.registreerVerbruik    = registreerVerbruik;
window.resetInvSeenLog       = resetInvSeenLog;
