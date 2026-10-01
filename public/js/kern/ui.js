// kern/ui.js — UI-hulpen (puur, geen globale toestand)
// Bevat: escHtml, toast, toastDuur, registreerActies, maakActiveerbaar

let toastTimer;

export function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export function toastDuur(msg, ms) {
  // Standaard 4 s; foutmeldingen minstens 7 s. Een meegegeven duur mag enkel verlengen.
  const tekst = String(msg ?? '');
  const isFout = /^\s*(⚠|✕)/.test(tekst) || /mislukt|fout/i.test(tekst);
  const standaard = isFout ? 7000 : 4000;
  return Math.max(ms || 0, standaard);
}

export function toast(msg, ms) {
  const el = document.getElementById('toast');
  const duur = toastDuur(msg, ms);
  el.textContent = String(msg ?? '');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duur);
}

// Verpakt de afhankelijkheden van een scherm (`initX(afh)`): een ontbrekende sleutel gooit een duidelijke fout met
// de naam van de sleutel, zoals vóór de init (een vergeten of onvolledige init faalt luid in plaats van undefined).
export function strengeAfh(scherm, afhankelijkheden) {
  return new Proxy(afhankelijkheden, {
    get(doel, sleutel, ontvanger) {
      if (typeof sleutel === 'string' && !(sleutel in doel)) throw new Error(`${scherm}: afhankelijkheid '${sleutel}' ontbreekt in init`);
      return Reflect.get(doel, sleutel, ontvanger);
    },
  });
}

export function registreerActies(wortel, handlers) {
  const listener = (e) => {
    const el = e.target?.closest?.('[data-actie]');
    if (el) {
      const handler = handlers[el.dataset.actie];
      if (handler) {
        handler(el, e, el.dataset.arg);
      }
    }
  };

  wortel.addEventListener('click', listener);

  // Retourneer afmeld-functie
  return () => {
    wortel.removeEventListener('click', listener);
  };
}

// Maakt een niet-<button> element toetsenbord-bedienbaar (Enter/Space); toetsen uit binnenste
// knoppen/links/velden worden genegeerd zodat die hun eigen gedrag houden.
export function maakActiveerbaar(el, handler, label) {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target !== el && e.target.closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    handler(e);
  });
}
