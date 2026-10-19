# Blitz Planning op Azure — kansen, verbeteringen & nieuwe functies

_Verkennend document, opgesteld 2026-10-16. Er is nog niets gebouwd of aangemaakt — dit is puur een rondkijk- en denkoefening._

---

## Kort samengevat (lees dit eerst)

- Je hebt een **eigen Azure-abonnement** ("Azure Blitz Power - BMS") onder de werk-tenant **Hertsens Transport**. Er staat vandaag maar **één ding** in: je **KB** (kennisbank), als een Static Web App.
- **De planner kan hier perfect naast**, als een **aparte tool** — en Azure biedt ons meteen een paar dingen die op Netlify niet (of moeilijker) konden.
- **Waar je op moet letten / wat jouw aandacht vraagt:**
  - Je kan wél zelf dingen aanmaken, maar je hebt **geen inzage in de facturatie** — die ligt bij IT/het werk. Kosten en budget moeten we dus mét hen afstemmen.
  - De **beveiliging staat nog "kaal"**: Microsoft Defender staat uit en er zijn (voor zover ik zie) geen budget-waarschuwingen ingesteld. Niet dringend voor een test, wél iets om te regelen vóór het echt live gaat.
  - De grote winst zit in **betrouwbaarheid en inzicht** (betere achtergrondverwerking, back-ups van je data, zien wat traag is), en op termijn in **nieuwe functies** (KB en planner koppelen, eventueel AI).
- **Beslissing voor jou:** niets nu — dit is om te lezen en te kiezen wat je interessant vindt. Als je wil, zet ik daarna een **gratis testomgeving** op.

---

## Deel 1 — Wat je in Azure ter beschikking hebt (voor de planner relevant)

| Dienst | Wat het is | Voor ons |
|---|---|---|
| **Static Web Apps** | Hosting voor websites zoals de planner-app, mét ingebouwde koppeling naar GitHub en gratis SSL | **Kern** — hier draait de planner-website (net als de KB) |
| **Azure Functions** | De kleine backend-stukjes (inloggen, plannen, voorstel sturen …) | **Kern** — vervangt de huidige Netlify-functies |
| **Opslagaccount / Blob Storage** | Opslag voor je gegevens (nu bij Netlify) als bestandjes/JSON | **Kern** — hier komt alle planningsdata |
| **Storage Queues** | Een "wachtlijn" voor taken die op de achtergrond mogen gebeuren | Betere, betrouwbaardere rapportverwerking |
| **Container Apps** | Draait een los stukje in een eigen omgeving, schaalt vanzelf naar nul | Voor het **PDF-maken** (het moeilijkste stuk) |
| **Key Vault** | Een kluis voor wachtwoorden en sleutels | Veiliger bewaren van de Zoho/TomTom-sleutels |
| **Application Insights / Monitor** | Meet- en logboekdienst: zie fouten, traagheid, gebruik | **Nieuw inzicht** dat we nu missen |
| **Front Door / CDN** | Versnelt en beschermt de website wereldwijd | Optioneel: sneller + externe bibliotheken zelf hosten |
| **Azure AI Foundry** | Platform voor AI-functies (je ziet "Foundry" staan) | Mogelijke **nieuwe functies** op termijn |
| **Microsoft Entra** | De werk-logins (Microsoft 365-account) | Optioneel: inloggen met je werkaccount |

Diensten die je ook ziet maar die wij **niet** nodig hebben: **Virtuele Machines** (volledige servers, te veel onderhoud) en **SQL-databases** (de planner gebruikt geen klassieke database). Die laten we links liggen.

---

## Deel 2 — Inventaris: wat moet waar naartoe?

| Onderdeel van de planner (nu op Netlify) | Gaat naar (Azure) | Opmerking |
|---|---|---|
| De website zelf (`public/`) | **Static Web App** (eigen, los van de KB) | Zelfde aanpak als de KB |
| De ~50 backend-functies | **Azure Functions** (gekoppeld aan de Static Web App) | Code grotendeels herbruikbaar |
| Alle gegevens (planning, gebruikers, instellingen …) | **Blob Storage** (één opslagaccount) | Data moet mee verhuizen én gecontroleerd worden |
| De taak die elke 5 min draait | **Functions Timer** | Nettere aanpak dan nu |
| De achtergrond-rapportverwerking | **Functions + Storage Queue** | Betrouwbaarder, met automatische herpoging |
| Het PDF-maken (Chrome in de cloud) | **Container App** met Playwright | Het grootste werk — apart aanpakken |
| De geheime sleutels (Zoho, TomTom …) | **Key Vault** | Veiliger dan nu |
| Externe bibliotheken (kaart, Excel, fonts) | Blijven van internet, of **zelf hosten** | Keuze afhankelijk van het bedrijfsnetwerk |
| Zoho Desk & TomTom | **Blijven ongewijzigd** | Draaien buiten Azure, worden enkel aangeroepen |

---

## Deel 3 — Wat kan in Azure béter of anders dan hiervoor?

Dit zijn echte verbeteringen die Netlify niet (goed) bood. Geen van alle verplicht, maar wel interessant.

1. **Veiliger opslaan van wijzigingen.** Nu gebruikt de app een omweg om te vermijden dat twee mensen elkaars wijziging overschrijven (Netlify kon dat niet netjes). Azure kan dat wél ingebouwd — **minder kans dat een planning-wijziging verloren gaat** wanneer twee mensen tegelijk werken.

2. **Betrouwbaardere rapportverwerking.** De huidige "achtergrondtaak" is een truc. Met een echte **wachtlijn** worden rapporten netjes één voor één verwerkt, en **mislukt er iets, dan probeert Azure het vanzelf opnieuw**. Minder kans dat een rapport "blijft hangen".

3. **Zien wat er gebeurt (inzicht).** Vandaag heb je nauwelijks zicht op fouten of traagheid. Met **Application Insights** zie je: welke schermen traag laden, welke fouten gebruikers krijgen, hoe druk het is. Dat maakt problemen **vroeger zichtbaar** en makkelijker op te lossen.

4. **Automatische back-ups van je data.** Azure-opslag kan **oude versies bewaren** en **per ongeluk verwijderde data terughalen** (soft-delete, versioning, herstel naar een tijdstip). Je gegevens zijn daarmee **beter beschermd dan nu**.

5. **Sleutels in een kluis.** De Zoho/TomTom-sleutels gaan in **Key Vault**, en de app haalt ze op zonder dat ze ergens "los" in een instelling staan. Veiliger, en makkelijker te vervangen.

6. **Testomgevingen per wijziging.** Static Web Apps maakt **automatisch een aparte voorbeeldversie** bij elke wijziging/branch. Zo kan je iets **uitproberen op een eigen adres** vóór het naar de echte planner gaat — handiger en veiliger dan nu.

7. **Minder afhankelijk van externe CDN's.** We kunnen de kaart- en Excel-bibliotheken **zelf mee hosten**. Dan werkt de app ook als het bedrijfsnetwerk bepaalde externe sites blokkeert, en laadt hij vaak **sneller**.

8. **Robuustere PDF-aanpak.** De PDF-generatie wordt opnieuw gebouwd op een manier die **stabieler schaalt** (schaalt terug naar nul als er niets te doen is, dus geen extra kost in rust, maar betrouwbaarder onder druk).

---

## Deel 4 — Nieuwe functies die Azure mogelijk maakt (kansen)

Puur ter inspiratie — dit zijn dingen die nú binnen bereik komen omdat alles bij elkaar in Azure staat. Niets hiervan is beslist.

- **KB en planner koppelen.** Je KB en de planner zitten straks onder één dak. We zouden bv. bij een ticket meteen **relevante KB-artikels** kunnen tonen aan de technieker, of andersom.
- **AI-ondersteuning** (via Azure AI Foundry, dat je al hebt staan): denk aan **automatisch samenvatten** van een ticket, **slimme suggesties** voor planning of oorzaak, of **beter zoeken** in de KB. Dit sluit aan bij het werk dat je al met tickets/charX-logs doet.
- **Betere dashboards.** Met de data netjes in Azure kunnen we **rijkere rapportage en grafieken** maken (prestaties, doorlooptijden, sales), eventueel gedeeld met collega's.
- **Automatische meldingen/mails** via Azure (als aanvulling op Zoho) — bv. interne verwittigingen.
- **Inloggen met je werkaccount** (Microsoft 365 / Entra) als je ooit af wil van aparte wachtwoorden — optioneel.
- **Extra betrouwbaarheid**: data op **meerdere locaties** bewaard (geo-redundant), zodat één storing geen gegevensverlies geeft.

---

## Deel 5 — Aandachtspunten voor jouw situatie

1. **Facturatie ligt niet bij jou.** Je kan resources maken, maar niet de kosten/facturen zien. Alles met een prijskaartje (het betalende plan, het PDF-stuk) stemmen we af met IT/het werk.
2. **Beveiliging nog in te stellen.** Defender staat uit, en budget-waarschuwingen lijken er niet te zijn. Prima voor een gratis test, maar vóór een echte livegang zetten we dit mee op orde (met IT).
3. **De repo staat op je persoonlijke GitHub.** Voor een werk-Azure wil IT dit misschien anders geregeld zien (werk-account of een aparte koppeling).
4. **Alles blijft voorlopig voorstel.** Er is niets gebouwd. We kiezen eerst samen wat de moeite is, en pas daarna — met jouw akkoord — zetten we een gratis testomgeving op.

---

## Aanbevolen volgorde (als/wanneer je wil starten)

1. **Gratis testomgeving**: een eigen resourcegroep + test-Static Web App + klein opslagje (kost ~niets).
2. **De data-laag** als één centraal stuk omzetten en apart testen.
3. **Het PDF-stuk** als los deelproject bewijzen.
4. **Inzicht + back-ups + kluis** inschakelen.
5. Pas daarna de knopen doorhakken over het betalende plan en de echte livegang (met IT).

> We bouwen nu nog niets — dit document is om te lezen en te kiezen welke kansen je de moeite vindt.
