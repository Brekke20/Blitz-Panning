# Ontwerp: Claude laten lezen in Blitz Planning (MCP-connector)

Datum: 2026-11-10 — status: ontwerp, wacht op goedkeuring Brent

## Doel
Claude (app, gsm, Claude Code) kan de tool **enkel lezen** om analyses te doen:
welke fouten komen voor, bij welke palen, hoe vaak — achteraf (historiek) en vooraf (planning, open tickets).

## Wat er al bewaard wordt (nagekeken)
| Gegeven | Waar | Bruikbaar voor tellen? |
|---|---|---|
| Oorzaak storing | `rapportData.oorzaakStoring` — vaste keuzelijst (`public/js/rapport-oorzaak.js`) | Ja, goed |
| Serienummer paal | `rapportData.serienummer` (uit Zoho `cf_serienummer`) | Ja |
| Ticketnummer, datum, technieker, klant, adres | top-level velden rapportlijst | Ja |
| Hersteld / nieuwe interventie nodig | `hersteld`, `nieuwInter` | Ja |
| Probleem / acties | vrije tekst | Enkel lezen, niet betrouwbaar tellen |
| Probleemtype (Zoho `cf_probleemtype`) | enkel in ticket, **niet** in rapport | Nee (gat) |
| Foutcode (E05…) / paalmodel | nergens apart | Nee (gat) |
| Tickets | momentopname `tickets-snapshot` = enkel huidige open tickets | Enkel "nu" |
| Planning | `voorstel-status`, `afspraken` | Ja |
| Oude rapporten | `rapportlijst` (laatste 500) + `rapportlijst-archief-<jaar>` | Ja, alles samen |

## Wat er gebouwd wordt
Eén nieuwe functie `netlify/functions/mcp.mjs` (MCP via HTTP, enkel lezen), met rij in `rechten.js` en eigen sleutel.

Gereedschappen voor Claude:
1. `rapporten_zoeken` — filter op periode, serienummer, ticketnummer, technieker, oorzaak, type bezoek, hersteld ja/nee.
2. `rapport_lezen` — één rapport volledig (zonder foto's/handtekeningen).
3. `rapporten_tellen` — tel per oorzaak / serienummer / technieker / maand / klant (bv. top 10 oorzaken, palen met ≥3 bezoeken).
4. `paal_historiek` — alle bezoeken en oorzaken voor één serienummer, in tijdsvolgorde.
5. `tickets_open` — huidige open tickets (incl. serienummer en probleemtype).
6. `planning_lezen` — afspraken en voorstellen per dag/week/technieker.

Kan nooit iets wijzigen: geen schrijf-gereedschappen, functie weigert alles behalve lezen.

## Kleine aanvulling (aanbevolen)
Bij het archiveren van een rapport voortaan ook **probleemtype** en **garantiestatus** van het ticket meebewaren.
Werkt enkel voor nieuwe rapporten; oude blijven zonder.

## Genomen beslissingen (Brent, 2026-11-10)
- Aanmelden: **echte OAuth-aanmelding** met de Blitz-login.
- Klantgegevens: **alles tonen** (namen, adressen, telefoon).
- Login: **dezelfde Blitz-login** als de tool. Flow: loginpagina tool → "Claude toegang geven (enkel lezen)?" → Toestaan → Claude krijgt een eigen leessleutel (nooit het wachtwoord). Sleutel vervalt na ±30 dagen, ongeldig bij deactivatie/wachtwoordwijziging, intrekbaar in beheer ("Gekoppelde Claude-toegangen").
- Wie mag koppelen: **iedereen, volgens eigen rechten** — technieker ziet enkel eigen rapporten (zelfde filter als `lib/eigen.js`), planner/beheer zien wat ze nu ook zien.
- Probleemtype + garantiestatus voortaan meebewaren: aanbevolen, nog te bevestigen bij het plan.

## Oorspronkelijke keuzes (ter info)
- **Inloggen van Claude**: de Claude-app (gsm/web) aanvaardt voor eigen connectors enkel OAuth (een "aanmelden met"-knop). Opties:
  a) volwaardige OAuth-aanmelding bouwen (veiligst, meer werk);
  b) geheime link met sleutel erin (snel, maar wie de link heeft kan lezen).
  Claude Code werkt met beide.
- **Klantgegevens**: namen/adressen/telefoon meesturen naar Claude, of afschermen (enkel gemeente + serienummer)?
- **Gesloten tickets**: nu niet lokaal beschikbaar; historiek loopt via de rapporten. Later eventueel Zoho rechtstreeks bevragen (er is al een Zoho Desk-connector in Claude).

## Testen
Logica-tests voor filteren/tellen, rechten-test voor de nieuwe rij, test dat schrijven geweigerd wordt.
