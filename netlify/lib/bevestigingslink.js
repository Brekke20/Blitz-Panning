// Gedeelde bevestigingslink: propose.js tekent, confirm-afspraak.js controleert.
// Eén module zodat beide kanten gegarandeerd dezelfde string ondertekenen.
//
// Twee formaten:
//   nieuw: `${ticketId}.${date}.${exp}.${doelgroep}` -- de ontvanger (klant/installateur/contact)
//          zit in de handtekening, zodat niemand `d` kan aanpassen om als een andere ontvanger
//          te bevestigen.
//   oud:   `${ticketId}.${date}.${exp}` -- links uit al verstuurde mails (14 dagen geldig) blijven
//          werken; de ontvanger is dan onbekend (doelgroep null).

import crypto from 'node:crypto';

export const DOELGROEPEN = ['contact', 'klant', 'installateur'];

function geheim() {
  const secret = process.env.CONFIRM_LINK_SECRET;
  if (!secret) throw new Error('CONFIRM_LINK_SECRET niet geconfigureerd');
  return secret;
}

export function tekenLink(ticketId, date, exp, doelgroep) {
  const bericht = doelgroep
    ? `${ticketId}.${date}.${exp}.${doelgroep}`
    : `${ticketId}.${date}.${exp}`;
  return crypto.createHmac('sha256', geheim()).update(bericht).digest('hex');
}

export function maakBevestigingsUrl({ basis, ticketId, date, exp, doelgroep }) {
  const sig = tekenLink(ticketId, date, exp, doelgroep);
  return `${basis}/api/confirm-afspraak`
    + `?ticketId=${encodeURIComponent(ticketId)}&date=${encodeURIComponent(date)}`
    + `&exp=${exp}&d=${encodeURIComponent(doelgroep)}&sig=${sig}`;
}

export function controleerLink({ ticketId, date, exp, d, sig }) {
  const ongeldig = { geldig: false, doelgroep: null };
  if (!ticketId || !date || !exp || !sig) return ongeldig;
  // Dit endpoint is publiek: ticketId moet een zuiver numeriek Zoho-id zijn (sluit ook elke
  // dubbelzinnigheid in de delimiter-gescheiden handtekening uit).
  if (!/^\d+$/.test(String(ticketId))) return ongeldig;
  if (!Number.isFinite(Number(exp))) return ongeldig;
  if (Date.now() / 1000 > Number(exp)) return ongeldig; // verlopen
  let doelgroep = null;
  if (d) {
    if (!DOELGROEPEN.includes(d)) return ongeldig;
    doelgroep = d;
  }
  let verwacht;
  try {
    verwacht = tekenLink(ticketId, date, exp, doelgroep);
  } catch {
    return ongeldig;
  }
  // timingSafeEqual vereist gelijke lengte -- ongelijke lengte betekent sowieso ongeldig
  const a = Buffer.from(String(sig));
  const b = Buffer.from(verwacht);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return ongeldig;
  return { geldig: true, doelgroep };
}

// Kalenderdatum (YYYY-MM-DD) van een ISO-tijdstip in Brussel. cf_interventie_datm staat in UTC
// (bv. 22:30Z = 00:30 de volgende dag in Brussel), dus niet gewoon de eerste 10 tekens nemen.
export function datumInBrussel(iso) {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(t);
}

// Interne Zoho-notitie bij een bevestiging via de link.
export function bevestigingsNotitie({ date, doelgroep, email, tijdstip, ip }) {
  const wie = doelgroep
    ? `${doelgroep}${email ? ` (${email})` : ''}`
    : 'onbekende ontvanger (oude link)';
  return `Afspraak bevestigd voor ${date} door ${wie} via bevestigingslink op ${tijdstip} (Europe/Brussels). IP-adres: ${ip}.`;
}
