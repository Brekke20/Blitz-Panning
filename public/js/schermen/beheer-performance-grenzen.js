// schermen/beheer-performance-grenzen.js — instellingen-paneel van het dashboard: de kleurgrenzen van de ringen
// (groen-drempel, oranje-drempel, richting per ring). Zuivere stringbouwer en parser; geen DOM, geen I/O.
import { escHtml } from '../kern/ui.js';
import { RING_METRICS, valideerGrenzen } from '../kern/dashboard-grenzen.js';

export const GRENS_RINGEN = [
  { sleutel: 'opTijd', label: '% op tijd (alle bezoeken)' },
  { sleutel: 'firstTimeFix', label: 'First-time-fix' },
  { sleutel: 'bevestigdViaKnop', label: 'Bevestigd via knop' },
  { sleutel: 'garantie', label: 'Garantie' },
  { sleutel: 'metInstallateur', label: 'Installateur al langs geweest' },
];

const waardeTekst = x => (typeof x === 'number' && Number.isFinite(x) ? String(x) : '');

function invoer(ring, veld, tekst, waarde, uit) {
  return `<input type="number" inputmode="decimal" min="0" max="100" step="1" data-veld="${veld}" value="${escHtml(waardeTekst(waarde))}"`
    + ` aria-label="${escHtml(`${ring.label}: ${tekst}`)}"${uit ? ' disabled' : ''}>`;
}

// grenzen = { [sleutel]: { groen, oranje, richting } }. Leeg veld = geen kleur (neutraal).
export const GRENZEN_LAAD_FOUT = 'De grenzen konden niet geladen worden; standaardkleuren worden gebruikt.';

// fout = true: bovenaan een uitleg met een "Opnieuw laden"-knop (data-actie="dashboard-grenzen-herlaad").
export function grenzenPaneelHtml(grenzen, { uitgeschakeld = false, fout = false } = {}) {
  const rijen = GRENS_RINGEN.map(ring => {
    const g = grenzen?.[ring.sleutel] ?? {};
    const laag = g.richting === 'laag';
    return `<tr data-ring="${escHtml(ring.sleutel)}"><th scope="row">${escHtml(ring.label)}</th>`
      + `<td>${invoer(ring, 'groen', 'groen vanaf', g.groen, uitgeschakeld)}</td>`
      + `<td>${invoer(ring, 'oranje', 'oranje vanaf', g.oranje, uitgeschakeld)}</td>`
      + `<td><select data-veld="richting" aria-label="${escHtml(`${ring.label}: richting`)}"${uitgeschakeld ? ' disabled' : ''}>`
      + `<option value="hoog"${laag ? '' : ' selected'}>hoog is goed</option><option value="laag"${laag ? ' selected' : ''}>laag is goed</option></select></td></tr>`;
  }).join('');
  const foutHtml = fout
    ? `<p class="dash-melding dash-melding--fout" role="alert">${escHtml(GRENZEN_LAAD_FOUT)}<button type="button" class="btn btn--secondary btn--sm dash-knop" data-actie="dashboard-grenzen-herlaad">Opnieuw laden</button></p>`
    : '';
  return foutHtml + '<p class="dash-uitleg">Bij "hoog is goed" kleurt een ring groen vanaf de groene drempel en oranje vanaf de oranje drempel, anders rood (de groene drempel ligt dan hoger dan de oranje). '
    + 'Bij "laag is goed" (bv. garantie) kleurt hij groen tot en met de groene drempel en oranje tot en met de oranje drempel, anders rood (de groene drempel ligt dan niet hoger dan de oranje). '
    + 'Laat beide velden leeg voor een ring zonder kleur.</p>'
    + '<div class="dash-tabel-scroll"><table class="grenzen-tabel"><thead><tr><th scope="col">Ring</th><th scope="col">Groene drempel (%)</th>'
    + `<th scope="col">Oranje drempel (%)</th><th scope="col">Richting</th></tr></thead><tbody>${rijen}</tbody></table></div>`
    + `<div class="grenzen-acties"><button type="button" class="btn btn--primary dash-knop" data-actie="dashboard-grenzen-bewaar"${uitgeschakeld ? ' disabled' : ''}>Grenzen bewaren</button>`
    + `<button type="button" class="btn btn--secondary dash-knop" data-actie="dashboard-grenzen-standaard"${uitgeschakeld ? ' disabled' : ''}>Standaard terugzetten</button></div>`;
}

const getal = t => {
  const s = String(t ?? '').trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

// rijen = [{ sleutel, groen, oranje, richting }] (tekst uit de velden) -> { ok, waarde } | { ok:false, fout }.
export function leesGrenzenUitRijen(rijen) {
  const invoerGrenzen = {};
  for (const r of Array.isArray(rijen) ? rijen : []) {
    if (!RING_METRICS.includes(r?.sleutel)) continue;
    const groen = getal(r.groen), oranje = getal(r.oranje);
    const label = GRENS_RINGEN.find(x => x.sleutel === r.sleutel)?.label ?? r.sleutel;
    if (Number.isNaN(groen) || Number.isNaN(oranje)) return { ok: false, fout: `Bij ${label} moeten de drempels getallen van 0 tot 100 zijn.` };
    invoerGrenzen[r.sleutel] = { groen, oranje, richting: r.richting };
  }
  const v = valideerGrenzen(invoerGrenzen);
  if (v.ok) return v;
  // De validator noemt de technische sleutel; vervang die door het label.
  let fout = v.fout;
  for (const { sleutel, label } of GRENS_RINGEN) fout = fout.replaceAll(sleutel, label);
  return { ok: false, fout };
}

// Na een 409: per ring wint de eigen wijziging (afwijkend van `basis`, de stand bij het laden), de rest volgt de server.
export function voegGrenzenSamen(server, eigen, basis) {
  const samen = { ...(server ?? {}) };
  for (const sleutel of RING_METRICS) {
    if (JSON.stringify(eigen?.[sleutel]) !== JSON.stringify(basis?.[sleutel])) samen[sleutel] = eigen[sleutel];
  }
  return samen;
}

// Wat er na een bewaarpoging (resultaat van bewaarMetVersie) moet gebeuren: toasttekst, of het paneel opnieuw getekend wordt
// (enkel bij succes of een nieuwe serverstand; na een andere fout blijven de ingetypte waarden staan) en de nieuwe stand.
export function bewaarUitkomst(r) {
  if (r?.ok) {
    return { toast: r.samengevoegd ? 'Grenzen bewaard (samengevoegd met een wijziging van iemand anders)' : 'Grenzen bewaard', herteken: true, grenzen: r.waarde, versie: r.versie };
  }
  if (r?.reden === 'conflict') {
    if (r.laatsteServer) {
      return { toast: '⚠ Iemand anders wijzigde de grenzen. De nieuwste stand is geladen; pas aan en bewaar opnieuw.', herteken: true, grenzen: r.laatsteServer, versie: r.laatsteVersie ?? r.versie };
    }
    return { toast: '⚠ Iemand anders wijzigde de grenzen. Laad de pagina opnieuw om de nieuwste stand te zien.', herteken: false };
  }
  const tekst = r?.reden === 'netwerk' ? 'Geen verbinding met de server. Probeer het opnieuw.'
    : r?.status === 503 ? 'De opslag is tijdelijk niet bereikbaar. Probeer het later opnieuw.'
      : r?.status === 400 ? 'De server weigerde deze grenzen. Controleer de waarden.'
        : r?.status === 401 || r?.status === 403 ? 'Bewaren mislukt: geen toegang.'
          : 'Bewaren mislukt. Probeer het opnieuw.';
  return { toast: `⚠ ${tekst}`, herteken: false };
}
