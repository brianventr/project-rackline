/** 3PL client tags on documents — inventory stays on the location:item ledger. */

export function filterByClient<T extends { clientId?: string | null }>(
  rows: T[],
  clientId: string | null | undefined,
): T[] {
  if (!clientId) return rows;
  return rows.filter((row) => row.clientId === clientId);
}

export function clientLabel(client: { code: string; name: string } | null | undefined): string {
  if (!client) return "House";
  return `${client.code} — ${client.name}`;
}
