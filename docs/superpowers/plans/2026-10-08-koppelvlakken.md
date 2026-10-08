# Koppelvlakken tussen de deelprojecten van 2026-10-08

Bindend voor de bouwplannen van **logins+beheer**, **sales-planner** en **performance-dashboard**
(refactor-tak). Het logins-plan **levert** deze koppelvlakken; sales en dashboard **gebruiken** ze.
Wijkt een plan hiervan af, dan wordt eerst dit document aangepast (door de opzichter).

## Takken en worktrees (uitvoering)

| Deelproject | Tak | Vertrekt van | Worktree |
|---|---|---|---|
| 1 upload-fix | `fix/upload-achtergrond` | `main` | `.claude/worktrees/upload-achtergrond` |
| 2 logins+beheer | `refactor-logins` | `refactor` | `.claude/worktrees/refactor-logins` |
| 3 sales-planner | `refactor-sales` | `refactor` (na merge van 2) | `.claude/worktrees/refactor-sales` |
| 4 dashboard | `refactor-dashboard` | `refactor` (na merge van 2 en 1-via-main) | `.claude/worktrees/refactor-dashboard` |

Taken in plan 3/4 die enkel pure logica bevatten (geen auth nodig) zijn gemarkeerd
**[los van logins]** en mogen al starten vóór plan 2 gemerged is.

## Server

### `netlify/lib/auth.js`

```js
// Rollen
export const ROLLEN = ['beheerder', 'planner', 'technieker', 'sales'];

// PubliekeGebruiker = { id, email, naam, rol, zohoNaam?, salesNaam?, magAlleSales? }  (nooit hashes)

// Werkt met zowel v1 (event) als v2 (Request) functies.
export async function vereisGebruiker(reqOfEvent, { rollen = [], schrijven = false } = {})
  // -> { ok: true, gebruiker: PubliekeGebruiker }
  // |  { ok: false, status: 401 | 403, fout: string }
  // rollen leeg = elke ingelogde gebruiker. schrijven:true = ook header 'X-Blitz: 1' verplicht (anders 403).
  // In testmodus (isTestVerzoek) geldt de testgebruiker uit header 'X-Blitz-Test-Rol' (enkel als
  // process.env.NETLIFY_DEV === 'true' of de lokale dev-server; nooit in productie).

export function weigeringV1(resultaat, cors)   // -> { statusCode, headers, body }
export function weigeringV2(resultaat, cors)   // -> Response
```

### `netlify/lib/activiteit.js`

```js
export async function logActiviteit(store, { gebruiker, actie, onderwerp = null, details = null })
  // schrijft in blob `activiteit/<YYYY-MM>`; best-effort (gooit nooit), optimistische locking met 3 retries.
// Vaste actie-namen (strings): 'login', 'login-mislukt-reeks', 'uitloggen', 'wachtwoord-gewijzigd',
// 'herstel', 'gebruiker-aangemaakt', 'gebruiker-gewijzigd', 'gebruiker-geblokkeerd', 'plannen',
// 'voorstel-verstuurd', 'annulatie', 'rapport-verstuurd', 'rapport-opnieuw', 'sales-import',
// 'sales-lead-verwijderd', 'sales-resultaat'
```

### Instellingen

- Blob `instellingen`: `{ versie, perGebruiker: { [gebruikerId]: Instellingen } }`.
- `GET /api/instellingen` → eigen instellingen; `GET /api/instellingen?gebruiker=<id>` → enkel
  beheerder, of sales met `magAlleSales` voor een sales-gebruiker.
- `PUT /api/instellingen` body `{ gebruiker?: id, instellingen, versie }`.
- Servermodule `netlify/lib/instellingen.js`:
  `export async function leesInstellingen(store, gebruikerId) -> Instellingen | null`.
- `Instellingen` = de bestaande velden uit `public/js/schermen/instellingen-logica.js`
  (startlocatie, werkdagen, werkuren, …) + `bezoekDuurMin?: number` (sales, standaard 60).

### Gebruikerslijst voor andere functies

- `netlify/lib/gebruikers.js`: `export async function leesGebruikers(store) -> Gebruiker[]` en
  `export function publiek(gebruiker) -> PubliekeGebruiker`.
- `GET /api/gebruikers?rol=sales` → PubliekeGebruiker[]; toegelaten voor beheerder en voor sales
  met `magAlleSales` (enkel rol sales opvraagbaar).

## Client

### `public/js/kern/sessie.js`

```js
export async function laadSessie()          // GET /api/auth-ik; bij 401 -> toont inlogscherm, resolve pas na login
export function huidigeGebruiker()          // -> PubliekeGebruiker | null
export function heeftRol(...rollen)         // -> boolean
export function magSchrijvenVoor(zohoNaam)  // technieker: enkel eigen; planner/beheerder: true
```

### `public/js/kern/api.js`

- Elke schrijvende aanroep (POST/PUT/PATCH/DELETE) krijgt automatisch header `X-Blitz: 1`.
- Elk `401`-antwoord → `laadSessie()` opnieuw (inlogscherm), daarna de aanroep één keer herhalen.

### Navigatie per rol — `public/js/kern/navigatie.js`

```js
export function registreerTabs(rol, tabs)   // tabs: [{ id, label, laad: () => Promise<void> }]
export function tabsVoorRol(rol)            // -> tabs in volgorde
```
Het logins-plan registreert de bestaande tabs voor beheerder/planner/technieker en een lege lijst
voor sales. Het sales-plan registreert `['sales-lijst','sales-kalender','sales-route','sales-afgewerkt']`
voor rol sales (en een "Sales"-ingang voor beheerder).

### Beheerpagina — `public/js/schermen/beheer.js`

```js
export function registreerBeheerTab({ id, label, render })  // render(container) -> Promise<void>
```
Het logins-plan levert de tabs `gebruikers`, `instellingen`, `activiteit`, `systeemstatus`.
Het dashboard-plan registreert `performance`.

### Testmodus

- `?test` blijft. In testmodus toont de app een rolwisselaar (beheerder/planner/technieker/sales)
  en stuurt header `X-Blitz-Test-Rol`. Testgebruikers: `test-beheerder`, `test-planner`,
  `test-technieker` (zohoNaam `Tim`), `test-sales` (salesNaam `Test Verkoper`).
