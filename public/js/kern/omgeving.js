// kern/omgeving.js — omgevingsvlaggen (puur, geen window)
// TEST_MODE: de app draait met ?test in de URL (geen echte schrijfacties naar de backend).
export const TEST_MODE = new URLSearchParams(globalThis.location?.search ?? '').has('test');
