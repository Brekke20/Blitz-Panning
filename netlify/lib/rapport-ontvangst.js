// Snelle, idempotente ontvangst van een rapport (POST /api/rapport-ontvangen): inhoud in een eigen
// blob, lichte entry in de rapportlijst met verwerking 'wacht' (of 'lokaal'). De zware verwerking
// (PDF + Zoho) gebeurt later in de Background Function. Zie rapport-verwerking.js.

import { bouwEntry, voegToeOfWerkBij, wijzigLijst, effectieveStatus, stripZwareVelden } from './rapportlijst.js';
import { valideerOntvangst, schrijfInhoud, verwijderInhoud } from './rapport-inhoud.js';
import { nieuweVerwerking } from './rapport-verwerking.js';

const NIET_BEREIKBAAR = { error: 'Rapportarchief tijdelijk niet bereikbaar, probeer opnieuw.' };

export async function verwerkOntvangst({ store, body, nu = new Date(), testModus = false }) {
  const v = valideerOntvangst(body, { testModus });
  if (!v.ok) return { status: v.status, body: { error: v.fout }, startNodig: false };
  const { id, archiveBody, html, ticketId, filename, isLocal } = v.waarden;

  try {
    const entry = {
      ...bouwEntry({ ...archiveBody, id, ticketId }, { nu, licht: true }),
      verwerking: nieuweVerwerking(isLocal ? 'lokaal' : 'wacht', nu),
      inhoudBeschikbaar: true,
      zohoUploaded: false,
    };
    // Inhoud eerst, in een eigen key: staat de entry er, dan is de inhoud er ook. De entry zelf
    // gaat mee in de blob, zodat verwerkRapport ze kan terugzetten na een lost update op de lijst.
    await schrijfInhoud(store, { id, html, ticketId, filename, isLocal, entry }, nu);

    let startNodig = false;
    let vervangenId = null;
    const res = await wijzigLijst(store, ({ rapports }) => {
      startNodig = false;
      vervangenId = null;
      const bestaand = rapports.find(r => r.id === id);
      if (bestaand) {
        // Oude flow: wel gearchiveerd (zelfde id), maar de Zoho-upload is nooit gebeurd (bv.
        // scherm vergrendeld). Zo'n entry heeft geen `verwerking`: upgraden naar de nieuwe flow
        // zodat het rapport alsnog naar Zoho gaat. Al geüpload of geannuleerd blijft onaangeroerd.
        if (!bestaand.verwerking && bestaand.zohoUploaded !== true && bestaand.geannuleerd !== true) {
          const verwerking = nieuweVerwerking(isLocal ? 'lokaal' : 'wacht', nu);
          const idx = rapports.findIndex(r => r.id === id);
          const lijst = [...rapports];
          lijst[idx] = {
            ...bestaand,
            rapportData: stripZwareVelden(bestaand.rapportData),
            inhoudBeschikbaar: true,
            verwerking,
          };
          startNodig = !isLocal;
          return { rapports: lijst, controle: terug => terug.some(r => r.id === id && r.verwerking) };
        }
        // Zelfde id al ontvangen (herhaalde POST): niets wijzigen; enkel een nog wachtende entry
        // opnieuw laten starten.
        startNodig = effectieveStatus(bestaand) === 'wacht';
        return null;
      }
      const uit = voegToeOfWerkBij(rapports, entry, archiveBody);
      vervangenId = uit.vervangenId;
      startNodig = !isLocal;
      return { rapports: uit.rapports, controle: terug => terug.some(r => r.id === id) };
    });
    if (!res.ok) return { status: 503, body: NIET_BEREIKBAAR, startNodig: false };

    if (vervangenId) await verwijderInhoud(store, vervangenId);
    return { status: 200, body: { ok: true, id }, startNodig };
  } catch (err) {
    console.error('[rapport-ontvangen] opslag mislukt:', err?.message || err);
    return { status: 503, body: NIET_BEREIKBAAR, startNodig: false };
  }
}
