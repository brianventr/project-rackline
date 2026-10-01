import { eq } from "drizzle-orm";
import { RESTOCK_SOURCE, restockProblems } from "../../domain/exceptions/restock";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import * as schema from "../schema";
import { loadRestockNeeds } from "../restock";
import type { ExceptionSource } from "./source";

export const restockSource: ExceptionSource = {
  ...RESTOCK_SOURCE,
  loadLimit: SOURCE_LIMIT + 1,
  async load({ db, organizationId, warehouseId }) {
    const [org] = await db
      .select({ restockPolicy: schema.organizations.restockPolicy })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);
    if (!org || org.restockPolicy === "off") return [];
    const needs = await loadRestockNeeds(db, organizationId, warehouseId);
    return restockProblems(needs).slice(0, SOURCE_LIMIT + 1);
  },
};
