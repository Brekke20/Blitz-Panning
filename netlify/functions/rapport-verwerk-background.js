// Netlify Background Function (de naam eindigt op '-background'; geen config.path): verwerkt één
// rapport naar Zoho (PDF + upload) buiten het request van de technieker om.
// Body: { id }. Een ongeldig id doet niets. Zie netlify/lib/rapport-verwerking.js.
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek } from '../lib/testmodus.js';
import { isGeldigId } from '../lib/rapport-inhoud.js';
import { verwerkRapport } from '../lib/rapport-verwerking.js';
import { maakVerwerker } from '../lib/rapport-verwerker.js';

export default async (req) => {
  let id;
  try { ({ id } = await req.json()); } catch { return; }
  if (!isGeldigId(id)) return;

  const store = getStore({ name: winkelNaam(req), consistency: 'strong' });
  const { upload, maxPogingen } = maakVerwerker({ store, testModus: isTestVerzoek(req) });
  await verwerkRapport(id, { store, upload, maxPogingen });
};
