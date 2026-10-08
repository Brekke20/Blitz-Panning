import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.escHtml = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const {
  effectieveStatus, statusBadgeHtml, opnieuwKnopHtml, opnieuwVersturen,
  misluktMeldingTekst, teMeldenMislukt,
} = await import('../public/js/rapport-status.js');

const verw = (status, extra = {}) => ({ id: 'r1', verwerking: { status, ...extra } });

test('effectieveStatus: verwerking.status wint; oude entries worden afgeleid', () => {
  assert.equal(effectieveStatus(verw('bezig')), 'bezig');
  assert.equal(effectieveStatus({ zohoUploaded: true }), 'in-zoho');
  assert.equal(effectieveStatus({ geannuleerd: true }), 'geannuleerd');
  assert.equal(effectieveStatus({}), 'onbekend');
  assert.equal(effectieveStatus(null), 'onbekend');
});

test('statusBadgeHtml: tekst per status', () => {
  assert.match(statusBadgeHtml(verw('wacht')), /In verwerking/);
  assert.match(statusBadgeHtml(verw('bezig')), /In verwerking/);
  assert.match(statusBadgeHtml(verw('in-zoho')), /In Zoho/);
  assert.match(statusBadgeHtml(verw('lokaal')), /Lokaal/);
  assert.match(statusBadgeHtml({ zohoUploaded: true }), /In Zoho/);
});

test('statusBadgeHtml: onbekend en geannuleerd geven niets', () => {
  assert.equal(statusBadgeHtml({}), '');
  assert.equal(statusBadgeHtml(verw('onbekend')), '');
  assert.equal(statusBadgeHtml(verw('geannuleerd')), '');
  assert.equal(statusBadgeHtml({ geannuleerd: true }), '');
});

test('statusBadgeHtml: mislukt is rood en toont laatsteFout als tooltip', () => {
  const h = statusBadgeHtml(verw('mislukt', { laatsteFout: 'Testfout: Zoho onbereikbaar' }));
  assert.match(h, /Mislukt/);
  assert.match(h, /var\(--red\)/);
  assert.match(h, /title="Testfout: Zoho onbereikbaar"/);
});

test('statusBadgeHtml: laatsteFout met HTML en aanhalingstekens wordt ge-escaped (XSS)', () => {
  const h = statusBadgeHtml(verw('mislukt', { laatsteFout: '"><img src=x onerror=alert(1)>' }));
  assert.ok(!h.includes('<img'), h);
  const title = h.match(/title="([^"]*)"/);
  assert.ok(title, 'title-attribuut blijft heel: ' + h);
  assert.ok(title[1].includes('&quot;&gt;&lt;img'));
});

test('statusBadgeHtml: ticketnummer met HTML in de melding wordt ge-escaped bij weergave', () => {
  const tekst = misluktMeldingTekst({ ticketNumber: '<b>1</b>' });
  assert.ok(escHtml(tekst).includes('#&lt;b&gt;1&lt;/b&gt;'));
});

test('opnieuwKnopHtml: enkel bij mislukt, met ge-escaped data-rapport-id', () => {
  assert.equal(opnieuwKnopHtml(verw('bezig')), '');
  assert.equal(opnieuwKnopHtml({}), '');
  const h = opnieuwKnopHtml({ id: '"><script>x</script>', verwerking: { status: 'mislukt' } });
  assert.match(h, /btn-opnieuw-rapport/);
  assert.match(h, /Opnieuw versturen/);
  assert.ok(!h.includes('<script'));
  assert.match(h, /data-rapport-id="&quot;&gt;&lt;script&gt;/);
  assert.ok(!/onclick/i.test(h));
});

test('misluktMeldingTekst: exacte spec-tekst', () => {
  assert.equal(
    misluktMeldingTekst({ ticketNumber: '1234' }),
    'Rapport #1234 kon niet naar Zoho. Je hoeft niets opnieuw in te vullen; kantoor is verwittigd.'
  );
});

test('teMeldenMislukt: enkel eigen, mislukte, nog niet geziene rapporten', () => {
  const lijst = [
    { id: 'a', technieker: 'Tim Peeters', verwerking: { status: 'mislukt' } },
    { id: 'b', technieker: ' tim  peeters ', verwerking: { status: 'mislukt' } },
    { id: 'c', technieker: 'Anna', verwerking: { status: 'mislukt' } },
    { id: 'd', technieker: 'Tim Peeters', verwerking: { status: 'bezig' } },
    { id: 'e', technieker: 'Tim Peeters', verwerking: { status: 'mislukt' } },
    { id: 'f', technieker: 'Tim Peeters', zohoUploaded: true },
  ];
  const uit = teMeldenMislukt(lijst, { technieker: 'Tim Peeters', gezien: new Set(['e']) });
  assert.deepEqual(uit.map(r => r.id), ['a', 'b']);
  assert.deepEqual(teMeldenMislukt(lijst, { technieker: '', gezien: new Set() }), []);
  assert.deepEqual(teMeldenMislukt(null, { technieker: 'Tim', gezien: new Set() }), []);
});

test('opnieuwVersturen: POST { opnieuw: id }; ok, ongewijzigd en fout', async () => {
  const calls = [];
  const maak = antwoord => async (url, opt) => {
    calls.push({ url, opt });
    if (antwoord instanceof Error) throw antwoord;
    return { ok: antwoord.status < 400, status: antwoord.status, json: async () => antwoord.body };
  };
  assert.deepEqual(await opnieuwVersturen('x1', { fetch: maak({ status: 200, body: { ok: true, versie: 3 } }) }), { ok: true });
  assert.equal(calls[0].url, '/api/rapport-archief');
  assert.equal(calls[0].opt.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opt.body), { opnieuw: 'x1' });
  assert.deepEqual(await opnieuwVersturen('x1', { fetch: maak({ status: 200, body: { ok: true, ongewijzigd: true } }) }), { ok: true });
  const f404 = await opnieuwVersturen('x1', { fetch: maak({ status: 404, body: { error: 'Rapport niet gevonden' } }) });
  assert.equal(f404.ok, false);
  assert.match(f404.fout, /niet gevonden/);
  const fNet = await opnieuwVersturen('x1', { fetch: maak(new Error('offline')) });
  assert.equal(fNet.ok, false);
  assert.ok(fNet.fout);
});
