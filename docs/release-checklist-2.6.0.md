# Release-checklist 2.6.0 (voor de coordinator en de eigenaar)

Release 2.6.0 staat klaar op de tak `release-2.6.0` (vertrekt van `server-snelheid`, bevat de optimalisatie van 2.5.1, laadskeletten fase 1a en de server-tijdmeting, en is samengevoegd met `origin/main` 62fe5d4). Er is niets gepusht, getagd of live gezet. Live is nu v2.5.1 met `CACHE_NAME` `blitz-planning-v42`. Deze release brengt `CACHE_NAME` naar `blitz-planning-v43` (verplicht: zonder ophoging krijgen toestellen de nieuwe bestanden niet).

Bronnen voor de details: `docs/optimalisatie/vergelijking-2.5.1.md` (cijfers en keuzes), `docs/superpowers/plans/2026-10-29-server-snelheid.md`, `.superpowers/sdd/2026-10-29-server-snelheid/rapport-*.md`, `CHANGELOG.md` sectie `[2.6.0]`.

## a. Volgorde op releasedag

- [ ] 1. Volledige tests op deze tak: `node --test` (zonder pad), `npx playwright test --project=sw --workers=2` en de volledige e2e-suite (poort 3338 vrij; nooit twee Playwright-runs tegelijk). Laatste stand bij het klaarzetten: `node --test` 3656 geslaagd, 0 mislukt; `--project=sw` 18 geslaagd; `e2e/kern.spec.mjs` 18 geslaagd.
- [ ] 2. Uitdrukkelijke goedkeuring van de eigenaar (de coordinator vraagt het; nooit aannemen).
- [ ] 3. `git fetch` en kijk of `origin/main` nog 62fe5d4 is. Is er iets bijgekomen: eerst dat in de tak mergen, tests herhalen en `CACHE_NAME` opnieuw nakijken.
- [ ] 4. `release-2.6.0` met `git merge --no-ff` in `main` samenvoegen. Noteer de hash van de merge-commit (nodig voor een rollback).
- [ ] 5. Pushen (de pre-push-hook niet omzeilen).
- [ ] 6. `git tag v2.6.0` op de merge-commit en de tag pushen.
- [ ] 7. Wachten tot de Netlify-deploy klaar is (status "Published") voor je iets controleert.

## b. Controles na de deploy

**Read-only controles (coordinator)**
- [ ] `/sw.js` van de live site bevat `blitz-planning-v43`.
- [ ] `/js/versie.js` bevat `APP_VERSIE = '2.6.0'`.
- [ ] Het startscherm laadt (inlogscherm of de app) en de browserconsole toont geen fouten.
- [ ] Na activatie van de nieuwe service worker is de oude cache `blitz-planning-v42` opgeruimd (Application, Cache Storage); `blitz-extern-v1` blijft bestaan. Eén herlading volstaat voor de nieuwe versie.
- [ ] Netlify-functielogs tonen regels `[meting] {...}` (één per verzoek) en `/api/tickets` geeft (ingelogd) een `Server-Timing`-header terug. Op een 401 of een open route hoort die header er niet te staan; de logregel wel.
- [ ] Duur van `/api/tickets` is nog ongeveer 6 s (p50 was 5,98 s, p90 7,8 s). Geen terugval. In de `[meting]`-regels staat het aantal Zoho-aanroepen (`n`) en de gelijktijdigheid (`max`, hoogstens 5): die waarden mogen niet hoger zijn dan voor de release.
- [ ] Geen nieuwe 5xx in de functielogs sinds de deploy (let op `tickets`, `instellingen`, `auth-ik`, `rapport-archief`, `dashboard`).
- [ ] Beheer, tab Instellingen en tab Performance openen zonder fout (zij laden hun gegevens nu tegelijk).

**Op een echte gsm (eigenaar)**
- [ ] Kalender start: eerst een grijs laadskelet (geen "geen geplande service" of nullen), daarna de echte afspraken.
- [ ] Wachtrij en Kalender-lijst scrollen overdag merkbaar vlotter. Zo niet: de vervaging terugzetten (los terug te draaien; de winst is enkel op een testbrowser zonder grafische kaart gemeten).
- [ ] Wachtrij ziet er overdag, 's nachts en in een themaweek hetzelfde uit als voorheen.
- [ ] Terugkeren naar de Kalender (na een ander tabblad) voelt snel; de Kalender toont de verse stand na een wijziging op een ander toestel en na middernacht de nieuwe dag.
- [ ] Rapporten, Ingepland, Route (op pc) en Inventaris tonen een skelet tijdens het laden en geen valse lege stand.
- [ ] Gedeelde tablet: sessie laten verlopen, als een andere gebruiker inloggen en controleren dat de eigen instellingen verschijnen.
- [ ] Rapporten: bij een tijdelijke laadfout blijft de lijst staan met een melding.

## c. Terugdraaien

1. `git revert -m 1 <hash van de merge-commit>` op `main`.
2. `CACHE_NAME` in `public/sw.js` naar `blitz-planning-v44` en de pin in `tests/sw-schil.test.mjs` (N19) en de vermelding in `.claude/rules/service-worker.md` mee aanpassen (nooit terug naar v42 of v43: toestellen met v43 moeten de herstelde bestanden ophalen).
3. `node --test` en `npx playwright test --project=sw --workers=2` draaien, dan pushen.
4. Na de deploy opnieuw de controles uit b doen (sw.js bevat v44, oude cache opgeruimd, geen 5xx).
5. Een deel terugdraaien kan ook: de vervaging op de gsm en het gedrag van de rapportenlijst bij een laadfout zijn los terug te draaien, zonder de rest te raken.

## d. Wat NIET in deze release zit, en open vragen voor de eigenaar

**Niet gebouwd (volgende ronde)**
- S2, S3 en S4 uit het plan Server-snelheid: onder meer de tickets bij Zoho parallel ophalen en de Zoho-proef. De Zoho-proef (S4) is geen test en draait enkel na een uitdrukkelijk ja van de eigenaar. De server wacht nu nog steeds in lock-step batches op Zoho; de duur van `/api/tickets` verandert dus niet door deze release (enkel de time-out is hoger en er is een meting bijgekomen).
- Fase 2 van de laadverbetering.
- L3 (laadskelet voor het overige; niet aangeraakt).
- Verbeteringen 4, 5, 7 en 8 van de optimalisatie (tickets vroeg opvragen, parallel ophalen, adressen eenmalig inlezen, routekaart pas laden bij Route).
- Een versienummer-vergelijking of grotere ingreep in de service worker: de regel van 4 seconden blijft zoals die is.

**Open vragen voor de eigenaar**
1. Vervaging van de lijstkaarten op de gsm overdag weglaten: houden of terugdraaien na proef op een echte telefoon?
2. Bij een laadfout in het rapportenarchief blijft de lijst staan met een melding: akkoord met dit gedrag?
3. Mag de achtergrondservice eerst uit het geheugen starten? Dat verandert jouw regel dat de app tot 4 seconden op het netwerk wacht.
4. Nog meer glas weglaten (enkel bespreken als een echte telefoon na deze release nog traag scrolt).
5. Wat moet er gebeuren als een ticket tussen de lijst en het openen verdwijnt (nu mislukt de hele lijst; overslaan is robuuster maar verandert de uitkomst)?
6. De Zoho-proef (S4): wanneer en onder welke voorwaarden mag die draaien?
