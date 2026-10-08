// Scheduled Function (schema in netlify.toml, elke 5 min): vangnet voor de achtergrondverwerking
// van rapporten + migratie van oude rapport-HTML naar inhoudsblobs. Logica: netlify/lib/rapport-vangnet-*.js.
// Lokaal aan te roepen met POST /api/rapport-vangnet + header X-Blitz-Test: 1 (testopslag).
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { voerVangnetUit } from '../lib/rapport-vangnet-run.js';
import { startAchtergrondtaak } from '../lib/rapport-achtergrond.js';
import { verwerkRapport } from '../lib/rapport-verwerking.js';
import { maakVerwerker } from '../lib/rapport-verwerker.js';

export default async (req) => {
  const testModus = isTestVerzoek(req);
  const store = getStore({ name: winkelNaam(req), consistency: 'strong' });
  if (testModus) await zorgVoorTestkopie(getStore);

  const origin = testModus ? new URL(req.url).origin : (process.env.URL || 'https://blitz-planning.netlify.app');
  // Terugvaloptie: alleen aan te zetten als de live-proef toont dat Background Functions niet draaien.
  const zelfVerwerken = process.env.BLITZ_VANGNET_ZELF === '1';

  const resultaat = await voerVangnetUit({
    store,
    zelfVerwerken,
    start: id => startAchtergrondtaak({ origin, id, testModus }),
    verwerk: async id => {
      const { upload, maxPogingen } = await maakVerwerker({ store, testModus });
      return verwerkRapport(id, { store, upload, maxPogingen });
    },
  });
  console.log('[rapport-vangnet]', JSON.stringify(resultaat));
  return new Response(JSON.stringify(resultaat), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
