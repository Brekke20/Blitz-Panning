// Open dag-stijl, taak 3: glazen kaarten met gloeiende omtrek (vaste regels van de stijl; de e2e-spec e2e/glas-kaarten.spec.mjs bewijst het gedrag).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { urgentieVan } from '../public/js/schermen/wachtrij-logica.js';

const lees = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = lees('../public/css/app.css');
const evenement = lees('../public/css/evenement.css');

test('de oude linkerbalk van de ticketkaart is weg (geen ::before met een rode of accentbalk)', () => {
  assert.doesNotMatch(app, /\.ticket(\.overdue)?(:hover)?::before/);
  assert.doesNotMatch(app, /\.cal-ticket(\.\w+)?::before/);
  assert.doesNotMatch(app, /\.cal-local-event::before/);
  // en de statusbalk van de kalenderkaarten (oranje/groen/grijs) ook niet
  assert.doesNotMatch(app, /\.cal-ticket\.(pending|confirmed|afgerond)::before/);
});

test('de kaartregel is glas uit de tokens, met de gloed als achtergrondbeeld en schaduw', () => {
  const kop = ':is(.ticket, .cal-ticket, .cal-local-event, .stop, .inv-row, .sales-kaart, .sales-afgewerkt-rij, .sales-afgewerkt-kaart) {';
  const i = app.indexOf(kop);
  assert.ok(i >= 0, 'algemene glaskaartregel ontbreekt');
  const regel = app.slice(app.indexOf('{', i) + 1, app.indexOf('}', i));
  assert.match(regel, /background-color:\s*var\(--glas\)/);
  assert.match(regel, /backdrop-filter:\s*blur\(var\(--blur\)\)\s*saturate\(180%\)/);
  assert.match(regel, /border:\s*1px solid var\(--rand-kleur, var\(--glas-rand\)\)/);
  assert.match(regel, /border-radius:\s*var\(--r-kaart\)/);
  assert.match(regel, /background-image:\s*var\(--gloed-beeld, none\)/);
  assert.match(regel, /box-shadow:\s*inset 0 1px 0 var\(--glas-licht\), var\(--gloed-schaduw, 0 0 0 transparent\), var\(--glas-schaduw\)/);
});

test('urgentie: gloedkleuren komen van de gloedtokens, de statuskleuren blijven onaangeroerd', () => {
  for (const [naam, status] of [['rood', 'red'], ['oranje', 'orange'], ['groen', 'green'], ['paars', 'purple']]) {
    assert.match(app, new RegExp(String.raw`\[data-urgentie="${naam}"\][^{]*\{\s*--gloed-kleur:\s*var\(--${status}\);\s*--gloed:\s*var\(--gloed-${naam}\)`));
  }
  // --red, --orange, --green en --purple worden hier nooit als eigenschap gezet
  assert.doesNotMatch(app, /^\s*--(red|orange|green|purple)\s*:/m);
  assert.match(app, /--gloed-beeld:\s*linear-gradient\(135deg, color-mix\(in srgb, var\(--gloed-kleur\) 10%, transparent\), transparent 55%\)/);
  assert.match(app, /--gloed-schaduw:\s*0 0 24px -6px var\(--gloed\), inset 0 0 20px -8px var\(--gloed\)/);
});

test('een hover verplaatst de kaart niet meer (geen transform op de kaartkiezers)', () => {
  assert.doesNotMatch(app, /\.(ticket|cal-ticket|cal-local-event|stop)(:hover|:active)[^{]*\{[^}]*transform/);
});

test('evenement.css: geen backdrop-filter meer voor de kaarten binnen een thema met achtergrond', () => {
  assert.doesNotMatch(evenement, /backdrop-filter/);
  assert.doesNotMatch(evenement, /--ev-glas|--ev-kaart|--ev-tint/);
  // de doorzichtige inhoudsvlakken (scène zichtbaar) blijven themaspecifiek
  assert.match(evenement, /data-event-achtergrond="ja"\]\s*:is\(\.view, \.day-body/);
});

test('dichtheid: breed 15/18 met 10 px ertussen, smal 18/20 met 12 px en 26 px hoeken', () => {
  assert.match(app, /\.ticket \{\s*padding: 15px 18px;\s*margin-bottom: 10px;/);
  assert.match(app, /html\[data-indeling="smal"\] \.ticket \{ padding: 18px 20px; margin-bottom: 12px; border-radius: 26px; \}/);
});

test('hemel.css: geen laag zolang data-hemel ontbreekt (geen donkere flits)', () => {
  assert.match(lees('../public/css/hemel.css'), /html:not\(\[data-hemel\]\) #hemel\s*\{\s*display:\s*none/);
});

test('urgentieVan: verlopen of hoog = rood, middel = oranje, laag = groen, anders geen', () => {
  assert.equal(urgentieVan({ overdue: true, priority: 'low' }), 'rood');
  assert.equal(urgentieVan({ overdue: false, priority: 'high' }), 'rood');
  assert.equal(urgentieVan({ overdue: false, priority: 'Medium' }), 'oranje');
  assert.equal(urgentieVan({ overdue: false, priority: 'low' }), 'groen');
  assert.equal(urgentieVan({ overdue: false, priority: '' }), null);
  assert.equal(urgentieVan({ overdue: false, priority: undefined }), null);
  assert.equal(urgentieVan({ overdue: false, priority: 'onbekend' }), null);
});

// Taak 8a (Task 3-resten): de sales-stops in de route. De hover-transform van de depotrij is dode code; voorgesteld krijgt naast de
// oranje gloed weer een tweede, niet-kleur-cue. De tintregels .sales-voorgesteld/.sales-bevestigd:not(.stop) zijn NIET dood: de
// kalender (sales-kalender.js: .tl-block en .sales-kal-kaart met sales-<tint>) gebruikt ze; ze blijven.
test('sales-stops: geen depot-hoverregel, voorgesteld gestippeld, bevestigd doorlopend; de kalendertinten blijven', () => {
  const sales = lees('../public/css/sales.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(sales, /\.sales-voorgesteld:not\(\.stop\)\s*\{[^}]*dashed/);
  assert.match(sales, /\.sales-bevestigd:not\(\.stop\)\s*\{[^}]*solid/);
  assert.doesNotMatch(sales, /\.sales-route-depot:hover/);
  const regel = (sel) => {
    const m = sales.match(new RegExp(sel.replace(/\./g, '\\.') + String.raw`\s*\{([^}]*)\}`));
    assert.ok(m, `${sel} ontbreekt`);
    return m[1];
  };
  assert.match(regel('.stop.sales-voorgesteld'), /border-style:\s*dashed/);
  assert.match(regel('.stop.sales-bevestigd'), /border-style:\s*solid/);
});
