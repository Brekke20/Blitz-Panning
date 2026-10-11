// schermen/rolwisselaar.js — kiest in de lokale testmodus met welke rol de dev-server de app laat draaien (logins T19).
// Bestaat enkel als de pagina in testmodus (?test) staat én de server zich als lokale dev-server meldde (auth-ik: lokaleDev).
// In productie bestaat de wisselaar niet: de server negeert X-Blitz-Test-Rol daar toch.
import { TEST_MODE } from '../kern/omgeving.js';
import { isLokaleDev, testRolVoorHeader } from '../kern/sessie.js';

const TESTROL_SLEUTEL = 'blitz_test_rol'; // zelfde sleutel als kern/sessie.js (testRolVoorHeader)
const ROLLEN = [['beheerder', 'Beheerder'], ['planner', 'Planner'], ['technieker', 'Technieker'], ['sales', 'Sales']];
const WISSEL_ID = 'test-rol-wissel';

// Enkel letterlijk true voor beide vlaggen (fail-closed).
export function rolwisselaarZichtbaar({ testModus, lokaleDev } = {}) {
  return testModus === true && lokaleDev === true;
}

// Zet de keuzelijst naast #test-badge (eenmalig); wisselen bewaart de rol en herlaadt de pagina, zodat de hele app opnieuw start als die rol.
export function toonRolwisselaar() {
  if (!rolwisselaarZichtbaar({ testModus: TEST_MODE, lokaleDev: isLokaleDev() })) return;
  if (document.getElementById(WISSEL_ID)) return;
  const badge = document.getElementById('test-badge');
  if (!badge) return;
  const kies = document.createElement('select');
  kies.id = WISSEL_ID;
  kies.className = 'test-rol-wissel';
  kies.setAttribute('aria-label', 'Testrol');
  kies.title = 'Testrol (alleen lokaal)';
  for (const [waarde, label] of ROLLEN) {
    const optie = document.createElement('option');
    optie.value = waarde;
    optie.textContent = label;
    kies.appendChild(optie);
  }
  kies.value = testRolVoorHeader() || 'beheerder';
  kies.addEventListener('change', () => {
    try { localStorage.setItem(TESTROL_SLEUTEL, kies.value); } catch { /* geen opslag: de keuze geldt niet */ }
    try { location.reload(); } catch { /* geen location */ }
  });
  badge.insertAdjacentElement('afterend', kies);
}
