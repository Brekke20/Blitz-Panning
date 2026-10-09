// schermen/instellingen.js — instellingen, tab "Dit toestel" en de knoppen van het prijsbeheer (etappe 5b).
// De code is letterlijk uit index.html verhuisd (D12: ook de opslag in localStorage). Enkel de voorvoegsels zijn nieuw:
// `afh.` voor app.js, `toestand.get` voor `settings` en de actieve technieker (telkens op het moment van
// gebruik gelezen) en imports. `saveSettings` muteert `settings` in-place en roept renderTickets()/renderKalender() zelf aan
// (geen abonnement op `settings`): dat blijft zo. De weekdagknoppen werken op een concept (`_werkdagenConcept`, B12):
// pas Opslaan schrijft het naar `settings.werkdagen`. De pure validatie staat in instellingen-logica.js.
// Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe. De knoppen en de toestelkeuzes lopen
// via data-actie/data-wijzig-delegatie; beide overlays sluiten via registreerBackdrop (inhoudsklik sluit niet). De sluitknop
// van het prijsbeheer vraagt zelf een bevestiging bij onopgeslagen wijzigingen (prijzen.js); dat blijft zo.
import { toestand } from '../kern/toestand.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { toast, zetPressed, registreerActies, registreerWijzigActies, registreerBackdrop, strengeAfh } from '../kern/ui.js';
import { registreerVenster } from '../venster.js';
import { appConfirm } from '../app-dialog.js';
import { renderBeschikbaarhedenTab } from './beschikbaarheid.js';
import { valideerInstellingen, settingsKey } from './instellingen-logica.js';
import { huidigeGebruiker, huidigeRechten, magPlannenVoor } from '../kern/sessie.js';
import { bewaarOpServer } from '../kern/instellingen-sync.js';

// Afhankelijkheden uit app.js en prijzen.js (ingevuld door initInstellingen); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('instellingen: initInstellingen() is niet aangeroepen'); } });

export function initInstellingen(afhankelijkheden) {
  afh = strengeAfh('instellingen', afhankelijkheden);
  registreerActies(document.body, {
    'set-sluit':         () => closeSettings(),
    'set-tab':           (el) => setSettingsTab(el.dataset.arg),
    'set-reset-testdata': () => resetTestdata(),
    'set-prijsbeheer':   () => afh.openPrijsBeheer(),
    'set-opslaan':       () => saveSettings(),
    'set-naar-beheer':   () => naarBeheerInstellingen(),
    'prijs-sluit':       () => afh.closePrijsBeheer(),
    'prijs-reset':       () => afh.prijsReset(),
    'prijs-opslaan':     () => afh.prijsOpslaan(),
  });
  registreerWijzigActies(document.body, {
    'set-toestel-weergave': (el) => kiesToestelWeergave(el.dataset.arg),
  });
  const setOverlay = document.getElementById('set-overlay');
  registreerBackdrop(setOverlay, closeSettings);
  registreerVenster({ el: setOverlay, sluit: () => closeSettings() });
  const prijsOverlay = document.getElementById('prijs-overlay');
  registreerBackdrop(prijsOverlay, (e) => afh.closePrijsBeheer(e));
  registreerVenster({ el: prijsOverlay, sluit: () => afh.closePrijsBeheer() });
  // De rol/indeling op het toestel verandert: de toesteltab ververst zich (en een technieker blijft op "Dit toestel").
  window.addEventListener('apparaatwijziging', () => {
    if (!document.getElementById('set-overlay').classList.contains('open')) return;
    if (beperktToestel() && _settingsActiveTab !== 'toestel') setSettingsTab('toestel');
    else vulToestelTab();
  });
}

export const DEFAULT_SETTINGS = {
  startlocatie:   'Heirbaan 9, 9150 Kruibeke',
  duurMinuten:    120,
  maxPerDag:      4,
  vanTijd:        '08:00',
  totTijd:        '17:00',
  laatsteStart:   '16:00', // laatste aankomsttijd die de planner mag kiezen
  werkdagen:      [1,2,3,4,5],
  maxReistijdMin: 45,
  tijdslotMinuten: 180, // 3 uur — configureerbaar tijdvak i.p.v. exact tijdstip (Blok 1C)
  kaartStijl:     'standaard',
  routeKleur:     '#f59e0b',
  drukteKleuring: true,
};

// R8: "Laatste start" is één instelling voor iedereen — eigen sleutel, los van de gekozen technieker.
// Eerder per persoon opgeslagen waarden worden genegeerd.
const LAATSTE_START_KEY = 'blitz_laatste_start';
export function leesLaatsteStart() {
  let v = null;
  try { v = localStorage.getItem(LAATSTE_START_KEY); } catch { /* opslag niet beschikbaar */ }
  return /^\d{2}:\d{2}$/.test(v || '') ? v : DEFAULT_SETTINGS.laatsteStart;
}
function bewaarLaatsteStart(v) {
  try { localStorage.setItem(LAATSTE_START_KEY, v); } catch { /* quota vol — best-effort */ }
}
export function loadPersonSettings(person) {
  const saved = JSON.parse(localStorage.getItem(settingsKey(person)) || '{}');
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    laatsteStart: leesLaatsteStart(),
    // Lege strings mogen de default niet overschrijven
    startlocatie: saved.startlocatie || DEFAULT_SETTINGS.startlocatie,
    // Eigen array-kopie — anders deelt elke technieker zonder opgeslagen werkdagen
    // hetzelfde array-object, en muteert openSettings() dat in-place.
    werkdagen: [...(saved.werkdagen || DEFAULT_SETTINGS.werkdagen)],
  };
}
// Lokaal (de snelle cache, loadPersonSettings blijft synchroon) EN op de server (logins T16, fire-and-forget). Een echte 403 meldt
// een toast; een netwerkfout niet: de vuil-markering (kern/instellingen-sync.js) laadt de lokale waarde bij de volgende start op.
export function savePersonSettings(person) {
  const settings = toestand.get('settings');
  localStorage.setItem(settingsKey(person), JSON.stringify(settings));
  const gebruiker = huidigeGebruiker();
  if (!gebruiker) return; // geen sessie (kan niet na de login): enkel lokaal
  bewaarOpServer(person, settings, gebruiker).then((r) => {
    if (r.ok) return;
    if (r.reden === 'geen-recht') toast('Je mag de instellingen van deze persoon niet wijzigen; lokaal bewaard.', 4000);
    else if (r.reden === 'ongeldig') toast('De instellingen zijn niet geldig en werden enkel lokaal bewaard.', 4000);
  }).catch(() => { /* bewaarOpServer gooit niet; vangnet */ });
}

export const DAGEN = ['Zo','Ma','Di','Wo','Do','Vr','Za'];

let _settingsActiveTab = 'algemeen';


const SOORT_LABEL = { gsm: 'Gsm', tablet: 'Tablet', computer: 'Computer' };
// Testmodus: kopie van de echte gegevens opnieuw maken (testwijzigingen gaan verloren)
async function resetTestdata() {
  if (!TEST_MODE) return;
  const ok = await appConfirm({
    titel: 'Testgegevens opnieuw kopiëren?',
    tekst: 'Alle testwijzigingen gaan verloren. De echte gegevens worden niet aangeraakt.',
    bevestigLabel: 'Opnieuw kopiëren'
  });
  if (!ok) return;
  const btn = document.getElementById('set-testdata-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/testdata', { method: 'POST' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('🧪 Testgegevens opnieuw gekopieerd', 2500);
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    if (btn) btn.disabled = false;
    toast('Testgegevens kopiëren mislukt — probeer opnieuw', 4000);
  }
}
function vulToestelTab() {
  const blok = document.getElementById('set-testdata-blok');
  if (blok) blok.style.display = TEST_MODE ? '' : 'none';
  const a = window.apparaat;
  if (!a) return;
  let tekst = `Herkend als: ${SOORT_LABEL[a.automatischeSoort] || a.automatischeSoort} · ${a.staand ? 'rechtop' : 'liggend'} · ${a.aanraak ? 'aanraakscherm' : 'muis/trackpad'}`;
  if (a.soort !== a.automatischeSoort) tekst += ` (handmatig: ${SOORT_LABEL[a.soort] || a.soort})`;
  const el = document.getElementById('set-toestel-status');
  if (el) el.textContent = tekst;
  let w = 'auto';
  try { const o = localStorage.getItem('blitz_weergave'); if (o === 'gsm' || o === 'tablet' || o === 'computer') w = o; } catch {}
  document.querySelectorAll('input[name="set-weergave"]').forEach(r => { r.checked = r.value === w; });
}
// Direct bijwerken (naast de apparaatwijziging-listener): als de keuze de effectieve staat niet wijzigt
// komt er geen event en zou "(handmatig: X)" achterblijven. vulToestelTab is goedkoop en idempotent.
function kiesToestelWeergave(w) { window.zetWeergave(w); vulToestelTab(); }

// De beperkte technieker-weergave toont enkel "Dit toestel"; een technieker met "Mag zelf plannen" stelt ook zijn eigen planning in (Algemeen).
const beperktToestel = () => window.apparaat?.rol === 'technieker' && !huidigeRechten().planEigen;

export function setSettingsTab(tab) {
  if (beperktToestel()) tab = 'toestel';
  else if (window.apparaat?.rol === 'technieker' && tab === 'beschikbaarheden') tab = 'algemeen';
  _settingsActiveTab = tab;
  document.getElementById('set-subtab-toestel').classList.toggle('active', tab === 'toestel');
  document.getElementById('set-tab-toestel').style.display = tab === 'toestel' ? '' : 'none';
  if (tab === 'toestel') vulToestelTab();
  document.getElementById('set-subtab-algemeen').classList.toggle('active', tab === 'algemeen');
  document.getElementById('set-subtab-beschikbaarheden').classList.toggle('active', tab === 'beschikbaarheden');
  document.getElementById('set-tab-algemeen').style.display = tab === 'algemeen' ? '' : 'none';
  document.getElementById('set-tab-beschikbaarheden').style.display = tab === 'beschikbaarheden' ? '' : 'none';
  document.getElementById('set-save-btn').style.display = tab === 'algemeen' ? '' : 'none';
  // Op de tabs zonder iets om op te slaan (toestel, beschikbaarheden) is "Annuleren" misleidend: dan enkel "Sluiten".
  const sluitKnop = document.getElementById('set-sluit-btn');
  if (sluitKnop) sluitKnop.textContent = tab === 'algemeen' ? 'Annuleren' : 'Sluiten';
  if (tab === 'beschikbaarheden') renderBeschikbaarhedenTab();
}

// B12: de weekdagknoppen werken op een concept; pas Opslaan schrijft het naar de instellingen (Annuleren/Esc/achtergrond laat ze ongemoeid).
let _werkdagenConcept = [];

// UI/UX-review P1-3: voor de beheerder is Beheer → Instellingen de ENIGE plek waar de werkinstellingen per persoon bewerkt worden.
// Hier blijven ze zichtbaar (alleen-lezen); de persoonlijke/toestelinstellingen (routekleur, drukte) blijven bewerkbaar.
// De planner heeft geen Beheer-tab en bewerkt de werkinstellingen van de technici dus nog hier (de server staat dat toe).
const WERK_VELDEN = ['set-start', 'set-duration', 'set-max', 'set-maxreistijd', 'set-laatste-start', 'set-van', 'set-tot', 'set-tijdslot'];
function werkInstellingenAlleenLezen() { return huidigeRechten().beheer === true; }
function zetWerkVeldenAlleenLezen(lezen) {
  for (const id of WERK_VELDEN) { const el = document.getElementById(id); if (el) el.disabled = lezen; }
  document.querySelectorAll('#days-grid .day-btn').forEach(b => { b.disabled = lezen; });
  const hint = document.getElementById('set-beheer-hint');
  if (hint) hint.hidden = !lezen;
}
function naarBeheerInstellingen() {
  closeSettings();
  try { sessionStorage.setItem('blitz_beheer_tab', 'instellingen'); } catch { /* geen opslag */ }
  document.getElementById('tab-beheer')?.click();
  document.getElementById('beheer-tab-instellingen')?.click(); // Beheer was al open: meteen naar het juiste tabblad
}

export function openSettings() {
  setSettingsTab(beperktToestel() ? 'toestel' : 'algemeen');
  const settings = toestand.get('settings'); // synchrone functie: geen await, dus de momentopname blijft geldig
  const activeAssigneeFilter = toestand.get('activeAssigneeFilter');
  const who = activeAssigneeFilter === 'all' ? 'Standaard (alle technici)' : activeAssigneeFilter;
  document.getElementById('set-person-label').textContent = `Instellingen voor: ${who}`;
  document.getElementById('set-start').value    = settings.startlocatie;
  document.getElementById('set-duration').value = settings.duurMinuten;
  document.getElementById('set-max').value      = settings.maxPerDag;
  document.getElementById('set-maxreistijd').value = settings.maxReistijdMin;
  document.getElementById('set-van').value      = settings.vanTijd;
  document.getElementById('set-tot').value      = settings.totTijd;
  document.getElementById('set-laatste-start').value = leesLaatsteStart(); // R8: zelfde waarde voor elke technieker
  document.getElementById('set-tijdslot').value = settings.tijdslotMinuten;
  document.getElementById('set-routekleur').value = settings.routeKleur || DEFAULT_SETTINGS.routeKleur;
  document.getElementById('set-routekleur-hex').textContent = (settings.routeKleur || DEFAULT_SETTINGS.routeKleur).toUpperCase();
  document.getElementById('set-drukte').checked   = settings.drukteKleuring !== false;
  _werkdagenConcept = [...settings.werkdagen];
  const grid = document.getElementById('days-grid');
  grid.innerHTML = '';
  DAGEN.forEach((dag, i) => {
    const btn = document.createElement('button');
    btn.className   = 'day-btn' + (_werkdagenConcept.includes(i) ? ' on' : '');
    btn.textContent = dag;
    btn.setAttribute('aria-pressed', _werkdagenConcept.includes(i) ? 'true' : 'false');
    btn.addEventListener('click', () => {
      const idx = _werkdagenConcept.indexOf(i);
      if (idx >= 0) _werkdagenConcept.splice(idx, 1); else _werkdagenConcept.push(i);
      btn.classList.toggle('on');
      zetPressed(btn, btn.classList.contains('on'));
    });
    grid.appendChild(btn);
  });
  zetWerkVeldenAlleenLezen(werkInstellingenAlleenLezen());
  document.getElementById('set-overlay').classList.add('open');
}

export function closeSettings(e) {
  if (e && e.target !== document.getElementById('set-overlay')) return;
  document.getElementById('set-overlay').classList.remove('open');
}

export function saveSettings() {
  // Een technieker met "Mag zelf plannen" bewaart enkel zijn eigen instellingen (de server weigert die van een collega ook).
  if (window.apparaat?.rol === 'technieker' && !magPlannenVoor(toestand.get('activeAssigneeFilter'))) {
    return toast('Je kan enkel je eigen instellingen wijzigen: kies jezelf in de kiezer bovenaan.', 4000);
  }
  const settings = toestand.get('settings'); // synchrone functie: geen await, dus de momentopname blijft geldig
  const resultaat = valideerInstellingen({
    startlocatie:    document.getElementById('set-start').value,
    duur:            +document.getElementById('set-duration').value,
    max:             +document.getElementById('set-max').value,
    van:             document.getElementById('set-van').value,
    tot:             document.getElementById('set-tot').value,
    laatsteStart:    document.getElementById('set-laatste-start').value,
    maxReistijd:     +document.getElementById('set-maxreistijd').value,
    tijdslotMinuten: +document.getElementById('set-tijdslot').value,
    tijdslotTekst:   document.getElementById('set-tijdslot').value,
    routeKleur:      document.getElementById('set-routekleur').value,
    werkdagen:       _werkdagenConcept,
  }, DEFAULT_SETTINGS);
  if (resultaat.fout) return toast(resultaat.fout, 3500);

  const w = resultaat.waarden;
  settings.startlocatie   = w.startlocatie;
  settings.duurMinuten    = w.duurMinuten;
  settings.maxPerDag      = w.maxPerDag;
  settings.vanTijd        = w.vanTijd;
  settings.totTijd        = w.totTijd;
  settings.werkdagen      = [..._werkdagenConcept];
  settings.laatsteStart   = w.laatsteStart;
  bewaarLaatsteStart(settings.laatsteStart); // R8: één waarde voor iedereen
  settings.maxReistijdMin = w.maxReistijdMin;
  settings.tijdslotMinuten = w.tijdslotMinuten;
  settings.routeKleur    = w.routeKleur;
  settings.drukteKleuring = document.getElementById('set-drukte').checked;
  const activeAssigneeFilter = toestand.get('activeAssigneeFilter');
  savePersonSettings(activeAssigneeFilter);
  document.getElementById('set-overlay').classList.remove('open');
  afh.renderTickets();
  afh.renderKalender();
  // Kleur/drukte meteen zichtbaar wisselen als er al een berekende route staat
  afh.vernieuwKaart();
  toast('✓ Instellingen opgeslagen voor ' + (activeAssigneeFilter === 'all' ? 'alle technici' : activeAssigneeFilter.split(' ')[0]));
}
