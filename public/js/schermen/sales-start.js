// schermen/sales-start.js — de start van rol sales; vervangt voor sales de gewone `opstart()` van app.js (die ~15 endpoints aanroept die voor
// sales 403 geven). Doet enkel wat de tabbalk en de kop nodig hebben: tabklik, thema, testbadge, de koptknoppen die enkel na `opstart()` werken
// verbergen, de streep onder de actieve tab, en de eerste tab activeren. De DOM-afspraken zijn die van `setTab` in app.js.
// `startNaInlog` roept `start()` zonder await/catch aan: fouten vangen we hier zelf op (toast), anders een onafgehandelde rejection.
import { registreerActies, toast } from '../kern/ui.js';
import { tabsVoorRol, laadTab } from '../kern/navigatie.js';
import { TEST_MODE } from '../kern/omgeving.js';

function zetStreep(tabId) {
  const tab = document.getElementById(tabId);
  const tabs = document.querySelector('.tabs');
  if (!tab || !tabs) return;
  const tr = tab.getBoundingClientRect();
  const pr = tabs.getBoundingClientRect();
  tabs.style.setProperty('--ind-left', (tr.left - pr.left) + 'px');
  tabs.style.setProperty('--ind-width', tr.width + 'px');
}

function zetTopbarHoogte() {
  const tb = document.querySelector('.topbar-sticky');
  if (!tb) return;
  const h = Math.round(tb.getBoundingClientRect().height * 10) / 10;
  if (h > 0) document.documentElement.style.setProperty('--topbar-h', h + 'px');
}

function activeerTab(id) {
  const knop = document.getElementById('tab-' + id);
  const view = document.getElementById('view-' + id);
  if (!knop || !view) return;
  document.querySelectorAll('.tab').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); el.tabIndex = -1; });
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  knop.classList.add('active'); knop.setAttribute('aria-selected', 'true'); knop.tabIndex = 0;
  view.classList.add('active');
  zetStreep(knop.id);
  laadTab(id);
  window.scrollTo(0, 0); // een tabwissel start bovenaan
}

function verbergKopKnoppen() {
  for (const sel of ['[data-actie="vernieuw"]', '[data-actie="instellingen"]', '#person-sel']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }
}

function toggleThema() {
  const nu = document.documentElement.getAttribute('data-theme') || 'dark';
  const volgende = nu === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', volgende);
  try { localStorage.setItem('blitz_theme', volgende); } catch { /* geen opslag */ }
  document.getElementById('meta-theme-color')?.setAttribute('content', volgende === 'light' ? '#f5f6f7' : '#181e24');
}

export async function start() {
  try {
    if (!document.documentElement.getAttribute('data-theme')) {
      let thema = 'dark';
      try { thema = localStorage.getItem('blitz_theme') || 'dark'; } catch { /* geen opslag */ }
      document.documentElement.setAttribute('data-theme', thema);
    }
    registreerActies(document.querySelector('.tabs-inner'), { hoofdtab: (el, e, tab) => { e.stopPropagation(); activeerTab(tab); } });
    registreerActies(document.body, { thema: () => toggleThema() });
    if (TEST_MODE) { const badge = document.getElementById('test-badge'); if (badge) badge.style.display = 'inline-block'; }
    verbergKopKnoppen();
    window.addEventListener('resize', () => {
      const actief = document.querySelector('.tab.active');
      if (actief) zetStreep(actief.id);
      zetTopbarHoogte();
    });
    document.querySelector('.tabs-inner')?.addEventListener('scroll', () => {
      const actief = document.querySelector('.tab.active');
      if (actief) zetStreep(actief.id);
    });
    zetTopbarHoogte();
    const eerste = tabsVoorRol('sales')[0];
    if (eerste) activeerTab(eerste.id);
  } catch (fout) {
    console.error('Sales starten mislukt:', fout);
    try { toast('Het sales-gedeelte kon niet starten. Herlaad de pagina.'); } catch { /* geen DOM */ }
  }
}
