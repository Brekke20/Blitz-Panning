// tests/rapport-verzend-melding.test.mjs — de ene verzendmelding (B5/B6), pure functie
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { bouwVerzendMelding } from '../public/js/schermen/rapport-verzend-melding.js';

const NIET_OPGESLAGEN = 'maar status kon niet opgeslagen worden';
const HERLAAD = 'NIET opnieuw versturen, herlaad eerst de pagina';

test('bouwVerzendMelding: niets verstuurd, fouten gevuld', () => {
  const m = bouwVerzendMelding({ fouten: [{ doelgroep: 'contact', fout: 'Ongeldig adres' }, { doelgroep: 'klant', fout: 'Zoho 500' }] });
  assert.deepEqual(m, { tekst: '⚠ Rapport versturen geweigerd door Zoho (contact: Ongeldig adres; klant: Zoho 500)', duurMs: 6000 });
});

test('bouwVerzendMelding: niets verstuurd, geen fouten', () => {
  assert.deepEqual(bouwVerzendMelding({}), { tekst: '⚠ Rapport kon niet verstuurd worden (geen adressen bekend)', duurMs: 4500 });
  assert.deepEqual(bouwVerzendMelding({ fouten: [] }), { tekst: '⚠ Rapport kon niet verstuurd worden (geen adressen bekend)', duurMs: 4500 });
});

test('bouwVerzendMelding: enkel verzonden', () => {
  assert.deepEqual(bouwVerzendMelding({ verzonden: ['contact', 'klant'] }), { tekst: '✓ Rapport verstuurd naar contactpersoon en klant', duurMs: 3500 });
});

test('bouwVerzendMelding: alles mail-weg maar niets opgeslagen', () => {
  assert.deepEqual(bouwVerzendMelding({ nietOpgeslagen: ['klant'] }),
    { tekst: `✓ Rapport verstuurd naar klant, ${NIET_OPGESLAGEN} — ${HERLAAD}`, duurMs: 8000 });
});

test('bouwVerzendMelding: deels opgeslagen', () => {
  assert.deepEqual(bouwVerzendMelding({ verzonden: ['klant'], nietOpgeslagen: ['contact'] }),
    { tekst: `✓ Rapport verstuurd naar contactpersoon en klant, ${NIET_OPGESLAGEN} voor contactpersoon — ${HERLAAD}`, duurMs: 8000 });
});

test('bouwVerzendMelding: mail weg én fouten gevuld (deel geweigerd)', () => {
  assert.deepEqual(bouwVerzendMelding({ verzonden: ['contact'], fouten: [{ doelgroep: 'klant', fout: 'Zoho 500' }] }),
    { tekst: '✓ Rapport verstuurd naar contactpersoon ⚠ Niet verstuurd naar klant: Zoho 500', duurMs: 8000 });
});

test('bouwVerzendMelding: mail weg én statusFout', () => {
  assert.deepEqual(bouwVerzendMelding({ verzonden: ['contact'], statusFout: 'Zoho 500' }),
    { tekst: '✓ Rapport verstuurd naar contactpersoon ⚠ Ticketstatus in Zoho kon niet naar "Gesloten - ov" gezet worden: Zoho 500', duurMs: 8000 });
});

test('bouwVerzendMelding: alle meldingen samen in één tekst', () => {
  const m = bouwVerzendMelding({ verzonden: ['contact'], nietOpgeslagen: ['klant'], fouten: [{ doelgroep: 'installateur', fout: 'x' }], statusFout: 'y' });
  assert.equal(m.tekst, `✓ Rapport verstuurd naar contactpersoon en klant, ${NIET_OPGESLAGEN} voor klant — ${HERLAAD} ⚠ Niet verstuurd naar installateur: x ⚠ Ticketstatus in Zoho kon niet naar "Gesloten - ov" gezet worden: y`);
  assert.equal(m.duurMs, Math.min(15000, 8000 + (m.tekst.length - 200) * 25)); // lang: proportioneel (zie de duurtest hieronder)
});

test('bouwVerzendMelding: meerdere geweigerde ontvangers, label + fout zonder herhaalde sleutel', () => {
  const m = bouwVerzendMelding({ verzonden: ['installateur'], fouten: [{ doelgroep: 'klant', fout: 'Zoho 500' }, { doelgroep: 'contact', fout: 'Zoho 422' }] });
  assert.equal(m.tekst, '✓ Rapport verstuurd naar installateur ⚠ Niet verstuurd naar contactpersoon: Zoho 422; klant: Zoho 500');
});

test('bouwVerzendMelding: een lange samengestelde melding blijft langer staan (max 15 s); een korte blijft 8 s', () => {
  const lang = bouwVerzendMelding({ verzonden: ['contact'], nietOpgeslagen: ['klant'], fouten: [{ doelgroep: 'installateur', fout: 'f'.repeat(300) }], statusFout: 'y' });
  assert.equal(lang.duurMs, Math.min(15000, 8000 + (lang.tekst.length - 200) * 25));
  assert.ok(lang.duurMs > 8000 && lang.duurMs <= 15000);
  const extreem = bouwVerzendMelding({ verzonden: ['contact'], statusFout: 'y'.repeat(2000) });
  assert.equal(extreem.duurMs, 15000);
  assert.equal(bouwVerzendMelding({ verzonden: ['contact'], statusFout: 'Zoho 500' }).duurMs, 8000);
});

test('bouwVerzendMelding: volgorde contact, klant, installateur ook als de invoer anders staat', () => {
  assert.equal(bouwVerzendMelding({ verzonden: ['installateur', 'contact', 'klant'] }).tekst, '✓ Rapport verstuurd naar contactpersoon, klant en installateur');
  assert.equal(bouwVerzendMelding({ verzonden: ['klant'], nietOpgeslagen: ['installateur', 'contact'] }).tekst,
    `✓ Rapport verstuurd naar contactpersoon, klant en installateur, ${NIET_OPGESLAGEN} voor contactpersoon en installateur — ${HERLAAD}`);
  assert.equal(bouwVerzendMelding({ fouten: [{ doelgroep: 'klant', fout: 'b' }, { doelgroep: 'contact', fout: 'a' }] }).tekst,
    '⚠ Rapport versturen geweigerd door Zoho (contact: a; klant: b)');
});

test('bouwVerzendMelding: foutteksten worden ongewijzigd doorgegeven', () => {
  const rauw = '<b>"x" & \'y\'</b>';
  assert.ok(bouwVerzendMelding({ fouten: [{ doelgroep: 'klant', fout: rauw }] }).tekst.includes(rauw));
  assert.ok(bouwVerzendMelding({ verzonden: ['klant'], statusFout: rauw }).tekst.endsWith(': ' + rauw));
});
