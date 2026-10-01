// kern/ui.js — UI-hulpen (puur, geen globale toestand)
// Bevat: escHtml, toast, toastDuur, registreerActies

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
