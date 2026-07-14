# Blitz Planning — V2 Ontwerp

## 1. Manuele datumblokkering per ticket

### Wat
Vanuit de detail modal kun je een of meerdere datums markeren als "niet beschikbaar voor klant". autoPlan slaat die datums over bij het inplannen van dat ticket.

### UX
- Knop "🚫 Datum blokkeren" in de detail modal
- Datepicker → datum wordt opgeslagen als array op het ticket: `blockedDates: ["2026-07-20", "2026-07-21"]`
- Geblokkeerde datums zijn zichtbaar in de detail modal als verwijderbare chips

### Logica
- autoPlan checkt `blockedDates` vóór het inplannen — harde uitsluiting, geen uitzonderingen
- Als alle beschikbare datums in het planningsvenster geblokkeerd zijn → ticket krijgt een visuele waarschuwing in de wachtrij ("⚠️ Geen beschikbare datum") en wordt niet ingepland. Het verdwijnt niet stil.

---

## 2. Voorkeursdatum per ticket (zachte constraint)

### Wat
Optioneel veld op een ticket: de klant heeft een voorkeur voor een bepaalde datum of week. Dit is een hint, geen verplichting.

### UX
- Veld "📅 Voorkeur klant" in de detail modal — datepicker, mag leeg blijven
- Geen voorkeur = geen effect op planning (standaard leeg)
- Voorkeur zichtbaar als label op het ticket in de wachtrij

### Logica
- Voorkeursdatum geeft een **zachte score-bonus van +10%** op de totale planningsscore voor die dag
- De bonus is niet genoeg om urgentie of geo-clustering te overrulen
- Als de voorkeursdatum niet haalbaar is (te ver, te vol, geblokkeerd), wordt het ticket gewoon op de beste andere dag ingepland — geen fout, wel een markering "⭐ voorkeur niet gehonoreerd" in de wachtrij/kalender
- Voorkeur wordt **nooit** als harde deadline behandeld

---

## 3. Bevestigde tickets — IJzeren regel

### Context
Tickets met status "Bevestigd" komen al binnen vanuit Zoho met die status. De klant heeft de datum expliciet bevestigd.

### Regel — mag nooit breken
**autoPlan verschuift of overschrijft nooit een ticket met status "Bevestigd".** Dit is een harde blokkering in de planningslogica, ongeacht urgentie, geo-score of capaciteit van de dag.

### Implementatie
- Bij elke autoPlan-run: bevestigde tickets worden als eerste gefixeerd op hun datum. De rest van de planning vult zich daaromheen.
- Bij handmatige drag-and-drop in de kalender: waarschuwing tonen als je een bevestigd ticket probeert te verplaatsen ("⚠️ Dit ticket is bevestigd met de klant — weet je zeker dat je het wilt verplaatsen?")
- Toekomstige updates aan autoPlan of de score-formule mogen deze check **nooit verwijderen of omzeilen**

### Statussen die als "Bevestigd" behandeld worden
- `Geplande support` ← bevestigd door klant, nooit verschuiven

Volledige statusflow in Zoho:
- Open → Wachten op planning → (voorstel verstuurd) → Wachten op bevestiging planning → (klant bevestigt) → Geplande support

---

## Prioriteit voor V2

1. Bevestigde tickets beschermen (laagste risico, hoogste impact op betrouwbaarheid)
2. Datumblokkering (meest gebruikte scenario na klant-reply)
3. Voorkeursdatum (nice-to-have, pas bouwen als 1 en 2 stabiel zijn)
