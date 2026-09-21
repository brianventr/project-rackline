import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId, docNumber } from "../lib/ids";
import { asnLinesFromPurchase, demoPurchaseMessage } from "../domain/purchase-send";

export async function loadOpenAsnCovers(db: AppDb, organizationId: string) {
  const rows = await db
    .select({
      itemId: schema.asnLines.itemId,
      status: schema.asns.status,
    })
    .from(schema.asnLines)
    .innerJoin(schema.asns, eq(schema.asns.id, schema.asnLines.asnId))
    .where(and(eq(schema.asns.organizationId, organizationId), inArray(schema.asns.status, ["draft", "expected", "receiving"])));
  return rows;
}

export async function sendPurchaseOrder(
  db: AppDb,
  input: {
    organizationId: string;
    purchase: {
      id: string;
      warehouseId: string;
      number: string;
      vendorName: string;
      notes: string | null;
      clientId: string | null;
      lines: { itemId: string; sku: string; qtyOrdered: number; qtyReceived: number }[];
    };
    to?: string | null;
    message?: string | null;
    now?: number;
  },
) {
  const now = input.now ?? Date.now();
  const body =
    input.message?.trim() ||
    demoPurchaseMessage({
      number: input.purchase.number,
      vendorName: input.purchase.vendorName,
      lines: input.purchase.lines,
    });
  const toAddress = input.to?.trim() || input.purchase.vendorName;
  const sendId = newId();
  const covers = await loadOpenAsnCovers(db, input.organizationId);
  const asnLines = asnLinesFromPurchase(input.purchase.lines, covers);
  const asnId = asnLines.length > 0 ? newId() : null;
  const statements: BatchItem<"sqlite">[] = [
    db.insert(schema.purchaseSends).values({
      id: sendId,
      organizationId: input.organizationId,
      purchaseId: input.purchase.id,
      toAddress,
      subject: input.purchase.number,
      body,
      mode: "demo",
      createdAt: now,
    }),
    db
      .update(schema.purchases)
      .set({ status: "ordered", orderedAt: now })
      .where(eq(schema.purchases.id, input.purchase.id)),
  ];
  if (asnId) {
    statements.push(
      db.insert(schema.asns).values({
        id: asnId,
        organizationId: input.organizationId,
        warehouseId: input.purchase.warehouseId,
        number: docNumber("ASN"),
        vendorName: input.purchase.vendorName,
        status: "expected",
        purchaseId: input.purchase.id,
        clientId: input.purchase.clientId,
        notes: `Expected from ${input.purchase.number}`,
        createdAt: now,
        expectedAt: now,
      }),
    );
    for (const line of asnLines) {
      statements.push(
        db.insert(schema.asnLines).values({
          id: newId(),
          asnId,
          itemId: line.itemId,
          qtyExpected: line.qty,
          qtyReceived: 0,
        }),
      );
    }
  }
  await db.batch(statements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { sendId, asnId, body, toAddress };
}
