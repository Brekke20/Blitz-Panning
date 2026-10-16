---
name: "model-routing"
description: "Bepaalt welk Claude-model (Opus 5.5, Sonnet 5.5, Haiku 5.5, eventueel Fable 5.1) en welk effort-niveau het beste past bij een codeer- of ontwikkeltaak, om de beste prestaties tegen de laagste kosten te krijgen. Gebruik deze skill altijd wanneer Brent vraagt welk model hij moet gebruiken voor een taak, wanneer hij twijfelt tussen Opus/Sonnet/Haiku, wanneer hij een codeer-workflow, subagent-setup of development-flow opzet, of wanneer effort-niveau (low/medium/high/xhigh) ter sprake komt. Ook toepassen als achtergrondadvies bij het plannen van een grotere coding-taak, zelfs als Brent niet expliciet \"welk model\" vraagt."
---

# Model Routing voor Coding

Routeer coding-werk over Opus 5.5, Sonnet 5.5 en Haiku 5.5 op basis van taakcomplexiteit en de kosten van een fout. Fable 5.1 is de escalatie boven Opus.

Gecontroleerd tegen de officiële docs op 10 okt 2026. De routing-tabel is een werkhypothese op basis van positionering en community-praktijk, geen eigen benchmark: valideer in de eigen codebase.

## Modeloverzicht (alle: 1M context, 128K output, kennisgrens jun 2026)

| Model | Positionering | Prijs per MTok (in/uit) | Latency | Default effort |
|---|---|---|---|---|
| Haiku 5.5 | volume, latency-gevoelig, subagents | vanaf $0,10 / $0,50 (prompts ≤100K; erboven $0,50 / $2,50) | snelst | medium |
| Sonnet 5.5 | beste mix snelheid/intelligentie | $2 / $10 | snel | high |
| Opus 5.5 | langlopend agentic coding en kenniswerk | $4 / $20 | gemiddeld | medium |
| Fable 5.1 | zwaar redeneren, lange agentic taken | $10 / $50 | trager | high |

Opus kost nog maar ~2x Sonnet. Naar Opus escaleren is dus minder pijnlijk dan in eerdere generaties; Haiku is het grote kostenverschil (~20x goedkoper dan Sonnet op input).

## Kernprincipe

Opus plant en reviewt, Sonnet implementeert, Haiku verkent en doet mechanisch werk. Model- en effortkeuze is per taak, niet per sessie.

## Routing-tabel

| Taak | Model | Effort |
|---|---|---|
| Requirements uitwerken, systeemontwerp, architectuurkeuzes | Opus 5.5 | medium/high |
| Complexe debugging-strategie (root cause onduidelijk) | Opus 5.5 | high |
| Code review op kritieke/veiligheidsgevoelige logica, migraties | Opus 5.5 | high |
| Opus komt op hoge effort nog tekort | Fable 5.1 | high |
| Multi-step features, terminal/build-taken, agentic werk | Sonnet 5.5 | high (default) |
| Debugging waarbij meerdere bestanden samenhangen | Sonnet 5.5 | high |
| Features volgens een duidelijk, al uitgewerkt plan | Sonnet 5.5 | medium |
| Boilerplate, CRUD, simpele refactors | Sonnet 5.5 of Haiku 5.5 | medium |
| Grote codebase-analyse (500k+ tokens) | Sonnet 5.5 | medium/high |
| Codebase doorzoeken/samenvatten, logs/diffs/testoutput filteren | Haiku 5.5 | low/medium |
| Lint-fixes, rename, formatting, docs, tests voor triviale functies, bulk file-operaties | Haiku 5.5 | medium |
| Classificeren/routeren van taken, extractie | Haiku 5.5 | low |

## Standaardflow per feature

1. **Opus 5.5**: analyseer het probleem, stel plan/architectuur op met acceptatiecriteria (bij voorkeur toetsbaar via tests/build).
2. **Sonnet 5.5**: implementeer volgens het plan en draai zelf tests/terminal.
3. **Haiku 5.5**: verkenning vooraf en kleine losse klussen na afloop (cleanup, formatting, docs).
4. **Opus 5.5**: review vóór merge bij kritieke code, of wanneer een taak vastloopt.

## Haiku 5.5 als subagent

Haiku 5.5 is de eerste Haiku met effort-niveaus en is expliciet bedoeld voor subagent-taken.

- **Effort**: medium is de default en het startpunt, ook voor agentic coding. `low` alleen voor simpele, hoogvolume taken: daar slaat het model vaker een zoekactie, controle of het afronden over.
- **Vroegtijdig stoppen** (vooral low effort + lange agent-prompt): voeg toe aan de prompt: "Keep working until everything the user asked for is done, and only stop to ask when you can't go on without the user or before a risky step. Don't add features, docs or refactors that weren't asked for; mention them at the end."
- **Verificatie**: op low/medium meldt Haiku soms "klaar" zonder echte check. Voeg toe dat het na wijzigingen een echte check draait (tests, type-checker, build, het gewijzigde commando) en anders zegt welke check niet kon draaien. Syntax-only checks tellen niet.
- **Altijd verifiëren met tests/build**, niet op vertrouwen. Schuif taken waar een stille fout duur is (concurrency, protocollogica, security) niet naar Haiku.
- **Escalatieladder** (community-patroon): faalt een taak twee keer, ga één tier omhoog en geef het faalrapport mee. Haiku-tier niet blijven herhalen.
- **Onafhankelijke verifier**: laat een ander (goedkoop) model de diff beoordelen tegen de taakintentie. Waarschuwing uit de praktijk: een Sonnet-tier loste een tegenstrijdige test op met een teller die de test groen maakte maar de bedoeling schond. Groene tests bewijzen dus niet altijd correctheid.

## Effort-niveau

- Haiku/Opus defaulten op medium, Sonnet 5.5 op high. Begin op de default en schaal alleen omhoog bij falen.
- **Vermijd xhigh/max als default.** Denken en antwoorden worden dan veel langer. De Haiku-docs adviseren bij xhigh/max eerst Sonnet 5.5 te vergelijken op kwaliteit, kosten en snelheid. Reken door voordat je opschaalt; soms is direct naar een hoger model gaan goedkoper én beter.
- Haiku op xhigh in multi-turn: het kan het hele antwoord in de thinking schrijven en zonder zichtbare tekst eindigen. Controleer op lege antwoorden.
- In Claude Code via `/effort`; houd het niveau expliciet in de gaten.

## Technische valkuilen (Claude API)

- Nieuwe tokenizer: dezelfde tekst telt als ~30% meer tokens dan op Haiku 4.5. Herreken `max_tokens` en kostenramingen.
- Thinking-tokens tellen mee voor `max_tokens`; een te kleine limiet kan na het thinking-blok stoppen zonder tekst.
- Breaking tegenover Haiku 4.5: `budget_tokens` (gebruik adaptive thinking + effort), `temperature`/`top_p`/`top_k` weglaten, geen assistant-prefill (eindig `messages` met een user-turn).
- Eerdere thinking-blokken blijven in context en tellen als input; wijzig eerdere turns niet (houd conversaties append-only).
- Safety classifiers kunnen weigeren: handel `stop_reason: "refusal"` af in de client. Er is geen server-side fallback.
- Prompt caching: minimum 512 tokens op Haiku 5.5 (was 4.096). Gebruik het voor herhaalde context zoals codebase-structuur en conventies.

## Subagent-model instellen in Claude Code

Volgorde van resolutie (hoog naar laag, volgens community-uitleg, controleer in de officiële docs): `model`-parameter per aanroep, `model:` in de frontmatter van `.claude/agents/*.md`, `CLAUDE_CODE_SUBAGENT_MODEL`, sessiemodel.

- Aliassen `haiku`, `sonnet`, `opus` verwijzen naar specifieke versies; controleer welke versie een alias oplevert.
- **Bekende bug (GitHub issue 68392, Claude Code 2.1.177)**: met `CLAUDE_CODE_SUBAGENT_MODEL=inherit` draaiden subagents die `haiku` of `sonnet` hadden gekregen stilzwijgend op het sessiemodel (Opus). Gevolg: onverwachte kosten. Controleer na het instellen in de subagent-transcripts (`~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl`, grep "model") welk model echt draaide. Mogelijk inmiddels opgelost.
- `opusplan` (Opus plant, Sonnet implementeert) en de ingebouwde Explore-agent (Haiku, read-only) zijn gangbare, goedkope startpunten.

## Werkwijze in Brents projecten (aanvulling uit eerdere afspraken)

Deze regels komen uit eerdere correcties van Brent (memory `feedback_subagent_model_keuze`, sept. 2026) en uit de
opzichter-werkwijze (`opzichter-autonoom`). Ze vullen de tabel hierboven aan; bij tegenspraak geldt deze skill (nieuwer).

- **Altijd expliciet `model` meegeven bij elke Agent-aanroep.** Een weggelaten model erft het sessiemodel (Opus/Fable) en
  kost onnodig veel. Geen Opus voor verkenning (Brent: "overkill").
- **De hoofdsessie coördineert, schrijft geen implementatie.** Ze briefet, verifieert, reviewt diffs, merget en houdt de
  ledger bij. Zelf enkel triviale correcties (één regel, een commit, een memory). Implementatie gaat naar een subagent.
- **Concrete toewijzing in ons proces:**

  | Rol in het proces | Model | Effort |
  |---|---|---|
  | Verkennen, zoeken, samenvatten (Explore-agent) | haiku | medium |
  | Implementer van een taak die volledig uitgeschreven is (transcriptie + testen) | haiku | medium |
  | Implementer van een begrensde taak in proza, bugfix over meerdere bestanden | sonnet | high (default) |
  | Taakreview (spec + kwaliteit) van een gewone diff, scoped re-review | sonnet | medium/high |
  | Spec/architectuur, plan voor een groot of riskant onderdeel | opus | medium/high |
  | Review van security-gevoelige wijzigingen (login, rechten, rollen, wat de server toelaat, verwijderen van data, migraties) | opus | high |
  | Eindreview van een hele tak vóór merge/release | opus | high |
  | Opus komt tekort op een ontwerp- of debugprobleem | fable | high |

- **Escalatie:** faalt een subagent twee keer op dezelfde taak, de volgende poging één tier hoger en met het faalrapport
  erbij (zelfde regel als fixrondes 4-5 in subagent-driven-development).
- **Reviewers nooit onder sonnet** (te veel beurten, mist samenhang). Haiku enkel als er een objectieve check is (test/build).
- **Groene tests zijn geen bewijs van correctheid**: bij een taak die een bestaande test aanpaste, kijkt de reviewer
  expliciet of de test nog de bedoeling toetst.
- **Haiku-prompts** krijgen de zinnen over doorwerken tot alles af is en over een echte verificatiecheck (zie hierboven).
- **Laststapeling op Brents pc**: maximaal 3 agents tegelijk, Playwright altijd `--workers=2`, nooit twee volledige
  e2e-runs tegelijk (los van de modelkeuze, maar hoort bij elke dispatch).
- **Controle achteraf**: twijfel je of een subagent echt op het gevraagde model draaide, grep het model in het
  subagent-transcript (zie de bekende bug hierboven).

## Keuze tussen niveaus bij twijfel

- Sonnet 5.5 boven Opus 5.5 als de taak testbaar/iteratief is (direct te verifiëren).
- Opus 5.5 als een foute aanpak duur is om terug te draaien (architectuur, migraties, security-kritieke code).
- Haiku 5.5 als het resultaat direct met een test of build te controleren is en de taak eenduidig afgebakend.

## Wanneer dit advies bijstellen

Gebaseerd op de generatie Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.1 (okt 2026). Controleer bij een nieuwe release eerst actuele pricing en docs (platform.claude.com/docs/en/models/overview): prijs- en prestatieverhoudingen verschuiven per generatie. Voor Sonnet 5.5 en Opus 5.5 is hier geen eigen effort-richtlijn getoetst; alleen de defaults komen uit de docs.