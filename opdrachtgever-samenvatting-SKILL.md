---
name: opdrachtgever-samenvatting
description: Gebruik deze skill ALTIJD wanneer je Brent een technisch document ter review voorlegt — een spec, een implementatieplan, een codewijziging, een bugfix-samenvatting, een technisch rapport, of eender welk ander stuk dat uitleg over code/architectuur bevat. Brent is de opdrachtgever/klant, geen programmeur: hij kan geen code lezen of schrijven. Trigger dit ook al vraagt hij niet expliciet om een samenvatting — telkens je normaal gezien zou zeggen "lees dit bestand en laat weten of het klopt" is dit skill van toepassing. Geldt voor élk project waarin je met Brent werkt, niet enkel een specifiek project.
---

# Opdrachtgever-samenvatting

Brent is de opdrachtgever/klant, niet de ontwikkelaar. Hij kan geen code lezen of schrijven, en heeft geen boodschap aan bestandsnamen, regelnummers of technisch jargon. Wanneer je hem iets ter review voorlegt, is jouw taak niet "hier is het document", maar "hier is wat het voor jou betekent".

## Waarom dit belangrijk is

Brent gaf deze feedback nadat hij een volledige technische spec moest doorworstelen om te snappen wat er ging veranderen. Zonder samenvatting kost het hem tijd en moeite om te ontdekken wat hij eigenlijk moet weten — en het risico bestaat dat hij iets goedkeurt zonder de kernpunten echt gezien te hebben, of net vastloopt op iets wat hem niet aanging.

## Wat te doen

Telkens je een technisch stuk (spec, implementatieplan, codewijziging, bugfix, rapport, ...) aan Brent voorlegt ter review of goedkeuring:

1. **Ga uit van zijn rol als opdrachtgever.** Schrijf zoals je zou uitleggen aan iemand die de app laat bouwen, niet aan iemand die hem bouwt.
2. **Geef eerst een korte samenvatting in bullet points, in gewone mensentaal.** Geen code, geen bestandsnamen met regelnummers, geen jargon (geen "functie", "endpoint", "refactor", "sorteren op localeCompare" — vertaal dat naar wat het concreet betekent, bv. "de volgorde klopt straks").
3. **Wijs expliciet aan wat zijn aandacht nodig heeft.** Niet zomaar alles netjes oplijsten — benoem waar hij moet stilstaan: een beslissing die hij moet nemen, een neveneffect dat hem aangaat, iets dat afwijkt van wat hij verwachtte, een compromis of beperking. Dat is het deel dat er echt toe doet, niet de volledige inhoudsopgave.
4. **Het volledige technische document/de link mag er nog bijstaan** (voor het archief of als iemand anders het later wil nalezen), maar altijd ná de samenvatting en nooit als het hoofdantwoord — hij is niet verplicht het te openen.

## Voorbeeld

Slecht (wat je niet meer moet doen):
> Spec staat in `docs/specs/2026-07-27-feature.md`. Laat maar weten of dit klopt.

Goed:
> Kort samengevat:
> - Interventies en afspraken komen straks netjes op volgorde van tijdstip te staan.
> - Je kan voortaan ook een rapport aanmaken bij afspraken die je zelf toevoegt, niet enkel bij tickets uit Zoho — behalve bij installaties, dat komt later.
> - Let op: zo'n rapport komt dan niet automatisch in Zoho terecht, enkel in het rapporten-archief van de app zelf.
>
> Volledige technische spec (niet verplicht om te lezen): [link]
> Klopt dit zo?

## Wanneer dit niet geldt

Als Brent zelf expliciet om de technische details vraagt ("toon me de code", "wat staat er precies op regel X"), mag je uiteraard wel technisch/specifiek antwoorden — deze skill gaat over het standaard-format bij een review-moment, niet over een verbod op techniek wanneer hij er zelf naar vraagt.
