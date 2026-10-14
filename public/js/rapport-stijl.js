// public/js/rapport-stijl.js
// De stijl van het servicerapport (buildRapportHtml in rapport-wizard.js). Eén bron: het rapport zelf en de afdrukkopie in het
// archiefvenster (rapport-archief.js) gebruiken deze vertrouwde stijl; de stijl uit een opgeslagen rapport wordt nooit overgenomen.
export const RAPPORT_CSS = `
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
  .status-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px;break-inside:avoid;page-break-inside:avoid}
  .status-cell{background:#f7f8f9;border:1px solid #e8e8e8;border-radius:4px;padding:6px 9px;font-size:9pt}
  .sig-row{display:flex;gap:20px;margin-top:7px;break-inside:avoid;page-break-inside:avoid}
  .sig-box{flex:1;break-inside:avoid;page-break-inside:avoid;border:1px solid #ccc;border-radius:3px;padding:7px 9px;min-height:105px}
  .sig-box-title{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:7px}
  .foto-report-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px}
  .foto-report-item{border:1px solid #e0e0e0;border-radius:4px;padding:4px;background:#fafafa;break-inside:avoid;page-break-inside:avoid}
`;
