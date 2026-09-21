export type GenealogyLink = {
  parentLotCode: string | null;
  parentSerial: string | null;
  componentLotCode: string | null;
  componentSerial: string | null;
};

function code(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** Walk as-built from a component lot or serial up to the finished lots and serials that contain it. */
export function expandRecallCodes(query: string, links: GenealogyLink[]): { lots: Set<string>; serials: Set<string> } {
  const lots = new Set<string>();
  const serials = new Set<string>();
  const needle = code(query);
  if (!needle) return { lots, serials };
  lots.add(needle);
  serials.add(needle);
  let grew = true;
  while (grew) {
    grew = false;
    for (const link of links) {
      const componentHit =
        (code(link.componentLotCode) !== "" && lots.has(code(link.componentLotCode))) ||
        (code(link.componentSerial) !== "" && serials.has(code(link.componentSerial)));
      if (!componentHit) continue;
      const parentLot = code(link.parentLotCode);
      const parentSerial = code(link.parentSerial);
      if (parentLot && !lots.has(parentLot)) {
        lots.add(parentLot);
        grew = true;
      }
      if (parentSerial && !serials.has(parentSerial)) {
        serials.add(parentSerial);
        grew = true;
      }
    }
  }
  return { lots, serials };
}

export function movementMatchesRecall(
  movement: { lotCode: string | null; serialsJson: string | null },
  lots: Set<string>,
  serials: Set<string>,
): boolean {
  if (movement.lotCode && lots.has(code(movement.lotCode))) return true;
  if (!movement.serialsJson) return false;
  try {
    const parsed = JSON.parse(movement.serialsJson) as unknown;
    if (!Array.isArray(parsed)) return false;
    return parsed.some((row) => typeof row === "string" && serials.has(code(row)));
  } catch {
    return false;
  }
}

const CLOSED = new Set(["shipped", "cancelled"]);

export function orderIsOpen(status: string): boolean {
  return !CLOSED.has(status);
}
