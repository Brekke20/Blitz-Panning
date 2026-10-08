// public/js/test-upload.js
// Opt-in bovenop de testmodus: ?test&upload laat de ECHTE outbox tegen de testopslag lopen
// (POST /api/rapport-ontvangen met X-Blitz-Test: 1, dus nooit Zoho of Chromium). Zonder &upload
// verstuurt testmodus niets, zoals voorheen.
const _params = new URLSearchParams(location.search);
export const TEST_UPLOAD = _params.has('test') && _params.has('upload');
