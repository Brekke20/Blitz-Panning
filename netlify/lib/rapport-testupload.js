// Nep-upload voor de testmodus: nooit Zoho, nooit Chromium. Het testticket 'p2' laat de upload
// bewust falen, zodat de status 'mislukt' getest kan worden.

export const TEST_MISLUKT_TICKETID = 'p2';

export async function testUpload({ ticketId }) {
  if (ticketId === TEST_MISLUKT_TICKETID) throw new Error('Testfout: Zoho onbereikbaar');
  return { attachmentId: 'test-bijlage' };
}
