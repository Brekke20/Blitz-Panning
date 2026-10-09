// schermen/rapport-verzenden.js — rapport versturen vanuit het Rapporten-tabblad en de oplossing naar Zoho (etappe 5b).
// W11: dit pad verstuurt het servicerapport naar klanten (POST /api/send-rapport, per ontvanger POST /api/rapport-verzonden)
// en schrijft de Zoho-oplossing (POST /api/comment). De code is LETTERLIJK uit index.html verhuisd (D12): enkel de
// voorvoegsels zijn nieuw (`export`, `afh.` voor het archief en imports). HUIDIG GEDRAG blijft bewust bestaan en is vastgelegd in
// e2e/productie/rapport.spec.mjs: de verzendknop blijft uitgeschakeld na een 502/onleesbaar antwoord (tot de mailcontrole klaar is),
// /api/comment gaat vóór het rapport-archief de deur uit en elk antwoord zonder `error` telt als gelukt. Sinds de kleine fouten
// (B5, B6): na een leesbare 400/500 { error } is de knop weer bruikbaar en staat alles in één melding (rapport-verzend-melding.js).
// `sendBtn.onclick =` blijft een toewijzing (geen addEventListener): elke nieuwe preview vervangt zo de vorige handler; een
// luisteraar zou zich bij elke preview opstapelen en het rapport meermaals versturen.
// Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe. De sluitknoppen lopen via
// data-actie-delegatie; het venster sluit via registreerBackdrop (inhoudsklik sluit niet).
import { foutTekst, leesFout } from '../kern/api.js';
import { controleerMail, mailControleTekst, mailControleAfsluiting, uurBrussel, TEKST_CONTROLEREN } from '../kern/mailcontrole.js';
import { appConfirm } from '../app-dialog.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { toast, escHtml, registreerActies, registreerBackdrop, strengeAfh } from '../kern/ui.js';
import { registreerVenster } from '../venster.js';
import { bouwVerzendMelding } from './rapport-verzend-melding.js';
import { DOELGROEP_LABEL } from './ticketdetail-logica.js';
import { haalRapportHtml } from '../rapport-inhoud.js';

// Afhankelijkheden uit rapport-archief.js (ingevuld door initRapportVerzenden): het archief (live gelezen), de archiefversie
// en het hertekenen. Een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('rapport-verzenden: initRapportVerzenden() is niet aangeroepen'); } });

export function initRapportVerzenden(afhankelijkheden) {
  afh = strengeAfh('rapport-verzenden', afhankelijkheden);
  registreerActies(document.body, {
    'rapport-preview-sluit': () => closeRapportPreview(),
  });
  const overlay = document.getElementById('rapport-preview-overlay');
  registreerBackdrop(overlay, closeRapportPreview);
  registreerVenster({ el: overlay, sluit: () => closeRapportPreview() });
}

// ══════════════════════════════════════════════
// OPLOSSING
// ══════════════════════════════════════════════
// Post-launch feedback (2026-08-17): geen apart "Oplossing invoeren"-knopje/venster meer -- de
// uitgevoerde acties worden toch al in het service rapport genoteerd (R.acties), dus die tekst
// wordt bij het versturen van een rapport automatisch als oplossing op het Zoho-ticket gezet.
// Aangeroepen vanuit printRapport() (rapport-wizard.js) via een import (voorheen window.syncOplossingNaarZoho?.()) — enkel
// als het rapport aan een echt Zoho-ticket hangt (niet isLocal) en er effectief tekst is ingevuld.
export async function syncOplossingNaarZoho(ticketId, content) {
  if (!ticketId || !content?.trim() || TEST_MODE) return;
  try {
    const res  = await fetch('/api/comment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId, content: content.trim() }),
    });
    const data = await res.json().catch(() => ({ error: 'HTTP ' + res.status })); // W5-fix: onleesbaar antwoord (bv. 502-HTML) wordt 'HTTP <status>'
    if (data.error) throw new Error(data.error);
  } catch (err) {
    toast('⚠ Oplossing kon niet automatisch bijgewerkt worden in Zoho: ' + foutTekst(err), 4500);
  }
}

// ══════════════════════════════════════════════
// RAPPORT ARCHIEF
// ══════════════════════════════════════════════

let _previewSeq = 0;

export async function voorbeeldRapport(rapportId, btn) {
  const r = afh.rapportArchief().find(x => x.id === rapportId);
  if (!r) return toast('⚠ Rapport niet gevonden');
  if (!r.ticketId) return toast('⚠ Geen ticket gekoppeld aan dit rapport');
  const html = await haalRapportHtml(r); // inline _html (oude entries) of apart opgehaald (v1.10.2)
  if (!html) return toast('⚠ Geen opgeslagen rapport-inhoud om te versturen');

  const mySeq = ++_previewSeq;

  if (TEST_MODE) return verstuurRapport(rapportId, btn);

  toast('🔎 Voorbeeld ophalen...', 8000);
  try {
    const res  = await fetch('/api/send-rapport', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId: r.ticketId, html, ticketNumber: r.ticketNumber, preview: true }),
    });
    const data = await res.json().catch(() => { throw new Error('HTTP ' + res.status); }); // W5-fix: onleesbaar antwoord (bv. 502-HTML) wordt 'HTTP <status>' (toast '✕ Voorbeeld ophalen mislukt: …')
    if (data.error) return toast('⚠ ' + data.error, 4500);
    if (!data.ontvangers?.length) return toast('⚠ Geen gekend e-mailadres (klant of installateur) op dit ticket', 4500);

    if (mySeq !== _previewSeq) return; // een nieuwere klik overschreef deze aanvraag al

    document.getElementById('rapport-preview-ticket-label').textContent =
      `Ticket #${r.ticketNumber || r.ticketId}`;
    document.getElementById('rapport-preview-body').innerHTML = data.ontvangers.map(o => `
      <div style="font-size:0.72rem;color:var(--muted);margin:10px 0 5px">
        Aan ${escHtml(DOELGROEP_LABEL[o.doelgroep] || o.doelgroep)} — ${escHtml(o.email)}
      </div>
      <iframe srcdoc="${escHtml(o.html)}" sandbox=""
        style="width:100%;height:260px;border:1px solid var(--border);border-radius:6px"></iframe>
    `).join('');

    const sendBtn = document.getElementById('rapport-preview-send-btn');
    sendBtn.disabled = false;
    sendBtn.onclick = () => {
      sendBtn.disabled = true;
      document.getElementById('rapport-preview-overlay').classList.remove('open');
      verstuurRapport(rapportId, btn, data.ontvangers);
    };
    document.getElementById('rapport-preview-overlay').classList.add('open');
  } catch (err) {
    toast('✕ Voorbeeld ophalen mislukt: ' + foutTekst(err), 5000);
  }
}

export function closeRapportPreview(e) {
  if (e && e.target !== document.getElementById('rapport-preview-overlay')) return;
  document.getElementById('rapport-preview-overlay').classList.remove('open');
}

// btn (optioneel): de aangeklikte knop, wordt uitgeschakeld tijdens het versturen tegen
// dubbelklikken. Terug inschakelen hoeft niet -- renderRapportArchief() bouwt alle knoppen
// opnieuw op met de juiste toestand.
// ontvangers (optioneel, enkel vanuit het voorbeeldvenster): [{ doelgroep, naam, email, html }] zoals de server ze bepaalde. Daarmee
// controleert de app na een onzeker resultaat per adres of de mail in Zoho staat en vinkt ze "verzonden" aan (B4). Zonder: enkel onthouden.
export async function verstuurRapport(rapportId, btn, ontvangers) {
  const r = afh.rapportArchief().find(x => x.id === rapportId);
  if (!r) return toast('⚠ Rapport niet gevonden');
  if (!r.ticketId) return toast('⚠ Geen ticket gekoppeld aan dit rapport');
  const html = await haalRapportHtml(r); // inline _html (oude entries) of apart opgehaald (v1.10.2)
  if (!html) return toast('⚠ Geen opgeslagen rapport-inhoud om te versturen');

  if (TEST_MODE) {
    if (btn) btn.disabled = true;
    await new Promise(res => setTimeout(res, 600));
    r.verzondenKlant = new Date().toISOString();
    afh.renderRapportArchief();
    return toast('🧪 Testmodus — rapport verstuurd (demo)', 3500);
  }

  // Q1 (etappe 7): is er na een onzeker resultaat al een mail van dit rapport gedetecteerd, dan eerst vragen (annuleren verstuurt niets).
  const gedetecteerd = leesMailGedetecteerd()[rapportId];
  if (btn) btn.disabled = true; // vóór de vraag: tijdens het wachten op het antwoord kan de rijknop niet nogmaals aangeklikt worden
  if (gedetecteerd) {
    const ok = await appConfirm({
      titel: 'Mail al gedetecteerd',
      tekst: `Er is om ${uurBrussel(gedetecteerd)} al een mail naar de klant gedetecteerd. Toch opnieuw versturen?`,
      bevestigLabel: 'Toch opnieuw versturen', annuleerLabel: 'Terug', gevaar: true,
    });
    if (!ok) {
      if (btn) btn.disabled = false; // Terug: de knop is weer bruikbaar
      return;
    }
    zetMailGedetecteerd(rapportId, null);
  }

  toast('📤 Rapport versturen...', 6000);
  const verzendStartWand = Date.now(); // I1: loopt door tijdens slaapstand, performance.now() niet
  const verzendStart = performance.now(); // Q1 (etappe 7): begin van de verzending, enkel gebruikt na een onzeker resultaat
  let onleesbaarOnzeker = false; // M3: onleesbaar antwoord waarvan niet te zeggen is of de mail vertrok
  let definitiefAntwoord = false; // B5: de server antwoordde leesbaar met { error } (niet 502/503/504): er is niets verstuurd
  try {
    const res  = await fetch('/api/send-rapport', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId: r.ticketId, html, ticketNumber: r.ticketNumber }),
    });
    let leesbaar = true;
    const data = await res.json().catch(() => { leesbaar = false; return { error: 'HTTP ' + res.status }; }); // W5-fix: onleesbaar antwoord (bv. 502-HTML) wordt 'HTTP <status>'
    if (data.error) {
      definitiefAntwoord = leesbaar && res.status >= 400 && !leesFout({ status: res.status }).onzeker;
      // Een onleesbaar antwoord op een 200 (afgekapt) of een 500 zegt niet of de mail vertrok: ook dan de mailcontrole (zoals bij een 502).
      onleesbaarOnzeker = !leesbaar && (res.status === 200 || res.status >= 500);
      throw new Error(data.error);
    }

    // verzondenOntvangers = mail verstuurd EN status-write geslaagd (alleen dit mag het
    // "✓ Verzonden"-badge voeden -- een badge mag enkel bevestigd-opgeslagen status tonen).
    // emailedMaarNietOpgeslagen = mail is écht buiten, maar de status-write faalde: de
    // gebruiker mag dan nooit een boodschap zien die suggereert dat er niets verstuurd is.
    const verzondenOntvangers        = [];
    const emailedMaarNietOpgeslagen  = [];
    for (const doelgroep of ['contact', 'klant', 'installateur']) {
      if (!data.emailSent?.[doelgroep]) continue;
      const tijdstip = new Date().toISOString();
      const st = await schrijfRapportStatus({ rapportId, doelgroep, tijdstip, versie: afh.archiefVersie() });
      if (!st.ok) {
        console.warn(`Rapport-verzonden opslaan voor ${doelgroep} mislukt:`, st.fout);
        emailedMaarNietOpgeslagen.push(doelgroep);
        continue;
      }
      if (typeof st.versie === 'number') afh.zetArchiefVersie(st.versie);
      const veld = doelgroep === 'contact' ? 'verzondenContact' : doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
      r[veld] = tijdstip;
      verzondenOntvangers.push(doelgroep);
    }

    afh.renderRapportArchief();
    // B6: één melding met het succes, de niet-opgeslagen statussen, de geweigerde ontvangers en de statusFout (toast() overschrijft de vorige).
    const m = bouwVerzendMelding({ verzonden: verzondenOntvangers, nietOpgeslagen: emailedMaarNietOpgeslagen, fouten: data.fouten, statusFout: data.statusFout });
    toast(m.tekst, m.duurMs);
  } catch (err) {
    if (leesFout(err).onzeker || onleesbaarOnzeker) {
      toast('✕ ' + foutTekst(err), 5000);
      await naOnzekerRapport(rapportId, r.ticketId, verzendStart, verzendStartWand, btn, ontvangers);
    }
    // B5: een leesbaar { error }-antwoord (400/500) bewijst dat er niets verstuurd is: send-rapport.js antwoordt enkel vóór de
    // verzendlus met een fout (fouten per ontvanger komen terug in een 200). De knop is dan weer bruikbaar. Bij een onzeker
    // resultaat beslist de mailcontrole (naOnzekerRapport) of de knop opengaat; elke andere fout laat de knop op slot.
    else if (definitiefAntwoord) {
      toast('✕ ' + foutTekst(err), 5000);
      if (btn) btn.disabled = false;
    } else {
      // Op slot en niet te bewijzen dat er niets verstuurd is (bv. onleesbaar 4xx-antwoord of een fout ná het verzenden): zeg wat te doen.
      toast('✕ ' + foutTekst(err) + ' — kijk in Zoho na of de mail vertrokken is, of herlaad de pagina en probeer opnieuw', 8000);
    }
  }
}

// De status-write per doelgroep (POST /api/rapport-verzonden). Gooit nooit. `versie` weglaten = geen versiecontrole (enkel het item op id).
async function schrijfRapportStatus({ rapportId, doelgroep, tijdstip, versie }) {
  try {
    const res = await fetch('/api/rapport-verzonden', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: rapportId, doelgroep, tijdstip, versie }), // versie: undefined valt weg in JSON
    });
    const d = await res.json();
    if (d?.error) return { ok: false, fout: d.error };
    return { ok: true, versie: d?.versie };
  } catch (e) {
    return { ok: false, fout: e.message };
  }
}

// Q1 (etappe 7): { [rapportId]: ISO-tijdstip } van de mail die na een onzeker resultaat al gedetecteerd werd, enkel op dit toestel.
const MAIL_GEDETECTEERD_KEY = 'blitz_mail_gedetecteerd';
function leesMailGedetecteerd() {
  try {
    const o = JSON.parse(localStorage.getItem(MAIL_GEDETECTEERD_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}
function zetMailGedetecteerd(rapportId, tijdstip) {
  try {
    const o = leesMailGedetecteerd();
    if (tijdstip) o[rapportId] = tijdstip; else delete o[rapportId];
    localStorage.setItem(MAIL_GEDETECTEERD_KEY, JSON.stringify(o));
  } catch { /* geen opslag beschikbaar: dan geen extra bevestiging */ }
}

// Q1 (etappe 7): na een onzeker resultaat nagaan of de mail al verzonden is en dat melden.
// B4: met `ontvangers` (de server bepaalde ze in het voorbeeld) controleert de app per adres en vinkt het rapport voor elke gevonden
// ontvanger zelf "verzonden" aan, zonder versiecontrole (het item wordt enkel op id aangepast; een versieconflict zou een al verstuurde
// mail anders weer "niet verzonden" laten lijken). De detectie wordt altijd onthouden (bevestigingsvraag bij opnieuw versturen).
// De knop gaat enkel open als zeker is dat er niets verstuurd werd; bij een gevonden mail blijft hij op slot, behalve als alles
// aangevinkt is (dan toont de hertekening "✓ Verzonden" met de bevestigingsvraag bij opnieuw versturen).
async function naOnzekerRapport(rapportId, ticketId, start, startWand, btn, ontvangers) {
  toast(TEKST_CONTROLEREN, 30000);
  const metOntvangers = Array.isArray(ontvangers) && ontvangers.length > 0;
  const r = await controleerMail({ ticketId, start, startWand, verwacht: metOntvangers ? ontvangers.map(o => o.email) : [] });
  const gevonden = r.uitkomst === 'verzonden' ? r.verzonden : (r.gevonden || []);
  if (gevonden.length > 0) {
    // Een latere hertekening zet de knop weer open (zonder aanvinken staat er geen "Verzonden"): onthoud de detectie op dit toestel,
    // zodat een volgende verzending van dit rapport eerst een bevestiging vraagt.
    zetMailGedetecteerd(rapportId, gevonden.map(v => v.tijdstip).sort()[0]);
  }
  let aanvinkStand = null; // 'alles' | 'deel' | 'mislukt' | null (niet aangevinkt)
  if (metOntvangers && gevonden.length > 0) {
    let mislukt = 0;
    const rapport = afh.rapportArchief().find(x => x.id === rapportId);
    for (const g of gevonden) {
      const o = ontvangers.find(x => String(x.email).toLowerCase() === String(g.aan).toLowerCase());
      if (!o || !rapport) { mislukt++; continue; }
      const st = await schrijfRapportStatus({ rapportId, doelgroep: o.doelgroep, tijdstip: g.tijdstip });
      if (!st.ok) { console.warn(`Rapport-verzonden opslaan voor ${o.doelgroep} mislukt:`, st.fout); mislukt++; continue; }
      // Zonder versiecontrole bewijst het antwoord niet dat het archief verder ongewijzigd is: enkel doorschuiven als het precies de volgende versie is.
      if (typeof st.versie === 'number' && st.versie === afh.archiefVersie() + 1) afh.zetArchiefVersie(st.versie);
      rapport[o.doelgroep === 'contact' ? 'verzondenContact' : o.doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur'] = g.tijdstip;
    }
    afh.renderRapportArchief();
    aanvinkStand = mislukt > 0 ? 'mislukt' : (r.uitkomst === 'verzonden' ? 'alles' : 'deel');
    // De hertekening bouwde de knop opnieuw op; behalve als alles aangevinkt is blijft hij op slot (kijk eerst in Zoho na).
    if (aanvinkStand !== 'alles') {
      document.querySelectorAll('.btn-verstuur-rapport').forEach(b => { if (b.dataset.rapportId === rapportId) b.disabled = true; });
    }
  }
  const afsluiting = aanvinkStand ? mailControleAfsluiting('rapport', aanvinkStand) : '';
  if (r.uitkomst === 'verzonden') return toast('✓ ' + mailControleTekst(r) + afsluiting, 8000);
  if (r.uitkomst === 'niet-verzonden' && btn) btn.disabled = false;
  toast('⚠ ' + mailControleTekst(r) + afsluiting, 8000);
}
