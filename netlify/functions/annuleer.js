// /api/annuleer
//   GET                         -> { redenen: [{code,label}] }   (geen Zoho)
//   POST { voorbeeld:true, naam, datum, tijdslot?, uur?, reden, toelichting? } -> { html }  (nooit Zoho)
//   POST { ticketId, reden, toelichting, mailKlant, door } -> annuleert de afspraak:
//        (optioneel) sendReply per ontvanger EERST, daarna PATCH status + datum wissen,
//        interne notitie, register wissen.
// Testmodus (X-Blitz-Test: 1): nooit Zoho; het register wordt wel gewist in de teststore.
import { getStore } from '@netlify/blobs';
import { isTestVerzoek, winkelNaam, nepZohoAntwoord, zorgVoorTestkopie } from '../lib/testmodus.js';
import { leesRegister, wisVoorstel } from '../lib/voorstelregister.js';
import { datumInBrussel } from '../lib/bevestigingslink.js';
import { maakZoho } from '../lib/zoho.js';
import { maakCors, v2Json, v2Opties } from '../lib/http.js';
import {
  REDENEN, valideerAnnulatie, valideerRedenToelichting, bouwAnnulatieMail, bouwAnnulatieNotitie, escHtml,
} from '../lib/annulatie.js';
import { beveiligV2 } from '../lib/beveiligd.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Statussen waarin een afspraak effectief 'gepland' is (annuleren heeft dan zin).
const GEPLAND = ['Wachten op bevestiging planning', 'Geplande service', 'Geplande support'];

const CORS = maakCors({ methoden: 'GET, POST, OPTIONS', headers: 'Content-Type, X-Blitz-Test', inhoudType: 'application/json' });
const json = (status, obj) => v2Json(status, obj, CORS);

function uurInBrussel(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(t).replace(/^24:/, '00:');
}

function tijdstipNu() {
  return new Intl.DateTimeFormat('nl-BE', {
    timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '').replace(/\s+24:/, ' 00:');
}

export function maakHandler({ getStore: haalStore, fetch: doFetch }) {
  // Tokencache per handler-instantie (niet op moduleniveau: geen lekken tussen tests).
  const zoho = maakZoho({ fetch: doFetch, tokenFoutMetData: false });

  async function addZohoComment(ticketId, accessToken, orgId, content) {
    // Enkel loggen bij een fout: de annulering zelf is op dit punt al gelukt.
    try {
      const res = await zoho.verzoek(`/tickets/${ticketId}/comments`, {
        token: accessToken, orgId, methode: 'POST', json: { content, isPublic: false },
      });
      if (!res.ok) console.error('Zoho ticket-comment mislukt:', res.status, await res.text().catch(() => ''));
    } catch (e) {
      console.error('Zoho ticket-comment mislukt:', e?.message || e);
    }
  }

  return async (req) => {
    if (req.method === 'OPTIONS') return v2Opties(CORS);

    if (req.method === 'GET') {
      return json(200, { redenen: REDENEN.map(({ code, label }) => ({ code, label })) });
    }
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });

    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
    if (!body || typeof body !== 'object') return json(400, { error: 'Ongeldige JSON' });

    // Mailvoorbeeld: nooit Zoho, ook buiten testmodus.
    if (body.voorbeeld === true) {
      const rt = valideerRedenToelichting(body);
      if (!rt.ok) return json(400, { error: rt.fout });
      if (body.datum != null && !(typeof body.datum === 'string' && DATE_RE.test(body.datum))) {
        return json(400, { error: 'datum moet YYYY-MM-DD zijn' });
      }
      const naam = typeof body.naam === 'string' ? body.naam.trim().slice(0, 100) : '';
      const tekst = v => (typeof v === 'string' ? v.trim().slice(0, 40) : '');
      const html = bouwAnnulatieMail({
        naam, datum: body.datum || null, tijdslot: tekst(body.tijdslot), uur: tekst(body.uur),
        reden: rt.waarde.reden, toelichting: rt.waarde.toelichting,
      });
      return json(200, { html });
    }

    const test = isTestVerzoek(req);
    const v = valideerAnnulatie(body, { test });
    if (!v.ok) return json(400, { error: v.fout });
    const { ticketId, reden, toelichting, mailKlant, door } = v.waarde;

    if (test) await zorgVoorTestkopie(haalStore);
    const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });

    if (test) {
      await wisVoorstel(store, ticketId);
      return json(200, nepZohoAntwoord({
        ok: true, ticketId,
        emailSent: { contact: mailKlant, klant: false, installateur: false }, fouten: [],
      }));
    }

    try {
      const { token: accessToken, orgId } = await zoho.haalToegang();

      const ticketRes  = await zoho.verzoek(`/tickets/${ticketId}`, { token: accessToken, orgId });
      const ticketData = await ticketRes.json().catch(() => ({}));
      if (ticketRes.status === 404) return json(404, { error: 'Ticket niet gevonden' });
      if (!ticketRes.ok) return json(502, { error: 'Zoho ticket ophalen mislukt' });

      // Niet (meer) gepland in Zoho: nooit een annulatiemail sturen; enkel vergrendeling opruimen.
      const ticketStatus = ticketData.status || '';
      if (!GEPLAND.includes(ticketStatus)) {
        if (mailKlant) {
          return json(409, {
            error: 'Afspraak is niet (meer) gepland in Zoho — klant niet gemaild. Kies "Nee, ik verwittig zelf" om enkel de vergrendeling op te ruimen.',
            emailSent: { contact: false, klant: false, installateur: false },
            nietGepland: true,
          });
        }
        const redenLabel = REDENEN.find(r => r.code === reden).label;
        const opruimNotitie = `Vergrendeling opgeruimd via Blitz Planning${door ? ` door ${escHtml(door)}` : ''} op ${tijdstipNu()}. Ticket stond al op ${escHtml(ticketStatus || 'onbekend')}. Reden: ${escHtml(redenLabel)}${toelichting ? ` — ${escHtml(toelichting)}` : ''}.`;
        await addZohoComment(ticketId, accessToken, orgId, opruimNotitie);
        const leeg = { contact: false, klant: false, installateur: false };
        try {
          await wisVoorstel(store, ticketId);
        } catch (e) {
          console.error('Register wissen mislukt bij opruimen:', e?.message || e);
          return json(200, {
            ok: true, emailSent: leeg, fouten: [], opgeruimd: true,
            waarschuwing: 'Vergrendeling opruimen: het voorstel-register kon niet bijgewerkt worden. Herlaad de planner.',
          });
        }
        return json(200, { ok: true, emailSent: leeg, fouten: [], opgeruimd: true });
      }

      const cf = ticketData.cf || {};
      const contactEmail      = ticketData.contact?.email || ticketData.contact?.emailId || ticketData.email || '';
      const klantEmail        = cf.cf_e_mail_eindklant || '';
      const installateurEmail = cf.cf_e_mail_installateur || '';
      const seenEmails = new Set();
      const ontvangers = [
        { doelgroep: 'contact',      email: contactEmail },
        { doelgroep: 'klant',        email: klantEmail },
        { doelgroep: 'installateur', email: installateurEmail },
      ].filter(o => {
        const key = o.email.toLowerCase();
        if (!o.email || seenEmails.has(key)) return false;
        seenEmails.add(key);
        return true;
      });

      // Datum/tijdslot: register-tijdslot enkel als het voor dezelfde datum gold.
      const datum = datumInBrussel(cf.cf_interventie_datm);
      let tijdslot = null;
      try {
        const reg = await leesRegister(store);
        const e = reg.status[ticketId];
        if (e && e.tijdslot && datum && e.tijdslotDatum === datum) tijdslot = e.tijdslot;
      } catch (e) { console.error('Register lezen mislukt:', e?.message || e); }
      const uur = !tijdslot && cf.cf_interventie_datm ? uurInBrussel(cf.cf_interventie_datm) : null;

      const emailSent = { contact: false, klant: false, installateur: false };
      const fouten = [];

      // 1. Mail EERST (sendReply zet de status anders terug op "Wachten op klant").
      if (mailKlant && ontvangers.length) {
        let fromEmailAddress = process.env.ZOHO_FROM_EMAIL || null;
        try {
          if (!fromEmailAddress) {
            const emailRes  = await zoho.verzoek('/emailAddresses?limit=50', { token: accessToken, orgId });
            const emailData = await emailRes.json();
            const cand = (emailData?.data || []).find(a => a.emailAddress && a.emailAddress.includes('@'));
            fromEmailAddress = cand?.emailAddress || null;
            if (!fromEmailAddress) throw new Error('Geen from-emailadres gevonden in Zoho (stel ZOHO_FROM_EMAIL in)');
          }
        } catch (e) {
          console.error('From-adres bepalen mislukt:', e.message);
          for (const { doelgroep } of ontvangers) fouten.push({ doelgroep, fout: e.message });
          fromEmailAddress = null;
        }

        if (fromEmailAddress) {
          const naam = (typeof body.naam === 'string' && body.naam.trim())
            ? body.naam.trim().slice(0, 100)
            : [ticketData.contact?.firstName, ticketData.contact?.lastName].filter(Boolean).join(' ');
          const emailHtml = bouwAnnulatieMail({ naam, datum, tijdslot, uur, reden, toelichting });
          for (const { doelgroep, email } of ontvangers) {
            try {
              const replyRes = await zoho.verzoek(`/tickets/${ticketId}/sendReply`, {
                token: accessToken, orgId, methode: 'POST',
                json: { channel: 'EMAIL', contentType: 'html', content: emailHtml, fromEmailAddress, to: email },
              });
              const replyText = await replyRes.text();
              let replyData = {};
              if (replyText) try { replyData = JSON.parse(replyText); } catch (_) {}
              if (!replyRes.ok) {
                if (!JSON.stringify(replyData).includes('Empty Recipients')) {
                  throw new Error(`Zoho sendReply fout (${replyRes.status}) naar ${doelgroep}: ${JSON.stringify(replyData)}`);
                }
              } else {
                emailSent[doelgroep] = true;
              }
            } catch (err) {
              console.error(`Versturen naar ${doelgroep} mislukt:`, err.message);
              fouten.push({ doelgroep, fout: err.message });
            }
          }
        }
      }

      // 2. PATCH NA sendReply.
      const patchRes = await zoho.verzoek(`/tickets/${ticketId}`, {
        token: accessToken, orgId, methode: 'PATCH',
        json: { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } },
      });
      if (!patchRes.ok) {
        const t = await patchRes.text().catch(() => '');
        console.error(`Zoho PATCH fout (${patchRes.status}):`, t);
        return json(502, { error: `Zoho PATCH fout (${patchRes.status})`, emailSent, fouten });
      }

      // 3. Interne notitie (enkel loggen bij fout).
      const gemaild = ontvangers.filter(o => emailSent[o.doelgroep]).map(o => o.email);
      const notitie = bouwAnnulatieNotitie({
        datum, tijdslot, uur, door, tijdstip: tijdstipNu(),
        redenLabel: REDENEN.find(r => r.code === reden).label,
        toelichting, mailKlant, gemaild,
      });
      await addZohoComment(ticketId, accessToken, orgId, notitie);

      // 4. Register wissen.
      try {
        await wisVoorstel(store, ticketId);
      } catch (e) {
        console.error('Register wissen mislukt na geslaagde annulatie:', e?.message || e);
        return json(200, {
          ok: true, emailSent, fouten,
          waarschuwing: 'Afspraak geannuleerd in Zoho, maar het voorstel-register kon niet bijgewerkt worden. Herlaad de planner.',
        });
      }

      return json(200, { ok: true, emailSent, fouten });
    } catch (err) {
      console.error('annuleer fout:', err);
      return json(500, { error: err.message });
    }
  };
}

export default beveiligV2('annuleer', maakHandler({ getStore, fetch: globalThis.fetch }));

export const config = { path: '/api/annuleer' };
