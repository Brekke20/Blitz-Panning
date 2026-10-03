// schermen/klantbeschikbaarheid.js — klantbeschikbaarheid per ticket (etappe 5b): laden, bewaren, opruimen en de sectie in het detail.
// De code is letterlijk uit index.html verhuisd (D12: ook saveKlantBeschikbaarheid en saveKbAll, die naar de backend schrijven met
// 409-merge en één retry via kern.api.bewaarMetVersie). Enkel de voorvoegsels zijn nieuw: `afh.` voor app.js,
// `toestand.get/set` voor `klantBeschikbaarheid` en `settings`, en imports. `kbVersie` en `kbLocallyDeleted` zijn module-privé.
// De pure delen (409-samenvoeging, dirty-handtekening, GC-selectie) staan in klantbeschikbaarheid-logica.js.
// Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe. De sectie is geen venster en heeft
// geen HTML-string-handlers: de luisteraars van de dynamisch getekende velden blijven addEventListener.
import { toestand } from '../kern/toestand.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { toast, escHtml, strengeAfh } from '../kern/ui.js';
import { apiJson, bewaarMetVersie, leesFout } from '../kern/api.js';
import { renderTickets } from './wachtrij.js';
import { voegSamenKb, kbStand, verouderdeKbIds } from './klantbeschikbaarheid-logica.js';

// Afhankelijkheden uit app.js en andere schermen (ingevuld door initKlantbeschikbaarheid); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('klantbeschikbaarheid: initKlantbeschikbaarheid() is niet aangeroepen'); } });

export function initKlantbeschikbaarheid(afhankelijkheden) {
  afh = strengeAfh('klantbeschikbaarheid', afhankelijkheden);
}

// klantBeschikbaarheid: { [ticketId]: { voorkeur, voorkeurTijd, geblokkeerd, notitie, duurOverride?, bijgewerkt } }
let kbVersie = 0;
// Ticket-ID's die deze sessie lokaal volledig gewist zijn (alle kb-velden leeg) -- bijgehouden
// zodat een 409-merge in saveKlantBeschikbaarheid() zo'n verwijdering niet stil ongedaan maakt
// door de server-versie voor dat ticket terug over te nemen (bugronde 2026-09-22, item B).
let kbLocallyDeleted = new Set();
export function kbFor(id)         { return toestand.get('klantBeschikbaarheid')[id] || null; }
export function kbBlocked(id, d)  { return !!(kbFor(id)?.geblokkeerd?.includes(d)); }
export function kbPreferred(id)   { return kbFor(id)?.voorkeur || null; }
export function kbPreferredTime(id) { return kbFor(id)?.voorkeurTijd || null; }

// ══════════════════════════════════════════════
// KLANTBESCHIKBAARHEID — load / save / GC
// ══════════════════════════════════════════════
const KB_API = '/api/klantbeschikbaarheid';

// zonderCache: de bewaarde kopie niet toepassen (resync na een onzeker resultaat, N7).
export async function loadKlantBeschikbaarheid({ zonderCache = false } = {}) {
  if (!TEST_MODE && !zonderCache) {
    const cached = afh.loadFromCache('blitz_klantbeschikbaarheid_cache');
    if (cached) {
      toestand.set('klantBeschikbaarheid', cached.items || {});
      kbVersie             = cached.versie || 0;
    }
  }
  try {
    const data = await apiJson(KB_API);
    toestand.set('klantBeschikbaarheid', data.items  || {});
    kbVersie             = data.versie || 0;
    // Live lezen na de await: de toestand kan sinds de fetch gewijzigd zijn.
    if (!TEST_MODE) afh.saveToCache('blitz_klantbeschikbaarheid_cache', { items: toestand.get('klantBeschikbaarheid'), versie: kbVersie });
  } catch (err) {
    console.warn('Klantbeschikbaarheid laden mislukt:', err);
    // Bewuste gedragswijziging (Blok 1D): bij een fout NIET meer terugvallen naar een lege staat
    // als er al cache-data toegepast werd hierboven; enkel als er ook geen cache was, resetten we
    // (zelfde gedrag als pre-Blok-1D in dat specifieke geval).
    if (!zonderCache && (TEST_MODE || !afh.loadFromCache('blitz_klantbeschikbaarheid_cache'))) { // een mislukte resync wist de huidige stand niet
      toestand.set('klantBeschikbaarheid', {});
      kbVersie = 0;
    }
  }
  // De wachtrij toont de klantvoorkeur-labels; komt dit antwoord na de eerste ticketrender, dan zou ze die voor altijd missen
  // (geen abonnement op klantBeschikbaarheid, zie koppelRenders): één expliciete hertekening, enkel op dit laadpad. Bewust BUITEN de
  // try hierboven (M5): een renderfout hoort de geladen data niet te wissen.
  try { afh.renderTickets(); } catch (err) { console.warn('Hertekenen na klantbeschikbaarheid mislukt:', err); }
}

export async function saveKlantBeschikbaarheid() {
  try {
    // Bij 409: server-stand nemen en de lokale wijziging erover leggen (kern.api.bewaarMetVersie).
    const result = await bewaarMetVersie({
      pad: KB_API, veld: 'items', versie: kbVersie, waarde: toestand.get('klantBeschikbaarheid'),
      voegSamen: (server, lokaal) => {
        // Kopieer server-state, overschrijf enkel de gewijzigde tickets; een lokaal verwijderde entry mag niet
        // terugkomen uit de server-state, ook al staat hij daar nog (bugronde 2026-09-22, item B) -- de gebruiker
        // heeft 'm hier expliciet gewist.
        return voegSamenKb(server, lokaal, kbLocallyDeleted);
      },
    });
    // Na een 409 is `waarde` de samengevoegde stand en `versie` de laatst bekende serverversie (ook bij een
    // mislukte retry, zoals voorheen); bij een gewone geslaagde/mislukte PUT blijft de lokale stand staan.
    if (result.samengevoegd) toestand.set('klantBeschikbaarheid', result.waarde);
    kbVersie = result.versie;
    if (!result.ok) throw new Error(result.reden === 'netwerk' ? 'netwerk' : 'HTTP ' + result.status);
    // (M1) Pas nu leegmaken: bij een mislukte retry moeten de ids uitgesloten BLIJVEN tot een volgende
    // poging wél lukt (anders kan een tussentijdse GC/refresh de "verwijderde" entry weer laten
    // terugkomen uit een stale server-read). Bij een geslaagde PUT bevatte `klantBeschikbaarheid`
    // al geen entries meer voor die ids, dus de server-state komt overeen.
    kbLocallyDeleted.clear();
    return true;
  } catch (err) {
    console.error('Klantbeschikbaarheid opslaan mislukt:', err);
    toast('✕ Klantbeschikbaarheid opslaan mislukt', 3000);
    // W5-fix (N7): onzeker resultaat (bewaarMetVersie meldt een netwerkfout/time-out als 'netwerk'): ná de rollback van de oproeper de serverstand ophalen.
    if (err?.message === 'netwerk' || leesFout(err).onzeker) setTimeout(() => loadKlantBeschikbaarheid({ zonderCache: true }), 0);
    return false;
  }
}

// GC: verwijder entries van tickets die al >90 dagen geleden bijgewerkt zijn
// én niet meer in een levende set zitten
export function gcKlantBeschikbaarheid(liveIds) {
  const klantBeschikbaarheid = toestand.get('klantBeschikbaarheid'); // synchrone functie: geen await tussen lezen en gebruik
  const ids = verouderdeKbIds(klantBeschikbaarheid, liveIds);
  for (const id of ids) delete klantBeschikbaarheid[id];
  if (ids.length) saveKlantBeschikbaarheid();
}

// ══════════════════════════════════════════════
// KLANTBESCHIKBAARHEID — UI
// ══════════════════════════════════════════════
export function renderKbSection(ticketId) {
  const el = document.getElementById('kb-section');
  if (!el) return;
  const kb = kbFor(ticketId) || { voorkeur: null, voorkeurTijd: null, geblokkeerd: [], notitie: '' };
  // Lokaal concept: de velden werken enkel hierop; pas "✓ Opslaan" schrijft naar klantBeschikbaarheid.
  const draft = {
    voorkeur:     kb.voorkeur || '',
    voorkeurTijd: kb.voorkeurTijd || '',
    geblokkeerd:  [...(kb.geblokkeerd || [])],
    duur:         kb.duurOverride || toestand.get('settings').duurMinuten,
    notitie:      kb.notitie || '',
  };
  const stand = () => kbStand(draft, toestand.get('settings').duurMinuten);
  const saved = stand();
  const isDirty = () => stand() !== saved;
  afh.zetKbDirty(() => isDirty() || (/^\d{4}-\d{2}-\d{2}$/.test(el.querySelector(`#kb-blok-${ticketId}`)?.value || '')));

  el.innerHTML = `
    <div class="kb-section">
      <div class="kb-section-title">Klantbeschikbaarheid</div>

      <div class="kb-row">
        <span class="kb-label">Voorkeur</span>
        <div class="kb-fields">
          <input type="date" class="kb-input" id="kb-pref-${ticketId}" aria-label="Voorkeursdatum" value="${escHtml(draft.voorkeur)}">
          <input type="time" class="kb-input" id="kb-pref-tijd-${ticketId}" aria-label="Voorkeursuur" step="900" value="${escHtml(draft.voorkeurTijd)}">
          <button type="button" class="btn btn--ghost btn--sm kb-btn-voorkeur-del">Wissen</button>
        </div>
      </div>

      <div class="kb-row kb-row--col">
        <span class="kb-label">Klant kan NIET op</span>
        <div class="kb-fields">
          <span class="kb-chips"></span>
          <input type="date" class="kb-input" id="kb-blok-${ticketId}" aria-label="Datum waarop de klant niet kan">
          <button type="button" class="btn btn--secondary btn--sm kb-btn-addblok">+ Datum toevoegen</button>
        </div>
      </div>

      <div class="kb-row">
        <span class="kb-label">Verwachte duur</span>
        <div class="kb-fields">
          <input type="number" class="kb-input kb-input--duur" id="kb-duur-${ticketId}" aria-label="Verwachte duur in minuten" min="15" max="480" step="15" value="${escHtml(String(draft.duur))}">
          <span class="kb-unit">min</span>
          <button type="button" class="btn btn--ghost btn--sm kb-btn-duur-reset">Standaard</button>
        </div>
      </div>

      <div class="kb-row kb-row--col">
        <span class="kb-label">Notitie</span>
        <textarea class="kb-notitie" id="kb-notitie-${ticketId}" aria-label="Notitie" placeholder="bv. enkel na 14u, niet op vrijdag...">${escHtml(draft.notitie)}</textarea>
      </div>

      <div class="kb-save-row">
        <button type="button" class="btn btn--primary kb-btn-save" disabled>✓ Opslaan</button>
        <span class="kb-dirty-hint" hidden>Niet-opgeslagen wijzigingen</span>
      </div>
    </div>`;

  const q = (s) => el.querySelector(s);
  const chipsEl = q('.kb-chips'), saveBtn = q('.kb-btn-save'), hint = q('.kb-dirty-hint');
  const prefEl = q(`#kb-pref-${ticketId}`), tijdEl = q(`#kb-pref-tijd-${ticketId}`);
  const blokEl = q(`#kb-blok-${ticketId}`), duurEl = q(`#kb-duur-${ticketId}`), notEl = q(`#kb-notitie-${ticketId}`);

  const geldigeBlok = () => /^\d{4}-\d{2}-\d{2}$/.test(blokEl.value) && Number(blokEl.value.slice(0, 4)) >= 2000 ? blokEl.value : '';
  function sync() {
    const dirty = isDirty() || !!geldigeBlok();
    saveBtn.disabled = !dirty;
    hint.hidden = !dirty;
  }
  function tekenChips() {
    chipsEl.innerHTML = draft.geblokkeerd.map(d =>
      `<span class="kb-chip">🚫 ${escHtml(d)} <button type="button" class="kb-chip-del kb-btn-removeblok" data-datum="${escHtml(d)}" title="Verwijderen" aria-label="Verwijder ${escHtml(d)}">✕</button></span>`
    ).join(' ');
    // ticketId komt uit de kennisbank-blob (niet-geauthenticeerd) — niet inline; de datum staat in een data-attribuut.
    chipsEl.querySelectorAll('.kb-btn-removeblok').forEach(btn => {
      btn.addEventListener('click', () => {
        draft.geblokkeerd = draft.geblokkeerd.filter(d => d !== btn.dataset.datum);
        tekenChips(); sync();
      });
    });
  }
  tekenChips();
  sync();

  prefEl.addEventListener('input', () => { draft.voorkeur = prefEl.value; sync(); });
  tijdEl.addEventListener('input', () => { draft.voorkeurTijd = tijdEl.value; sync(); });
  q('.kb-btn-voorkeur-del').addEventListener('click', () => {
    prefEl.value = ''; tijdEl.value = ''; draft.voorkeur = ''; draft.voorkeurTijd = ''; sync();
  });
  // Een nog niet toegevoegde (volledige, geldige) datum telt mee bij Opslaan; de knop voegt ze expliciet toe.
  function voegBlokToe() {
    const v = blokEl.value;
    if (!v) return;
    if (draft.voorkeur === v) return toast('⚠ Deze datum is al de voorkeursdatum');
    if (!draft.geblokkeerd.includes(v)) draft.geblokkeerd = [...draft.geblokkeerd, v].sort();
    blokEl.value = '';
    tekenChips(); sync();
  }
  q('.kb-btn-addblok').addEventListener('click', voegBlokToe);
  blokEl.addEventListener('input', sync);
  blokEl.addEventListener('change', sync);
  duurEl.addEventListener('input', () => { draft.duur = duurEl.value === '' ? null : Number(duurEl.value); sync(); });
  q('.kb-btn-duur-reset').addEventListener('click', () => {
    const settings = toestand.get('settings'); // synchrone handler: geen await tussen lezen en gebruik
    draft.duur = settings.duurMinuten; duurEl.value = String(settings.duurMinuten); sync();
  });
  notEl.addEventListener('input', () => { draft.notitie = notEl.value; sync(); });
  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    const hangend = geldigeBlok();
    if (hangend && hangend === draft.voorkeur) { toast('⚠ Deze datum is al de voorkeursdatum'); sync(); return; }
    const ok = await saveKbAll(ticketId, {
      voorkeur: draft.voorkeur || null, voorkeurTijd: draft.voorkeurTijd || null,
      geblokkeerd: hangend ? [...new Set([...draft.geblokkeerd, hangend])] : draft.geblokkeerd, duur: draft.duur, notitie: draft.notitie,
    });
    if (!ok) sync(); // concept blijft staan; opnieuw proberen kan
  });
}

// Eén opslag voor het hele klantbeschikbaarheid-formulier. Valideert alles vóór er iets
// gemuteerd wordt (volgorde en meldingen zoals de vroegere losse acties), past het concept dan
// toe op de bewaarde entry en gebruikt hetzelfde persist-pad (saveKlantBeschikbaarheid, incl.
// 409-merge en kbLocallyDeleted-bescherming).
export async function saveKbAll(ticketId, draft) {
  if (!ticketId) return false;
  const datum = draft.voorkeur || null;
  const tijd  = draft.voorkeurTijd || null;
  // M10: 00:00 apart weigeren -- dat is de sentinel voor "geen tijdstip" (zie extractLocalHour).
  if (tijd === '00:00') { toast('⚠ 00:00 is geen geldig voorkeursuur'); return false; }
  if (tijd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tijd)) { toast('⚠ Ongeldig uur'); return false; }
  const geblokkeerd = [...new Set(draft.geblokkeerd || [])].sort();
  if (datum && geblokkeerd.includes(datum)) { toast('⚠ Deze datum staat al als geblokkeerd'); return false; }
  const duur = (draft.duur === null || draft.duur === undefined || draft.duur === '') ? null : Number(draft.duur);
  if (duur !== null && (!Number.isInteger(duur) || duur < 15 || duur > 480)) {
    toast('⚠ Verwachte duur moet tussen 15 en 480 minuten liggen'); return false;
  }

  // Momentopname om bij een mislukte opslag terug te draaien (het concept blijft dan staan).
  // Tot het eerste await hieronder is dit een synchroon stuk: deze lezingen zijn vers. Na het await lezen we `toestand` opnieuw.
  const klantBeschikbaarheid = toestand.get('klantBeschikbaarheid'), settings = toestand.get('settings');
  const vorige = klantBeschikbaarheid[ticketId] ? JSON.parse(JSON.stringify(klantBeschikbaarheid[ticketId])) : null;
  const wasLokaalVerwijderd = kbLocallyDeleted.has(ticketId);

  if (!klantBeschikbaarheid[ticketId]) {
    klantBeschikbaarheid[ticketId] = { voorkeur: null, voorkeurTijd: null, geblokkeerd: [], notitie: '', bijgewerkt: new Date().toISOString() };
  }
  const kb = klantBeschikbaarheid[ticketId];
  kb.voorkeur = datum;
  kb.voorkeurTijd = tijd;
  kb.geblokkeerd = geblokkeerd;
  kb.notitie = draft.notitie || '';
  if (duur && duur > 0 && duur !== settings.duurMinuten) kb.duurOverride = duur;
  else delete kb.duurOverride; // gelijk aan standaard = geen override

  kb.bijgewerkt = new Date().toISOString();
  // Ticket weer gevuld na een eerdere lokale verwijdering: telt niet langer als "lokaal
  // verwijderd" voor de 409-merge (zie kbLocallyDeleted hierboven).
  kbLocallyDeleted.delete(ticketId);
  // Verwijder lege entry
  if (!kb.voorkeur && !kb.voorkeurTijd && !kb.geblokkeerd.length && !kb.notitie && !kb.duurOverride) {
    delete klantBeschikbaarheid[ticketId];
    kbLocallyDeleted.add(ticketId);
  }

  renderTickets(); // badges bijwerken
  const ok = await saveKlantBeschikbaarheid();
  if (!ok) {
    // Live lezen na de await: saveKlantBeschikbaarheid kan de toestand vervangen hebben (409-merge).
    const live = toestand.get('klantBeschikbaarheid');
    if (vorige) live[ticketId] = vorige; else delete live[ticketId];
    if (wasLokaalVerwijderd) kbLocallyDeleted.add(ticketId); else kbLocallyDeleted.delete(ticketId);
    renderTickets();
    return false; // saveKlantBeschikbaarheid toonde al de foutmelding
  }
  renderKbSection(ticketId);
  toast('✓ Klantbeschikbaarheid opgeslagen');
  return true;
}
