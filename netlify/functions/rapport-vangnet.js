// Scheduled Function (schema in netlify.toml, elke 5 min): vangnet voor de achtergrondverwerking
// van rapporten + migratie van oude rapport-HTML naar inhoudsblobs. Logica: netlify/lib/rapport-vangnet-*.js.
// Lokaal aan te roepen met POST /api/rapport-vangnet + header X-Blitz-Test: 1 (testopslag).
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { isLokaleDev } from '../lib/lokale-dev.js';
import { voerVangnetUit } from '../lib/rapport-vangnet-run.js';
import { startAchtergrondtaak } from '../lib/rapport-achtergrond.js';
import { verwerkRapport } from '../lib/rapport-verwerking.js';
import { maakVerwerker } from '../lib/rapport-verwerker.js';

// De achtergrondfunctie weigert aanroepen zonder interne sleutel (afgeleid van SESSIE_GEHEIM): zonder geheim blijven rapporten
// op 'wacht'. Eenmalig per koude start duidelijk melden.
let geheimGemeld = false;

export default async (req) => {
  if (!process.env.SESSIE_GEHEIM && !geheimGemeld) {
    geheimGemeld = true;
    console.error('[rapport-vangnet] SESSIE_GEHEIM ontbreekt: de achtergrondfunctie weigert elke aanroep, rapporten blijven op wacht (zet de variabele in Netlify)');
  }
  // Testverzoeken (X-Blitz-Test) enkel lokaal: een aanroep van buitenaf kan zo geen testkopie laten maken.
  const testModus = isTestVerzoek(req) && isLokaleDev();
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
  // Buiten lokale dev geen aantallen of id's in het antwoord.
  return new Response(JSON.stringify(isLokaleDev() ? resultaat : { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
