// Geplande functie: dagelijks (07:00 UTC = 08:00 of 09:00 Brusselse tijd) een herinnering naar de klanten van wie het voorstel nog niet
// bevestigd is en wiens afspraak over 1 tot en met 3 dagen is. De logica staat in netlify/lib/herinnering.js (testbaar met nep-fetch).
// Netlify draait geplande functies enkel op de gepubliceerde productie-deploy, nooit op een tak of preview.
// Geplande functie zonder eigen `config.path`. Of ze via de `/api/*`-redirect van netlify.toml van buitenaf aanroepbaar is, is NIET
// geverifieerd (zie tickets-vooraf.js); controleer dat na de eerste deploy met `curl -i https://blitz-planning.netlify.app/api/herinnering-bevestiging`.
// Voor het geval het wel kan: rij 'open' in de rechtentabel (de scheduler draagt geen sessie), onschadelijk (er gaat hoogstens EEN herinnering per
// ticket en afspraakdatum uit, binnen het venster van 3 dagen; een tweede aanroep doet niets) en het antwoord en de logs bevatten nooit
// adressen of ticketgegevens, enkel aantallen.
import { maakZoho } from '../lib/zoho.js';
import { haalTickets } from '../lib/tickets-ophalen.js';
import { standaardStore } from '../lib/tickets-snapshot.js';
import { verwerkHerinneringen } from '../lib/herinnering.js';

const zoho = maakZoho({ orgFoutTekst: 'Zoho Desk org ID niet gevonden', cacheOrgId: true, tokenFoutMetData: false });

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// haalStore, haalLive, zoho, nu en log zijn testnaden.
export function maakHandler({ haalStore = standaardStore, haalLive, zoho: z = zoho, nu, log = console.error } = {}) {
  return async () => {
    try {
      const r = await verwerkHerinneringen({
        zoho: z, haalStore, haalTickets: haalLive || (() => haalTickets(z)), ...(nu ? { nu } : {}), log,
      });
      console.log(`[herinnering-bevestiging] ${r.verstuurd} verstuurd, ${r.overgeslagen} overgeslagen, ${r.fouten} fout(en), ${r.uitgesteld} uitgesteld van ${r.gecontroleerd}`);
      return json(200, r);
    } catch (e) {
      console.error('[herinnering-bevestiging] mislukt (' + (e?.name || 'Error') + ')');
      return json(500, { resultaat: 'mislukt' });
    }
  };
}

export default async () => maakHandler()();

export const config = { schedule: '0 7 * * *' };
