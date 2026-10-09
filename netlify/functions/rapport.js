// /api/rapport
// Genereert PDF van service rapport HTML en uploadt naar Zoho Desk als bijlage.
// POST body: { html: string, ticketId: string, filename: string, verzendId: string }
//
// Dunne v1-handler: validatie, testmodus, store ophalen en mapping naar HTTP-antwoorden. De
// eigenlijke logica zit in netlify/lib/ (rapport-upload.js, rapport-zoho.js, rapport-register.js)
// zodat de achtergrondfunctie ze kan hergebruiken.
//
// (T20) verzendId is het stabiele item.id van het outbox-item (public/js/rapport-wizard.js,
// crypto.randomUUID() bij aanmaak) -- dient als idempotentiesleutel tegen een dubbele
// PDF-bijlage op hetzelfde Zoho-ticket wanneer een eerdere upload wél server-side lukte, maar
// het antwoord de client nooit bereikte (zie docs/reviews/2026-09-22-outbox-onderzoek.md).

import { getStore } from '@netlify/blobs';
import { isTestVerzoek, winkelNaam, nepZohoAntwoord } from '../lib/testmodus.js';
import { normaliseerVerzendId } from '../lib/rapport-register.js';
import { maakPdf, uploadPdfNaarZoho } from '../lib/rapport-zoho.js';
import { maakUploader, markeerLijstUpgeload } from '../lib/rapport-upload.js';
import { beveiligV1 } from '../lib/beveiligd.js';
import { logVoorVerzoek } from '../lib/activiteit.js';

const standaardUploader = maakUploader({ maakPdf, uploadPdfNaarZoho });

// (C1) getStore() zit in een EIGEN try: faalt het (deze functie is een v1-handler(event) en de
// blobs-context in de Lambda-compat-runtime is onbewezen), dan gaat de upload gewoon door zonder
// register -- een geslaagde Zoho-upload mag nooit als 500 eindigen door een store-probleem.
function haalStore(event, geef = getStore) {
  try {
    return geef({ name: winkelNaam(event), consistency: 'strong' });
  } catch {
    return null;
  }
}

async function kern(event, context, gebruiker, { geefStore = getStore, uploadRapport = standaardUploader } = {}) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { html, ticketId, filename = 'service-rapport.pdf', verzendId: rawVerzendId } = JSON.parse(event.body || '{}');
    if (!html || !ticketId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'html en ticketId zijn verplicht' }) };
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig ticketId' }) };
    }
    // (Fix-ronde 1, punt 3) Een ongeldig-gevormd verzendId wordt genegeerd i.p.v. de aanvraag te
    // weigeren -- de idempotentie is een bonus, geen vereiste voor het kernpad.
    const verzendId = normaliseerVerzendId(rawVerzendId);

    // Testmodus: geen PDF (chromium), geen Zoho-upload, geen idempotentie-register --
    // meteen het succesantwoord dat outbox.js verwacht (res.ok; attachmentId is optioneel).
    if (isTestVerzoek(event)) {
      return { statusCode: 200, headers, body: JSON.stringify(nepZohoAntwoord({ success: true, attachmentId: 'test-bijlage' })) };
    }

    const store = haalStore(event, geefStore);
    const res = await uploadRapport({ html, ticketId, filename, verzendId, store });

    if (res.inProgress) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'Upload van dit rapport is al bezig', inProgress: true }),
      };
    }
    if (res.alUploaded) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, attachmentId: res.attachmentId || null, alreadyUploaded: true }),
      };
    }

    // Best-effort, mag de respons niet blokkeren/vertragen. (C1) markeerLijstUpgeload() vangt
    // intern al elke fout op, maar deze buitenste try/catch is defense-in-depth: een GESLAAGDE
    // upload mag NOOIT alsnog als 500 eindigen door iets dat hierna misloopt.
    try {
      await markeerLijstUpgeload(store, verzendId, res.attachmentId);
    } catch { /* de respons hieronder blijft altijd 200 na een geslaagde upload */ }

    // Eén regel per geslaagde PDF-bijlage (de idempotente herhaling hierboven logt niets).
    await logVoorVerzoek(event, gebruiker, { actie: 'rapport-verstuurd', onderwerp: String(ticketId), details: 'pdf-bijlage' }, { getStore: geefStore });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, attachmentId: res.attachmentId }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}

// getStore en maakPdf zijn testnaden (opslag/activiteitenlog en de PDF-generatie).
export const maakHandler = ({ getStore: geefStore, maakPdf: pdf } = {}) => {
  const uploadRapport = pdf ? maakUploader({ maakPdf: pdf, uploadPdfNaarZoho }) : undefined;
  return beveiligV1('rapport', (event, context, gebruiker) => kern(event, context, gebruiker, { geefStore, uploadRapport }));
};

export const handler = maakHandler();
