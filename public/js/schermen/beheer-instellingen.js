// schermen/beheer-instellingen.js — beheertab Instellingen (logins T18): de beheerder kiest een gebruiker en past diens
// instellingen aan (startlocatie, duur, max per dag, werkuren, laatste start, max reistijd, tijdslot, werkdagen en voor sales de bezoekduur).
// API: GET /api/gebruikers (de keuzelijst), GET /api/instellingen?gebruiker=<id> en PUT /api/instellingen { gebruiker, instellingen }.
// De regels komen uit het bestaande instellingenscherm (valideerInstellingen) en kern/instellingen-regels.js (bezoekduur): geen kopie.
// De server vervangt de hele instellingen van één gebruiker; daarom leest dit scherm vlak vóór het opslaan de actuele set opnieuw
// en legt de formuliervelden daarbovenop: de velden die het zelf niet toont (routekleur, kaartstijl, drukte-kleuring) blijven zoals
// ze op dat moment op de server staan. Bij de EIGEN gebruiker volgt daarna de lokale kopie (kern/instellingen-sync.js neemEigenOver)
// en de actieve instellingen in toestand, zodat het gewone Instellingen-scherm de nieuwe waarden niet terugdraait.
// Veiligheid: servergegevens (namen) komen via textContent/attributen in de DOM (h() uit beheer.js), nooit via innerHTML.
import { registreerBeheerTab, beheerVerzoek, beheerFoutTekst, h } from './beheer.js';
import { toast } from '../kern/ui.js';
import { toestand } from '../kern/toestand.js';
import { huidigeGebruiker } from '../kern/sessie.js';
import { neemEigenOver, neemPersoonOver } from '../kern/instellingen-sync.js';
import { valideerVelden } from '../kern/instellingen-regels.js';
import { DEFAULT_SETTINGS, DAGEN, loadPersonSettings } from './instellingen.js';
import { valideerInstellingen } from './instellingen-logica.js';
import { sorteerGebruikers, rolLabel } from './beheer-gebruikers-logica.js';

const STANDAARD_BEZOEKDUUR = 60; // enkel als placeholder: pas bewaard als de beheerder een waarde invult
const TIJDELIJK = 'Instellingen laden is niet gelukt.';
// Weekdagen in de volgorde van het instellingenscherm (0 = zondag).
const DAG_VOLGORDE = [1, 2, 3, 4, 5, 6, 0];

function veld(label, invoer, id) {
  return h('div', { class: 'set-field' }, h('label', { class: 'set-label', for: id, text: label }), invoer);
}

async function render(container) {
  const lijst = await beheerVerzoek('/api/gebruikers');
  if (!lijst.ok) {
    container.replaceChildren(h('p', { class: 'beheer-fout', role: 'alert', text: beheerFoutTekst(lijst) }));
    return;
  }
  const gebruikers = sorteerGebruikers(lijst.data?.gebruikers);
  if (gebruikers.length === 0) {
    container.replaceChildren(h('p', { class: 'bg-uitleg', text: 'Er zijn nog geen gebruikers.' }));
    return;
  }

  const kies = h('select', { class: 'set-input', id: 'bi-gebruiker' },
    gebruikers.map(g => h('option', { value: g.id, text: `${g.naam} (${rolLabel(g.rol)})${g.actief === false ? ' — geblokkeerd' : ''}` })));
  const eigenId = huidigeGebruiker()?.id;
  if (gebruikers.some(g => g.id === eigenId)) kies.value = eigenId; // begin bij de eigen instellingen
  const start = h('input', { class: 'set-input', id: 'bi-start', type: 'text', autocomplete: 'off', placeholder: 'bv. Heirbaan 9, 9150 Kruibeke' });
  const duur = h('input', { class: 'set-input', id: 'bi-duur', type: 'number', min: '15', max: '480', step: '15' });
  const max = h('input', { class: 'set-input', id: 'bi-max', type: 'number', min: '1', max: '20' });
  const reistijd = h('input', { class: 'set-input', id: 'bi-reistijd', type: 'number', min: '0', max: '240', step: '5' });
  const laatste = h('input', { class: 'set-input', id: 'bi-laatste', type: 'time' });
  const van = h('input', { class: 'set-input', id: 'bi-van', type: 'time' });
  const tot = h('input', { class: 'set-input', id: 'bi-tot', type: 'time', 'aria-label': 'Werkuren tot' });
  const tijdslot = h('input', { class: 'set-input', id: 'bi-tijdslot', type: 'number', min: '60', max: '360', step: '30' });
  const bezoek = h('input', { class: 'set-input', id: 'bi-bezoek', type: 'number', min: '5', max: '480', step: '5', placeholder: `Standaard ${STANDAARD_BEZOEKDUUR}` });
  const bezoekVeld = veld('Bezoekduur (minuten)', bezoek, 'bi-bezoek');
  const dagenGroep = h('div', { class: 'days-grid', id: 'bi-dagen', role: 'group', 'aria-labelledby': 'bi-dagen-label' });
  const fout = h('p', { class: 'bg-fout', role: 'alert' });
  const status = h('p', { class: 'bg-status', role: 'status' });
  const opslaan = h('button', { type: 'submit', class: 'btn btn--primary', text: 'Opslaan' });

  let huidig = null; // { id, naam, rol, bewaard } van de geladen gebruiker; null zolang er niets geladen is
  let werkdagen = [];
  let volgnummer = 0;
  let bezig = false;

  function tekenDagen() {
    dagenGroep.replaceChildren(...DAG_VOLGORDE.map((i) => {
      const aan = werkdagen.includes(i);
      return h('button', {
        type: 'button', class: `day-btn${aan ? ' on' : ''}`, 'aria-pressed': aan ? 'true' : 'false', text: DAGEN[i],
        onclick: () => {
          werkdagen = werkdagen.includes(i) ? werkdagen.filter(d => d !== i) : [...werkdagen, i];
          tekenDagen();
          dagenGroep.querySelectorAll('.day-btn')[DAG_VOLGORDE.indexOf(i)]?.focus();
        },
      });
    }));
  }

  function vul(gebruiker, bewaard) {
    huidig = { id: gebruiker.id, naam: gebruiker.naam, rol: gebruiker.rol, zohoNaam: gebruiker.zohoNaam, bewaard };
    const s = { ...DEFAULT_SETTINGS, ...(bewaard ?? {}) };
    start.value = s.startlocatie || DEFAULT_SETTINGS.startlocatie;
    duur.value = String(s.duurMinuten);
    max.value = String(s.maxPerDag);
    reistijd.value = String(s.maxReistijdMin);
    laatste.value = s.laatsteStart;
    van.value = s.vanTijd;
    tot.value = s.totTijd;
    tijdslot.value = String(s.tijdslotMinuten);
    werkdagen = Array.isArray(s.werkdagen) ? [...s.werkdagen] : [...DEFAULT_SETTINGS.werkdagen];
    bezoek.value = bewaard?.bezoekDuurMin === undefined ? '' : String(bewaard.bezoekDuurMin);
    bezoekVeld.hidden = gebruiker.rol !== 'sales';
    tekenDagen();
    fout.textContent = '';
    status.textContent = '';
  }

  async function laad() {
    const g = gebruikers.find(x => x.id === kies.value);
    if (!g) return;
    const mijn = ++volgnummer;
    huidig = null;
    opslaan.disabled = true;
    fout.textContent = '';
    status.textContent = 'Laden…';
    const r = await beheerVerzoek(`/api/instellingen?gebruiker=${encodeURIComponent(g.id)}`);
    if (mijn !== volgnummer) return; // intussen een andere gebruiker gekozen
    if (!r.ok) {
      status.textContent = '';
      fout.textContent = `${TIJDELIJK} ${beheerFoutTekst(r)}`;
      return;
    }
    vul(g, r.data?.instellingen && typeof r.data.instellingen === 'object' ? r.data.instellingen : null);
    opslaan.disabled = false;
  }

  // Bewaarde de beheerder zijn EIGEN instellingen: lokale kopie en actieve instellingen volgen de server (zie kopregel).
  function volgEigenOp(doel, instellingen) {
    const ik = huidigeGebruiker();
    if (ik && doel.id !== ik.id && doel.rol === 'technieker' && typeof doel.zohoNaam === 'string' && doel.zohoNaam) {
      // Een technieker: zijn lokale kopie (waaruit het ⚙-venster leest) volgt de server (UI/UX P1-3: één plek om te bewerken).
      try {
        neemPersoonOver(doel.zohoNaam, instellingen);
        if (toestand.get('activeAssigneeFilter') === doel.zohoNaam) toestand.set('settings', loadPersonSettings(doel.zohoNaam));
      } catch { /* geen opslag: de volgende synchronisatie haalt de serverwaarde op */ }
      return;
    }
    if (!ik || doel.id !== ik.id) return;
    try {
      const persoon = neemEigenOver(instellingen, ik);
      if (toestand.get('activeAssigneeFilter') === persoon) toestand.set('settings', loadPersonSettings(persoon));
    } catch { /* geen opslag: de server heeft de waarde, de volgende synchronisatie haalt ze op */ }
  }

  async function bewaar(e) {
    e.preventDefault();
    if (bezig || !huidig) return;
    fout.textContent = '';
    const dagen = [...werkdagen].sort((a, b) => a - b);
    const v = valideerInstellingen({
      startlocatie: start.value, duur: +duur.value, max: +max.value, van: van.value, tot: tot.value, laatsteStart: laatste.value,
      maxReistijd: +reistijd.value, tijdslotMinuten: +tijdslot.value, tijdslotTekst: tijdslot.value,
      routeKleur: DEFAULT_SETTINGS.routeKleur, werkdagen: dagen,
    }, DEFAULT_SETTINGS);
    if (v.fout) { fout.textContent = v.fout; return; }
    // De routekleur komt niet van dit formulier (valideerInstellingen vult ze met de standaard): niet meesturen.
    const { routeKleur: _standaardKleur, ...formulier } = v.waarden;
    let bezoekWaarde;
    if (huidig.rol === 'sales' && bezoek.value.trim() !== '') {
      const b = valideerVelden({ bezoekDuurMin: Number(bezoek.value) });
      if (b.fout) { fout.textContent = b.fout; return; }
      bezoekWaarde = b.waarden.bezoekDuurMin;
    }
    const doel = huidig;
    bezig = true;
    opslaan.disabled = true;
    status.textContent = 'Opslaan…';
    // Actuele stand lezen vlak vóór het schrijven (beperkt verloren updates van de velden die dit scherm niet toont).
    const vers = await beheerVerzoek(`/api/instellingen?gebruiker=${encodeURIComponent(doel.id)}`);
    let r = vers;
    let instellingen = null;
    if (vers.ok) {
      const actueel = vers.data?.instellingen && typeof vers.data.instellingen === 'object' ? vers.data.instellingen : {};
      instellingen = { ...actueel, ...formulier, werkdagen: dagen };
      if (doel.rol === 'sales') {
        if (bezoekWaarde === undefined) delete instellingen.bezoekDuurMin; else instellingen.bezoekDuurMin = bezoekWaarde;
      }
      r = await beheerVerzoek('/api/instellingen', { methode: 'PUT', body: { gebruiker: doel.id, instellingen } });
    }
    bezig = false;
    status.textContent = '';
    if (huidig === doel) opslaan.disabled = false;
    if (!r.ok) { fout.textContent = beheerFoutTekst(r); return; }
    if (huidig === doel) huidig.bewaard = instellingen;
    volgEigenOp(doel, instellingen);
    status.textContent = `Opgeslagen voor ${doel.naam}.`;
    toast(`✓ Instellingen opgeslagen voor ${doel.naam}`);
  }

  kies.addEventListener('change', laad);
  const form = h('form', { class: 'bi-form', novalidate: true, onsubmit: bewaar },
    veld('Startlocatie', start, 'bi-start'),
    veld('Tijd per interventie (minuten)', duur, 'bi-duur'),
    veld('Max interventies per dag', max, 'bi-max'),
    veld('Max. reistijd tussen interventies (minuten)', reistijd, 'bi-reistijd'),
    veld('Laatste start (voor de planning die deze gebruiker zelf maakt)', laatste, 'bi-laatste'),
    h('div', { class: 'set-field' }, h('label', { class: 'set-label', for: 'bi-van', text: 'Werkuren' }),
      h('div', { class: 'set-row' }, van, h('span', { class: 'bi-tot', text: 'tot' }), tot)),
    veld('Tijdslot-grootte voor klant/technieker (minuten)', tijdslot, 'bi-tijdslot'),
    bezoekVeld,
    h('div', { class: 'set-field' }, h('div', { class: 'set-label', id: 'bi-dagen-label', text: 'Werkdagen' }), dagenGroep),
    fout, status,
    h('div', { class: 'bi-acties' }, opslaan));

  container.replaceChildren(
    h('div', { class: 'bi' },
      h('div', { class: 'bg-kop' }, h('h3', { class: 'bg-titel', text: 'Instellingen per gebruiker' })),
      h('p', { class: 'bg-uitleg', text: 'Kies een gebruiker en pas diens instellingen aan. Een wijziging geldt zodra die gebruiker de app opnieuw opent.' }),
      veld('Gebruiker', kies, 'bi-gebruiker'),
      form));
  await laad();
}

registreerBeheerTab({ id: 'instellingen', label: 'Instellingen', render });
