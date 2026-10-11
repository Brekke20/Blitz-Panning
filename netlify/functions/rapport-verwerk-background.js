// Netlify Background Function (de naam eindigt op '-background'; geen config.path): verwerkt één
// rapport naar Zoho (PDF + upload) buiten het request van de technieker om.
// Body: { id }. Een ongeldig id doet niets. Zie netlify/lib/rapport-verwerking.js.
// Beveiliging: de functie wordt server-naar-server aangeroepen (rapport-ontvangen, rapport-archief, rapport-vangnet)
// zonder gebruikerssessie, en is via /.netlify/functions/ publiek bereikbaar. Daarom staat ze in de rechtentabel
// als 'open' met een EIGEN controle: enkel een aanroep met de interne sleutel voor dit id doet iets
// (netlify/lib/intern-token.js). Netlify negeert het antwoord van een background function (altijd 202 naar de
// aanroeper), dus een weigering blijft stil en doet gewoon niets.
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek } from '../lib/testmodus.js';
import { isGeldigId } from '../lib/rapport-inhoud.js';
import { verwerkRapport } from '../lib/rapport-verwerking.js';
import { maakVerwerker } from '../lib/rapport-verwerker.js';
import { controleerInternToken } from '../lib/intern-token.js';

export default async (req) => {
  let id;
  try { ({ id } = await req.json()); } catch { return new Response(null, { status: 202 }); }
  if (!isGeldigId(id)) return new Response(null, { status: 202 });
  if (!controleerInternToken(req, id)) {
    console.error('[rapport-verwerk-background] aanroep zonder geldige interne sleutel genegeerd');
    return new Response(null, { status: 202 });
  }

  const store = getStore({ name: winkelNaam(req), consistency: 'strong' });
  const { upload, maxPogingen } = await maakVerwerker({ store, testModus: isTestVerzoek(req) });
  await verwerkRapport(id, { store, upload, maxPogingen });
  return new Response(null, { status: 202 });
};
