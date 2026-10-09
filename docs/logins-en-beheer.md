# Inloggen en beheer: wat je moet doen

Dit document is voor Brent. Het legt in gewone taal uit wat je moet instellen en doen om het inloggen live te zetten. Je hoeft geen code te lezen of te schrijven. Alles gebeurt in Netlify en in de app zelf.

## Wat is er nieuw

- Iedereen logt in met een e-mailadres en een wachtwoord.
- Er zijn vier rollen: beheerder, planner, technieker en sales.
- Alleen de beheerder ziet de tab Beheer. Daar maak je gebruikers aan, pas je instellingen aan en bekijk je wat er gebeurd is.
- Een sessie blijft 30 dagen geldig. Daarna moet je opnieuw inloggen.
- Na vijf foute pogingen wordt het account tijdelijk vergrendeld.

## Wie mag wat (kort)

Een planner past de instellingen van techniekers aan en elke wijziging staat in het activiteitenlog. De beheerder past alle instellingen aan. Sales en technieker passen enkel hun eigen instellingen aan.

Een technieker ziet de tickets en afspraken van collega's, maar alleen om te lezen. De knoppen Aankomst, Foto's en Rapport staan enkel bij eigen werk. Planners en beheerders zien die knoppen overal.

## Stap 1: drie instellingen in Netlify

Een omgevingsvariabele is een instelling die de app uit Netlify haalt. Zo zet je ze:

1. Ga naar Netlify en open de site van Blitz Planning.
2. Kies Site configuration, daarna Environment variables.
3. Klik op Add a variable en voeg de variabelen hieronder toe.
4. Na het toevoegen moet je de site opnieuw laten publiceren (Deploys, dan Trigger deploy). Pas dan zijn de nieuwe waarden actief.

### SESSIE_GEHEIM (verplicht)

- Dit is een lange, willekeurige tekst van minstens 32 tekens.
- Zonder deze variabele kan niemand inloggen.
- Verzin zelf iets lang met letters en cijfers door elkaar, of laat een wachtwoordbeheerder er een maken.
- Bewaar hem op een veilige plek en deel hem met niemand.
- Wijzig je hem later, dan worden alle ingelogde mensen meteen uitgelogd en werkt de beveiliging van de achtergrondverwerking van rapporten met de nieuwe waarde. Doe dat dus alleen met een reden.

### BEHEER_SETUP_CODE (tijdelijk, voor de eerste keer)

- Dit is een tijdelijke code. Je gebruikt ze maar één keer, om het allereerste beheerdersaccount te maken.
- Kies een code die je kunt onthouden maar niemand kan raden.
- Als je eigen account bestaat, mag je deze variabele uit Netlify verwijderen.

### BEHEER_HERSTELSLEUTEL (optioneel, enkel voor noodgevallen)

- Dit is een noodsleutel van minstens 32 tekens.
- Je hoeft hem nu niet in te stellen. Je zet hem alleen in Netlify als je hem echt nodig hebt (zie "Als alles misgaat" verderop).

### Wat je NOOIT in Netlify instelt

Zet **BLITZ_LOKALE_DEV** nooit in Netlify. Zet ook **NETLIFY_DEV** niet. Die staan alleen op je eigen computer voor het testen. Staan ze op Netlify, dan valt de bescherming van de testrol weg en kan iedereen zich als beheerder voordoen. Staan ze er per ongeluk, verwijder ze dan meteen.

## Stap 2: live zetten, in deze volgorde

1. Zet de variabelen uit stap 1 in Netlify en publiceer de site.
2. Open de app in je browser. Je ziet een scherm om het eerste beheerdersaccount aan te maken.
3. Vul je naam, je e-mailadres, een wachtwoord (minstens 10 tekens) en de setupcode in.
4. De app toont nu **tien herstelcodes**. Dit scherm zie je maar één keer. Bewaar ze voor je verdergaat (zie "Herstelcodes bewaren").
5. Log in en open de tab Beheer, dan Gebruikers.
6. Maak de andere accounts aan met de knop Nieuwe gebruiker: eerst de planners, dan de techniekers, dan sales. Kies voor elke persoon de juiste rol. Bij een technieker vul je de naam in zoals die in Zoho staat. Zo weet de app welke tickets van hem zijn.
7. De app toont bij elke nieuwe gebruiker een startwachtwoord. Dat zie je maar één keer. Geef het persoonlijk door (mondeling of op papier, niet per mail of chat). De gebruiker moet het bij de eerste keer inloggen veranderen.
8. Verwijder BEHEER_SETUP_CODE uit Netlify.
9. Vraag een planner en een technieker om in te loggen en te kijken of ze de juiste tabs en knoppen zien.

Weet iemand zijn wachtwoord niet meer, dan klik je in Beheer, Gebruikers op Startwachtwoord opnieuw instellen. Je krijgt een nieuw startwachtwoord dat je weer persoonlijk doorgeeft. Met Overal uitloggen zet je iemand op alle toestellen buiten. Met Blokkeren kan iemand niet meer inloggen (bijvoorbeeld als hij het bedrijf verlaat).

## Herstelcodes bewaren

- Je hebt er tien. Elke code werkt één keer.
- Druk het scherm af met de knop in het scherm en leg het papier in een kluis of een afgesloten kast.
- Bewaar ze niet in je mailbox, niet in een gedeelde map en niet in een foto op je gsm.
- Zijn er bijna geen codes meer, dan kun je in Beheer, Gebruikers nieuwe codes voor jezelf laten maken (de app vraagt dan je wachtwoord ter bevestiging). De oude codes werken dan niet meer.

## Als je je wachtwoord vergeten bent

Alleen beheerders kunnen zelf hun wachtwoord herstellen:

1. Klik op het inlogscherm op Wachtwoord vergeten (beheerder).
2. Vul je e-mailadres in en één van je herstelcodes.
3. Kies een nieuw wachtwoord.

Planners, techniekers en sales vragen aan de beheerder om een nieuw startwachtwoord.

## Als alles misgaat (de noodroute)

Dit is voor het geval je geen werkend wachtwoord meer hebt en ook geen herstelcodes meer. Dan gebruik je Netlify als noodingang:

1. Verzin een noodsleutel van minstens 32 tekens.
2. Zet hem in Netlify als variabele **BEHEER_HERSTELSLEUTEL** en publiceer de site opnieuw.
3. Open de app, kies Wachtwoord vergeten (beheerder) en vul je e-mailadres in. Plak de noodsleutel in het veld voor de herstelcode. Kies een nieuw wachtwoord.
4. De sleutel werkt maar één keer. Wil je hem opnieuw gebruiken, dan moet je een nieuwe verzinnen.
5. **Verwijder de variabele daarna weer uit Netlify** en publiceer opnieuw. Een noodsleutel die blijft staan is een open deur.

## Beveiliging van je eigen Netlify-login

Wie in Netlify kan, kan alles instellen. Zet daarom tweestapsverificatie aan op je eigen Netlify-account (in je Netlify-profiel onder Security). Dat is dringend aan te raden.

## Wat de beheerpagina toont

- **Gebruikers:** wie een account heeft, met rol en laatste login, en de knoppen hierboven.
- **Instellingen:** de instellingen van de gebruikers.
- **Activiteitenlog:** wie wat deed en wanneer: inloggen, foute pogingen, wijzigingen van gebruikers en instellingen, foto's, notities en rapporten. Het log wordt 12 maanden bewaard.
- **Systeemstatus:** of de verbinding met Zoho werkt, de laatste fouten van de app en rapporten die niet verwerkt raakten.

## Sales: verkopers aanmaken en hoe zij werken

De sales-planner is het deel van de app waarmee een verkoper zijn eigen bezoeken plant. De handleiding hieronder gaat over het inloggen en de rollen; de werking staat in de CHANGELOG.

**Een verkoper aanmaken (jij, de beheerder)**

1. Open Beheer, dan Gebruikers, en klik op Nieuwe gebruiker. Kies de rol Sales.
2. Vul het veld **Naam in export** in: precies de naam die als verantwoordelijke in het exportbestand van zijn leadlijst staat. De app gebruikt die naam om te waarschuwen als iemand per vergissing de export van een collega inlaadt (dat kan nog, na een bevestiging). Zonder die naam kan je geen verkoper aanmaken.
3. Vink **Mag alle sales zien** enkel aan voor wie de leads van collega's moet kunnen bekijken (bijvoorbeeld een verkoopsverantwoordelijke). Hij kan dan een collega uit een lijst kiezen en ziet diens leads, maar alleen om te lezen: hij kan niets verwijderen, plannen of inladen voor een ander. Zonder het vinkje ziet een verkoper uitsluitend zijn eigen leads.
4. Geef het startwachtwoord persoonlijk door, zoals bij elke gebruiker.

Een verkoper ziet enkel de vier tabs Leads, Kalender, Route en Afgewerkt. Planners en techniekers zien niets van sales, en de server weigert hun verzoeken. Jij ziet als beheerder één tab **Sales** met dezelfde vier onderdelen en een lijst om een verkoper te kiezen. Je mag er iets wijzigen, maar je kan geen export inladen: dat doet de verkoper zelf.

**Hoe een verkoper een export inlaadt (de verkoper zelf)**

1. Exporteer de leadlijst uit het bronsysteem als bestand (.json).
2. Open de tab Leads en klik op **Export laden**. Kies het bestand.
3. De app meldt hoeveel leads nieuw zijn, hoeveel er al waren en voor hoeveel het adres nagekeken moet worden. Laad je dezelfde of een nieuwere export nog eens in, dan komt niemand dubbel in de lijst en blijft wat je zelf bijschreef staan. Een lead die je eerder wegklikte en die opnieuw in de export staat, komt terug met het label "eerder verwijderd"; jij beslist.
4. Is de export van een andere verantwoordelijke, dan vraagt de app eerst of je hem toch wilt inladen.

**Hoe een verkoper zelf een lead toevoegt**

Klik op **+ Lead** in de tab Leads en vul minstens de naam, een gsm of e-mailadres en de postcode in. Een notitie kan er altijd bij. Komt de klant later ook in een export voor, dan wordt hij samengevoegd met deze lead.

**Hoe een verkoper zijn week plant**

1. In **Leads** staan alle leads die nog niet afgewerkt zijn, in drie kolommen naast elkaar: **Nog in te plannen** (de langst wachtende bovenaan, ook een voorstel waarvan de dag voorbij is), **Ingepland** (voorgestelde bezoeken, met een knop **Bevestigen**) en **Bevestigd** (vaste bezoeken). Elke kolom toont hoeveel leads erin staan; op een telefoon zijn het drie tabbladen. Op een lead kan je **bellen** (tik op het nummer), een notitie bijschrijven of het adres aanpassen.
2. Wil je een bezoek op een vast uur, zet dan een **vast uur** op die lead. Het planningsprogramma schuift er dan niets meer aan.
3. Klik op **Plan deze week**. De app maakt een voorstel voor de bezoeken van de week, rekening houdend met je werkuren, rittijden en vaste uren. Een bezoek staat eerst als **voorgesteld**; bevestig het om het vast te leggen.
4. De tab **Kalender** toont de week, **Route** toont de rit van een dag op de kaart met de rijtijden.
5. Na een bezoek noteer je het **resultaat**: Offerte, Verkocht, Geen interesse of Opnieuw langsgaan (dan komt de lead terug bij Nog in te plannen). Bij de eerste drie is de lead **Afgewerkt**; hij verdwijnt uit Leads en staat in de tab Afgewerkt. Leads, blokken en bezoeken worden 12 maanden na de laatste activiteit bewaard en daarna vanzelf gewist (ook niet afgewerkte leads; ook bij een geblokkeerde verkoper).

**Eigen instellingen**

Een verkoper stelt zijn startadres, werkuren, laatste start en bezoekduur zelf in met de knop Instellingen. Als beheerder doe je dat voor een verkoper via Beheer, Instellingen.

## Een paar dingen om te weten

- Verstuurt een technieker een rapport onder de naam van een collega, dan wordt dat aanvaard. Het staat wel met zijn naam in het activiteitenlog.
- Botst het rapport met een rapport van iemand anders (zelfde id), dan wordt het geweigerd. Het blijft in de outbox van het toestel staan met de melding dat de planner verwittigd moet worden. Er gaat dus niets verloren.
- Deelt een tablet met meerdere mensen, log dan telkens uit. Onverzonden rapporten blijven altijd bewaard op het toestel.
- Op een tablet waar de app al draaide, krijgt de eerste persoon die inlogt de bestaande lokale instellingen van dat toestel. Laat dus op zo'n gedeelde tablet eerst de persoon inloggen die de instellingen hoort te hebben.
- De knop Opnieuw versturen op de tab Systeemstatus bestaat nog niet. Dat is een open punt waarover jij beslist.
