import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { DEMO_EMAIL } from "../db/seed";
import type { AppDb } from "../db/stock";
import { decideLabAccess, parseLabOrgIds, type LabAccess } from "../domain/lab-access";
import type { Bindings } from "./types";

/** The demo organization is the one the demo login belongs to (its seeded staff share its password). */
async function isDemoOrganization(db: AppDb, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.user.email, DEMO_EMAIL)))
    .limit(1);
  return !!row;
}

export async function labAccessFor(db: AppDb, env: Pick<Bindings, "LAB_ORG_IDS">, organizationId: string): Promise<LabAccess> {
  return decideLabAccess({
    organizationId,
    demoOrganization: await isDemoOrganization(db, organizationId),
    allowedOrgIds: parseLabOrgIds(env.LAB_ORG_IDS),
  });
}
