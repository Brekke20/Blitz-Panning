// Dagelijkse opruiming van de verkoperblobs (alle `sales/*`, ook van geblokkeerde of verwijderde verkopers, in de echte opslag EN in de testopslag):
// wist leads zonder activiteit in de laatste 12 maanden, blokken en grafstenen ouder dan 12 maanden (zie lib/sales-opruimen.js).
// Geplande functie zonder eigen `config.path`, maar via de `/api/*`-redirect van netlify.toml wel van buitenaf aan te roepen.
// Daarom: idempotent en onschadelijk (er wordt enkel gewist wat al verouderd is) en begrensd in belasting: de opruiming draait
// hoogstens eens per MIN_TUSSENPOOZ_MS (marker-blob `sales-opruimen-laatste`, bewust NIET onder `sales/`); een aanroep binnen dat
// venster antwoordt 200 { overgeslagen: true } zonder een verkoperblob te lezen. De dagelijkse scheduler valt buiten dat venster.
// Rij 'open' in de rechtentabel (de scheduler draagt geen sessie), zoals `activiteit-opruimen`. Antwoorden en logs bevatten nooit
// persoonsgegevens.
import { getStore } from '@netlify/blobs';
import { ruimAllesOp } from '../lib/sales-opruimen.js';
import { authStore } from '../lib/auth-antwoord.js';
import { TEST_WINKEL } from '../lib/testmodus.js';

export const MIN_TUSSENPOOZ_MS = 6 * 60 * 60 * 1000;
export const MARKER_SLEUTEL = 'sales-opruimen-laatste';

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export function maakOpruimHandler({ getStore: haalStore, nu = () => Date.now() } = {}) {
  return async () => {
    try {
      const store = await authStore(haalStore);
      const moment = nu();
      const marker = await store.get(MARKER_SLEUTEL, { type: 'json' });
      const laatste = Date.parse(marker?.op);
      if (Number.isFinite(laatste) && moment - laatste < MIN_TUSSENPOOZ_MS && moment >= laatste) {
        return json(200, { overgeslagen: true });
      }
      // Vooraf markeren: gelijktijdige aanroepen binnen het venster slaan over. Een mislukte run wordt door de volgende
      // geplande run (na een dag) herhaald.
      await store.setJSON(MARKER_SLEUTEL, { op: new Date(moment).toISOString() });
      const r = await ruimAllesOp({ store, nu: moment });
      // De testopslag kan door een testverzoek echte leads bevatten (een export ingeladen in testmodus): dezelfde termijn, zonder logregel.
      try {
        const test = await ruimAllesOp({ store: await haalStore({ name: TEST_WINKEL, consistency: 'strong' }), nu: moment, logStore: null });
        r.gewist += test.gewist; r.blokkenGewist += test.blokkenGewist; r.grafstenenGewist += test.grafstenenGewist;
        if (test.mislukt) r.mislukt = (r.mislukt ?? 0) + test.mislukt;
      } catch (e) {
        r.mislukt = (r.mislukt ?? 0) + 1;
        console.error('[sales-opruimen] testopslag mislukt (' + (e?.name || 'Error') + ')');
      }
      if (r.gewist || r.blokkenGewist || r.grafstenenGewist) console.log(`[sales-opruimen] ${r.gewist} lead(s), ${r.blokkenGewist} blok(ken) en ${r.grafstenenGewist} grafsteen(en) gewist`);
      if (r.mislukt) return json(500, { ...r, error: 'Opruimen was niet overal gelukt.' });
      return json(200, r);
    } catch (e) {
      console.error('[sales-opruimen] mislukt (' + (e?.name || 'Error') + ')');
      return json(500, { error: 'Opruimen mislukt.' });
    }
  };
}

export default async () => maakOpruimHandler({ getStore })();

export const config = { schedule: '@daily' };
