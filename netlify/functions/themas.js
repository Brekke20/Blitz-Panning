// /api/themas — themapakketten (versiering, kleuren en Blitz Run-skins als enkel gegevens). Opslag: netlify/lib/themas.js.
//   GET                 -> 200 { versie, themas: [{ id, naam, aan, periode, periodeOverride, pakketHash }], pakketten: { [id]: pakket } }
//                          (de pakketten van de thema's die nu lopen of binnen 14 dagen beginnen; GEEN uploadgegevens). Alle rollen.
//                          De eerste lezing zaait de voorgeladen pakketten (best-effort).
//   GET ?id=<id>        -> 200 het pakket, of 404.
//   POST <pakket>       -> 200 { ok, nieuw, versie, themas } | 422 { error, fouten: [{ veld, fout }] } | 413 | 400. Enkel beheerder.
//   PATCH { id, aan?, periode?, versie } -> 200 { ok, versie, themas } | 404 | 409 { error, serverVersie } | 422. Enkel beheerder.
//        `periode: null` wist de override; optimistic locking op `versie` (zoals fotos).
// Schrijven vraagt `X-Blitz: 1` (de wrapper beveiligV2 dwingt dat af). Elke upload en wijziging komt in de activiteitslog.
// Geen Zoho, geen TomTom, geen mail. `voorgeladen` is injecteerbaar voor tests.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam } from '../lib/testmodus.js';
import { OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { logVoorVerzoek } from '../lib/activiteit.js';
import { zaai, openbareLijst, publiekeThemas, bewaarPakket, wijzigThema, pakketSleutel } from '../lib/themas.js';
import { valideerPakket } from '../../public/js/kern/themapakket-validatie.js';
import { VOORGELADEN } from '../themas/pakketten.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, POST, PATCH, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export const MAX_BODY = 614400; // 600 kB: een pakket is hoogstens 512 kB (validator), de rest is marge voor de verpakking

export function maakHandler({ getStore: haalStore, nu = () => Date.now(), auth, voorgeladen = VOORGELADEN } = {}) {
  // Leest en parset de body: { body } of { antwoord }. De grens geldt op de ECHTE bytes en ook zonder content-length-kop.
  const leesBody = async (req) => {
    const lengte = Number(req.headers.get('content-length') || 0);
    if (lengte > MAX_BODY) return { antwoord: json(413, { error: 'Verzoek te groot.' }) };
    let tekst;
    try { tekst = await req.text(); } catch { return { antwoord: json(400, { error: 'Ongeldige JSON' }) }; }
    const bytes = Buffer.byteLength(tekst, 'utf8');
    if (bytes > MAX_BODY) return { antwoord: json(413, { error: 'Verzoek te groot.' }) };
    try { return { body: JSON.parse(tekst), bytes }; } catch { return { antwoord: json(400, { error: 'Ongeldige JSON' }) }; }
  };

  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const store = await haalStore({ name: winkelNaam(req), consistency: 'strong' });
      const logOpties = { getStore: haalStore, nu };

      if (req.method === 'GET') {
        const index = await zaai(store, voorgeladen);
        const id = new URL(req.url).searchParams.get('id');
        if (id !== null) {
          const bekend = index.themas.some((t) => t.id === id);
          const pakket = bekend ? await store.get(pakketSleutel(id), { type: 'json' }) : null;
          return pakket ? json(200, pakket) : json(404, { error: 'Dit thema bestaat niet.' });
        }
        return json(200, await openbareLijst(index, nu(), store));
      }

      const gelezen = await leesBody(req);
      if (gelezen.antwoord) return gelezen.antwoord;

      if (req.method === 'POST') {
        // De validator krijgt de echte bytes van de ontvangen tekst, nooit een waarde van de client.
        const v = valideerPakket(gelezen.body, { tekstLengte: gelezen.bytes });
        if (!v.ok) return json(422, { error: 'Het themapakket is ongeldig.', fouten: v.fouten });
        const r = await bewaarPakket(store, v.pakket, gebruiker, { nu, voorgeladen });
        await logVoorVerzoek(req, gebruiker, { actie: 'thema-upload', onderwerp: v.pakket.id, details: { id: v.pakket.id, nieuw: r.nieuw } }, logOpties);
        return json(200, { ok: true, nieuw: r.nieuw, versie: r.index.versie, themas: publiekeThemas(r.index) });
      }

      // PATCH
      const b = gelezen.body;
      if (b === null || typeof b !== 'object' || Array.isArray(b)) return json(400, { error: 'Ongeldige JSON' });
      const r = await wijzigThema(store, { id: b.id, aan: b.aan, periode: b.periode, versie: b.versie }, gebruiker);
      if (!r.ok) {
        const { ok: _ok, status, ...rest } = r;
        return json(status, rest.fouten ? { error: 'De wijziging is ongeldig.', ...rest } : rest);
      }
      const details = { id: b.id };
      if (b.aan !== undefined) details.aan = b.aan;
      if (b.periode !== undefined) details.periode = b.periode;
      await logVoorVerzoek(req, gebruiker, { actie: 'thema-wijzig', onderwerp: b.id, details }, logOpties);
      return json(200, { ok: true, versie: r.index.versie, themas: publiekeThemas(r.index) });
    } catch (e) {
      // Alleen het fouttype loggen: een Blobs-fout kan details bevatten. Fail closed.
      console.error('themas: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('themas', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/themas' };
