// Bedrading van de rapportverwerking: kiest de echte upload (Chromium + Zoho) of de nep-upload
// (testmodus). Enige plek die rapport-zoho.js (Chromium) kent voor de achtergrondverwerking;
// wordt niet door unit-tests geïmporteerd. Gebruikt door rapport-verwerk-background en het vangnet.

import { maakUploader } from './rapport-upload.js';
import { MAX_POGINGEN } from './rapport-verwerking.js';
import { testUpload } from './rapport-testupload.js';

// Async: rapport-zoho.js (Chromium/puppeteer) wordt enkel buiten de testmodus dynamisch geladen.
export async function maakVerwerker({ store, testModus }) {
  if (testModus) return { upload: testUpload, maxPogingen: 1 };
  const { maakPdf, uploadPdfNaarZoho } = await import('./rapport-zoho.js');
  const uploadRapport = maakUploader({ maakPdf, uploadPdfNaarZoho });
  return {
    upload: ({ html, ticketId, filename, verzendId }) => uploadRapport({ html, ticketId, filename, verzendId, store }),
    maxPogingen: MAX_POGINGEN,
  };
}
