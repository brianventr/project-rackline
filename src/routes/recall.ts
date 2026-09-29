import { Hono } from "hono";
import { and, eq, or } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest } from "../lib/http";
import { buildRecallSummary, type RecallHit } from "../domain/recall";

export const recallRoute = new Hono<AppEnv>();

recallRoute.get("/recall", async (c) => {
  const lotCode = c.req.query("lot")?.trim() || "";
  const serial = c.req.query("serial")?.trim() || "";
  if (!lotCode && !serial) badRequest("Provide lot or serial query");

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const hits: RecallHit[] = [];

  if (lotCode) {
    const lots = await db
      .select({
        sku: schema.items.sku,
        name: schema.items.name,
        lotCode: schema.lotBalances.lotCode,
        qty: schema.lotBalances.qty,
        locationCode: schema.locations.code,
      })
      .from(schema.lotBalances)
      .innerJoin(schema.items, eq(schema.items.id, schema.lotBalances.itemId))
      .innerJoin(schema.locations, eq(schema.locations.id, schema.lotBalances.locationId))
      .where(and(eq(schema.lotBalances.organizationId, organizationId), eq(schema.lotBalances.lotCode, lotCode)));
    for (const row of lots) {
      hits.push({
        kind: "balance",
        sku: row.sku,
        name: row.name,
        lotCode: row.lotCode,
        locationCode: row.locationCode,
        qty: row.qty,
        detail: `${row.qty} on ${row.locationCode}`,
      });
    }

    const built = await db
      .select()
      .from(schema.asBuilt)
      .where(
        and(
          eq(schema.asBuilt.organizationId, organizationId),
          or(eq(schema.asBuilt.parentLotCode, lotCode), eq(schema.asBuilt.componentLotCode, lotCode)),
        ),
      )
      .limit(200);
    for (const row of built) {
      const asParent = row.parentLotCode === lotCode;
      hits.push({
        kind: asParent ? "as_built_parent" : "as_built_component",
        sku: asParent ? row.parentItemId : row.componentItemId,
        lotCode,
        serial: asParent ? row.parentSerial : row.componentSerial,
        documentNumber: row.refType,
        detail: asParent
          ? `Finished lot used components from ${row.refType}`
          : `Component lot consumed into ${row.refType} ${row.refId}`,
      });
    }
  }

  if (serial) {
    const serialRows = await db
      .select({
        sku: schema.items.sku,
        name: schema.items.name,
        serial: schema.serials.serialCode,
        locationCode: schema.locations.code,
        status: schema.serials.status,
      })
      .from(schema.serials)
      .innerJoin(schema.items, eq(schema.items.id, schema.serials.itemId))
      .leftJoin(schema.locations, eq(schema.locations.id, schema.serials.locationId))
      .where(and(eq(schema.serials.organizationId, organizationId), eq(schema.serials.serialCode, serial)));
    for (const row of serialRows) {
      hits.push({
        kind: "balance",
        sku: row.sku,
        name: row.name,
        serial: row.serial,
        locationCode: row.locationCode,
        qty: row.status === "on_hand" ? 1 : 0,
        detail: `Serial ${row.status}${row.locationCode ? ` at ${row.locationCode}` : ""}`,
      });
    }

    const built = await db
      .select()
      .from(schema.asBuilt)
      .where(
        and(
          eq(schema.asBuilt.organizationId, organizationId),
          or(eq(schema.asBuilt.parentSerial, serial), eq(schema.asBuilt.componentSerial, serial)),
        ),
      )
      .limit(200);
    for (const row of built) {
      const asParent = row.parentSerial === serial;
      hits.push({
        kind: asParent ? "as_built_parent" : "as_built_component",
        sku: asParent ? row.parentItemId : row.componentItemId,
        serial,
        lotCode: asParent ? row.parentLotCode : row.componentLotCode,
        detail: asParent ? `Finished serial genealogy` : `Component serial in ${row.refType}`,
      });
    }
  }

  return c.json({
    query: { lot: lotCode || null, serial: serial || null },
    summary: buildRecallSummary(hits),
    hits,
  });
});
