import { eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { remainingToCarton, type CartonLine } from "../domain/cartons";
import { rollupOrderTracker } from "../domain/tracker";

export type OrderPackageLineRow = {
  id: string;
  packageId: string;
  orderLineId: string;
  itemId: string;
  qty: number;
  sku: string;
  itemName: string;
};

export type OrderPackageRow = typeof schema.orderPackages.$inferSelect & {
  lines: OrderPackageLineRow[];
  units: number;
};

export async function loadPackagesForOrders(db: AppDb, orderIds: string[]): Promise<Map<string, OrderPackageRow[]>> {
  const byOrder = new Map<string, OrderPackageRow[]>();
  if (orderIds.length === 0) return byOrder;
  const packages = await db
    .select()
    .from(schema.orderPackages)
    .where(inArray(schema.orderPackages.orderId, orderIds));
  if (packages.length === 0) return byOrder;
  const lines = await db
    .select({
      id: schema.orderPackageLines.id,
      packageId: schema.orderPackageLines.packageId,
      orderLineId: schema.orderPackageLines.orderLineId,
      itemId: schema.orderPackageLines.itemId,
      qty: schema.orderPackageLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.orderPackageLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderPackageLines.itemId))
    .where(
      inArray(
        schema.orderPackageLines.packageId,
        packages.map((row) => row.id),
      ),
    );
  const linesByPackage = new Map<string, OrderPackageLineRow[]>();
  for (const line of lines) {
    const list = linesByPackage.get(line.packageId) ?? [];
    list.push(line);
    linesByPackage.set(line.packageId, list);
  }
  for (const row of packages) {
    const pkgLines = linesByPackage.get(row.id) ?? [];
    const list = byOrder.get(row.orderId) ?? [];
    list.push({
      ...row,
      lines: pkgLines,
      units: pkgLines.reduce((sum, line) => sum + line.qty, 0),
    });
    byOrder.set(row.orderId, list);
  }
  for (const list of byOrder.values()) list.sort((a, b) => a.seq - b.seq);
  return byOrder;
}

export function qtyCartonedByLine(packages: OrderPackageRow[]): Map<string, number> {
  const qty = new Map<string, number>();
  for (const pkg of packages) {
    for (const line of pkg.lines) {
      qty.set(line.orderLineId, (qty.get(line.orderLineId) ?? 0) + line.qty);
    }
  }
  return qty;
}

export function asCartonLines(
  lines: { id: string; sku: string; qtyPacked: number }[],
  packages: OrderPackageRow[],
): CartonLine[] {
  const cartoned = qtyCartonedByLine(packages);
  return lines.map((line) => ({
    lineId: line.id,
    sku: line.sku,
    qtyPacked: line.qtyPacked,
    qtyCartoned: cartoned.get(line.id) ?? 0,
  }));
}

export function withCartonRemaining<T extends { id: string; sku: string; qtyPacked: number }>(
  lines: T[],
  packages: OrderPackageRow[],
) {
  const cartoned = qtyCartonedByLine(packages);
  return lines.map((line) => {
    const qtyCartoned = cartoned.get(line.id) ?? 0;
    return {
      ...line,
      qtyCartoned,
      cartonRemaining: remainingToCarton({
        lineId: line.id,
        sku: line.sku,
        qtyPacked: line.qtyPacked,
        qtyCartoned,
      }),
    };
  });
}

export function orderPatchFromPackages(packages: OrderPackageRow[]): {
  trackingNumber: string | null;
  trackingCompany: string | null;
  trackingUrl: string | null;
  carrierService: string | null;
  carrierConnectionId: string | null;
  carrierShipmentId: string | null;
  carrierLabelId: string | null;
  postageCents: number | null;
  labelStatus: string;
  packageWeightOz: number | null;
  packageLengthIn: number | null;
  packageWidthIn: number | null;
  packageHeightIn: number | null;
  trackerStatus: string | null;
} | null {
  if (packages.length === 0) return null;
  const labeled = packages.find((row) => row.trackingNumber) ?? null;
  const postage = packages.reduce((sum, row) => sum + (row.postageCents ?? 0), 0);
  return {
    trackingNumber: labeled?.trackingNumber ?? null,
    trackingCompany: labeled?.trackingCompany ?? null,
    trackingUrl: labeled?.trackingUrl ?? null,
    carrierService: labeled?.carrierService ?? null,
    carrierConnectionId: labeled?.carrierConnectionId ?? null,
    carrierShipmentId: labeled?.carrierShipmentId ?? null,
    carrierLabelId: labeled?.carrierLabelId ?? null,
    postageCents: postage > 0 ? postage : null,
    labelStatus: labeled ? "purchased" : packages.some((row) => row.labelStatus === "voided") ? "voided" : "none",
    packageWeightOz: labeled?.weightOz ?? packages[0]?.weightOz ?? null,
    packageLengthIn: labeled?.lengthIn ?? packages[0]?.lengthIn ?? null,
    packageWidthIn: labeled?.widthIn ?? packages[0]?.widthIn ?? null,
    packageHeightIn: labeled?.heightIn ?? packages[0]?.heightIn ?? null,
    trackerStatus: rollupOrderTracker(packages),
  };
}
