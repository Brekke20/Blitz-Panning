// public/js/inventaris.js
// Wagenvoorraad per technieker (Fase 2) + supervisor-neemlog. Weergave hangt af van de
// bestaande persoon-kiezer (activeAssigneeFilter in kern.toestand), die als parameter
// doorgegeven wordt door renderInventaris()/updateInventarisBadge() (app.js) -- deze module leest
// activeAssigneeFilter niet rechtstreeks.
// Zie docs/superpowers/plans/2026-08-21-inventaris-edit-en-supervisorlog.md.
import { foutTekst } from './kern/api.js';
import { TEST_MODE } from './kern/omgeving.js';
import { loadFromCache, saveToCache } from './kern/opslag.js';
import { heeftRol, huidigeGebruiker, eigenZohoNaam } from './kern/sessie.js';
import { escHtml, toast } from './kern/ui.js';
import { laadExcelJs } from './kern/exceljs.js';
import { PRIJZEN, PRIJZEN_DEFAULTS, ONDERDEEL_CATEGORIEEN } from './prijzen.js';
import { maakVerbruikWachtrij, WACHTRIJ_SLEUTEL } from './kern/verbruik-wachtrij.js';
import { voorraadRegel, voorraadStatus, lageItems, startTekst, MAX_DREMPEL } from './kern/voorraad-drempel.js';

export let _invData = { versie: 0, wagenvoorraad: {}, log: [] };

let _invEditActive   = false;  // is de technieker-weergave momenteel in Edit-modus?
let _invEditPersoon  = null;   // voor welke technieker die Edit-modus loopt
let _invEditSnapshot = null;   // Map<materiaalId, {aantal, drempel}> -- stand bij het openen van Edit
let _invEditVersie   = null;   // versie op het moment dat Edit geopend werd (voor Opslaan)
let _invSeenLogIds   = null;   // Set<id> -- null = nog niet ge-baseline'd deze weergave-sessie
let _invExportVan    = '';
let _invExportTot    = '';
let _invZoekPersoon  = null;   // voor wie de zoektekst gold; wisselen van technieker leegt ze
let _invZoek         = '';     // zoektekst in de onderdelenlijst; blijft over herrenders heen
let _invHistoriek    = false;  // toont de technieker-weergave de historiek (log van deze persoon) i.p.v. de voorraad?
let _invStartGemeld  = false;  // opstartmelding "Check je voorraad" al getoond deze pagina-lading?

const INV_API       = '/api/inventaris';
// Testmodus heeft een aparte cache, zodat een testmomentopname nooit in echte modus verschijnt
const INV_CACHE_KEY = TEST_MODE ? 'blitz_inventaris_cache_test' : 'blitz_inventaris_cache';

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
    verwerkVerbruikWachtrij();
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
  if (_invZoekPersoon !== persoon) { _invZoek = ''; _invHistoriek = false; _invZoekPersoon = persoon; }
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
  const editing = _invEditActive && _invEditPersoon === persoon;

  // Meldgrens (v2.4.0): 'op' = rode rij (inv-low), 'bijna' = oranje rij (inv-bijna); een grens boven 0 staat als "≤ n" naast het aantal.
  // Het belletje en de grens zijn enkel op pc en tablet te zien en te wijzigen (CSS op data-apparaat="gsm").
  const rij = o => {
    const entry   = voorraadRegel(stock[o.id]);
    const aantal  = entry.aantal;
    const drempel = entry.drempel;
    const gedempt = drempel === null;
    const status  = voorraadStatus(entry);

    if (!editing) {
      const klasse = status === 'op' ? ' inv-low' : status === 'bijna' ? ' inv-bijna' : '';
      const grens = drempel > 0 ? `<span class="inv-row-grens" title="Melding bij ${drempel} of minder">≤ ${drempel}</span>` : '';
      return `<div class="inv-row${klasse}">
        <span class="inv-row-naam">${escHtml(o.naam)}</span>
        <span class="inv-row-rechts"><span class="inv-row-aantal">${aantal}</span>${grens}</span>
      </div>`;
    }
    return `<div class="inv-row inv-cat-row" data-mat-id="${escHtml(o.id)}" data-mat-naam="${escHtml(o.naam)}">
      <span class="inv-row-naam">${escHtml(o.naam)}</span>
      <div class="inv-qty-edit">
        <button class="inv-qty-btn inv-qty-minus" type="button" title="Verminder" aria-label="Verminder ${escHtml(o.naam || 'naamloos item')}">−</button>
        <input class="inv-qty-input" type="number" aria-label="Aantal ${escHtml(o.naam || 'naamloos item')}" min="0" step="1" inputmode="numeric" value="${aantal}" />
        <button class="inv-qty-btn inv-qty-plus" type="button" title="Vermeerder" aria-label="Vermeerder ${escHtml(o.naam || 'naamloos item')}">+</button>
        <button class="inv-bell-btn${gedempt ? ' inv-bell-muted' : ''}" type="button" aria-label="${gedempt ? 'Lage-voorraadmelding inschakelen' : 'Lage-voorraadmelding uitschakelen'}" title="Lage-voorraadmelding voor dit item ${gedempt ? 'inschakelen' : 'uitschakelen'}">${gedempt ? '🔕' : '🔔'}</button>
        <label class="inv-melding"${gedempt ? ' hidden' : ''} title="Melding als er nog dit aantal of minder in de wagen ligt">
          <span class="inv-melding-tekst">meld bij ≤</span>
          <input class="inv-drempel-input" type="number" aria-label="Meldgrens ${escHtml(o.naam || 'naamloos item')}" min="0" max="${MAX_DREMPEL}" step="1" inputmode="numeric" value="${gedempt ? 0 : drempel}" />
        </label>
      </div>
    </div>`;
  };

  const zoek = `<div class="inv-zoek-wrap"><input type="search" class="inv-zoek" id="inv-zoek" placeholder="Zoek onderdeel…" aria-label="Zoek onderdeel" enterkeyhint="search" autocomplete="off" value="${escHtml(_invZoek)}"></div>`;
  const leeg = `<div class="inv-empty inv-zoek-leeg" role="status" hidden></div>`;
  // Per soort (zelfde groepen als Prijzen), binnen een soort alfabetisch; elke groep is een raster: naam en aantal staan dicht
  // bij elkaar en een breed scherm toont meerdere kolommen.
  const groepen = groepeerPerSoort(src.onderdelen).map(g => `<section class="inv-groep" aria-label="${escHtml(g.label)}">
      <div class="inv-groep-titel" role="heading" aria-level="3">${escHtml(g.label)}</div>
      <div class="inv-list inv-raster${editing ? ' inv-raster--bewerk' : ''}">${g.items.map(rij).join('')}</div>
    </section>`).join('');
  const lijst = `<div class="inv-groepen">${groepen}${leeg}</div>`;

  if (!editing) {
    const toolbar = `<div class="inv-toolbar">
      <button class="btn btn--secondary${_invHistoriek ? ' is-actief' : ''}" id="inv-hist-btn" aria-pressed="${_invHistoriek}">🕘 Historiek</button>
      <button class="btn btn--primary" id="inv-edit-btn">✏️ Bewerken</button>
    </div>`;
    return toolbar + (_invHistoriek ? renderHistoriek(persoon) : zoek + lijst);
  }
  // Bewerkmodus: werkbalk NA de lijst en vastgeplakt onderaan, zodat Opslaan altijd bereikbaar blijft
  return zoek + lijst + `<div class="inv-toolbar inv-toolbar-vast">
         <button class="btn btn--secondary" id="inv-cancel-btn">Annuleren</button>
         <button class="btn btn--primary" id="inv-save-btn">✓ Opslaan</button>
       </div>`;
}

// Onderdelen per soort in de volgorde van ONDERDEEL_CATEGORIEEN, binnen een soort alfabetisch. Een onderdeel zonder (bekende) soort
// komt in "Andere" achteraan: de voorraad toont altijd de hele catalogus.
function groepeerPerSoort(onderdelen) {
  const bekend = new Set(ONDERDEEL_CATEGORIEEN.map(c => c.id));
  const opNaam = (a, b) => a.naam.localeCompare(b.naam);
  const groepen = ONDERDEEL_CATEGORIEEN.map(c => ({ label: c.label, items: onderdelen.filter(o => o.categorie === c.id).sort(opNaam) }));
  groepen.push({ label: 'Andere', items: onderdelen.filter(o => !bekend.has(o.categorie)).sort(opNaam) });
  return groepen.filter(g => g.items.length);
}

// Normaliseer voor zoeken: kleine letters, zonder accenten
function invNorm(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Verbergt (niet verwijderen!) rijen die niet passen bij _invZoek, zodat ingetikte aantallen blijven staan
function invPasZoekToe(body) {
  const q = invNorm(_invZoek);
  const rijen = body.querySelectorAll('.inv-raster .inv-row');
  let zichtbaar = 0;
  rijen.forEach(r => {
    const naam = invNorm(r.dataset.matNaam || r.querySelector('.inv-row-naam')?.textContent);
    const toon = !q || naam.includes(q);
    r.hidden = !toon;
    if (toon) zichtbaar++;
  });
  // Een soort zonder passende onderdelen verdwijnt mee, titel inbegrepen
  body.querySelectorAll('.inv-groep').forEach(g => { g.hidden = !g.querySelector('.inv-row:not([hidden])'); });
  const leeg = body.querySelector('.inv-zoek-leeg');
  if (leeg) {
    const geen = q && rijen.length && !zichtbaar;
    leeg.hidden = !geen;
    leeg.textContent = geen ? `Geen onderdelen gevonden voor '${_invZoek.trim()}'` : '';
  }
}

function wireEigenVoorraad(body, persoon) {
  const zoekEl = body.querySelector('#inv-zoek');
  zoekEl?.addEventListener('input', () => { _invZoek = zoekEl.value; invPasZoekToe(body); });
  invPasZoekToe(body);
  body.querySelector('#inv-hist-btn')?.addEventListener('click', () => { _invHistoriek = !_invHistoriek; doRenderInventaris(persoon); });
  body.querySelector('#inv-edit-btn')?.addEventListener('click', () => { _invHistoriek = false; invStartEdit(persoon); });
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
      btn.setAttribute('aria-label', nowMuted ? 'Lage-voorraadmelding inschakelen' : 'Lage-voorraadmelding uitschakelen');
      const melding = row.querySelector('.inv-melding');
      if (melding) melding.hidden = nowMuted;
    });
  });
}

function invStartEdit(persoon) {
  const stock = _invData.wagenvoorraad[persoon] || {};
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  _invEditSnapshot = new Map();
  src.onderdelen.forEach(o => {
    const { aantal, drempel } = voorraadRegel(stock[o.id]);
    _invEditSnapshot.set(o.id, { aantal, drempel });
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
    const grens = row.querySelector('.inv-drempel-input');

    const nieuweAantal  = Math.max(0, parseInt(input.value, 10) || 0);
    const nieuweDrempel = bel.classList.contains('inv-bell-muted')
      ? null
      : Math.min(MAX_DREMPEL, Math.max(0, parseInt(grens?.value, 10) || 0));
    const oud = _invEditSnapshot.get(id) || { aantal: 0, drempel: null };

    const item = { materiaalId: id, materiaalNaam: naam };
    let gewijzigd = false;
    if (nieuweAantal !== oud.aantal)   { item.aantal  = nieuweAantal - oud.aantal; gewijzigd = true; }
    if (nieuweDrempel !== oud.drempel) { item.drempel = nieuweDrempel;             gewijzigd = true; }
    if (gewijzigd) items.push(item);
  });

  if (!items.length) { invCancelEdit(); return; }

  // Testmodus (?test, ook op de live site): geen schrijfactie naar de echte wagenvoorraad
  if (TEST_MODE) {
    invCancelEdit();
    toast('🧪 Testmodus — niet opgeslagen', 3500);
    return;
  }

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
    toast('✕ Opslaan is niet gelukt. Controleer je verbinding en probeer opnieuw. (Detail: ' + foutTekst(err) + ')', 4000);
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
    <input type="date" id="inv-export-van" title="Export van" aria-label="Export van" value="${escHtml(_invExportVan)}" />
    <span style="color:var(--muted);font-size:0.75rem">–</span>
    <input type="date" id="inv-export-tot" title="Export tot" aria-label="Export tot" value="${escHtml(_invExportTot)}" />
    <button class="btn-sec" id="inv-export-btn">📊 Excel export</button>
  </div>`;

  if (!entries.length) return toolbar + '<div class="inv-empty">Nog geen bewegingen.</div>';

  return toolbar + `<div class="inv-list">${renderLogRegels(entries, { nieuweIds, metTechnieker: true, verwerktKnop: true })}</div>`;
}

// Historiek van één persoon (knop "Historiek" in de technieker-weergave): dezelfde log als de supervisor ziet, enkel voor deze
// persoon. Alleen lezen: een aanvulling toont haar status, de knop "Verwerkt" blijft in de supervisor-weergave.
function renderHistoriek(persoon) {
  const entries = (_invData.log || []).filter(e => e.technieker === persoon)
    .sort((a, b) => new Date(b.datum) - new Date(a.datum));
  const uitleg = '<div class="inv-hist-uitleg">Wat er de laatste 3 maanden met deze wagenvoorraad gebeurde.</div>';
  if (!entries.length) return uitleg + '<div class="inv-empty">Nog geen bewegingen.</div>';
  return uitleg + `<div class="inv-list inv-hist-lijst">${renderLogRegels(entries, { nieuweIds: new Set(), metTechnieker: false, verwerktKnop: false })}</div>`;
}

// Logregels per dag (nieuwste eerst aangeleverd). `verwerktKnop`: knop "Verwerkt" bij een nieuwe aanvulling (supervisor).
function renderLogRegels(entries, { nieuweIds, metTechnieker, verwerktKnop }) {
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
    let status = '';
    if (e.type === 'aanvulling') {
      if (e.status !== 'nieuw') status = '<span class="inv-log-status-done">✓ verwerkt</span>';
      else if (verwerktKnop) status = `<button class="btn-sec inv-log-verwerkt-btn" data-log-id="${e.id}">Verwerkt</button>`;
      else status = '<span class="inv-log-status-done">nog niet verwerkt</span>';
    }
    html += `<div class="inv-log-row${nieuweIds.has(e.id) ? ' inv-day-new' : ''}">
      <span class="inv-log-type inv-log-${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
      ${metTechnieker ? `<span class="inv-log-technieker">${escHtml(e.technieker)}</span>` : ''}
      <span class="inv-log-materiaal">${escHtml(e.materiaalNaam)}</span>
      ${e.ticketNummer ? `<span class="inv-log-ticket" title="Ticket van het rapport">#${escHtml(e.ticketNummer)}</span>` : ''}
      <span class="inv-log-aantal">${e.aantal > 0 ? '+' : ''}${e.aantal}</span>
      <span class="inv-log-tijd">${tijd}</span>
      ${status}
    </div>`;
  });
  return html;
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

// Technieker: het aantal producten onder hun meldgrens, rood (badge--op) als er iets op is, anders oranje (badge--bijna).
// Alle technici: de openstaande aanvullingen (zonder statuskleur).
export function updateInventarisBadge(persoon) {
  const el = document.getElementById('cnt-inventaris');
  if (!el) return;
  let count;
  let kleur = null;
  if (persoon === 'all') {
    count = (_invData.log || []).filter(e => e.type === 'aanvulling' && e.status === 'nieuw').length;
  } else {
    const laag = lageItems(_invData.wagenvoorraad[persoon], (PRIJZEN || PRIJZEN_DEFAULTS).onderdelen);
    count = laag.length;
    if (count) kleur = laag.some(i => i.status === 'op') ? 'op' : 'bijna';
  }
  el.textContent = String(count);
  el.style.display = count > 0 ? '' : 'none';
  el.classList.toggle('badge--op', kleur === 'op');
  el.classList.toggle('badge--bijna', kleur === 'bijna');
}

// Opstartmelding (één keer per pagina-lading): wie zelf een wagen heeft (eigen Zoho-naam) en producten onder hun grens heeft,
// krijgt een korte melding. Aangeroepen door app.js na de eerste lading van de inventaris (ook als die uit de cache kwam).
export function meldLageVoorraadBijStart() {
  if (_invStartGemeld) return;
  if (!heeftRol('beheerder', 'planner', 'technieker')) return;
  const eigen = eigenZohoNaam();
  if (!eigen) return;
  _invStartGemeld = true;
  const tekst = startTekst(lageItems(_invData.wagenvoorraad[eigen], (PRIJZEN || PRIJZEN_DEFAULTS).onderdelen));
  if (tekst) toast(tekst, 6000);
}

// ── Verwerkt-actie (supervisor) ──
async function markVerwerkt(logId) {
  if (TEST_MODE) { toast('🧪 Testmodus — niet opgeslagen', 3500); return; }
  try {
    const res = await fetch(INV_API, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: _invData.versie, id: logId }),
    });
    if (res.status === 409) {
      const body = await res.json();
      _invData = body.data || _invData;
      toast('⚠ Iemand anders wijzigde dit net. De voorraad is opnieuw geladen; probeer opnieuw.', 3000);
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
    toast('✕ Verwerkt-markering mislukt: ' + foutTekst(err), 4000);
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

  // 'Ticket' staat achteraan, zodat de bestaande kolommen op hun plaats blijven.
  const headers = ['Datum', 'Tijd', 'Technieker', 'Type', 'Materiaal', 'Aantal', 'Status', 'Ticket'];
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
      e.ticketNummer ? `#${e.ticketNummer}` : '',
    ];
  });

  const colWidths = headers.map((h, i) => {
    const hLen   = h.length + 2;
    const maxVal = data.reduce((m, row) => Math.max(m, String(row[i] ?? '').length + 1), 0);
    return Math.min(Math.max(hLen, maxVal, 8), 36);
  });

  try {
    const ExcelJS = await laadExcelJs();
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
    toast(`✕ Export mislukt: ${err.message}`, 4000);
    console.error('exportInventarisLog:', err);
  }
}

// ── Automatische aftrek bij rapport-afronding ──
// Aangeroepen (niet afgewacht, best-effort) vanuit public/js/rapport-wizard.js's printRapport().
// 'vrije regel'-onderdelen (id begint met 'vrij-') zijn handmatig ingevoerde tekst zonder
// koppeling aan de prijzencatalogus -- die hebben geen materiaalId om tegen af te boeken, en
// worden dus bewust overgeslagen (geen fout, gewoon genegeerd).
// `ticketNummer` (optioneel) komt bij elke verbruiksregel in de log, zodat de supervisor ziet bij welk rapport de aftrek hoort.
// Geeft de producten uit DIT rapport terug die na een geslaagde aftrek onder hun meldgrens zitten (lageItems), anders [];
// de rapport-wizard toont ze als "Bijna op".
export async function registreerVerbruik(technieker, onderdelen, ticketNummer) {
  // Testmodus (?test) wordt ook op de live site gebruikt: zonder deze guard zou een testrapport
  // de echte wagenvoorraad wijzigen.
  if (TEST_MODE) return [];
  if (!technieker) return [];
  const items = (onderdelen || [])
    .filter(p => p.naam && !String(p.id || '').startsWith('vrij-') && (parseInt(p.aantal) || 0) > 0)
    .map(p => ({ materiaalId: p.id, materiaalNaam: p.naam, aantal: parseInt(p.aantal) || 1 }));
  if (!items.length) return [];

  // Mislukt de aftrek, dan meldt de wachtrij het en probeert ze zekere mislukkingen later opnieuw (Q4, kern/verbruik-wachtrij.js).
  const { uitkomst } = await verbruikWachtrij().meld(technieker, items, { ticketNummer });
  if (uitkomst !== 'gelukt') return [];
  return lageItems(_invData.wagenvoorraad[technieker], (PRIJZEN || PRIJZEN_DEFAULTS).onderdelen, items.map(i => i.materiaalId));
}

// Wachtrij met aftrekken die zeker niet gelukt zijn: opnieuw proberen bij opstart, bij weer online en bij elke lading (poll).
let _wachtrij = null;
function verbruikWachtrij() {
  if (_wachtrij) return _wachtrij;
  _wachtrij = maakVerbruikWachtrij({
    opslag: {
      lees: () => loadFromCache(WACHTRIJ_SLEUTEL) || [],
      schrijf: lijst => {
        if (lijst.length) saveToCache(WACHTRIJ_SLEUTEL, lijst);
        else { try { localStorage.removeItem(WACHTRIJ_SLEUTEL); } catch { /* best-effort */ } }
      },
    },
    post: async body => {
      const res = await fetch(INV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let data = null;
      try { data = await res.json(); } catch { /* geen JSON (bv. HTML van een gateway) */ }
      return { status: res.status, data };
    },
    versie: () => _invData.versie,
    gebruikerId: () => huidigeGebruiker()?.id ?? null, // logins T16: een item hoort bij de gebruiker die het aanmaakte
    naSucces: data => { _invData = data; saveToCache(INV_CACHE_KEY, _invData); },
    naConflict: data => { if (data && typeof data.versie === 'number') { _invData = data; saveToCache(INV_CACHE_KEY, _invData); } },
    toon: (tekst, ms) => toast(tekst, ms),
    online: () => globalThis.navigator?.onLine !== false,
    // Eén verwerker over alle tabs (Web Locks); een bezet slot = deze ronde overslaan. Zonder Web Locks geldt de lease in de wachtrij.
    slot: globalThis.navigator?.locks?.request
      ? fn => navigator.locks.request('blitz-verbruik', { ifAvailable: true }, lock => (lock ? fn() : undefined))
      : null,
  });
  return _wachtrij;
}
export function verwerkVerbruikWachtrij() {
  if (TEST_MODE) return Promise.resolve();
  return verbruikWachtrij().verwerk();
}
// Enkel met een sessie van een rol die de voorraad gebruikt: geen verzoeken vóór de login en geen voor sales.
if (typeof window !== 'undefined') window.addEventListener('online', () => { if (heeftRol('beheerder', 'planner', 'technieker')) verwerkVerbruikWachtrij(); });

// ── Window-bridge ──
// Enkel wat de rapport-wizard nog als kale naam leest: registreerVerbruik (na het versturen van een rapport).
// De rest (loadInventaris, renderInventaris, updateInventarisBadge, resetInvSeenLog, meldLageVoorraadBijStart) importeert app.js rechtstreeks.
window.registreerVerbruik    = registreerVerbruik;

