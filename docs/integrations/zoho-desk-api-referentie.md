# Zoho Desk API — technische referentie

**Opgesteld:** 21 augustus 2026
**Peildatum bronnen:** OAS-commit `83b5c18` (16-03-2026), documentatie en community geraadpleegd augustus 2026
**Doel:** losstaande naslag voor iedereen die tegen de Zoho Desk API bouwt. Afgeleid uit het onderzoek voor de MCP-connector, maar bewust connector-onafhankelijk opgeschreven zodat het ook voor andere integraties bruikbaar is.

---

## 0. Bronnen en hoe betrouwbaar ze zijn

| Markering | Bron | Wat je eraan hebt |
|---|---|---|
| `[OAS]` | **`github.com/zoho/zohodesk-oas`**, map `v1.0/` — 155 JSON-bestanden, 706 operaties | Officieel en machineleesbaar. De beste bron voor paden, scopes en schema's. Clone hem; dit is het startpunt van elk Desk-project. |
| `[DOC]` | `desk.zoho.com/DeskAPIDocument` | Officieel. Een JS-app: de algemene secties (headers, paginering, credits) zijn met een gewone fetch leesbaar, de per-endpoint parametertabellen niet. |
| `[3P]` | Pipedream (`components/zoho_desk/`), Activepieces, getknit.dev, Zoho community/help-portaal | Indicatief. Pipedream is de nuttigste: een productie-integratie met echte parameterkeuzes. |

### 0.1 De OAS is incompleet — dit zijn de aangetoonde gaten

Belangrijk om te weten vóór je de spec als waarheid behandelt:

- **`orgId` staat gemodelleerd als queryparameter**, terwijl de documentatie een HTTP-header voorschrijft. Beide werken (§3).
- **Vier bestaande thread-endpoints ontbreken volledig**: `GET /threads/{threadId}`, `/conversations`, `/latestThread`, `/threads/{threadId}/sendForReview`.
- **Tijdvoorbeelden botsen met hun eigen schema's**: veel voorbeelden bevatten epoch-millis uit 2013–2016 terwijl de schema-regex ISO-8601 voorschrijft (§7).
- **De scope-casing in `securitySchemes` klopt niet** met de 694 `security`-blokken (kleine letters versus hoofdletters). De blokken hebben het bij het rechte eind.
- **Twaalf operaties hebben geen `security`-blok**, waaronder vijf die je bij veldbeheer nodig hebt (`POST /organizationFields`, `GET|PATCH /organizationFields/{fieldId}`, `GET|PATCH .../permissions`, `GET /customFieldCount`).
- **`limit`-maxima ontbreken juist waar je ze nodig hebt** — er staat er geen op `GET /tickets` (§6).
- **Deprecations staan alleen als vrije tekst** in `description`, dus onvindbaar voor tooling. Het OpenAPI-`deprecated`-veld wordt nergens gebruikt.

**Werkregel:** gebruik de OAS voor paden, scopes en schema's; kruisverifieer gedrag (limieten, sortering, headers, formaten) tegen de HTML-doc en één echte call.

### 0.2 De drie extensies in de spec

Er zijn precies drie `x-`extensies:

- `x-audience` (706×) — altijd `["external-public"]`. Niet-onderscheidend; er is geen interne of bèta-laag gemarkeerd.
- `x-entity` (154×) — entiteitsnaam op bestandsniveau.
- **`x-dynamic-enum` (120×)** — dit is de operationeel relevante. Hij markeert velden waarvan de toegestane waarden **per portaal** verschillen en dus niet uit de spec te lezen zijn. Op tickets betreft dat onder meer `status` en `channel`. Valideer die altijd tegen `GET /organizationFields`, nooit tegen een hardcoded lijst.

### 0.3 Gedocumenteerde deprecations (alleen in vrije tekst)

- `GET /api/v1/modules` → gebruik `GET /api/v1/organizationModules`. De operationId is letterlijk `getModulesDeprecated`.
- `POST /tickets/{ticketId}/move` — de `departmentId`-**queryparameter** verdwijnt; zet hem in de body.
- `GET /products` — de `departmentIds`-sleutel verdwijnt uit responses.
- `CountriesAndLanguages` — het `countries`-object verdwijnt; gebruik `data`.

---

## 1. Authenticatie

### 1.1 Self-Client flow (server-to-server, geen ingelogde gebruiker)

Dit is de flow die je wil voor een achtergrondintegratie. `[DOC]`

1. Registreer een **Self Client** in `api-console.zoho.com` → Client ID + Client Secret.
2. Tab **Generate Code**: scopes komma-gescheiden, expiry kiezen, description invullen. De code is kort geldig — de self-client-pagina noemt 3 minuten, de generieke token-limits-pagina 2 minuten voor authorization codes. Reken op 2.
3. `POST https://<accounts-host>/oauth/v2/token` met `client_id`, `client_secret`, `grant_type=authorization_code`, `code`.
4. De respons bevat `access_token`, `refresh_token`, `expires_in` (3600), `token_type` en **`api_domain`**.

`access_type=offline` is bij deze flow **niet** nodig: het refresh token zit gegarandeerd in de respons. Bij de web-server-flow is het wél nodig — daar is de default `online` en krijg je géén refresh token. Dat verschil kost mensen regelmatig een middag.

`[3P]` Zoho's eigen Desk-referentie-implementatie (`github.com/zohodesk-developers/ZohoDeskOAuth`) neemt naast de Desk-scopes ook `aaaserver.profile.read` mee.

### 1.2 Gebruik `api_domain`, hardcode het API-domein niet

De tokenrespons bevat `api_domain`. Gebruik die waarde als basis voor al je API-calls. Dat maakt je integratie immuun voor een verkeerd geconfigureerd datacenter — de klassieke oorzaak van een 401 met een geldig token. De accounts-host moet je wél configureren, want dat is waar je het token ophaalt.

### 1.3 Tokenlimieten — de stille killer

`[DOC]` Drie limieten, en de derde is de oorzaak van integraties die na maanden onverklaarbaar stoppen:

- **Max 10 access tokens per refresh token per 10 minuten.** Dedupliceer gelijktijdige refreshes met een hergebruikte in-flight promise, anders loop je hier bij een parallelle batch tegenaan.
- **Max 10 actieve access tokens per refresh token.**
- **Max 20 actieve refresh tokens per gebruiker per client.** Bij overschrijding wordt het oudste **stilzwijgend ongeldig gemaakt.** Er komt geen waarschuwing. Als iemand "even opnieuw autoriseert" om iets te testen, kan daarmee de productie-integratie sneuvelen.

**Operationele regel:** één dedicated integratie-account, één client, refresh token één keer genereren en veilig bewaren.

Een access token leeft 1 uur. Lees `expires_in` uit de respons in plaats van 3600 hard te coderen, en ververs met een marge van vijf minuten in plaats van op het laatste moment.

### 1.4 Scopes

Formaat: `service.resource.OPERATION`, met de operatie in **hoofdletters** (`READ`, `CREATE`, `UPDATE`, `DELETE`, `ALL`).

**Twee dingen die vaak misgaan:**

- **`Desk.contacts.ALL` bestaat niet.** Contacts kent alleen READ/WRITE/UPDATE/CREATE.
- **Zoho weigert bij één onbekende scope de volledige scope-lijst**, niet alleen de onbekende waarde. Eén typefout laat de hele autorisatie mislukken, met een foutmelding die niet zegt welke scope het probleem is. Test je scope-string in de console vóór je erop bouwt.

Per endpoint uit de `security`-blokken `[OAS]`:

| Endpoint | Scope(s) |
|---|---|
| `GET /tickets`, `GET /tickets/{id}` | `Desk.tickets.READ` |
| `PATCH /tickets/{id}` | `Desk.tickets.UPDATE` |
| `GET /tickets/{id}/comments` | `Desk.tickets.READ` |
| `POST /tickets/{id}/comments` | `Desk.tickets.UPDATE` |
| `GET /tickets/{id}/threads` | `Desk.tickets.READ` |
| `POST /tickets/{id}/sendReply` | `Desk.tickets.UPDATE` |
| `POST /tickets/{id}/associateTag` | **`Desk.tickets.CREATE`** |
| `POST /tickets/{id}/dissociateTag` | **`Desk.tickets.CREATE`** |
| `GET /tickets/{id}/tags`, `/ticketTags`, `/tags/{tagId}/tickets` | `Desk.tickets.READ` |
| `GET /tickets/search` | `Desk.tickets.READ` **+ `Desk.search.READ`** |
| `GET /search` (cross-module) | `Desk.contacts.READ` + `Desk.tickets.READ` + `Desk.tasks.READ` + `Desk.search.READ` |
| `GET /contacts/{id}`, `GET /accounts/{id}` | `Desk.contacts.READ` |
| `GET /contacts/{id}/tickets` | `Desk.contacts.READ` + `Desk.tickets.READ` + `Desk.search.READ` |
| `GET /departments`, `GET /agents` | `Desk.settings.READ` + `Desk.basic.READ` |
| `GET /organizationFields` | `Desk.settings.READ` |

**Drie regels die hieruit volgen:**

1. **De lijsten zijn AND, niet OR.** Alle scopes in een security-requirement-object heb je nodig. Gebruik daarom `/tickets/search` (twee scopes) in plaats van het cross-module `/search` (vier).
2. **Zoek-endpoints vereisen `Desk.search.READ` bovenop de module-scope.** `Desk.tickets.READ` alleen geeft je `/tickets` maar niet `/tickets/search`, en de fout is `SCOPE_MISMATCH` — die wijst niet naar de ontbrekende scope.
3. **`dissociateTag` vraagt `CREATE`, niet `UPDATE` of `DELETE`.** Contra-intuïtief voor een verwijderactie, maar zo staat het in de spec.

Let op: `Desk.settings.READ` staat wél in de OAS-security-blokken maar **niet** in de scopetabel van de HTML-doc. Verifieer die empirisch. Wordt hij geweigerd, dan dekt `Desk.basic.READ` nog steeds departments en agents; statussen haal je dan via `GET /ticketsCountByFieldValues?field=status` (alleen `Desk.tickets.READ`).

### 1.5 Veldrechten erven van het gebruikersprofiel

`[DOC]` De API past de veldrechten van de geautoriseerde gebruiker toe — letterlijk: *"security field filtering applied for user profile"*. Een veld dat het profiel niet mag zien **ontbreekt stilzwijgend** in de respons; je krijgt geen foutmelding.

Het token wordt tijdens autorisatie bovendien aan de gekozen portal gebonden. Een token dat op de verkeerde portal is gegenereerd, geeft **lege resultaten** in plaats van een duidelijke fout.

**Diagnosetip:** vergelijk wat `GET /organizationFields` zegt te bestaan met wat er werkelijk in een echte respons terugkomt. Een verschil is een rechtenprobleem, geen API-probleem.

---

## 2. Datacenters

`[DOC]` Basis-URL is altijd `https://<host>/api/v1`.

| Regio | Desk-host | Accounts-host |
|---|---|---|
| US | `desk.zoho.com` | `accounts.zoho.com` |
| EU | `desk.zoho.eu` | `accounts.zoho.eu` |
| India | `desk.zoho.in` | `accounts.zoho.in` |
| Australië | `desk.zoho.com.au` | `accounts.zoho.com.au` |
| Japan | `desk.zoho.jp` | `accounts.zoho.jp` |
| Canada | `desk.zohocloud.ca` | `accounts.zohocloud.ca` |
| China | `desk.zoho.com.cn` | `accounts.zoho.com.cn` |
| Saoedi-Arabië | `desk.zoho.sa` | `accounts.zoho.sa` |
| Singapore | `desk.zoho.sg` | — |
| VAE | `desk.zoho.ae` | — |
| VK | — | `accounts.zoho.uk` |

Let op de asymmetrie onderaan: Desk heeft SG en AE die niet in de accounts-lijst staan, accounts heeft UK die niet in de Desk-lijst staat. Nog een reden om `api_domain` uit de tokenrespons te gebruiken.

---

## 3. Verplichte headers

`[DOC]` Twee headers op elk endpoint behalve `/organizations`:

```
Authorization: Zoho-oauthtoken <access_token>
orgId: <organisatie-id>
```

`Authorization: Bearer <token>` wordt ook genoemd als geldig, maar `Zoho-oauthtoken` is de canonieke vorm.

**Header of queryparameter?** De OAS modelleert `orgId` als queryparameter, de documentatie als header. Beide werken — Zoho genereert zelf asset-URL's met `?orgId=`. **Stuur hem als header**: dat is de gedocumenteerde vorm, het is wat alle serieuze clients doen `[3P]`, en het houdt de parameter uit je querystrings en logs. De queryvorm is de fallback voor asset-URL's (foto's, bijlagen) waar je geen headers kunt zetten — bijvoorbeeld als je zo'n URL doorgeeft aan een `<img src>`.

De enige header-parameters in de hele spec zijn `featureFlags`, `templateId` en `impersonatedUserId` (die laatste op `sendReply`).

---

## 4. Rate limiting: een creditsysteem, geen calls-per-minuut

`[DOC]` Desk rekent met **API-credits per 24 uur** (00:00–23:59:59 in de timezone van het datacenter).

**Dagcredits per editie** (exclusief light agents):

| Editie | Basis | Per agent |
|---|---|---|
| Free / Trial | 5.000 | — |
| Express | 25.000 | +100 |
| Standard | 50.000 | +250 |
| Professional | 75.000 | +500 |
| Enterprise / Zoho One / CRM Plus | 100.000 | +1.000 |

**Creditkosten per call:**

| Actie | Credits |
|---|---|
| Eén record ophalen | 1 |
| Lijst 0–2.000 records | 3 |
| Lijst 2.001–10.000 | 10 |
| Lijst 10.001–100.000 | 50 |
| Lijst >100.001 | 100 |
| Bulk-write | 1 per 2 records |
| Delete / restore | 6 per record |
| "Update many" | 25 per call |

**Gelijktijdige calls per editie:** Free/Trial 5 · Express 10 · Standard 10 · Professional 15 · Enterprise/Zoho One/CRM Plus 25. Bouw een semafoor op dit getal minus een marge van 2, zodat achtergrondwerk geen interactief gebruik verdringt.

**Responsheaders — exacte spelling:**

- `X-Rate-Limit-Request-Weight-v3` — credits van deze call
- `X-Rate-Limit-Remaining-v3` — resterende credits vandaag
- `Retry-After` — wachttijd in seconden

Er is geen `X-Rate-Limit-Limit` en geen `-Reset`. Deze headers staan **niet** in de OAS; je moet ze buiten de spec om verwerken. Log `X-Rate-Limit-Remaining-v3` zodat je ziet aankomen dat je tegen het dagplafond loopt.

**Bij 429:** honoreer `Retry-After` letterlijk in plaats van een eigen backoff te verzinnen. De body ziet er zo uit:

```json
{"errorCode":"TOO_MANY_REQUESTS",
 "message":"The maximum number of Concurrent API Calls that can be made has been exceeded."}
```

**API-toegang zit in elke editie, ook Free.** Er is geen tier-gate op de API zelf, wel op sommige features (§5).

---

## 5. Foutcodes

`[OAS]` De `errorCode`-enum in `Common.json` bevat onder meer:

| Code | Betekenis / wat je ermee doet |
|---|---|
| `INVALID_OAUTH` | Token ongeldig. Eén keer verversen, dan doorgooien. |
| `SCOPE_MISMATCH` | Ontbrekende scope. Zegt **niet** welke — check §1.4, vooral `Desk.search.READ`. |
| `OAUTH_ORG_MISMATCH` | Het token hoort bij een andere organisatie dan de `orgId` die je meestuurt. |
| `TOO_MANY_REQUESTS` | Concurrency-limiet geraakt. `Retry-After` volgen. |
| `THRESHOLD_EXCEEDED` | Dagelijkse credits op. |
| `UNPROCESSABLE_ENTITY` | Ongeldige parameterwaarde. Niet opnieuw proberen. |
| `INVALID_DATA` | Validatiefout. Bevat een `errors`-array met `{fieldName, errorType, errorMessage}`, waarbij `fieldName` in JSON-Pointer-notatie staat (`"/contactId"`) en `errorType` ∈ `invalid`/`duplicate`/`missing`. |
| `LICENSE_ACCESS_LIMITED` | Jullie editie ondersteunt deze functie niet. Vang dit expliciet af — de standaardmelding is anders moeilijk te plaatsen. |

`[OAS]` Bij `LICENSE_ACCESS_LIMITED` krijg je velden mee: `feature` (`AGENTS`/`LIGHT_AGENTS`/`TEAM`), `editionType` (`FREE`/`EXPRESS`/`STANDARD`/`PROFESSIONAL`/`ENTERPRISE`), `maxAllowedEntity`, `isTrial`. Welke endpoints editie-gebonden zijn, is **niet** uit de spec af te leiden — je merkt het runtime.

Log nooit de volledige responsbody bij een fout: die kan klantgegevens bevatten.

---

## 6. Paginering — hier zitten de meeste verrassingen

### 6.1 Parameters

`from` en `limit`. Maar:

**`from` is 1-gebaseerd op lijst-endpoints (default 1) en 0-gebaseerd op search-endpoints (default 0).** Dat verschil staat expliciet in de spec en is een reële valkuil.

### 6.2 De harde bovengrens: `from` ≤ 4999

`[3P]` Bij overschrijding volgt HTTP **422**:

```
The value passed for field 'from' exceeds the range of '0-4999'.
```

De `from`-parameter declareert dit maximum niet in de spec; de grens is server-side.

**Dit is de belangrijkste architecturale beperking van de hele API.** Met `limit=50` bereik je maximaal ongeveer **5.050 records per queryresultaat**. Een ticketarchief van tienduizenden tickets kun je dus **niet** lineair uitpagineren.

**De uitweg is niet dieper pagineren maar het resultaat opdelen:**

- Segmenteer op tijd met `createdTimeRange` of `modifiedTimeRange` op `/tickets/search`. Formaat: twee ISO-timestamps komma-gescheiden, bijvoorbeeld `2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z`. Per maand of week ophalen, en een segment verder opsplitsen als het de 5.000 nadert.
- Combineer met `departmentId` en/of `status` om segmenten te verkleinen.
- Voor **incrementele sync**: sorteer op `-modifiedTime` en houd een watermerk bij. Dan heb je per run maar een handvol pagina's nodig en omzeil je het probleem structureel. `[3P]` Pipedream gebruikt precies dit patroon (`LAST_CREATED_AT` / `LAST_UPDATED_AT` als cursor) en begrenst streams op 500 records.

### 6.3 `limit`-maxima verschillen per endpoint

`[OAS]`, tenzij anders vermeld:

| Endpoint | max `limit` |
|---|---|
| `GET /tickets` | **niet gedeclareerd** — gebruik 50 |
| `GET /contacts`, `/accounts`, `/contacts/{id}/tickets`, `/contacts/{id}/history` | 99 |
| `GET /agents`, `/departments` | 200 |
| `GET /roles` | 500 |
| `GET /articles`, `/labels`, `/accounts/{id}/contracts` | 50 |
| `GET /tickets/{id}/attachments` | 100 |
| `GET /tickets/{id}/comments` | 100 (default 50) `[3P]` |
| `GET /tickets/{id}/threads`, `/tickets/{id}/conversations` | 200 (default 100) `[3P]` |
| `GET /tickets/search` | niet gedeclareerd (`minimum: 1`) |

`[DOC]` De generieke regel: *"A single API request can fetch a maximum of 50 resources. However, some APIs support higher limits."* Default `limit` is 10, default `from` is 1.

**Voor `/tickets` is 50 de veilige keuze.** `[3P]` Pipedream hardcodeert `max: 50`. Wil je meer throughput, probeer 99 (consistent met alle zustermodules) met een fallback naar 50 op `UNPROCESSABLE_ENTITY`.

### 6.4 Geen `count` of `hasMore` op het ticket-lijst-endpoint

`[OAS]` Het 200-antwoord van `GET /tickets` bevat uitsluitend `{"data": [...]}`. Geen `count`, geen `hasMore`, geen `info`-object. Er staat wél een `pagination`-schema (`{next, prev}`) in `Ticket.json`, maar geen enkele response verwijst ernaar — dood gewicht.

**Een 204 No Content is je einde-signaal.**

Waar je wél een totaal krijgt:

- `GET /tickets/search` → `{"data": ..., "count": <int>}`, beide verplicht.
- `GET /ticketsCount` → `{"count": 200}`
- `GET /ticketsCountByFieldValues?field=<...>` met `field` ∈ `statusType`, `status`, `priority`, `channel`, `spam`, `overDue`, `escalated`.

---

## 7. Tijdformaten

`[OAS]` **De schema's schrijven ISO-8601 voor: `yyyy-MM-ddTHH:mm:ss.SSSZ` (UTC)**, met een strikte regex die epoch-millis uitsluit. Spec-breed: `createdTime` 131× met dit patroon, `modifiedTime` 94×, `dueDate` 23×.

De voorbeelden zijn een ander verhaal: 491 epoch tegenover 87 ISO. Maar die epoch-voorbeelden zijn verouderd — ze bevatten waarden uit 2013–2016 en botsen met hun eigen schema. Nieuwere bestanden (`Search.json`, `Thread.json`, `User.json`) zijn consequent ISO, en de officiële doc toont ISO in responses.

**Praktisch:** parse als ISO-8601 UTC, maar bouw een parser die óók een 13-cijferige epoch-string aankan. Dat kost vijf regels en dekt twee echte uitzonderingen: legacy velden, en **custom datumvelden**, die in blueprint-context wél als epoch-millis worden geschreven (`"cf_cffdate_time": 1606113000000`) terwijl ze elders ISO zijn (`"cf_followUpDate": "2016-07-07T19:30:00.000Z"`).

---

## 8. Custom fields

### 8.1 `cf` versus `customFields` — het onderscheid dat nergens gedocumenteerd staat

`[OAS]` Records bevatten **twee** sleutels voor custom fields. De schema's zijn byte-identiek en onderscheiden niets; beide staan zelfs in `required`. Het verschil zit uitsluitend in de voorbeelden, en daar is het volstrekt consistent:

- **`cf`** is gesleuteld op **API-naam**, altijd met `cf_`-prefix:
  `{"cf_permanentaddress": null, "cf_severitypercentage": "0.0", "cf_modelname": "F3 2017"}`
- **`customFields`** is gesleuteld op **displaylabel**, zonder prefix:
  `{"city": "Delhi", "customerSince": "2011"}`

Het beslissende bewijs staat in één respons (`Search.json` → `doSearchResponse`): tickets gebruiken daar `cf`, accounts en contacts `customFields`, zichtbaar verschillend gesleuteld.

**Lees en schrijf altijd `cf`.** Behandel `customFields` als read-only en fragiel — labels wijzigen als iemand een veld hernoemt in de UI, API-namen niet.

### 8.2 Typering

`[OAS]` Alle `cf`-waarden zijn getypeerd als **string** met `maxLength: 100` — ook numerieke, percentage- en valutavelden (`"0.0"`, `"32"`).

**Uitzondering die je moet testen:** een **multi-select** custom field kan onmogelijk in dat schema passen. Stel empirisch vast wat de API teruggeeft — een array, of een komma- of puntkomma-gescheiden string — voordat je erop typeert. Dit is de enige plek waar het OAS-schema aantoonbaar niet klopt met de werkelijke velddefinitie.

### 8.3 Schrijven

`PATCH /tickets/{ticketId}` met:

```json
{"cf": {"cf_serienummer": "ABC123"}}
```

De update-body van een ticket accepteert `[OAS]`: `contactId`, `resolution`, `sharedDepartments`, `uploads`, `category`, `subCategory`, `classification`, `status`, `description`, `customFields`, `cf`. Merk op dat **`priority` er niet in staat**, en `tags` ook niet.

### 8.4 Zoeken op een custom field — onopgelost

Twee dingen zijn zeker:

- **`?cf_mijnveld=waarde` werkt niet.** De API valideert querystrings strikt en weigert onbekende parameters expliciet: *"Extra query parameter 'cf_creator_record_id' is present in the input."*
- **De officiële search-parameterlijst is een gesloten set** zonder custom-field-optie (§10.2).

Er is één spoor, uit een community-post (auteur, geen Zoho-staff): een parameter **`customField1`** met een `cf_<apinaam>:<waarde>`-syntax, inclusief `${empty}` en `${notempty}`:

```
GET /api/v1/tickets/search?customField1=cf_org_location:Search_Value
GET /api/v1/contacts/search?customField1=cf_org_location:${notempty}
```

De auteur demonstreert het op `/accounts/search` en `/contacts/search` en zegt dat je de veldnamen per module aanpast — hij bevestigt tickets dus **niet**. Hoeveel `customFieldN` er zijn, is onbekend. Twee andere community-threads over hetzelfde onderwerp lopen dood zonder staff-antwoord.

**Advies:** test `customField1` één keer tegen je eigen portaal — vijf minuten, en het beslist het punt. Werkt het niet, dan zijn er twee alternatieven:

1. **`_all=<waarde>`** met client-side filtering op het custom field. Simpel, maar wildcard-match en `maxLength: 100`, dus reken op valse positieven.
2. **De waarde als tag op het ticket zetten.** Dat geeft een first-class, gedocumenteerd, exact-match-pad via `GET /tags/{tagId}/tickets` of `?tag=` op de search. Vraagt discipline bij ticketaanmaak, maar je krijgt een betrouwbare index in plaats van een gok op een ongedocumenteerde parameter.

---

## 9. Endpoint-catalogus

### 9.1 Tickets

```
GET    /api/v1/tickets
GET    /api/v1/tickets/{ticketId}
POST   /api/v1/tickets
PATCH  /api/v1/tickets/{ticketId}          ← géén PUT; die bestaat niet
POST   /api/v1/tickets/updateMany          ← 25 credits per call
GET    /api/v1/tickets/archivedTickets     (departmentId verplicht, viewType ∈ 1/2/4)
GET    /api/v1/associatedTickets
GET    /api/v1/accounts/{accountId}/tickets
GET    /api/v1/contacts/{contactId}/tickets   (departmentId verplicht)
GET    /api/v1/products/{productId}/tickets
GET    /api/v1/tags/{tagId}/tickets
GET    /api/v1/ticketsCount
GET    /api/v1/ticketsCountByFieldValues      (field verplicht)
```

**Parameters van `GET /api/v1/tickets`** `[OAS]` — dit is de volledige set:

| Param | Waarden |
|---|---|
| `from`, `limit` | zie §6 |
| `departmentId` | int64 |
| `assignee` | `Unassigned` of een assignee-id; comma-gescheiden meerdere. **Let op: heet niet `assigneeId`.** |
| `status` | dynamische enum, incl. custom statussen; comma-gescheiden |
| `channel` | dynamische enum |
| `teamIds` | array van int64 |
| `dueDate` | `overdue`, `tomorrow`, `currentWeek`, `currentMonth`, `today` |
| `closedTime` | `today`, `yesterday`, `currentWeek`, `currentMonth`, `last3days`, `last7days`, `last15days`, `last30days` |
| `receivedInDays` | `15`, `30`, `90` (op customer response time) |
| `sortBy` | `dueDate`, `createdTime`, `recentThread` |
| `include` | `contacts`, `products`, `departments`, `team`, `assignee` |

**Wat er níet is op dit endpoint** — expliciet gecontroleerd:

- **geen `priority`**
- **geen enkel datum/tijd-bereik** (`createdTimeRange` en broertjes bestaan alleen op `/tickets/search`, `/ticketsCount` en `/ticketsCountByFieldValues`)
- **geen tagfilter**
- geen `viewId` (die bestaat wel als component maar wordt alleen door `/ticketQueueView/count` gebruikt)

**Aflopend sorteren.** De enum op `/tickets` bevat geen minvarianten en heeft geen `description`. Maar dat is geen betrouwbaar signaal: alleen `/articles` zet de minvarianten in de enum; elders staat het in de *description*, en die ontbreekt op `/tickets`. Vlak ernaast in hetzelfde bestand documenteert `/contacts/{id}/tickets` het letterlijk: *"A `-` prefix denotes descending order of sorting."* Idem op `/products/{id}/tickets`, `/accounts/{id}/tickets`, `/tickets/{id}/comments`, `/tickets/{id}/threads` en alle tien search-endpoints. `[3P]` Pipedream biedt `-createdTime` en `-modifiedTime` expliciet aan op de list-actie.

**Conclusie:** het ontbreken op `/tickets` is vermoedelijk een documentatiegat, geen API-restrictie. Test het één keer; verwacht `UNPROCESSABLE_ENTITY` als het niet werkt. Let op dat `modifiedTime` niet in de tickets-enum staat — gebruik `-createdTime`, of val terug op `/tickets/search?sortBy=-modifiedTime`.

### 9.2 Responsvelden van een ticket

`[OAS]` Volledige set van `GET /tickets/{ticketId}`:

`id`, `ticketNumber`, `subject`, `description`, `status`, `statusType`, `priority`, `category`, `subCategory`, `classification`, `channel`, `channelCode`, `channelRelatedInfo`, `language`, `sentiment`, `resolution`, `webUrl`, `email`, `phone`, `createdTime`, `modifiedTime`, `closedTime`, `onholdTime`, `dueDate`, `responseDueDate`, `customerResponseTime`, `createdBy`, `modifiedBy`, `departmentId`, `department{id,name}`, `contactId`, `contact{...}`, `accountId`, `assigneeId`, `assignee{...}`, `teamId`, `team{...}`, `productId`, `product{...}`, `contractId`, `slaId`, `layoutId`, `layoutDetails`, `secondaryContacts`, `sharedDepartments`, `entitySkills`, `skillsInfo`, `source{...}`, `cf`, `customFields`, plus booleans (`isRead`, `isSpam`, `isDeleted`, `isTrashed`, `isArchived`, `isEscalated`, `isOverDue`, `isResponseOverdue`, `isFollowing`) en tellers (`threadCount`, `commentCount`, `taskCount`, `tagCount`, `attachmentCount`, `followerCount`, `timeEntryCount`, `approvalCount`).

**Drie dingen om te weten:**

**Er is géén `tags`-veld op het ticketobject** — alleen `tagCount`. Tags haal je apart op via `GET /tickets/{ticketId}/tags`.

**`statusType` heeft twee schrijfwijzen.** Op het ticketobject is het de enum `Open` / `Closed` / `On Hold` (met spatie). In `ticketsCountByFieldValues` is het `OPEN` / `ONHOLD` / `CLOSED` (uppercase). Zelfde concept, twee vormen, in dezelfde API.

**De listview-respons is smaller dan de detail-respons.** `listviewJson` bevat wel `id`, `ticketNumber`, `subject`, `status`, `statusType`, `priority`, `category`, `subCategory`, `channel`, `createdTime`, `dueDate`, `closedTime`, `onholdTime`, `customerResponseTime`, `responseDueDate`, `departmentId`, `contactId`, `accountId`, `assigneeId`, `teamId`, `productId`, `layoutId`, `email`, `phone`, `language`, `sentiment`, `threadCount`, `commentCount`, `webUrl`, `isSpam`, `isArchived`, `relationshipType`, `lastThread`, `source` — maar **geen `modifiedTime`, geen `description` en geen `cf`**. Dat is een reële beperking voor incrementeel syncen: wil je `modifiedTime` of custom fields van meerdere tickets, gebruik `/tickets/search` (dat geeft `cf` wél terug) of doe een detail-call per ticket.

### 9.3 Comments (interne notities en publieke reacties)

```
GET    /api/v1/tickets/{ticketId}/comments
POST   /api/v1/tickets/{ticketId}/comments
PATCH  /api/v1/tickets/{ticketId}/comments/{commentId}
```

**Aanmaken:**

```json
{"content": "tekst", "isPublic": false, "contentType": "plainText", "attachmentIds": null}
```

- `content` — max **32.000** tekens
- `contentType` — enum `plainText` | `html`. **Geen markdown.** `[3P]` De default is vermoedelijk `html`, dus platte tekst zonder expliciete `contentType` kan als HTML geïnterpreteerd worden. Zet hem altijd expliciet.
- `attachmentIds` — staat als `required` in het schema maar mag `null` zijn.
- `isPublic` — `false` = interne notitie, alleen zichtbaar voor agents. **De default is nergens gedocumenteerd**, en Zoho heeft een per-gebruiker voorkeursinstelling waarmee comments standaard publiek worden. Stuur `isPublic` dus altijd expliciet mee, als JSON-boolean, en verifieer het gedrag één keer in het klantportaal in plaats van in de agent-weergave.

**Bijwerken kan `isPublic` niet veranderen.** De update-body accepteert uitsluitend `content`, met `additionalProperties: false`, en Zoho's velddescriptie zegt dat `isPublic` alleen bij het aanmaken gezet kan worden. Een privécomment kan via de API dus niet publiek gemaakt worden — dat is een nuttige garantie als je een automatisering bouwt die niet per ongeluk klanten mag bereiken.

**Responsvelden:** `id`, `content`, `contentType`, `isPublic`, `commenterId`, `commenter`, **`commentedTime`** (let op: niet `createdTime`), `modifiedTime`, `attachments`.

**Er is geen server-side filter op publiek/privé.** Filter client-side op `isPublic`.

**Sorteren:** alleen op `commentedTime`, met `-` voor aflopend.

### 9.4 Threads (de eigenlijke conversatie met de klant)

In de OAS staan zeven operaties:

```
GET    /api/v1/tickets/{ticketId}/threads
GET    /api/v1/tickets/{requestId}/threads/{threadId}/originalContent
POST   /api/v1/tickets/{ticketId}/sendReply
POST   /api/v1/tickets/{ticketId}/draftReply
PATCH  /api/v1/tickets/{ticketId}/draftReply/{threadId}
DELETE /api/v1/tickets/{ticketId}/threads/{threadId}/attachments/{attachmentId}
POST   /api/v1/tickets/{ticketId}/threads/{threadId}/split
```

Merk de inconsistentie op: `originalContent` gebruikt padparameter **`requestId`** in plaats van `ticketId`. Alleen het padsegment heet anders; het is hetzelfde ticket-ID.

**Vier endpoints bestaan wél maar staan niet in de OAS** `[DOC + 3P]`:

```
GET  /api/v1/tickets/{ticketId}/threads/{threadId}      ← volledige inhoud van één thread
GET  /api/v1/tickets/{ticketId}/conversations           ← threads ÉN comments, chronologisch
GET  /api/v1/tickets/{ticketId}/latestThread
POST /api/v1/tickets/{ticketId}/threads/{threadId}/sendForReview
```

**Belangrijk voor iedereen die conversaties leest:** het lijst-endpoint geeft per thread metadata plus een **`summary`**, niet de volledige body. Voor de echte inhoud moet je per thread een tweede call doen. Twee dingen die dat verzachten:

- **`/conversations` is vermoedelijk het efficiëntste endpoint** als je "het hele verloop van dit ticket" wil: threads en comments in één chronologische lijst, met `limit` tot 200 (default 100). Het staat niet in de spec, dus verifieer het responseschema tegen je eigen portaal.
- `/latestThread` scheelt een list-call als je alleen de laatste klantreactie nodig hebt.

`originalContent` is iets anders: dat geeft de **ruwe mail inclusief mailheaders**, nuttig voor het diagnosticeren van mailrouting maar niet voor het weergeven van gespreksinhoud.

**Threadvelden:** `id`, `channel`, `direction` (`in`/`out`), `visibility` (`public`/`private` — let op: een ander mechanisme dan `isPublic` op comments), `status`, `summary`, `content`, `contentType` (**`text/plain` | `text/html`** — weer een andere enum dan bij comments), `createdTime`, `author{id,name,email,type}`, `fromEmailAddress`, `to`, `cc`, `bcc`, `replyTo`, `hasAttach`, `attachmentCount`, `isContentTruncated`.

### 9.5 Tags

`[OAS]` `TicketTag.json`:

```
GET    /api/v1/tickets/{ticketId}/tags
POST   /api/v1/tickets/{ticketId}/associateTag       body: {"tags":[...]}
POST   /api/v1/tickets/{ticketId}/dissociateTag      body: {"tags":[...]}
GET    /api/v1/ticketTags            (departmentId verplicht; sortBy ∈ createdTime/count)
GET    /api/v1/recentTicketTags      (departmentId verplicht)
GET    /api/v1/tags/search           (searchVal, departmentId verplicht)
GET    /api/v1/tags/{tagId}/tickets  (sortBy ∈ createdTime/modifiedTime; include ∈ contacts/isRead/products/assignee)
PATCH  /api/v1/tags/{currentTagId}/replace
```

**Validatie:** minimaal **3** en maximaal **100** tekens per tag; de literal `null` wordt geweigerd. Valideer dit client-side zodat de fout bij je eigen code landt.

**Er is geen "alles behalve tag X"-filter.** Zie §10.2 voor de `${Empty}`/`${NotEmpty}`-truc op de search, of trek de set uit `/tags/{tagId}/tickets` af van je resultaat.

### 9.6 Contacts, accounts, agents

```
GET /api/v1/contacts                       (limit max 99; sortBy ∈ firstName/lastName/phone/email/account/createdTime/modifiedTime)
GET /api/v1/contacts/{contactId}           (include ∈ accounts, owner)
GET /api/v1/contacts/contactsByIds         (ids verplicht)
GET /api/v1/contacts/{contactId}/tickets   (departmentId VERPLICHT)
GET /api/v1/contacts/{contactId}/history
GET /api/v1/accounts                       (limit max 99)
GET /api/v1/accounts/{accountId}           (include ∈ owner)
GET /api/v1/accounts/{accountId}/tickets
GET /api/v1/agents                         (limit max 200; include ∈ profile/role; status ∈ ACTIVE/DISABLED)
GET /api/v1/agents/{agentId}
GET /api/v1/agentsByIds                    (agentIds verplicht)
GET /api/v1/myinfo
```

**Contactvelden:** `id`, `firstName`, `lastName`, `email`, `secondaryEmail`, `phone`, `mobile`, `street`, `city`, `state`, **`zip`**, `country`, `title`, `description`, `type`, `facebook`, `twitter`, `photoURL`, `webUrl`, `accountId`, `account{id,accountName,website}`, `accountCount`, `ownerId`, `owner`, `layoutId`, `layoutDetails`, `createdTime`, `modifiedTime`, `cf`, `customFields`, `customerHappiness{goodPercentage,okPercentage,badPercentage}`, `zohoCRMContact`, `isEndUser`, `isSpam`, `isDeleted`, `isTrashed`, `isAnonymous`, `isFollowing`.

**Accountvelden:** `id`, `accountName`, `email`, `phone`, `fax`, `website`, `street`, `city`, `state`, **`code`**, `country`, `industry`, `annualrevenue`, `description`, `ownerId`, `owner`, `layoutId`, `layoutDetails`, `associatedSLAIds`, `createdTime`, `modifiedTime`, `cf`, `customFields`, `zohoCRMAccount`, `isDeleted`, `isTrashed`, `isFollowing`, `webUrl`.

**Agentvelden:** `id`, `zuid`, `firstName`, `lastName`, `name`, **`emailId`**, `phone`, `mobile`, `extn`, `countryCode`, `photoURL`, `aboutInfo`, `langCode`, `timeZone`, `status`, `isConfirmed`, `roleId`, `role`, `profileId`, `profile`, `rolePermissionType` (`AgentPublic`/`AgentPersonal`/`AgentTeamPersonal`/`Admin`/`Custom`/`Light`), `associatedDepartmentIds`, `associatedDepartments`, `channelExpert`, `verifiedEmails`, `cf`.

**Drie naamvalkuilen die je gaat maken als je dit niet weet:**

- Postcode heet **`zip`** op een contact maar **`code`** op een account.
- Het e-mailveld van een agent heet **`emailId`**, niet `email`.
- Er is **geen `fullName`** op de contact-respons. `fullName` bestaat alleen als *search*-parameter op `/contacts/search`.

### 9.7 Metadata: velden, statussen, afdelingen

```
GET   /api/v1/organizationFields          (module VERPLICHT)
GET   /api/v1/organizationFields/{fieldId}
PATCH /api/v1/organizationFields/{fieldId}
GET   /api/v1/organizationFields/{fieldId}/permissions
GET   /api/v1/customFieldCount
GET   /api/v1/departments                 (searchStr, isEnabled, chatStatus, from, limit)
GET   /api/v1/departments/{departmentId}
GET   /api/v1/departmentsByIds
GET   /api/v1/departments/{departmentId}/agents
GET   /api/v1/departments/count
GET   /api/v1/views?module=tickets
GET   /api/v1/layouts
GET   /api/v1/organizationModules
```

**`/api/v1/ticketFields` bestaat niet.** Het is `GET /api/v1/organizationFields?module=tickets`. `module` is verplicht, enum: `tickets`, `contacts`, `accounts`, `tasks`, `calls`, `events`, `contracts`, `products`. Optioneel `departmentId`.

**Veldresponsvelden:** `id`, `apiName`, `name`, `displayLabel`, `i18NLabel`, `type`, `isCustomField`, `isMandatory`, `isEncryptedField`, `isTrackLastActivityTime`, `maxLength`, `showToHelpCenter`, `allowedValues`.

Types: `Text`, `URL`, `Textarea`, `Email`, `Phone`, `Multiselect`, `Date`, `DateTime`, `Number`, `Checkbox`, `Percent`, `Decimal`, `Currency`, `Picklist`, `LookUp`, `Lookup`, `AutoNumber`, `Boolean`, `Fax`, `LargeText`.

**Er is geen apart statussen-endpoint.** Twee routes:

1. **De canonieke:** `GET /organizationFields?module=tickets`, dan het veld met `apiName: "status"`. Dat veld gebruikt schema `statusFieldResponseForTickets`, waarvan `allowedValues` per item **`value`** én **`statusType`** bevat. Dat laatste is precies wat je nodig hebt om een custom status ("Wacht op onderdeel") te mappen naar Open/On Hold/Closed.
2. **Met counts:** `GET /ticketsCountByFieldValues?field=status`, dat naast `status` ook `statusType` teruggeeft:

```json
{ "status": [{"count":"9","value":"open"}, {"count":"4","value":"escalated"}],
  "statusType": [{"count":"13","value":"OPEN"}, {"count":"0","value":"ONHOLD"}] }
```

Route 2 vraagt alleen `Desk.tickets.READ` en is dus een uitweg als je `Desk.settings.READ` niet krijgt.

---

## 10. Zoeken

### 10.1 Twee soorten search-endpoints

**Cross-module:** `GET /api/v1/search` met `searchStr` (max 100 tekens), `module`, `departmentId`, `from`, `limit`, `sortBy` ∈ `relevance`/`modifiedTime`.

De `module`-parameter is intern inconsistent: de description zegt *"tickets, accounts, contacts or tasks"*, de enum bevat alleen `["tickets"]`. Neem de description als bedoelde waarheid. Zonder `module` krijg je alle modules. Kost vier scopes (§1.4).

**Per module:** `/tickets/search`, `/contacts/search`, `/accounts/search`, `/tasks/search`, `/calls/search`, `/events/search`, `/products/search`, `/articles/search`, `/activities/search`, en `/{moduleApiName}/search` voor custom modules.

### 10.2 `GET /api/v1/tickets/search` — parameters en matchsemantiek

De volledige set (26 parameters): `_all`, `id`, `ticketNumber`, `subject`, `description`, `status`, `priority`, `category`, `channel`, `departmentId`, `assigneeId`, `contactId`, `contactName`, `accountId`, `accountName`, `productId`, `productName`, `tag`, `createdTimeRange`, `modifiedTimeRange`, `dueDateRange`, `customerResponseTimeRange`, `from`, `limit`, `sortBy`, `orgId`.

**Er is geen generieke `q`.** Voor vrij zoeken gebruik je **`_all`** (*"Key that includes all the columns in the tickets module for search"*), wildcard, max 100 tekens. Bij het cross-module-endpoint heet het `searchStr`.

**Matchsemantiek staat per parameter in de spec:**

| Semantiek | Parameters |
|---|---|
| Exact match | `id`, `ticketNumber`, `departmentId`, `assigneeId`, `contactId`, `accountId`, `productId`, `status`, `priority` |
| Wildcard | `_all`, `subject` (max 1000), `description`, `tag` |
| Wildcard + lege/niet-lege check | `accountName`, `productName`, `tag` |

**Meerdere waarden per veld:** comma-gescheiden, OR-semantiek. Bijvoorbeeld `status=open,in progress`.

**De `${...}`-conventie.** Dit is de nuttigste onbekende truc in de API. Voor velden die "empty check" ondersteunen:

```
tag=${NotEmpty}     → tickets die minstens één tag hebben
tag=${Empty}        → tickets zonder enige tag
status=${open}      → statussen van het type open
```

Het regexpatroon in de spec is expliciet: `([0-9a-zA-Z_\-\*\.\$@\?\:\/\!...]{3,}|\$\{(?i)(Empty|NotEmpty)\})` — minimaal 3 tekens voor een gewone waarde, of een van de twee `${}`-vormen. Dezelfde conventie zie je bij `chatStatus=${UNAVAILABLE}` op departments.

**Tijdvensters:** `createdTimeRange`, `modifiedTimeRange`, `dueDateRange`, `customerResponseTimeRange`. Formaat letterlijk uit de spec: *"Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ"*, twee timestamps komma-gescheiden.

**Sorteren:** `relevance`, `modifiedTime`, `createdTime`, `customerResponseTime`, met `-` voor aflopend (hier expliciet gedocumenteerd: *"For descending order: sortBy=-modifiedTime"*).

**Onthoud:** `from` is hier **0-gebaseerd**, en dit endpoint geeft wél een `count` terug.

---

## 11. Onze eigen Desk-instantie — referentiegegevens

Uitgelezen 21-08-2026 uit Setup → Aanpassing → Lay-outs en velden → Veldenlijst, module Tickets.

- **Datacenter:** EU (`desk.zoho.eu`)
- **Editie:** Standard → 50.000 credits/dag + 250 per agent, **10 gelijktijdige calls**
- **Module-naam:** de UI zegt "Tickets", intern heet hij `Cases` (zichtbaar in de setup-URL). De API-parameter blijft `module=tickets`.
- **41 velden op tickets, waarvan 21 custom**

**Standaardvelden (20):** `accountId`, `assigneeId`, `category`, `channel`, `classification`, `contactId`, `departmentId`, `description`, `dueDate`, `email`, `entitySkills`, `language`, `phone`, `priority`, `productId`, `resolution`, `status`, `subCategory`, `subject`, `ticketNumber`.

**Custom fields (21):**

| Veldnaam | Type | API-naam |
|---|---|---|
| Serienummer | Enkele regel | `cf_serienummer` |
| Firmware Versie | Keuzelijst | `cf_firmware` |
| Software Versie | Keuzelijst | `cf_software_versie` |
| EMS-systeem | Keuzelijst | `cf_ems_systeem` |
| Hardware defect | **Meerdere selecteren** | `cf_hardware_defect` |
| Probleemtype | Keuzelijst | `cf_probleemtype` |
| Fout Oorsprong | Keuzelijst | `cf_fout_oorsprong` |
| Garantie Status | Keuzelijst | `cf_garantie_status` |
| Contactwijze | Keuzelijst | `cf_type_ticket` |
| Indiener | Keuzelijst | `cf_indiener` |
| Installateur al langs geweest | Keuzelijst | `cf_installateur_al_langs_geweest` |
| Interventie Datum | Datum/tijd | `cf_interventie_datm` *(leidend — typo in de naam)* |
| Interventiedatum | Datum | `cf_interventiedatum` *(legacy, negeren)* |
| Regio | Keuzelijst | `cf_regio` |
| Naam Eindklant | Enkele regel | `cf_naam_eindklant` |
| Adres | Enkele regel | `cf_adres` |
| Adres Eindklant | Enkele regel | `cf_adres_eindklant` |
| E-mail Eindklant | E-mail | `cf_e_mail_eindklant` |
| E-mail Installateur | E-mail | `cf_e_mail_installateur` |
| Telefoon Eindklant | Telefoon | `cf_telefoon_eindklant` |
| Partner/installateur | Enkele regel | `cf_partner_installateur` |

**Aandachtspunten voor elke integratie tegen deze instantie:**

- **Zeven van de 21 custom fields bevatten persoonsgegevens:** `cf_naam_eindklant`, `cf_adres`, `cf_adres_eindklant`, `cf_e_mail_eindklant`, `cf_e_mail_installateur`, `cf_telefoon_eindklant`, `cf_partner_installateur`. Die laatste is de gevaarlijkste, want een naamheuristiek op de veldnaam vindt hem niet — behandel de lijst dus expliciet in plaats van met een patroon.
- **Er is geen foutcode-veld.** Charx-foutcodes staan in vrije tekst (beschrijving of thread-inhoud). Wil je erop clusteren, dan gaat dat via `_all` met de kanttekeningen uit §10.2.
- **Dertien van de 21 custom fields zijn keuzelijsten**, met portaal-specifieke waarden (`x-dynamic-enum`). Haal die altijd op via `organizationFields`; hardcode ze nooit.
- **`cf_hardware_defect` is een multi-select** — zie §8.2 voor de openstaande typeringsvraag.
- **Twee interventiedatum-velden**, waarvan `cf_interventie_datm` het leidende is. Filter `cf_interventiedatum` uit je output tot het gedeactiveerd is; een leeg legacy-veld waar je conclusies aan verbindt is erger dan geen veld.

---

## 12. Wat generaliseert naar andere Zoho-API's

Nuttig als je meerdere Zoho-producten wil integreren. Wat hieronder staat is **niet** per product geverifieerd — behandel het als een startpunt, niet als contract.

**Wat vermoedelijk hetzelfde is:**

- **OAuth-model:** dezelfde accounts-hosts, dezelfde Self-Client-flow, dezelfde `grant_type`-waarden, hetzelfde `api_domain` in de tokenrespons. De tokenlimieten uit §1.3 zijn accountsbrede limieten en gelden dus voor al je Zoho-integraties samen.
- **Autorisatieheader:** `Zoho-oauthtoken`, niet `Bearer`.
- **Scopeformaat:** `service.resource.OPERATION` met de operatie in hoofdletters, en dezelfde alles-of-niets-weigering bij één onbekende scope.
- **Datacenter-suffixen** en de eis dat token en API-host uit dezelfde regio komen.

**Wat verschilt en je per product moet uitzoeken:**

- **De organisatie-identificatie.** Desk gebruikt een `orgId`-header; CRM heeft dat niet, Books gebruikt een `organization_id`-queryparameter. Ga hier niets van uitgaan.
- **Rate limiting.** Desk werkt met credits per 24 uur; CRM werkt met calls per dag per gebruikerslicentie. Andere modellen, andere headers.
- **Paginering.** Desk heeft `from`/`limit` en het 4999-plafond. CRM gebruikt `page`/`per_page` met een `info`-object dat `more_records` bevat. Deel geen paginatiecode tussen producten zonder dat expliciet te abstraheren.
- **Responsvorm.** Desk geeft `{data: [...]}` en een 204 bij leeg; andere Zoho-producten geven `{code, message, data}`-structuren.

**Gehoste MCP-servers van Zoho zelf** (peildatum 21-08-2026): beschikbaar voor **CRM, Payments, Cliq, Assist en Analytics**. **Niet voor Desk.** De CRM-endpoints hebben de vorm `https://zoho-crm-<service>-<orgid>.zohomcp.in/mcp/<token>/message` en worden als custom connector toegevoegd. Hercheck dit periodiek; als er een Desk-variant bijkomt, verandert de bouw-of-koop-afweging voor Desk-tooling wezenlijk.

---

## 13. De tien valkuilen, samengevat

Als je één sectie onthoudt, deze.

1. **`from` mag maximaal 4999.** Lineair uitpagineren over een groot archief is onmogelijk. Segmenteer op tijd of gebruik een watermerk-cursor — vanaf het begin, niet als latere optimalisatie.
2. **`Authorization: Zoho-oauthtoken`, niet `Bearer`.** De 401 die je anders krijgt, ziet uit als een tokenprobleem.
3. **Verkeerd datacenter geeft 401 met een geldig token.** Gebruik `api_domain` uit de tokenrespons in plaats van een geconfigureerde host.
4. **Max 20 refresh tokens per gebruiker per client, en het oudste wordt stil ongeldig.** Eén integratie-account, één client, één keer autoriseren.
5. **Eén onbekende scope laat de hele autorisatie mislukken.** En `Desk.contacts.ALL` bestaat niet.
6. **Search-endpoints hebben `Desk.search.READ` nodig** bovenop de module-scope, en `from` is daar 0-gebaseerd terwijl lijst-endpoints 1-gebaseerd zijn.
7. **`GET /tickets` geeft geen `count`, geen `hasMore` en geen datumfilter**, en de listview mist `modifiedTime` en `cf`. Een 204 is je einde-signaal. Voor tijdfilters en custom fields: `/tickets/search`.
8. **Het ticketobject heeft geen `tags`-veld**, alleen `tagCount`. En er is geen "exclude tag"-filter — gebruik `tag=${Empty}`/`${NotEmpty}` of trek `/tags/{tagId}/tickets` van je resultaat af.
9. **`/ticketFields` bestaat niet** — het is `organizationFields?module=tickets`. En daar komen ook de ticketstatussen uit; er is geen apart statussen-endpoint.
10. **Een veld dat het integratieprofiel niet mag zien, ontbreekt stilzwijgend** in de respons. Vergelijk `organizationFields` met een echte respons om dat te diagnosticeren.

**Bonus, uit de categorie "kost je een middag":** `associateTag` én `dissociateTag` vragen `Desk.tickets.CREATE`; `PATCH` op een comment kan `isPublic` niet wijzigen; `commentedTime` heet niet `createdTime`; comments gebruiken `contentType: plainText|html` en threads `text/plain|text/html`; en `PUT /tickets/{id}` bestaat niet — het is `PATCH`.
