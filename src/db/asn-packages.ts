import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { remainingToCarton, type CartonLine } from "../domain/cartons";
import { parseSerialList } from "../domain/lots";

export type AsnPackageLineRow = {
  id: string;
  packageId: string;
  asnLineId: string;
  itemId: string;
  qty: number;
  sku: string;
  itemName: string;
  lotCode: string | null;
  serials: string[];
  weightGrams: number | null;
  expiresOn: number | null;
};

export type AsnPackageRow = typeof schema.asnPackages.$inferSelect & {
  lines: AsnPackageLineRow[];
  units: number;
};

export type UnputawayAsnCarton = AsnPackageRow & {
  asnNumber: string;
  warehouseId: string;
  locationId: string;
  fromCode: string;
  fromBarcode: string;
  fromType: string;
};

export function parseSerialsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return parseSerialList(JSON.parse(value) as unknown as string | string[]);
  } catch {
    try {
      return parseSerialList(value);
    } catch {
      return [];
    }
  }
}

export function serializeSerialsJson(serials: string[] | null | undefined): string | null {
  return serials && serials.length > 0 ? JSON.stringify(serials) : null;
}

export async function loadPackagesForAsns(db: AppDb, asnIds: string[]): Promise<Map<string, AsnPackageRow[]>> {
  const byAsn = new Map<string, AsnPackageRow[]>();
  if (asnIds.length === 0) return byAsn;
  const packages = await db.select().from(schema.asnPackages).where(inArray(schema.asnPackages.asnId, asnIds));
  if (packages.length === 0) return byAsn;
  const lines = await loadAsnPackageLines(db, packages.map((row) => row.id));
  const linesByPackage = groupPackageLines(lines);
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

export async function loadUnputawayReceivedCartons(
  db: AppDb,
  organizationId: string,
  filter: { locationId?: string; warehouseId?: string } = {},
): Promise<UnputawayAsnCarton[]> {
  const packages = await db
    .select({
      id: schema.asnPackages.id,
      organizationId: schema.asnPackages.organizationId,
      asnId: schema.asnPackages.asnId,
      number: schema.asnPackages.number,
      seq: schema.asnPackages.seq,
      sscc: schema.asnPackages.sscc,
      receivedAt: schema.asnPackages.receivedAt,
      putawayAt: schema.asnPackages.putawayAt,
      createdAt: schema.asnPackages.createdAt,
      asnNumber: schema.asns.number,
      warehouseId: schema.asns.warehouseId,
      locationId: schema.asns.locationId,
      fromCode: schema.locations.code,
      fromBarcode: schema.locations.barcode,
      fromType: schema.locations.type,
    })
    .from(schema.asnPackages)
    .innerJoin(schema.asns, eq(schema.asns.id, schema.asnPackages.asnId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.asns.locationId))
    .where(
      and(
        eq(schema.asnPackages.organizationId, organizationId),
        isNotNull(schema.asnPackages.receivedAt),
        isNull(schema.asnPackages.putawayAt),
        filter.locationId ? eq(schema.asns.locationId, filter.locationId) : undefined,
        filter.warehouseId ? eq(schema.asns.warehouseId, filter.warehouseId) : undefined,
      ),
    );
  if (packages.length === 0) return [];
  const lines = await loadAsnPackageLines(
    db,
    packages.map((row) => row.id),
  );
  const linesByPackage = groupPackageLines(lines);
  return packages
    .filter((row): row is typeof row & { locationId: string } => Boolean(row.locationId))
    .map((row) => {
      const pkgLines = linesByPackage.get(row.id) ?? [];
      return {
        ...row,
        locationId: row.locationId,
        lines: pkgLines,
        units: pkgLines.reduce((sum, line) => sum + line.qty, 0),
      };
    })
    .sort((a, b) => a.asnNumber.localeCompare(b.asnNumber) || a.seq - b.seq);
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

async function loadAsnPackageLines(db: AppDb, packageIds: string[]): Promise<AsnPackageLineRow[]> {
  if (packageIds.length === 0) return [];
  const rows = await db
    .select({
      id: schema.asnPackageLines.id,
      packageId: schema.asnPackageLines.packageId,
      asnLineId: schema.asnPackageLines.asnLineId,
      itemId: schema.asnPackageLines.itemId,
      qty: schema.asnPackageLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
      lotCode: schema.asnPackageLines.lotCode,
      serialsJson: schema.asnPackageLines.serialsJson,
      weightGrams: schema.asnPackageLines.weightGrams,
      expiresOn: schema.asnPackageLines.expiresOn,
    })
    .from(schema.asnPackageLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.asnPackageLines.itemId))
    .where(inArray(schema.asnPackageLines.packageId, packageIds));
  return rows.map((row) => ({
    id: row.id,
    packageId: row.packageId,
    asnLineId: row.asnLineId,
    itemId: row.itemId,
    qty: row.qty,
    sku: row.sku,
    itemName: row.itemName,
    lotCode: row.lotCode,
    serials: parseSerialsJson(row.serialsJson),
    weightGrams: row.weightGrams,
    expiresOn: row.expiresOn,
  }));
}

function groupPackageLines(lines: AsnPackageLineRow[]): Map<string, AsnPackageLineRow[]> {
  const linesByPackage = new Map<string, AsnPackageLineRow[]>();
  for (const line of lines) {
    const list = linesByPackage.get(line.packageId) ?? [];
    list.push(line);
    linesByPackage.set(line.packageId, list);
  }
  return linesByPackage;
}
