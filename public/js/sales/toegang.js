// Sales-planner: wie mag welke verkoper-gegevens lezen of schrijven (pure logica; de server past dezelfde regels toe).
// `gebruiker` = { id, rol, magAlleSales? }; `doelId` = de gebruiker aan wie de gegevens toebehoren.

const isSales = (g) => g?.rol === 'sales';
const isBeheerder = (g) => g?.rol === 'beheerder';

/** Sales: eigen gegevens, of die van een ander bij `magAlleSales`; beheerder: iedereen. */
export function magLezen(gebruiker, doelId) {
  if (!doelId) return false;
  if (isBeheerder(gebruiker)) return true;
  return isSales(gebruiker) && (gebruiker.id === doelId || gebruiker.magAlleSales === true);
}

/** Sales: enkel eigen gegevens; beheerder: iedereen. */
export function magSchrijven(gebruiker, doelId) {
  if (!doelId) return false;
  if (isBeheerder(gebruiker)) return true;
  return isSales(gebruiker) && gebruiker.id === doelId;
}

/** Beheerder, of sales met `magAlleSales` (zelfde regel als `huidigeRechten().alleSales`). */
export function kanVerkoperKiezen(gebruiker) {
  return isBeheerder(gebruiker) || (isSales(gebruiker) && gebruiker.magAlleSales === true);
}
