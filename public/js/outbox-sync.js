// public/js/outbox-sync.js
// Registreert Background Sync (tag 'rapport-outbox') zodat de service worker een onderbroken
// rapport-verzending ook afwerkt als de app gesloten of het scherm vergrendeld is (Android/Chrome).
// Waar de Background Sync API ontbreekt (iOS/Safari, Firefox) geeft dit false terug en hervat de
// outbox gewoon bij het openen van de app. Alle fouten worden ingeslikt: dit is een extra vangnet,
// nooit een voorwaarde voor het versturen zelf.
export async function registreerAchtergrondVerzending() {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!('sync' in reg)) return false;
    await reg.sync.register('rapport-outbox');
    return true;
  } catch (e) {
    return false;
  }
}
