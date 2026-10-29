// /api/tickets
// Haalt tickets op uit Zoho Desk op basis van status (zie netlify/lib/tickets-ophalen.js).
//
// Sinds de voorlading serveert deze functie eerst de momentopname uit Netlify Blobs (netlify/lib/tickets-snapshot.js, ververst door
// de geplande functie tickets-vooraf): die is ongefilterd en voor elke toegelaten rol hetzelfde, net als de live lading. Is ze niet
// vers (ouder dan 5 min, of een wijzigende functie markeerde ze), dan wordt live uit Zoho opgehaald en de momentopname herschreven.
// Faalt Zoho, dan krijgt de gebruiker de laatste goede momentopname (header X-Blitz-Verouderd) in plaats van een fout.
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

// haalStore, haalLive, nu en wacht zijn testnaden.
export function maakHandler({ haalStore = standaardStore, haalLive = () => haalTickets(zoho), nu, wacht } = {}) {
  async function kern(event, context, gebruiker) {
    const headers = { ...CORS_V1 };

    try {
      const r = await leverTickets({ haalStore, haalLive, nu, wacht });
      try { huidigeMeting()?.zetBron(r.bron, r.leeftijdMs); } catch { /* meting is nooit een reden voor een fout */ }
      if (r.bron === 'snapshot') {
        headers['X-Blitz-Bron'] = 'snapshot';
        headers['X-Blitz-Leeftijd'] = String(Math.round(r.leeftijdMs / 1000));
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
