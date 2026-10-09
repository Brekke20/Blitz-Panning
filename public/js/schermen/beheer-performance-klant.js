// schermen/beheer-performance-klant.js — blok "Klant & planning": bevestigingssnelheid, bevestigd via de knop,
// annulaties, garantie en "Installateur al langs geweest". Zuivere stringbouwer: renderKlant(data, ctx) -> html.
import { escHtml } from '../kern/ui.js';
import { balkenRijen } from '../kern/grafiek-balken.js';
import { formatGetal } from '../kern/grafiek-hulp.js';
import { statusVoor } from '../kern/dashboard-grenzen.js';
import { formatDuur, formatEuro } from './beheer-performance-logica.js';
import { blok, kaart, lijst, ringKaart, feiten, dagMaand, subkop } from './beheer-performance-blokhulp.js';

const NOOT = 'Het technieker- en laadpaalfilter geldt hier niet voor voorstellen (bevestiging) en annulaties.';
const isGetal = x => typeof x === 'number' && Number.isFinite(x);
const meervoud = (n, een, meer) => `${n} ${n === 1 ? een : meer}`;

function bevestigingKaart(b) {
  if (!b?.n) return '';
  const titel = 'Bevestigingssnelheid';
  return kaart(titel, feiten([
    ['Mediaan', formatDuur(b.mediaanMin)], ['Gemiddelde', formatDuur(b.gemiddeldeMin)],
    ['Met bevestigingstijd', `${b.nMetSnelheid ?? 0} van ${b.n} voorstellen`],
  ]) + subkop('Verdeling') + balkenRijen({ titel: 'Bevestigingssnelheid: verdeling', eenheid: 'voorstellen', rijen: lijst(b.buckets).map(x => ({ label: x.label, waarde: x.n })) }),
  { uitleg: 'Tijd tussen het versturen van het voorstel en de bevestiging door de klant.' });
}

function knopKaart(b, grenzen) {
  if (!b?.n) return '';
  return ringKaart('Bevestigd via de knop', { pct: b.pct, status: statusVoor('bevestigdViaKnop', b.pct, grenzen), n: b.bevestigd, noemer: b.n },
    '', { uitleg: 'Aandeel bevestigde voorstellen dat de klant zelf via de knop in de mail bevestigde.' });
}

// Eigen tegel (met kop) in een kaart zonder tweede kop; "sinds …" want het log start pas bij de livegang van de logins.
function annulatieKaart(a) {
  if (!a) return '';
  const heeft = a.beschikbaar && isGetal(a.aantal);
  const waarde = heeft ? `<span class="tegel-waarde">${escHtml(formatGetal(a.aantal))}</span>` : '<span class="tegel-waarde tegel-waarde--leeg">geen gegevens</span>';
  const sinds = a.beschikbaar && a.vanaf ? `Geteld sinds ${dagMaand(a.vanaf)}` : 'Het log start bij de livegang van de logins.';
  const vorige = heeft && isGetal(a.vorige) ? ` · vorige periode: ${formatGetal(a.vorige)}` : '';
  return kaart(null, `<article class="tegel tegel--aantal tegel--annulaties"><h3 class="tegel-kop">Annulaties</h3><p class="tegel-getal">${waarde}</p>`
    + `<p class="tegel-verschil tegel-verschil--geen">${escHtml(sinds + vorige)}</p></article>`);
}

function garantieKaart(g, grenzen) {
  if (!g?.n) return '';
  const regels = [
    ['Onderdelen', `${formatEuro(g.onderdelenWaarde?.garantie)} garantie · ${formatEuro(g.onderdelenWaarde?.overig)} overig`],
    ['Loon', `${formatEuro(g.loon?.garantie)} garantie · ${formatEuro(g.loon?.overig)} overig`],
  ];
  if (g.zonderWerktijd > 0) regels.push(['Zonder werktijd', `${meervoud(g.zonderWerktijd, 'rapport', 'rapporten')}: loon onvolledig`]);
  return ringKaart('Garantie', { pct: g.pct, status: statusVoor('garantie', g.pct, grenzen), n: g.garantie, noemer: g.n }, feiten(regels),
    { uitleg: 'Aandeel interventies onder garantie, met de waarde van onderdelen en loon per groep.' });
}

// % Ja van (Ja + Nee); onbekende antwoorden tellen niet mee en staan in een zin.
const aandeelJa = (ja, nee) => (ja + nee > 0 ? (ja / (ja + nee)) * 100 : null);

function partnerKaart(titel, rijen, uitleg) {
  const l = lijst(rijen).filter(r => r.n > 0);
  if (!l.length) return '';
  return kaart(titel, balkenRijen({
    titel, schaalMax: 100, eenheid: '%',
    rijen: l.map(r => ({ label: r.label, waarde: aandeelJa(r.ja, r.n - r.ja), tekst: `${Math.round(aandeelJa(r.ja, r.n - r.ja))} % (${r.ja} van ${r.n})` })),
  }), { uitleg });
}

function installateurKaarten(i, dekking, grenzen) {
  if (!i) return [];
  const ja = i.ja ?? 0, nee = i.nee ?? 0, onbekend = i.onbekend ?? 0;
  if (ja + nee + onbekend === 0) return [];
  const pct = aandeelJa(ja, nee);
  const zin = onbekend > 0 ? `${meervoud(onbekend, 'rapport', 'rapporten')} zonder antwoord (onbekend) ${onbekend === 1 ? 'telt' : 'tellen'} niet mee.` : 'Alle rapporten hebben een antwoord.';
  const veld = dekking?.partnerRegioTotaal > 0 ? `Aandeel Ja per groep; partner en regio zijn ingevuld bij ${dekking.partnerRegioMetVeld ?? 0} van ${dekking.partnerRegioTotaal} rapporten.` : 'Aandeel Ja per groep.';
  return [
    ringKaart('Installateur al langs geweest', { pct, status: statusVoor('metInstallateur', pct, grenzen), n: ja, noemer: ja + nee },
      '', { uitleg: `Aandeel Ja van Ja + Nee. ${zin}` }),
    partnerKaart('Installateur al langs, per partner', i.perPartner, veld),
    partnerKaart('Installateur al langs, per regio', i.perRegio, veld),
  ];
}

export function renderKlant(data, ctx) {
  const k = data?.klant ?? {};
  return blok('klant', 'Klant & planning', [
    bevestigingKaart(k.bevestiging), knopKaart(k.bevestigdViaKnop, ctx?.grenzen), annulatieKaart(k.annulaties),
    garantieKaart(k.garantie, ctx?.grenzen), ...installateurKaarten(k.installateurAlLangs, k.dekking, ctx?.grenzen),
  ], { noot: NOOT });
}
