# Navigatie: keuze tussen navigatie-apps (Android native chooser)

**Datum:** 2026-07-30
**Status:** Approved, ready for implementation

## Aanleiding

De "Navigeer"-knop (en 2 losse adreskoppelingen in het ticket-detail) openen vandaag altijd rechtstreeks Google Maps. Brent wil dat de technieker kan kiezen tussen navigatie-apps (Waze, Apple Maps, ...).

## Beslissingen uit het gesprek met Brent

- De technici gebruiken **voornamelijk/enkel Android**-toestellen.
- Android heeft hiervoor al een ingebouwde oplossing: alle navigatie-apps (Google Maps, Waze, ...) registreren zich bij het besturingssysteem voor de standaard `geo:`-koppeling. Als een website naar zo'n koppeling linkt i.p.v. rechtstreeks naar één specifieke app, toont **Android zelf** een native keuzemenu met de optie "1 keer gebruiken" of "altijd gebruiken" — exact het gedrag dat Brent beschrijft. Geen eigen, custom keuzemenu nodig.
- Op niet-Android-toestellen (zeldzaam in dit team) bestaat dit systeemmenu niet — daar blijft het bestaande Google Maps-gedrag behouden als eenvoudige terugval.
- Onderscheid Android/niet-Android via `navigator.userAgent` (bevat altijd "Android" op Android-toestellen) — betrouwbaar, standaardpraktijk.
- De 2 losse adreskoppelingen elders in het ticket-detail (die vandaag altijd rechtstreeks naar Google Maps linken, los van de "Navigeer"-knop) worden meegenomen zodat overal consistent hetzelfde gebeurt.

## Wijziging

**`navigate(enc)`** (index.html:4875), huidige code:
```js
function navigate(enc) { window.open(`https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=driving`, '_blank'); }
```
wordt:
```js
function navigate(enc) {
  // Android toont zelf een native keuzemenu (met "1 keer"/"altijd") wanneer een geo:-
  // koppeling geopend wordt, omdat alle navigatie-apps (Google Maps, Waze, ...) zich
  // hiervoor registreren bij het besturingssysteem -- geen eigen menu nodig. Niet-Android
  // toestellen (zeldzaam in dit team) vallen terug op het bestaande Google Maps-gedrag.
  if (/Android/i.test(navigator.userAgent)) {
    window.location.href = `geo:0,0?q=${enc}`;
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=driving`, '_blank');
  }
}
```
Alle bestaande aanroepen van `navigate(...)` (Kalender, Route-tab) blijven ongewijzigd — enkel het interne gedrag van de functie verandert.

**Losse adreskoppeling 1 — `openLocalEventDetail()`** (index.html:3124-3132), huidige code:
```js
  const rows = [
    adres
      ? `<div class="mrow"><span class="mlabel">Adres</span><span class="mval"><a href="https://maps.google.com/?q=${encodeURIComponent(adres)}" target="_blank">${escHtml(adres)} ↗</a></span></div>`
      : '',
    linkRow('Telefoon', ev.telefoon, `tel:${ev.telefoon}`),
    linkRow('E-mail',   ev.email,    `mailto:${ev.email}`),
    ev.adres && ev.notitie ? row('Notitie', ev.notitie) : '',
    row('Technieker', ev.persoon),
  ].filter(Boolean).join('');

  document.getElementById('ld-body').innerHTML = rows
    || '<div class="mrow"><span class="mval" style="color:var(--muted)">Geen contactgegevens beschikbaar</span></div>';
```
wordt:
```js
  const rows = [
    adres
      ? `<div class="mrow"><span class="mlabel">Adres</span><span class="mval"><a href="#" class="mval-nav-link" data-adres="${escHtml(adres)}">${escHtml(adres)} ↗</a></span></div>`
      : '',
    linkRow('Telefoon', ev.telefoon, `tel:${ev.telefoon}`),
    linkRow('E-mail',   ev.email,    `mailto:${ev.email}`),
    ev.adres && ev.notitie ? row('Notitie', ev.notitie) : '',
    row('Technieker', ev.persoon),
  ].filter(Boolean).join('');

  document.getElementById('ld-body').innerHTML = rows
    || '<div class="mrow"><span class="mval" style="color:var(--muted)">Geen contactgegevens beschikbaar</span></div>';
  document.getElementById('ld-body').querySelector('.mval-nav-link')?.addEventListener('click', e => {
    e.preventDefault();
    navigate(encodeURIComponent(e.currentTarget.dataset.adres));
  });
```

**Losse adreskoppeling 2 — `openDetail()`** (index.html:4373-4376), huidige code:
```js
    t.hasAddress
      ? `<div class="mrow"><span class="mlabel">Adres</span><span class="mval"><a href="https://maps.google.com/?q=${encodeURIComponent(t.address)}" target="_blank">${escHtml(t.address)} ↗</a></span></div>`
      : `<div class="mrow"><span class="mlabel">Adres</span><span class="mval miss">Geen adres bekend</span></div>`,
  ].join('');
```
wordt:
```js
    t.hasAddress
      ? `<div class="mrow"><span class="mlabel">Adres</span><span class="mval"><a href="#" class="mval-nav-link" data-adres="${escHtml(t.address)}">${escHtml(t.address)} ↗</a></span></div>`
      : `<div class="mrow"><span class="mlabel">Adres</span><span class="mval miss">Geen adres bekend</span></div>`,
  ].join('');
  document.getElementById('d-klant').querySelector('.mval-nav-link')?.addEventListener('click', e => {
    e.preventDefault();
    navigate(encodeURIComponent(e.currentTarget.dataset.adres));
  });
```
(Deze `addEventListener`-regel komt na de bestaande `document.getElementById('d-klant').innerHTML = [...].join('');`-toewijzing.)

Beide plekken volgen hetzelfde patroon dat elders in de codebase al gebruikt wordt voor "Navigeer"-knoppen (`data-adres`-attribuut + `addEventListener` i.p.v. een inline `onclick` met ongeëscapete data, of een rechtstreekse `href` — consistent met de bestaande beveiligingsafweging in de omliggende code).

## Edge cases

- **`geo:0,0?q=...` met `0,0` als coördinaten**: dit is de standaard, correcte vorm van een geo-URI met enkel een zoekterm (adres) i.p.v. exacte coördinaten — Android/de gekozen app zoekt het adres zelf op. Geen coördinaten van Blitz Planning nodig.
- **Toestel-detectie faalt/onduidelijke user-agent**: valt terug op het bestaande Google Maps-gedrag (de `else`-tak) — nooit een kapotte/lege actie.

## Niet in scope

- Geen apart keuzemenu voor niet-Android-toestellen (bv. iPhone) — team gebruikt voornamelijk Android, dus niet nodig nu. Kan later alsnog, als dat verandert.
