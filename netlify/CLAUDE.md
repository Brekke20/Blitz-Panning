# netlify — serverkant

Verplaatst uit de CLAUDE.md in de hoofdmap (2026-10-29); laadt enkel bij werk in deze map. De algemene regels staan in de hoofdmap.

## Serverkant (`netlify/lib/`)

Etappe 6 van de refactor: gedeelde serverbouwstenen. Gebruik ze voor elke nieuwe Zoho- of TomTom-functie.

- `netlify/lib/zoho.js`: `maakZoho({ fetch, env, nu, tokenFoutMetData, orgFoutTekst })` voor token (55 min cache in de instantie), org-id, headers en `verzoek`; `leesJsonVeilig` voor antwoorden die leeg of geen JSON kunnen zijn. Maak de instantie op moduleniveau, of in `maakHandler` voor functies met injecteerbare fetch.
- `netlify/lib/http.js`: CORS-sets en v1/v2-antwoord-, OPTIONS- en methodehulpen. Geen eigen CORS-literals in functies.
- `/api/mail-check` (`netlify/functions/mail-check.js` + `netlify/lib/mailcontrole.js`, etappe 7): GET `?ticketId=&verlopenMs=[&ontvangers=]` (`verlopenMs` = verstreken ms sinds de start van de verzending, 0 tot 900000; de server rekent `sinds` met zijn eigen klok, marge 10 s; timeout 26 s in `netlify.toml`); leest de uitgaande threads van het ticket in Zoho Desk (met paginering) en antwoordt `{ ok, verzonden, twijfel, tijdstip, uitgaand, ontvangers? }`. ENKEL LEZEN: nooit `sendReply`, PATCH of een andere schrijfactie. Bij elke twijfel (onleesbaar adres, concept- of mislukte status) is `twijfel` waar. Nog niet getest op een echt Zoho-ticket (zie de release-checklist).
- Uitzonderingen met een eigen kopie: `rapport.js` (Chromium en Blobs-register zijn onbereikbaar voor tests) en `setup.js` (grant-code-uitwisseling).
- Tests: `tests/nep-fetch.mjs` (`maakNepFetch`, `laadVers`, `metGlobaleFetch`, `v1Event`, `zetEnv`). Nooit echte Zoho-, TomTom- of mailaanroepen; `globalThis.fetch` staat standaard op een functie die gooit.
- Karakterisering eerst: leg bij het migreren of wijzigen van een functie eerst het huidige gedrag vast (uitgaande verzoeken, statussen, headers, foutteksten) in `tests/server-*.test.mjs`. Een karakteriseringstest wijzig je alleen bewust (bv. bij een bugfix, met commentaar), nooit stilzwijgend.
