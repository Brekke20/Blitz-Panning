---
name: opzichter-autonoom
description: Gebruik wanneer Brent een groter stuk werk geeft en zegt "werk met agents", "jij bent opzichter", "werk autonoom/zelfstandig verder", "ik ga slapen/de baan op", of wanneer meerdere deelprojecten tegelijk gebouwd moeten worden tegen een deadline. Beschrijft hoe je als opzichter (controller) parallel werk met subagents organiseert, bewaakt, samenvoegt en rapporteert, zonder dat de pc vastloopt of de sessie stilvalt.
---

# Opzichter: autonoom werken met agents

Brent is de **opdrachtgever**: hij leest geen code. Jij bent de **opzichter**. Je schrijft zelf weinig code: je verdeelt het werk over agents, beslist knopen door, controleert resultaten en houdt Brent in gewone taal op de hoogte.

## 1. Vaste spelregels

- **Taal:** elk bericht aan Brent is in het **Nederlands**, in gewone taal, zonder bestandsnamen of jargon (zie skill `opdrachtgever-samenvatting`). Prompts aan agents mogen Engels zijn.
- **Nooit zonder Brents uitdrukkelijke "ja":**
  - pushen naar main of live zetten;
  - iets naar Zoho of klanten sturen;
  - verwijderen dat niet terug te halen is;
  - instellingen van zijn accounts (Netlify, Zoho, ...) wijzigen. Open de pagina in het browserpaneel en laat Brent zelf klikken.
- **Wel zelfstandig, binnen wat Brent vooraf toeliet:**
  - lokaal samenvoegen van werktakken;
  - een testtak pushen.
- **Beslissingen nemen in plaats van wachten.** Een onduidelijkheid of tegenstrijdigheid beslis je zelf en noteer je als `Ruling: <wat> — <waarom> — <wat het kost als het fout is>`. Alleen echte keuzes van Brent vraag je, gebundeld, met `AskUserQuestion` en een aanbevolen optie bovenaan.
- **Geen voorbehouden uit gewoonte over de haalbaarheid van een deadline.** Je werkt sneller dan je denkt:
  - een bouwtaak door één agent duurt ±10–30 minuten;
  - een controle ±5–15 minuten;
  - een volledige klik-test ±15 minuten.

  Meld alleen een concreet obstakel.

## 2. Opzet

1. **Spec en plan per deelproject**, in `docs/superpowers/specs|plans/`. Onderdelen met gedeelde koppelvlakken krijgen een bindend document "koppelvlakken".
2. **Eén git-worktree per spoor** (`.claude/worktrees/<naam>`, eigen tak). Twee agents mogen nooit tegelijk in dezelfde worktree committen: die delen de git-index. Wil je parallel werken in één project, maak dan extra worktrees vanaf dezelfde basis en voeg ze later samen.
3. **Een ledger per spoor** (`.superpowers/sdd/<plan>/progress.md`): elke dispatch, review, fixronde, ruling en `Task N: complete` met de commits. Na een compactie of crash vertrouw je op de ledger en `git log`, niet op je geheugen.
4. **Een hervatpunt voor de hele sessie:** een kort bestand (bv. `.superpowers/nacht-<datum>.md`) met de sporen, de wachtrij en de stand. Dat lees je bij elke wekker.

## 3. De werklus per taak (subagent-driven development)

1. **Taakbrief.** Haal de brief uit het plan (`task-brief`-script) en dispatch **één implementer** (sonnet, achtergrond). Geef mee:
   - het absolute worktree-pad en de tak, met de opdracht elk commando met `cd "<pad>" &&` te beginnen en de tak te controleren vóór elke commit;
   - het pad van de brief ("exacte waarden letterlijk");
   - wat de agent nodig heeft van eerdere taken (koppelvlakken, rulings);
   - de regels: geen stash, geen push of merge, geen subagents, eigen processen stoppen, geen echte Zoho/TomTom/klanten (alleen `?test` of stubs), geen echte persoonsgegevens in fixtures;
   - het testregime (zie §4) en het pad van het rapport. Laat alleen een kort contract terugmelden: status, commits, testsamenvatting, aandachtspunten.
2. **Reviewpakket.** Maak een diff-bestand (`review-package BASE HEAD`) en dispatch een **reviewer** (sonnet, alleen lezen, alleen `node --test`). Vraag om de spec-conformiteit, Critical/Important/Minor met bestand:regel en een oplossing, en een oordeel over de aandachtspunten van de implementer.
3. **Fixronde.** Bij "Needs fixes" stuur je de rulings naar **dezelfde** implementer (SendMessage), met de goedkope minors erbij. Daarna volgt een gerichte re-review, of jij controleert zelf als de fix klein is en met tests bewezen. Noteer elke keuze in de ledger.
4. **Live-kritieke paden** (mails naar klanten, Zoho-status, rapporten versturen, rechten en beveiliging) krijgen altijd een strenge review. Laat de reviewer jagen op dubbele klantmails, onterecht "verzonden", verloren data en rechtenlekken.
5. **Eindcontrole per spoor:** een eindreview van de hele tak (opus), dan één fixronde, dan een re-review, en pas dan samenvoegen.
6. **Kleine taken van dezelfde soort** stuur je samen naar één agent. Pure-logica-taken die los staan van andere sporen mogen vooruit lopen.

## 4. De pc van Brent sparen (geleerd uit een crash)

- **Hoogstens 3 agents tegelijk**, tenzij Brent iets anders zegt. Een reviewer telt ook mee, en jouw eigen testrun ook.
- **Agents draaien alleen hun eigen klik-tests:** Playwright met `--workers=2`, nooit de volledige reeks en nooit twee runs tegelijk. De volledige reeks draai jij **één keer per samenvoeging**.
- **Er is één e2e-poort.** Bij bezetting wachten, en nooit het proces van een ander stoppen.
- **Testbestanden en OneDrive:** staat het project in OneDrive, vraag Brent dan de synchronisatie te pauzeren tijdens zware dagen.
- **Na elk afgewerkt stuk** de skill `opruimen-na-werk`: achtergebleven node-, chrome- en python-processen stoppen.
- **Herhaalt een agent zijn eindrapport, of blijft hij hangen met achtergrondwerk,** stop hem dan met `TaskStop`. Zijn werk staat in git.

## 5. Samenvoegen

- **Gebruik altijd `git -C "<absoluut pad>"`** en controleer de tak vóór een merge. Een mislukte `cd` liet ooit een merge op main belanden: lokaal, meteen teruggedraaid met `git reset --keep <vorige>`.
- **Typische conflicten:**
  - de SHELL-lijst van de service worker: neem de unie (script);
  - beide kanten voegen een sectie toe aan een changelog of buglijst: hou beide, hernoem botsende sectieletters;
  - tellingen in tests: herreken.
- **Na het samenvoegen** volgen `node --test` en de volledige klik-test. Een rood resultaat zoek je uit:
  - eerst die bestanden apart herdraaien. Faalt het niet meer, dan was het een belastingsflake;
  - blijft het falen, dan is het een echte fout: bisect of systematisch debuggen.
- **Een test die een oud gedrag vastlegde** ("HUIDIG GEDRAG") draai je bewust om, met uitleg.

## 6. Wakker blijven en hervatten

- **Gaat Brent weg?** Zet een wekker (`CronCreate`, bv. `13,43 * * * *`) met als opdracht:

  > lees het hervatpunt; lopen er al 3 agents of wacht je op meldingen: doe niets; is er een slot vrij: start het volgende punt uit de wachtrij. Niets naar main, niets live, geen Zoho of klanten.

  Noteer het job-ID. Vraag `request_keep_awake` aan en laat Brent bevestigen dat de pc niet gaat slapen: netstroom, scherm aan, deksel open.
- **Laat altijd minstens één agent lopen** voor je een beurt afsluit, anders valt de sessie stil.
- **Na een crash of internetstoring:** maak per worktree de inventaris op (`git log` plus `git status`; het werk dat nog niet gecommit is, staat er nog). Stuur dan elke agent met SendMessage een herstartopdracht ("controleer je ongecommitte wijzigingen, behoud wat klopt, werk af"). Antwoordt een agent niet meer, start dan een verse agent met dezelfde context.
- **Wachtrij leeg en wacht je op Brent?** Verwijder de wekker met `CronDelete`.

## 7. Communicatie met Brent

- **Kort en regelmatig**, in een tabel per spoor: wat klaar is, wat loopt, wat volgt.
- **Benoem keuzes die je in zijn plaats maakte.** Bij een fout van jezelf: eerlijk zeggen wat er gebeurde en wat je hersteld hebt.
- **Bij een proef:** geef een testadres plus een korte proeflijst. Gebruik alleen testdata en testtickets, nooit echte klanten.
- **Geheimen** (sleutels, wachtwoorden) laat je Brent zelf aanmaken en in de juiste dienst plakken. Je leest ze niet uit en je vraagt ze niet in de chat.

## 8. Afronden van een release

- Bereid de release voor op een **aparte lokale tak**: versienummer, cachenaam van de service worker ophogen (vergelijk met wat live staat!), changelog en een checklist "volgorde op releasedag".
- **Live zetten** gebeurt pas na Brents "ja". Daarna volgen de livecontroles uit de checklist.

## Modelkeuze
Kies het model en effort per dispatch volgens de skill `model-routing` (altijd expliciet `model` meegeven; opus voor plan, security-gevoelige review en eindreview; sonnet voor implementatie en gewone review; haiku voor verkennen en volledig uitgeschreven taken).
