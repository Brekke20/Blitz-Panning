// public/js/rapport-aanrijtijd.js
// Aanrijtijd voor het rapport (B7/C4): van de ingestelde startlocatie naar het interventie-adres, enkel heen.
// Geocodeert via /api/optimize en vraagt de reistijd op via /api/route (beide met de standaardtime-out van 20 s uit kern/netwerk.js).
// Gooit nooit: een mislukking geeft { minuten: null, reden }, zodat de wizard de technieker zelf een waarde laat invullen
// in plaats van stil 0 te rapporteren. 0 seconden is een geldige uitkomst; enkel een ontbrekend of ongeldig getal is een mislukking.
import { apiVerzoek } from './kern/api.js';

const mislukt = (reden) => ({ minuten: null, reden });
const geldigPunt = (p) => p && typeof p === 'object';

// reden: null | 'geen-adres' | 'geen-startlocatie' | 'geocode' | 'route' | 'netwerk'
export async function berekenAanrijtijd({ adres, startlocatie } = {}) {
  if (typeof adres !== 'string' || !adres.trim()) return mislukt('geen-adres');
  if (typeof startlocatie !== 'string' || !startlocatie.trim()) return mislukt('geen-startlocatie');

  let stap = 'geocode';
  try {
    const geo = await apiVerzoek('/api/optimize', { methode: 'POST', body: { origin: startlocatie, stops: [adres] } });
    const origin = geo.ok ? geo.data?.locations?.[0] : null;
    const dest = geo.ok ? geo.data?.locations?.[1] : null;
    if (!geldigPunt(origin) || !geldigPunt(dest)) return mislukt('geocode');

    stap = 'route';
    const route = await apiVerzoek('/api/route', { methode: 'POST', body: { waypoints: [origin, dest] } });
    const sec = route.ok ? route.data?.legs?.[0]?.travelTimeSeconds : null;
    if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return mislukt('route');
    return { minuten: Math.round(sec / 60), reden: null };
  } catch (e) {
    // Nooit gooien. Een netwerkfout of time-out is 'netwerk'; een onleesbaar antwoord bij status ok hoort bij de stap waarin het gebeurde.
    const netwerk = e?.name === 'TimeoutError' || e?.name === 'AbortError' || e instanceof TypeError;
    return mislukt(netwerk ? 'netwerk' : stap);
  }
}
