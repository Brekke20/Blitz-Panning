// /api/tickets
// Haalt tickets op uit Zoho Desk op basis van status (zie netlify/lib/tickets-ophalen.js).
//
// Sinds de voorlading serveert deze functie eerst de momentopname uit Netlify Blobs (netlify/lib/tickets-snapshot.js, ververst door
// de geplande functie tickets-vooraf): die is ongefilterd en voor elke toegelaten rol hetzelfde, net als de live lading. Is ze niet
// vers (ouder dan 5 min, of een wijzigende functie markeerde ze), dan wordt live uit Zoho opgehaald en de momentopname herschreven.
// "Vernieuwen" stuurt ?vers=1: dan wordt ook een nog verse momentopname vervangen door een echte Zoho-lading (met een rem van één per
// 30 s voor alle gebruikers samen, zie leverTickets).
// Faalt Zoho (of antwoordt het niet binnen 12 s), dan krijgt de gebruiker de laatste goede momentopname (header X-Blitz-Verouderd: 1)
// in plaats van een fout, maar enkel als die jonger is dan 60 min en de fout geen Zoho-authenticatiefout is: in die gevallen blijft
// het een 500 met de fouttekst, zodat de client zijn eigen melding toont (bv. "Sessie met Zoho verlopen").
// Het antwoord (body) is altijd exact het oude { tickets, pendingTickets, plannedTickets }.

import { maakZoho } from '../lib/zoho.js';
import { haalTickets } from '../lib/tickets-ophalen.js';
import { leverTickets, standaardStore } from '../lib/tickets-snapshot.js';
import { huidigeMeting } from '../lib/meting.js';
import { CORS_V1 } from '../lib/http.js';
import { beveiligV1 } from '../lib/beveiligd.js';
import { alsV2 } from '../lib/v2-adapter.js';

// Instantie op moduleniveau: de tokencache (55 min) en het org-id leven zolang de functie warm is.
const zoho = maakZoho({ orgFoutTekst: 'Zoho Desk org ID niet gevonden', cacheOrgId: true });

// haalStore, haalLive, nu, wacht en liveTimeoutMs zijn testnaden.
export function maakHandler({ haalStore = standaardStore, haalLive = () => haalTickets(zoho), nu, wacht, liveTimeoutMs } = {}) {
  async function kern(event, context, gebruiker) {
    const headers = { ...CORS_V1 };

    try {
      const forceer = event?.queryStringParameters?.vers === '1';
      const r = await leverTickets({ haalStore, haalLive, nu, wacht, forceer, liveTimeoutMs });
      try { huidigeMeting()?.zetBron(r.bron, r.leeftijdMs); } catch { /* meting is nooit een reden voor een fout */ }
      if (r.bron === 'snapshot') {
        headers['X-Blitz-Bron'] = 'snapshot';
        headers['X-Blitz-Leeftijd'] = String(Math.round(r.leeftijdMs / 1000));
        // Enkel als Zoho faalde: de client toont dan "Gegevens van HH:MM — Zoho even niet bereikbaar".
        if (r.verouderd) headers['X-Blitz-Verouderd'] = '1';
      }
      return { statusCode: 200, headers, body: JSON.stringify(r.body) };
    } catch (err) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }
  return beveiligV1('tickets', kern);
}

export default alsV2(maakHandler());
