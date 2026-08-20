// public/js/rapport-wizard.js
// De rapport-wizard (service rapport voor interventies + installaties): stappen-state (`R`),
// alle wizRender*/wizSave*-stapfuncties, PDF-opbouw (buildRapportHtml) en verzending
// (printRapport, via de outbox-module). Zie CLAUDE.md "Rapport wizard — R object key fields".

export let _wizTicket = null;
export let _wizDate   = null;
export let _wizStep   = 0;
export let _sigTech   = null;
export let _sigKlant  = null;
export let _fotoState = { ticketId: null, versie: 0, fotos: [] };

// Rapport data object — gevuld doorheen wizard
export const R = {
  datum: '', technieker: '', adres: '', start: '', stop: '', werktijd: '',
  facturatie: 'klant', facturatieVrij: '',
  servicetype: '2e-lijn',
  aanrijtijdMin: 0,
  interventieType: 'Interventie',
  installateur: '', serienummer: '', aantalLaadpalen: 1, type: '', uitvoering: '', kabel: '', kabellengte: '',
  probleem: '', acties: '',
  oorzaakStoring: [],
  fotos: [],
  hersteld: 'nee', nieuwInter: 'nee',
  varia: '',
  onderdelen: [],
};

export const WIZ_STEPS = [
  { id: 'algemeen',     label: 'Algemeen',      render: wizRenderAlgemeen,     save: wizSaveAlgemeen     },
  { id: 'facturatie',   label: 'Facturatie',     render: wizRenderFacturatie,   save: wizSaveFacturatie   },
  { id: 'product',      label: 'Product',        render: wizRenderProduct,      save: wizSaveProduct      },
  { id: 'omschrijving', label: 'Omschrijving',   render: wizRenderOmschrijving, save: wizSaveOmschrijving },
  { id: 'fotos',        label: "Foto's",         render: wizRenderFotos,        save: wizSaveFotos        },
  { id: 'status',       label: 'Status',         render: wizRenderStatus,       save: wizSaveStatus       },
  { id: 'sig-tech',     label: 'Handtekening 1', render: wizRenderSigTech,      save: wizSaveSigTech      },
  { id: 'sig-klant',    label: 'Handtekening 2', render: wizRenderSigKlant,     save: wizSaveSigKlant     },
];

export async function openRapport(ticketId, date) {
  const ticket = getPlanningTicket(ticketId);
  if (!ticket) return toast('Ticket niet gevonden');
  closeDet();
  closeLocalDet();
  _wizTicket = ticket;
  _wizDate   = date;

  const now = new Date();
  const p2  = n => String(n).padStart(2,'0');
  const arrKey = `${date}__${ticketId}`;

  R.datum        = date;
  R.adres        = ticket.address || '';
  R.serienummer  = ticket.serienummer || '';
  R.installateur = ticket.partner || ticket.account || '';
  R.start        = arrivalData[arrKey] || '';
  R.stop         = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
  R.probleem     = ticket.subject || '';
  R.acties       = '';
  R.oorzaakStoring = [];
  R.varia        = '';
  R.onderdelen   = [];
  const fotoData  = await loadFotos(ticketId);
  _fotoState      = { ticketId, versie: fotoData.versie, fotos: fotoData.fotos };
  R.fotos         = _fotoState.fotos;
  R.technieker   = R.technieker || ''; // bewaar als al ingevuld
  R.facturatie     = 'klant';
  R.facturatieVrij = '';
  R.servicetype    = '2e-lijn';
  R._servicetypeAutoApplied = false;
  // Aanrijtijd wordt altijd berekend vanaf de ingestelde startlocatie naar het
  // interventie-adres — nooit hergebruikt uit een al-berekende route, nooit vanaf
  // de vorige stop van de dag. Geldt voor elk ticket (Zoho én lokale afspraken).
  // De routeplanning zelf (calculateRoute/autoPlan/optimizeRoute) gebruikt deze
  // berekening niet en blijft ongewijzigd.
  R.aanrijtijdMin = 0;
  if (ticket.hasAddress && settings.startlocatie) {
    try {
      toast('📡 Aanrijtijd berekenen...', 5000);
      const gRes  = await fetch('/api/optimize', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ origin: settings.startlocatie, stops: [ticket.address] }),
      });
      const gData = await gRes.json();
      const origin = gData.locations?.[0];
      const dest   = gData.locations?.[1];
      if (origin && dest) {
        const rRes  = await fetch('/api/route', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ waypoints: [origin, dest] }),
        });
        const rData = await rRes.json();
        if (rData.legs?.[0]?.travelTimeSeconds) {
          R.aanrijtijdMin = Math.round(rData.legs[0].travelTimeSeconds / 60);
        }
      }
    } catch { /* niet fataal, aanrijtijd blijft 0 */ }
  }
  R.type = ''; R.uitvoering = ''; R.kabel = ''; R.kabellengte = ''; R.aantalLaadpalen = 1;
  R.hersteld = 'nee'; R.nieuwInter = 'nee';
  // Automatisch bepaald uit de bron: een Zoho-ticket is altijd een interventie, een lokale
  // afspraak van het type "Installatie" is een installatie. Radio in stap Algemeen kan dit
  // nog steeds manueel overschrijven.
  R.interventieType = (ticket.isLocal && ticket.type === 'Installatie') ? 'Installatie' : 'Interventie';
  R.handtekeningTech = null; R.handtekeningKlant = null; // zie Task 23
  _sigTech = _sigKlant = null;
  _rapportUploaded = false; // reset guard bij nieuwe wizard-sessie

  _wizStep = 0;
  document.getElementById('rapport-wizard').classList.add('open');
  wizRenderStep();
}

export function closeWizard() {
  // Na een geslaagd rapport is er niets meer te verliezen — geen bevestiging nodig.
  if (_rapportUploaded || confirm('Rapport sluiten? Niet-opgeslagen wijzigingen gaan verloren.')) {
    document.getElementById('rapport-wizard').classList.remove('open');
  }
}

// ── Nav ──
export function wizRenderStep() {
  const step  = WIZ_STEPS[_wizStep];
  const visibleSteps = R.interventieType === 'Installatie'
    ? WIZ_STEPS.filter(s => s.id !== 'facturatie')
    : WIZ_STEPS;
  const total = visibleSteps.length;
  const visibleIndex = visibleSteps.indexOf(step);

  // Dots
  const dotsEl = document.getElementById('wiz-dots');
  dotsEl.innerHTML = visibleSteps.map((s, i) =>
    `<div class="wiz-step-dot ${i === visibleIndex ? 'active' : i < visibleIndex ? 'done' : ''}"></div>`
  ).join('');

  document.getElementById('wiz-step-label').textContent = `${visibleIndex+1} / ${total} — ${step.label}`;
  document.getElementById('wiz-ftr-info').textContent   = step.label;

  const btnBack = document.getElementById('wiz-btn-back');
  const btnNext = document.getElementById('wiz-btn-next');
  btnBack.style.display = _wizStep > 0 ? '' : 'none';
  btnNext.textContent   = visibleIndex === total - 1 ? '🖨️ Afdrukken / PDF' : 'Volgende →';

  const body = document.getElementById('wiz-body');
  body.scrollTop = 0;
  body.innerHTML = '';
  step.render(body);
}

export function wizNext() {
  const step   = WIZ_STEPS[_wizStep];
  const result = step.save ? step.save() : undefined;
  if (result === false || typeof result === 'string') {
    toast(typeof result === 'string' ? result : '⚠️ Kan niet doorgaan naar de volgende stap', 3500);
    return;
  }
  let nextStep = _wizStep + 1;
  if (R.interventieType === 'Installatie' && WIZ_STEPS[nextStep]?.id === 'facturatie') nextStep++;
  if (nextStep < WIZ_STEPS.length) {
    _wizStep = nextStep;
    wizRenderStep();
  } else {
    printRapport();
  }
}

export function wizBack() {
  if (WIZ_STEPS[_wizStep].save) WIZ_STEPS[_wizStep].save();
  let prevStep = _wizStep - 1;
  if (R.interventieType === 'Installatie' && WIZ_STEPS[prevStep]?.id === 'facturatie') prevStep--;
  if (prevStep >= 0) {
    _wizStep = prevStep;
    wizRenderStep();
  }
}

// ── Helpers ──
export function wizV(id) { const el = document.getElementById(id); return el ? el.value : ''; }
export function wizChecked(name) { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; }
export function calcWerktijd(start, stop) {
  if (!start || !stop) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = stop.split(':').map(Number);
  let totalMin = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMin < 0) totalMin += 24 * 60; // interventie loopt over middernacht heen
  if (totalMin <= 0) return '';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m > 0 ? `${h}u${String(m).padStart(2,'0')}` : `${h}u`;
}
export function calcWerktijdMin(start, stop) {
  if (!start || !stop) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = stop.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60; // interventie loopt over middernacht heen
  return diff > 0 ? diff : 0;
}
export function updateWerktijd() {
  const start = wizV('f-start');
  const stop  = wizV('f-stop');
  const wt    = calcWerktijd(start, stop);
  const chip  = document.getElementById('werktijd-chip');
  const val   = document.getElementById('werktijd-val');
  if (chip) { chip.style.display = wt ? 'flex' : 'none'; }
  if (val)  { val.textContent = wt; }
}

// ── Stap 1: Algemeen ──
export function wizRenderAlgemeen(el) {
  const zohoRef = _wizTicket.number ? `#${_wizTicket.number}` : (_wizTicket.isLocal ? '' : (_wizTicket.id || ''));
  el.innerHTML = `
    <div class="wiz-step-title">Algemeen</div>
    <div class="wiz-info-chip">
      <strong>${escHtml(_wizTicket.subject||'')}</strong><br>
      ${[_wizTicket.account, _wizTicket.address].filter(Boolean).map(escHtml).join(' · ')}
    </div>
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label">Datum</label>
        <input class="wiz-input" id="f-datum" type="date" value="${escHtml(R.datum)}" />
      </div>
      <div class="wiz-field">
        <label class="wiz-field-label">#Zoho</label>
        <input class="wiz-input" id="f-zoho" type="text" value="${escHtml(zohoRef)}" readonly />
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Technieker Blitz</label>
      <input class="wiz-input" id="f-technieker" type="text" placeholder="Naam technieker" value="${escHtml(R.technieker)}" />
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Interventie adres</label>
      <input class="wiz-input" id="f-adres" type="text" value="${escHtml(R.adres)}" />
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Type bezoek</label>
      <div class="wiz-radio-cards">
        <label class="wiz-radio-card">
          <input type="radio" name="f-interventieType" value="Interventie" ${R.interventieType !== 'Installatie' ? 'checked' : ''}>
          <div><div class="wiz-radio-card-label">Interventie</div></div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-interventieType" value="Installatie" ${R.interventieType === 'Installatie' ? 'checked' : ''}>
          <div><div class="wiz-radio-card-label">Installatie</div></div>
        </label>
      </div>
    </div>
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label">Starttijd (aankomst)</label>
        <input class="wiz-input" id="f-start" type="time" value="${escHtml(R.start)}" oninput="updateWerktijd()" />
      </div>
      <div class="wiz-field">
        <label class="wiz-field-label">Stoptijd (einde)</label>
        <input class="wiz-input" id="f-stop" type="time" value="${escHtml(R.stop)}" oninput="updateWerktijd()" />
      </div>
    </div>
    <div id="werktijd-chip" style="display:${R.start&&R.stop?'flex':'none'};align-items:center;gap:8px;background:var(--accent-dim);border:1px solid rgba(0,223,163,0.2);border-radius:8px;padding:10px 14px;font-size:0.85rem;margin-bottom:4px">
      <span style="color:var(--muted)">⏱ Totale werktijd:</span>
      <strong id="werktijd-val" style="color:var(--accent)">${calcWerktijd(R.start,R.stop)}</strong>
    </div>`;
}
export function wizSaveAlgemeen() {
  R.datum           = wizV('f-datum');
  R.technieker      = wizV('f-technieker');
  R.adres           = wizV('f-adres');
  R.start           = wizV('f-start');
  R.stop            = wizV('f-stop');
  R.werktijd        = calcWerktijd(R.start, R.stop);
  R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
}

export function fmtDuur(min) {
  const h = Math.floor(min / 60), mn = min % 60;
  return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
}

// ── Stap 2: Facturatie & Servicetype ──
export function berekenLoonkost(servicetype, werktijdMin, aanrijtijdMin) {
  if (servicetype === '2e-lijn') {
    const totMin    = (werktijdMin || 0) + (aanrijtijdMin || 0);
    const totUren   = totMin / 60;
    const extraUren = totUren > 3 ? Math.ceil(totUren - 3) : 0;
    return { bruto: 175 + extraUren * 75, totMin, extraUren };
  }
  if (servicetype === '1e-lijn') {
    const totMin = (werktijdMin || 0) + (aanrijtijdMin || 0);
    const gestartUren = Math.ceil(totMin / 60);
    return { bruto: gestartUren * 115, gestartUren, totMin, extraUren: 0 };
  }
  // garantie: zelfde berekening als 1e lijn maar netto = 0
  const totMin = (werktijdMin || 0) + (aanrijtijdMin || 0);
  const gestartUren = Math.ceil(totMin / 60);
  return { bruto: gestartUren * 115, gestartUren, netto: 0, totMin, extraUren: 0 };
}

export function wizLoonkostPreview() {
  const st       = wizChecked('f-servicetype') || R.servicetype;
  const wMin     = calcWerktijdMin(R.start, R.stop);
  const aMin     = parseInt(document.getElementById('f-aanrijtijd')?.value) || 0;
  const { bruto, totMin, extraUren } = berekenLoonkost(st, wMin, aMin);

  const fmt = m => {
    const h = Math.floor(m / 60), mn = m % 60;
    return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
  };

  let regels = [];
  if (st === '2e-lijn') {
    if (aMin) regels.push(`Aanrijtijd: ${fmt(aMin)}`);
    regels.push(`Werktijd: ${fmt(wMin)}`);
    regels.push(`Totaal: ${fmt(totMin)} → forfait €175`);
    if (extraUren > 0) regels.push(`+ ${extraUren}u extra × €75 = €${extraUren * 75}`);
  } else if (st === '1e-lijn') {
    if (aMin) regels.push(`Aanrijtijd: ${fmt(aMin)}`);
    regels.push(`Werktijd: ${fmt(wMin)}`);
    const gu = Math.ceil(totMin / 60);
    regels.push(`Totaal: ${fmt(totMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115`);
  } else {
    if (aMin) regels.push(`Aanrijtijd: ${fmt(aMin)}`);
    regels.push(`Werktijd: ${fmt(wMin)}`);
    const gu = Math.ceil(totMin / 60);
    regels.push(`Totaal: ${fmt(totMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115 (gedekt door garantie)`);
  }

  const isGarantie = st === 'garantie';
  const netto = isGarantie ? 0 : bruto;

  const el = document.getElementById('wiz-loonkost-preview');
  if (!el) return;
  el.innerHTML = `
    <div style="font-size:0.78rem;color:var(--muted);margin-bottom:4px">${regels.join(' · ')}</div>
    <div style="display:flex;align-items:baseline;gap:6px">
      ${isGarantie && bruto > 0
        ? `<span style="text-decoration:line-through;color:var(--muted);font-size:0.85rem">€ ${bruto.toFixed(2)}</span>
           <span style="font-size:1rem;font-weight:700;color:var(--accent)">€ 0,00</span>
           <span style="font-size:0.72rem;color:var(--muted)">(100% korting — garantie)</span>`
        : `<span style="font-size:1rem;font-weight:700;color:var(--accent)">€ ${netto.toFixed(2)}</span>`
      }
    </div>`;
}

export function wizAutoServicetype() {
  const garantie = String(_wizTicket?.garantieStatus || '').trim().toLowerCase();
  const langsgeweest = String(_wizTicket?.installateurAlLangsGeweest || '').trim().toLowerCase();
  if (garantie === 'binnen garantie') return 'garantie';
  if (langsgeweest === 'ja') return '2e-lijn';
  if (langsgeweest === 'nee') return '1e-lijn';
  return null; // onduidelijk -- geen auto-selectie, huidige/handmatige waarde van R.servicetype blijft staan
}

export function wizRenderFacturatie(el) {
  if (!R._servicetypeAutoApplied) {
    const auto = wizAutoServicetype();
    if (auto) R.servicetype = auto;
    R._servicetypeAutoApplied = true;
  }
  const isGarantie = R.servicetype === 'garantie';
  el.innerHTML = `
    <div class="wiz-step-title">Facturatie &amp; Servicetype</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Facturatie aan</label>
      <div class="wiz-radio-cards">
        <label class="wiz-radio-card">
          <input type="radio" name="f-facturatie" value="klant" ${R.facturatie==='klant'?'checked':''} onchange="wizFacturatieChange()">
          <div><div class="wiz-radio-card-label">Klant</div></div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-facturatie" value="partner" ${R.facturatie==='partner'?'checked':''} onchange="wizFacturatieChange()">
          <div><div class="wiz-radio-card-label">Partner / installateur</div>${_wizTicket.partner ? `<div class="wiz-radio-card-sub">${escHtml(_wizTicket.partner)}</div>` : ''}</div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-facturatie" value="vrij" ${R.facturatie==='vrij'?'checked':''} onchange="wizFacturatieChange()">
          <div><div class="wiz-radio-card-label">Vrij invulveld</div></div>
        </label>
      </div>
      <div id="facturatie-vrij-wrap" style="${R.facturatie==='vrij'?'':'display:none'};margin-top:10px">
        <input class="wiz-input" id="f-facturatie-vrij" type="text" placeholder="Facturatie aan..." value="${escHtml(R.facturatieVrij)}" />
      </div>
    </div>
    <div class="wiz-sep"></div>
    <div class="wiz-field">
      <label class="wiz-field-label">Type interventie</label>
      <div class="wiz-radio-cards">
        <label class="wiz-radio-card">
          <input type="radio" name="f-servicetype" value="2e-lijn" ${R.servicetype==='2e-lijn'?'checked':''} onchange="wizServicetypeChange()">
          <div>
            <div class="wiz-radio-card-label">2e lijns interventie</div>
            <div class="wiz-radio-card-sub">€175 forfait (3u) · €75/gestart uur extra · aanrijtijd inbegrepen</div>
          </div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-servicetype" value="1e-lijn" ${R.servicetype==='1e-lijn'?'checked':''} onchange="wizServicetypeChange()">
          <div>
            <div class="wiz-radio-card-label">1e lijns interventie</div>
            <div class="wiz-radio-card-sub">€115/uur · aanrijtijd inbegrepen</div>
          </div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-servicetype" value="garantie" ${R.servicetype==='garantie'?'checked':''} onchange="wizServicetypeChange()">
          <div>
            <div class="wiz-radio-card-label">Garantie</div>
            <div class="wiz-radio-card-sub">100% korting op loonkosten</div>
          </div>
        </label>
      </div>
    </div>
    <div id="aanrijtijd-wrap" style="margin-top:6px">
      <div class="wiz-field">
        <label class="wiz-field-label">Aanrijtijd (minuten, enkel heen)
          ${R.aanrijtijdMin > 0 ? '<span style="font-size:0.72rem;color:var(--accent);margin-left:6px">📡 TomTom</span>' : ''}
        </label>
        <input class="wiz-input" id="f-aanrijtijd" type="number" min="0" step="1"
          value="${R.aanrijtijdMin || ''}" placeholder="bijv. 35"
          oninput="wizLoonkostPreview()" style="max-width:120px" />
      </div>
    </div>
    <div class="wiz-sep"></div>
    <div style="background:var(--surface3);border:1px solid var(--border);border-radius:8px;padding:12px 14px" id="wiz-loonkost-preview"></div>`;
  wizLoonkostPreview();
}
export function wizFacturatieChange() {
  const val = wizChecked('f-facturatie');
  document.getElementById('facturatie-vrij-wrap').style.display = val === 'vrij' ? '' : 'none';
}
export function wizServicetypeChange() {
  wizLoonkostPreview();
}
export function wizSaveFacturatie() {
  R.facturatie     = wizChecked('f-facturatie') || 'klant';
  R.facturatieVrij = wizV('f-facturatie-vrij');
  R.servicetype    = wizChecked('f-servicetype') || '2e-lijn';
  R.aanrijtijdMin  = parseInt(document.getElementById('f-aanrijtijd')?.value) || 0;
}

// ── Stap 3: Productinfo ──
export function wizRenderProduct(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Productinformatie</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Installateur / partner</label>
      <input class="wiz-input" id="f-installateur" type="text" value="${escHtml(R.installateur)}" placeholder="Installateur" />
    </div>
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label">Serienummer (master laadpaal)</label>
        <input class="wiz-input" id="f-serienummer" type="text" value="${escHtml(R.serienummer)}" placeholder="CHARX-XXXX" />
      </div>
      <div class="wiz-field">
        <label class="wiz-field-label">Aantal laadpalen</label>
        <input class="wiz-input" id="f-aantal-laadpalen" type="number" min="1" step="1" value="${R.aantalLaadpalen || 1}" />
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Type</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-type" value="Single" ${R.type==='Single'?'checked':''}><div><div class="wiz-radio-card-label">Single</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-type" value="Dual 1" ${R.type==='Dual 1'?'checked':''}><div><div class="wiz-radio-card-label">Dual 1</div><div class="wiz-radio-card-sub">1 voedingskabel</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-type" value="Dual 2" ${R.type==='Dual 2'?'checked':''}><div><div class="wiz-radio-card-label">Dual 2</div><div class="wiz-radio-card-sub">2 voedingskabels</div></div></label>
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Uitvoering</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-uitvoering" value="tower" ${R.uitvoering==='tower'?'checked':''}><div><div class="wiz-radio-card-label">Tower</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-uitvoering" value="wall" ${R.uitvoering==='wall'?'checked':''}><div><div class="wiz-radio-card-label">Wall</div></div></label>
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Kabeltype</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-kabel" value="socket" ${R.kabel==='socket'?'checked':''} onchange="wizKabelChange()"><div><div class="wiz-radio-card-label">Socket</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-kabel" value="kabel" ${R.kabel==='kabel'?'checked':''} onchange="wizKabelChange()"><div><div class="wiz-radio-card-label">Vaste kabel</div></div></label>
      </div>
      <div id="kabel-lengte-wrap" style="${R.kabel==='kabel'?'':'display:none'};margin-top:10px">
        <label class="wiz-field-label">Kabellengte</label>
        <div class="wiz-radio-cards row">
          <label class="wiz-radio-card"><input type="radio" name="f-kabellengte" value="5m" ${R.kabellengte==='5m'?'checked':''}><div><div class="wiz-radio-card-label">5m</div></div></label>
          <label class="wiz-radio-card"><input type="radio" name="f-kabellengte" value="8m" ${R.kabellengte==='8m'?'checked':''}><div><div class="wiz-radio-card-label">8m</div></div></label>
          <label class="wiz-radio-card"><input type="radio" name="f-kabellengte" value="spiraal" ${R.kabellengte==='spiraal'?'checked':''}><div><div class="wiz-radio-card-label">Spiraal</div></div></label>
        </div>
      </div>
    </div>`;
}
export function wizKabelChange() {
  const val = wizChecked('f-kabel');
  const wrap = document.getElementById('kabel-lengte-wrap');
  if (wrap) wrap.style.display = val === 'kabel' ? '' : 'none';
}
export function wizSaveProduct() {
  R.installateur     = wizV('f-installateur');
  R.serienummer      = wizV('f-serienummer');
  R.aantalLaadpalen  = parseInt(wizV('f-aantal-laadpalen')) || 1;
  R.type             = wizChecked('f-type');
  R.uitvoering       = wizChecked('f-uitvoering');
  R.kabel            = wizChecked('f-kabel');
  R.kabellengte      = wizChecked('f-kabellengte');
}

// ── Stap 4: Omschrijving & acties ──
export const OORZAAK_STORING_MAP = {
  'f-oorzaak-product':      'Productfout',
  'f-oorzaak-installatie':  'Installatiefout',
  'f-oorzaak-configuratie': 'Configuratiefout',
  'f-oorzaak-andere':       'Andere',
};

export function wizRenderOmschrijving(el) {
  const isInstallatie = R.interventieType === 'Installatie';
  el.innerHTML = `
    <div class="wiz-step-title">Omschrijving &amp; acties</div>
    <div class="wiz-field">
      <label class="wiz-field-label">${isInstallatie ? 'Omschrijving installatie' : 'Omschrijving probleem'}</label>
      <textarea class="wiz-textarea" id="f-probleem" rows="4" placeholder="${isInstallatie ? 'Beschrijf de uitgevoerde installatie...' : 'Beschrijf het probleem...'}">${escHtml(R.probleem)}</textarea>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Ondernomen acties</label>
      <textarea class="wiz-textarea" id="f-acties" rows="6" placeholder="Beschrijf de uitgevoerde werkzaamheden...">${escHtml(R.acties)}</textarea>
    </div>
    ${isInstallatie ? '' : `
    <div class="wiz-field">
      <label class="wiz-field-label">Oorzaak storing</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-product" ${R.oorzaakStoring.includes('Productfout')?'checked':''}><div><div class="wiz-radio-card-label">Productfout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-installatie" ${R.oorzaakStoring.includes('Installatiefout')?'checked':''}><div><div class="wiz-radio-card-label">Installatiefout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-configuratie" ${R.oorzaakStoring.includes('Configuratiefout')?'checked':''}><div><div class="wiz-radio-card-label">Configuratiefout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-andere" ${R.oorzaakStoring.includes('Andere')?'checked':''}><div><div class="wiz-radio-card-label">Andere</div></div></label>
      </div>
    </div>`}`;
}
export function wizSaveOmschrijving() {
  R.probleem = wizV('f-probleem');
  R.acties   = wizV('f-acties');
  if (R.interventieType === 'Installatie') { R.oorzaakStoring = []; return; }
  R.oorzaakStoring = Object.entries(OORZAAK_STORING_MAP)
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, label]) => label);
  if (!R.oorzaakStoring.length) return '⚠️ Selecteer minstens één oorzaak storing';
}

// ── Stap 4b: Foto's ──
export function wizRenderFotos(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Foto's</div>
    <div class="wiz-field">
      <div id="wiz-foto-grid" class="foto-grid"></div>
      <input type="file" id="wiz-foto-file-input" multiple style="display:none" onchange="handleWizFotoFiles(this)">
      <button class="foto-add-btn" onclick="document.getElementById('wiz-foto-file-input').click()">+ Foto toevoegen</button>
    </div>`;
  renderFotoGridInto('wiz-foto-grid');
}
export function wizSaveFotos() {
  R.fotos = _fotoState.fotos;
}
export async function handleWizFotoFiles(input) {
  await handleFotoFiles(input, 'wiz-foto-grid');
  R.fotos = _fotoState.fotos;
}

// ── Stap 5: Status & onderdelen ──
// Actieve tag-filters voor cataloguszoeken
export let _wizActiveTags = [];

export function wizRenderStatus(el) {
  const selHtml = _wizRenderGeselecteerd();
  // Populaire tags (max 8 meest voorkomende)
  const allTags = getAlleTags().slice(0, 12);
  // Tags komen uit prijsbeheer (vrij tekstveld, opgeslagen in de prijzen-blob). Een inline
  // onclick met een JS-string is daar niet veilig voor: de browser decodeert HTML-entities in
  // een attribuutwaarde vóórdat de handler als JS gecompileerd wordt, dus escHtml()'s &#39;
  // wordt weer een echte apostrof en breekt de JS-string open. Daarom de tag als
  // data-attribuut meegeven + addEventListener (zelfde patroon als de .btn-navigeer-knoppen).
  const tagFilterHtml = allTags.map(t =>
    `<button class="wiz-tag-filter${_wizActiveTags.includes(t)?' active':''}" data-tag="${escHtml(t)}">${escHtml(t)}</button>`
  ).join('');

  const isInstallatie = R.interventieType === 'Installatie';
  el.innerHTML = `
    <div class="wiz-step-title">${isInstallatie ? 'Materialen' : 'Status &amp; onderdelen'}</div>
    ${isInstallatie ? '' : `
    <div class="wiz-field">
      <label class="wiz-field-label">Definitief hersteld</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-hersteld" value="ja" ${R.hersteld==='ja'?'checked':''}><div><div class="wiz-radio-card-label">Ja</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-hersteld" value="nee" ${R.hersteld!=='ja'?'checked':''}><div><div class="wiz-radio-card-label">Nee</div></div></label>
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Nieuwe interventie nodig</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-nieuw-inter" value="ja" ${R.nieuwInter==='ja'?'checked':''}><div><div class="wiz-radio-card-label">Ja</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-nieuw-inter" value="nee" ${R.nieuwInter!=='ja'?'checked':''}><div><div class="wiz-radio-card-label">Nee</div></div></label>
      </div>
    </div>`}
    <div class="wiz-sep"></div>
    <div class="wiz-field">
      <label class="wiz-field-label">Onderdelen toevoegen</label>
      <div class="wiz-cat-search-wrap">
        <span class="wiz-cat-search-icon">🔍</span>
        <input class="wiz-cat-search" id="wiz-cat-q" type="search"
          placeholder="Zoek op naam of tag…" oninput="wizCatFilter()" autocomplete="off" />
      </div>
      <div class="wiz-tag-filters" id="wiz-tag-filters">${tagFilterHtml}</div>
      <div class="wiz-cat-results" id="wiz-cat-results"></div>
      <button class="wiz-add-part" onclick="wizAddVrijeRegel()" style="margin-bottom:8px">+ Vrije regel (handmatig)</button>
    </div>
    <div class="wiz-field" id="wiz-sel-section">
      <label class="wiz-field-label">Geselecteerde onderdelen</label>
      <div id="wiz-sel-list">${selHtml}</div>
      ${_wizTotaalRij()}
    </div>
    <div class="wiz-sep"></div>
    <div class="wiz-field">
      <label class="wiz-field-label">Varia / opmerkingen</label>
      <textarea class="wiz-textarea" id="f-varia" rows="3" placeholder="Bijzonderheden, extra info...">${escHtml(R.varia)}</textarea>
    </div>`;

  // Tag-filterknoppen: click via addEventListener i.p.v. inline onclick (zie comment hierboven)
  el.querySelectorAll('.wiz-tag-filter').forEach(btn => {
    btn.addEventListener('click', () => wizToggleTagFilter(btn.dataset.tag || ''));
  });

  // Render catalogusresultaten
  _wizUpdateCatResults();
}

export function _wizRenderGeselecteerd() {
  if (!R.onderdelen.length) return '<div style="font-size:0.8rem;color:var(--muted);padding:4px 0">Nog geen onderdelen geselecteerd</div>';
  return R.onderdelen.map((p, i) => {
    const subtotaal = (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1);
    const isVrij = (p.id || '').startsWith('vrij-');
    return `<div class="wiz-sel-item">
      <div class="wiz-sel-top">
        ${isVrij
          ? `<input class="wiz-part-omschr" style="flex:1;font-size:0.85rem" type="text" placeholder="Omschrijving" value="${escHtml(p.naam||'')}" oninput="wizUpdSelNaam(${i},this.value)" />`
          : `<span class="wiz-sel-naam">${escHtml(p.naam)}</span>`
        }
        <button class="wiz-sel-del" onclick="wizRemovePart(${i})" title="Verwijderen">✕</button>
      </div>
      <div class="wiz-sel-bottom">
        <div class="wiz-sel-aantal-wrap">
          <span class="wiz-sel-aantal-lbl">Aantal${p.eenheid==='meter' ? ' (meter)' : ''}</span>
          <input class="wiz-sel-aantal" type="number" min="1" step="1" value="${p.aantal||1}"
            oninput="wizUpdSelAantal(${i},this.value)" />
        </div>
        ${isVrij
          ? `<input class="wiz-part-prijs" type="number" placeholder="€ prijs" min="0" step="0.01"
              style="width:80px;font-size:0.82rem" value="${p.prijs||''}"
              oninput="wizUpdSelPrijs(${i},this.value)" />
             <select class="wiz-part-eenheid" style="width:60px;font-size:0.8rem" onchange="wizUpdSelEenheid(${i},this.value)">
               <option value="stuk" ${p.eenheid!=='meter'?'selected':''}>stuk</option>
               <option value="meter" ${p.eenheid==='meter'?'selected':''}>meter</option>
             </select>`
          : `<span class="wiz-sel-stukprijs">€ ${(parseFloat(p.prijs)||0).toFixed(2)} / ${p.eenheid || 'stuk'}</span>`
        }
        <span class="wiz-sel-subtotaal">€ ${subtotaal.toFixed(2)}</span>
        <label class="wiz-sel-factureer">
          <input type="checkbox" ${p.factureren!==false?'checked':''} onchange="wizUpdSelFact(${i},this.checked)" />
          Factureren
        </label>
      </div>
    </div>`;
  }).join('');
}

export function _wizTotaalRij() {
  const billable = R.onderdelen.filter(p => p.factureren !== false);
  const totaal   = billable.reduce((sum, p) => sum + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
  if (!R.onderdelen.length) return '';
  const nietFactureerbaar = R.onderdelen.length - billable.length;
  return `<div class="wiz-totaal-row">
    <span class="wiz-totaal-lbl">Totaal factureerbaar (excl. btw)${nietFactureerbaar ? ` <span style="font-size:0.75em;color:var(--muted)">(${nietFactureerbaar} niet aangerekend)</span>` : ''}</span>
    <span class="wiz-totaal-val">€ ${totaal.toFixed(2)}</span>
  </div>`;
}

export function _wizUpdateCatResults() {
  const q = document.getElementById('wiz-cat-q')?.value || '';
  const resultEl = document.getElementById('wiz-cat-results');
  if (!resultEl) return;
  const resultaten = zoekOnderdelen(q, _wizActiveTags);
  if (!resultaten.length) {
    resultEl.innerHTML = `<div class="wiz-cat-empty">Geen onderdelen gevonden</div>`;
    return;
  }
  // o.id komt uit de prijzen-blob → net als bij de tag-filters geen inline onclick met een
  // JS-string, maar een data-attribuut + addEventListener.
  resultEl.innerHTML = resultaten.slice(0, 20).map(o =>
    `<div class="wiz-cat-item" data-ond-id="${escHtml(o.id)}">
      <span class="wiz-cat-item-naam">${escHtml(o.naam)}</span>
      <span class="wiz-cat-item-prijs">€ ${(o.prijs||0).toFixed(2)}</span>
    </div>`
  ).join('');
  resultEl.querySelectorAll('.wiz-cat-item').forEach(item => {
    item.addEventListener('click', () => wizVoegCatToe(item.dataset.ondId || ''));
  });
}

export function wizCatFilter() {
  _wizUpdateCatResults();
}

export function wizToggleTagFilter(tag) {
  const idx = _wizActiveTags.indexOf(tag);
  if (idx >= 0) _wizActiveTags.splice(idx, 1);
  else _wizActiveTags.push(tag);
  // Update filter buttons
  document.querySelectorAll('.wiz-tag-filter').forEach(btn => {
    btn.classList.toggle('active', _wizActiveTags.includes(btn.dataset.tag || ''));
  });
  _wizUpdateCatResults();
}

export function wizVoegCatToe(id) {
  wizSaveStatus();
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const o = src.onderdelen.find(x => x.id === id);
  if (!o) return;
  // Check of al aanwezig → verhoog aantal
  const existing = R.onderdelen.find(p => p.id === id);
  if (existing) {
    existing.aantal = (parseInt(existing.aantal) || 1) + 1;
  } else {
    R.onderdelen.push({ id: o.id, naam: o.naam, prijs: o.prijs, aantal: 1, factureren: true, eenheid: o.eenheid || 'stuk' });
  }
  _wizHertekenGeselecteerd();
}

export function wizAddVrijeRegel() {
  wizSaveStatus();
  R.onderdelen.push({ id: 'vrij-' + Date.now(), naam: '', prijs: '', aantal: 1, factureren: true, eenheid: 'stuk' });
  _wizHertekenGeselecteerd();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.wiz-part-omschr');
    if (inputs.length) inputs[inputs.length-1].focus();
  }, 50);
}

export function wizRemovePart(i) {
  wizSaveStatus();
  R.onderdelen.splice(i, 1);
  _wizHertekenGeselecteerd();
}

export function wizUpdSelNaam(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].naam      = val; _wizUpdateTotaalRow(); }
export function wizUpdSelAantal(i, val){ if (R.onderdelen[i]) R.onderdelen[i].aantal    = parseInt(val)||1; _wizUpdateTotaalRow(); }
export function wizUpdSelPrijs(i, val) { if (R.onderdelen[i]) R.onderdelen[i].prijs     = val; _wizUpdateTotaalRow(); }
export function wizUpdSelFact(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].factureren = val; _wizUpdateTotaalRow(); }
export function wizUpdSelEenheid(i, val) { if (R.onderdelen[i]) R.onderdelen[i].eenheid = val; _wizHertekenGeselecteerd(); }

// Werkt enkel het totaal-rijtje bij — laat de input-elementen zelf (en dus de focus/cursorpositie) met rust.
export function _wizUpdateTotaalRow() {
  const selSection = document.getElementById('wiz-sel-section');
  if (!selSection) return;
  let totaalEl = selSection.querySelector('.wiz-totaal-row');
  if (totaalEl) totaalEl.outerHTML = _wizTotaalRij();
  else selSection.insertAdjacentHTML('beforeend', _wizTotaalRij());
}

// Volledige her-render blijft nodig zodra een rij wordt toegevoegd/verwijderd
// (aantal DOM-nodes verandert) — gebruikt door wizAddVrijeRegel/wizRemovePart/wizVoegCatToe.
export function _wizHertekenGeselecteerd() {
  const selList = document.getElementById('wiz-sel-list');
  if (!selList) return;
  selList.innerHTML = _wizRenderGeselecteerd();
  _wizUpdateTotaalRow();
}

// Oud compat alias (niet meer nodig maar voorkomt errors als ergens anders wizUpdatePart staat)
export function wizUpdatePart(i, key, val) {
  if (R.onderdelen[i]) R.onderdelen[i][key] = val;
}
export function wizAddPart() { wizAddVrijeRegel(); }
export function wizSaveStatus() {
  R.hersteld   = wizChecked('f-hersteld')    || 'nee';
  R.nieuwInter = wizChecked('f-nieuw-inter') || 'nee';
  R.varia      = wizV('f-varia');
}

export function wizSaveSigTech() {
  R.handtekeningTech = (_sigTech && !_sigTech.isEmpty()) ? _sigTech.toDataURL() : null;
}
export function wizSaveSigKlant() {
  R.handtekeningKlant = (_sigKlant && !_sigKlant.isEmpty()) ? _sigKlant.toDataURL() : null;
}

// ── Stap 6: Handtekening technieker ──
export function wizRenderSigTech(el) {
  el.innerHTML = `
    <div class="wiz-step-title">✍️ Handtekening technieker</div>
    <p style="font-size:0.85rem;color:var(--muted);margin-bottom:14px;line-height:1.5">
      Teken hieronder ter bevestiging van de uitgevoerde werkzaamheden.
    </p>
    <div class="wiz-sig-container" id="sig-tech-wrap">
      <canvas id="sig-tech-canvas"></canvas>
      <div class="wiz-sig-hint" id="sig-tech-hint"><div style="font-size:2rem">✍️</div><div>Teken hier</div></div>
    </div>
    <div class="wiz-sig-actions">
      <button class="wiz-sig-clear" onclick="wizClearSigTech()">Wissen</button>
      <div class="wiz-sig-status" id="sig-tech-status">Nog niet getekend</div>
    </div>`;
  requestAnimationFrame(() => {
    const canvas = document.getElementById('sig-tech-canvas');
    const wrap   = document.getElementById('sig-tech-wrap');
    canvas.width  = wrap.offsetWidth;
    canvas.height = wrap.offsetHeight || Math.max(260, window.innerHeight * 0.38);
    if (window.SignaturePad) {
      _sigTech = new SignaturePad(canvas, { penColor: '#181e24', backgroundColor: '#ffffff' });
      _sigTech.addEventListener('endStroke', () => {
        document.getElementById('sig-tech-hint').style.display = 'none';
        const st = document.getElementById('sig-tech-status');
        if (st) { st.textContent = '✅ Getekend'; st.style.color = 'var(--accent)'; }
        wrap.classList.add('has-sig');
      });
      // Terugnavigeren mag een eerder getekende handtekening niet wissen.
      if (R.handtekeningTech) {
        _sigTech.fromDataURL(R.handtekeningTech);
        document.getElementById('sig-tech-hint').style.display = 'none';
        const st = document.getElementById('sig-tech-status');
        if (st) { st.textContent = '✅ Getekend'; st.style.color = 'var(--accent)'; }
        wrap.classList.add('has-sig');
      }
    }
  });
}
export function wizClearSigTech() {
  if (_sigTech) {
    _sigTech.clear();
    R.handtekeningTech = null;
    const hint = document.getElementById('sig-tech-hint');
    if (hint) hint.style.display = '';
    const st = document.getElementById('sig-tech-status');
    if (st) { st.textContent = 'Nog niet getekend'; st.style.color = ''; }
    document.getElementById('sig-tech-wrap')?.classList.remove('has-sig');
  }
}

// ── Stap 7: Handtekening klant ──
export function wizRenderSigKlant(el) {
  // Bouw rapport-preview (klant kan scrollen en lezen voor te tekenen)
  const previewHtml = buildRapportHtml();
  el.innerHTML = `
    <div class="wiz-step-title">✍️ Handtekening klant</div>
    <p style="font-size:0.85rem;color:var(--muted);margin-bottom:10px;line-height:1.5">
      Geef het apparaat aan de klant. Klant leest het rapport en tekent onderaan.
    </p>
    <iframe id="rapport-preview-frame"
      srcdoc=""
      style="width:100%;height:420px;border:1px solid var(--border);border-radius:6px;margin-bottom:14px;background:#fff"
      sandbox="allow-same-origin">
    </iframe>
    <div class="wiz-sig-container" id="sig-klant-wrap">
      <canvas id="sig-klant-canvas"></canvas>
      <div class="wiz-sig-hint" id="sig-klant-hint"><div style="font-size:2rem">✍️</div><div>Teken hier</div></div>
    </div>
    <div class="wiz-sig-actions">
      <button class="wiz-sig-clear" onclick="wizClearSigKlant()">Wissen</button>
      <div class="wiz-sig-status" id="sig-klant-status">Nog niet getekend</div>
    </div>`;
  requestAnimationFrame(() => {
    // Vul de rapport-preview iframe (na render zodat het DOM beschikbaar is)
    const frame = document.getElementById('rapport-preview-frame');
    if (frame) frame.srcdoc = previewHtml;

    const canvas = document.getElementById('sig-klant-canvas');
    const wrap   = document.getElementById('sig-klant-wrap');
    canvas.width  = wrap.offsetWidth;
    canvas.height = wrap.offsetHeight || Math.max(260, window.innerHeight * 0.38);
    if (window.SignaturePad) {
      _sigKlant = new SignaturePad(canvas, { penColor: '#181e24', backgroundColor: '#ffffff' });
      _sigKlant.addEventListener('endStroke', () => {
        document.getElementById('sig-klant-hint').style.display = 'none';
        const st = document.getElementById('sig-klant-status');
        if (st) { st.textContent = '✅ Getekend'; st.style.color = 'var(--accent)'; }
        wrap.classList.add('has-sig');
      });
      // Terugnavigeren mag een eerder getekende handtekening niet wissen.
      if (R.handtekeningKlant) {
        _sigKlant.fromDataURL(R.handtekeningKlant);
        document.getElementById('sig-klant-hint').style.display = 'none';
        const st = document.getElementById('sig-klant-status');
        if (st) { st.textContent = '✅ Getekend'; st.style.color = 'var(--accent)'; }
        wrap.classList.add('has-sig');
      }
    }
  });
}
export function wizClearSigKlant() {
  if (_sigKlant) {
    _sigKlant.clear();
    R.handtekeningKlant = null;
    const hint = document.getElementById('sig-klant-hint');
    if (hint) hint.style.display = '';
    const st = document.getElementById('sig-klant-status');
    if (st) { st.textContent = 'Nog niet getekend'; st.style.color = ''; }
    document.getElementById('sig-klant-wrap')?.classList.remove('has-sig');
  }
}

// ── PDF ──
// Guard: voorkomt dubbele upload/archivering per wizard-sessie
export let _rapportUploaded = false;

// Bouwt de rapport-HTML-string zonder side effects (herbruikbaar voor preview + afdrukken).
export function buildRapportHtml() {
  const isInstallatie = R.interventieType === 'Installatie';
  const facturatieLabel = R.facturatie === 'vrij'
    ? (R.facturatieVrij || '—')
    : R.facturatie === 'klant' ? 'Klant' : 'Partner / installateur';
  const stLabel = {
    '2e-lijn': '2e lijns interventie',
    '1e-lijn': '1e lijns interventie',
    'garantie': 'Garantie',
  }[R.servicetype] || '—';
  const kabelStr = R.kabel === 'kabel'
    ? ('Vaste kabel' + (R.kabellengte ? ' ' + R.kabellengte : ''))
    : R.kabel === 'socket' ? 'Socket' : '';
  const productInfo = [R.type, R.uitvoering, kabelStr].filter(Boolean).join(' · ') || '—';
  const zohoRef     = _wizTicket.number ? `#${_wizTicket.number}` : (_wizTicket.isLocal ? '' : (_wizTicket.id || ''));
  const datumStr    = R.datum
    ? new Date(R.datum + 'T12:00:00').toLocaleDateString('nl-BE', { day:'numeric', month:'long', year:'numeric' })
    : '—';

  const geldigeOnderdelen  = R.onderdelen.filter(p => p.naam);
  const billableOnderdelen = geldigeOnderdelen.filter(p => p.factureren !== false);
  const totaalOnderdelen   = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
  // Loonkost hier al berekenen (i.p.v. enkel lokaal in de Loonkosten-tabel-IIFE verderop),
  // zodat het gecombineerde Kostenoverzicht onderaan dit bedrag kan hergebruiken zonder
  // bedragen op meerdere, verspreide plekken te tonen.
  const isGarantieTotaal = R.servicetype === 'garantie';
  const { bruto: brutoTotaal } = berekenLoonkost(R.servicetype, calcWerktijdMin(R.start, R.stop), parseInt(R.aanrijtijdMin) || 0);
  const nettoTotaal = isGarantieTotaal ? 0 : brutoTotaal;
  let partsHtml = geldigeOnderdelen
    .map(p => {
      const aantal      = parseInt(p.aantal) || 1;
      const factureren  = p.factureren !== false;
      const stukprijs   = parseFloat(p.prijs) || 0;
      const subtotaal   = stukprijs * aantal;
      return `<tr>
        <td>${escHtml(p.naam)}${!factureren ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(niet aangerekend)</span>' : ''}</td>
        <td style="text-align:center">${aantal}${p.eenheid==='meter' ? ' meter' : ''}</td>
        <td style="text-align:right">${factureren ? `€ ${stukprijs.toFixed(2)}` : '—'}</td>
        <td style="text-align:right">${factureren ? `€ ${subtotaal.toFixed(2)}` : '—'}</td>
      </tr>`;
    }).join('');
  const sigTechImg  = R.handtekeningTech
    ? `<img src="${R.handtekeningTech}" style="max-width:220px;max-height:90px;display:block">`
    : '<span style="color:#aaa;font-style:italic;font-size:9pt">(niet getekend)</span>';
  const sigKlantImg = R.handtekeningKlant
    ? `<img src="${R.handtekeningKlant}" style="max-width:220px;max-height:90px;display:block">`
    : '<span style="color:#aaa;font-style:italic;font-size:9pt">(niet getekend)</span>';

  const bolt = `<svg width="12" height="20" viewBox="0 0 14 22" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:5px">
    <line x1="9" y1="5" x2="6" y2="11" stroke="#00dfa3" stroke-width="3" stroke-linecap="round"/>
    <line x1="8" y1="12" x2="5" y2="18" stroke="#00dfa3" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

  const html = `<!DOCTYPE html>
<html lang="nl"><head>
<meta charset="utf-8">
<title>Service Rapport Blitz Power — ${R.datum}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#111;padding:13mm 17mm}
  .header{display:flex;align-items:center;margin-bottom:8px}
  .logo-text{font-size:15pt;font-weight:900;letter-spacing:4px;color:#181e24}
  .logo-sub{font-size:7pt;color:#999;letter-spacing:3px;margin-top:1px}
  .accent-bar{height:3px;background:#00dfa3;margin-bottom:14px}
  .sec{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;border-bottom:1px solid #ddd;padding-bottom:2px;margin:12px 0 7px;break-after:avoid;page-break-after:avoid}
  .rapport-section{break-inside:avoid;page-break-inside:avoid}
  .info-grid{display:grid;gap:6px;margin-bottom:4px}
  .info-row{display:grid;gap:6px}
  .info-row.cols-3{grid-template-columns:1fr 1fr 1fr}
  .info-row.cols-4{grid-template-columns:1fr 1fr 1fr 1fr}
  .info-row.cols-2{grid-template-columns:1fr 1fr}
  .info-row.cols-21{grid-template-columns:2fr 1fr}
  .info-row.cols-1{grid-template-columns:1fr}
  .info-cell{background:#f7f8f9;border:1px solid #e8e8e8;border-radius:4px;padding:6px 9px}
  .info-cell.accent{background:#f0fdf9;border-color:#b2edd8}
  .info-lbl{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:3px}
  .info-val{font-size:9.5pt;color:#111;font-weight:500;line-height:1.3}
  .block{border:1px solid #e0e0e0;border-radius:3px;padding:7px 9px;min-height:36px;font-size:9.5pt;white-space:pre-wrap;background:#fafafa}
  table.parts{width:100%;border-collapse:collapse;font-size:9pt}
  table.parts thead{display:table-header-group}
  table.parts tr{break-inside:avoid;page-break-inside:avoid}
  table.parts th{background:#f5f5f5;border:1px solid #ddd;padding:4px 7px;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;text-align:left}
  table.parts td{border:1px solid #ddd;padding:4px 7px}
  .status-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px}
  .status-cell{background:#f7f8f9;border:1px solid #e8e8e8;border-radius:4px;padding:6px 9px;font-size:9pt}
  .sig-row{display:flex;gap:20px;margin-top:7px}
  .sig-box{flex:1;border:1px solid #ccc;border-radius:3px;padding:7px 9px;min-height:105px}
  .sig-box-title{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:7px}
  .foto-report-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px}
  .foto-report-item{border:1px solid #e0e0e0;border-radius:4px;padding:4px;background:#fafafa;break-inside:avoid;page-break-inside:avoid}
</style>
</head><body>
<div class="header">${bolt}<div><div class="logo-text">BLITZ POWER</div><div class="logo-sub">SERVICE RAPPORT</div></div></div>
<div class="accent-bar"></div>
<div class="rapport-section info-grid">
  <div class="info-row cols-3">
    <div class="info-cell"><div class="info-lbl">Datum</div><div class="info-val">${datumStr}</div></div>
    <div class="info-cell"><div class="info-lbl">Technieker</div><div class="info-val">${R.technieker||'—'}</div></div>
    <div class="info-cell"><div class="info-lbl">#Zoho</div><div class="info-val">${escHtml(zohoRef)||'—'}</div></div>
  </div>
  <div class="info-row cols-1">
    <div class="info-cell"><div class="info-lbl">${isInstallatie ? 'Installatie adres' : 'Interventie adres'}</div><div class="info-val">${escHtml(R.adres)||'—'}</div></div>
  </div>
  <div class="info-row ${R.aanrijtijdMin > 0 ? 'cols-4' : 'cols-3'}">
    <div class="info-cell accent"><div class="info-lbl">Starttijd</div><div class="info-val">${R.start||'—'}</div></div>
    <div class="info-cell accent"><div class="info-lbl">Stoptijd</div><div class="info-val">${R.stop||'—'}</div></div>
    <div class="info-cell accent"><div class="info-lbl">Totale werktijd</div><div class="info-val">${R.werktijd||'—'}</div></div>
    ${R.aanrijtijdMin > 0 ? `<div class="info-cell accent"><div class="info-lbl">Aanrijtijd</div><div class="info-val">${fmtDuur(R.aanrijtijdMin)}</div></div>` : ''}
  </div>
  <div class="info-row ${isInstallatie ? 'cols-1' : 'cols-3'}">
    ${isInstallatie ? '' : `<div class="info-cell"><div class="info-lbl">Servicetype</div><div class="info-val">${stLabel}</div></div>
    <div class="info-cell"><div class="info-lbl">Facturatie aan</div><div class="info-val">${facturatieLabel}</div></div>`}
    <div class="info-cell"><div class="info-lbl">Installateur</div><div class="info-val">${escHtml(R.installateur)||'—'}</div></div>
  </div>
  <div class="info-row cols-2">
    <div class="info-cell"><div class="info-lbl">Serienummer</div><div class="info-val">${R.aantalLaadpalen > 1 ? `${escHtml(R.serienummer) || 'Geen serienummer'} (master) — ${R.aantalLaadpalen}×` : (escHtml(R.serienummer)||'—')}</div></div>
    <div class="info-cell"><div class="info-lbl">Type / uitvoering</div><div class="info-val">${productInfo}</div></div>
  </div>
</div>
<div class="rapport-section">
<div class="sec">${isInstallatie ? 'Omschrijving installatie' : 'Omschrijving probleem'}</div>
<div class="block">${escHtml(R.probleem)||'&nbsp;'}</div>
</div>
<div class="rapport-section">
<div class="sec">Ondernomen acties</div>
<div class="block">${escHtml(R.acties)||'&nbsp;'}</div>
</div>
${isInstallatie ? '' : `
<div class="rapport-section">
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
</div>`}
${R.fotos.length ? `<div class="sec">Foto's</div>
<div class="foto-report-grid">${R.fotos.map(f => `<div class="foto-report-item"><img src="${escHtml(f.dataUrl)}" style="max-width:100%;border-radius:3px"><div style="font-size:7.5pt;color:#777;margin-top:2px">${escHtml(new Date(f.tijdstip).toLocaleString('nl-BE'))}${f.caption ? ' — ' + escHtml(f.caption) : ''}</div></div>`).join('')}</div>` : ''}
${isInstallatie ? '' : `
<div class="rapport-section">
<div class="sec">Status laadinfrastructuur</div>
<div class="status-row">
  <div class="status-cell"><div class="info-lbl">Definitief hersteld</div><strong>${R.hersteld==='ja'?'Ja':'Nee'}</strong></div>
  <div class="status-cell"><div class="info-lbl">Nieuwe interventie nodig</div><strong>${R.nieuwInter==='ja'?'Ja':'Nee'}</strong></div>
</div>
</div>`}
${geldigeOnderdelen.length ? `<div class="sec">${isInstallatie ? 'Gebruikte materialen' : 'Vervangen onderdelen'}</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:center">Aantal</th><th style="text-align:right">Stukprijs</th><th style="text-align:right">Subtotaal</th></tr></thead>
<tbody>${partsHtml}</tbody></table>` : ''}
${R.varia ? `<div class="rapport-section"><div class="sec">Varia</div><div class="block">${escHtml(R.varia)}</div></div>` : ''}
${isInstallatie ? '' : (() => {
  const wMin = calcWerktijdMin(R.start, R.stop);
  const aMin = parseInt(R.aanrijtijdMin) || 0;
  const st   = R.servicetype;
  const { bruto, totMin, extraUren } = berekenLoonkost(st, wMin, aMin);
  const isGarantie = st === 'garantie';
  const netto = isGarantie ? 0 : bruto;

  const fmtMin = m => {
    const h = Math.floor(m / 60), mn = m % 60;
    return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
  };

  let detail = '';
  if (st === '2e-lijn') {
    const delen = [];
    if (aMin) delen.push(`Aanrijtijd: ${fmtMin(aMin)}`);
    delen.push(`Werktijd: ${fmtMin(wMin)}`);
    delen.push(`Totaal: ${fmtMin(totMin)} → forfait €175 (eerste 3u)`);
    if (extraUren > 0) delen.push(`${extraUren} extra gestart${extraUren > 1 ? 'e' : ''} uur × €75 = €${extraUren * 75}`);
    detail = delen.join(' &nbsp;·&nbsp; ');
  } else if (st === '1e-lijn') {
    const delen = [];
    if (aMin) delen.push(`Aanrijtijd: ${fmtMin(aMin)}`);
    delen.push(`Werktijd: ${fmtMin(wMin)}`);
    const gu = Math.ceil(totMin / 60);
    delen.push(`Totaal: ${fmtMin(totMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115`);
    detail = delen.join(' &nbsp;·&nbsp; ');
  } else {
    const delen = [];
    if (aMin) delen.push(`Aanrijtijd: ${fmtMin(aMin)}`);
    delen.push(`Werktijd: ${fmtMin(wMin)}`);
    const gu = Math.ceil(totMin / 60);
    delen.push(`Totaal: ${fmtMin(totMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115 — volledig gedekt door garantie`);
    detail = delen.join(' &nbsp;·&nbsp; ');
  }

  const nettoCel = isGarantie
    ? `<td style="text-align:right"><span style="text-decoration:line-through;color:#aaa;font-size:8pt">€ ${bruto.toFixed(2)}</span> &nbsp; <strong style="color:#00b87a">€ 0,00</strong></td>`
    : `<td style="text-align:right"><strong>€ ${netto.toFixed(2)}</strong></td>`;

  return `<div class="sec">Loonkosten</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:right">Bedrag (excl. btw)</th></tr></thead>
<tbody>
<tr>
  <td>${stLabel}${isGarantie ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}<br>
    <span style="font-size:7.5pt;color:#777">${detail}</span></td>
  ${nettoCel}
</tr>
</tbody></table>`;
})()}
<div class="rapport-section">
<div class="sec">Kostenoverzicht</div>
<table class="parts"><tbody>
<tr><td>Onderdelen (excl. btw)</td><td style="text-align:right">€ ${totaalOnderdelen.toFixed(2)}</td></tr>
${isInstallatie ? '' : `<tr><td>Loonkosten (excl. btw)${isGarantieTotaal ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}</td><td style="text-align:right">€ ${nettoTotaal.toFixed(2)}</td></tr>`}
<tr style="background:#111;color:#fff;font-weight:700"><td style="text-transform:uppercase;letter-spacing:.05em;font-size:8pt">Totaal te factureren (excl. btw)</td><td style="text-align:right;font-size:11pt">€ ${(totaalOnderdelen + (isInstallatie ? 0 : nettoTotaal)).toFixed(2)}</td></tr>
</tbody></table>
</div>
<div class="rapport-section">
<div class="sec">Handtekeningen</div>
<div class="sig-row">
  <div class="sig-box"><div class="sig-box-title">Technieker</div>${sigTechImg}</div>
  <div class="sig-box"><div class="sig-box-title">Klant</div>${sigKlantImg}</div>
</div>
</div>
</body></html>`;

  return html;
}

export async function printRapport() {
  // Venster synchroon openen, vóór elke await. Browsers laten window.open() enkel toe
  // binnen de korte "transient user activation" na de klik (Chrome: ~5s). Wachten we
  // eerst de outbox-poging af (tot 5s), dan is die activation op het trage/offline-pad
  // — precies het scenario waarvoor deze flow bestaat — net verlopen en blokkeert de
  // browser het afdrukvoorbeeld alsnog. html/blob/blobUrl zijn stuk voor stuk synchroon
  // te berekenen (geen enkele await nodig), dus window.open() kan de echte inhoud meteen
  // krijgen — geen tussentijds leeg tabblad nodig, en dus ook geen risico dat dat lege
  // tabblad blijft hangen als de tab intussen naar de achtergrond gaat.
  const html    = buildRapportHtml();
  const blob    = new Blob([html], { type: 'text/html; charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const win     = window.open(blobUrl, '_blank');
  if (!win) {
    toast('Pop-upblokkering actief — sta pop-ups toe voor deze pagina');
  }

  // Wachtrij-item aanmaken en proberen te verzenden vóórdat het afdrukvoorbeeld
  // gevuld wordt — op mobiel duwt het openen van de tab de app naar de achtergrond,
  // en dat mocht niet meer gelijktijdig lopen met de niet-afgewachte verzending zoals
  // voorheen (zie design doc 2026-08-11-rapport-verzend-betrouwbaarheid-design.md,
  // "Root cause").
  if (!_rapportUploaded) {
    _rapportUploaded = true;

    // Alles hieronder in try/catch: faalt de IndexedDB-schrijfactie (quota vol,
    // privémodus, geblokkeerde DB), dan mag dat printRapport niet afbreken.
    // _rapportUploaded staat immers al op true, dus een tweede poging in dezelfde
    // wizard-sessie zou dit blok overslaan en het rapport stil verloren laten gaan.
    // We tonen daarom een duidelijke fout, maar lopen sowieso door naar het
    // afdrukvoorbeeld en het sluiten van de wizard.
    try {
      const totaal = R.onderdelen
        .filter(p => p.naam && p.factureren !== false)
        .reduce((s, p) => s + (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1), 0);

      const item = {
        id:           crypto.randomUUID(),
        html,
        isLocal:      !!_wizTicket.isLocal,
        archived:     false,
        zohoUploaded: false,
        attempts:     0,
        lastError:    null,
        createdAt:    new Date().toISOString(),
        ticket: {
          id:       _wizTicket.id   || '',
          number:   _wizTicket.number || '',
          filename: `rapport-${_wizTicket.number || _wizTicket.id}-${R.datum || 'onbekend'}.pdf`,
        },
        archiveBody: {
          datum:            R.datum,
          technieker:       R.technieker,
          ticketId:         _wizTicket.id   || '',
          ticketNumber:     _wizTicket.number ? String(_wizTicket.number) : '',
          klant:            _wizTicket.contact || _wizTicket.account || '',
          adres:            R.adres,
          nieuwInter:       R.nieuwInter,
          hersteld:         R.hersteld,
          servicetype:      R.servicetype,
          facturatie:       R.facturatie,
          prioriteit:       _wizTicket.priority || '',
          interventieType:  R.interventieType || 'Interventie',
          totaalOnderdelen: totaal,
          rapportData:      { ...R, _html: html },
          // Geen 'versie' hier — dedup gebeurt server-side op ticketId+datum
          // (rapport-archief.js), zodat opgestapelde wachtrij-items elkaar niet
          // vals-positief als conflict blokkeren.
        },
      };

      await outboxAdd(item);
      await refreshOutboxCache();

      // Post-launch feedback (2026-08-17): geen apart "Oplossing invoeren"-knopje meer -- de
      // uitgevoerde acties staan toch al hier (R.acties), dus die worden meteen als oplossing op
      // het Zoho-ticket gezet. Enkel zinvol bij een echt gekoppeld ticket (niet bij een lokale,
      // manueel toegevoegde afspraak) en enkel als er effectief iets ingevuld is. Best-effort,
      // niet afgewacht: mag de rapport-verzending zelf niet vertragen of laten falen.
      if (!item.isLocal && R.acties?.trim()) {
        window.syncOplossingNaarZoho?.(item.ticket.id, R.acties);
      }

      // Zelfde best-effort-aanpak als hierboven: wagenvoorraad-aftrek voor gebruikt materiaal
      // mag het afronden van het rapport nooit vertragen of laten falen (zie
      // docs/superpowers/specs/2026-08-20-inventarissysteem-design.md, "Randgevallen").
      registreerVerbruik(R.technieker, R.onderdelen).catch(err =>
        console.warn('Inventaris-aftrek mislukt (niet blokkerend):', err));

      const TIMEOUT_MS = 5000;
      const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), TIMEOUT_MS));
      const result  = await Promise.race([runOutboxItem(item), timeout]);

      if (result === 'timeout') {
        toast('⏳ Rapport wordt verstuurd — je kan gewoon verder, dit gebeurt op de achtergrond', 5000);
      } else if (nextOutboxAction(result) === 'done') {
        toast(item.isLocal
          ? '✅ Rapport opgeslagen in archief — geen Zoho-ticket gekoppeld'
          : '✅ Rapport bewaard en doorgestuurd naar Zoho', 4500);
      } else {
        toast('⏳ Rapport nog niet bevestigd — wordt automatisch opnieuw geprobeerd', 5000);
      }

      await refreshOutboxCache();
      renderRapportArchief();
    } catch (err) {
      toast('⚠️ Rapport kon niet lokaal bewaard worden — controleer opslagruimte, herlaad de pagina en probeer opnieuw', 6000);
      console.warn('printRapport: onverwachte fout bij het wegschrijven naar de outbox:', err);
    }
  }

  if (win) {
    // Revoke na 2 min — genoeg tijd om te printen
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
  } else {
    URL.revokeObjectURL(blobUrl);
  }

  // Wizard sluiten na geslaagd rapport — geen bevestigingsdialoog meer nodig
  document.getElementById('rapport-wizard').classList.remove('open');
}

// ── Window-bridge ──
// Alle wiz*-functies die in index.html via onclick=/oninput=/onchange= aangeroepen worden
// (bevestigd met: grep -no 'onclick="[^"]*"\|oninput="[^"]*"\|onchange="[^"]*"' public/index.html
// | grep -iE 'wiz|handleWizFotoFiles|updateWerktijd|openRapport|closeWizard|printRapport'), plus de
// interne addEventListener-gebruikte functies (wizVoegCatToe/wizToggleTagFilter — data-attribuut-
// patroon, zie comments hierboven) en de wizAddPart/wizUpdatePart compat-aliassen, voor
// consistentie met de rest van deze lijst.
window.openRapport          = openRapport;
window.closeWizard          = closeWizard;
window.wizNext               = wizNext;
window.wizBack               = wizBack;
window.updateWerktijd        = updateWerktijd;
window.wizFacturatieChange   = wizFacturatieChange;
window.wizServicetypeChange  = wizServicetypeChange;
window.wizLoonkostPreview    = wizLoonkostPreview;
window.wizKabelChange        = wizKabelChange;
window.handleWizFotoFiles    = handleWizFotoFiles;
window.wizCatFilter          = wizCatFilter;
window.wizToggleTagFilter    = wizToggleTagFilter;
window.wizVoegCatToe         = wizVoegCatToe;
window.wizAddVrijeRegel      = wizAddVrijeRegel;
window.wizRemovePart         = wizRemovePart;
window.wizUpdSelNaam         = wizUpdSelNaam;
window.wizUpdSelAantal       = wizUpdSelAantal;
window.wizUpdSelPrijs        = wizUpdSelPrijs;
window.wizUpdSelFact         = wizUpdSelFact;
window.wizUpdSelEenheid      = wizUpdSelEenheid;
window.wizAddPart            = wizAddPart;
window.wizUpdatePart         = wizUpdatePart;
window.wizClearSigTech       = wizClearSigTech;
window.wizClearSigKlant      = wizClearSigKlant;
window.printRapport          = printRapport;

// calcWerktijdMin wordt OOK gebruikt buiten dit blok, in de planning/autoPlan-code
// (index.html, berekening van bezette tijd per dag — `calcWerktijdMin(ev.uur, ev.einduur)`).
// Dat blijft een kale aanroep in een classic <script> — die lost een onbekende identifier op
// via de globale scope-chain (window), dus enkel deze bridge is nodig, geen wijziging daar.
window.calcWerktijdMin = calcWerktijdMin;

// berekenLoonkost wordt ook aangeroepen vanuit rapport-archief.js (renderRapportArchief,
// voor de prijsweergave op archiefkaarten) — zonder deze bridge gooit dat een
// ReferenceError zodra er een archiefkaart met werktijd > 0 gerenderd wordt.
window.berekenLoonkost = berekenLoonkost;

// _fotoState wordt van BUITEN dit bestand zowel gelezen ALS herwezen: index.html's
// openFotoModal()/persistFotoChange()/handleFotoFiles() (het generieke foto-beheer voor de
// ticket-detail "Foto's"-knop, NIET onderdeel van de wizard-brief) delen dit ene state-object
// met de wizard-stap "Foto's" (openRapport/wizRenderFotos/wizSaveFotos/handleWizFotoFiles
// hierboven). openFotoModal() doet `_fotoState = { ticketId, versie, fotos }` — een volledige
// herwijzing, niet enkel een mutatie — dus is een statische `window._fotoState = _fotoState`
// hier fout (zou na de eerste foto-actie een verouderde momentopname vastzetten). Vandaar
// dezelfde live getter/setter-accessor als bij _archiefVersie (Task 2, rapport-archief.js):
Object.defineProperty(window, '_fotoState', {
  get: () => _fotoState,
  set: (v) => { _fotoState = v; },
  configurable: true,
});
