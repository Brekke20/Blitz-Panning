// schermen/beheer-performance-kwaliteit.js — blok "Kwaliteit": first-time-fix per technieker en laadpaaltype,
// herhaalbezoeken (tegel + lijst met "Open rapport"-knoppen) en top-oorzaken per laadpaaltype.
// Zuivere stringbouwer: renderKwaliteit(data, ctx) -> html. Importeert nooit rapport-archief.js: de knop is
// <button data-actie="dashboard-open-rapport" data-arg="<id>">, Taak 18 koppelt die aan openRapportOpId.
import { escHtml } from '../kern/ui.js';
import { gestapeldeBalken } from '../kern/grafiek-balken.js';
import { TEGELS, tegelHtml } from './beheer-performance-logica.js';
import { blok, kaart, lijst, ringenRij, korteDatum, typeSlot } from './beheer-performance-blokhulp.js';

const MAX_LIJST = 20;
const HERHAAL_TEGEL = TEGELS.find(t => t.sleutel === 'herhaalbezoeken');

const ftfKaart = (rijen, titel, ctx) => (lijst(rijen).length ? kaart(titel, ringenRij(
  rijen.map(r => ({ kop: r.label, pct: r.pct, n: r.ftf, noemer: r.n })), 'firstTimeFix', ctx?.grenzen, kop => `${kop}: first-time-fix`,
), { uitleg: 'Enkel interventies: hersteld zonder nieuwe interventie.', breed: true }) : '');

// Leesbare omschrijving van het toestel/adres: serienummer, anders het adres uit het rapport, nooit de technische sleutel.
function watTekst(h) {
  const serie = h.serienummer || (String(h.sleutel).startsWith('serie:') ? String(h.sleutel).slice(6) : '');
  if (serie) return `Serienummer ${serie}`;
  return h.adres ? h.adres : 'Adres onbekend';
}

function herhaalRij(h) {
  const open = (id, tekst) => `<button type="button" class="btn-sec dash-knop" data-actie="dashboard-open-rapport" data-arg="${escHtml(id)}">${escHtml(tekst)}</button>`;
  return '<li class="herhaal-rij"><div class="herhaal-info">'
    + `<span class="herhaal-kop"><strong>${escHtml(h.ticketNumber || h.id)}</strong> · ${escHtml(korteDatum(h.datum))} · ${escHtml(h.technieker || 'Onbekend')}</span>`
    + `<span class="herhaal-wat">${escHtml(watTekst(h))}${h.klant ? ` · ${escHtml(h.klant)}` : ''}</span>`
    + `<span class="herhaal-na">${escHtml(h.dagen)} dagen na het bezoek van ${escHtml(korteDatum(h.vorigeDatum))}</span></div>`
    + `<div class="herhaal-acties">${open(h.id, 'Open rapport')}${h.vorigeId ? open(h.vorigeId, 'Open vorig rapport') : ''}</div></li>`;
}

function herhaalKaart(data, ctx) {
  const h = data?.kwaliteit?.herhaal;
  const kern = data?.kern;
  if (!h || (!h.aantal && !lijst(h.lijst).length)) return '';
  const items = lijst(h.lijst);
  const rest = h.aantal - Math.min(items.length, MAX_LIJST);
  const tegel = tegelHtml(HERHAAL_TEGEL, kern?.huidig, kern?.vorige, ctx?.grenzen);
  const rijen = items.length ? `<ul class="herhaal-lijst">${items.slice(0, MAX_LIJST).map(herhaalRij).join('')}</ul>` : '';
  const meer = rest > 0 ? `<p class="dash-uitleg">… en nog ${escHtml(rest)} andere herhaalbezoeken (nieuwste eerst getoond).</p>` : '';
  const uitleg = `<p class="dash-uitleg">Zelfde serienummer (of zelfde adres zonder serienummer) opnieuw bezocht binnen ${escHtml(h.dagen ?? 30)} dagen.</p>`;
  return kaart(null, tegel + uitleg + rijen + meer, { breed: true });
}

function oorzakenKaart(top, data) {
  const lijstTop = lijst(top);
  if (!lijstTop.length) return '';
  const gezien = [];
  for (const o of lijstTop) for (const t of Object.keys(o.perType ?? {})) if (!gezien.includes(t)) gezien.push(t);
  const titel = 'Top-oorzaken per laadpaaltype';
  return kaart(titel, gestapeldeBalken({
    titel, eenheid: 'rapporten', categorieLabel: 'Oorzaak', categorieen: lijstTop.map(o => o.oorzaak),
    reeksen: gezien.map(t => ({ sleutel: t, label: t, slot: typeSlot(t, data, gezien), waarden: lijstTop.map(o => o.perType?.[t] ?? 0) })),
  }), { breed: true, uitleg: 'Een rapport met meerdere oorzaken telt bij elke oorzaak mee.' });
}

export function renderKwaliteit(data, ctx) {
  const k = data?.kwaliteit ?? {};
  return blok('kwaliteit', 'Kwaliteit', [
    ftfKaart(k.ftfPerTechnieker, 'First-time-fix per technieker', ctx),
    ftfKaart(k.ftfPerType, 'First-time-fix per laadpaaltype', ctx),
    herhaalKaart(data, ctx),
    oorzakenKaart(k.topOorzaken, data),
  ]);
}
