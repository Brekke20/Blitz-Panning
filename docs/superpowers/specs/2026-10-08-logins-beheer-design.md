# Logins en beheerderspagina — ontwerp

**Datum:** 2026-10-08
**Tak:** `refactor` (nieuwe functionaliteit; pas live bij de grote release)
**Status:** ontwerp goedgekeurd door Brent in chat (2026-10-08), spec ter review
**Volgorde:** deelproject 2 van 4 — na de rapport-upload-fix (v1.10.2, `main`), vóór de
sales-planner (`2026-10-08-sales-planner-design.md`) en het performance-dashboard
(`2026-10-08-performance-dashboard-design.md`), die allebei op dit project steunen.

## Doel

De app heeft vandaag geen logins: elke functie onder `/api/*` is open voor wie de URL kent, en
instellingen per technieker staan in de `localStorage` van het toestel. Met de sales-leads
(persoonsgegevens) en het dashboard erbij moet dat veranderen.

- Iedereen logt in met e-mail + wachtwoord; de server controleert bij elke actie wie je bent en
  wat je rol mag.
- Brent beheert gebruikers, instellingen, activiteitenlog en systeemstatus op één beheerpagina.

## Beslissingen (Brent, 2026-10-08)

| Onderwerp | Keuze |
|---|---|
| Inlogmethode | E-mail + wachtwoord; accounts aangemaakt door de beheerder |
| Systeem | **Eigen login in de app** (Netlify Functions + Blobs) — geen Netlify Identity (wordt afgebouwd), geen externe dienst |
| Rollen | Beheerder, Planner, Technieker, Sales |
| Technieker | Eigen planning standaard; collega's **alleen-lezen** |
| Sales | Enkel eigen sales-gedeelte; vinkje "mag alle sales zien" voor een sales-verantwoordelijke |
| Herstel beheerderswachtwoord | **Herstelcodes** (10 eenmalige) + **noodroute via Netlify** (tijdelijke omgevingsvariabele) |
| Beheerpagina | Gebruikers, instellingen centraal, Zoho-naam-koppeling, activiteitenlog, systeemstatus, performance-dashboard (apart deelproject) |

## Niet in scope

- Tweestapsverificatie, "wachtwoord vergeten" per mail (geen eigen mailsysteem).
- Microsoft-login (vermoedelijk dezelfde externe admin-goedkeuring als de verlaten Outlook-koppeling).
- De klantgerichte bevestigingspagina (`confirm-afspraak`, de link in de voorstelmail): blijft
  zonder login, beveiligd met de bestaande ondertekende link.

## Rollen en rechten

| Recht | Beheerder | Planner | Technieker | Sales |
|---|:-:|:-:|:-:|:-:|
| Tickets/planning van alle techniekers bekijken | ✔ | ✔ | ✔ (alleen-lezen) | – |
| Plannen, voorstellen sturen, annuleren, afspraken/verlof beheren | ✔ | ✔ | eigen afspraken/verlof | – |
| Rapport maken/versturen, foto's, stockverbruik | ✔ | ✔ | eigen tickets | – |
| Rapporten-tabblad, opnieuw versturen | ✔ | ✔ | eigen rapporten | – |
| Prijzen, inventaris beheren | ✔ | ✔ | – | – |
| Eigen sales-gedeelte | ✔ (iedereen) | – | – | ✔ (eigen; alle bij vinkje) |
| Beheerpagina, dashboard | ✔ | – | – | – |

"Eigen" voor een technieker = tickets waarvan de Zoho-toegewezen persoon gelijk is aan de
`zohoNaam` van zijn account. De exacte toewijzing per bestaande functie (welke `/api/*` welke rol
vereist) wordt in het bouwplan per functie vastgelegd, op basis van wat elke rol vandaag in de app
doet; het principe hierboven is bindend.

De **server** handhaaft de rechten (elke functie); de client verbergt bovendien knoppen die je
rol niet mag. Wat je mag hangt af van je rol; hoe het eruitziet blijft afhangen van je toestel
(gsm/tablet/computer, bestaande `apparaat.js`-logica).

## Opslag (Netlify Blobs, store `blitz-data`, `consistency: 'strong'`)

| Key | Inhoud |
|---|---|
| `gebruikers` | `{ versie, gebruikers: [Gebruiker] }` |
| `login-pogingen` | mislukte pogingen per e-mail / herstel, voor de vergrendeling |
| `instellingen` | `{ versie, perGebruiker: { [gebruikerId]: Instellingen } }` |
| `activiteit/<YYYY-MM>` | `{ versie, items: [Activiteit] }` — één blob per maand |
| `herstel-noodroute` | hash van de laatst gebruikte noodsleutel (zodat dezelfde sleutel niet twee keer werkt) |

```
Gebruiker {
  id, email (lowercase, uniek), naam,
  rol: 'beheerder' | 'planner' | 'technieker' | 'sales',
  actief: boolean,
  wachtwoordHash,            // scrypt (node:crypto), eigen salt, parameters in de hash-string
  moetWachtwoordWijzigen: boolean,
  sessieVersie: number,      // +1 bij blokkeren, wachtwoordwijziging, "overal uitloggen"
  zohoNaam?: string,         // technieker: naam van de Zoho-toegewezen persoon
  salesNaam?: string,        // sales: "verantwoordelijke" zoals in de export (bv. "Ward Houwen")
  magAlleSales?: boolean,
  herstelcodes?: [hash],     // enkel beheerder; gebruikte codes worden verwijderd
  aangemaakt, laatsteLogin
}
Instellingen {               // bestaande velden uit de huidige localStorage-instellingen, plus:
  startlocatie, werkdagen, werkuren, …,
  bezoekDuurMin?             // sales: standaardduur per bezoek (standaard 60)
}
Activiteit { op, gebruikerId, naam, actie, onderwerp?, details? }
```

## Sessies

- Na een geslaagde login zet de server een cookie `blitz_sessie`: een HMAC-SHA256-ondertekend
  token `{ uid, sv (sessieVersie), exp }` met geheim `SESSIE_GEHEIM` (Netlify-omgevingsvariabele).
  `HttpOnly; Secure; SameSite=Lax; Path=/`; geldig **30 dagen**, verlengd wanneer minder dan
  15 dagen resten.
- Gedeelde servermodule `netlify/lib/auth.js`:
  `vereisGebruiker(req, { rollen })` → leest cookie, controleert handtekening en vervaldatum, leest
  `gebruikers`, controleert `actief` en `sessieVersie`; anders `401`. Verkeerde rol → `403`.
  Omdat `gebruikers` bij elke aanroep gelezen wordt (klein bestand), werkt blokkeren **meteen**.
- **CSRF:** `SameSite=Lax` plus een verplichte header `X-Blitz: 1` op elke schrijvende aanroep
  (de client zet die centraal in `kern/api.js`; de service worker voor de rapport-outbox ook).
  Functies weigeren schrijfacties zonder die header.
- De client krijgt bij een `401` het inlogscherm; een openstaand rapport/concept gaat niet
  verloren (outbox en concept blijven lokaal bewaard en worden na het inloggen verstuurd).

## Wachtwoorden en vergrendeling

- Minimaal 10 tekens. Startwachtwoord door beheerder → `moetWachtwoordWijzigen: true` → bij de
  eerste login verplicht wijzigen.
- 5 mislukte pogingen per e-mail binnen 15 minuten → 15 minuten vergrendeld (ook voor herstel:
  5 pogingen → 1 uur). Foutmelding verraadt niet of een e-mailadres bestaat.
- Elke login, mislukte reeks, wachtwoordwijziging en herstel komt in het activiteitenlog.

## Eerste beheerder (bootstrap)

- Bestaat er nog geen enkele gebruiker, dan toont de app een eenmalig "Beheerder instellen"-scherm.
  Dat werkt enkel met de code uit de omgevingsvariabele `BEHEER_SETUP_CODE` (zodat niemand anders
  in dat korte venster het account kan claimen). Na aanmaak van het eerste account wordt het
  scherm nooit meer aangeboden, ook als de variabele blijft staan.
- Na het aanmaken toont de app **eenmalig 10 herstelcodes** (zie hieronder).

## Herstel beheerderswachtwoord

1. **Herstelcodes.** Bij aanmaak van een beheerdersaccount (en op aanvraag op de beheerpagina:
   "nieuwe codes maken", wat de oude ongeldig maakt) toont de app eenmalig 10 willekeurige codes
   (bv. `7K4M-2QXP`). De server bewaart enkel hashes. Pagina "Wachtwoord vergeten (beheerder)":
   e-mail + één code + nieuw wachtwoord → code vervalt, `sessieVersie + 1`, gelogd.
2. **Noodroute via Netlify.** Staat de omgevingsvariabele `BEHEER_HERSTELSLEUTEL` ingesteld
   (minstens 32 tekens), dan aanvaardt dezelfde herstelpagina die sleutel in plaats van een code.
   Na gebruik bewaart de server de hash in `herstel-noodroute`; dezelfde sleutel werkt daarna niet
   meer, ook als Brent vergeet de variabele te verwijderen. Gelogd. Veiligheidsredenering: wie de
   Netlify-omgeving kan wijzigen, kan ook de code van de app wijzigen — deze route geeft niemand
   meer macht dan hij al had. **Aanbeveling aan Brent:** tweestapsverificatie aanzetten op zijn
   Netlify-login.
3. Een beheerder kan het wachtwoord van elke andere gebruiker resetten (nieuw startwachtwoord).

## Beheerpagina (enkel rol beheerder)

Nieuw scherm `schermen/beheer.js` met tabbladen:

1. **Gebruikers** — lijst met naam, e-mail, rol, actief, laatste login. Aanmaken, bewerken,
   blokkeren/deblokkeren, startwachtwoord resetten, "overal uitloggen". Per technieker een keuzelijst
   **Zoho-naam** (gevuld uit de toegewezen personen op de huidige tickets, plus vrije invoer). Per
   verkoper **naam in export** en het vinkje **mag alle sales zien**.
   Een beheerder kan zichzelf niet blokkeren of degraderen als hij de laatste actieve beheerder is.
2. **Instellingen** — per persoon de huidige instellingen (startlocatie, werkdagen, werkuren, …),
   voor sales ook de standaard bezoekduur. Vervangt de per-toestel-opslag: de bestaande
   instellingenschermen lezen/schrijven voortaan via `/api/instellingen`.
3. **Activiteitenlog** — filter op persoon, actie en periode; bewaartermijn 12 maanden
   (oudere maand-blobs worden opgeruimd door een geplande functie).
4. **Systeemstatus** — mislukte rapporten (uit de upload-fix, met "Opnieuw versturen"), status
   Zoho-koppeling (token ophalen lukt / mislukt, tijdstip), laatste foutmeldingen uit `foutenlog`
   (bestaande `client-log`).
5. **Performance** — zie `2026-10-08-performance-dashboard-design.md`.

## Nieuwe serverfuncties

| Functie | Wat |
|---|---|
| `POST /api/auth-login` | e-mail + wachtwoord → cookie |
| `POST /api/auth-uitloggen` | cookie wissen |
| `GET /api/auth-ik` | huidige gebruiker (zonder hashes) + rechten |
| `POST /api/auth-wachtwoord` | eigen wachtwoord wijzigen |
| `POST /api/auth-herstel` | herstel met code of noodsleutel |
| `POST /api/auth-setup` | eerste beheerder (enkel als er nog geen gebruikers zijn + setup-code) |
| `/api/gebruikers` | CRUD, enkel beheerder |
| `/api/instellingen` | eigen instellingen lezen/schrijven; beheerder: iedereen |
| `/api/activiteit` | GET enkel beheerder; schrijven gebeurt server-side via `netlify/lib/activiteit.js` |
| `/api/systeemstatus` | enkel beheerder |

Alle bestaande `/api/*`-functies krijgen `vereisGebruiker` met de passende rollen, behalve de
klantgerichte `confirm-afspraak` (blijft open) en `setup.js` (Zoho-eenmalig; wordt
achter rol beheerder gezet). `annuleer` (interne actie van de planner) vereist rol planner/beheerder.

## Overgang

- **Instellingen:** bij de eerste login van een persoon kijkt de client of er voor hem al
  instellingen op de server staan; zo niet en wel in `localStorage` (huidige sleutel
  `settingsKey(person)`), dan worden die opgeladen. Daarna is de server de bron.
- **Testmodus (`?test`):** lokaal (dev-server) een vaste testgebruiker per rol en een rolwisselaar,
  zodat elke rol getest kan worden zonder echte accounts. In productie bestaat die wisselaar niet.
- **Livegang:** Brent maakt eerst zijn beheerdersaccount aan, dan de accounts van de anderen,
  en deelt de startwachtwoorden persoonlijk.

## Testen

- Automatisch (`tests/*.test.mjs`): token ondertekenen/controleren, vervallen, `sessieVersie`
  (blokkeren werkt meteen), scrypt-hash/verificatie, vergrendeling na 5 pogingen, herstelcode
  eenmalig, noodsleutel eenmalig, laatste beheerder niet blokkeerbaar, rechtenmatrix per functie.
- Playwright (bestaande opzet op de refactor-tak): inloggen per rol en controleren welke schermen
  en knoppen zichtbaar zijn; een technieker die een schrijfactie op een collega probeert krijgt
  `403`; verlopen sessie → inlogscherm zonder verlies van een openstaand rapport.
