# Design-system-audit Blitz Planning (alleen analyse, niets gewijzigd)

Peildatum code: main @ 50c69cc (v1.6.0). Cijfers komen uit grep-tellingen op `public/index.html` (5952 regels), `public/css/*.css` (1487 regels) en `public/js/*.js`. Regelnummers kunnen na wijzigingen schuiven.

## Kerncijfers

| Categorie | Cijfer |
|---|---|
| Kleurtokens gedefinieerd | 27 in `:root` (`css/base.css`), 8 herdefinities voor licht thema |
| Gebruik van tokens (`var(--...)`) | ca. 720x over alle bestanden |
| Hardcoded hex-kleuren buiten `:root` | 21 in app.css, 4 in wizard.css, 55 in index.html, 41 in rapport-wizard.js, 1 in rapport-archief.js (ca. 122; waarvan ca. 60 bewust: mail-sjabloon + afdrukrapport) |
| Hardcoded `rgba(...)` | 57 in app.css, 3 in wizard.css, 12 in base.css, 6 in index.html |
| Inline `style="` | 130 in index.html, 54 in rapport-wizard.js, 22 in rapport-archief.js, 1 in inventaris.js (ca. 207) |
| Unieke `font-size`-waarden | 59 (263x rem, 20x px, 21x pt, 3x em) |
| Unieke `padding`-combinaties | ca. 120 |
| Unieke `border-radius`-waarden | 16 (incl. `--r`, `--r-lg`) |
| Unieke `box-shadow`-varianten | ca. 25 |
| Media queries | 7 (in CSS), waarden 600 / 680 / 1023 |
| Emoji/symbolen als icoon | ca. 324 tekens, 54 verschillende; inline SVG slechts 3 |

---

## A. Wat al goed/consistent is (behouden)

1. **Tokenbasis bestaat en wordt veel gebruikt.** Oppervlakken en tekst (`--bg`, `--surface`, `--surface2`, `--surface3`, `--border`, `--text`, `--text2`, `--muted`) staan in `css/base.css`. `var(--border)` wordt 130x gebruikt, `--muted` 125x, `--accent` 95x, `--r` 58x.
2. **Eén themaknop-mechanisme.** Licht thema loopt via `:root[data-theme="light"]`, plus `meta theme-color` dat mee wisselt (index.html:20, 5940). Geen wildgroei aan themaklassen.
3. **Semantische kleuren met "-dim"-variant.** `--red/--red-dim`, `--orange/--orange-dim`, `--blue/--blue-dim`, `--green/--green-dim`. Die zijn de goede basis voor badges, en `.prtag`, `.mtag`, `.month-chip` gebruiken ze grotendeels al.
4. **Radius-token voor knoppen en velden.** `var(--r)` (8px) is de duidelijke standaard (58x); `--r-lg` (12px) voor modals.
5. **Gedeelde modal-structuur.** `.overlay` + `.modal` + `.mhdr` + `.mhdr-close` + `.mbody` hergebruikt door 11 modals (det, reschedule, settings, block, import, prijs, manueel, result...). Modals verschillen enkel in `max-width` en uitlijning via ID-regels.
6. **Beweging is uniform.** Twee easing-tokens (`--ease`, `--ease-spring`) en vaste hover-taal (`translateY(-1px)`, `scale(1.05)`).
7. **Eén font-familie.** Inter (400-700), `font-family: inherit` op knoppen/velden (38x). Monospace enkel voor ticketnummers.
8. **Toast-z-index bewust gekozen.** `#toast` (10000) boven `.overlay` (9999), met uitleg in de comment (app.css:790).
9. **Aparte, bewust lichte styling voor afdrukrapport en mail.** Hardcoded kleuren in `rapport-wizard.js:966-998` en `index.html:5368-5404` zijn hier terecht, want een PDF/mail moet los van het app-thema wit zijn.
10. **Tikdoelen 44px** zijn al doorgevoerd op de wizard-knoppen en `.cal-btn` (5 `min-height: 44px`-regels).
11. **Kalender-lagen (z-index 27/28/30)** vormen een logisch sticky-systeem (topbar 30, kolomkoppen 28, pending 27).

---

## B. Inconsistenties per categorie

Ernst = hoe zichtbaar voor gebruiker. Moeite: S = < 1 uur, M = enkele uren, L = dag(en) of risico op regressies.

### B1. Kleur

| # | Probleem | Cijfers / voorbeelden | Ernst | Moeite |
|---|---|---|---|---|
| K1 | **Licht thema herdefinieert de merkkleuren niet.** Alleen surfaces, tekst en `-dim`-varianten worden aangepast. `--accent` (#00dfa3), `--accent-hover`, `--red`, `--orange`, `--blue`, `--green` blijven op de donkere-thema-waarden. Mintgroen tekst op wit is ca. 1.6:1 contrast. | `color: var(--accent)` 37x als tekstkleur (bv. `.set-subtab.active`, `.av-radio-btn.active`, `.tab.active .badge`, `.wiz-tag-filter.active`). Oranje `#f59e0b` als tekst op wit is ca. 2:1. | **Hoog** | M |
| K2 | **Wit op mintgroen (onleesbaar in beide thema's).** Knoppen met `background: var(--accent); color: #fff`, terwijl de rest van de app `#000` gebruikt. | app.css:549 `.av-add-btn`, app.css:582 `.rapp-filter-btn.active`, index.html:1659 (inline `color:#000` daar wel goed). 6x `color:#fff` in totaal. Ook `.pill-count` (wit op oranje, app.css:287). | **Hoog** | S |
| K3 | **Schaduwen en gloed met hardgecodeerde merkkleur/zwart.** `rgba(0,223,163,...)` 22x, `rgba(0,0,0,...)` in tientallen schaduwen. Donkere schaduwen (0.5-0.7) zijn te zwaar in licht thema. | app.css:32 header-schaduw, app.css:73 `.person-menu`, app.css:674 `.modal`, app.css:792 `#toast`, app.css:259 `.btn-add:hover` | Middel | M |
| K4 | **Dezelfde "rood" in 6 schrijfwijzen.** `var(--red)` #ff5a52, `rgba(248,81,73,...)` (15x, andere rode tint dan `--red`), `rgba(255,90,90,..)`, `rgba(255,80,80,..)`, `#f55`, `#ef4444`. | app.css:226-227 `.ticket.overdue`, app.css:244 `.taddr.miss`, app.css:409, app.css:516 `.kb-chip` (`#f55`), wizard.css:133 `.wiz-part-del:hover` (`#ef4444`) | Middel | S |
| K5 | **Paars en amber zonder token.** Paars `#7c5cfc` / `rgba(124,92,252,..)` 9x (lokale afspraken, route-stop, wegwerk `#a855f7`); amber `#d97706`/`rgba(251,191,36,..)`/`#facc15` 8x (feestdag, drukte). | app.css:368-370, 410, 477; index.html:3697-3699, 4296-4302 | Middel | S |
| K6 | **Hardcoded `#f59e0b` in plaats van `--orange`.** 5x, waarvan 2 inline waarschuwingstekst. | index.html:462, 465, 721 (`routeKleur`), 4400, 4533 | Laag | S |
| K7 | **Witte achtergronden hardcoded in de app-UI (niet in print).** Handtekening-canvas (bewust wit: pen op wit), maar ook lege-staat/preview. | wizard.css:144 `background:#fff`, wizard.css:153 `color:#bbb`, rapport-wizard.js:853 `background:#fff` (iframe-preview, bewust), rapport-archief.js:190 | Laag (grotendeels bewust) | S |
| K8 | **Zwarte tekst op accentknoppen is 11x hardcoded `#000`.** Werkt, maar hoort een token (`--on-accent`). Prijzen gebruikt `var(--bg)` (`.btn-dirty`, prijzen.css:101), dus zwart in licht thema maar `#181e24` in donker: al inconsistent. | app.css:94, 249, 343, 393, 565, 603, 719, 851; wizard.css:46 | Laag | S |
| K9 | **Inline kleuren in JS-templates.** 8 inline `style="...background:#..."` in index.html; 41 hex in rapport-wizard.js (waarvan ca. 38 in print-CSS, bewust). | index.html:1139 (`.atag` inline kleur), 3697, 4533 | Middel | M |
| K10 | Ontbrekend: geen `--yellow/--purple`, geen `--on-accent`, geen schaduwtokens, geen tekstkleur "op gekleurd vlak". | (zie C) | – | – |

### B2. Knoppen

Knopklassen (bestaan naast elkaar): `.btn-primary`, `.btn-save`, `.btn-autoplan`, `.btn-wiz-next`, `.av-add-btn` (alle "primair": vijf verschillende definities), `.btn-sec`, `.btn-cancel`, `.btn-wiz-back`, `.foto-add-btn`, `.prijs-add-btn` (alle "secundair/ghost"), `.btn-add`, `.btn-rem` (rond 30px), `.hbtn` (32px vierkant), `.sico`, `.mhdr-close`, `.wiz-close`, `.prijs-hdr-close`, `.inv-qty-btn`, `.inv-bell-btn`, `.kal-nav`, `.cal-btn`, `.day-btn`, `.day-block-btn`, `.kb-add-btn`, `.kb-btn-clear`, `.outbox-item-btn`, `.kal-view-btn`, `.set-subtab`, `.person-btn`. Ca. 30 knopklassen, 106 `<button>` in index.html + 22 in JS; 6 zonder klasse.

| # | Probleem | Cijfers / voorbeelden | Ernst | Moeite |
|---|---|---|---|---|
| B1 | **Vijf primaire knoppen met verschillende maten.** Padding 7x14 (`.btn-primary`, font 0.8rem/700), 7x16 (`.btn-save`, 0.82rem/700), 10x20 met min-height 44 (`.btn-wiz-next`, 0.83rem/**800**), 6x18 (`.av-add-btn`), `.btn-autoplan`. Gebruiker ziet Opslaan-knoppen van andere hoogte per scherm. | app.css:564, 718, 342, 549; wizard.css:45 | Middel | M |
| B2 | **Drie secundaire knoppen** (`.btn-sec` 7x12/0.8rem/500, `.btn-cancel` 7x14/0.82rem/geen weight, `.btn-wiz-back` 10x16/muted/600). Hover-effect verschilt: `.btn-wiz-*` heeft geen `translateY(-1px)`. | app.css:574, 711; wizard.css:38 | Middel | S |
| B3 | **Losse inline knopstijlen.** 21 `<button ... style="...">` (waarvan 8 met eigen padding/font/radius); herhaald: `font-size:0.75rem;padding:5px 10px` (7x) en `padding:3px 8px ... border-radius:4px`. | index.html:142 (filterknoppen), 1659 (kopie van accentknop met 4px radius), + js-templates | Middel | M |
| B4 | **Radius 4px/6px/20px/50% op knoppen naast `--r` (8px).** `.kb-add-btn`, `.kb-btn-clear` 4px; `.av-radio-btn` 20px; `.btn-add/.btn-rem` 50%. | app.css:519, 522, 541 | Laag | S |
| B5 | **Geen gevaar-variant.** Rood komt als: `.btn-rem` (gevuld), `.outbox-item-btn-cancel` (outline), inline `color:var(--red);border-color:var(--red)` (2x), `.wiz-part-del:hover`. | app.css:262, 846 | Middel | S |
| B6 | **Hoogtes niet consistent en klein.** Standaardknoppen ca. 30-32px hoog; alleen 5 regels met `min-height: 44px` (`.cal-btn`, wizard). `.mhdr-close` 28px, `.foto-thumb-del` <20px, `.btn-add` 30px. Voor technieker op tablet/mobiel te klein. | app.css:44-45, 271; `.kb-add-btn` padding 2x8 (= ca. 22px hoog) | **Hoog** (mobiel) | M |
| B7 | Disabled-stijlen verschillen (opacity 0.3 / 0.4); slechts 4 `:disabled`-regels in app.css, 0 in wizard/prijzen/inventaris. | app.css:261, 271, 352, 573 | Laag | S |
| B8 | Focus: 13 `:focus`-regels, meestal `outline:none` + randkleur; `:focus-visible` voor knoppen ontbreekt (toetsenbordbediening). | app.css:507, 563; wizard.css:65, 73 | Middel | S |

### B3. Typografie

- Familie: alleen Inter + `inherit` (goed). Uitzonderingen: `monospace` (2x), `'SF Mono','Consolas',monospace` (3x, niet consistent met de 2x kale `monospace`); Arial in print/mail (bewust).
- **59 unieke font-sizes.** Top: 0.82rem (28x), 0.8rem (27x), 0.75rem (25x), 0.72rem (24x), 0.85rem (22x), 0.78rem (21x), 0.68rem (14x). Daarnaast een stoet quasi-duplicaten binnen 0.01-0.02rem: 0.59 / 0.6 / 0.62 / 0.63 / 0.64 / 0.65 / 0.66 / 0.67 / 0.68 / 0.69 / 0.7 / 0.71 / 0.72 / 0.73 / 0.74 / 0.75 / 0.76 / 0.77 / 0.78 / 0.79 / 0.8 / 0.81 / 0.82 / 0.83 / 0.84 / 0.85 / 0.87 / 0.875 / 0.88 (**ca. 30 waarden tussen 0.59 en 0.9rem**), voor het oog niet te onderscheiden. Ernst Middel, moeite M.
- Eenheden: 263x rem, 20x px (mail/print/inline zoals index.html:5371), 21x pt (alleen print, bewust), 3x em (`0.85em`, `0.75em`). Px in de app-UI: `font-size:16px/12px/13px/15px/10px` (ca. 15x): breekt met browser-tekstschaal. Laag-Middel, S.
- Kleinste teksten: 0.59-0.65rem (= 9,5-10,4px), 17x. Onder de leesbaarheidsgrens op tablet/mobiel, bv. `.cal-local-type` 0.59rem (app.css:480), `.mtag/.atag/.prtag` 0.64rem. **Hoog** voor technieker op mobiel, moeite S-M.
- Weights: 600 (55x), 700 (38x), 500 (13x), **800 (7x) en 900 (2x)**, 400 (2x). Google Fonts laadt enkel Inter 400/500/600/700 (index.html:13): 800/900 worden dus door de browser afgerond naar 700 of nep-vet gemaakt. Bv. `.btn-wiz-next` 800, `.wiz-step-title` 800. Middel, S.

### B4. Spacing, radius, schaduw, z-index

- **Spacing:** geen schaal. Ca. 120 unieke padding-combinaties (top: `2px 8px` 8x, `5px 10px` 7x, `3px 6px` 7x, `8px 14px` 6x, `4px 7px` 6x, `10px 14px` 5x...). Gap: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 20px (14 waarden, 8px 26x en 6px 26x zijn de baseline). Margins idem (2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15px). Odd-values 5/7/9/11/13px zijn typisch "op het oog" gekozen. Ernst Laag (zichtbaar als ritmeverschil), moeite L om te vereenvoudigen.
- **Radius:** `var(--r)` 58x, `4px` 18x, `20px` 14x (pills), `50%` 13x, `6px` 10x, `--r-lg` 7x, `12px` 5x (letterlijk gelijk aan `--r-lg`), 3px 4x, 8px 3x (letterlijk gelijk aan `--r`), 7px 2x, 10px 2x, 5/2/24/16px. Ernst Laag-Middel, moeite S.
- **Schaduw:** ca. 25 varianten; 11 met accentgloed in eigen dekking (0.2/0.25/0.3/0.35/0.38/0.4), 8 zwart met eigen blur/dekking. Copy-paste bug: `.btn-save:active` en `.btn-autoplan`-varianten gebruiken oranje `rgba(245,158,11,0.2)` als active-schaduw op groene knop (app.css:725). Laag, S.
- **z-index:** waarden 0, 1, 26?, 27, 28, 30, 110, 200, 1000, 9999, 10000.
  - **Conflict:** `#prijs-overlay { z-index: 110 }` (prijzen.css:2) is lager dan `#rapport-wizard` (1000, wizard.css:4) en gebruikt een andere schaal dan `.overlay` (9999). Wordt de prijsmodal vanuit of boven de wizard geopend, dan verdwijnt hij eronder. Ook `.person-menu` (200) ligt onder `.overlay` maar boven de topbar (30) zonder duidelijke regel. Middel, S.
  - Er is geen centrale lijst (base, sticky, dropdown, wizard, modal, toast). Moeite S.

### B5. Breakpoints

- CSS: `max-width: 1023px` (4x, app.css:459, 879, 904, 920), `min-width: 600px` (2x, app.css:663, 673), `max-width: 680px` (1x, app.css:870).
- JS: `window.matchMedia('(max-width: 1023px)')` (index.html:838, 4591) en `window.innerWidth >= 1024` (1696, 1757), `> 680` (3721, 3766).
- Drie verschillende grenzen (600 / 680 / 1023-1024) voor "mobiel". 600 en 680 liggen 80px van elkaar: tussen 600 en 680 is de modal gecentreerd maar de planning-kolomstapeling nog niet actief. Boven 1023 vs `>= 1024`: consistent, maar de waarde staat 6x als losse getal in JS en CSS (geen gedeelde constante). `.overlay` bottom-sheet/centered omslag op 600, terwijl de rest op 1023 draait. Middel, M.

### B6. Componenten die net anders zijn gebouwd

| Component | Varianten | Ernst | Moeite |
|---|---|---|---|
| **Badges/pills** | `.atag`, `.prtag`, `.mtag` (identiek: 0.64rem / 2x7-8 / 20px), `.month-chip` (0.62rem / 2x5 / 3px), `.kb-chip` (0.75rem / 2x7 / 12px, `#f55`), `.badge` (tabteller), `.kal-pending-pill`, `.pill-count`, `.cal-local-type` (0.59rem), inline gekleurde spans (index.html:1139). 8+ varianten met 3 radius-keuzes. | Middel | M |
| **Modals** | Gedeelde basis goed, maar: eigen padding per modal (`#result-modal` padding 22px, prijs `padding:0`), `max-width` 360/400/460/480/520/600, uitlijning per ID (`align-items: center/flex-start` in 5 ID-regels), `.mhdr` (18x20) vs `.prijs-hdr` (16x20) vs `.wiz-hdr` (13x18) voor identiek doel; drie sluitknoppen (`.mhdr-close` 28px, `.prijs-hdr-close`, `.wiz-close`). | Middel | M |
| **Toast** | Eén `#toast` (goed), maar geen varianten (succes/fout) en `white-space: nowrap` op smalle schermen; foutmeldingen lopen deels via `alert`/inline tekst. | Laag | S |
| **Invoervelden** | `.man-input/.man-select` (8px radius, geen focusring), `.wiz-input/.wiz-textarea` (focusring 3px accent-dim), `.plan-header input[type=date]`, `.inv-export-toolbar input[type=date]`, `.av-time-input`, `.prijs-prijs-input`; van 104 `<input/select/textarea>` in HTML/JS hebben 15 inline `style`. Geen gedeelde `.input`-klasse: focus, hoogte en padding wisselen (6x10 / 9x12 / 10x12). | **Middel-Hoog** (dagelijks in wizard) | M |
| **Kaarten** | `.ticket`, `.day-col`, `.stop`, `.wiz-radio-card`, `.info-cell`, `#result-modal`: elk eigen padding (10-14px), radius (`--r` / 6 / 4px), randkleur. Geen basis-`.card`. | Laag-Middel | M |
| **Tabs** | `.tab` (hoofd, underline via `::after`), `.set-subtab` (eigen underline, `border-bottom`), `.kal-view-btn` (segmented), `.wiz-tag-filter` en `.day-btn` (chips). Actieve stand: `color: var(--text)` vs `var(--accent)` vs achtergrond `--surface3`: 3 actieve-stijlen voor "geselecteerd". | Middel | M |
| **Chip-toggles** | `.av-radio-btn`, `.day-btn`, `.wiz-tag-filter`, `.rapp-filter-btn.active`: allemaal "geselecteerd = accent-dim + accent-rand", behalve `.rapp-filter-btn.active` (vol accent + wit, zie K2). | Middel | S |

### B7. Iconen

- Bijna alles is emoji/unicode-tekst: ca. 324 tekens, 54 verschillende (top: ⚠ 62x, → 37x, ✓ 32x, ❌ 28x, ✕ 24x, ✅ 14x, 🔒 9x, 🕐 8x, ✉ 7x, 📋 6x, ➕ 5x, 📨 5x). Inline SVG: alleen logo (index.html:34), mail (index.html:5363) en rapport (rapport-wizard.js:958).
- Inconsistenties: drie sluit/verwijder-tekens (`✕`, `❌`, `×`), drie vinkjes (`✓`, `✅`, `✔`); `⚠` (tekstglyph, kleurt mee) naast `⚠️` (emoji, vaste kleur). Emoji renderen anders per apparaat (Android / iOS / Windows), kleuren volgen het thema niet, en `❌`/`✅` zijn fel gekleurd in beide thema's. Ernst Middel (zichtbaar verschil per toestel), moeite L (324 plekken) — enkel de top-10 vervangen is M.

---

## C. Voorstel: minimale set om naartoe te consolideren

### C1. Kleurtokens (in `base.css`, per thema definiëren)

```
Oppervlak/tekst (blijft): --bg --surface --surface2 --surface3 --border --text --text2 --muted
Merk:   --accent  --accent-hover  --accent-dim  --accent-glow  --on-accent (#000 / #000)
Status: --red --orange --blue --green + elk een -dim   (LICHT thema: donkerdere waarden, bv.
        --accent #00a37a, --orange #b45309, --red #dc2626, --blue #2563eb, --green #059669, zodat >= 4.5:1)
Nieuw:  --purple + --purple-dim (lokale afspraak/route), --yellow + --yellow-dim (feestdag)
Rand:   --red-line, --orange-line, --accent-line (30%-dekking varianten voor borders)
Print/mail blijven buiten het systeem (bewust lichte vaste kleuren).
```
Alle `rgba(248,81,73,...)`, `#f55`, `#ef4444`, `rgba(255,90,90,..)` -> `--red` / `--red-dim` / `--red-line`. `color:#000` op accent -> `--on-accent`. `#fff` op `--accent` -> `--on-accent`.

### C2. Tekstgroottes (7 stappen, alle in rem)

```
--fs-2xs 0.7rem   (kleinste badge/hulptekst; nooit kleiner)
--fs-xs  0.75rem  (meta, tags, chips)
--fs-sm  0.82rem  (knoppen, velden, lijsten) = huidige "standaard"
--fs-md  0.9rem   (kaarttitels, invoer op mobiel >= 16px via aparte regel)
--fs-lg  1rem     (modaltitel)
--fs-xl  1.3rem   (schermtitel)
--fs-2xl 2rem     (grote cijfers/leeg-staat)
```
Gewichten: 400, 500, 600, 700 (800/900 vervangen door 700 of Inter 800 laden). Inputs op mobiel 16px (voorkomt iOS-zoom).

### C3. Spacing en radius

```
Spacing (4px-basis): --sp-1 4px, --sp-2 8px, --sp-3 12px, --sp-4 16px, --sp-5 24px, --sp-6 32px
   (zorgt dat 5/6/7/9/10/11/13/14px afgerond wordt naar 4/8/12/16)
Radius: --r-sm 6px (chips/kleine knop, vervangt 3/4/5/6/7px), --r 8px (knop/veld/kaart),
        --r-lg 12px (modal, vervangt 10/12/16px), --r-pill 999px (badges, vervangt 20/24px), 50% blijft
Schaduw: --shadow-sm (0 1px 3px), --shadow-md (0 4px 12px), --shadow-lg (0 20px 60px), --glow-accent
   (met themavariabele voor dekking: donker 0.5, licht 0.12)
```

### C4. z-index-schaal

```
--z-sticky 30 | --z-dropdown 200 | --z-wizard 1000 | --z-modal 9000 | --z-toast 10000
```
Alle modals (ook `#prijs-overlay`) op `--z-modal`; wizard blijft eronder.

### C5. Breakpoints
Eén set: `--bp-mobile` 600 (bottom-sheet/centered modal), `--bp-tablet` 1024 (technieker vs coordinator). 680 laten vallen (naar 600 of 1024). In JS één constante `const BP_DESKTOP = 1024` (nu 6 losse getallen). Let op: CSS-variabelen werken niet in media queries, dus dit blijft een afspraak/constante.

### C6. Knopvarianten (klassen)

```
.btn                     basis: hoogte 36px (44px op < 1024px), padding 0 var(--sp-3..4), --r, --fs-sm, 600
.btn--primary            accent + --on-accent           (vervangt .btn-primary/.btn-save/.btn-wiz-next/.btn-autoplan/.av-add-btn)
.btn--secondary          outline, --text2               (vervangt .btn-sec/.btn-cancel/.btn-wiz-back/.foto-add-btn)
.btn--danger             --red (outline; gevuld voor bevestiging)   (vervangt .btn-rem, .outbox-item-btn-cancel, inline rood)
.btn--ghost              transparant, geen rand         (vervangt .kb-btn-clear/.prijs-del-btn)
.btn--sm                 hoogte 28px, --fs-xs           (vervangt inline `font-size:0.75rem;padding:5px 10px`)
.btn-icon (32/44px)      vervangt .hbtn/.mhdr-close/.sico/.wiz-close/.prijs-hdr-close
.chip / .chip.is-active  vervangt .av-radio-btn/.day-btn/.wiz-tag-filter/.rapp-filter-btn
```
Oude klassenamen tijdelijk als alias behouden (`.btn-save { @extend }`-achtig: gewoon dezelfde selector in één regel) zodat HTML/JS-templates niet ineens alle aangepast hoeven.

Overige gedeelde componenten: `.badge` (één maat, kleurmodifiers `--red/--orange/--blue/--green/--purple`), `.input` (hoogte, focusring, 16px op mobiel), `.card`, `.modal--sm/--md/--lg` (360/480/600).

### C7. Realistische volgorde (elke stap apart deploybaar, laag risico eerst)

1. **Contrastbugs eerst (S, 1-2 uur):** `#fff` op accent -> `#000` (app.css:549, 582, 287); dan visueel controleren in beide thema's. Direct zichtbaar effect, minimaal risico.
2. **Licht thema volledig maken (M):** eigen `--accent`, `--red`, `--orange`, `--blue`, `--green` (+ hover) in `:root[data-theme="light"]`; `--on-accent` invoeren. Enkel `base.css` wijzigt; controleer daarna 37 accent-tekstplekken.
3. **Nieuwe tokens toevoegen zonder iets te vervangen (S):** `--purple`, `--yellow`, `--red-line`, `--z-*`, `--sp-*`, `--fs-*`, `--r-sm`, `--shadow-*`. Nog geen zichtbare wijziging.
4. **Kleurdubbels vervangen (S-M):** de 15+ rode `rgba`-varianten, `#f55`, `#ef4444`, `#f59e0b`, paars/amber in app.css en wizard.css (geen JS). Per bestand, met vergelijking van screenshots.
5. **z-index en font-weight (S):** prijs-overlay op modalniveau, 800/900 -> 700, ontbrekende `:focus-visible` toevoegen.
6. **Knoppen samenvoegen (M-L):** eerst `.btn`-basis + varianten toevoegen naast bestaande klassen; migreer per scherm (wizard, dan modals, dan kalender); verwijder oude klassen pas als een grep 0 gebruik toont. Inline knopstijlen (21x) meenemen bij het scherm waar ze staan.
7. **Typografie schalen (M):** in app.css de ca. 30 nabije waarden naar 7 stappen afronden (zoek/vervang per waarde, kleinste naar `--fs-2xs`); px in de UI naar rem. Daarna visueel nalopen (tekstbreedtes in kalender/lijst kunnen verspringen).
8. **Badges, invoervelden, tabs, modals harmoniseren (M):** één `.badge`, één `.input`, modalbreedtes via `.modal--sm/md/lg`.
9. **Spacing/radius opruimen (L, laatst en optioneel):** enkel nieuwe code en aangeraakte componenten op de schaal; geen bulk-zoek-en-vervang, want 120 padding-varianten = hoog regressierisico voor beperkte winst.
10. **Iconen (L, apart traject):** eerst de 6 meest voorkomende (`⚠ ✓ ✕ ❌ ✅ →`) vervangen door één SVG-set (bv. 10 inline SVG's met `currentColor`), rest later.
11. **Inline `style=` in JS-templates (L):** doorlopend meenemen bij stappen 6-8; niet apart uitvoeren.

Elke stap: versie-PATCH, testen in donker én licht, testen op smalle viewport (< 600, 600-1023, >= 1024), Service Worker-cache verversen (bekende valkuil uit het projectgeheugen).

## Prioriteitenoverzicht (Hoog eerst)

1. K1 licht thema mist merkkleuren (contrast) — Hoog / M
2. K2 wit op mintgroen knoppen — Hoog / S
3. B6 knoppen te klein voor touch (< 44px) — Hoog / M
4. Teksten kleiner dan 0.65rem (17x) — Hoog op mobiel / S-M
5. 5 primaire + 3 secundaire knopdefinities — Middel / M
6. 59 font-sizes, 800/900 weight zonder geladen font — Middel / M
7. Prijs-overlay z-index 110 onder wizard 1000 — Middel / S
8. Iconen: 324 emoji, 3 sluit-/vinktekens — Middel / L
