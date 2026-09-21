import { eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { remainingToCarton, type CartonLine } from "../domain/cartons";

export type AsnPackageLineRow = {
  id: string;
  packageId: string;
  asnLineId: string;
  itemId: string;
  qty: number;
  sku: string;
  itemName: string;
};

export type AsnPackageRow = typeof schema.asnPackages.$inferSelect & {
  lines: AsnPackageLineRow[];
  units: number;
};

export async function loadPackagesForAsns(db: AppDb, asnIds: string[]): Promise<Map<string, AsnPackageRow[]>> {
  const byAsn = new Map<string, AsnPackageRow[]>();
  if (asnIds.length === 0) return byAsn;
  const packages = await db.select().from(schema.asnPackages).where(inArray(schema.asnPackages.asnId, asnIds));
  if (packages.length === 0) return byAsn;
  const lines = await db
    .select({
      id: schema.asnPackageLines.id,
      packageId: schema.asnPackageLines.packageId,
      asnLineId: schema.asnPackageLines.asnLineId,
      itemId: schema.asnPackageLines.itemId,
      qty: schema.asnPackageLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.asnPackageLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.asnPackageLines.itemId))
    .where(
      inArray(
        schema.asnPackageLines.packageId,
        packages.map((row) => row.id),
      ),
    );
  const linesByPackage = new Map<string, AsnPackageLineRow[]>();
  for (const line of lines) {
    const list = linesByPackage.get(line.packageId) ?? [];
    list.push(line);
    linesByPackage.set(line.packageId, list);
  }
  for (const row of packages) {
    const pkgLines = linesByPackage.get(row.id) ?? [];
    const list = byAsn.get(row.asnId) ?? [];
    list.push({
      ...row,
      lines: pkgLines,
      units: pkgLines.reduce((sum, line) => sum + line.qty, 0),
    });
    byAsn.set(row.asnId, list);
  }
  for (const list of byAsn.values()) list.sort((a, b) => a.seq - b.seq);
  return byAsn;
}

export function qtyCartonedByAsnLine(packages: AsnPackageRow[]): Map<string, number> {
  const qty = new Map<string, number>();
  for (const pkg of packages) {
    for (const line of pkg.lines) {
      qty.set(line.asnLineId, (qty.get(line.asnLineId) ?? 0) + line.qty);
    }
  }
  return qty;
}

export function asAsnCartonLines(
  lines: { id: string; sku: string; qtyExpected: number }[],
  packages: AsnPackageRow[],
): CartonLine[] {
  const cartoned = qtyCartonedByAsnLine(packages);
  return lines.map((line) => ({
    lineId: line.id,
    sku: line.sku,
    qtyPacked: line.qtyExpected,
    qtyCartoned: cartoned.get(line.id) ?? 0,
  }));
}

export function withAsnCartonRemaining<T extends { id: string; sku: string; qtyExpected: number }>(
  lines: T[],
  packages: AsnPackageRow[],
) {
  const cartoned = qtyCartonedByAsnLine(packages);
  return lines.map((line) => {
    const qtyCartoned = cartoned.get(line.id) ?? 0;
    return {
      ...line,
      qtyCartoned,
      cartonRemaining: remainingToCarton({
        lineId: line.id,
        sku: line.sku,
        qtyPacked: line.qtyExpected,
        qtyCartoned,
      }),
    };
  });
}
