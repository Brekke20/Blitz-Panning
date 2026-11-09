// /api/confirm-afspraak
// Publieke, token-gevalideerde bevestigingslink uit de voorstelmail (Blok 1A). Geen login/auth
// zoals de rest van deze app — geldigheid wordt bewezen door een HMAC-ondertekende token in de
// URL (ticketId + vervaldatum + signature), niet door een sessie/wachtwoord.
//
// Bewust TWEE stappen (zie het amendement bovenaan Task 1 in het plan):
//   GET  -> toont een pagina met een "Ja, ik bevestig"-knop, GEEN side-effects (veilig voor
//           e-mail-scanners die links automatisch openen/pre-fetchen, bv. Microsoft Safe Links).
//   POST -> enkel bereikbaar door een echte klik op die knop (een <form>, geen link) -- voert
//           de eigenlijke bevestiging uit: Zoho-status wijzigen + IP/tijdstip als interne notitie
//           op het ticket vastleggen.
// Tweede keuze op dezelfde pagina: "Deze datum lukt niet" (POST met actie=weiger en een optionele opmerking): het ticket gaat
// terug naar 'Wachten op planning' (datum gewist), de opmerking komt als interne notitie op het ticket en het voorstelregister
// markeert het voorstel als afgewezen. De handtekening van de link is voor beide keuzes dezelfde; `keuze=nee` in de URL (niet
// ondertekend) klapt enkel het tweede formulier open en heeft nooit een ander effect.

import { controleerLink, datumInBrussel, bevestigingsNotitie, afwijzingsNotitie } from '../lib/bevestigingslink.js';
import { markeerBevestigd, markeerAfgewezen } from '../lib/voorstelregister.js';
import { logActiviteit } from '../lib/activiteit.js';
import { maakZoho } from '../lib/zoho.js';
import { markeerVerouderd, standaardStore } from '../lib/tickets-snapshot.js';

const MAX_OPMERKING = 1000;

const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
  };
}

// ── Zoho Desk (gedeelde onderdelen in ../lib/zoho.js; tokencache per module-instantie) ─────────
const zoho = maakZoho();

// ── HMAC-token ────────────────────────────────────────────────────────────────────────────────
// Ondertekenen en controleren gebeuren in de gedeelde module bevestigingslink.js (dezelfde als
// waarmee propose.js de link maakt), zodat beide kanten nooit uit elkaar lopen. De handtekening
// bevat datum én ontvanger (`d`); links zonder `d` (al verstuurde mails) blijven geldig.
// Niemand importeert de oude `signConfirmToken`-export van dit bestand; hij is bewust weggehaald.

// ── HTML ──────────────────────────────────────────────────────────────────────────────────────
function htmlPage({ title, message, ok, confirmForm }) {
  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;margin:0;padding:40px 16px;display:flex;justify-content:center}
  .card{max-width:420px;background:#fff;border-radius:8px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
  h1{font-size:18px;color:#181e24;margin:0 0 12px}
  p{font-size:14px;color:#3a3a3a;line-height:1.5;margin:0 0 18px}
  .icon{font-size:40px;margin-bottom:12px}
  .confirm-btn{display:inline-block;background:#00dfa3;color:#181e24;text-decoration:none;
    font-weight:700;font-size:14px;padding:12px 28px;border-radius:6px;border:none;cursor:pointer}
  details{margin-top:22px;text-align:left}
  summary{cursor:pointer;text-align:center;font-size:13px;color:#3a3a3a;text-decoration:underline}
  details form{margin-top:14px}
  label{display:block;font-size:13px;color:#3a3a3a;margin:0 0 6px}
  textarea{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:8px 10px;border:1px solid #c9d0d8;border-radius:6px;resize:vertical;margin-bottom:12px}
  .nee-btn{display:block;margin:0 auto;background:#fff;color:#3a3a3a;font-weight:600;font-size:13px;padding:10px 24px;
    border-radius:6px;border:1px solid #c9d0d8;cursor:pointer}
</style></head>
<body><div class="card">
  <div class="icon">${ok ? '✅' : '⚠️'}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  ${confirmForm || ''}
</div></body></html>`;
}

// De getekende sleutel van de link als verborgen velden (in elk formulier hetzelfde).
// `d` is hier al door controleerLink() tegen de vaste lijst doelgroepen gecontroleerd, dus
// veilig om letterlijk in te voegen; bij een oude link (zonder d) laten we het veld weg.
function sleutelVelden(ticketId, date, exp, sig, d) {
  return `<input type="hidden" name="ticketId" value="${ticketId}">
    <input type="hidden" name="date" value="${date}">
    <input type="hidden" name="exp" value="${exp}">
    ${d ? `<input type="hidden" name="d" value="${d}">` : ''}
    <input type="hidden" name="sig" value="${sig}">`;
}

function confirmFormHtml(ticketId, date, exp, sig, d) {
  return `<form method="POST" action="/api/confirm-afspraak">
    ${sleutelVelden(ticketId, date, exp, sig, d)}
    <button type="submit" class="confirm-btn">✅ Ja, ik bevestig deze afspraak</button>
  </form>`;
}

// "Deze datum lukt niet": een uitklapbaar formulier met een optionele opmerking (zonder JavaScript te bedienen).
function weigerFormHtml(ticketId, date, exp, sig, d, { open }) {
  return `<details id="datum-lukt-niet"${open ? ' open' : ''}>
    <summary>Deze datum lukt niet</summary>
    <form method="POST" action="/api/confirm-afspraak">
      ${sleutelVelden(ticketId, date, exp, sig, d)}
      <input type="hidden" name="actie" value="weiger">
      <label for="opmerking">Wanneer past het u beter?</label>
      <textarea name="opmerking" maxlength="${MAX_OPMERKING}" id="opmerking" rows="3" placeholder="Optioneel"></textarea>
      <button type="submit" class="nee-btn">Deze datum lukt niet</button>
    </form>
  </details>`;
}

async function addZohoComment(ticketId, accessToken, orgId, content) {
  // Interne notitie op het ticket (isPublic:false -- niet zichtbaar voor de klant, enkel intern).
  // Pad/body-formaat geverifieerd tegen Zoho Desk's officiële API-documentatie
  // (desk.zoho.com/DeskAPIDocument#TicketsComments#TicketsComments_Createticketcomment):
  // POST /tickets/{ticketId}/comments, headers Authorization + orgId (zelfde patroon als
  // overal elders in dit project), body { content, isPublic } (contentType optioneel,
  // default 'html' -- onze content is platte tekst zonder opmaak, dus dat is onschadelijk).
  // Bewust een eigen try/catch: de status-PATCH (het functioneel belangrijkste deel, en de
  // bron van waarheid voor "is de afspraak bevestigd") is op dit punt al gelukt. Een fout
  // HIER -- of dat nu een niet-ok response is, of de fetch zelf die throwt (netwerkblip, DNS,
  // timeout) -- mag de klant nooit een "Er ging iets mis"-pagina tonen voor iets dat in
  // werkelijkheid wel gelukt is. Deze functie mag dus nooit méér doen dan loggen.
  try {
    const res = await zoho.verzoek(`/tickets/${ticketId}/comments`, {
      token: accessToken, orgId, methode: 'POST', json: { content, isPublic: false },
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('Zoho ticket-comment mislukt:', res.status, errBody);
    }
  } catch (e) {
    console.error('Zoho ticket-comment mislukt (exception):', e);
  }
}

function clientIp(req) {
  // Netlify Functions zetten het echte client-IP in deze header (niet 'x-forwarded-for', dat
  // kan door de klant zelf vervalst worden op sommige platformen) -- dit moet na een echte
  // deploy nogmaals bevestigd worden tegen Netlify's actuele documentatie vóór het als
  // bewijswaardig wordt beschouwd (zie taakrapport). Lokaal via `node dev-server.mjs` zal deze
  // header ontbreken/leeg zijn -- dat is verwacht, geen bug, zie Step 5 van het plan.
  return req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'onbekend';
}

export default async (req) => {
  const headers = { ...corsHeaders(req), 'Content-Type': 'text/html; charset=utf-8' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  let ticketId, date, exp, sig, d, actie = '', opmerking = '';
  if (req.method === 'POST') {
    // req.formData() kan throwen op een misvormde/corrupte body (verkeerde Content-Type,
    // afgebroken multipart-boundary, ...). Dit is een publiek, ongeauthenticeerd endpoint dat
    // ook door bots/scanners met willekeurige request-bodies bereikt kan worden -- niet enkel
    // door de echte knop -- dus dit moet even netjes afgehandeld worden als een ongeldige
    // signature, niet als een onafgehandelde exception die Netlify's generieke platform-
    // foutpagina toont.
    try {
      const form = await req.formData();
      ticketId = form.get('ticketId') || '';
      date = form.get('date') || '';
      exp = form.get('exp') || '';
      d = form.get('d') || '';
      sig = form.get('sig') || '';
      const act = form.get('actie');
      actie = typeof act === 'string' ? act : '';
      const opm = form.get('opmerking');
      opmerking = typeof opm === 'string' ? opm.trim().slice(0, MAX_OPMERKING) : '';
    } catch (e) {
      console.error('confirm-afspraak: ongeldige POST-body:', e);
      return new Response(htmlPage({
        title: 'Link ongeldig of verlopen',
        message: 'Deze bevestigingslink is niet (meer) geldig. Neem contact op met Blitz Power als u de afspraak alsnog wil bevestigen.',
        ok: false,
      }), { status: 400, headers });
    }
  } else {
    const url = new URL(req.url);
    ticketId = url.searchParams.get('ticketId') || '';
    date = url.searchParams.get('date') || '';
    exp = url.searchParams.get('exp') || '';
    d = url.searchParams.get('d') || '';
    sig = url.searchParams.get('sig') || '';
    // Niet ondertekend en enkel voor de weergave: `keuze=nee` klapt "Deze datum lukt niet" open.
    actie = url.searchParams.get('keuze') === 'nee' ? 'nee' : '';
  }

  const { geldig: linkGeldig, doelgroep } = controleerLink({ ticketId, date, exp, d, sig });
  if (!linkGeldig) {
    return new Response(htmlPage({
      title: 'Link ongeldig of verlopen',
      message: 'Deze bevestigingslink is niet (meer) geldig. Neem contact op met Blitz Power als u de afspraak alsnog wil bevestigen.',
      ok: false,
    }), { status: 400, headers });
  }

  if (req.method === 'GET') {
    // Enkel de bevestigingspagina tonen -- GEEN side-effects, veilig voor e-mail-scanners.
    const nee = actie === 'nee';
    const bevestig = confirmFormHtml(ticketId, date, exp, sig, d);
    const weiger = weigerFormHtml(ticketId, date, exp, sig, d, { open: nee });
    return new Response(htmlPage({
      title: nee ? 'Deze datum lukt niet?' : 'Afspraak bevestigen',
      message: nee
        ? 'Laat ons hieronder weten wanneer het u beter past. Lukt de datum toch, dan kan u de afspraak ook bevestigen.'
        : 'Klik hieronder om deze afspraak te bevestigen.',
      ok: true,
      confirmForm: nee ? weiger + bevestig : bevestig + weiger,
    }), { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers });
  }

  // "Deze datum lukt niet": eigen afhandeling (onderaan dit bestand).
  if (actie === 'weiger') return weigerAfspraak({ req, headers, ticketId, date, doelgroep, opmerking });

  // Vanaf hier: enkel bereikbaar via de POST die de "Ja, ik bevestig"-knop verstuurt.
  try {
    const { token: accessToken, orgId } = await zoho.haalToegang();

    // Fix 4, deel B (finale review): status van het ticket controleren vóór de PATCH. Een
    // ondertekende link blijft 14 dagen geldig, ongeacht wat er intussen met het ticket gebeurd
    // is -- een klant kan een oude mail terugvinden en een voorstel bevestigen dat al bevestigd
    // is, of dat intussen verplaatst/geannuleerd/anders afgehandeld werd. Enkel de PATCH
    // uitvoeren als de status nog exact 'Wachten op bevestiging planning' is.
    // Als de status-check zelf faalt (netwerk/Zoho-uitval): NIET blokkeren op deze extra
    // afhankelijkheid -- terugvallen op het oude gedrag (gewoon de PATCH proberen), zodat een
    // tijdelijke Zoho-hik een verder legitieme bevestiging niet in de weg staat.
    let currentStatus = null;
    let ticketData = null;
    let statusCheckFailed = false;
    try {
      const statusRes = await zoho.verzoek(`/tickets/${ticketId}`, { token: accessToken, orgId });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        ticketData = statusData;
        currentStatus = statusData.status || null;
      } else {
        statusCheckFailed = true;
      }
    } catch (e) {
      console.error('Ticket-status ophalen mislukt (confirm-afspraak):', e);
      statusCheckFailed = true;
    }

    // Ook de datum moet nog kloppen: is het voorstel intussen verplaatst, dan is een oude link
    // (nog geldig tot 14 dagen) niet meer van toepassing. cf_interventie_datm staat in UTC, dus
    // vergelijken we de Brusselse kalenderdatum.
    const datumKlopt = statusCheckFailed
      || datumInBrussel(ticketData?.cf?.cf_interventie_datm) === date;

    if (!statusCheckFailed && (currentStatus !== 'Wachten op bevestiging planning' || !datumKlopt)) {
      // Verwacht, geldig scenario (dubbele klik, verouderde link, ticket al elders afgehandeld)
      // -- geen system failure, dus geen 500 en geen "Er ging iets mis"-pagina.
      return new Response(htmlPage({
        title: 'Afspraak niet meer actueel',
        message: 'Deze afspraak is al bevestigd of niet meer actueel. Neem contact op met Blitz Power als u vragen heeft.',
        ok: false,
      }), { status: 409, headers });
    }

    const patchRes = await zoho.verzoek(`/tickets/${ticketId}`, {
      token: accessToken, orgId, methode: 'PATCH', json: { status: 'Geplande support' },
    });
    if (!patchRes.ok) {
      const errBody = await patchRes.text().catch(() => '');
      console.error('Zoho PATCH mislukt (confirm-afspraak):', patchRes.status, errBody);
      return new Response(htmlPage({
        title: 'Er ging iets mis',
        message: 'De afspraak kon niet bevestigd worden. Neem contact op met Blitz Power.',
        ok: false,
      }), { status: 502, headers });
    }

    // De status staat nu anders in Zoho: de ticket-momentopname is verouderd (enkel na een geslaagde, door de link bewezen wijziging;
    // deze publieke functie kan het dus nooit door een ongeldige aanroep afdwingen). Gooit nooit.
    await markeerVerouderd({ haalStore: standaardStore });

    const ip = clientIp(req);
    const timestamp = new Date().toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' });
    const email = emailVan(doelgroep, ticketData);
    await addZohoComment(ticketId, accessToken, orgId,
      bevestigingsNotitie({ date, doelgroep, email: email || '', tijdstip: timestamp, ip }));

    // Registreren wie bevestigd heeft (voor de planner). Vaste store: de externe link draagt
    // nooit de testheader. Mag de klant nooit een foutpagina opleveren -- enkel loggen.
    try {
      const store = await standaardStore();
      await markeerBevestigd(store, ticketId, { door: doelgroep, tijdstip: new Date().toISOString() });
    } catch (e) {
      console.error('confirm-afspraak: register bijwerken mislukt:', e);
    }
  } catch (e) {
    console.error('confirm-afspraak fout:', e);
    return new Response(htmlPage({
      title: 'Er ging iets mis',
      message: 'De afspraak kon niet bevestigd worden. Neem contact op met Blitz Power.',
      ok: false,
    }), { status: 500, headers });
  }

  return new Response(htmlPage({
    title: 'Afspraak bevestigd',
    message: 'Bedankt! Uw afspraak is bevestigd. We zien u graag op de voorgestelde datum.',
    ok: true,
  }), { status: 200, headers });
};

// Het e-mailadres van de ontvanger die de link kreeg (voor de interne notities); null bij een oude link.
function emailVan(doelgroep, ticketData) {
  const cf = ticketData?.cf || {};
  return doelgroep === 'klant' ? cf.cf_e_mail_eindklant
    : doelgroep === 'installateur' ? cf.cf_e_mail_installateur
    : doelgroep === 'contact' ? (ticketData?.contact?.email || ticketData?.contact?.emailId || ticketData?.email)
    : null;
}

const WEIGER_FOUTTEKST = 'Uw melding kon niet verwerkt worden. Antwoord op de e-mail of neem contact op met Blitz Power.';

// POST met actie=weiger: de klant meldt dat de voorgestelde datum niet lukt. Zelfde controles als bevestigen (status
// 'Wachten op bevestiging planning' en dezelfde datum, anders 409), maar met één verschil: lukt de statuscontrole zelf niet, dan
// gebeurt er NIETS (een weigering wordt nooit blind uitgevoerd: ze zet het ticket terug en wist de datum). Volgorde: PATCH (status
// terug, datum gewist), momentopname verouderd, interne notitie, register (afgewezen) en activiteitenlog. Notitie, register en log
// zijn best-effort: de PATCH is de bron van waarheid, een fout daarna mag de klant geen foutpagina opleveren.
async function weigerAfspraak({ req, headers, ticketId, date, doelgroep, opmerking }) {
  const pagina = (status, title, message, ok) => new Response(htmlPage({ title, message, ok }), { status, headers });
  const foutPagina = (status) => pagina(status, 'Er ging iets mis', WEIGER_FOUTTEKST, false);
  try {
    const { token: accessToken, orgId } = await zoho.haalToegang();

    let ticketData;
    try {
      const statusRes = await zoho.verzoek(`/tickets/${ticketId}`, { token: accessToken, orgId });
      if (!statusRes.ok) {
        console.error('Ticket-status ophalen mislukt (confirm-afspraak, weigeren):', statusRes.status);
        return foutPagina(502);
      }
      ticketData = await statusRes.json();
    } catch (e) {
      console.error('Ticket-status ophalen mislukt (confirm-afspraak, weigeren):', e);
      return foutPagina(502);
    }

    if (ticketData?.status !== 'Wachten op bevestiging planning' || datumInBrussel(ticketData?.cf?.cf_interventie_datm) !== date) {
      return pagina(409, 'Afspraak niet meer actueel',
        'Deze afspraak is al bevestigd of niet meer actueel. Neem contact op met Blitz Power als u vragen heeft.', false);
    }

    const patchRes = await zoho.verzoek(`/tickets/${ticketId}`, {
      token: accessToken, orgId, methode: 'PATCH', json: { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } },
    });
    if (!patchRes.ok) {
      const errBody = await patchRes.text().catch(() => '');
      console.error('Zoho PATCH mislukt (confirm-afspraak, weigeren):', patchRes.status, errBody);
      return foutPagina(502);
    }

    await markeerVerouderd({ haalStore: standaardStore });

    const timestamp = new Date().toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' });
    await addZohoComment(ticketId, accessToken, orgId, afwijzingsNotitie({
      date, doelgroep, email: emailVan(doelgroep, ticketData) || '', opmerking, tijdstip: timestamp, ip: clientIp(req),
    }));

    let store = null;
    try {
      store = await standaardStore();
      await markeerAfgewezen(store, ticketId, { door: doelgroep, tijdstip: new Date().toISOString(), opmerking });
    } catch (e) {
      console.error('confirm-afspraak: register bijwerken mislukt:', e);
    }
    // De opmerking van de klant staat enkel in Zoho en het register, niet in het activiteitenlog. logActiviteit gooit nooit.
    if (store) {
      await logActiviteit(store, {
        gebruiker: { id: null, naam: `Klant (${doelgroep || 'onbekend'})` },
        actie: 'datum-lukt-niet', onderwerp: String(ticketId), details: date,
      });
    }
  } catch (e) {
    console.error('confirm-afspraak fout:', e);
    return foutPagina(500);
  }
  return pagina(200, 'Bedankt voor uw melding', 'Bedankt! We zoeken een andere datum en laten het u weten.', true);
}

export const config = { path: '/api/confirm-afspraak' };
