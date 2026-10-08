// /api/send-rapport
// Genereert een PDF van een al-gearchiveerd service rapport (uit de opgeslagen HTML) en
// verstuurt die naar klant en/of installateur (wie een e-mailadres heeft), via Zoho Desk
// sendReply -- zelfde aanpak als propose.js. Manuele, bewuste actie vanuit het
// Rapporten-tabblad, nooit automatisch.
// POST body: { ticketId, html, ticketNumber, preview? }
// preview: true -> bouwt de e-mail-inhoud per ontvanger op en geeft die terug zonder iets
// te versturen (voor het voorbeeldvenster in de app); anders (of ontbrekend): echte verzending.

import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import { isTestVerzoek, nepZohoAntwoord } from '../lib/testmodus.js';
import { maakZoho, leesJsonVeilig, globaleFetch } from '../lib/zoho.js';
import { CORS_V1, v1Json, v1Methode } from '../lib/http.js';
import { beveiligV1 } from '../lib/beveiligd.js';

const CHROMIUM_URL  = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildRapportEmailHtml({ ticketNumber, naam }) {
  const bolt = `<svg width="20" height="30" viewBox="0 0 20 30" xmlns="http://www.w3.org/2000/svg"><line x1="15" y1="2" x2="3" y2="16" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/><line x1="17" y1="14" x2="5" y2="28" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/></svg>`;
  const greeting = naam ? `Geachte ${escHtml(naam)}` : 'Beste';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 0"><tr><td>
  <table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10)">
    <tr><td style="background:#181e24;padding:26px 32px">${bolt}<span style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:4px;color:#00dfa3;margin-left:12px">BLITZ</span></td></tr>
    <tr><td style="background:#00dfa3;height:3px;font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:32px 36px">
      <p style="margin:0 0 16px;font-size:15px;color:#181e24">${greeting},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.65">In bijlage vindt u het service rapport${ticketNumber ? ` voor ticket #${ticketNumber}` : ''}.</p>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">Met vriendelijke groeten,<br><strong style="color:#181e24">Team Blitz Power &mdash; Service &amp; Support</strong></p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

// PDF-naad (Z9): het blok hieronder is letterlijk verplaatst uit de handler.
async function standaardPdf(html) {
  let browser;
  try {
    const executablePath = await chromium.executablePath(CHROMIUM_URL);
    browser = await puppeteer.launch({ args: chromium.args, defaultViewport: chromium.defaultViewport, executablePath, headless: chromium.headless });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => { const u = req.url(); if (u.startsWith('data:') || u.startsWith('about:blank')) req.continue(); else req.abort(); });
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0mm', bottom: '12mm', left: '0mm', right: '0mm' } });
    await browser.close(); browser = null;
    return pdfBuffer;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

export function maakHandler({ fetch = globaleFetch, maakPdf = standaardPdf } = {}) {
  // Instantie per handler: de tokencache (55 min) leeft zolang de functie warm is.
  const zoho = maakZoho({ fetch });

  return async function handler(event) {
    const methodeAntwoord = v1Methode(event, ['POST'], CORS_V1);
    if (methodeAntwoord) return methodeAntwoord;

    try {
      const { ticketId, html, ticketNumber, preview } = JSON.parse(event.body || '{}');
      if (!ticketId || !html) return v1Json(400, { error: 'ticketId en html zijn verplicht' }, CORS_V1);
      if (!/^\d+$/.test(String(ticketId))) return v1Json(400, { error: 'Ongeldig ticketId' }, CORS_V1);

      // Testmodus: geen token, geen Zoho, geen PDF, geen mail -- meteen nep-succes. Het voorbeeld
      // toont één testontvanger; de echte verzending meldt emailSent.contact = true.
      if (isTestVerzoek(event)) {
        const extra = preview
          ? { preview: true, ontvangers: [{ doelgroep: 'contact', naam: 'Testcontact', email: 'test@example.invalid', html: buildRapportEmailHtml({ ticketNumber, naam: 'Testcontact' }) }] }
          : { success: true, emailSent: { contact: true, klant: false, installateur: false }, fouten: [], statusUpdated: true, statusFout: null };
        return v1Json(200, nepZohoAntwoord(extra), CORS_V1);
      }

      const { token, orgId } = await zoho.haalToegang();

      const ticketRes = await zoho.verzoek(`/tickets/${ticketId}`, { token, orgId });
      const ticketData = await ticketRes.json().catch(() => ({}));
      if (!ticketRes.ok) return v1Json(404, { error: 'Ticket niet gevonden' }, CORS_V1);
      const cf = ticketData.cf || {};
      const contactEmail      = ticketData.contact?.email || ticketData.contact?.emailId || ticketData.email || '';
      const contactNaam       = ticketData.contact?.name || ticketData.contact?.fullName
                               || (ticketData.contact?.firstName ? `${ticketData.contact.firstName} ${ticketData.contact.lastName || ''}`.trim() : '')
                               || '';
      const klantEmail        = cf.cf_e_mail_eindklant || '';
      const klantNaam         = cf.cf_naam_eindklant       || '';
      const installateurEmail = cf.cf_e_mail_installateur || '';
      const installateurNaam  = cf.cf_partner_installateur || '';
      const seenEmails = new Set();
      const ontvangers = [
        { doelgroep: 'contact',      email: contactEmail,      naam: contactNaam },
        { doelgroep: 'klant',        email: klantEmail,        naam: klantNaam },
        { doelgroep: 'installateur', email: installateurEmail, naam: installateurNaam },
      ].filter(o => {
        const key = o.email.toLowerCase();
        if (!o.email || seenEmails.has(key)) return false;
        seenEmails.add(key);
        return true;
      });
      if (!ontvangers.length) return v1Json(400, { error: 'Geen gekend e-mailadres (klant of installateur) op dit ticket' }, CORS_V1);

      // Voorbeeldmodus: dezelfde ticket-opzoeking en e-mail-opbouw als een echte verzending,
      // maar zonder PDF te genereren of Zoho's upload/sendReply-endpoints aan te roepen -- dit
      // garandeert dat het voorbeeld dat de gebruiker ziet exact is wat er bij een echte
      // verzending verstuurd wordt (zelfde functie, zelfde data), niet een aparte kopie die
      // uit sync kan lopen.
      if (preview) {
        return v1Json(200, {
          preview: true,
          ontvangers: ontvangers.map(o => ({
            doelgroep: o.doelgroep,
            naam:      o.naam,
            email:     o.email,
            html:      buildRapportEmailHtml({ ticketNumber, naam: o.naam }),
          })),
        }, CORS_V1);
      }

      const pdfBuffer = await maakPdf(html);

      let fromEmailAddress = process.env.ZOHO_FROM_EMAIL || null;
      if (!fromEmailAddress) {
        const emailRes = await zoho.verzoek('/emailAddresses?limit=50', { token, orgId });
        const emailData = await emailRes.json();
        fromEmailAddress = (emailData?.data || []).find(a => a.emailAddress?.includes('@'))?.emailAddress || null;
        if (!fromEmailAddress) throw new Error('Geen from-emailadres gevonden in Zoho. Stel ZOHO_FROM_EMAIL in als Netlify env-var.');
      }

      // Een harde fout bij ontvanger 2 mag de al-verstuurde mail naar ontvanger 1 niet
      // weggooien: per ontvanger de fout opvangen, opslaan in `fouten` en doorgaan met de
      // volgende. De caller rapporteert op basis van emailSent, dus dit blijft een 200 --
      // een 500 is voorbehouden aan fouten vóór deze lus (token/org/ticket/PDF).
      const emailSent = { contact: false, klant: false, installateur: false };
      const fouten    = [];
      for (const { doelgroep, email, naam } of ontvangers) {
        try {
          const formData = new FormData();
          formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), `service-rapport-${ticketNumber || ticketId}.pdf`);
          const uploadRes = await zoho.verzoek('/uploads', { token, orgId, methode: 'POST', body: formData });
          const uploadData = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) throw new Error(`Zoho attachment-upload fout (${uploadRes.status}) voor ${doelgroep}: ${JSON.stringify(uploadData)}`);

          const replyRes = await zoho.verzoek(`/tickets/${ticketId}/sendReply`, {
            token, orgId, methode: 'POST',
            json: {
              channel: 'EMAIL', contentType: 'html', content: buildRapportEmailHtml({ ticketNumber, naam }),
              fromEmailAddress, to: email, attachmentIds: [uploadData.id],
            },
          });
          const replyData = await leesJsonVeilig(replyRes);
          if (!replyRes.ok) {
            if (!JSON.stringify(replyData).includes('Empty Recipients')) {
              throw new Error(`Zoho sendReply fout (${replyRes.status}) naar ${doelgroep}: ${JSON.stringify(replyData)}`);
            }
            // soft fail: emailSent[doelgroep] blijft false, geen fout melden
          } else {
            emailSent[doelgroep] = true;
          }
        } catch (ontvangerErr) {
          console.error(`Versturen naar ${doelgroep} mislukt:`, ontvangerErr.message);
          fouten.push({ doelgroep, fout: ontvangerErr.message });
        }
      }

      // Ticket-status -> Gesloten - ov, maar enkel als er effectief minstens één mail
      // verstuurd is (anders zou een mislukte verzending het ticket toch al sluiten).
      // PATCH komt na de verzend-lus, zelfde reden als in propose.js: Zoho past de status
      // soms zelf aan na sendReply, dus de PATCH moet daarna komen om te garanderen dat de
      // juiste status blijft staan. Een mislukte status-write mag de al-verstuurde mail(s)
      // niet verbergen, dus dit blijft een 200 met statusFout in de body.
      let statusUpdated = false;
      let statusFout = null;
      if (Object.values(emailSent).some(Boolean)) {
        try {
          const patchRes = await zoho.verzoek(`/tickets/${ticketId}`, {
            token, orgId, methode: 'PATCH',
            json: { status: 'Gesloten - ov' },
          });
          const patchData = await leesJsonVeilig(patchRes);
          if (!patchRes.ok) throw new Error(`Zoho PATCH fout (${patchRes.status}): ${JSON.stringify(patchData)}`);
          statusUpdated = true;
        } catch (patchErr) {
          console.error('Ticketstatus naar Gesloten - ov zetten mislukt:', patchErr.message);
          statusFout = patchErr.message;
        }
      }

      return v1Json(200, { success: true, emailSent, fouten, statusUpdated, statusFout }, CORS_V1);
    } catch (err) {
      return v1Json(500, { error: err.message }, CORS_V1);
    }
  };
}

export const handler = beveiligV1('send-rapport', maakHandler());
