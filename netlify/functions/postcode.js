// /api/postcode — GET ?pc=3640 -> 200 { pc, lat, lon, gemeente } (TomTom, met cache in het blob `postcode-cache`).
// 400 bij een ongeldige postcode (4 cijfers, 1000-9999), 404 als TomTom echt niets vindt, 503 met code 'opzoeken-storing' bij een
// tijdelijke TomTom-fout of ontbrekende sleutel, 503 'opslag-storing' als de opslag zelf niet bereikbaar is.
// Beheerder en sales; in testmodus nepcoördinaten zonder TomTom (zie netlify/lib/sales-geocode.js).
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { zoekPostcodes, isPostcode } from '../lib/sales-postcode.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));

// Tijdelijk onbereikbare opzoekdienst (TomTom-fout of ontbrekende sleutel): NIET dezelfde code als de opslagstoring.
const OPZOEKEN_STORING = Object.freeze({ error: 'De postcode kon tijdelijk niet opgezocht worden. Probeer het zo meteen opnieuw.', code: 'opzoeken-storing' });

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function maakHandler({
  getStore: haalStore, fetch = globalThis.fetch, nu = () => Date.now(),
  sleutel = () => process.env.TOMTOM_API_KEY, auth,
} = {}) {
  const kern = async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const pc = new URL(req.url).searchParams.get('pc');
      if (!isPostcode(pc) || Number(pc) < 1000) return json(400, { error: 'Geef een postcode van 4 cijfers op.' });
      const testVerzoek = isTestVerzoek(req);
      if (testVerzoek) await zorgVoorTestkopie(haalStore);
      const store = await haalStore({ name: winkelNaam(req), consistency: 'strong' });
      const { gevonden: g, fouten } = await zoekPostcodes(store, [pc], { fetch, sleutel: sleutel(), testModus: testVerzoek, nu });
      const gevonden = g[pc];
      if (!gevonden) {
        if (fouten.includes(pc)) return json(503, OPZOEKEN_STORING);
        return json(404, { error: 'Postcode niet gevonden.' });
      }
      return json(200, { pc, lat: gevonden.lat, lon: gevonden.lon, gemeente: gevonden.gemeente ?? '' });
    } catch (e) {
      console.error('postcode: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('postcode', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/postcode' };
