import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { forbidden, requireString } from "../lib/http";
import { getOrgWarehouse, requireOwner } from "../lib/org";
import { isGarageMode } from "../domain/operating-mode";
import { planSlotting, previewSlotting } from "../db/slotting";

export const slottingRoute = new Hono<AppEnv>();

async function assertManufacturer(c: Context<AppEnv>) {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [org] = await db
    .select({ operatingMode: schema.organizations.operatingMode })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  if (isGarageMode(org?.operatingMode)) forbidden("Slotting is a Manufacturer tool");
  return { db, organizationId };
}

slottingRoute.get("/slotting", async (c) => {
  const warehouseId = requireString(c.req.query("warehouseId"), "warehouseId");
  const { db, organizationId } = await assertManufacturer(c);
  await getOrgWarehouse(db, organizationId, warehouseId);
  return c.json(await previewSlotting(db, { organizationId, warehouseId }));
});

slottingRoute.post("/slotting/plan", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ warehouseId?: string }>().catch(() => ({}) as { warehouseId?: string });
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const { db, organizationId } = await assertManufacturer(c);
  await getOrgWarehouse(db, organizationId, warehouseId);
  return c.json(await planSlotting(db, { organizationId, warehouseId }));
});
