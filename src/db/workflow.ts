import { eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { workflowPolicy, type WorkflowPolicy } from "../domain/workflow-policy";

export async function loadWorkflowPolicy(db: AppDb, organizationId: string): Promise<WorkflowPolicy> {
  const [org] = await db
    .select({ operatingMode: schema.organizations.operatingMode })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return workflowPolicy(org?.operatingMode);
}
