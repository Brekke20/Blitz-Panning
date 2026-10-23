// schermen/beheer-themas.js — beheertab Thema's (enkel beheerder): per thema een kaart met de status in gewoon Nederlands, een
// aan/uit-schakelaar, de periode aanpassen (en terug naar de standaard), een voorbeeld in de hele app en het pakket downloaden;
// bovenaan een pakket uploaden (nieuw thema of een nieuwe versie van een bestaand). API: /api/themas (GET, POST, PATCH; schrijven enkel beheerder).
// Veiligheid: een pakket en de foutregels van de validator bevatten ruwe sleutels uit een bestand: alles gaat via textContent (h() uit beheer.js),
// nooit via innerHTML. Een voorbeeld leeft enkel in het geheugen (themas-bron.js) en schrijft niets.
// Na elke geslaagde wijziging: laadThemas() en herbereken(), zodat het eigen scherm van de beheerder meteen volgt.
import { registreerBeheerTab, openBeheerVenster, beheerVerzoek, beheerFoutTekst, h } from './beheer.js';
import { appConfirm } from '../app-dialog.js';
import { toast } from '../kern/ui.js';
import { toonSkelet } from '../kern/skelet.js';
import { effectievePeriode, belgischeDag, vensterTekst } from '../kern/themapakket.js';
import { MAX_PAKKET_BYTES } from '../kern/themapakket-validatie.js';
import { easterDate } from '../kern/feestdagen.js';
import { zetVoorbeeld, voorbeeld, laadThemas } from './themas-bron.js';
import { herbereken } from './evenement-laag.js';
import {
  kaartVan, periodeUitInvoer, controleerUpload, foutRegels, downloadNaam, downloadTekst, MAANDEN,
} from './beheer-themas-logica.js';

const PAD = '/api/themas';
const UITLEG = 'Een themapakket is een bestand (.json) met de versiering, kleuren en Blitz Run-skins van een feest. Een thema loopt automatisch in zijn periode; '
  + 'het kortste venster gaat voor als er twee tegelijk lopen. Zet een thema uit om het niet te tonen.';

const verversApp = async () => {
  try { await laadThemas(); herbereken(); } catch (fout) { console.error('Thema\'s vernieuwen mislukt:', fout); }
};

async function render(container) {
  let data = null; // { versie, themas } van de server
  let bezig = false; // één schrijfactie tegelijk (de lijst heeft één versienummer)
  let volgnummer = 0;

  const kaarten = h('div', { class: 'bt-kaarten' });
  const status = h('p', { class: 'bg-status', role: 'status' });
  const uploadFout = h('div', { class: 'bt-uploadfout', role: 'alert' });
  const voorbeeldTekst = h('span', { class: 'bt-voorbeeld-tekst' });
  const stopKnop = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Stop voorbeeld' });
  const voorbeeldBalk = h('div', { class: 'bt-voorbeeld', role: 'status', hidden: true }, voorbeeldTekst, stopKnop);
  const bestand = h('input', { type: 'file', class: 'bt-bestand', accept: '.json,application/json', hidden: true, 'aria-label': 'Themapakket kiezen (.json)' });
  const uploadKnop = h('button', { type: 'button', class: 'btn btn--primary', text: 'Pakket uploaden' });
  const vernieuw = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Vernieuwen' });

  const vergrendel = (aan) => {
    for (const el of [uploadKnop, vernieuw, stopKnop, ...kaarten.querySelectorAll('button, input')]) el.disabled = aan;
  };
  // Eén schrijfactie tegelijk; tijdens de actie staat alles op slot, daarna wordt de lijst opnieuw getekend.
  async function schrijf(fn) {
    if (bezig) return null;
    bezig = true;
    vergrendel(true);
    try { return await fn(); } finally { bezig = false; teken(); vergrendel(false); }
  }

  // ── Tekenen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function kaart(k, thema, voorbeeldId) {
    const aan = h('input', { type: 'checkbox', role: 'switch', class: 'bt-schakel', 'aria-label': `${k.naam} aan` });
    aan.checked = k.aan;
    aan.addEventListener('change', () => zetAan(thema, aan));
    const isVoorbeeld = voorbeeldId === k.id;
    return h('article', { class: 'bt-kaart', 'data-thema': k.id, 'data-status': k.status.soort, 'aria-label': k.naam },
      h('div', { class: 'bt-kaart-kop' },
        h('h4', { class: 'bt-naam', text: k.naam }),
        h('span', { class: 'bg-chip bt-status', 'data-status': k.status.soort, text: k.status.tekst })),
      h('p', { class: 'bt-periode' },
        h('span', { text: k.periodeTekst }),
        k.aangepast ? h('span', { class: 'bg-chip bt-aangepast', text: 'Aangepast' }) : null),
      h('label', { class: 'bt-schakel-rij' }, aan, h('span', { text: 'Aan' })),
      h('div', { class: 'bg-acties bt-acties' },
        isVoorbeeld
          ? h('span', { class: 'bg-chip bt-bekijk', text: 'Je bekijkt dit voorbeeld' })
          : h('button', { type: 'button', class: 'btn btn--secondary', 'data-actie': 'voorbeeld', 'aria-label': `Voorbeeld van ${k.naam} bekijken`, text: 'Voorbeeld', onclick: () => startVoorbeeld(k) }),
        h('button', { type: 'button', class: 'btn btn--secondary', 'data-actie': 'periode', 'aria-label': `Periode van ${k.naam} aanpassen`, text: 'Periode aanpassen', onclick: () => openPeriode(thema) }),
        h('button', { type: 'button', class: 'btn btn--secondary', 'data-actie': 'download', 'aria-label': `${k.naam} downloaden`, text: 'Downloaden', onclick: () => download(k) })));
  }

  function teken() {
    const lijst = Array.isArray(data?.themas) ? data.themas : [];
    const nu = new Date();
    const voorbeeldId = voorbeeld()?.id ?? null;
    if (lijst.length === 0) kaarten.replaceChildren(h('p', { class: 'bg-uitleg', text: 'Er zijn nog geen thema\'s. Upload een pakket om te beginnen.' }));
    else kaarten.replaceChildren(...lijst.map(t => kaart(kaartVan(t, lijst, nu), t, voorbeeldId)));
    const rij = voorbeeldId !== null ? lijst.find(t => t.id === voorbeeldId) : null;
    voorbeeldBalk.hidden = voorbeeldId === null;
    voorbeeldTekst.textContent = voorbeeldId === null ? ''
      : `Voorbeeld van ${rij?.naam ?? voorbeeldId}: je ziet dit thema nu in de hele app, ook buiten zijn periode. Het blijft staan tot je het stopt of de pagina herlaadt.`;
    if (bezig) vergrendel(true);
  }

  // ── Laden ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function laad() {
    const mijn = ++volgnummer;
    vernieuw.disabled = true;
    const eerste = data === null;
    if (!eerste) status.textContent = 'Laden…';
    const skelet = toonSkelet(kaarten, { vorm: 'tegels' });
    let r;
    try { r = await beheerVerzoek(PAD); } finally { skelet.stop(); }
    if (mijn !== volgnummer) return;
    vernieuw.disabled = bezig;
    status.textContent = '';
    if (!r.ok || !Array.isArray(r.data?.themas)) {
      if (data === null) kaarten.replaceChildren(h('p', { class: 'beheer-fout', role: 'alert', text: r.ok ? 'Het antwoord van de server is onleesbaar.' : beheerFoutTekst(r) }));
      else status.textContent = beheerFoutTekst(r);
      return;
    }
    data = { versie: Number.isInteger(r.data.versie) ? r.data.versie : 0, themas: r.data.themas };
    teken();
  }

  // ── Wijzigen (PATCH) ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // -> 'ok' | 'conflict' | 'fout'. Een 409 (iemand anders wijzigde de lijst) herlaadt de lijst en meldt dat.
  async function patch(body) {
    const r = await beheerVerzoek(PAD, { methode: 'PATCH', body: { ...body, versie: data.versie } });
    if (r.ok && Array.isArray(r.data?.themas)) {
      data = { versie: Number.isInteger(r.data.versie) ? r.data.versie : data.versie + 1, themas: r.data.themas };
      await verversApp();
      return 'ok';
    }
    if (r.status === 409) {
      toast('De themalijst is intussen door iemand anders gewijzigd. De lijst is vernieuwd; probeer het opnieuw.');
      await laad();
      await verversApp();
      return 'conflict';
    }
    toast(beheerFoutTekst(r));
    return 'fout';
  }

  async function zetAan(thema, schakelaar) {
    const nieuw = schakelaar.checked;
    if (!nieuw) {
      const lijst = data?.themas ?? [];
      const loopt = kaartVan(thema, lijst, new Date()).status.soort === 'actief';
      schakelaar.disabled = true;
      const ja = await appConfirm({
        titel: `${thema.naam} uitzetten?`,
        tekst: loopt ? 'Dit thema loopt nu: het verdwijnt meteen voor alle gebruikers, tot je het weer aanzet.' : 'Het thema wordt dan niet meer getoond, ook niet als zijn periode loopt, tot je het weer aanzet.',
        bevestigLabel: 'Uitzetten',
      });
      if (!ja) { schakelaar.checked = true; schakelaar.disabled = false; return; }
    }
    const uitkomst = await schrijf(() => patch({ id: thema.id, aan: nieuw }));
    if (uitkomst === 'ok') toast(`${thema.naam} staat ${nieuw ? 'aan' : 'uit'}`);
    else if (uitkomst === null) teken(); // een andere schrijfactie liep nog: de schakelaar keert terug naar de stand van de server
  }

  // ── Periode aanpassen ───────────────────────────────────────────────────────────────────────────────────────────────────
  function openPeriode(thema) {
    const venster = openBeheerVenster({
      titel: `Periode van ${thema.naam}`,
      focusTerug: () => kaarten.querySelector(`[data-thema="${CSS.escape(thema.id)}"] [data-actie="periode"]`),
    });
    const periode = effectievePeriode(thema);
    const pasen = thema.periode?.basis === 'pasen'; // het soort volgt het pakket; de beheerder wisselt niet tussen vast en Pasen
    const aangepast = thema.periodeOverride !== null && thema.periodeOverride !== undefined;
    const jaar = belgischeDag(new Date()).jaar;
    const fout = h('p', { class: 'bg-fout', role: 'alert' });
    const resultaat = h('p', { class: 'bg-uitleg bt-resultaat', 'aria-live': 'polite' });
    let lees; // () => invoer voor periodeUitInvoer
    let velden;

    if (pasen) {
      const p = easterDate(jaar);
      const van = h('input', { class: 'set-input', id: 'bt-van-dagen', type: 'number', inputmode: 'numeric', step: '1', min: '-60', max: '60' });
      const tot = h('input', { class: 'set-input', id: 'bt-tot-dagen', type: 'number', inputmode: 'numeric', step: '1', min: '-60', max: '60' });
      van.value = String(periode.van ?? 0);
      tot.value = String(periode.tot ?? 0);
      lees = () => ({ soort: 'pasen', vanDagen: van.value, totDagen: tot.value });
      velden = [
        h('p', { class: 'bg-uitleg', text: `Dit thema volgt Pasen. Geef de grenzen in dagen ten opzichte van Paaszondag: 0 is Pasen zelf, een negatief getal is ervoor. Pasen valt in ${jaar} op ${p.getDate()} ${MAANDEN[p.getMonth()]}.` }),
        h('div', { class: 'set-field' }, h('label', { class: 'set-label', for: 'bt-van-dagen', text: 'Begint (dagen t.o.v. Pasen)' }), van),
        h('div', { class: 'set-field' }, h('label', { class: 'set-label', for: 'bt-tot-dagen', text: 'Eindigt (dagen t.o.v. Pasen)' }), tot),
      ];
    } else {
      const kant = (voorvoegsel, titel, waarde) => {
        const dag = h('input', { class: 'set-input', id: `bt-${voorvoegsel}-dag`, type: 'number', inputmode: 'numeric', step: '1', min: '1', max: '31' });
        const maand = h('select', { class: 'set-input', id: `bt-${voorvoegsel}-maand` }, MAANDEN.map((m, i) => h('option', { value: String(i + 1), text: m })));
        dag.value = String(waarde.dag);
        maand.value = String(waarde.maand);
        const groep = h('fieldset', { class: 'bt-datum' }, h('legend', { class: 'set-label', text: titel }),
          h('div', { class: 'bt-datum-rij' },
            h('div', { class: 'set-field' }, h('label', { class: 'set-label', for: dag.id, text: 'Dag' }), dag),
            h('div', { class: 'set-field' }, h('label', { class: 'set-label', for: maand.id, text: 'Maand' }), maand)));
        return { dag, maand, groep };
      };
      const van = kant('van', 'Begint op', periode.van);
      const tot = kant('tot', 'Eindigt op', periode.tot);
      lees = () => ({ soort: 'vast', vanDatum: { maand: van.maand.value, dag: van.dag.value }, totDatum: { maand: tot.maand.value, dag: tot.dag.value } });
      velden = [
        h('p', { class: 'bg-uitleg', text: 'Het thema loopt elk jaar in deze periode, begin- en einddag inbegrepen. Begint het in december en eindigt het in januari, dan loopt het over de jaarwissel.' }),
        van.groep, tot.groep,
      ];
    }
    const toonResultaat = () => {
      const p = periodeUitInvoer(lees());
      resultaat.textContent = p.fout ? '' : `Dit jaar: ${vensterTekst(p, jaar)}`;
    };

    const annuleer = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Annuleren', onclick: venster.sluit });
    const standaard = h('button', { type: 'button', class: 'btn btn--secondary', text: 'Terug naar standaard' });
    if (!aangepast) standaard.disabled = true;
    const opslaan = h('button', { type: 'submit', class: 'btn btn--primary', text: 'Opslaan' });
    const form = h('form', { class: 'bg-form bt-form', novalidate: true }, ...velden, resultaat, fout,
      h('div', { class: 'beheer-venster-acties' }, standaard, annuleer, opslaan));
    venster.body.append(form);
    form.addEventListener('input', () => { fout.textContent = ''; toonResultaat(); });
    toonResultaat();
    venster.body.querySelector('input')?.focus();

    const verstuur = (periodeWaarde, melding) => schrijf(async () => {
      const uitkomst = await patch({ id: thema.id, periode: periodeWaarde });
      if (uitkomst === 'ok') toast(melding);
      if (uitkomst !== 'fout') venster.sluit();
      else fout.textContent = 'Opslaan is mislukt. Probeer het opnieuw.';
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = periodeUitInvoer(lees());
      if (p.fout) { fout.textContent = p.fout; return; }
      verstuur(p, `Periode van ${thema.naam} aangepast`);
    });
    standaard.addEventListener('click', () => verstuur(null, `Periode van ${thema.naam} staat weer op de standaard`));
  }

  // ── Voorbeeld ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function startVoorbeeld(k) {
    if (bezig) return;
    bezig = true;
    vergrendel(true);
    try {
      const r = await beheerVerzoek(`${PAD}?id=${encodeURIComponent(k.id)}`);
      if (!r.ok || r.data === null || typeof r.data !== 'object') { toast(beheerFoutTekst(r)); return; }
      zetVoorbeeld(r.data);
      herbereken();
      // De laag toont nooit een ongevalideerd pakket: staat het thema er niet, dan klopte het pakket niet.
      if (document.documentElement.dataset.event !== r.data.id) {
        zetVoorbeeld(null);
        herbereken();
        toast('Dit voorbeeld kan niet getoond worden: het pakket klopt niet.');
      }
    } finally { bezig = false; teken(); vergrendel(false); }
  }
  stopKnop.addEventListener('click', () => { zetVoorbeeld(null); herbereken(); teken(); });

  // ── Downloaden ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function download(k) {
    if (bezig) return;
    bezig = true;
    vergrendel(true);
    try {
      const r = await beheerVerzoek(`${PAD}?id=${encodeURIComponent(k.id)}`);
      if (!r.ok || r.data === null || typeof r.data !== 'object') { toast(beheerFoutTekst(r)); return; }
      const url = URL.createObjectURL(new Blob([downloadTekst(r.data)], { type: 'application/json' }));
      const a = h('a', { href: url, download: downloadNaam(k.id), hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally { bezig = false; teken(); vergrendel(false); }
  }

  // ── Uploaden ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function toonUploadFouten(regels) {
    uploadFout.replaceChildren(
      h('p', { class: 'bt-fout-kop', text: 'Het pakket is niet geüpload. Dit klopt er niet:' }),
      h('ul', { class: 'bt-fout-lijst' }, regels.map(r => h('li', { text: r }))));
  }

  async function upload(bestandKeuze) {
    uploadFout.replaceChildren();
    if (bestandKeuze.size > MAX_PAKKET_BYTES) { toonUploadFouten(['Het bestand is groter dan 512 kB.']); return; }
    let tekst;
    try { tekst = await bestandKeuze.text(); } catch { toonUploadFouten(['Het bestand kon niet gelezen worden.']); return; }
    const c = controleerUpload(tekst);
    if (!c.ok) { toonUploadFouten(foutRegels(c.fouten)); return; }
    const pakket = c.pakket;
    const bestaand = (data?.themas ?? []).find(t => t.id === pakket.id) ?? null;
    if (bestaand) {
      const ja = await appConfirm({
        titel: `Nieuwe versie van ${bestaand.naam} uploaden?`,
        tekst: 'Het huidige pakket wordt voor alle gebruikers vervangen. De aan/uit-stand en een aangepaste periode blijven behouden.',
        bevestigLabel: 'Uploaden',
      });
      if (!ja) return;
    }
    await schrijf(async () => {
      status.textContent = 'Uploaden…';
      const r = await beheerVerzoek(PAD, { methode: 'POST', body: pakket });
      status.textContent = '';
      if (r.ok && Array.isArray(r.data?.themas)) {
        data = { versie: Number.isInteger(r.data.versie) ? r.data.versie : (data?.versie ?? 0), themas: r.data.themas };
        await verversApp();
        toast(r.data.nieuw === false ? `Nieuwe versie van ${pakket.naam} geüpload` : `${pakket.naam} is toegevoegd`);
        return;
      }
      if (r.status === 422 && Array.isArray(r.data?.fouten)) {
        toonUploadFouten(foutRegels(r.data.fouten));
        return;
      }
      toonUploadFouten([beheerFoutTekst(r)]);
    });
  }

  uploadKnop.addEventListener('click', () => bestand.click());
  bestand.addEventListener('change', async () => {
    const keuze = bestand.files?.[0];
    if (!keuze) return;
    try { await upload(keuze); } finally { bestand.value = ''; } // dezelfde keuze (na een correctie) moet opnieuw kunnen
  });
  vernieuw.addEventListener('click', laad);

  container.replaceChildren(h('div', { class: 'bt' },
    h('div', { class: 'bg-kop' }, h('h3', { class: 'bg-titel', text: 'Thema\'s' }), h('div', { class: 'bg-toolbar' }, uploadKnop, vernieuw)),
    h('p', { class: 'bg-uitleg', text: UITLEG }),
    bestand, uploadFout, voorbeeldBalk, status, kaarten));
  await laad();
}

registreerBeheerTab({ id: 'themas', label: 'Thema\'s', render, rollen: ['beheerder'] });
