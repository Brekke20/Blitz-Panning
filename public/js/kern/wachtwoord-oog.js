// kern/wachtwoord-oog.js — het oogje bij een wachtwoordveld: wisselt tussen verbergen (type password) en tonen (type text).
// Eén gedeelde helper voor alle wachtwoordvelden van de app (inloggen, wachtwoord wijzigen, herstel, setup, beheer).
// Toegankelijk: <button type="button"> (dus nooit een submit) met aria-label "Wachtwoord tonen"/"Wachtwoord verbergen" en
// aria-pressed; bedienbaar met toetsenbord. Inline SVG (kleur via currentColor: licht en donker thema), raakvlak 44×44 px (CSS).
const OOG_OPEN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OOG_DICHT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// Zet een oogje bij één wachtwoordveld (het veld wordt in een .ww-wrap gezet, de knop komt erachter). Geeft de knop terug,
// of null als het veld al een oogje heeft of niet bestaat.
export function voegWachtwoordOogToe(input) {
  if (!input || !input.parentNode || input.dataset.oog === '1') return null;
  input.dataset.oog = '1';
  const wrap = document.createElement('span');
  wrap.className = 'ww-wrap';
  input.parentNode.insertBefore(wrap, input);
  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'ww-oog';
  const zet = (toon) => {
    input.type = toon ? 'text' : 'password';
    knop.setAttribute('aria-pressed', toon ? 'true' : 'false');
    knop.setAttribute('aria-label', toon ? 'Wachtwoord verbergen' : 'Wachtwoord tonen');
    knop.innerHTML = toon ? OOG_DICHT : OOG_OPEN; // vaste SVG-constanten, geen gebruikersinvoer
  };
  zet(false);
  knop.addEventListener('click', () => zet(input.type === 'password'));
  wrap.append(input, knop);
  return knop;
}

// Alle wachtwoordvelden binnen `wortel` (bv. een hele loginkaart).
export function voegWachtwoordOogjesToe(wortel) {
  for (const input of wortel.querySelectorAll('input[type="password"]')) voegWachtwoordOogToe(input);
}
