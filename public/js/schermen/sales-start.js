// schermen/sales-start.js — de start van rol sales; vervangt voor sales de gewone `opstart()` van app.js (die ~15 endpoints aanroept die voor
// sales 403 geven). Doet enkel wat de tabbalk en de kop nodig hebben: tabklik, thema, testbadge, ⚙ en ↺ in de kop, de persoonskiezer (enkel een sales manager;
// een gewone verkoper heeft niets te kiezen), de streep onder de actieve tab, en de eerste tab activeren. De DOM-afspraken zijn die van `setTab` in app.js.
// `startNaInlog` roept `start()` zonder await/catch aan: fouten vangen we hier zelf op (toast), anders een onafgehandelde rejection.
import { zetStickyOffsets } from '../sticky-offset.js';
import { registreerActies, toast } from '../kern/ui.js';
import { tabsVoorRol, laadTab } from '../kern/navigatie.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { huidigeRechten } from '../kern/sessie.js';
import { initPersoonskiezer, koppelLuisteraars, bouwMenu, werkKnopBij, toggleMenu, laadLijsten } from './persoonskiezer.js';
import { kiesVerkoper, zorgVoorVerkopers, lijstVerkopers, VERKOPER_SLEUTEL } from './sales-verkoper.js';
import { herlaadActief } from './sales-schil.js';

function activeerTab(id) {
  const knop = document.getElementById('tab-' + id);
  const view = document.getElementById('view-' + id);
  if (!knop || !view) return;
  document.querySelectorAll('.tab').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); el.tabIndex = -1; });
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  knop.classList.add('active'); knop.setAttribute('aria-selected', 'true'); knop.tabIndex = 0;
  view.classList.add('active');
  laadTab(id);
  window.scrollTo(0, 0); // een tabwissel start bovenaan
}

// De persoonskiezer van een sales manager (kop B): "👥 Sales: An ▾", enkel verkopers. Een gewone verkoper heeft niets te kiezen en geen kiezer.
function startKiezer() {
  initPersoonskiezer({
    ticketNamen: () => [], gekozenTechnieker: () => 'all', gekozenVerkoper: () => { try { return localStorage.getItem(VERKOPER_SLEUTEL); } catch { return null; } },
    werkruimte: () => 'sales', metSales: () => true,
    laadVerkopers: async () => { const ok = await zorgVoorVerkopers(); return { ok, lijst: lijstVerkopers() }; },
    verkopersNu: () => lijstVerkopers(),
    kies: (item) => { kiesVerkoper(item.sleutel); bouwMenu(); werkKnopBij(); },
    terug: () => {},
  });
  koppelLuisteraars();
  registreerActies(document.body, { 'persoon-menu': (el, e) => toggleMenu({ focus: e?.detail === 0 }) });
  bouwMenu();
  werkKnopBij();
  laadLijsten().catch(() => {}); // de knop toont de naam van de getoonde verkoper zodra de lijst er is
}

function verbergKopKnoppen() {
  const kiezer = huidigeRechten().alleSales ? [] : ['#person-sel'];
  for (const sel of kiezer) {
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
  document.getElementById('meta-theme-color')?.setAttribute('content', volgende === 'light' ? '#e5eefa' : '#0d1530');
}

export async function start() {
  try {
    if (!document.documentElement.getAttribute('data-theme')) {
      let thema = 'dark';
      try { thema = localStorage.getItem('blitz_theme') || 'dark'; } catch { /* geen opslag */ }
      document.documentElement.setAttribute('data-theme', thema);
    }
    registreerActies(document.querySelector('.tabs-inner'), { hoofdtab: (el, e, tab) => { e.stopPropagation(); activeerTab(tab); } });
    // ⚙ en ↺ in de kop (kop B), zoals bij de techniekers: ⚙ = de eigen sales-instellingen (ook bij de leads van een collega; vroeger "⚙ Instellingen"
    // in de verkoperbalk), ↺ = de leads en instellingen van het open scherm opnieuw laden (dezelfde lading als "Opnieuw").
    registreerActies(document.body, {
      thema: () => toggleThema(),
      instellingen: () => { import('./sales-instellingen.js').then(m => m.openSalesInstellingen()); },
      vernieuw: () => { herlaadActief(); },
    });
    if (TEST_MODE) { const badge = document.getElementById('test-badge'); if (badge) badge.style.display = 'inline-block'; }
    verbergKopKnoppen();
    if (huidigeRechten().alleSales) startKiezer();
    window.addEventListener('resize', () => { zetStickyOffsets(); });
    // Route bestaat niet op een gsm (kop B): staat iemand op Route en wordt het venster een gsm (draaien, smaller), dan gaat hij naar Kalender.
    window.addEventListener('apparaatwijziging', () => {
      const actief = document.querySelector('.tab.active');
      if (window.apparaat?.indeling === 'smal' && actief?.classList.contains('alleen-groot')) activeerTab('sales-kalender');
      zetStickyOffsets();
    });
    zetStickyOffsets();
    const eerste = tabsVoorRol('sales')[0];
    if (eerste) activeerTab(eerste.id);
  } catch (fout) {
    console.error('Sales starten mislukt:', fout);
    try { toast('Het sales-gedeelte kon niet starten. Herlaad de pagina.'); } catch { /* geen DOM */ }
  }
}
