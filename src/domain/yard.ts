/** Yard visit status transitions for dock / trailer check-in. */

export function nextYardStatus(
  current: string,
  action: "check_in" | "assign_dock" | "check_out",
): string | null {
  if (action === "check_in" && current === "expected") return "checked_in";
  if (action === "assign_dock" && (current === "checked_in" || current === "at_dock")) return "at_dock";
  if (action === "check_out" && (current === "checked_in" || current === "at_dock")) return "checked_out";
  return null;
}

export function yardLabel(visit: {
  number: string;
  carrierName: string;
  trailerNumber?: string | null;
}): string {
  const trailer = visit.trailerNumber?.trim();
  return trailer ? `${visit.number} · ${visit.carrierName} / ${trailer}` : `${visit.number} · ${visit.carrierName}`;
}
