/**
 * Who may open the hidden lab. Product CAD lives there, so two rules hold on the server, not just in the
 * top bar: the shared demo organization never gets it (anyone on the internet can sign in to it, and
 * its seeded staff share the demo password), and when LAB_ORG_IDS is set, only those organizations do.
 */
export type LabAccess = "open" | "demo" | "not-listed";

/** "org_a, org_b" → a set; blank or missing → null, meaning every organization but the demo. */
export function parseLabOrgIds(value: string | undefined | null): Set<string> | null {
  const ids = (value ?? "")
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

export function decideLabAccess(input: {
  organizationId: string;
  demoOrganization: boolean;
  allowedOrgIds: Set<string> | null;
}): LabAccess {
  if (input.demoOrganization) return "demo";
  if (input.allowedOrgIds && !input.allowedOrgIds.has(input.organizationId)) return "not-listed";
  return "open";
}

export const LAB_CLOSED_MESSAGE: Record<Exclude<LabAccess, "open">, string> = {
  demo: "The lab is closed to the shared demo login. Sign in with your own organization to use it.",
  "not-listed": "The lab is not open to this organization.",
};
