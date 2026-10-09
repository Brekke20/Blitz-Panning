// schermen/sales-kaart.js — de kaart van het Route-scherm van de verkoper: een EIGEN Leaflet-instantie op het meegegeven vak (#sales-kaart),
// los van de singleton-kaart van de technieker-route (#map in route-kaart.js; enkel de kaartlagen worden gedeeld). Nummermarkers per
// bezoek; een bezoek dat enkel op de postcode staat ("ongeveer") krijgt de klasse `sales-marker-ongeveer` (gestippelde rand) en de popup
// "ongeveer — enkel postcode". Geen drukte-kleuring. `L` (Leaflet, CDN) is een global en wordt enkel binnen functies gebruikt; ontbreekt
// hij (CDN onbereikbaar), dan geeft `maakSalesKaart` een kaart terug met `beschikbaar: false` die niets doet.
// Veiligheid: leadgegevens komen via textContent in de popups (DOM-elementen, nooit HTML-tekst).
import { KAART_LAGEN } from './route-kaart.js';

export const ONGEVEER_TEKST = 'ongeveer — enkel postcode';
const BELGIE = [50.85, 4.35];

function tekstEl(tag, tekst, klasse) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  e.textContent = tekst;
  return e;
}

function popupVoorStop(s) {
  const d = document.createElement('div');
  d.className = 'sales-popup';
  d.append(tekstEl('strong', `${s.nr}. ${s.naam}`));
  d.append(tekstEl('div', [s.start, s.plaats].filter(Boolean).join(' · ')));
  if (s.ongeveer) d.append(tekstEl('div', ONGEVEER_TEKST, 'sales-popup-ongeveer'));
  return d;
}

const kleur = () => {
  try { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00dfa3'; } catch { return '#00dfa3'; }
};

const GEEN_KAART = Object.freeze({ beschikbaar: false, toon() {}, invalideer() {}, vernietig() {} });

/**
 * Maakt de kaart in `containerEl`. -> { beschikbaar, toon({ depot, stops, polyline, geschat }), invalideer(), vernietig() }
 *  - depot: { lat, lon, ongeveer? } | null (een rondje, geen marker: het telt niet mee als bezoekmarker)
 *  - stops: RouteStop[] (sales-route-logica.js); stops zonder locatie staan niet op de kaart
 *  - polyline: [[lat, lon], ...] (de route van TomTom of de rechte lijnen van de schatting); geschat = gestippeld
 * `kaartStijl`: sleutel van KAART_LAGEN (onbekend = standaard).
 */
export function maakSalesKaart(containerEl, { kaartStijl } = {}) {
  if (!containerEl || typeof L === 'undefined') return GEEN_KAART;
  let kaart;
  try {
    kaart = L.map(containerEl, { zoomControl: true }).setView(BELGIE, 8);
  } catch (fout) {
    console.error('Sales-kaart maken mislukt:', fout);
    return GEEN_KAART;
  }
  const laag = typeof kaartStijl === 'string' && Object.hasOwn(KAART_LAGEN, kaartStijl) ? KAART_LAGEN[kaartStijl] : KAART_LAGEN.standaard;
  L.tileLayer(laag.url, laag.opts).addTo(kaart);
  const lagen = L.layerGroup().addTo(kaart);
  let grenzen = null;

  const pasGrenzenToe = () => {
    if (!grenzen) { kaart.setView(BELGIE, 8); return; }
    if (grenzen.getNorthEast().equals(grenzen.getSouthWest())) kaart.setView(grenzen.getCenter(), 13);
    else kaart.fitBounds(grenzen, { padding: [30, 30], maxZoom: 14 });
  };

  return {
    beschikbaar: true,
    toon({ depot = null, stops = [], polyline = [], geschat = false } = {}) {
      lagen.clearLayers();
      const punten = [];
      if (depot?.lat != null && depot?.lon != null) {
        const ring = L.circleMarker([depot.lat, depot.lon], { radius: 8, color: kleur(), weight: 3, fillOpacity: 0.25, dashArray: depot.ongeveer ? '3 3' : null });
        ring.bindPopup(tekstEl('div', depot.ongeveer ? `Vertrek (${ONGEVEER_TEKST})` : 'Vertrek', 'sales-popup'));
        ring.addTo(lagen);
        punten.push([depot.lat, depot.lon]);
      }
      if (Array.isArray(polyline) && polyline.length >= 2) {
        L.polyline(polyline, { color: kleur(), weight: 4, opacity: 0.85, dashArray: geschat ? '6 8' : null }).addTo(lagen);
      }
      for (const s of stops) {
        if (s.locatie?.lat == null || s.locatie?.lon == null) continue;
        const icon = L.divIcon({
          className: `sales-marker${s.ongeveer ? ' sales-marker-ongeveer' : ''}${s.vast ? ' sales-marker-vast' : ''}`,
          html: `<span>${Number(s.nr)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14],
        });
        L.marker([s.locatie.lat, s.locatie.lon], { icon, title: `${s.nr}. ${s.naam}`, keyboard: true })
          .bindPopup(popupVoorStop(s)).addTo(lagen);
        punten.push([s.locatie.lat, s.locatie.lon]);
      }
      grenzen = punten.length ? L.latLngBounds(punten) : null;
      pasGrenzenToe();
    },
    /** Na een verandering van de zichtbaarheid of grootte (subtab, tabwissel, draaien van het toestel). */
    invalideer() {
      kaart.invalidateSize();
      pasGrenzenToe();
    },
    vernietig() { kaart.remove(); },
  };
}
