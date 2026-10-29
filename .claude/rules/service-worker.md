---
paths:
  - "public/sw.js"
  - "public/sw-strategie.js"
  - "tests/sw-*.test.mjs"
  - "e2e/sw/**"
---
# public — service worker

Verplaatst uit de CLAUDE.md in de hoofdmap (2026-10-29); laadt enkel bij werk aan de bestanden hieronder (paths). Staat in .claude/rules en niet in public/, omdat Netlify public/ online zet. De algemene regels staan in de hoofdmap.

## Service worker (`public/sw.js`, `public/sw-strategie.js`)

- `sw-strategie.js` bevat alle beslislogica (UMD: `self.SwStrategie` in de SW, `module.exports` in `node --test`; `tests/sw-strategie.test.mjs`). `sw.js` is een dun omhulsel met `CACHE_NAME`, `EXTERN_CACHE`, `SHELL`, `CDN_VAST` en `FONT_HOSTS`.
- Strategie: eigen schil netwerk-eerst met de cache als terugval (de cache wordt bij een netwerksucces niet ververst, zodat de modules onderling consistent blijven); de CDN-bibliotheken (exacte URL, `CDN_VAST`) cache-eerst in `blitz-extern-v1`; Google Fonts stale-while-revalidate; enkel een antwoord met status 200 gaat de cache in; `/api`, `/.netlify/` en alles wat geen GET is wordt nooit afgehandeld of bewaard. De installatie heeft een tijdlimiet en breekt niet op een storing van een CDN.
- `NAV_TIMEOUT_MS = 4000` (Brent, 2026-10-02): wacht een navigatie langer dan 4 s op het netwerk, dan start de app uit de bewaarde kopie (maximaal één release oud). Tests overschrijven dit via `/sw.js?navTimeout=<ms>` (0 tot 30000; 0 = uit).
- `CACHE_NAME` (nu `blitz-planning-v45`, release 2.8.0; `tests/sw-schil.test.mjs` pint de waarde) wordt bij elke release opgehoogd (zie de CACHE_NAME-regel hieronder en `docs/release-checklist-2.0.md`). Elk nieuw laadbaar bestand onder `public/js/` komt in dezelfde commit in `SHELL`; `tests/sw-schil.test.mjs` bewaakt dat de modulepreload-lijst in `index.html` precies de eager modulegraaf is (statische imports; dynamische `import()`-randen zoals `excel-export.js` horen er niet bij, maar staan wel in `SHELL`), dat de preloads na de stijlbladen staan en dat er enkel een preconnect is voor de hosten die de opstart gebruikt; `tests/sw-strategie.test.mjs` bewaakt de beslislogica.

Aanvullingen (finale fix B):
- Cache-modus per client: valt een navigatie (of een submodule) op de cache terug, na een time-out of een netwerkfout, dan komen alle verdere shell-verzoeken van die client uit de cache zolang de client leeft (`resultingClientId`/`clientId`; begrensd tot 50 clients; een SW-herstart wist dit, dan geldt nog de globale 60 s). Zo mengt een module nooit met een `index.html` van een andere versie.
- Installatie: CDN-URL's die al in `blitz-extern-v1` staan worden niet opnieuw opgehaald (ze zijn op versie vastgepind); `CDN_LUI` (URL's die niet vooraf worden opgehaald) is leeg: ExcelJS (258 kB gzip) wordt weer vooraf opgehaald, één keer per toestel, zodat de eerste Excel-export offline werkt. Wijzigt `CDN_VAST` van versie, verhoog dan `EXTERN_CACHE` of ruim de oude sleutels op (zie de release-checklist).
- De SW wordt geregistreerd na de `load`-gebeurtenis (`app.js`), zodat de installatie niet met de eerste laad concurreert.
- Subresources hebben bewust geen time-out (`subTimeoutMs = 0`): komt `index.html` binnen 4 s en stokt daarna een module, dan blijft de app wachten in plaats van te mengen met een andere versie.
