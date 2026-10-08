// schermen/beheer-performance-logica.js — pure logica van het scherm Performance (dashboard): periodes en query,
// de zes kerncijfer-tegels, het verschil met de vorige periode en de filterrij. Enkel strings en getallen;
// geen DOM, geen toestand, geen I/O. Alle tekst uit data gaat door escHtml.
import { escHtml } from '../kern/ui.js';
import { ringFiguur } from '../kern/grafiek-ring.js';
import { formatGetal } from '../kern/grafiek-hulp.js';
import { statusVoor } from '../kern/dashboard-grenzen.js';

export const PRESETS = [
  { id: 'deze-maand', label: 'Deze maand' },
  { id: 'vorige-maand', label: 'Vorige maand' },
  { id: 'kwartaal', label: 'Dit kwartaal' },
  { id: 'jaar', label: 'Dit jaar' },
  { id: 'zelf', label: 'Zelf kiezen' },
];

// Volgorde en gedrag van de kerncijfer-tegels. omhoogIsGoed: true = hoger is beter, false = lager is beter,
// null = neutraal (geen goed/slecht). De "op tijd"-ring telt alle bezoeken, dus zegt het label dat ook.
export const TEGELS = [
  { sleutel: 'interventies', label: 'Interventies', soort: 'aantal', omhoogIsGoed: null },
  { sleutel: 'gemDuurMin', label: 'Gemiddelde duur', soort: 'duur', omhoogIsGoed: false },
  { sleutel: 'opTijd', label: '% op tijd (alle bezoeken)', soort: 'ring', ringSleutel: 'opTijd', omhoogIsGoed: true, verdeling: true },
  { sleutel: 'firstTimeFix', label: 'First-time-fix', soort: 'ring', ringSleutel: 'firstTimeFix', omhoogIsGoed: true },
  { sleutel: 'herhaalbezoeken', label: 'Herhaalbezoeken', soort: 'aantal', omhoogIsGoed: false },
  { sleutel: 'onderdelenWaarde', label: 'Waarde onderdelen', soort: 'euro', omhoogIsGoed: null },
];

// ---- Periodes (alle datums als YYYY-MM-DD in Europe/Brussels) ----

const brusselFormaat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' });
const p2 = n => String(n).padStart(2, '0');
const iso = (j, m, d) => `${j}-${p2(m)}-${p2(d)}`;
// Echte kalenderdatum (YYYY-MM-DD): "2026-13-45" en "2026-02-30" tellen niet.
function isDatum(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [j, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d));
  return dt.getUTCFullYear() === j && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Kalenderdatum van `nu` in Brussel, los van de tijdzone van het toestel.
function vandaagBrussel(nu) {
  const delen = Object.fromEntries(brusselFormaat.formatToParts(nu).map(p => [p.type, p.value]));
  return { j: Number(delen.year), m: Number(delen.month), d: Number(delen.day) };
}

// -> { van, tot }. Deze maand/kwartaal/jaar lopen tot en met vandaag (de vorige, even lange periode vergelijkt dan
// eerlijk); vorige maand is volledig. 'zelf' geeft de eigen datums terug (ongeldig, leeg of van na tot: deze maand).
// Een ongeldige `nu` valt terug op het huidige moment.
export function periodeVoorPreset(preset, nu, zelf = null) {
  const { j, m, d } = vandaagBrussel(nu instanceof Date && !Number.isNaN(+nu) ? nu : new Date());
  const tot = iso(j, m, d);
  if (preset === 'zelf' && isDatum(zelf?.van) && isDatum(zelf?.tot) && zelf.van <= zelf.tot) return { van: zelf.van, tot: zelf.tot };
  if (preset === 'vorige-maand') {
    const vj = m === 1 ? j - 1 : j;
    const vm = m === 1 ? 12 : m - 1;
    return { van: iso(vj, vm, 1), tot: iso(vj, vm, new Date(Date.UTC(vj, vm, 0)).getUTCDate()) };
  }
  if (preset === 'kwartaal') return { van: iso(j, Math.floor((m - 1) / 3) * 3 + 1, 1), tot };
  if (preset === 'jaar') return { van: iso(j, 1, 1), tot };
  return { van: iso(j, m, 1), tot };
}

// -> '?van=…&tot=…&technieker=…&type=…&herhaal=30'; lege filters vallen weg (herhaal ook bij 0 of NaN), geen filters = ''.
export function maakQuery(filters = {}) {
  const herhaal = Number(filters.herhaalDagen) > 0 ? filters.herhaalDagen : '';
  const velden = [['van', filters.van], ['tot', filters.tot], ['technieker', filters.technieker], ['type', filters.type], ['herhaal', herhaal]];
  const delen = velden.filter(([, w]) => w !== undefined && w !== null && w !== '').map(([k, w]) => `${k}=${encodeURIComponent(w)}`);
  return delen.length ? `?${delen.join('&')}` : '';
}

// ---- Opmaak ----

const isGetal = x => typeof x === 'number' && Number.isFinite(x);
const euroGroot = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });
const euroKlein = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatDuur(min) {
  if (!isGetal(min) || min < 0) return '—';
  const totaal = Math.round(min);
  const u = Math.floor(totaal / 60);
  return u > 0 ? `${u}u${p2(totaal % 60)}` : `${totaal} min`;
}

// "€ 1.840" vanaf 1000 (geen decimalen), anders "€ 12,50"; minteken vóór het eurosymbool ("-€ 5,00").
// De grens wordt na afronden op centen bepaald (999,995 wordt "€ 1.000", niet "€ 1.000,00").
export function formatEuro(x) {
  if (!isGetal(x)) return '—';
  const abs = Math.round(Math.abs(x) * 100) / 100;
  return `${x < 0 && abs > 0 ? '-' : ''}€ ${abs >= 1000 ? euroGroot.format(abs) : euroKlein.format(abs)}`;
}

// Stabiel categorisch kleurslot (1-7) op volgorde in `lijst`; wie er niet in staat of voorbij 7 valt = 'overige'.
export function kleurSlotVoor(sleutel, lijst) {
  const i = Array.isArray(lijst) ? lijst.indexOf(sleutel) : -1;
  return i >= 0 && i < 7 ? i + 1 : 'overige';
}

// -> '2 te vroeg · 9 op tijd · 1 te laat'; zonder gegevens ''.
export function opTijdVerdeling(v) {
  if (!v || ![v.teVroeg, v.opTijd, v.teLaat].some(isGetal)) return '';
  return `${v.teVroeg ?? 0} te vroeg · ${v.opTijd ?? 0} op tijd · ${v.teLaat ?? 0} te laat`;
}

// Verschil met de vorige periode. soort 'pt' = procentpunten (ringen), 'procent' = relatieve verandering (aantallen,
// duur, bedrag); standaard pt wanneer hoger beter is (alleen ringen), anders procent. Zonder bruikbare vorige waarde
// (bij procent ook 0) is er niets te vergelijken. `goed` volgt omhoogIsGoed; null = neutraal.
export function verschil(huidig, vorige, omhoogIsGoed, soort = omhoogIsGoed === true ? 'pt' : 'procent') {
  const geen = { tekst: '—', richting: 'geen', goed: null };
  if (!isGetal(huidig) || !isGetal(vorige)) return geen;
  if (soort !== 'pt' && vorige === 0) return geen;
  const delta = soort === 'pt' ? huidig - vorige : ((huidig - vorige) / Math.abs(vorige)) * 100;
  const afgerond = Math.round(delta * 10) / 10;
  if (afgerond === 0) return { tekst: '= 0', richting: 'gelijk', goed: null };
  const op = afgerond > 0;
  const goed = omhoogIsGoed === null || omhoogIsGoed === undefined ? null : op === omhoogIsGoed;
  return { tekst: `${op ? '↑' : '↓'} ${formatGetal(Math.abs(afgerond))} ${soort === 'pt' ? 'pt' : '%'}`, richting: op ? 'op' : 'neer', goed };
}

// ---- Tegels ----

// De waarde van een tegel in de kern van één periode (null = geen gegevens).
const WAARDE = {
  interventies: k => k?.interventies?.n,
  gemDuurMin: k => k?.gemDuurMin?.waarde,
  opTijd: k => k?.opTijd?.pct,
  firstTimeFix: k => k?.firstTimeFix?.pct,
  herhaalbezoeken: k => k?.herhaalbezoeken?.aantal,
  onderdelenWaarde: k => k?.onderdelenWaarde?.waarde,
};
const waardeVan = (tegel, kern) => { const w = WAARDE[tegel.sleutel]?.(kern); return isGetal(w) ? w : null; };

const VERSCHIL_WOORD = { op: { true: 'beter', false: 'slechter', null: 'hoger' }, neer: { true: 'beter', false: 'slechter', null: 'lager' } };

// Pijl + woord (niet enkel kleur): "↑ 12 pt beter". Zonder vergelijking een streepje.
function verschilHtml(v) {
  if (v.richting === 'geen') return '<p class="tegel-verschil tegel-verschil--geen" title="Geen vergelijking met de vorige periode mogelijk">— <span class="tegel-verschil-woord">geen vergelijking</span></p>';
  const woord = v.richting === 'gelijk' ? 'ongewijzigd' : VERSCHIL_WOORD[v.richting][v.goed];
  const kleur = v.goed === true ? ' tegel-verschil--goed' : v.goed === false ? ' tegel-verschil--slecht' : '';
  return `<p class="tegel-verschil tegel-verschil--${v.richting}${kleur}" title="Ten opzichte van de vorige periode">`
    + `<span class="tegel-verschil-pijl">${escHtml(v.tekst)}</span> <span class="tegel-verschil-woord">${woord}</span></p>`;
}

// Tekst van de waarde (getal-tegels): duur als 1u30, bedrag als € 1.840, anders een getal.
const FORMAAT = { aantal: formatGetal, duur: formatDuur, euro: formatEuro };

// Ring-tegel: zichtbare kop (de ring toont er zelf geen), ring met statusregel, verdeling (op tijd) en verschil.
function ringTegelHtml(tegel, vorige, grenzen, pct, kern) {
  const n = kern?.n;
  // Teller: opTijd.opTijd resp. firstTimeFix.ftf uit de kern; enkel zonder teller (oudere serverdata) afgeleid uit pct.
  const teller = tegel.verdeling ? kern?.opTijd : kern?.ftf;
  const op = isGetal(teller) ? teller : isGetal(pct) && isGetal(n) ? Math.round((pct / 100) * n) : null;
  const figuur = ringFiguur({
    pct, status: statusVoor(tegel.ringSleutel, pct, grenzen), titel: tegel.label,
    n: isGetal(op) ? op : null, noemer: isGetal(n) ? n : null,
    sub: tegel.verdeling && isGetal(pct) ? opTijdVerdeling(kern) : '',
  });
  return `<article class="tegel tegel--ring tegel--${escHtml(tegel.sleutel)}"><h3 class="tegel-kop">${escHtml(tegel.label)}</h3>${figuur}`
    + `${verschilHtml(verschil(pct, waardeVan(tegel, vorige), tegel.omhoogIsGoed, 'pt'))}</article>`;
}

// huidig/vorige = kern.huidig / kern.vorige uit berekenDashboard. Ontbrekende waarde = "geen gegevens".
export function tegelHtml(tegel, huidig, vorige, grenzen) {
  const waarde = waardeVan(tegel, huidig);
  if (tegel.soort === 'ring') return ringTegelHtml(tegel, vorige, grenzen, waarde, huidig?.[tegel.sleutel]);
  const tekst = waarde === null ? '<span class="tegel-waarde tegel-waarde--leeg">geen gegevens</span>'
    : `<span class="tegel-waarde">${escHtml(FORMAAT[tegel.soort](waarde))}</span>`;
  return `<article class="tegel tegel--${escHtml(tegel.soort)} tegel--${escHtml(tegel.sleutel)}"><h3 class="tegel-kop">${escHtml(tegel.label)}</h3>`
    + `<p class="tegel-getal">${tekst}</p>${verschilHtml(verschil(waarde, waardeVan(tegel, vorige), tegel.omhoogIsGoed, 'procent'))}</article>`;
}

// ---- Filterrij ----

const optie = (waarde, tekst, gekozen) => `<option value="${escHtml(waarde)}"${waarde === gekozen ? ' selected' : ''}>${escHtml(tekst)}</option>`;
// Een gekozen waarde die (nog) niet in de opties staat blijft zichtbaar als extra keuze, zodat het menu niet "Alle" toont
// terwijl het filter actief is.
function kies(veld, label, alles, lijst, gekozen) {
  const opties = [...(lijst || [])];
  if (gekozen && !opties.includes(gekozen)) opties.push(gekozen);
  return `<label class="filter-veld">${escHtml(label)}<select data-wijzig="dashboard-filter" data-arg="${escHtml(veld)}">`
    + `${optie('', alles, gekozen ?? '')}${opties.map(w => optie(w, w, gekozen)).join('')}</select></label>`;
}

// Eén rij: periode-presets, zelf-kiezen-datums, technieker, type en herhaalbezoek (30/90 dagen).
// filters: { preset, van, tot, technieker, type, herhaalDagen }; opties: { techniekers, types } uit berekenDashboard.
// Knoppen dragen data-actie="dashboard-preset" + data-arg (registreerActies), velden data-wijzig="dashboard-filter" + data-arg=<veld> (registreerWijzigActies).
export function filterRijHtml({ filters = {}, opties = {} } = {}) {
  const knoppen = PRESETS.map(p => `<button type="button" class="filter-preset" data-actie="dashboard-preset" data-arg="${escHtml(p.id)}" aria-pressed="${p.id === filters.preset}">${escHtml(p.label)}</button>`).join('');
  const datum = (veld, label, w) => `<label class="filter-veld">${label}<input type="date" data-wijzig="dashboard-filter" data-arg="${escHtml(veld)}" value="${escHtml(w ?? '')}"></label>`;
  const herhaal = [30, 90].map(n => `<option value="${n}"${n === Number(filters.herhaalDagen ?? 30) ? ' selected' : ''}>${n} dagen</option>`).join('');
  return `<div class="filterrij" role="group" aria-label="Filters"><div class="filter-presets">${knoppen}</div>`
    + `${datum('van', 'Van', filters.van)}${datum('tot', 'Tot', filters.tot)}`
    + `${kies('technieker', 'Technieker', 'Alle techniekers', opties.techniekers, filters.technieker)}`
    + `${kies('type', 'Type', 'Alle types', opties.types, filters.type)}`
    + `<label class="filter-veld">Herhaalbezoek binnen<select data-wijzig="dashboard-filter" data-arg="herhaalDagen">${herhaal}</select></label></div>`;
}
