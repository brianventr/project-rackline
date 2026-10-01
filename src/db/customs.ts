import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { customsForLabel, labelCountries, quoteCustoms, type CustomsDeclaration, type CustomsLine } from "../domain/customs";
import { buildingAddress, crossesBorder, orderAddress } from "../domain/ship-address";

/** Order or carton lines with each item's customs details and ship weight. */
export async function loadCustomsLines(
  db: AppDb,
  organizationId: string,
  lines: Array<{ itemId: string; qty: number }>,
): Promise<CustomsLine[]> {
  const ids = [...new Set(lines.map((line) => line.itemId))];
  if (!ids.length) return [];
  const items = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      shipWeightOz: schema.items.shipWeightOz,
      hsCode: schema.items.hsCode,
      originCountry: schema.items.originCountry,
      customsDescription: schema.items.customsDescription,
      customsValueCents: schema.items.customsValueCents,
    })
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, ids)));
  const byId = new Map(items.map((row) => [row.id, row]));
  return lines.flatMap((line) => {
    const item = byId.get(line.itemId);
    if (!item) return [];
    const { id, name, ...customs } = item;
    return [{ ...customs, itemId: id, itemName: name, qty: line.qty }];
  });
}

type Building = {
  name?: string | null;
  shipFromAddress?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
} | null;

/**
 * The customs declaration a label from `warehouse` to `shipToAddress` sends, or null when it stays in the
 * country. Throws `CustomsRequiredError` when an item on it has no customs details, unless this is for a quote.
 */
export async function customsForOrderLabel(
  db: AppDb,
  organizationId: string,
  input: {
    order: {
      number: string;
      shipToCity?: string | null;
      shipToRegion?: string | null;
      shipToCountry?: string | null;
    };
    lines: Array<{ itemId: string; qty: number }>;
    warehouse: Building;
    shipToAddress: string | null;
    parcelWeightOz: number;
  },
  options: { quote?: boolean } = {},
): Promise<CustomsDeclaration | null> {
  const { order, warehouse } = input;
  const { from, to } = labelCountries({ shipFrom: buildingAddress(warehouse), shipTo: orderAddress(order, input.shipToAddress) });
  if (!crossesBorder(from, to)) return null;
  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return (options.quote ? quoteCustoms : customsForLabel)({
    fromCountry: from,
    toCountry: to,
    lines: await loadCustomsLines(db, organizationId, input.lines),
    parcelWeightOz: input.parcelWeightOz,
    signer: org?.name || warehouse?.name || "Shipper",
    invoiceNumber: order.number,
  });
}
