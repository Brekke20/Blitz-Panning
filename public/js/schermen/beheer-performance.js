// schermen/beheer-performance.js — beheertab "Performance" (dashboard T18): filters, zes kerncijfer-tegels, vijf blokken,
// dekking-voetnoten en het instellingen-paneel (kleurgrenzen). Registreert zichzelf via registreerBeheerTab; beheer-tabs.js importeert dit bestand.
// Bewuste uitzondering op de beheer.js-regel "servergegevens nooit via innerHTML": de renderers (beheer-performance-*.js, ringen en
// grafieken) leveren HTML-strings waarin ALLE tekst uit data door escHtml gaat (RF4). Die strings komen enkel in één eigen wortel
// <div class="dash"> binnen het paneel; vóór elke schrijfactie wordt gecontroleerd dat het paneel nog in de pagina hangt
// (een nieuwe tab-klik vervangt het paneel terwijl een oude fetch nog loopt).
import { registreerBeheerTab, beheerVerzoek, beheerFoutTekst, h } from './beheer.js';
import { bewaarMetVersie } from '../kern/api.js';
import { registreerActies, registreerWijzigActies, toast } from '../kern/ui.js';
import { STANDAARD_GRENZEN } from '../kern/dashboard-grenzen.js';
import { openRapportOpId } from '../rapport-archief.js';
import { TEGELS, periodeVoorPreset, maakQuery, tegelHtml, filterRijHtml, dekkingVoetnoten } from './beheer-performance-logica.js';
import { grenzenPaneelHtml, leesGrenzenUitRijen, voegGrenzenSamen } from './beheer-performance-grenzen.js';
import { renderTijd } from './beheer-performance-tijd.js';
import { renderKwaliteit } from './beheer-performance-kwaliteit.js';
import { renderOnderdelen } from './beheer-performance-onderdelen.js';
import { renderKlant } from './beheer-performance-klant.js';
import { renderSales } from './beheer-performance-sales.js';

const CSS_PAD = '/css/dashboard.css';
const CSS_WACHT_MS = 3000;
const BLOKKEN = [renderTijd, renderKwaliteit, renderOnderdelen, renderKlant, renderSales]; // vaste volgorde
const lees = x => (x && typeof x === 'object' ? x : {});

// dashboard.css hoort niet bij de schil: één <link> bij het eerste openen, en wachten (max. 3 s) vóór de eerste render.
function laadCss() {
  if (document.querySelector(`link[href$="${CSS_PAD}"]`)) return Promise.resolve();
  return new Promise((klaar) => {
    const link = h('link', { rel: 'stylesheet', href: CSS_PAD });
    const stop = setTimeout(klaar, CSS_WACHT_MS);
    link.addEventListener('load', () => { clearTimeout(stop); klaar(); });
    link.addEventListener('error', () => { clearTimeout(stop); klaar(); });
    document.head.append(link);
  });
}

function startFilters() {
  const preset = 'deze-maand';
  return { preset, ...periodeVoorPreset(preset, new Date()), technieker: '', type: '', herhaalDagen: 30 };
}

// Een mislukking is nooit een uitlog: 401 start al de herlogin (kern/brug.js), 503 toont al de opslagmelding.
function foutTekstVoor(r) {
  if (r.status === 401) return 'Je sessie is verlopen. Meld je opnieuw aan om het dashboard te zien.';
  if (r.status === 403) return 'Alleen een beheerder heeft toegang tot het dashboard.';
  return beheerFoutTekst(r);
}

async function render(container) {
  await laadCss();
  const wortel = h('div', { class: 'dash' });
  const filterVak = h('div', { class: 'dash-filters' });
  const melding = h('div', { class: 'dash-meldingen', role: 'status' });
  const inhoud = h('div', { class: 'dash-inhoud' });
  const paneelVak = h('details', { class: 'dash-instellingen' },
    h('summary', { text: 'Instellingen: kleurgrenzen van de ringen' }), h('div', { class: 'dash-instellingen-inhoud' }));
  wortel.append(filterVak, melding, inhoud, paneelVak);
  container.replaceChildren(wortel);
  const levend = () => container.isConnected && wortel.isConnected;

  const t = { filters: startFilters(), data: null, grenzen: STANDAARD_GRENZEN, grenzenBasis: STANDAARD_GRENZEN, versie: null, volgnummer: 0 };

  // ── Tekenen ──
  // De filterrij wordt na elke keuze opnieuw getekend (opties wijzigen mee); de focus keert terug naar hetzelfde veld.
  function tekenFilters() {
    const actief = document.activeElement;
    const sleutel = filterVak.contains(actief) ? { actie: actief.dataset.actie, wijzig: actief.dataset.wijzig, arg: actief.dataset.arg } : null;
    filterVak.innerHTML = filterRijHtml({ filters: t.filters, opties: lees(t.data?.opties) });
    if (!sleutel) return;
    const sel = sleutel.actie ? `[data-actie="${sleutel.actie}"]` : sleutel.wijzig ? `[data-wijzig="${sleutel.wijzig}"]` : null;
    if (sel) filterVak.querySelector(`${sel}[data-arg="${sleutel.arg}"]`)?.focus();
  }

  function tekenInhoud() {
    const d = t.data;
    if (!d) return;
    const ctx = { grenzen: t.grenzen, techniekers: lees(d.opties).techniekers, filters: t.filters };
    const kern = lees(d.kern);
    const tegels = `<div class="tegels">${TEGELS.map(x => tegelHtml(x, kern.huidig, kern.vorige, t.grenzen)).join('')}</div>`;
    const blokken = BLOKKEN.map((fn) => {
      try { return fn(d, ctx); } catch (fout) {
        console.error('Dashboardblok mislukt:', fn.name, fout);
        return '<p class="dash-melding dash-melding--fout">Dit onderdeel kon niet getoond worden.</p>';
      }
    }).join('');
    const dekking = { ...lees(d.dekking), klant: { ...lees(lees(d.dekking).klant) } };
    if (lees(d.bronnen).activiteitAfgekapt === true) dekking.klant.activiteitAfgekapt = true;
    const noten = dekkingVoetnoten(dekking);
    const voet = noten.length ? `<ul class="dash-voetnoten" aria-label="Dekking en beperkingen">${noten.map(n => `<li>${n}</li>`).join('')}</ul>` : '';
    inhoud.innerHTML = `${tegels}${blokken}${voet}`;
  }

  function tekenPaneel() {
    paneelVak.lastElementChild.innerHTML = grenzenPaneelHtml(t.grenzen, { uitgeschakeld: t.versie === null });
  }

  function toonMelding(tekst, { fout = false, herlaad = false } = {}) {
    melding.replaceChildren();
    if (!tekst) return;
    const p = h('p', { class: `dash-melding${fout ? ' dash-melding--fout' : ''}`, role: fout ? 'alert' : null, text: tekst });
    if (herlaad) p.append(h('button', { type: 'button', class: 'btn btn--secondary btn--sm dash-knop', 'data-actie': 'dashboard-herlaad', text: 'Opnieuw proberen' }));
    melding.append(p);
  }

  // ── Laden ──
  async function laadDashboard() {
    const mijn = ++t.volgnummer;
    inhoud.setAttribute('aria-busy', 'true'); // de vorige render blijft staan, op opaciteit 0,6 (geen skeleton)
    const r = await beheerVerzoek(`/api/dashboard${maakQuery(t.filters)}`);
    if (mijn !== t.volgnummer || !levend()) return; // een nieuwere keuze is onderweg
    inhoud.removeAttribute('aria-busy');
    if (!r.ok || !r.data || typeof r.data !== 'object') {
      t.data = null; // geen cijfers bij 401/403/503
      inhoud.replaceChildren();
      toonMelding(foutTekstVoor(r), { fout: true, herlaad: r.status !== 401 && r.status !== 403 });
      tekenFilters();
      return;
    }
    toonMelding('');
    t.data = r.data;
    tekenFilters();
    tekenInhoud();
  }

  async function laadGrenzen() {
    const r = await beheerVerzoek('/api/dashboard-instellingen');
    if (!levend()) return;
    if (r.ok && r.data?.grenzen && Number.isInteger(r.data.versie)) {
      t.grenzen = r.data.grenzen; t.grenzenBasis = r.data.grenzen; t.versie = r.data.versie;
    } else {
      t.grenzen = STANDAARD_GRENZEN; t.grenzenBasis = STANDAARD_GRENZEN; t.versie = null; // standaardkleuren, bewaren uitgeschakeld
    }
    tekenPaneel();
    if (t.data) tekenInhoud();
  }

  // ── Acties (delegatie op de eigen wortel; app.js doet de zijne op document.body) ──
  registreerActies(wortel, {
    'dashboard-preset': (el, e, preset) => {
      t.filters = preset === 'zelf'
        ? { ...t.filters, preset: 'zelf' }
        : { ...t.filters, preset, ...periodeVoorPreset(preset, new Date()) };
      tekenFilters();
      laadDashboard();
    },
    'dashboard-herlaad': () => laadDashboard(),
    'dashboard-open-rapport': (el, e, id) => { if (id) openRapportOpId(id); },
    'dashboard-grenzen-standaard': () => { t.grenzen = STANDAARD_GRENZEN; tekenPaneel(); if (t.data) tekenInhoud(); },
    'dashboard-grenzen-bewaar': () => bewaarGrenzen(),
  });
  registreerWijzigActies(wortel, {
    'dashboard-filter': (el, e, veld) => {
      if (!veld) return;
      if (veld === 'van' || veld === 'tot') {
        t.filters = { ...t.filters, [veld]: el.value, preset: 'zelf' };
        if (!t.filters.van || !t.filters.tot || t.filters.van > t.filters.tot) { tekenFilters(); return; } // wacht op een geldige periode
      } else t.filters = { ...t.filters, [veld]: veld === 'herhaalDagen' ? Number(el.value) : el.value };
      tekenFilters();
      laadDashboard();
    },
  });

  let bezig = false;
  async function bewaarGrenzen() {
    if (bezig || t.versie === null) return;
    const rijen = [...paneelVak.querySelectorAll('tr[data-ring]')].map(tr => ({
      sleutel: tr.dataset.ring, groen: tr.querySelector('[data-veld="groen"]').value, oranje: tr.querySelector('[data-veld="oranje"]').value,
      richting: tr.querySelector('[data-veld="richting"]').value,
    }));
    const gelezen = leesGrenzenUitRijen(rijen);
    if (!gelezen.ok) { toast(`⚠ ${gelezen.fout}`); return; }
    bezig = true;
    paneelVak.querySelector('[data-actie="dashboard-grenzen-bewaar"]')?.setAttribute('disabled', '');
    const basis = t.grenzenBasis;
    const r = await bewaarMetVersie({
      pad: '/api/dashboard-instellingen', veld: 'grenzen', versie: t.versie, waarde: gelezen.waarde,
      voegSamen: (server, eigen) => voegGrenzenSamen(server, eigen, basis),
    });
    bezig = false;
    if (r.ok) {
      toast(r.samengevoegd ? 'Grenzen bewaard (samengevoegd met een wijziging van iemand anders)' : 'Grenzen bewaard');
      if (!levend()) return;
      t.grenzen = r.waarde; t.grenzenBasis = r.waarde; t.versie = r.versie;
    } else {
      if (r.reden === 'conflict') toast('⚠ Iemand anders wijzigde de grenzen. De nieuwste stand is geladen; pas aan en bewaar opnieuw.');
      else if (r.reden === 'netwerk') toast('⚠ Geen verbinding met de server. Probeer het opnieuw.');
      else if (r.status === 503) toast('⚠ De opslag is tijdelijk niet bereikbaar. Probeer het later opnieuw.');
      else if (r.status === 400) toast('⚠ De server weigerde deze grenzen. Controleer de waarden.');
      else if (r.status === 401 || r.status === 403) toast('⚠ Bewaren mislukt: geen toegang.');
      else toast('⚠ Bewaren mislukt. Probeer het opnieuw.');
      if (!levend()) return;
      if (r.reden === 'conflict' && r.laatsteServer) { t.grenzen = r.laatsteServer; t.grenzenBasis = r.laatsteServer; t.versie = r.laatsteVersie ?? r.versie; }
    }
    tekenPaneel();
    if (t.data) tekenInhoud();
  }

  tekenFilters();
  tekenPaneel();
  await Promise.all([laadDashboard(), laadGrenzen()]);
}

registreerBeheerTab({ id: 'performance', label: 'Performance', render });
