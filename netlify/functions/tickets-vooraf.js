// Geplande voorlading van de Zoho-tickets: ververst de momentopname (netlify/lib/tickets-snapshot.js) zodat /api/tickets ze
// meteen kan serveren in plaats van zelf ~27 Zoho-aanroepen te doen. Draait elke 2 minuten; de functie beslist zelf of er echt
// geladen wordt: in werkuren (ma-vr 07:00-19:00 Brusselse tijd) vanaf 90 s oud, daarbuiten ongeveer elk kwartier, en altijd
// meteen als een wijzigende functie de momentopname als verouderd markeerde. Zo blijft het Zoho-verbruik op ongeveer 10 % van
// de dagelijkse limiet. Netlify draait geplande functies enkel op de gepubliceerde productie-deploy, nooit op een tak of preview.
// Geplande functie zonder eigen `config.path`. Of ze via de `/api/*`-redirect van netlify.toml van buitenaf aanroepbaar is, is NIET
// geverifieerd (de Netlify-documentatie zegt dat een geplande functie niet rechtstreeks via een URL te starten is); controleer dat na
// de eerste deploy met `curl -i https://blitz-planning.netlify.app/api/tickets-vooraf`. Voor het geval het wel kan: rij 'open' in de
// rechtentabel (de scheduler draagt geen sessie), onschadelijk (een aanroep doet hoogstens een lading als die toch al aan de beurt
// was; het slot laat een verliezer niet laden en de leeftijdsgrens begrenst de belasting) en het antwoord en de logs bevatten nooit
// ticketgegevens, enkel aantallen.
import { maakZoho } from '../lib/zoho.js';
import { haalTickets } from '../lib/tickets-ophalen.js';
import { voorlaad, standaardStore } from '../lib/tickets-snapshot.js';

const zoho = maakZoho({ orgFoutTekst: 'Zoho Desk org ID niet gevonden', cacheOrgId: true });

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// haalStore, haalLive, nu en log zijn testnaden.
export function maakHandler({ haalStore = standaardStore, haalLive = () => haalTickets(zoho), nu, log = console.error } = {}) {
  return async () => {
    try {
      const r = await voorlaad({ haalStore, haalLive, nu, log });
      if (r.resultaat === 'ververst') console.log(`[tickets-vooraf] ververst: ${r.tickets} in te plannen, ${r.wachtend} wachtend, ${r.gepland} gepland`);
      return json(r.resultaat === 'mislukt' ? 500 : 200, r);
    } catch (e) {
      console.error('[tickets-vooraf] mislukt (' + (e?.name || 'Error') + ')');
      return json(500, { resultaat: 'mislukt' });
    }
  };
}

export default async () => maakHandler()();

export const config = { schedule: '*/2 * * * *' };
