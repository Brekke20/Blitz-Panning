# Foto's: volledig Android-keuzemenu i.p.v. beperkte foto-picker

**Datum:** 2026-07-30
**Status:** Approved, ready for implementation

## Aanleiding

Brent kan vandaag enkel foto's uploaden vanuit de galerij/Google Foto's, niet rechtstreeks een foto nemen — hij verwacht op Android een volledig keuzemenu (Camera, Bestanden, Galerij, Google Foto's, ...).

**Uitgezocht:** de bestaande `<input type="file" accept="image/*" multiple>` (2x, gewoon foto-scherm + rapport-wizard) triggert op recente Android/Chrome-versies Google's beperkte "Foto's"-kiezer (enkel afbeeldingen uit Google Photos-stijl UI) i.p.v. het volledige, klassieke Android-keuzemenu met alle apps inclusief Camera. Dit is een gekend, bevestigd Chrome/Android-gedrag: het weglaten van de `accept="image/*"`-beperking laat Chrome terugvallen op het volledige systeemkeuzemenu.

## Wijziging

**Foto-scherm** (index.html:1588):
```html
<input type="file" id="foto-file-input" accept="image/*" multiple style="display:none" onchange="handleFotoFiles(this)">
```
wordt:
```html
<input type="file" id="foto-file-input" multiple style="display:none" onchange="handleFotoFiles(this)">
```

**Rapport-wizard-foto-scherm** (index.html:5624):
```html
<input type="file" id="wiz-foto-file-input" accept="image/*" multiple style="display:none" onchange="handleWizFotoFiles(this)">
```
wordt:
```html
<input type="file" id="wiz-foto-file-input" multiple style="display:none" onchange="handleWizFotoFiles(this)">
```

Geen andere wijzigingen nodig: `handleFotoFiles()`/`compressFotoFile()` verwerken elk gekozen bestand al individueel binnen een `try/catch` (index.html:4632-4639) — een per-ongeluk gekozen niet-afbeelding geeft nu al een duidelijke `❌ Foto verwerken mislukt`-toast voor dat ene bestand, zonder de rest van de actie te breken. Er is dus al voldoende bescherming tegen de bredere bestandskeuze die dit meebrengt.

## Niet in scope

- Geen aparte, gedwongen "camera-only"-knop — de volledige keuze (inclusief camera) via het systeemmenu is wat gevraagd werd.
