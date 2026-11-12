// De automatische herinnering 3 dagen vóór de interventie (geplande functie netlify/functions/herinnering-bevestiging.js, dagelijks).
//
// Een ticket op 'Wachten op bevestiging planning' dat 1 tot en met 3 KALENDERDAGEN (Brusselse tijd) van zijn afspraak verwijderd is en nog
// niet bevestigd, afgewezen of herinnerd is, krijgt één herinnering naar dezelfde ontvangers als het voorstel (zelfde ontdubbeling), met
// verse getekende links en dezelfde twee knoppen. Is er na het voorstel een inkomende klantmail (Zoho-thread `direction: 'in'`), dan gaat
// er GEEN herinnering uit: één interne notitie en een markering in het register, zodat de planner het zelf nakijkt en dit niet elke dag terugkomt.
//
// Volgorde per ticket: threads lezen -> sendReply per ontvanger -> register markeren -> PATCH de status terug (sendReply zet Zoho op
// 'Wachten op klant') -> ticket-momentopname verouderd -> interne notitie -> activiteitenlog. Een fout bij één ticket stopt de rest niet.
// Logregels bevatten nooit adressen of ticketinhoud, enkel aantallen en foutklassen. Dit bestand schrijft naar Zoho Desk: de markering van
// de momentopname (markeerVerouderd) staat hier, zie tests/tickets-markering.test.mjs.
import { datumInBrussel, maakBevestigingsUrl, tijdstipNuBrussel, DOELGROEPEN } from './bevestigingslink.js';
import { escHtml } from './annulatie.js';
import { mailKader } from './mailkader.js';
import { bevestigKnoppenHtml, KEUZE_TEKST, cleanTicketSubject } from './voorstelmail.js';
import { inkomendeMailsNa } from './mailcontrole.js';
import { leesRegister, markeerHerinnering } from './voorstelregister.js';
import { markeerVerouderd } from './tickets-snapshot.js';
import { logActiviteit } from './activiteit.js';
import { leesJsonVeilig } from './zoho.js';

export const MIN_DAGEN = 1; // een gemiste run wordt de dag erna ingehaald; ook een voorstel van minder dan 3 dagen vooraf krijgt nog één herinnering
export const MAX_DAGEN = 3;
const STATUS_WACHT = 'Wachten op bevestiging planning';
const LINK_GELDIG_S = 14 * 24 * 60 * 60; // zoals het voorstel: 14 dagen
const THREAD_PAGINA = 100;
const MAX_THREAD_PAGINAS = 5;
const MS_DAG = 24 * 60 * 60 * 1000;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- dagen en beoordeling (puur)

// Dagnummer (UTC-middernacht / 24 u) van een YYYY-MM-DD, of null als het geen echte datum is.
function dagNummer(datum) {
  if (typeof datum !== 'string' || !DATUM_RE.test(datum)) return null;
  const [j, m, d] = datum.split('-').map(Number);
  const t = Date.UTC(j, m - 1, d);
  const c = new Date(t);
  if (c.getUTCFullYear() !== j || c.getUTCMonth() !== m - 1 || c.getUTCDate() !== d) return null;
  return t / MS_DAG;
}

// Aantal kalenderdagen van vandaag (Brusselse tijd, op `nuMs`) tot `datum` (YYYY-MM-DD): 3 = overmorgen+1. Telt kalenderdagen, niet blokken
// van 24 uur, dus ook rond middernacht en de omschakeling naar zomer- en wintertijd (een dag van 23 of 25 uur) klopt het. null bij ongeldige invoer.
export function dagenTot(datum, nuMs) {
  if (!Number.isFinite(nuMs)) return null;
  const vandaag = dagNummer(datumInBrussel(new Date(nuMs).toISOString()));
  const doel = dagNummer(datum);
  return vandaag === null || doel === null ? null : Math.round(doel - vandaag);
}

// Het vroegste (geldige) tijdstip waarop het voorstel naar een ontvanger ging, in ms; null als het register er geen heeft.
export function verstuurdSinds(entry) {
  const tijden = DOELGROEPEN.map(d => Date.parse(entry?.[d])).filter(t => !Number.isNaN(t));
  return tijden.length ? Math.min(...tijden) : null;
}

// -> { besluit: 'overslaan', reden } of { besluit: 'controleer', datum, dagen, sindsMs }. Zonder netwerk.
// Redenen: buitenVenster (niet 1 tot en met 3 dagen of geen datum), bevestigd, afgewezen, herinnerd (voor déze datum; een nieuw voorstel voor
// een andere datum wist de oude markering en krijgt een eigen herinnering), geenVoorstel (het register kent geen verzonden voorstel: nooit
// een herinnering voor een voorstel dat we niet kennen), datumAnders (het voorstel gold voor een andere datum dan die van het ticket).
export function beoordeelTicket({ ticket, entry, nuMs }) {
  const datum = datumInBrussel(ticket?.interventieDatum);
  const dagen = dagenTot(datum, nuMs);
  if (dagen === null || dagen < MIN_DAGEN || dagen > MAX_DAGEN) return { besluit: 'overslaan', reden: 'buitenVenster' };
  if (entry?.bevestigd) return { besluit: 'overslaan', reden: 'bevestigd' };
  if (entry?.afgewezen) return { besluit: 'overslaan', reden: 'afgewezen' };
  if (entry?.herinnering?.datum === datum) return { besluit: 'overslaan', reden: 'herinnerd' };
  const sindsMs = verstuurdSinds(entry);
  if (sindsMs === null) return { besluit: 'overslaan', reden: 'geenVoorstel' };
  if (entry.tijdslotDatum && entry.tijdslotDatum !== datum) return { besluit: 'overslaan', reden: 'datumAnders' };
  return { besluit: 'controleer', datum, dagen, sindsMs };
}

// ---------------------------------------------------------------- teksten

const uurInBrussel = (iso) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false }).format(t).replace(/^24:/, '00:');
};

function kortDatum(datum, tijdslot, uur) {
  const [j, m, d] = String(datum ?? '').split('-');
  let s = j && m && d ? `${d}/${m}/${j}` : 'onbekende datum';
  if (tijdslot) s += ` ${tijdslot}`; else if (uur) s += ` ${uur}`;
  return s;
}

// De herinneringsmail (zelfde huisstijl en zelfde knoppen als het voorstel). `confirmUrl` null = geen bevestigingslink (bv. geen
// CONFIRM_LINK_SECRET): dan geen knoppen maar de vraag om te antwoorden.
export function bouwHerinneringMail({ naam, onderwerp, datum, tijdslot, uur, serienummer, confirmUrl }) {
  const dag = new Date(`${datum}T12:00:00Z`).toLocaleDateString('nl-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels',
  });
  const tijd = tijdslot
    ? `tussen <strong>${escHtml(tijdslot)}</strong> uur`
    : (uur ? `om <strong>${escHtml(uur)}</strong> uur` : '');
  const serial = serienummer
    ? `<div style="font-size:12px;color:#8a9aaa;margin-top:10px;border-top:1px solid #e8e8e8;padding-top:10px">Serienummer: ${escHtml(serienummer)}</div>`
    : '';
  const keuzeTekst = confirmUrl
    ? KEUZE_TEKST
    : 'Gelieve deze afspraak te bevestigen door op deze e-mail te antwoorden. Komt het voorgestelde tijdstip u niet uit? Laat het ons dan ook weten, zodat we samen een alternatief zoeken.';
  return mailKader(`    <p style="margin:0 0 16px;font-size:15px;color:#181e24">Geachte ${escHtml(naam) || 'klant'},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#3a3a3a;line-height:1.65">
      Een herinnering: wij plannen een servicebezoek voor <strong style="color:#181e24">${escHtml(cleanTicketSubject(onderwerp))}</strong>.
      We hebben nog geen bevestiging van u ontvangen.
    </p>

    <!-- Afspraakbox -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
    <tr><td style="background:#f7f7f7;border-left:4px solid #00dfa3;border-radius:0 4px 4px 0;padding:18px 22px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#8a9aaa;margin-bottom:8px">Voorgestelde afspraak</div>
      <div style="font-size:22px;font-weight:700;color:#181e24;margin-bottom:4px">${escHtml(dag)}</div>
      ${tijd ? `<div style="font-size:16px;color:#3a3a3a">${tijd}</div>` : ''}
      ${serial}
    </td></tr>
    </table>

    ${bevestigKnoppenHtml(confirmUrl)}

    <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.65">
      ${keuzeTekst}
    </p>
    <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">
      Met vriendelijke groeten,<br>
      <strong style="color:#181e24">Team Blitz Power &mdash; Service &amp; Support</strong>
    </p>`);
}

// Interne notitie na een verstuurde herinnering. `gemaild`: adressen die de mail kregen; `fouten`: [{ doelgroep, fout }] van wie niet bereikt is;
// `statusFout`: de PATCH die de status terugzet mislukte (Zoho kan dan op 'Wachten op klant' staan).
export function bouwHerinneringNotitie({ datum, tijdslot, uur, gemaild, fouten, statusFout }) {
  let s = `Automatische herinnering verstuurd naar ${(gemaild || []).join(', ')} voor de afspraak van ${kortDatum(datum, tijdslot, uur)}. De klant heeft nog niet bevestigd.`;
  if (fouten?.length) s += ` Niet verstuurd naar ${fouten.map(f => `${f.doelgroep}: ${f.fout}`).join('; ')}.`;
  if (statusFout) s += ' Let op: de status kon niet teruggezet worden op "Wachten op bevestiging planning" (Zoho staat mogelijk op "Wachten op klant"): zet hem zelf recht.';
  return escHtml(s);
}

// Interne notitie als de herinnering wordt overgeslagen omdat de klant al per mail antwoordde.
export function bouwOvergeslagenNotitie({ tijdstip, van }) {
  const wie = (van || []).filter(Boolean);
  return escHtml(`Geen herinnering: de klant antwoordde per mail op ${tijdstip}${wie.length ? ` (${[...new Set(wie)].join(', ')})` : ''}, controleer en registreer de bevestiging (knop "Bevestigd per mail") of antwoord de klant.`);
}

// ---------------------------------------------------------------- uitvoering

// De ontvangers zoals het voorstel ze bepaalde: contactpersoon, eindklant, installateur, enkel de doelgroepen die het voorstel effectief kregen
// (een tijdstip in het register: de planner kan een doelgroep uitvinken); hetzelfde adres (hoofdletterongevoelig) maar één keer. Eerst filteren,
// dan ontdubbelen, zodat een niet-gemaild contact met hetzelfde adres als de klant de klantmail niet opslokt.
function ontvangersVan(ticket, entry) {
  const gezien = new Set();
  return [
    { doelgroep: 'contact', email: ticket.email },
    { doelgroep: 'klant', email: ticket.emailEindklant },
    { doelgroep: 'installateur', email: ticket.emailInstallateur },
  ].filter(o => {
    const sleutel = String(o.email || '').toLowerCase();
    if (!sleutel || !Number.isFinite(Date.parse(entry?.[o.doelgroep])) || gezien.has(sleutel)) return false;
    gezien.add(sleutel);
    return true;
  });
}

// Leest de threads (met paginering) en geeft de inkomende klantmails na `sindsMs`. Gooit als niet te controleren is (Zoho-fout of te veel
// threads): dan gaat er nooit een herinnering uit.
async function inkomendeNaVoorstel({ zoho, toegang, ticketId, sindsMs }) {
  const threads = [];
  for (let pagina = 0; pagina < MAX_THREAD_PAGINAS; pagina++) {
    const from = 1 + pagina * THREAD_PAGINA;
    const res = await zoho.verzoek(`/tickets/${ticketId}/threads?from=${from}&limit=${THREAD_PAGINA}`, toegang);
    if (!res.ok) throw new Error(`threads ophalen mislukt (${res.status})`);
    const data = await leesJsonVeilig(res);
    const blok = Array.isArray(data?.data) ? data.data : [];
    threads.push(...blok);
    const inkomend = inkomendeMailsNa(threads, sindsMs);
    if (inkomend.length) return inkomend;
    if (blok.length < THREAD_PAGINA) return [];
  }
  throw new Error('te veel threads om te controleren');
}

async function zetNotitie(zoho, toegang, ticketId, content, log) {
  // Best-effort: de herinnering zelf is op dit punt al gelukt; enkel de foutklasse loggen.
  try {
    const res = await zoho.verzoek(`/tickets/${ticketId}/comments`, { ...toegang, methode: 'POST', json: { content, isPublic: false } });
    if (!res.ok) log(`[herinnering-bevestiging] notitie mislukt (HTTP ${res.status})`);
  } catch (e) {
    log(`[herinnering-bevestiging] notitie mislukt (${e?.name || 'Error'})`);
  }
}

// Verwerkt één ticket dat in aanmerking komt. Telt in `samenvatting`; gooit enkel voor fouten waarbij niets verstuurd is.
async function herinner({ ticket, beoordeling, entry, zoho, toegang, store, nu, env, fromAdres, samenvatting, log }) {
  const ticketId = String(ticket.id);
  const { datum, sindsMs } = beoordeling;

  // 1. Antwoordde de klant al per mail? Dan geen herinnering, wel één notitie en een markering.
  const inkomend = await inkomendeNaVoorstel({ zoho, toegang, ticketId, sindsMs });
  if (inkomend.length) {
    await zetNotitie(zoho, toegang, ticketId, bouwOvergeslagenNotitie({
      tijdstip: tijdstipNuBrussel(new Date(inkomend[0].tijdstip)), van: inkomend.map(m => m.van),
    }), log);
    await markeerHerinnering(store, ticketId, { datum, tijdstip: new Date(nu()).toISOString(), overgeslagen: 'mailantwoord' });
    samenvatting.overgeslagen++;
    return;
  }

  const ontvangers = ontvangersVan(ticket, entry);
  if (!ontvangers.length) { samenvatting.overgeslagen++; return; }
  const afzender = await fromAdres();

  // 2. Per ontvanger een mail (eerst alle mails: sendReply zet de status op 'Wachten op klant').
  const exp = Math.floor(nu() / 1000) + LINK_GELDIG_S;
  const tijdslot = entry.tijdslotDatum === datum && entry.tijdslot ? entry.tijdslot : null;
  const uur = tijdslot ? null : uurInBrussel(ticket.interventieDatum);
  const naam = ticket.naamEindklant || ticket.contact || '';
  const gemaild = [];
  const fouten = [];
  for (const { doelgroep, email } of ontvangers) {
    try {
      let confirmUrl = null;
      try {
        confirmUrl = maakBevestigingsUrl({ basis: env.URL || 'http://localhost:8888', ticketId, date: datum, exp, doelgroep });
      } catch (e) {
        log('[herinnering-bevestiging] bevestigingslink niet gemaakt');
      }
      const html = bouwHerinneringMail({ naam, onderwerp: ticket.subject, datum, tijdslot, uur, serienummer: ticket.serienummer, confirmUrl });
      const res = await zoho.verzoek(`/tickets/${ticketId}/sendReply`, {
        ...toegang, methode: 'POST',
        json: { channel: 'EMAIL', contentType: 'html', content: html, fromEmailAddress: afzender, to: email },
      });
      const data = await leesJsonVeilig(res);
      if (res.ok) gemaild.push(email);
      else if (!JSON.stringify(data).includes('Empty Recipients')) fouten.push({ doelgroep, fout: `Zoho sendReply fout (${res.status})` });
    } catch (e) {
      fouten.push({ doelgroep, fout: e?.message || e?.name || 'Error' });
    }
  }
  if (!gemaild.length) {
    // Niets verstuurd: niets markeren of terugzetten, morgen opnieuw (enkel bij een echte fout; "Empty Recipients" is stil).
    if (fouten.length) { samenvatting.fouten++; log(`[herinnering-bevestiging] geen enkele mail verstuurd (${fouten.length} fout(en))`); }
    else samenvatting.overgeslagen++;
    return;
  }
  samenvatting.verstuurd++;

  // 3. Markeren VOOR de PATCH: de mails zijn weg, dus een mislukte PATCH of notitie mag nooit een tweede herinnering geven.
  try {
    await markeerHerinnering(store, ticketId, { datum, tijdstip: new Date(nu()).toISOString() });
  } catch (e) {
    samenvatting.fouten++;
    log(`[herinnering-bevestiging] register bijwerken mislukt (${e?.name || 'Error'}): morgen kan dit ticket een tweede herinnering krijgen`);
  }

  // 4. De status terugzetten: sendReply zette Zoho op 'Wachten op klant'.
  let statusFout = false;
  try {
    const res = await zoho.verzoek(`/tickets/${ticketId}`, { ...toegang, methode: 'PATCH', json: { status: STATUS_WACHT } });
    if (!res.ok) { statusFout = true; log(`[herinnering-bevestiging] status terugzetten mislukt (HTTP ${res.status})`); }
  } catch (e) {
    statusFout = true;
    log(`[herinnering-bevestiging] status terugzetten mislukt (${e?.name || 'Error'})`);
  }
  if (statusFout) samenvatting.fouten++;
  // Zoho is gewijzigd (de mails zetten de status om, ook als de PATCH mislukte): de ticket-momentopname is verouderd. Gooit nooit.
  await markeerVerouderd({ store, nu });

  await zetNotitie(zoho, toegang, ticketId, bouwHerinneringNotitie({ datum, tijdslot, uur, gemaild, fouten, statusFout }), log);
  await logActiviteit(store, {
    gebruiker: { id: null, naam: 'Automatische herinnering' }, actie: 'herinnering-verstuurd', onderwerp: ticketId, details: datum,
  }, { nu });
}

// Verwerkt alle tickets op 'Wachten op bevestiging planning'. `haalTickets()` geeft { pendingTickets } (de gemapte tickets van
// tickets-ophalen.js); `haalStore()` de blob-store `blitz-data`. -> { gecontroleerd, verstuurd, overgeslagen, fouten, uitgesteld }.
// Gooit enkel als de ticketlijst of het register niet gelezen kan worden (dan is er niets verstuurd). `tijdBudgetMs`: na zoveel ms begint
// er geen nieuw ticket meer (de functie heeft een harde time-out); wat overblijft komt de volgende dag aan bod (`uitgesteld`).
export async function verwerkHerinneringen({ zoho, haalStore, haalTickets, nu = () => Date.now(), env = process.env, tijdBudgetMs = 18000, log = console.error }) {
  const start = nu();
  const samenvatting = { gecontroleerd: 0, verstuurd: 0, overgeslagen: 0, fouten: 0, uitgesteld: 0 };
  const { pendingTickets } = await haalTickets();
  // `pendingTickets` bevat enkel tickets op 'Wachten op bevestiging planning' (tickets-ophalen.js STATUS_PENDING).
  const tickets = (Array.isArray(pendingTickets) ? pendingTickets : []).filter(t => t && typeof t === 'object');
  samenvatting.gecontroleerd = tickets.length;
  const store = await haalStore();
  const register = await leesRegister(store, { gooiFout: true });

  let toegang = null;
  let afzender = null;
  const fromAdres = async () => {
    if (afzender) return afzender;
    afzender = env.ZOHO_FROM_EMAIL || null;
    if (!afzender) {
      const res = await zoho.verzoek('/emailAddresses?limit=50', toegang);
      const data = await leesJsonVeilig(res);
      afzender = (data?.data || []).find(a => a.emailAddress && a.emailAddress.includes('@'))?.emailAddress || null;
      if (!afzender) throw new Error('geen from-emailadres gevonden in Zoho (stel ZOHO_FROM_EMAIL in)');
    }
    return afzender;
  };

  for (const ticket of tickets) {
    try {
      const entry = register.status[ticket.id];
      const beoordeling = beoordeelTicket({ ticket, entry, nuMs: nu() });
      if (beoordeling.besluit === 'overslaan') { samenvatting.overgeslagen++; continue; }
      if (nu() - start >= tijdBudgetMs) { samenvatting.uitgesteld++; continue; }
      if (!toegang) {
        const { token, orgId } = await zoho.haalToegang();
        toegang = { token, orgId };
      }
      await herinner({ ticket, beoordeling, entry, zoho, toegang, store, nu, env, fromAdres, samenvatting, log });
    } catch (e) {
      samenvatting.fouten++;
      log(`[herinnering-bevestiging] ticket mislukt (${e?.name || 'Error'})`);
    }
  }
  return samenvatting;
}
