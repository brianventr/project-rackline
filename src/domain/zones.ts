/** Zone helpers — locations optionally belong to a pick/putaway zone. */

export function locationsInZone<T extends { zoneId?: string | null }>(rows: T[], zoneId: string | null | undefined): T[] {
  if (!zoneId) return rows;
  return rows.filter((row) => row.zoneId === zoneId);
}

export function zoneCode(zone: { code: string; name: string } | null | undefined): string {
  if (!zone) return "—";
  return zone.code;
}
