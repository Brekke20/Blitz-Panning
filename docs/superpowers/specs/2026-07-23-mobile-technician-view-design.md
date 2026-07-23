# Mobiele technieker-weergave (device-based UI restrictie)

**Datum:** 2026-07-23
**Status:** Approved, ready for implementation plan

## Aanleiding

De app wordt gebruikt door twee rollen die andere dingen nodig hebben:
- **Coördinator (Brent), op PC:** plant tickets in (Wachtrij), berekent routes (Route-tab), beheert klantvoorkeuren/beschikbaarheid, stuurt afspraakvoorstellen, exporteert rapporten (Rapporten-tab), beheert instellingen/prijzen.
- **Technieker, op telefoon/tablet in het veld:** wil enkel zien wat er gepland staat (Kalender + Ingepland) en ter plekke kunnen bellen/mailen/navigeren, aankomst registreren, het service-rapport invullen, en een oplossing noteren.

Vandaag toont de app op elk toestel exact dezelfde, volledige interface — inclusief planningsfunctionaliteit die een technieker niet nodig heeft en die de interface "druk" maakt op een klein scherm (zie ook de bredere UX-evaluatie eerder in dit gesprek: dezelfde acties komen nu op meerdere plekken in verschillende vormen terug, en het detail-modaal toont altijd coördinator-input zoals klantbeschikbaarheid).

Dit ontwerp beperkt zich tot **zichtbaarheid op basis van schermbreedte** — geen wijziging aan hoe planning/route/rapportage zelf werkt, geen login- of rollensysteem.

## Mechanisme

- **Breekpunt: schermbreedte < 1024px → beperkte weergave. ≥ 1024px → volledige weergave.** Puur CSS (`@media (max-width: 1023px)`), geen JS-detectie voor de weergave zelf.
- Alle te verbergen elementen krijgen een `desktop-only`-klasse. Eén regel verbergt ze allemaal:
  ```css
  @media (max-width: 1023px) {
    .desktop-only { display: none !important; }
  }
  ```
  De `!important` is nodig omdat een aantal van deze elementen ook via inline `style.display` door JS aan/uit gezet worden (bv. de plan-knoppen in het detail-modaal, afhankelijk van ticketstatus) — de media query moet daar altijd overheen kunnen.
- **Resize-vangnet:** als de actieve tab Wachtrij/Route/Rapporten is op het moment dat het venster onder 1024px zakt, schakel automatisch naar Kalender. Geïmplementeerd met een `matchMedia('(max-width: 1023px)')`-listener die, bij het kruisen van de grens naar smal, checkt of `document.querySelector('.tab.active')` een `desktop-only`-tab is en zo ja `setTab('kalender')` aanroept. Geen vangnet nodig in de andere richting (venster breder maken toont gewoon weer alle tabs; er is niets fout aan de huidige tab die dan zichtbaar wordt).
- Geen wijziging aan `blitz_active_person`/identiteit-mechanisme — een technieker-toestel heeft al zijn eigen naam ingesteld (bestaande functionaliteit), dat blijft de basis.

## Wat krijgt de `desktop-only`-klasse

**Tab-balk** (`public/index.html` rond regel 1229-1235):
- Tab "Wachtrij" (`#tab-tickets`)
- Tab "Route" (`#tab-planning`)
- Tab "Rapporten" (`#tab-rapporten`)
- (Kalender en Ingepland blijven altijd zichtbaar)

**Header** (rond regel 1226):
- ⚙️ Instellingen-knop (`onclick="openSettings()"`)

**Persoon-kiezer** (`buildPersonSelector()`, rond regel 1928-1933):
- De "Alle technici" (`allItem`)-optie in het dropdown-menu krijgt de klasse bij aanmaak in JS. Enkel de eigen-naam-opties blijven bruikbaar op mobiel.

**Kalender-tab, per dag** (`renderKalender()`, rond regel 2253-2336):
- De dagcapaciteit/status-badge (`.day-cap`, regel 2253) — toont vandaag ook holiday-naam en "Geblokkeerd"-status; die info verdwijnt mee op mobiel, wat een bewuste keuze is (matcht exact wat gevraagd werd: "dagcapaciteit-badges" weg).
- De "⏱ Beschikbaar / 🔒 Geblokkeerd"-knop (`.day-block-btn`, regel 2254-2256)
- De "Route berekenen"-knop per dag (dynamisch aangemaakte `rb`-button, regel 2327-2336) — klasse toevoegen bij aanmaak in JS

**Detail-modaal** (rond regel 1327-1336):
- De volledige Klantbeschikbaarheid-sectie (`#kb-section`, regel 1327)
- De plan-toggle-knop (`#d-plan-btn`, regel 1331) — "+ Voeg toe aan planning" / "✕ Verwijder uit planning"
- De "📨 Voorstel"-knop (`#d-btn-proposal`, regel 1334)

## Wat blijft zichtbaar op mobiel

- **Tabs:** Kalender (zonder de coördinator-chrome hierboven — toont enkel de geplande stops per dag, klikbaar naar het detail-modaal) en Ingepland (ongewijzigd, was al een eenvoudige lijst).
- **Detail-modaal:** Klantgegevens-sectie met klikbare `tel:`/`mailto:`/Google Maps-links (ongewijzigd), Ticketdetails-sectie (ongewijzigd), footer-knoppen Sluiten / ✏️ Oplossing / ⏱️ Aankomst / 📋 Rapport.
- **Rapport-wizard:** volledig ongewijzigd en bruikbaar — dit is een apart modaal (niet aan een tab gebonden), dus niet geraakt door het verbergen van de Rapporten-tab.
- **Header:** logo, persoon-kiezer (met beperkte opties, zie boven), 🔄 Vernieuwen, 🌙/☀️ thema-schakelaar.

## Niet in scope

- De icoon-only knoppenrij in de Route-tab (🧭📨⏱️📋✏️✕ zonder labels) — die tab verdwijnt sowieso op mobiel; het probleem blijft bestaan op PC en is een apart, later punt.
- Geen wijziging aan route-/planningslogica, enkel zichtbaarheid.
- Geen login- of rollensysteem — blijft gebaseerd op de bestaande per-toestel `blitz_active_person`-instelling.
- Geen aparte behandeling van de holiday-naam/geblokkeerd-status los van de capaciteit-badge (zie hierboven) — die verdwijnen samen.

## Edge cases

- **Ticket met status "Wachten op bevestiging planning" geopend op mobiel:** de plan-toggle-knop (die hier normaal "✕ Verwijder uit planning" zou tonen) is verborgen — een technieker kan een ticket dus niet per ongeluk uit de planning verwijderen vanaf zijn telefoon. Consistent met "echte aanpassingen gebeuren op de PC".
- **Venster-resize over de grens heen (alleen relevant op PC/laptop):** afgehandeld door het resize-vangnet hierboven.
- **Technieker-toestel met `blitz_active_person` nog op `'all'`** (nooit ingesteld): de "Alle technici"-optie is wel verborgen in het dropdown-menu, maar de header toont dan nog "Alle" totdat de technieker zijn eigen naam kiest uit de (nu beperkte) lijst — geen aparte afhandeling nodig, dit lost zichzelf op bij eerste gebruik.
