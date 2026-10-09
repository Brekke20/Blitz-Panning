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
import { TEGELS, periodeVoorPreset, maakQuery, tegelHtml, filterRijHtml, dekkingVoetnoten, isGeldigeFilterDatum } from './beheer-performance-logica.js';
import { grenzenPaneelHtml, leesGrenzenUitRijen, voegGrenzenSamen, bewaarUitkomst } from './beheer-performance-grenzen.js';
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
  const bestaand = document.querySelector(`link[href$="${CSS_PAD}"]`);
  if (bestaand?.sheet) return Promise.resolve();
  return new Promise((klaar) => {
    const link = bestaand ?? h('link', { rel: 'stylesheet', href: CSS_PAD }); // een nog ladend <link> (snelle tweede klik): erop wachten
    const stop = setTimeout(klaar, CSS_WACHT_MS);
    link.addEventListener('load', () => { clearTimeout(stop); klaar(); });
    link.addEventListener('error', () => { clearTimeout(stop); klaar(); });
    if (!bestaand) document.head.append(link);
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

  const t = { filters: startFilters(), data: null, grenzen: STANDAARD_GRENZEN, grenzenBasis: STANDAARD_GRENZEN, versie: null, grenzenFout: false, volgnummer: 0 };

  // ── Tekenen ──
  // De filterrij wordt na elke keuze opnieuw getekend (opties wijzigen mee); de focus keert terug naar hetzelfde veld.
  function tekenFilters() {
    const actief = document.activeElement;
    const nieuw = h('div');
    nieuw.innerHTML = filterRijHtml({ filters: t.filters, opties: lees(t.data?.opties) });
    // Staat de focus in een datumveld, dan blijft dat veld staan (het hertekenen zou het dag-/maand-/jaarsegment waarin getypt wordt kwijtmaken).
    const datumActief = actief?.type === 'date' && filterVak.contains(actief) ? actief : null;
    if (datumActief) {
      const oud = filterVak.firstElementChild, wasNieuw = nieuw.firstElementChild;
      if (oud && wasNieuw && oud.children.length === wasNieuw.children.length) {
        [...oud.children].forEach((kind, i) => { if (!kind.contains(datumActief)) kind.replaceWith(wasNieuw.children[i].cloneNode(true)); });
        return;
      }
    }
    const sleutel = filterVak.contains(actief) ? { actie: actief.dataset.actie, wijzig: actief.dataset.wijzig, arg: actief.dataset.arg } : null;
    filterVak.replaceChildren(...nieuw.childNodes);
    if (!sleutel) return;
    const sel = sleutel.actie ? `[data-actie="${sleutel.actie}"]` : sleutel.wijzig ? `[data-wijzig="${sleutel.wijzig}"]` : null;
    if (sel) filterVak.querySelector(`${sel}[data-arg="${sleutel.arg}"]`)?.focus();
  }

  // Enkel de presetknoppen volgen de keuze (bij een ingetypte datum is dat "Zelf kiezen"); de datumvelden blijven onaangeroerd.
  function werkPresetsBij() {
    filterVak.querySelectorAll('[data-actie="dashboard-preset"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.arg === t.filters.preset)));
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

  // grenzen: wat de velden tonen (standaard de bewaarde stand; "Standaard terugzetten" toont enkel de standaardwaarden, nog niet bewaard).
  function tekenPaneel(grenzen = t.grenzen) {
    paneelVak.lastElementChild.innerHTML = grenzenPaneelHtml(grenzen, { uitgeschakeld: t.versie === null, fout: t.grenzenFout });
    paneelVak.firstElementChild.textContent = t.grenzenFout ? 'Instellingen: kleurgrenzen van de ringen (niet geladen)' : 'Instellingen: kleurgrenzen van de ringen';
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
      t.grenzen = r.data.grenzen; t.grenzenBasis = r.data.grenzen; t.versie = r.data.versie; t.grenzenFout = false;
    } else {
      t.grenzen = STANDAARD_GRENZEN; t.grenzenBasis = STANDAARD_GRENZEN; t.versie = null; t.grenzenFout = true; // standaardkleuren, bewaren uitgeschakeld
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
    'dashboard-open-rapport': (el, e, id) => { if (id) openRapportOpId(id).catch(() => toast('⚠ Rapport openen mislukt')); },
    'dashboard-grenzen-standaard': () => tekenPaneel(STANDAARD_GRENZEN),
    'dashboard-grenzen-herlaad': () => laadGrenzen(),
    'dashboard-grenzen-bewaar': () => bewaarGrenzen(),
  });
  registreerWijzigActies(wortel, {
    'dashboard-filter': (el, e, veld) => {
      if (!veld) return;
      if (veld === 'van' || veld === 'tot') {
        // Een onvolledige of onzinnige datum (bv. 0002-10-01 tijdens het intypen) laat het filter ongemoeid: geen verzoek, geen hertekening.
        if (el.value === '') return; // onvolledig of leeggemaakt: tijdens het typen laten staan; bij het verlaten van het veld herstelt `focusout` de geldende datum
        if (!isGeldigeFilterDatum(el.value)) return;
        if (el.value === t.filters[veld] && t.data) return; // dezelfde datum (bv. tussentijds teruggetypt): niets veranderd, geen verzoek
        t.filters = { ...t.filters, [veld]: el.value, preset: 'zelf' };
        werkPresetsBij();
        if (!isGeldigeFilterDatum(t.filters.van) || !isGeldigeFilterDatum(t.filters.tot) || t.filters.van > t.filters.tot) { // wacht op een geldige periode
          t.volgnummer++; // een nog onderweg zijnd antwoord van de vorige periode mag niet meer getoond worden
          inhoud.removeAttribute('aria-busy');
          toonMelding('Kies een geldige periode: de begindatum mag niet na de einddatum liggen.');
          return;
        }
        toonMelding('');
        laadDashboard();
        return;
      } else t.filters = { ...t.filters, [veld]: veld === 'herhaalDagen' ? Number(el.value) : el.value };
      tekenFilters();
      laadDashboard();
    },
  });

  // Een leeggebleven datumveld toont weer de geldende datum zodra het de focus verliest (zo blijft het intypen ongemoeid en doet het veld nooit stil niets).
  wortel.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el?.matches?.('input[data-wijzig="dashboard-filter"][data-arg="van"], input[data-wijzig="dashboard-filter"][data-arg="tot"]') && el.value === '') {
      el.value = t.filters[el.dataset.arg] ?? '';
    }
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
    const u = bewaarUitkomst(r);
    toast(u.toast);
    if (!levend()) return;
    if (!u.herteken) { // mislukt: de ingetypte waarden blijven staan, enkel de knop is weer bruikbaar
      paneelVak.querySelector('[data-actie="dashboard-grenzen-bewaar"]')?.removeAttribute('disabled');
      return;
    }
    t.grenzen = u.grenzen; t.grenzenBasis = u.grenzen; t.versie = u.versie;
    tekenPaneel();
    if (t.data) tekenInhoud();
  }

  tekenFilters();
  tekenPaneel();
  await Promise.all([laadDashboard(), laadGrenzen()]);
}

registreerBeheerTab({ id: 'performance', label: 'Performance', render });
