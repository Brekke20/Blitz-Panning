// Loonkost per rapport (gedeeld door rapport-wizard, rapport-archief en het dashboard). Pure functie, geen I/O.
export function berekenLoonkost(servicetype, werktijdMin, aanrijtijdMin) {
  if (servicetype === '2e-lijn') {
    const totMin    = (werktijdMin || 0) + (aanrijtijdMin || 0);
    const totUren   = totMin / 60;
    const extraUren = totUren > 3 ? Math.ceil(totUren - 3) : 0;
    return { bruto: 175 + extraUren * 75, totMin, extraUren };
  }
  if (servicetype === '1e-lijn') {
    const totMin = (werktijdMin || 0) + (aanrijtijdMin || 0);
    const gestartUren = Math.ceil(totMin / 60);
    return { bruto: gestartUren * 115, gestartUren, totMin, extraUren: 0 };
  }
  // garantie: zelfde berekening als 1e lijn maar netto = 0
  const totMin = (werktijdMin || 0) + (aanrijtijdMin || 0);
  const gestartUren = Math.ceil(totMin / 60);
  return { bruto: gestartUren * 115, gestartUren, netto: 0, totMin, extraUren: 0 };
}
