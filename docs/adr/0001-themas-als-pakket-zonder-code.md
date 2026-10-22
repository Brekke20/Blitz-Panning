# Thema's zijn geüploade pakketten met enkel gegevens, zonder code

Thema's (Halloween, Kerst, Sinterklaas, ...) zaten vast in de code, waardoor elk nieuw thema een release vroeg. We maken een thema voortaan als themapakket dat de beheerder in Beheer uploadt, aan of uit zet en dat bewaard blijft. Een pakket bevat enkel gegevens: naam, jaarlijkse periode, kleuren, afbeeldingen, een keuze uit vaste bewegingen die de app zelf aanbiedt, en een spelskin. Het bevat nooit programmacode (JavaScript, vrije CSS of SVG met scripts). Een pakket draait immers bij elke gebruiker; met code zou één fout of kwaadaardig pakket de app kunnen laten vastlopen of gegevens kunnen lekken. Nieuwe soorten beweging of versiering voegen we toe aan de app zelf (een release); daarna kan elk pakket ze gebruiken.

## Considered Options

- **Pakket met eigen code**: verworpen, wegens het risico hierboven.
- **Thema-bouwer in Beheer zonder upload**: verworpen; Brent wil dat Claude rijkere thema's maakt als pakket.
- **Thema's in de code laten**: verworpen; elk thema zou een release blijven vragen.
