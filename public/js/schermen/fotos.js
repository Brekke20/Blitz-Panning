// schermen/fotos.js — foto's bij een ticket (etappe 5b): het fotovenster, laden/bewaren (GET/PUT /api/fotos) en het raster.
// De code is letterlijk uit index.html verhuisd (D12: ook de PUT-schrijfpaden voor toevoegen, bijschrift en verwijderen,
// inclusief de 409-afhandeling). Enkel de voorvoegsels zijn nieuw: `export`, imports, en `zetFotoState({...})` waar de code
// `_fotoState = {...}` deed. De staat `_fotoState` is GEDEELD met de wizard (stap "Foto's"): hij wordt gelezen via de
// export van rapport-wizard.js en volledig opnieuw toegewezen via `zetFotoState` (D19). rapport-wizard.js en dit bestand
// importeren elkaar (ES-modulecyclus): veilig, want geen van beide roept op moduleniveau iets van de ander aan.
// Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe. De knoppen en het bestandsveld
// lopen via data-actie/data-wijzig-delegatie; het venster sluit via registreerBackdrop (inhoudsklik sluit niet).
import { foutTekst } from '../kern/api.js';
import { toast, escHtml, registreerActies, registreerWijzigActies, registreerBackdrop } from '../kern/ui.js';
import { registreerVenster } from '../venster.js';
import { _fotoState, zetFotoState } from '../rapport-wizard.js';

export function initFotos() {
  registreerActies(document.body, {
    'foto-sluit': () => closeFotoModal(),
    'foto-kies':  () => document.getElementById('foto-file-input').click(),
  });
  registreerWijzigActies(document.body, {
    'foto-bestand': (el) => handleFotoFiles(el),
  });
  const overlay = document.getElementById('foto-overlay');
  registreerBackdrop(overlay, closeFotoModal);
  registreerVenster({ el: overlay, sluit: () => closeFotoModal() });
}

const FOTO_API           = '/api/fotos';
const FOTO_MAX_DIM       = 1600;
const FOTO_JPEG_QUALITY  = 0.7;
const FOTO_MAX_COUNT     = 30;

function compressFotoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Bestand lezen mislukt'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Afbeelding laden mislukt'));
      img.onload = () => {
        let width = img.width, height = img.height;
        if (width > FOTO_MAX_DIM || height > FOTO_MAX_DIM) {
          const scale = FOTO_MAX_DIM / Math.max(width, height);
          width  = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', FOTO_JPEG_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function loadFotos(ticketId) {
  try {
    const res = await fetch(`${FOTO_API}?ticketId=${encodeURIComponent(ticketId)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.warn("Foto's laden mislukt:", err);
    return { versie: 0, fotos: [] };
  }
}

export async function saveFotos(ticketId, versie, fotos) {
  const res = await fetch(FOTO_API, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ticketId, versie, fotos }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || ('HTTP ' + res.status)), { status: res.status, data });
  return data;
}

export function renderFotoGrid(container, fotos, callbacks) {
  if (!fotos.length) {
    container.innerHTML = '<div style="font-size:0.78rem;color:var(--muted);padding:6px 0">Nog geen foto\'s toegevoegd.</div>';
    return;
  }
  container.innerHTML = fotos.map(f => `
    <div class="foto-thumb" data-id="${escHtml(f.id)}">
      <img src="${escHtml(f.dataUrl)}" alt="">
      <button class="foto-thumb-del" title="Verwijderen" aria-label="Foto verwijderen" data-action="del" data-id="${escHtml(f.id)}">✕</button>
      <input class="foto-caption" type="text" aria-label="Bijschrift" placeholder="Bijschrift..." value="${escHtml(f.caption || '')}" data-action="caption" data-id="${escHtml(f.id)}">
    </div>`).join('');
  container.querySelectorAll('[data-action="del"]').forEach(btn =>
    btn.addEventListener('click', () => callbacks.onDelete(btn.dataset.id)));
  container.querySelectorAll('[data-action="caption"]').forEach(inp =>
    inp.addEventListener('change', () => callbacks.onCaptionInput(inp.dataset.id, inp.value)));
}

export async function openFotoModal(ticketId) {
  if (!ticketId) return;
  const { versie, fotos } = await loadFotos(ticketId);
  zetFotoState({ ticketId, versie, fotos });
  renderFotoGridInto('foto-grid');
  document.getElementById('foto-overlay').classList.add('open');
}

export function closeFotoModal(e) {
  if (e && e.target !== document.getElementById('foto-overlay')) return;
  document.getElementById('foto-overlay').classList.remove('open');
}

export function renderFotoGridInto(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  renderFotoGrid(el, _fotoState.fotos, {
    onDelete:      (id) => persistFotoChange(_fotoState.fotos.filter(f => f.id !== id), containerId),
    onCaptionInput: (id, value) => persistFotoChange(
      _fotoState.fotos.map(f => f.id === id ? { ...f, caption: value } : f), containerId
    ),
  });
}

async function persistFotoChange(newFotos, containerId) {
  try {
    const result = await saveFotos(_fotoState.ticketId, _fotoState.versie, newFotos);
    _fotoState.versie = result.versie;
    _fotoState.fotos  = result.fotos;
  } catch (err) {
    if (err.status === 409) {
      toast('⚠ Foto\'s zijn elders gewijzigd — je laatste wijziging is niet opgeslagen, probeer opnieuw', 4500);
      const fresh = await loadFotos(_fotoState.ticketId);
      _fotoState.versie = fresh.versie;
      _fotoState.fotos  = fresh.fotos;
    } else {
      toast('✕ Foto opslaan mislukt: ' + foutTekst(err), 4000);
    }
  }
  renderFotoGridInto(containerId);
}

export async function handleFotoFiles(input, containerId = 'foto-grid') {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  if (_fotoState.fotos.length + files.length > FOTO_MAX_COUNT) {
    return toast(`⚠ Maximaal ${FOTO_MAX_COUNT} foto's per ticket`, 3500);
  }
  toast(`📷 ${files.length} foto${files.length > 1 ? "'s" : ''} verwerken...`, 4000);
  const nieuwe = [];
  for (const file of files) {
    try {
      const dataUrl = await compressFotoFile(file);
      nieuwe.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, dataUrl, caption: '', tijdstip: new Date().toISOString() });
    } catch (err) {
      toast('✕ Foto verwerken mislukt: ' + err.message, 4000);
    }
  }
  if (nieuwe.length) await persistFotoChange([..._fotoState.fotos, ...nieuwe], containerId);
}
