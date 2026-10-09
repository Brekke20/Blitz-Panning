// Scherm Performance (dashboard T18): het pure deel (voetnoten, instellingen-paneel). De DOM-laag staat in e2e/performance.spec.mjs (T21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dekkingVoetnoten, isGeldigeFilterDatum } from '../public/js/schermen/beheer-performance-logica.js';
import {
  GRENS_RINGEN, GRENZEN_LAAD_FOUT, grenzenPaneelHtml, leesGrenzenUitRijen, voegGrenzenSamen, bewaarUitkomst,
} from '../public/js/schermen/beheer-performance-grenzen.js';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';

const tekst = x => x.join(' | ');

test('dekkingVoetnoten: aantal rapporten met slot en annulaties sinds', () => {
  const t = tekst(dekkingVoetnoten({ tijd: { rapporten: 52, zonderSlot: 14 }, klant: { annulatiesVanaf: '2026-10-12' } }));
  assert.match(t, /Op basis van 38 van 52 rapporten, 14 zonder gepland tijdslot/);
  assert.match(t, /Annulaties sinds 12\/10/);
});

test('dekkingVoetnoten: annulatiesVanaf null = nog geen gegevens', () => {
  const t = tekst(dekkingVoetnoten({ klant: { annulatiesVanaf: null } }));
  assert.match(t, /nog geen gegevens/);
  assert.match(t, /logins/);
});

test('dekkingVoetnoten: lege of ontbrekende dekking geeft geen NaN of undefined', () => {
  for (const d of [undefined, null, {}, { tijd: {}, klant: {} }, { tijd: { rapporten: 'x' }, klant: { annulatiesVanaf: 'kapot' } }]) {
    const t = tekst(dekkingVoetnoten(d));
    assert.doesNotMatch(t, /NaN|undefined|null/);
  }
  assert.deepEqual(dekkingVoetnoten({}), []);
});

test('dekkingVoetnoten: zonder rapporten zonder slot geen "zonder gepland tijdslot"', () => {
  const t = tekst(dekkingVoetnoten({ tijd: { rapporten: 10, zonderSlot: 0 } }));
  assert.match(t, /Op basis van 10 van 10 rapporten/);
  assert.doesNotMatch(t, /zonder gepland tijdslot/);
});

test('dekkingVoetnoten: afgekapt log en mislukte bronnen worden gemeld', () => {
  const t = tekst(dekkingVoetnoten({ klant: { annulatiesVanaf: '2026-09-01', activiteitAfgekapt: true }, fouten: ['archief-2025', 'sales'] }));
  assert.match(t, /Er zijn meer dan 1000 logregels in deze periode; annulaties kunnen onvolledig zijn\./);
  assert.match(t, /archief-2025, sales/);
  assert.match(tekst(dekkingVoetnoten({ fouten: [] })), /^$/);
});

test('[RF4] dekkingVoetnoten: geen ruwe < of & uit data', () => {
  const t = tekst(dekkingVoetnoten({ fouten: ['<img src=x onerror=alert(1)>'], klant: { annulatiesVanaf: '<b>2026-10-12</b>' } }));
  assert.doesNotMatch(t, /<img|<b>/);
  assert.match(t, /&lt;img/);
});

test('GRENS_RINGEN: vijf ringen in de volgorde van de grenzen', () => {
  assert.deepEqual(GRENS_RINGEN.map(r => r.sleutel), ['opTijd', 'firstTimeFix', 'bevestigdViaKnop', 'garantie', 'metInstallateur']);
});

test('grenzenPaneelHtml: een rij per ring met invoer, richting en labels', () => {
  const html = grenzenPaneelHtml(STANDAARD_GRENZEN);
  assert.equal((html.match(/<tr data-ring=/g) || []).length, 5);
  assert.match(html, /data-veld="groen"[^>]*value="90"/);
  assert.match(html, /data-veld="oranje"[^>]*value="75"/);
  assert.match(html, /aria-label="% op tijd \(alle bezoeken\): groen vanaf"/);
  assert.match(html, /data-actie="dashboard-grenzen-bewaar"/);
  assert.match(html, /<option value="laag" selected>/); // garantie: laag is goed
});

test('grenzenPaneelHtml: null = leeg veld; uitgeschakeld zonder serverstand', () => {
  assert.match(grenzenPaneelHtml(STANDAARD_GRENZEN), /data-ring="garantie"[\s\S]*?data-veld="groen"[^>]*value=""/);
  const uit = grenzenPaneelHtml(STANDAARD_GRENZEN, { uitgeschakeld: true });
  assert.match(uit, /disabled/);
});

test('leesGrenzenUitRijen: tekst naar getallen, leeg naar null, en valideert', () => {
  const rijen = [
    { sleutel: 'opTijd', groen: '95', oranje: '80', richting: 'hoog' },
    { sleutel: 'firstTimeFix', groen: '', oranje: '', richting: 'hoog' },
    { sleutel: 'bevestigdViaKnop', groen: ' ', oranje: '', richting: 'hoog' },
    { sleutel: 'garantie', groen: '10', oranje: '20', richting: 'laag' },
    { sleutel: 'metInstallateur', groen: '', oranje: '', richting: 'hoog' },
  ];
  const r = leesGrenzenUitRijen(rijen);
  assert.equal(r.ok, true);
  assert.deepEqual(r.waarde.opTijd, { groen: 95, oranje: 80, richting: 'hoog' });
  assert.deepEqual(r.waarde.firstTimeFix, { groen: null, oranje: null, richting: 'hoog' });
  assert.deepEqual(r.waarde.garantie, { groen: 10, oranje: 20, richting: 'laag' });
});

test('leesGrenzenUitRijen: ongeldige invoer geeft een foutzin', () => {
  const basis = Object.entries(STANDAARD_GRENZEN).map(([sleutel, g]) => ({ sleutel, groen: String(g.groen ?? ''), oranje: String(g.oranje ?? ''), richting: g.richting }));
  const met = (sleutel, wijz) => basis.map(r => (r.sleutel === sleutel ? { ...r, ...wijz } : r));
  assert.equal(leesGrenzenUitRijen(met('opTijd', { groen: 'abc' })).ok, false);
  assert.equal(leesGrenzenUitRijen(met('opTijd', { groen: '70', oranje: '80' })).ok, false); // hoog: groen < oranje
  assert.equal(leesGrenzenUitRijen(met('opTijd', { groen: '90', oranje: '' })).ok, false); // één leeg
  assert.equal(leesGrenzenUitRijen(met('opTijd', { groen: '120', oranje: '80' })).ok, false);
  assert.match(leesGrenzenUitRijen(met('opTijd', { groen: 'abc' })).fout, /\S/);
});

test('voegGrenzenSamen: per ring wint de eigen wijziging, de rest volgt de server', () => {
  const basis = STANDAARD_GRENZEN;
  const eigen = { ...basis, opTijd: { groen: 95, oranje: 80, richting: 'hoog' } };
  const server = { ...basis, firstTimeFix: { groen: 85, oranje: 70, richting: 'hoog' }, opTijd: { groen: 92, oranje: 78, richting: 'hoog' } };
  const samen = voegGrenzenSamen(server, eigen, basis);
  assert.deepEqual(samen.opTijd, eigen.opTijd);
  assert.deepEqual(samen.firstTimeFix, server.firstTimeFix);
  assert.deepEqual(voegGrenzenSamen(server, basis, basis), server); // niets gewijzigd: de serverstand
});

test('[I2] grenzenPaneelHtml met fout: uitleg en een Opnieuw laden-knop; zonder fout niet', () => {
  const met = grenzenPaneelHtml(STANDAARD_GRENZEN, { uitgeschakeld: true, fout: true });
  assert.ok(met.includes(GRENZEN_LAAD_FOUT));
  assert.match(met, /data-actie="dashboard-grenzen-herlaad"[^>]*>Opnieuw laden</);
  assert.doesNotMatch(grenzenPaneelHtml(STANDAARD_GRENZEN), /dashboard-grenzen-herlaad/);
});

test('[I1] bewaarUitkomst: na een mislukte bewaring wordt het paneel niet opnieuw getekend', () => {
  for (const r of [{ ok: false, reden: 'http', status: 503 }, { ok: false, reden: 'netwerk' }, { ok: false, reden: 'http', status: 400 },
    { ok: false, reden: 'http', status: 401 }, { ok: false, reden: 'http', status: 403 }, { ok: false, reden: 'http', status: 500 },
    { ok: false, reden: 'samenvoegen' }, { ok: false, reden: 'conflict', status: 409 }]) {
    const u = bewaarUitkomst(r);
    assert.equal(u.herteken, false, JSON.stringify(r));
    assert.match(u.toast, /^⚠ /);
  }
  assert.match(bewaarUitkomst({ ok: false, reden: 'http', status: 503 }).toast, /opslag/);
  assert.doesNotMatch(bewaarUitkomst({ ok: false, reden: 'conflict', status: 409 }).toast, /geladen\./); // niets geladen: dat niet beweren
});

test('[I1] bewaarUitkomst: succes en conflict met serverstand vervangen de stand', () => {
  const g = { ...STANDAARD_GRENZEN };
  const ok = bewaarUitkomst({ ok: true, waarde: g, versie: 4, samengevoegd: false });
  assert.deepEqual([ok.herteken, ok.versie, ok.grenzen, ok.toast], [true, 4, g, 'Grenzen bewaard']);
  assert.match(bewaarUitkomst({ ok: true, waarde: g, versie: 5, samengevoegd: true }).toast, /samengevoegd/);
  const c = bewaarUitkomst({ ok: false, reden: 'conflict', status: 409, laatsteServer: g, laatsteVersie: 9, versie: 3 });
  assert.deepEqual([c.herteken, c.versie, c.grenzen], [true, 9, g]);
});

test('isGeldigeFilterDatum: enkel volledige, echte datums van dit tijdperk (nooit 0002-10-01 tijdens het intypen)', () => {
  for (const ok of ['2026-10-01', '2000-01-01', '2024-02-29', '2100-12-31']) assert.equal(isGeldigeFilterDatum(ok), true, ok);
  for (const fout of ['', null, undefined, '0002-10-01', '0020-10-01', '0202-10-01', '1999-12-31', '2101-01-01', '2026-02-30', '2025-02-29', '2026-13-01', '20261-01-01', '2026-1-1', 'abc'])
    assert.equal(isGeldigeFilterDatum(fout), false, String(fout));
});
