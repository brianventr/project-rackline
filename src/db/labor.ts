import type { AppDb } from "./stock";
import * as schema from "./schema";
import { newId } from "../lib/ids";
import type { LaborVerbName } from "../domain/labor";

export async function recordLaborEvent(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    userId: string;
    verb: LaborVerbName;
    refType: string;
    refId: string;
    qty?: number | null;
    durationSec?: number | null;
    notes?: string | null;
    now?: number;
  },
): Promise<void> {
  await db.insert(schema.laborEvents).values({
    id: newId(),
    organizationId: input.organizationId,
    warehouseId: input.warehouseId,
    userId: input.userId,
    verb: input.verb,
    refType: input.refType,
    refId: input.refId,
    qty: input.qty ?? null,
    durationSec: input.durationSec ?? null,
    notes: input.notes ?? null,
    createdAt: input.now ?? Date.now(),
  });
}
