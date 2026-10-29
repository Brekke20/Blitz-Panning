# Live metingen serverduur (Netlify observability, alleen lezen)

Venster: 28/10 08:51 → 29/10 08:51 (24 u, Belgische tijd), site blitz-planning, productie (v2.5.1 sinds 29/10 00:05, daarvoor 2.5.0).
Duur = duur van het edge-verzoek (ns omgerekend naar s), inclusief koude start van de functie.

## Brents klacht
"Een tab laadt wel oké, maar we moeten wachten tot alles erop staat." → wachten op gegevens, niet op het scherm.

## Per functie (aantal verzoeken, p50 / p75 / p90 / p99 in seconden)

| Functie | n | p50 | p75 | p90 | p99 |
|---|---|---|---|---|---|
| tickets | 75 | 5,98 | 7,04 | 7,78 | 10,64 |
| send-rapport | 4 | 6,07 | 11,0 | 11,0 | 11,0 |
| comment | 2 | 3,66 | | | |
| rapport-ontvangen | 2 | 2,77 | | | |
| dashboard | 4 | 2,75 | 2,80 | | |
| systeemstatus | 4 | 1,43 | 1,65 | | |
| fotos | 2 | 1,24 | | | |
| optimize | 3 | 1,15 | 1,16 | | |
| themas | 70 | 1,10 | 1,34 | 1,52 | 5,66 |
| activiteit | 4 | 1,10 | 1,33 | | |
| auth-ik | 29 | 1,07 | 1,41 | 2,62 | 6,16 |
| sales | 18 | 1,06 | 1,34 | 1,62 | 2,36 |
| klantbeschikbaarheid | 26 | 1,06 | 1,10 | 1,13 | 1,25 |
| availability | 29 | 1,04 | 1,19 | 1,35 | 1,36 |
| prijzen | 26 | 1,03 | 1,08 | 1,14 | 1,28 |
| instellingen | 38 | 1,02 | 1,10 | 1,24 | 6,34 |
| dashboard-instellingen | 4 | 1,01 | 1,02 | | |
| rapport-archief | 35 | 0,99 | 1,07 | 1,10 | 1,23 |
| route | 9 | 0,98 | 1,16 | 1,42 | 1,42 |

Steekproef tickets (laatste 8): 5,70 / 5,21 / 5,60 / 6,41 / 4,66 / 5,36 s (200), en 2× status 499 na 1,6 en 2,1 s
(de browser brak het verzoek af, bv. tab gesloten of herladen).

## Twee bevindingen
1. **tickets ≈ 6 s mediaan, 8 s p90, 10,6 s p99.** Dit is het lange wachten. Oorzaak (code, `netlify/functions/tickets.js`):
   `/agents` vóór de paginering (serieel), tot 6 pagina's `/tickets?limit=100` zonder statusfilter na elkaar (ook gesloten tickets),
   daarna per relevant ticket `/tickets/{id}` in lock-step batches van 5 — enkel voor de custom fields (adres).
   Geen `[functions.tickets]` in `netlify.toml` (standaard time-out; p99 10,6 s komt dicht bij 10 s).
2. **Elke functie, ook de eenvoudigste, kost ≈ 1 s (p50).** themas, prijzen, instellingen, rapport-archief, klantbeschikbaarheid,
   availability: allemaal 1,0-1,1 s, met uitschieters tot 5-6 s (koude start?). Elke beveiligde aanroep leest eerst de volledige
   gebruikerslijst uit Netlify Blobs met `consistency: 'strong'` (`netlify/lib/auth.js:92`), daarna leest de functie zelf vaak nog
   Blobs (strong). Hypothese: strong-consistency Blobs-leesacties + functieregio (standaard VS) + koude starten. NIET bewezen: er
   staat geen tijdmeting in de functies. Een tab die 2-3 van deze aanroepen na elkaar doet, wacht dus 2-3 s.

## Wat niet gemeten kon worden
- Hoeveel relevante tickets er zijn (dus hoeveel detailverzoeken per lading).
- De opsplitsing binnen een functie (auth vs. Blobs vs. Zoho) — daarvoor is een tijdmeting in de functie nodig (bv. een
  `Server-Timing`-kop), wat een release vraagt.
- De ingestelde functieregio (Netlify-instelling, niet in de repo).

## Aanvulling na de review (I-S1-1): statuscodes /api/tickets, zelfde 24 u
- 200: 73, 499: 8 (browser brak af vóór het antwoord), geen 5xx, geen time-outs (502/504).
- Het venster is beperkt tot 24 u (Netlify-plan); een langere periode is niet op te vragen.
- Besluit: in deze 24 u mislukte geen enkele lading op de standaardlimiet, maar ±10 % van de ladingen werd door de browser afgebroken
  (tab dicht, herladen of weggenavigeerd tijdens het wachten). Het 10 s-vermoeden (I-S2-1) blijft plausibel bij p99 10,6 s, niet bewezen.
