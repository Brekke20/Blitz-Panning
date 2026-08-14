// public/js/excel-export.js
// Genereert het TicketLog Excel-exportbestand (ExcelJS, zie CLAUDE.md — nooit SheetJS
// gebruiken, silent style-bug). Leest gearchiveerde rapport-data, schrijft niets terug.

export async function exportTicketLog() {
  if (!_rapportArchief.length) return toast('Geen rapporten beschikbaar om te exporteren', 2500);

  const vanVal = document.getElementById('rapp-van')?.value;
  const totVal = document.getElementById('rapp-tot')?.value;

  let rows = _rapportArchief;
  if (vanVal) rows = rows.filter(r => r.datum >= vanVal);
  if (totVal) rows = rows.filter(r => r.datum <= totVal);

  if (!rows.length) return toast('Geen rapporten in dit datumbereik', 2500);

  toast('📊 Excel wordt opgemaakt…', 3000);

  const vanLabel = vanVal || 'begin';
  const totLabel = totVal || 'huidig';

  const PRIO_NL   = { high: 'Hoog', medium: 'Middel', low: 'Laag' };
  const PRIO_ARGB = {
    Hoog:   { font: 'FFFFFFFF', fill: 'FFC00000' },
    Middel: { font: 'FF7B3F00', fill: 'FFFFC000' },
    Laag:   { font: 'FFFFFFFF', fill: 'FF375623' },
  };

  const headers = [
    'Ticket ID', 'Datum open', 'Datum interventie',
    'Technieker', 'Klant / Installateur', 'Type', 'Prio',
    'Installateur betrokken', 'Uren besteed', 'Status',
    'Remote opgelost', 'Garantiegeval', 'Component verzenden',
    'Componentbeschrijving', 'Factureerbaar', 'Bedrag EUR',
    'Factuur verzonden', 'Dagen open', 'SLA-flag',
    'PB', 'Notities', 'Actie', 'Oorzaak storing',
  ];
  const ncols = headers.length; // 23

  // 0-indexed kolommen met wrapText (lange tekst)
  // N=13 (Componentbeschrijving), U=20 (Notities), V=21 (Actie), W=22 (Oorzaak storing)
  const WRAP_COLS  = new Set([13, 20, 21, 22]);
  const WRAP_MAX   = { 13: 42, 20: 58, 21: 58, 22: 40 };

  const data = rows.map(r => {
    const rd                = r.rapportData || {};
    const onderdelen         = (rd.onderdelen || []).filter(p => p.naam);
    const billableOnderdelen = onderdelen.filter(p => p.factureren !== false);
    const totaal             = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
    const fac                = billableOnderdelen.length > 0 ? 'Ja' : 'Nee';
    const cmp        = onderdelen.map(p => `${p.naam}${parseInt(p.aantal) > 1 ? ' ×' + p.aantal : ''}`).join('; ');

    let uren = '';
    if (rd.werktijd) {
      uren = rd.werktijd;
    } else if (rd.start && rd.stop) {
      const [sh, sm] = rd.start.split(':').map(Number);
      const [eh, em] = rd.stop.split(':').map(Number);
      const min = (eh * 60 + em) - (sh * 60 + sm);
      if (min > 0) uren = (min / 60).toFixed(2).replace('.', ',');
    }

    const prioNl   = PRIO_NL[(r.prioriteit || '').toLowerCase()] || r.prioriteit || '';
    const garantie = (rd.servicetype || r.servicetype) === 'garantie' ? 'Ja' : 'Nee';
    const type     = r.interventieType || rd.interventieType || 'Interventie';

    return [
      r.ticketNumber || r.ticketId || '',          // A
      '',                                           // B
      r.datum || '',                                // C
      r.technieker || '',                           // D
      r.klant || rd.installateur || '',             // E
      type,                                         // F
      prioNl,                                       // G
      rd.installateur ? 'Ja' : 'Nee',              // H
      uren,                                         // I
      type === 'Installatie' ? 'Afgerond' : (r.hersteld === 'ja' ? 'Gesloten' : 'Open'),   // J
      '',                                           // K
      garantie,                                     // L
      '',                                           // M
      cmp,                                          // N
      fac,                                          // O
      totaal > 0 ? parseFloat(totaal.toFixed(2)) : '', // P
      '', '', '', '',                               // Q R S T
      rd.probleem || '',                            // U: Notities
      rd.acties   || '',                            // V: Actie
      (rd.oorzaakStoring || []).join(', '),          // W: Oorzaak storing
    ];
  });

  // Auto-bereken kolombreedte op basis van header + data-inhoud
  const colWidths = headers.map((h, i) => {
    const hLen   = h.length + 2;
    const maxVal = data.reduce((m, row) => Math.max(m, String(row[i] || '').length + 1), 0);
    const raw    = Math.max(hLen, maxVal, 8);
    return WRAP_COLS.has(i) ? Math.min(raw, WRAP_MAX[i] || 50) : Math.min(raw, 36);
  });

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Blitz Planning';
    const ws = wb.addWorksheet('TicketLog');

    ws.columns = colWidths.map(w => ({ width: w }));

    // Freeze pane onder rij 3
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, activeCell: 'A4' }];

    // Rij 1 — Titel
    const r1 = ws.addRow(Array(ncols).fill(''));
    r1.height = 26;
    ws.mergeCells(1, 1, 1, ncols);
    Object.assign(r1.getCell(1), {
      value:     'TICKETLOG — BLITZ POWER',
      font:      { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101820' } },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });

    // Rij 2 — Subtitel
    const r2 = ws.addRow(Array(ncols).fill(''));
    r2.height = 16;
    ws.mergeCells(2, 1, 2, ncols);
    Object.assign(r2.getCell(1), {
      value:     `Periode: ${vanLabel} → ${totLabel}  |  Export: ${new Date().toLocaleDateString('nl-BE')}  |  ${rows.length} record${rows.length !== 1 ? 's' : ''}`,
      font:      { size: 9, color: { argb: 'FFAAAAAA' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101820' } },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });

    // Rij 3 — Headers (geen wrapText — kolombreedte zorgt voor leesbaarheid)
    const r3 = ws.addRow(headers);
    r3.height = 22;
    for (let c = 1; c <= ncols; c++) {
      const cell     = r3.getCell(c);
      cell.font      = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border    = { bottom: { style: 'medium', color: { argb: 'FF00DFA3' } } };
    }

    // Autofilter op headerrij
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: ncols } };

    // Datarijen met auto-hoogte voor wrapped cellen
    const PRIO_COL = 7; // kolom G (ExcelJS 1-indexed)
    data.forEach((rowData, ri) => {
      const row = ws.addRow(rowData);

      // Bereken rijhoogte op basis van langste wrapped tekst
      let maxLines = 1;
      WRAP_COLS.forEach(i => {
        const text  = String(rowData[i] || '');
        if (!text) return;
        const cpl   = colWidths[i] * 1.15; // geschatte chars per regel
        const lines = Math.max(1, Math.ceil(text.length / cpl));
        maxLines    = Math.max(maxLines, lines);
      });
      row.height = Math.max(15, maxLines * 14 + 2);

      const rowBg = ri % 2 === 0 ? 'FFFFFFFF' : 'FFEEF2F7';
      const prio  = rowData[PRIO_COL - 1]; // 0-indexed
      for (let c = 1; c <= ncols; c++) {
        const i    = c - 1;
        const cell = row.getCell(c);
        if (c === PRIO_COL && PRIO_ARGB[prio]) {
          cell.font      = { bold: true, size: 9, color: { argb: PRIO_ARGB[prio].font } };
          cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIO_ARGB[prio].fill } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.font      = { size: 9 };
          cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          cell.alignment = { vertical: WRAP_COLS.has(i) ? 'top' : 'middle', wrapText: WRAP_COLS.has(i) };
        }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
      }
    });

    // Download
    const buffer = await wb.xlsx.writeBuffer();
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href       = url;
    a.download   = `TicketLog_${vanLabel}_${totLabel}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast(`✓ ${rows.length} rijen geëxporteerd`, 2500);
  } catch (err) {
    toast(`❌ Export mislukt: ${err.message}`, 4000);
    console.error('exportTicketLog:', err);
  }
}

window.exportTicketLog = exportTicketLog;
