/** 3PL client tags on documents — inventory stays on the location:item ledger. */

export function filterByClient<T extends { clientId?: string | null }>(
  rows: T[],
  clientId: string | null | undefined,
): T[] {
  if (!clientId) return rows;
  return rows.filter((row) => row.clientId === clientId);
}

const PRODUCED = new Set(["kit_produce", "wo_produce", "receive"]);

export function stampProducedClient(
  plan: { movements: { type: string; clientId?: string | null }[] },
  clientId: string | null | undefined,
): void {
  if (!clientId) return;
  for (const movement of plan.movements) {
    if (PRODUCED.has(movement.type) && !movement.clientId) movement.clientId = clientId;
  }
}

export function clientLabel(client: { code: string; name: string } | null | undefined): string {
  if (!client) return "House";
  return `${client.code} — ${client.name}`;
}
