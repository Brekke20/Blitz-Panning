// schermen/sales-dom.js — kleine DOM-bouwers voor de sales-schermen. Alles wat de gebruiker intikte of uit een export komt, gaat enkel via
// textContent of value in de DOM (nooit innerHTML), zodat een naam als `<img onerror=…>` letterlijke tekst blijft.

/** el('div', { class: 'x', text: 'tekst', 'aria-label': 'y', hidden: true }, ...kinderen) */
export function el(tag, props = {}, ...kinderen) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = String(v);
    else if (k === 'value') e.value = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kind of kinderen) if (kind) e.append(kind);
  return e;
}

let teller = 0;
/** Een veld met label: -> { wrap, invoer }. `soort`: 'tekst' (standaard) | 'textarea' | 'date' | 'time' | 'number' | … (input-type). */
export function veld(label, { soort = 'text', value = '', maxlength, autocomplete, inputmode, verplicht = false, min, rows = 3, klasse = '' } = {}) {
  const id = `sales-veld-${++teller}`;
  const invoer = soort === 'textarea'
    ? el('textarea', { id, rows, maxlength })
    : el('input', { id, type: soort, maxlength, autocomplete, inputmode, min });
  invoer.value = value ?? '';
  if (verplicht) invoer.setAttribute('aria-required', 'true');
  const kop = el('label', { for: id, text: label });
  if (verplicht) kop.append(el('span', { class: 'sales-verplicht', 'aria-hidden': 'true', text: ' *' }));
  const fout = el('div', { class: 'sales-veld-fout', id: `${id}-fout`, hidden: true });
  const wrap = el('div', { class: `sales-veld ${klasse}`.trim() }, kop, invoer, fout);
  return { wrap, invoer, zetFout(tekst) {
    fout.hidden = !tekst;
    fout.textContent = tekst || '';
    if (tekst) { invoer.setAttribute('aria-invalid', 'true'); invoer.setAttribute('aria-describedby', fout.id); }
    else { invoer.removeAttribute('aria-invalid'); invoer.removeAttribute('aria-describedby'); }
  } };
}

/** Een sectie met kop: <section class="sales-sectie"><h3>kop</h3>…</section> */
export function sectie(kop, klasse, ...kinderen) {
  return el('section', { class: `sales-sectie ${klasse ?? ''}`.trim() }, el('h3', { class: 'sales-sectie-kop', text: kop }), ...kinderen);
}
