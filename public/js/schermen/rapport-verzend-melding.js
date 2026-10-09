// schermen/rapport-verzend-melding.js — de ene melding na het versturen van een rapport (B5/B6, kleine fouten).
// Pure functie, geen DOM: bouwt de toasttekst en de duur uit het resultaat van /api/send-rapport en de statusupdates.
// Vroeger overschreef elke volgende toast() de vorige, waardoor een mislukte statusupdate of een geweigerde ontvanger
// kon verdwijnen. Nu staat alles in één melding. De tekst wordt via textContent getoond: geen HTML-bewerking hier.
import { joinNL, DOELGROEP_LABEL } from './ticketdetail-logica.js';

const VOLGORDE = ['contact', 'klant', 'installateur'];
const rang = (d) => { const i = VOLGORDE.indexOf(d); return i === -1 ? VOLGORDE.length : i; };
const gesorteerd = (lijst, sleutel = (x) => x) => [...lijst].sort((a, b) => rang(sleutel(a)) - rang(sleutel(b)));
const labels = (lijst) => joinNL(lijst.map(d => DOELGROEP_LABEL[d] || d));

// verzonden = mail én status-write gelukt; nietOpgeslagen = mail weg, status-write mislukt;
// fouten = [{ doelgroep, fout }] van de server; statusFout = tekst of null (ticketstatus in Zoho niet gezet).
export function bouwVerzendMelding({ verzonden = [], nietOpgeslagen = [], fouten = [], statusFout = null } = {}) {
  const geslaagd = gesorteerd(verzonden);
  const nietOpgesl = gesorteerd(nietOpgeslagen);
  const mailWeg = gesorteerd([...verzonden, ...nietOpgeslagen]);
  const foutLijst = Array.isArray(fouten) ? gesorteerd(fouten, f => f.doelgroep) : [];

  if (mailWeg.length === 0) {
    if (foutLijst.length > 0) {
      const details = foutLijst.map(f => `${f.doelgroep}: ${f.fout}`).join('; ');
      return { tekst: `⚠ Rapport versturen geweigerd door Zoho (${details})`, duurMs: 6000 };
    }
    return { tekst: '⚠ Rapport kon niet verstuurd worden (geen adressen bekend)', duurMs: 4500 };
  }

  let tekst;
  if (nietOpgesl.length === 0) {
    tekst = `✓ Rapport verstuurd naar ${labels(geslaagd)}`;
  } else if (geslaagd.length === 0) {
    tekst = `✓ Rapport verstuurd naar ${labels(mailWeg)}, maar status kon niet opgeslagen worden — NIET opnieuw versturen, herlaad eerst de pagina`;
  } else {
    tekst = `✓ Rapport verstuurd naar ${labels(mailWeg)}, maar status kon niet opgeslagen worden voor ${labels(nietOpgesl)} — NIET opnieuw versturen, herlaad eerst de pagina`;
  }
  let duurMs = nietOpgesl.length > 0 ? 8000 : 3500;

  if (foutLijst.length > 0) {
    // Label + fout, zonder de sleutel te herhalen: "Niet verstuurd naar klant: Zoho 500; installateur: x".
    const details = foutLijst.map(f => `${DOELGROEP_LABEL[f.doelgroep] || f.doelgroep}: ${f.fout}`).join('; ');
    tekst += ` ⚠ Niet verstuurd naar ${details}`;
    duurMs = 8000;
  }
  if (statusFout) {
    tekst += ` ⚠ Ticketstatus in Zoho kon niet naar "Gesloten - ov" gezet worden: ${statusFout}`;
    duurMs = 8000;
  }
  // Een lange samengestelde melding blijft langer staan: 8 s tot 200 tekens, daarboven 25 ms extra per teken (max 15 s).
  if (duurMs === 8000 && tekst.length > 200) duurMs = Math.min(15000, 8000 + (tekst.length - 200) * 25);
  return { tekst, duurMs };
}
