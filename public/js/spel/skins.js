// TIJDELIJKE STUB — wordt vervangen door feat/spel-skins
// Minimale invulling van het skins-contract zodat "Blitz Run" draait en de tests slagen. Het echte bestand
// (feat/spel-skins) vervangt dit volledig; de tests mogen enkel van `standaardSkin()` afhangen.
export const SKINS = [
  { id: 'basis', naam: 'Blitz', soort: 'basis', faceplate: '#00dfa3', behuizing: '#1f2630' },
  { id: 'goud', naam: 'Goud', soort: 'goud', drempel: 1500, faceplate: '#f5c542', behuizing: '#3a2f12' },
];

export function standaardSkin() { return 'basis'; }

export function tekenPaal(ctx, skin, { x, y, breedte, hoogte, bukken = false, t = 0 }) {
  const top = y - hoogte;
  ctx.save();
  ctx.fillStyle = skin.behuizing;
  ctx.fillRect(x, top, breedte, hoogte);
  const fw = Math.max(6, breedte * 0.45);
  const fh = Math.max(8, hoogte * 0.3);
  ctx.fillStyle = skin.faceplate;
  ctx.fillRect(x + 2, top + 3, fw, fh);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 2 + fw * 0.65, top + 4);
  ctx.lineTo(x + 2 + fw * 0.35, top + 3 + fh * 0.5);
  ctx.lineTo(x + 2 + fw * 0.6, top + 3 + fh * 0.5);
  ctx.lineTo(x + 2 + fw * 0.3, top + 2 + fh);
  ctx.stroke();
  if (bukken && t >= 0) ctx.fillRect(x, y - 2, breedte, 2);
  ctx.restore();
}
