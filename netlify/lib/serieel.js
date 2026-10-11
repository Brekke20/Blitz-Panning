// Werk binnen één instantie na elkaar laten lopen. De Blobs-schrijfacties hebben geen echte bescherming
// tegen verloren updates (zie blob-wijzig.js): parallelle verzoeken in dezelfde instantie mogen elkaar niet
// overschrijven. Tussen instanties blijft enkel de terugleescontrole van wijzigBlob.
export function maakSerieel() {
  let keten = Promise.resolve();
  return function serieel(werk) {
    const resultaat = keten.then(werk, werk);
    keten = resultaat.then(() => {}, () => {});
    return resultaat;
  };
}
