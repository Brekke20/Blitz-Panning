import { test, expect, startApp, opslagStub } from './helpers.mjs';

// v2.1.5 (veiligheid): de afdrukkopie van een rapport uit het archief (rapport-archief.js, bouwDrukKopie) staat in een venster van
// de app zelf. De rapport-HTML komt uit opslag die niet te vertrouwen is, dus mag de kopie nooit script uitvoeren, nooit iets
// laden van buiten, op het scherm nooit zichtbaar of klikbaar zijn en nooit de stijl van het rapport overnemen.
// De toelatingslijst zelf: public/js/kern/veilige-html.js (beslisregels in tests/veilige-html.test.mjs).

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const KWAAD = `<!DOCTYPE html><html><head>
<style>:host{display:block!important;position:fixed;inset:0;z-index:9;background:#fff}
@import url(https://evil.test/i.css); @\\69mport url(https://evil.test/j.css)
body{background:url(https://evil.test/body.png)}</style>
<link rel="stylesheet" href="https://evil.test/l.css">
<meta http-equiv="refresh" content="0;url=javascript:opener.__pwned=1">
</head><body>
<div class="sec">Handtekeningen</div>
<a href="java&#9;script:void(opener.__pwned=1)" style="display:block;position:fixed;inset:0;z-index:99">Klik om te bekijken</a>
<a href="JaVaScRiPt:opener.__pwned=1">b</a>
<a href="data:text/html,&lt;script&gt;opener.__pwned=1&lt;/script&gt;">c</a>
<svg onload="opener.__pwned=1"><a xlink:href="javascript:opener.__pwned=1"><text>s</text></a><animate attributeName="href" values="javascript:opener.__pwned=1"/><image href="https://evil.test/svg.png"/></svg>
<math><mtext><table><mglyph><style><img src=x onerror="opener.__pwned=1"></style></mglyph></table></mtext></math>
<div style="background:url(https://evil.test/bg.png)">achtergrond</div>
<div style="position:fixed;inset:0;z-index:99;color:red">vast</div><div style="color:red;display:block">rood</div>
<iframe srcdoc="&lt;script&gt;parent.opener.__pwned=1&lt;/script&gt;"></iframe>
<form action="https://evil.test/f"><button formaction="javascript:opener.__pwned=1">f</button><input type="image" src="https://evil.test/in.png"></form>
<img src="https://evil.test/a.png"><img src="https://evil.test/x" onerror="opener.__pwned=1"><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">
<img srcset="https://evil.test/s.png 1x"><video poster="https://evil.test/p.png"></video><object data="https://evil.test/o"></object>
<img src="data:image/png;base64,${PNG}" class="handtekening" alt="handtekening" onload="opener.__pwned=1">
<p>&lt;script&gt;opener.__pwned=1&lt;/script&gt;</p>
<script>opener.__pwned=1</script>
<template><img src=x onerror="opener.__pwned=1"></template>
</body></html>`;

const RAPPORT = { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Tim', rapportData: { _html: KWAAD } };
const SANDBOX_MELDINGEN = [
  /^console\.error: Blocked script execution in '(about:srcdoc|https:\/\/evil\.test\/[^']*)' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\./,
  /^console\.error: Refused to refresh about:srcdoc to a javascript: URL \(about:srcdoc\)$/,
];
const TOEGELATEN_ATTR = new Set(['class', 'colspan', 'rowspan', 'style', 'src', 'alt', 'width', 'height']);

test.describe('rapport afdrukken uit het archief: kopie is veilig', () => {
  test('kwaadaardige rapport-HTML: geen script, geen extern verzoek, kopie enkel tijdens het afdrukken', async ({ page, consoleFouten }) => {
    await startApp(page, { overschrijf: { 'rapport-archief': opslagStub({ versie: 1, rapports: [RAPPORT] }, 'rapports') } });
    // Elk verzoek naar de nep-aanvaller: beantwoord (geen netwerkfoutruis) en genoteerd met het frame dat het deed. Na startApp
    // geregistreerd, zodat deze route voorgaat op het vangnet van helpers.mjs.
    const kwaadVerzoeken = [];
    await page.context().route(u => u.hostname === 'evil.test', (route) => {
      const req = route.request();
      kwaadVerzoeken.push({ url: req.url(), frame: req.frame() });
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') });
    });
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: '📄 Openen' }).click()]);
    await popup.waitForLoadState('load');
    await expect.poll(() => popup.evaluate(() => !!document.querySelector('iframe')?.contentDocument?.querySelector('.sec'))).toBe(true);

    // Op het scherm: geen kopie in het document; bovenaan ligt de (sandboxed) iframe.
    const opScherm = () => popup.evaluate(() => ({
      kopie: document.querySelectorAll('#druk-kopie').length,
      bovenaan: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.tagName,
    }));
    expect(await opScherm()).toEqual({ kopie: 0, bovenaan: 'IFRAME' });

    // beforeprint (zoals Ctrl+P): de kopie hangt in het venster, maar op het scherm blijft ze onzichtbaar en onklikbaar,
    // ook met :host{display:block!important} in de rapportstijl (die stijl wordt niet overgenomen).
    await popup.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    const scherm = await popup.evaluate(() => {
      const host = document.getElementById('druk-kopie');
      return { display: getComputedStyle(host).display, bovenaan: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.tagName };
    });
    expect(scherm).toEqual({ display: 'none', bovenaan: 'IFRAME' });
    await popup.mouse.click(200, 200);

    const drukStijl = await page.evaluate(async () => (await import('/js/rapport-archief.js')).DRUKKOPIE_CSS);
    const inhoud = await popup.evaluate(() => {
      const wortel = document.getElementById('druk-kopie').shadowRoot;
      const els = [...wortel.querySelectorAll('*')];
      return {
        stijlen: [...wortel.querySelectorAll('style')].map(s => s.textContent),
        tags: [...new Set(els.map(e => e.localName))].sort(),
        namespaces: [...new Set(els.map(e => e.namespaceURI))],
        attrs: [...new Set(els.flatMap(e => [...e.attributes].map(a => a.name)))].sort(),
        srcs: [...wortel.querySelectorAll('img')].map(i => i.getAttribute('src')),
        stijlen2: els.map(e => e.getAttribute('style')).filter(Boolean),
        tekst: wortel.textContent,
      };
    });
    expect(inhoud.stijlen).toEqual([drukStijl]); // enkel de eigen stijl
    expect(inhoud.tags.filter(t => t !== 'style').every(t => ['div', 'p', 'img'].includes(t)), inhoud.tags.join(',')).toBe(true);
    expect(inhoud.namespaces).toEqual(['http://www.w3.org/1999/xhtml']);
    expect(inhoud.attrs.every(a => TOEGELATEN_ATTR.has(a)), inhoud.attrs.join(',')).toBe(true);
    expect(inhoud.srcs).toEqual([`data:image/png;base64,${PNG}`]);
    expect(inhoud.stijlen2.filter(st => /position|display|inset|z-index|url|background:/i.test(st))).toEqual([]);
    expect(inhoud.tekst).toContain('Handtekeningen');
    expect(inhoud.tekst).toContain('<script>opener.__pwned=1</script>'); // als tekst, niet als element

    // Afdrukweergave: de kopie is zichtbaar, de iframe niet. Alles in de kopie aanklikken doet niets.
    await popup.emulateMedia({ media: 'print' });
    expect(await popup.evaluate(() => ({
      kopie: getComputedStyle(document.getElementById('druk-kopie')).display,
      iframe: getComputedStyle(document.querySelector('iframe')).display,
    }))).toEqual({ kopie: 'block', iframe: 'none' });
    await popup.evaluate(() => { for (const el of document.getElementById('druk-kopie').shadowRoot.querySelectorAll('*')) el.click(); });

    // afterprint: de kopie verdwijnt weer uit het document.
    await popup.emulateMedia({ media: 'screen' });
    await popup.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    expect(await opScherm()).toEqual({ kopie: 0, bovenaan: 'IFRAME' });

    // Geen enkel script liep, niet in het venster en niet in de app.
    expect(await popup.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();

    // Externe verzoeken: enkel uit de sandboxed iframe (bestaand gedrag), nooit uit het venster of de app zelf.
    const uitApp = kwaadVerzoeken.filter(v => v.frame === popup.mainFrame() || v.frame === page.mainFrame()).map(v => v.url);
    expect(kwaadVerzoeken.length, 'de opname werkt: de iframe zelf laadde wel van evil.test').toBeGreaterThan(0);
    expect(uitApp).toEqual([]);

    await popup.close(); // eerst sluiten: daarna komen er geen meldingen van de iframe meer bij
    // De sandbox van de iframe weigert het script, de javascript:-refresh en het script in de geneste object-frame: dat zijn de
    // verwachte meldingen van de iframe zelf (bewijs dat de sandbox werkt), geen fout van de app.
    for (let i = consoleFouten.length - 1; i >= 0; i--) {
      if (SANDBOX_MELDINGEN.some(r => r.test(consoleFouten[i]))) consoleFouten.splice(i, 1);
    }
  });

  test('toelatingslijst met de echte HTML-parser: aanvalsvormen verdwijnen, rapportinhoud blijft', async ({ page }) => {
    await startApp(page);
    const uit = await page.evaluate(async (gevallen) => {
      const { schoonRapportHtml } = await import('/js/kern/veilige-html.js');
      // Doel: een inert document, zodat ook een toegelaten /api/fotos-afbeelding hier niets ophaalt.
      const doelDoc = document.implementation.createHTMLDocument('');
      const win = { DOMParser: window.DOMParser, document: doelDoc };
      return gevallen.map(([invoer]) => {
        const d = doelDoc.createElement('div');
        d.appendChild(schoonRapportHtml(invoer, win));
        return d.innerHTML;
      });
    }, GEVALLEN);
    expect(uit).toEqual(GEVALLEN.map(([, verwacht]) => verwacht));
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});

const GEVALLEN = [
  ['<a href="java&#9;script:window.__pwned=1">x</a>', 'x'],
  ['<a href="java&#10;script:window.__pwned=1">x</a>', 'x'],
  ['<a href="JaVaScRiPt:window.__pwned=1">x</a>', 'x'],
  ['<a href="&#x6A;avascript:window.__pwned=1">x</a>', 'x'],
  ['<img src="java&#9;script:window.__pwned=1">', ''],
  ['<img src="&#106;avascript:window.__pwned=1">', ''],
  ['<img src="data:text/html;base64,PHNjcmlwdD4=">', ''],
  ['<a href="data:text/html,&lt;script&gt;window.__pwned=1&lt;/script&gt;">d</a>', 'd'],
  ['<svg onload="window.__pwned=1"><a xlink:href="javascript:window.__pwned=1"><text>s</text></a><set attributeName="href" to="javascript:x"/></svg>t', 't'],
  ['<math><mtext><table><mglyph><style><img src=x onerror="window.__pwned=1"></style></mglyph></table></mtext></math>t', 't'],
  ['<math href="javascript:window.__pwned=1"><mi>m</mi></math>t', 't'],
  ['<style>@import url(https://evil.test/x.css);</style>t', 't'],
  ['<style>@\\69mport url(https://evil.test/x.css)</style>t', 't'],
  ['<div style="background:url(https://evil.test/x.png)">t</div>', '<div>t</div>'],
  ['<div style="position:fixed;inset:0" class="sig-box">t</div>', '<div class="sig-box">t</div>'],
  ['<iframe srcdoc="&lt;script&gt;window.__pwned=1&lt;/script&gt;"></iframe>t', 't'],
  ['<form action="https://evil.test"><button formaction="javascript:window.__pwned=1">b</button></form>t', 't'],
  ['<base href="https://evil.test/">t', 't'],
  ['<meta http-equiv="refresh" content="0;url=javascript:window.__pwned=1">t', 't'],
  ['<link rel="stylesheet" href="https://evil.test/x.css">t', 't'],
  ['&lt;img src=x onerror=window.__pwned=1&gt;', '&lt;img src=x onerror=window.__pwned=1&gt;'],
  ['<noscript><p title="</noscript><img src=x onerror=window.__pwned=1>"></noscript>t', '<p>t</p>'], // de parser sluit de p pas na t; de title valt weg
  ['<template><img src=x onerror="window.__pwned=1"></template>t', 't'],
  ['<img src="https://evil.test/a.png" alt="a">', ''],
  ['<img srcset="https://evil.test/a.png 1x">', ''],
  [`<img src="data:image/png;base64,${PNG}" onerror="window.__pwned=1" style="width:1px" alt="h">`, `<img style="width:1px" alt="h" src="data:image/png;base64,${PNG}">`],
  ['<span style="text-decoration:line-through;color:#aaa;font-size:8pt">€ 345.00</span>', '<span style="text-decoration:line-through;color:#aaa;font-size:8pt">€ 345.00</span>'],
  ['<span style="color:red;position:fixed;top:0">t</span>', '<span style="color:red">t</span>'],
  ['<span style="color:u\\72l(https://evil.test/x)">t</span>', '<span>t</span>'],
  ['<span style="color:red/**/;display:block">t</span>', '<span>t</span>'],
  ['<span style="color:&quot;red&quot;">t</span>', '<span>t</span>'],
  ['<img src="/api/fotos?id=1&amp;n=a.jpg">', '<img src="/api/fotos?id=1&amp;n=a.jpg">'],
  ['<table><tr><td colspan="2" onclick="window.__pwned=1" style="x">a</td></tr></table>', '<table><tbody><tr><td colspan="2">a</td></tr></tbody></table>'],
  ['<div id="opener" name="x" is="y" tabindex="0" popover="">t</div>', '<div>t</div>'],
  ['<a href="#" class="x"><strong>vet</strong></a>', '<strong>vet</strong>'],
  ['<div class="sec">Handtekeningen</div><div class="sig-row"><div class="sig-box"><div class="sig-box-title">Klant</div></div></div>',
    '<div class="sec">Handtekeningen</div><div class="sig-row"><div class="sig-box"><div class="sig-box-title">Klant</div></div></div>'],
];
