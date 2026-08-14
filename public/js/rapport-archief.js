// public/js/rapport-archief.js
// Overzicht van gearchiveerde rapporten (interventie + installatie), met filter op type en
// Excel-export-aanroep (zie excel-export.js). Leest `R`/rapport-records uit de outbox-archivering.

export let _rapportArchief = [];
// null = archief nog niet geladen deze sessie (bv. rapport gesloten zonder ooit het
// Rapporten-tabblad te openen) → server-check slaat de versie-vergelijking dan over
// (typeof null !== 'number'), net als bij een niet-herladen oud tabblad.
export let _archiefVersie = null;

// _rapportFilter is enkel intern gebruikt door setRapportFilter/renderRapportArchief hieronder —
// geen andere plek in de app leest of schrijft dit, dus geen window-bridge nodig.
let _rapportFilter = 'alle'; // 'alle' | 'Interventie' | 'Installatie'

export async function laadRapportArchief() {
  const body = document.getElementById('rapp-archief-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--muted);font-size:0.82rem">Laden…</div>';
  try {
    const res  = await fetch('/api/rapport-archief');
    const data = await res.json();
    _rapportArchief = data.rapports || [];
    _archiefVersie = data.versie || 0;
    renderRapportArchief();
    renderKalender();
  } catch (err) {
    body.innerHTML = `<div style="color:var(--red);font-size:0.82rem">❌ Laden mislukt: ${err.message}</div>`;
  }
}

export function setRapportFilter(type) {
  _rapportFilter = type;
  document.querySelectorAll('.rapp-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === type);
  });
  renderRapportArchief();
}

export function renderRapportArchief() {
  const body = document.getElementById('rapp-archief-body');
  if (!body) return;
  if (!_rapportArchief.length) {
    body.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;padding:20px 0">Nog geen rapporten gearchiveerd.</div>';
    return;
  }
  const gefilterd = _rapportFilter === 'alle'
    ? _rapportArchief
    : _rapportArchief.filter(r => (r.interventieType || 'Interventie') === _rapportFilter);
  if (!gefilterd.length) {
    body.innerHTML = `<div style="color:var(--muted);font-size:0.82rem;padding:20px 0">Geen rapporten van het type "${escHtml(_rapportFilter)}" gevonden.</div>`;
    return;
  }
  body.innerHTML = gefilterd.map((r, i) => {
    const datumStr  = r.datum
      ? new Date(r.datum + 'T12:00:00').toLocaleDateString('nl-BE', { weekday:'short', day:'numeric', month:'short', year:'numeric' })
      : '—';
    // ── Prijs berekenen ──
    const rd       = r.rapportData || {};
    const isInstallatieRapport = (r.interventieType || rd.interventieType || 'Interventie') === 'Installatie';
    const hersteld  = isInstallatieRapport
      ? '<span style="color:var(--accent);font-weight:600">🔧 Installatie</span>'
      : r.hersteld === 'ja'
        ? '<span style="color:var(--green);font-weight:600">✓ Hersteld</span>'
        : '<span style="color:var(--orange)">⚠ Niet hersteld</span>';
    const nieuw     = (!isInstallatieRapport && r.nieuwInter === 'ja') ? '<span style="color:var(--orange)">🔁 Nieuwe interventie</span>' : '';
    const inWachtrij = _outboxItems.some(o => o.id === r.id)
      ? '<span style="color:var(--accent);font-weight:600">⏳ In wachtrij</span>'
      : '';
    const st       = rd.servicetype || r.servicetype || '';
    const isGarantie = st === 'garantie';
    const wMin     = calcWerktijdMin(rd.start, rd.stop);
    const aMin     = parseInt(rd.aanrijtijdMin) || 0;
    const { bruto: loonBruto } = wMin > 0 ? berekenLoonkost(st, wMin, aMin) : { bruto: 0 };
    const loonNetto = (isGarantie || isInstallatieRapport) ? 0 : loonBruto;

    const billableOnderdelen = (rd.onderdelen || []).filter(p => p.naam && p.factureren !== false);
    const totOnderdelen = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
    const totFactureerbaar = loonNetto + totOnderdelen;

    // Labels voor servicetype
    const stLabels = { '2e-lijn': '2e lijns', '1e-lijn': '1e lijns', 'garantie': 'Garantie' };
    const stBadge = (st && !isInstallatieRapport) ? `<span style="font-size:0.68rem;padding:1px 6px;border-radius:20px;font-weight:600;background:${isGarantie ? 'var(--surface3)' : 'var(--accent-dim)'};color:${isGarantie ? 'var(--muted)' : 'var(--accent)'}">${stLabels[st] || st}</span>` : '';

    // Prijsweergave
    let prijsHtml = '';
    if (isGarantie) {
      // Bij garantie is enkel het loon 100% korting — onderdelen blijven factureerbaar
      // (zelfde regel als in buildRapportHtml: "100% korting" geldt op de loonkosten-post, niet op onderdelen).
      const rows = [];
      if (loonBruto > 0) {
        rows.push(`<span style="font-size:0.68rem;color:var(--muted);display:block">Loon niet factureerbaar (garantie): <s>€ ${loonBruto.toFixed(2)}</s></span>`);
      }
      if (totOnderdelen > 0) {
        rows.push(`<span style="font-size:0.85rem;font-weight:700;color:var(--accent)">Onderdelen factureerbaar: € ${totOnderdelen.toFixed(2)}</span>`);
      }
      if (rows.length) {
        prijsHtml = `<span style="margin-left:auto;text-align:right;line-height:1.3">${rows.join('')}</span>`;
      }
    } else if (totFactureerbaar > 0) {
      prijsHtml = `<span style="margin-left:auto;text-align:right;line-height:1.3">
        <span style="font-size:0.68rem;color:var(--muted);display:block">Factureerbaar</span>
        <span style="font-size:0.85rem;font-weight:700;color:var(--accent)">€ ${totFactureerbaar.toFixed(2)}</span>
      </span>`;
    }

    const rapportId = r.id || '';
    const origIdx = _rapportArchief.indexOf(r);

    return `<div class="ticket" style="margin-bottom:8px">
      <div class="t-body">
        <div class="t-top" style="flex-wrap:wrap;gap:4px;align-items:flex-start">
          ${r.ticketNumber ? `<span class="tnum">#${escHtml(r.ticketNumber)}</span>` : ''}
          <span style="font-size:0.72rem;color:var(--muted)">${datumStr}</span>
          ${r.technieker ? `<span class="atag">${escHtml(r.technieker)}</span>` : ''}
          ${stBadge}
          ${hersteld} ${nieuw} ${inWachtrij}
          ${prijsHtml}
        </div>
        ${r.klant ? `<div class="tsub">${escHtml(r.klant)}</div>` : ''}
        ${r.adres ? `<div class="taddr ok">${escHtml(r.adres)}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
          ${rd._html ? `<button class="cal-btn" onclick="herOpenRapport(${origIdx})">📄 Openen</button>` : ''}
          ${(rapportId && rd._html && r.ticketId) ? `<button class="cal-btn btn-verstuur-rapport" data-rapport-id="${escHtml(rapportId)}" title="${(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur) ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur)) + ' — opnieuw versturen?' : ''}">${(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur) ? '✅ Verzonden' : '✉️ Verstuur rapport'}</button>` : ''}
          ${rapportId ? `<button class="cal-btn btn-verwijder-rapport" style="color:var(--red);border-color:var(--red)" data-rapport-id="${escHtml(rapportId)}" data-ticket-ref="${escHtml(r.ticketNumber||r.ticketId||'?')}" data-datum="${escHtml(datumStr)}">🗑 Verwijderen</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  // De archiefvelden komen uit de rapport-archief blob (niet-geauthenticeerd). Een inline
  // onclick met JS-strings is daar niet veilig voor: HTML-entities in een attribuut worden
  // gedecodeerd vóórdat de handler als JS gecompileerd wordt, dus escHtml()'s &#39; wordt
  // weer een echte apostrof. Daarom data-attributen + addEventListener (zelfde patroon als
  // de .btn-navigeer-knoppen).
  body.querySelectorAll('.btn-verstuur-rapport').forEach(btn => {
    btn.addEventListener('click', () => voorbeeldRapport(btn.dataset.rapportId || '', btn));
  });

  body.querySelectorAll('.btn-verwijder-rapport').forEach(btn => {
    btn.addEventListener('click', () => verwijderRapport(
      btn.dataset.rapportId || '',
      btn.dataset.ticketRef || '',
      btn.dataset.datum     || '',
    ));
  });
}

export async function verwijderRapport(id, ticketRef, datumStr) {
  if (!confirm(`Rapport verwijderen?\n\nTicket: ${ticketRef}\nDatum: ${datumStr}\n\nDeze actie kan niet ongedaan worden gemaakt.`)) return;
  try {
    const res = await fetch('/api/rapport-archief', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, versie: _archiefVersie }),
    });
    const data = await res.json();
    if (res.status === 409) {
      toast('⚠️ Archief gewijzigd — herlaad de pagina en probeer opnieuw', 5000);
      return;
    }
    if (!res.ok) throw new Error(data.error || res.status);
    if (typeof data.versie === 'number') _archiefVersie = data.versie;
    toast('✅ Rapport verwijderd');
    await laadRapportArchief();
  } catch (err) {
    toast('❌ Verwijderen mislukt: ' + err.message);
  }
}

export function herOpenRapport(idx) {
  const r = _rapportArchief[idx];
  if (!r?.rapportData?._html) return toast('Geen opgeslagen HTML beschikbaar');
  // rapportData._html komt uit de niet-geauthenticeerde rapport-archief blob. Een blob:-URL
  // erft de origin van deze app, dus script in die opgeslagen HTML zou met volledige
  // app-rechten lopen (localStorage, /api/*, ...). Daarom niet meer als top-level document
  // openen, maar renderen in een sandboxed iframe ZONDER allow-scripts. allow-same-origin
  // staat er alleen bij om de inhoudshoogte te kunnen meten (zie hieronder); zonder
  // allow-scripts kan die origin niet misbruikt worden en draait er geen enkel script —
  // ook niet in geneste iframes, want sandbox-flags worden geërfd.
  const win = window.open('', '_blank');
  if (!win) return toast('Pop-upblokkering actief');
  win.document.write(
    '<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8">' +
    '<title>Service rapport</title>' +
    '<style>html,body{margin:0;padding:0;background:#fff}iframe{display:block;width:100%;border:0}</style>' +
    '</head><body></body></html>'
  );
  win.document.close();
  const frame = win.document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin'); // géén allow-scripts
  frame.style.height = '100vh';
  // Meegroeien met de inhoud zodat de volledige rapportinhoud zichtbaar/printbaar blijft.
  frame.addEventListener('load', () => {
    try {
      const h = frame.contentDocument?.documentElement?.scrollHeight;
      if (h) frame.style.height = h + 'px';
    } catch { /* hoogte niet meetbaar → viewporthoogte met eigen scrollbar blijft staan */ }
  });
  win.document.body.appendChild(frame);
  frame.srcdoc = r.rapportData._html;
}

window.renderRapportArchief = renderRapportArchief;
window.laadRapportArchief   = laadRapportArchief;
window.setRapportFilter     = setRapportFilter;
window.verwijderRapport     = verwijderRapport;
window.herOpenRapport       = herOpenRapport;

// _rapportArchief wordt van BUITEN dit bestand rechtstreeks gelezen (niet enkel via de functies
// hierboven): de kalenderweergave in index.html (herOpenRapport(_rapportArchief.indexOf(entry)),
// _rapportArchief.filter(...) voor dagoverzichten) en exportTicketLog (Excel-export, zit in
// public/js/excel-export.js) lezen dit array rechtstreeks. laadRapportArchief() vervangt het array bovendien
// telkens door een NIEUW array (geen in-place mutatie), dus een statische
// `window._rapportArchief = _rapportArchief`-toewijzing zou na de eerste herlaad alweer verouderd
// zijn — vandaar een live getter, net als bij _outboxItems in outbox.js (Task 1). Niets buiten dit
// bestand herschrijft het array zelf (enkel lezen), dus enkel een getter is nodig.
Object.defineProperty(window, '_rapportArchief', {
  get: () => _rapportArchief,
  configurable: true,
});

// _archiefVersie wordt van BUITEN dit bestand gebruikt (o.a. door de rapport-wizard-module bij het
// versturen/archiveren, en door outbox.js's attemptOutboxItem) — net als bij PRIJZEN in Task 4 is
// dit een `let`, dus een statische `window._archiefVersie = _archiefVersie` zou een momentopname
// vastzetten. Gebruik in plaats daarvan dezelfde live-accessor die Task 1 al gebruikte:
Object.defineProperty(window, '_archiefVersie', {
  get: () => _archiefVersie,
  set: (v) => { _archiefVersie = v; },
  configurable: true,
});
