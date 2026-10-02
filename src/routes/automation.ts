import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { customerMailConfigured, loadCustomerMailSettings } from "../db/customer-mail";
import * as schema from "../db/schema";
import { automationPolicyFromStored, automationPolicyJson, parseAutomationPolicy, type AutomationPolicy } from "../domain/automation";
import type { CustomerMailSettings } from "../domain/customer-mail";
import { parseRestockPolicy, type RestockPolicy } from "../domain/restock";
import { badRequest, notFound } from "../lib/http";
import { requireOwner } from "../lib/org";
import type { AppEnv } from "../lib/types";

export const automationRoute = new Hono<AppEnv>();

type AutomationView = {
  policy: AutomationPolicy;
  restockPolicy: RestockPolicy;
  notifications: CustomerMailSettings & { mailConfigured: boolean };
};

async function present(c: Context<AppEnv>): Promise<AutomationView> {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [org] = await db
    .select({
      restockPolicy: schema.organizations.restockPolicy,
      automationPolicy: schema.organizations.automationPolicy,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  if (!org) notFound("Organization not found");
  const settings = await loadCustomerMailSettings(db, organizationId);
  if (!settings) notFound("Organization not found");
  return {
    policy: automationPolicyFromStored(org.automationPolicy),
    restockPolicy: parseRestockPolicy(org.restockPolicy),
    notifications: { ...settings, mailConfigured: customerMailConfigured(c.env) },
  };
}

automationRoute.get("/organization/automation", async (c) => {
  requireOwner(c.get("role"));
  return c.json(await present(c));
});

automationRoute.patch("/organization/automation", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ policy?: unknown }>().catch(() => ({}) as { policy?: unknown });
  let policy: AutomationPolicy;
  try {
    policy = parseAutomationPolicy(body.policy);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid automation policy");
  }
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await db
    .update(schema.organizations)
    .set({ automationPolicy: automationPolicyJson(policy!) })
    .where(eq(schema.organizations.id, organizationId));
  return c.json(await present(c));
});
