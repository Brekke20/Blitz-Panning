// /api/instellingen — instellingen per gebruiker (blob `instellingen`, store van het verzoek).
//   GET                    eigen instellingen -> { versie, instellingen: Instellingen | null }
//   GET ?gebruiker=<id>    beheerder: iedereen (404 bij onbekend id); sales met magAlleSales: enkel een sales-gebruiker;
//                          eigen id: altijd; anders 403
//   GET ?overzicht=1       -> { eigen, techniekers } (sales: enkel { eigen }), techniekers per zohoNaam
//   PUT { gebruiker?, instellingen, versie? } -> 200 { versie }; schrijft de eigen instellingen of die van `gebruiker`:
//        beheerder voor iedereen, planner enkel voor een technieker; technieker en sales enkel voor zichzelf (403 vóór de
//        opzoeking, zodat het bestaan van een id niet lekt). Per gebruiker samengevoegd: geen 409 op de hele blob.
//        Een schrijfactie voor een ANDER wordt gelogd (`instellingen-gewijzigd`, enkel veldnamen, nooit waarden).
// De gebruikerslijst komt altijd uit de ECHTE store `blitz-data`; de instellingen uit de store van het verzoek.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { leesGebruikers } from '../lib/gebruikers.js';
import { logVoorVerzoek } from '../lib/activiteit.js';
import { authStore, OPSLAG_STORING } from '../lib/auth-antwoord.js';
import {
  schoonInstellingen, leesInstellingen, leesVersie, bewaarInstellingen, overzichtVoor,
} from '../lib/instellingen.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, PUT, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));
const GEEN_RECHT = { error: 'Je hebt hier geen toegang toe.', code: 'geen-recht' };
const NIET_GEVONDEN = { error: 'Gebruiker niet gevonden.' };

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { ...CORS, 'Cache-Control': 'no-store' },
});
const isObject = b => Boolean(b) && typeof b === 'object' && !Array.isArray(b);

export function maakHandler({ getStore: haalStore, nu = () => Date.now(), auth } = {}) {
  const zoekDoel = async (aStore, id) => (await leesGebruikers(aStore)).find(g => g && g.id === id) ?? null;

  async function lees(req, store, aStore, gebruiker) {
    const params = new URL(req.url).searchParams;
    if (params.get('overzicht') === '1') return json(200, await overzichtVoor(store, aStore, gebruiker));

    const doelId = params.get('gebruiker');
    let id = gebruiker.id;
    if (doelId !== null && doelId !== gebruiker.id) {
      if (gebruiker.rol === 'beheerder') {
        if (!(await zoekDoel(aStore, doelId))) return json(404, NIET_GEVONDEN);
      } else if (gebruiker.rol === 'sales' && gebruiker.magAlleSales === true) {
        const doel = await zoekDoel(aStore, doelId);
        if (!doel || doel.rol !== 'sales') return json(403, GEEN_RECHT);
      } else {
        return json(403, GEEN_RECHT);
      }
      id = doelId;
    }
    const [versie, instellingen] = await Promise.all([leesVersie(store), leesInstellingen(store, id)]);
    return json(200, { versie, instellingen });
  }

  async function schrijf(req, store, aStore, gebruiker) {
    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
    if (!isObject(body)) return json(400, { error: 'Ongeldige invoer.' });
    if (body.gebruiker !== undefined && typeof body.gebruiker !== 'string') return json(400, { error: 'Ongeldige invoer.' });

    const doelId = body.gebruiker === undefined || body.gebruiker === '' ? gebruiker.id : body.gebruiker;
    const voorAnder = doelId !== gebruiker.id;
    if (voorAnder) {
      if (gebruiker.rol !== 'beheerder' && gebruiker.rol !== 'planner') return json(403, GEEN_RECHT);
      const doel = await zoekDoel(aStore, doelId);
      if (!doel) return json(404, NIET_GEVONDEN);
      if (gebruiker.rol === 'planner' && doel.rol !== 'technieker') return json(403, GEEN_RECHT);
    }

    const schoon = schoonInstellingen(body.instellingen);
    if (schoon.fout) return json(400, { error: schoon.fout });

    const r = await bewaarInstellingen(store, doelId, schoon.waarden);
    if (voorAnder) {
      await logVoorVerzoek(req, gebruiker, {
        actie: 'instellingen-gewijzigd', onderwerp: doelId, details: r.gewijzigd.join(', '),
      }, { getStore: haalStore, nu });
    }
    return json(200, { versie: r.versie });
  }

  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (isTestVerzoek(req)) await zorgVoorTestkopie(haalStore);
      const aStore = await authStore(haalStore);
      const store = await haalStore({ name: winkelNaam(req), consistency: 'strong' });
      if (req.method === 'GET') return await lees(req, store, aStore, gebruiker);
      return await schrijf(req, store, aStore, gebruiker);
    } catch (e) {
      // Alleen het fouttype loggen: een Blobs-fout kan details bevatten. Fail closed.
      console.error('instellingen: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('instellingen', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/instellingen' };
