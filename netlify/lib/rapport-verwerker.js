// Bedrading van de rapportverwerking: kiest de echte upload (Chromium + Zoho) of de nep-upload
// (testmodus). Enige plek die rapport-zoho.js (Chromium) kent voor de achtergrondverwerking;
// wordt niet door unit-tests geïmporteerd. Gebruikt door rapport-verwerk-background en het vangnet.

import { maakUploader } from './rapport-upload.js';
import { maakPdf, uploadPdfNaarZoho } from './rapport-zoho.js';
import { MAX_POGINGEN } from './rapport-verwerking.js';
import { testUpload } from './rapport-testupload.js';

export function maakVerwerker({ store, testModus }) {
  if (testModus) return { upload: testUpload, maxPogingen: 1 };
  const uploadRapport = maakUploader({ maakPdf, uploadPdfNaarZoho });
  return {
    upload: ({ html, ticketId, filename, verzendId }) => uploadRapport({ html, ticketId, filename, verzendId, store }),
    maxPogingen: MAX_POGINGEN,
  };
}
