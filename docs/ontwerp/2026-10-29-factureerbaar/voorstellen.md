# Factureerbaar: vijf voorstellen (29 oktober 2026)

Waarom het blok nu niet past: het is een brede kaart met enkel een lange uitlegzin en een kale lijst. Er staat geen groot cijfer
en geen grafiek in, terwijl de rest van het dashboard tegels en grafieken toont. Zo lijkt het een los tekstvak, geen deel van het dashboard.
(Een blok met maar één kaart wordt altijd zo breed als het scherm; een brede kaart moet dus ontworpen zijn om die breedte te vullen.)

In elk voorstel hieronder:
- staan alle bedragen in hele euro's (€ 2.314, € 844, € 1.470), dus niet meer € 2.314 naast € 843,63;
- staat "1 onderdeel zonder prijs **telt** als € 0" (dat was "tellen");
- is de uitleg kort: een i-knopje, een korte regel of een stukje dat openklapt, geen alinea.

Bekijken: open `mockups.html` in deze map in de browser (met de knoppen bovenaan kies je licht of donker).
Voor de gsm-weergave: maak het venster smal en laad de pagina opnieuw. Per voorstel zijn er ook schermafdrukken: `A-pc.png`, `A-gsm.png`, enzovoort.

---

## A · Tegelrij

**Wat je ziet:** vier tegels, net als de kerncijfers bovenaan het dashboard: Factureerbaar € 2.314, Onderdelen € 844,
Loon € 1.470 en Niet aangerekend 31u53. De uitleg zit achter een i-knopje naast de titel, de twee aandachtspunten staan in één korte regel eronder.
**Voordelen:** past meteen in de stijl, want het zijn dezelfde tegels als bovenaan; alles is in één oogopslag te lezen.
**Nadelen:** het totaal springt er niet uit (vier even grote cijfers) en het dashboard krijgt nog een rij tegels erbij.

## B · Groot bedrag met verdeelbalk *(aanbevolen)*

**Wat je ziet:** één kaart met het factureerbare bedrag groot links (€ 2.314, excl. btw). Rechts een balk die toont welk deel uit
onderdelen (36 %) en welk deel uit loon (64 %) komt, met de bedragen en de uren ernaast. Onderaan in kleine letters: wat niet aangerekend is en de aandachtspunten.
**Voordelen:** het belangrijkste cijfer valt meteen op, de balk legt de verdeling uit zonder tekst en gebruikt dezelfde kleuren als de andere grafieken; op de gsm staat alles netjes onder elkaar.
**Nadelen:** de kaart blijft over de volle breedte gaan. Hier is ze daarvoor ontworpen (bedrag links, verdeling rechts), dus ze oogt niet leeg.

## C · Twee donuts

**Wat je ziet:** twee kleinere kaarten naast elkaar, zoals de donut bij Sales. Links het bedrag als donut (onderdelen en loon),
rechts de werk- en rijtijd als donut: 10u56 aangerekend en 31u53 niet aangerekend (garantie of installatie), samen 42u49.
**Voordelen:** het meest "dashboard"; je ziet meteen dat het grootste deel van de uren niet aangerekend wordt.
**Nadelen:** twee grafieken lezen vraagt meer moeite dan één cijfer. Een donut met "niet aangerekend" kan ook overkomen als een score (goed of slecht), en dat is het niet.

## D · Opbouw zoals een factuur

**Wat je ziet:** links een kaart die het bedrag opbouwt zoals op een factuur: Onderdelen € 844, Loon € 1.470, een streep en dan
**Totaal excl. btw € 2.314**. Onder "Hoe wordt dit berekend?" klapt de uitleg open. Rechts een kleine kaart "Niet aangerekend: 31u53".
**Voordelen:** heel duidelijk voor wie facturen kent: je ziet hoe het totaal tot stand komt; rustig en compact.
**Nadelen:** het blijft vooral tekst en cijfers, zonder beeld, dus het valt minder op tussen de grafieken.

## E · In de kerncijfers bovenaan

**Wat je ziet:** geen apart blok meer. Bovenaan wordt de tegel "Waarde onderdelen" vervangen door een tegel "Factureerbaar"
(€ 2.314) met een kleine verdeelbalk en de bedragen van onderdelen en loon eronder. De uitleg en wat niet aangerekend is staan bij de kleine voetnoten onderaan het dashboard.
**Voordelen:** het meest geïntegreerd: het factureerbare bedrag staat tussen de andere kerncijfers, en het dashboard wordt korter.
**Nadelen:** de tegel "Waarde onderdelen" verdwijnt (de waarde van alle onderdelen staat nog wel bij Top 10 onderdelen); "niet aangerekend" zie je enkel in de voetnoten. Wil je net als bij de andere tegels "↑ 12 % hoger dan de vorige periode" zien, dan moet de server daarvoor ook de vorige periode berekenen.

---

## Mijn aanbeveling: B

B lost het probleem het meest rechtstreeks op. Er is één duidelijk getal (wat je kunt factureren), en de balk legt zonder uitleg uit
waar het vandaan komt. De stijl is die van de andere kaarten en grafieken, en de kleine lettertjes staan pas onderaan.
Wil je het blok liever helemaal kwijt, kies dan E. Wil je het zo eenvoudig mogelijk en zonder grafiek, kies dan D.

Het gekozen voorstel bouwen we later op een eigen tak; deze map bevat enkel tekeningen, nog geen wijziging in de app.
