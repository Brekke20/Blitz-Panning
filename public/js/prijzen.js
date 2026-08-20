// public/js/prijzen.js
// Prijzencatalogus (onderdelen + tarieven) en het admin-beheerscherm. `PRIJZEN` is de geladen
// server-state (via /api/prijzen, met localStorage-fallback); `zoekOnderdelen`/`getAlleTags`/
// `getPrijsVoorId` worden door de rapport-wizard gebruikt (via window, zie onderaan).

// ══════════════════════════════════════════════
// PRIJSBEHEER
// ══════════════════════════════════════════════

// Globale prijzenstate
export let PRIJZEN = null;          // { versie, bijgewerkt, onderdelen, tarieven }
export let PRIJZEN_DIRTY = null;    // werkkopie tijdens bewerking (null = niet gewijzigd)

export const PRIJZEN_LS_CACHE = 'blitz_prijzen_cache';
export const PRIJZEN_API_URL  = '/api/prijzen';

// ── Defaults (zelfde als server, client-side fallback) ───────────────────────
export const PRIJZEN_DEFAULTS = {
  versie: 1,
  bijgewerkt: new Date().toISOString(),
  onderdelen: [
    { id:'charx-3000',        naam:'Controller - CHARX 3000',            categorie:'controller',   tags:['controller','Phoenix Contact','3000'],              prijs:442.13, eenheid:'stuk' },
    { id:'charx-3100',        naam:'Controller - CHARX 3100',            categorie:'controller',   tags:['controller','Phoenix Contact','3100'],              prijs:693,    eenheid:'stuk' },
    { id:'charx-3050',        naam:'Controller - CHARX 3050',            categorie:'controller',   tags:['controller','Phoenix Contact','3050'],              prijs:525,    eenheid:'stuk' },
    { id:'charx-3050-slave',  naam:'Controller - CHARX 3050 Slave',      categorie:'controller',   tags:['controller','Phoenix Contact','3050','slave'],      prijs:498.58, eenheid:'stuk' },
    { id:'charx-3150',        naam:'Controller - CHARX 3150',            categorie:'controller',   tags:['controller','Phoenix Contact','3150'],              prijs:627.35, eenheid:'stuk' },
    { id:'charx-1000',        naam:'Controller - CHARX 1000',            categorie:'controller',   tags:['controller','Phoenix Contact','1000'],              prijs:255,    eenheid:'stuk' },
    { id:'meter-sdm54-m',     naam:'Energiemeter - Eastron SDM54-M',     categorie:'energiemeter', tags:['energiemeter','Eastron','SDM54','modbus','RS485'],  prijs:160, eenheid:'stuk' },
    { id:'meter-sdm72d-m',    naam:'Energiemeter - Eastron SDM72D-M',    categorie:'energiemeter', tags:['energiemeter','Eastron','SDM72','modbus','RS485'],  prijs:160, eenheid:'stuk' },
    { id:'meter-tcpip-direct',naam:'Energiemeter - TCP/IP Direct',       categorie:'energiemeter', tags:['energiemeter','TCP','IP','direct'],                 prijs:400, eenheid:'stuk' },
    { id:'meter-tcpip-indirect',naam:'Energiemeter - TCP/IP Indirect',   categorie:'energiemeter', tags:['energiemeter','TCP','IP','indirect'],               prijs:400, eenheid:'stuk' },
    { id:'ct-1000a', naam:'CT-klem 1000A/1A', categorie:'ct-klem', tags:['ct-klem','meetklem','1000A'], prijs:32,    eenheid:'stuk' },
    { id:'ct-600a',  naam:'CT-klem 600A/1A',  categorie:'ct-klem', tags:['ct-klem','meetklem','600A'],  prijs:27,    eenheid:'stuk' },
    { id:'ct-300a',  naam:'CT-klem 300A/1A',  categorie:'ct-klem', tags:['ct-klem','meetklem','300A'],  prijs:24,    eenheid:'stuk' },
    { id:'ct-80a',   naam:'CT-klem 80A/1A',   categorie:'ct-klem', tags:['ct-klem','meetklem','80A'],   prijs:10,    eenheid:'stuk' },
    { id:'contactor-4p-40a', naam:'Contactor 4P 40A', categorie:'overig', tags:['contactor','4P','40A'],                            prijs:40.50, eenheid:'stuk' },
    { id:'charx-rfid',       naam:'CHARX RFID',        categorie:'overig', tags:['rfid','kaartlezer','authenticatie'],               prijs:84,    eenheid:'stuk' },
    { id:'led',              naam:'LED',               categorie:'overig', tags:['led','indicatie'],                                 prijs:8,     eenheid:'stuk' },
    { id:'rcm',              naam:'RCM',               categorie:'overig', tags:['rcm','lekstroom','aardlek','veiligheid','residuele stroom'], prijs:29.50, eenheid:'stuk' },
    { id:'kabel-7m-zwart',       naam:'Laadkabel 7m Zwart',        categorie:'kabel', tags:['kabel','laadkabel','7m','zwart'],          prijs:170, eenheid:'stuk' },
    { id:'kabel-5m-zwart',       naam:'Laadkabel 5m Zwart',        categorie:'kabel', tags:['kabel','laadkabel','5m','zwart'],          prijs:120, eenheid:'stuk' },
    { id:'kabel-5m-grijs',       naam:'Laadkabel 5m Grijs',        categorie:'kabel', tags:['kabel','laadkabel','5m','grijs'],          prijs:160, eenheid:'stuk' },
    { id:'kabel-5m-rood',        naam:'Laadkabel 5m Rood',         categorie:'kabel', tags:['kabel','laadkabel','5m','rood'],           prijs:160, eenheid:'stuk' },
    { id:'kabel-spiraal-5m-11kw',naam:'Laadkabel Spiraal 5m 11kW', categorie:'kabel', tags:['kabel','laadkabel','spiraal','5m','11kW'], prijs:184, eenheid:'stuk' },
    { id:'kabel-spiraal-5m-22kw',naam:'Laadkabel Spiraal 5m 22kW', categorie:'kabel', tags:['kabel','laadkabel','spiraal','5m','22kW'], prijs:231, eenheid:'stuk' },
    { id:'socket',               naam:'Socket',                     categorie:'kabel', tags:['socket','aansluiting'],                   prijs:88,  eenheid:'stuk' },
  ],
  tarieven: [
    { id:'interventie-3u', naam:'Interventie (3u, incl. aanrijtijden)',              prijs:175, eenheid:'forfait' },
    { id:'extra-uur',      naam:'Extra uur',                                         prijs:75,  eenheid:'uur'     },
    { id:'1st-line-uur',   naam:'1st line interventie per uur (incl. aanrijtijden)', prijs:115, eenheid:'uur'     },
  ],
};

// ── Laden bij startup ─────────────────────────────────────────────────────────
export async function loadPrijzen() {
  if (TEST_MODE) {
    // Testomgeving: gebruik localStorage-cache of defaults
    const cached = localStorage.getItem(PRIJZEN_LS_CACHE);
    PRIJZEN = cached ? JSON.parse(cached) : JSON.parse(JSON.stringify(PRIJZEN_DEFAULTS));
    return;
  }
  try {
    const res = await fetch(PRIJZEN_API_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    PRIJZEN = await res.json();
    // Bijwerken lokale cache
    localStorage.setItem(PRIJZEN_LS_CACHE, JSON.stringify(PRIJZEN));
  } catch {
    // Fallback: cache → defaults
    const cached = localStorage.getItem(PRIJZEN_LS_CACHE);
    PRIJZEN = cached ? JSON.parse(cached) : JSON.parse(JSON.stringify(PRIJZEN_DEFAULTS));
    console.warn('[Prijzen] Kon niet laden van server, cache/defaults gebruikt');
  }
}

// ── Admin-modal openen/sluiten ─────────────────────────────────────────────────
export function openPrijsBeheer() {
  closeSettings();
  const overlay = document.getElementById('prijs-overlay');
  overlay.classList.add('open');
  showPrijsEditor(); // geen wachtwoord meer vereist
}

export function closePrijsBeheer(event) {
  if (event && event.target !== document.getElementById('prijs-overlay')) return;
  if (PRIJZEN_DIRTY) {
    if (!confirm('Je hebt onopgeslagen wijzigingen. Toch sluiten?')) return;
  }
  document.getElementById('prijs-overlay').classList.remove('open');
  PRIJZEN_DIRTY = null;
}

// ── Editor weergeven ──────────────────────────────────────────────────────────
export function showPrijsEditor() {
  document.getElementById('prijs-editor').style.display = 'flex';
  PRIJZEN_DIRTY = null;
  renderPrijsEditor();
}

export function getPrijzen() {
  return PRIJZEN_DIRTY || PRIJZEN || PRIJZEN_DEFAULTS;
}

export function markDirty() {
  if (!PRIJZEN_DIRTY) {
    PRIJZEN_DIRTY = JSON.parse(JSON.stringify(getPrijzen()));
  }
  document.getElementById('prijs-save-btn').classList.add('btn-dirty');
}

export function prijsReset() {
  if (!confirm('Alle wijzigingen ongedaan maken?')) return;
  PRIJZEN_DIRTY = null;
  document.getElementById('prijs-save-btn').classList.remove('btn-dirty');
  renderPrijsEditor();
}

// ── Renderer ──────────────────────────────────────────────────────────────────
export function renderPrijsEditor() {
  const data = getPrijzen();
  // Meta
  const meta = document.getElementById('prijs-meta');
  if (data.bijgewerkt) {
    const d = new Date(data.bijgewerkt);
    meta.textContent = `v${data.versie} · ${d.toLocaleDateString('nl-BE')} ${d.toLocaleTimeString('nl-BE', {hour:'2-digit',minute:'2-digit'})}`;
  }
  // Controleer of data van cache komt
  const body = document.getElementById('prijs-body');
  let html = '';
  if (!TEST_MODE && !navigator.onLine) {
    html += `<div class="prijs-cache-banner">⚠️ Offline — prijzen uit lokale cache</div>`;
  }

  // Categorieën
  const cats = [
    { id:'controller',   label:'Controllers' },
    { id:'energiemeter', label:'Energiemeters' },
    { id:'ct-klem',      label:'CT-klemmen' },
    { id:'overig',       label:'Overige componenten' },
    { id:'kabel',        label:'Laadkabels & aansluitingen' },
  ];
  for (const cat of cats) {
    const items = data.onderdelen.filter(o => o.categorie === cat.id);
    if (!items.length) continue;
    html += `<div class="prijs-cat">
      <div class="prijs-cat-title">${cat.label}</div>`;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      const globalIdx = data.onderdelen.indexOf(o);
      const tagsHtml = (o.tags || []).map((t, ti) =>
        `<span class="prijs-tag">${escHtml(t)}<span class="prijs-tag-del" onclick="prijsVerwijderTag(${globalIdx},${ti})">×</span></span>`
      ).join('') +
      `<button class="prijs-tag-add" onclick="prijsVoegTagToe(${globalIdx})">+ tag</button>`;
      html += `<div class="prijs-row">
        <div class="prijs-row-main">
          <input class="prijs-naam-input" value="${escHtml(o.naam)}"
            oninput="prijsUpdateNaam(${globalIdx},this.value)" placeholder="Naam" />
          <div class="prijs-tags-wrap">${tagsHtml}</div>
        </div>
        <div class="prijs-row-right">
          <div class="prijs-input-wrap">
            <span class="prijs-euro">€</span>
            <input class="prijs-prijs-input" type="number" min="0" step="0.01"
              value="${o.prijs}" oninput="prijsUpdatePrijs(${globalIdx},this.value)" />
          </div>
          <span class="prijs-eenheid">/ ${o.eenheid}</span>
          <button class="prijs-del-btn" onclick="prijsVerwijderOnderdeel(${globalIdx})" title="Verwijder">🗑</button>
        </div>
      </div>`;
    }
    html += `<button class="prijs-add-btn prijs-btn-voegtoe" data-cat-id="${escHtml(cat.id)}">+ Onderdeel toevoegen</button>
    </div>`;
  }

  // Tarieven
  html += `<div class="prijs-tarieven-sep"></div>
    <div class="prijs-cat-title">Tarieven</div>`;
  for (let i = 0; i < data.tarieven.length; i++) {
    const t = data.tarieven[i];
    html += `<div class="prijs-tarief-row">
      <span class="prijs-tarief-naam">${escHtml(t.naam)}</span>
      <div class="prijs-input-wrap">
        <span class="prijs-euro">€</span>
        <input class="prijs-prijs-input" type="number" min="0" step="0.01"
          value="${t.prijs}" oninput="prijsTariefUpdate(${i},this.value)" />
      </div>
      <span class="prijs-eenheid">/ ${t.eenheid}</span>
    </div>`;
  }

  body.innerHTML = html;

  // cat.id komt uit een hardcoded lijst (geen risico), maar data-attribuut + addEventListener
  // voor consistentie met de rest van de prijzen-blob-afgeleide knoppen.
  body.querySelectorAll('.prijs-btn-voegtoe').forEach(btn => {
    btn.addEventListener('click', () => prijsVoegOnderdeel(btn.dataset.catId || ''));
  });
}

// ── Mutatie-helpers ───────────────────────────────────────────────────────────
export function prijsUpdateNaam(idx, val) {
  markDirty();
  PRIJZEN_DIRTY.onderdelen[idx].naam = val;
}
export function prijsUpdatePrijs(idx, val) {
  markDirty();
  PRIJZEN_DIRTY.onderdelen[idx].prijs = parseFloat(val) || 0;
}
export function prijsTariefUpdate(idx, val) {
  markDirty();
  PRIJZEN_DIRTY.tarieven[idx].prijs = parseFloat(val) || 0;
}
export function prijsVerwijderOnderdeel(idx) {
  markDirty();
  PRIJZEN_DIRTY.onderdelen.splice(idx, 1);
  renderPrijsEditor();
}
export function prijsVerwijderTag(ondIdx, tagIdx) {
  markDirty();
  PRIJZEN_DIRTY.onderdelen[ondIdx].tags.splice(tagIdx, 1);
  renderPrijsEditor();
}
export function prijsVoegTagToe(ondIdx) {
  const tag = prompt('Nieuwe tag:');
  if (!tag || !tag.trim()) return;
  markDirty();
  PRIJZEN_DIRTY.onderdelen[ondIdx].tags.push(tag.trim());
  renderPrijsEditor();
}
export function prijsVoegOnderdeel(categorie) {
  markDirty();
  const id = 'nieuw-' + Date.now();
  PRIJZEN_DIRTY.onderdelen.push({ id, naam:'', categorie, tags:[], prijs:0, eenheid:'stuk' });
  renderPrijsEditor();
  // Scroll naar het nieuwe item
  setTimeout(() => {
    const inputs = document.querySelectorAll('.prijs-naam-input');
    inputs[inputs.length - 1]?.focus();
  }, 50);
}

// ── Opslaan ───────────────────────────────────────────────────────────────────
export async function prijsOpslaan() {
  if (!PRIJZEN_DIRTY) { toast('Geen wijzigingen'); return; }
  const btn = document.getElementById('prijs-save-btn');
  btn.disabled = true;
  btn.textContent = 'Bezig...';

  const payload = {
    ...PRIJZEN_DIRTY,
    versie: PRIJZEN ? PRIJZEN.versie : 1,
  };

  if (TEST_MODE) {
    // Testomgeving: sla op in localStorage
    payload.versie = (payload.versie || 1) + 1;
    payload.bijgewerkt = new Date().toISOString();
    PRIJZEN = payload;
    PRIJZEN_DIRTY = null;
    localStorage.setItem(PRIJZEN_LS_CACHE, JSON.stringify(PRIJZEN));
    btn.disabled = false;
    btn.textContent = 'Opslaan';
    btn.classList.remove('btn-dirty');
    toast('Prijzen opgeslagen (test)');
    renderPrijsEditor();
    return;
  }

  try {
    const res = await fetch(PRIJZEN_API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        toast('⚠️ Conflict: prijslijst werd elders gewijzigd. Herlaad de pagina.');
      } else {
        toast('Fout: ' + (data.error || res.status));
      }
      btn.disabled = false;
      btn.textContent = 'Opslaan';
      return;
    }
    PRIJZEN = data;
    PRIJZEN_DIRTY = null;
    localStorage.setItem(PRIJZEN_LS_CACHE, JSON.stringify(PRIJZEN));
    btn.disabled = false;
    btn.textContent = 'Opslaan';
    btn.classList.remove('btn-dirty');
    toast('✓ Prijzen opgeslagen');
    renderPrijsEditor();
  } catch (err) {
    toast('Verbindingsfout: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Opslaan';
  }
}

// ── Zoekfunctie voor wizard (exported) ───────────────────────────────────────
export function zoekOnderdelen(query, activeTags) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const q = (query || '').toLowerCase().trim();
  return src.onderdelen.filter(o => {
    if (activeTags && activeTags.length) {
      const oTags = (o.tags || []).map(t => t.toLowerCase());
      if (!activeTags.every(t => oTags.includes(t.toLowerCase()))) return false;
    }
    if (!q) return true;
    return o.naam.toLowerCase().includes(q) || (o.tags || []).some(t => t.toLowerCase().includes(q));
  });
}

export function getAlleTags() {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const set = new Set();
  src.onderdelen.forEach(o => (o.tags || []).forEach(t => set.add(t)));
  return [...set].sort();
}

export function getPrijsVoorId(id) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const o = src.onderdelen.find(x => x.id === id);
  return o ? o.prijs : null;
}

// ── Window-bridges ────────────────────────────────────────────────────────────
// Alles hieronder wordt van BUITEN dit bestand aangeroepen: ofwel via HTML
// onclick/oninput-attributen (renderPrijsEditor genereert HTML met inline handlers, die
// altijd in global/window-scope worden opgezocht — module-scoped functies zijn daar
// onzichtbaar), ofwel als bare functie-aanroep vanuit index.html's classic <script>
// (loadPrijzen() bij startup; zoekOnderdelen/getAlleTags in de rapport-wizard-stap
// "Status & onderdelen"). showPrijsEditor/getPrijzen/markDirty/renderPrijsEditor/
// prijsVoegOnderdeel worden enkel intern (binnen dit bestand, via gewone functie-scope of
// addEventListener-closures) aangeroepen en hoeven daarom niet gebridged te worden.
window.loadPrijzen             = loadPrijzen;
window.openPrijsBeheer         = openPrijsBeheer;
window.closePrijsBeheer        = closePrijsBeheer;
window.prijsReset              = prijsReset;
window.prijsOpslaan            = prijsOpslaan;
window.prijsUpdateNaam         = prijsUpdateNaam;
window.prijsUpdatePrijs        = prijsUpdatePrijs;
window.prijsTariefUpdate       = prijsTariefUpdate;
window.prijsVerwijderOnderdeel = prijsVerwijderOnderdeel;
window.prijsVerwijderTag       = prijsVerwijderTag;
window.prijsVoegTagToe         = prijsVoegTagToe;
window.zoekOnderdelen          = zoekOnderdelen;
window.getAlleTags             = getAlleTags;
window.getPrijsVoorId          = getPrijsVoorId;

// PRIJZEN_DEFAULTS is een `const` (object wordt nooit herwezen, enkel als fallback
// gelezen) — een statische window-toewijzing is hier veilig, in tegenstelling tot PRIJZEN.
window.PRIJZEN_DEFAULTS = PRIJZEN_DEFAULTS;

// PRIJZEN wordt van BUITEN dit bestand rechtstreeks gelezen als bare variabele (niet enkel
// via zoekOnderdelen/getAlleTags/getPrijsVoorId): public/js/rapport-wizard.js's wizVoegCatToe
// (rapport-wizard, stap "Status & onderdelen") doet `PRIJZEN || PRIJZEN_DEFAULTS` rechtstreeks. PRIJZEN is een
// `let` die bij elke loadPrijzen()/prijsOpslaan() een NIEUWE waarde krijgt (geen in-place
// mutatie) — een statische `window.PRIJZEN = PRIJZEN` zou dus een verouderde momentopname
// vastzetten die nooit meer bijwerkt. Vandaar een live getter, net als bij `_rapportArchief`
// (Task 2, public/js/rapport-archief.js). Niets buiten dit bestand herschrijft PRIJZEN zelf
// (enkel lezen), dus enkel een getter is nodig, geen setter.
Object.defineProperty(window, 'PRIJZEN', {
  get: () => PRIJZEN,
  configurable: true,
});
