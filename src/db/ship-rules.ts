import { eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { isRateStrategy, parseShipRuleConditions, type ShipRule } from "../domain/ship-rules";

export type StoredShipRule = ShipRule & { createdAt: number; updatedAt: number };

export function shipRuleFromRow(row: typeof schema.shipRules.$inferSelect): StoredShipRule {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    enabled: row.enabled,
    warehouseId: row.warehouseId,
    conditions: parseShipRuleConditions(row.conditionsJson),
    presetId: row.presetId,
    carrierService: row.carrierService,
    carrierConnectionId: row.carrierConnectionId,
    rateStrategy: isRateStrategy(row.rateStrategy) ? row.rateStrategy : null,
    hold: row.hold,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every rule on the org, top to bottom. */
export async function loadShipRules(db: AppDb, organizationId: string): Promise<StoredShipRule[]> {
  const rows = await db.select().from(schema.shipRules).where(eq(schema.shipRules.organizationId, organizationId));
  return rows
    .map(shipRuleFromRow)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
