import { test, expect, kiesHoofdtab } from './helpers.mjs';
import { ROLLEN, startRol, zetTestHaken, GSM } from './kliktest-hulp.mjs';
import { maakContext, veeg, samenvatting, negeerVenster } from './kliktest-veger.mjs';

// Kliktest, deel 2 (taak 13): de kliksweep. Per rol en per tabblad (pc) klikt de sweep (e2e/kliktest-veger.mjs) alle zichtbare, ingeschakelde
// knoppen en klikbare elementen een voor een, en elke knop die een venster opent wordt één niveau dieper doorgeklikt. Na elke klik:
// geen pageerror of consolefout, geen verzoek buiten de stubs en een zichtbaar gevolg. Een knop zonder gevolg moet hieronder in
// ZONDER_GEVOLG_TOEGESTAAN staan (met de reden); een onbekende knop zonder gevolg is een bevinding.
// In testmodus (?test) staat alles op stubs en gaat er niets naar Zoho, TomTom of de mail; de fixture weigert dat ook zelf.
// De overgeslagen knoppen (met reden) staan in OVERSLAAN in e2e/kliktest-veger.mjs.

const tabNaam = (naam) => new RegExp(`^${naam}(\\s|$)`);
const SLEUTELS_TAB = (d) => !d.id.startsWith('tab-'); // de tabbladen zelf: zie e2e/kliktest.spec.mjs

// Knoppen die in deze testopstelling terecht niets zichtbaars doen. Elk item heeft een reden; alles wat niet in de lijst staat, is een bevinding.
const ZONDER_GEVOLG_TOEGESTAAN = [
  { patroon: / > button "Alle"$/, reden: 'Rapporten: het filter "Alle" is al actief, een klik verandert niets.' },
  { patroon: / > button(\[data-actie=kal-weergave\]#kal-view-week)? "Week"$/, reden: 'Kalender: de weergave Week is al actief (de weergavekeuze is een wisselknop).' },
  { patroon: /Vandaag"$/, reden: 'Kalender: "Vandaag" in de periode die al vandaag bevat, verandert niets.' },
  { patroon: / > button "(MA|DI|WO|DO|VR) \d+[^"]*(bezoeken|stops?)"$/, reden: 'Route (planning en sales): de dag die al gekozen is (de weekstrook opent de dag, een tweede klik verandert niets).' },
  { patroon: /button "−"$/, reden: 'Inventaris: "−" bij een aantal van 0 doet niets (het aantal kan niet onder 0).' },
  { patroon: / > button "Wissen"$/, reden: 'Klantbeschikbaarheid en handtekening: "Wissen" op een leeg veld of een leeg tekenvlak verandert niets.' },
  { patroon: / > button "\+ Datum toevoegen"$/, reden: 'Klantbeschikbaarheid: zonder gekozen datum voegt de knop niets toe.' },
  { patroon: / > button "Standaard"$/, reden: 'Klantbeschikbaarheid: de verwachte duur staat al op de standaardwaarde.' },
  { patroon: /button#plan-date-knop "📅"$|button "📅"$/, reden: 'Route: opent de datumkiezer van het besturingssysteem (input.showPicker()), geen verandering in de pagina zelf.' },
  { patroon: /button\[data-actie=route-leeg\] "✕ Leeg"$/, reden: 'Route: een lege route heeft niets om te legen.' },
  { patroon: /button#oorz-kop-toestel "Toestel ›"$/, reden: 'Rapportwizard: de groep Toestel staat al open (een groep kiezen is geen wisselknop).' },
  { patroon: /button\[data-actie=(bav-kind|av-kind)\] "🔒 Hele dag"$/, reden: 'Beschikbaarheden en blokvenster: "Hele dag" is al de gekozen soort (radioknop).' },
  { patroon: /button\[data-actie=dashboard-grenzen-standaard\] "Standaard terugzetten"$/, reden: 'Performance: de grenzen staan al op de standaardwaarden.' },
  { patroon: /set-tab\]#set-subtab-(algemeen|toestel) "[^"]+"$/, reden: 'Instellingen: het subtabblad is al actief.' },
];

// Wacht tot een paneel geladen is en niet meer verandert (de sales-schermen laden lazy): twee gelijke metingen na elkaar.
async function wachtTotStabiel(page, sel) {
  let vorige = -1;
  await expect.poll(async () => { const n = await page.locator(sel).evaluate((e) => e.innerHTML.length); const stabiel = n > 0 && n === vorige; vorige = n; return stabiel; }, { intervals: [200], timeout: 10000 }).toBe(true);
}

// De opslag van de pagina (localStorage en sessionStorage) zoals bij het begin van de sweep: een herstart zet die terug, zodat een blijvende
// keuze van een eerdere klik (maandweergave, een andere week, een gekozen persoon) de volgende knoppen niet laat verdwijnen.
const momentopname = (page) => page.evaluate(() => ({ l: Object.fromEntries(Object.entries(localStorage)), s: Object.fromEntries(Object.entries(sessionStorage)) }));
function maakHerstart(page, snap, heropen) {
  return async () => {
    await page.evaluate((m) => {
      localStorage.clear(); sessionStorage.clear();
      for (const [k, v] of Object.entries(m.l)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(m.s)) sessionStorage.setItem(k, v);
    }, snap);
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-schil', 'laden');
    await page.locator('.tabs-inner .tab:visible').first().waitFor();
    await zetTestHaken(page);
    await heropen?.();
  };
}

// Schrijft de uitkomst van een sweep als annotaties (zichtbaar in de rapporten) en faalt op elke bevinding en op elke knop zonder gevolg die
// niet in ZONDER_GEVOLG_TOEGESTAAN staat.
function rapporteer(ctx, naam) {
  const s = samenvatting(ctx);
  const onverklaard = ctx.geenGevolg.filter((g) => !ZONDER_GEVOLG_TOEGESTAAN.some((t) => t.patroon.test(g.naam))).map((g) => `geen gevolg: ${g.naam} — ${g.detail}`);
  const info = test.info();
  info.annotations.push({ type: 'geklikt', description: String(s.geklikt) });
  for (const g of s.geenGevolg) info.annotations.push({ type: 'geen gevolg (verklaard)', description: g });
  for (const o of s.overgeslagen) info.annotations.push({ type: 'overgeslagen', description: o });
  for (const v of s.vensters) info.annotations.push({ type: 'venster doorgeklikt', description: v });
  console.log(`KLIKSWEEP ${JSON.stringify({ naam, geklikt: s.geklikt, vensters: s.vensters.length, verdwenen: s.verdwenen, herstarts: s.herstarts, geenGevolg: s.geenGevolg, overgeslagen: s.overgeslagen, bevindingen: [...s.bevindingen, ...onverklaard] })}`);
  expect([...s.bevindingen, ...onverklaard], `bevindingen in ${naam}`).toEqual([]);
}

test.describe('kliksweep per tabblad (pc)', () => {
  for (const rol of ROLLEN) {
    for (const naam of rol.tabs.filter((n) => n !== 'Beheer')) {
      test(`${rol.naam}: tabblad ${naam}`, async ({ page, verzoeken, consoleFouten }) => {
        test.setTimeout(240000);
        await startRol(page, rol, 'pc');
        await kiesHoofdtab(page, tabNaam(naam));
        const tab = page.locator('.tabs-inner .tab.active');
        const id = (await tab.getAttribute('id')).replace(/^tab-/, '');
        await wachtTotStabiel(page, `#view-${id}`);
        const heropen = async () => { await kiesHoofdtab(page, tabNaam(naam)); await wachtTotStabiel(page, `#view-${id}`); };
        const snap = await momentopname(page);
        const ctx = maakContext(page, {
          verzoeken, consoleFouten,
          herstel: async () => { if ((await tab.getAttribute('id')) !== `tab-${id}`) await kiesHoofdtab(page, tabNaam(naam)); },
          herstart: maakHerstart(page, snap, heropen),
        });
        await veeg(ctx, { wortelSel: `#view-${id}`, etiket: `${rol.sleutel}/${naam}`, maxDiepte: 2, filter: SLEUTELS_TAB });
        rapporteer(ctx, `${rol.sleutel}/${naam}`);
      });
    }
  }
});

// Beheer is voor elke werkruimte hetzelfde scherm: de beheerder in de werkruimte Sales is daarom niet opnieuw doorgeklikt (de subtabs zelf
// staan wel in e2e/kliktest.spec.mjs).
test.describe('kliksweep per Beheer-subtab (pc)', () => {
  for (const rol of ROLLEN.filter((r) => r.beheer.length > 0 && r.sleutel !== 'beheerder-sales')) {
    for (const sub of rol.beheer) {
      test(`${rol.naam}: Beheer, ${sub}`, async ({ page, verzoeken, consoleFouten }) => {
        test.setTimeout(240000);
        await startRol(page, rol, 'pc');
        await kiesHoofdtab(page, tabNaam('Beheer'));
        const balk = page.locator('.beheer-tabs');
        const subTab = balk.getByRole('tab', { name: sub, exact: true });
        await expect(subTab).toBeVisible();
        const kies = async () => { if ((await subTab.getAttribute('aria-selected')) !== 'true') await subTab.click(); await expect(subTab).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('#beheer-paneel')).not.toHaveAttribute('aria-busy', 'true'); };
        await kies();
        const snap = await momentopname(page);
        const ctx = maakContext(page, {
          verzoeken, consoleFouten,
          herstel: async () => { if ((await page.locator('#tab-beheer').getAttribute('aria-selected')) !== 'true') await kiesHoofdtab(page, tabNaam('Beheer')); await kies(); },
          herstart: maakHerstart(page, snap, async () => { await kiesHoofdtab(page, tabNaam('Beheer')); await kies(); }),
        });
        await veeg(ctx, { wortelSel: '#beheer-paneel', etiket: `${rol.sleutel}/Beheer/${sub}`, maxDiepte: 1 });
        rapporteer(ctx, `${rol.sleutel}/Beheer/${sub}`);
      });
    }
  }
});

// Inventaris met een gekozen technieker: met persoon "Alle" toont Inventaris enkel de aanvullingen en een exportknop; met één technieker staat de
// voorraad van zijn wagen er met knoppen bij (bewerken, plus en min, meldgrens). Dezelfde sweep, met persoon Tim.
test.describe('kliksweep Inventaris met een technieker gekozen (pc)', () => {
  for (const rol of ROLLEN.filter((r) => ['beheerder-planning', 'planner'].includes(r.sleutel))) {
    test(`${rol.naam}: tabblad Inventaris, persoon Tim`, async ({ page, verzoeken, consoleFouten }) => {
      test.setTimeout(240000);
      await startRol(page, rol, 'pc', { technieker: 'Tim' });
      await kiesHoofdtab(page, tabNaam('Inventaris'));
      const tab = page.locator('.tabs-inner .tab.active');
      const heropen = async () => { await kiesHoofdtab(page, tabNaam('Inventaris')); await wachtTotStabiel(page, '#view-inventaris'); };
      await wachtTotStabiel(page, '#view-inventaris');
      const snap = await momentopname(page);
      const ctx = maakContext(page, {
        verzoeken, consoleFouten,
        herstel: async () => { if ((await tab.getAttribute('id')) !== 'tab-inventaris') await kiesHoofdtab(page, tabNaam('Inventaris')); },
        herstart: maakHerstart(page, snap, heropen),
      });
      await veeg(ctx, { wortelSel: '#view-inventaris', etiket: `${rol.sleutel}/Inventaris (Tim)`, maxDiepte: 2, filter: SLEUTELS_TAB });
      rapporteer(ctx, `${rol.sleutel}/Inventaris (Tim)`);
    });
  }
});

// De kop en de zijkolom: persoonkiezer, vernieuwen, licht/donker, instellingen, gebruikersmenu (wachtwoord wijzigen), per rol. De tabbladen zelf
// staan in kliktest.spec.mjs; Uitloggen staat in de overslaglijst. Een persoonskeuze wisselt de weergave (en bij de beheerder de werkruimte): dat
// hoort bij de test, de sweep herstelt enkel de vensters (en na een blijvende keuze met een herstart).
test.describe('kliksweep kop en zijkolom (pc)', () => {
  for (const rol of ROLLEN) {
    test(`${rol.naam}: kop en zijkolom`, async ({ page, verzoeken, consoleFouten }) => {
      test.setTimeout(240000);
      await startRol(page, rol, 'pc');
      const snap = await momentopname(page);
      const ctx = maakContext(page, { verzoeken, consoleFouten, herstel: async () => {}, herstart: maakHerstart(page, snap) });
      await veeg(ctx, { wortelSel: 'header, .tabs', etiket: `${rol.sleutel}/kop`, maxDiepte: 2, filter: SLEUTELS_TAB });
      rapporteer(ctx, `${rol.sleutel}/kop`);
    });
  }
});

// Op een gsm: het dok, de knop "Meer" met zijn blad en de kop. De tabbladen zelf (ook die achter Meer) staan in kliktest.spec.mjs; hier klikt de
// sweep de knoppen van het dok en de kop, en de knoppen in het blad van Meer. Geen scherminhoud: die is op pc doorgeklikt.
test.describe('kliksweep dok, Meer en kop (gsm)', () => {
  for (const rol of ROLLEN) {
    test(`${rol.naam}: dok, Meer en kop`, async ({ page, verzoeken, consoleFouten }) => {
      test.setTimeout(240000);
      await startRol(page, rol, 'gsm');
      expect(page.viewportSize()).toEqual(GSM);
      const snap = await momentopname(page);
      const ctx = maakContext(page, { verzoeken, consoleFouten, herstel: async () => {}, herstart: maakHerstart(page, snap) });
      await veeg(ctx, { wortelSel: 'header, .tabs, .dok-meer', etiket: `${rol.sleutel}/gsm-kop-en-dok`, maxDiepte: 2, filter: SLEUTELS_TAB });
      rapporteer(ctx, `${rol.sleutel}/gsm-kop-en-dok`);
    });
  }
});

// De rapportwizard: open het rapport vanuit een ingepland ticket (Ingepland, ticketdetail, Rapport) en doorloop alle stappen met Volgende. Op elke
// stap klikt de sweep alle knoppen van die stap; de oorzaak-knoppen van stap 4 maken Volgende mogelijk. Sluiten (✕) komt als laatste.
test.describe('kliksweep rapportwizard (pc)', () => {
  for (const rol of ROLLEN.filter((r) => ['beheerder-planning', 'technieker'].includes(r.sleutel))) {
    test(`${rol.naam}: rapportwizard stap voor stap`, async ({ page, verzoeken, consoleFouten }) => {
      test.setTimeout(240000);
      await startRol(page, rol, 'pc');
      await kiesHoofdtab(page, tabNaam('Ingepland'));
      await page.locator('#view-gepland [role=button]').first().click();
      await page.locator('#d-btn-rapport').click();
      const wizard = page.locator('#rapport-wizard');
      await expect(wizard).toHaveClass(/open/);
      const ctx = maakContext(page, { verzoeken, consoleFouten, herstel: async () => {} });
      negeerVenster('#rapport-wizard');
      const stappen = [];
      for (let i = 0; i < 12; i++) {
        const label = (await page.locator('#wiz-step-label').textContent()).trim();
        stappen.push(label);
        await veeg(ctx, {
          wortelSel: '#rapport-wizard', etiket: `${rol.sleutel}/wizard ${label}`, maxDiepte: 1,
          filter: (d) => !['wizard-sluit', 'wizard-volgende', 'wizard-terug'].includes(d.actie),
        });
        const [nu, rest] = label.split(' / ');
        if (nu === rest.split(' ')[0]) break; // de laatste stap ("9 / 9 — Overzicht"): sluiten komt hieronder
        const volgende = page.locator('#wiz-btn-next');
        const tekst = (await volgende.textContent()).trim();
        await volgende.click();
        await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
        const nieuw = (await page.locator('#wiz-step-label').textContent()).trim();
        if (nieuw === label) {
          // Volgende werd geweigerd (verplichte velden): de melding staat in de toast.
          ctx.bevindingen.push({ soort: 'wizard blijft op dezelfde stap', naam: `${rol.sleutel}/wizard ${label}`, detail: `na "${tekst}" blijft de stap staan; toast: ${(await page.locator('#toast').textContent()).trim()}` });
          break;
        }
      }
      // Sluiten met ✕ (de browser vraagt "Rapport sluiten?"; de sweep bevestigt dat) en controleren dat de wizard dicht is.
      await page.locator('[data-actie=wizard-sluit]').click();
      await expect(wizard).not.toHaveClass(/open/);
      expect(stappen.length, 'alle stappen van de wizard doorlopen').toBe(9);
      console.log(`WIZARD ${JSON.stringify(stappen)}`);
      rapporteer(ctx, `${rol.sleutel}/wizard`);
    });
  }
});
