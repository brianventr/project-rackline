import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { isUniqueViolation } from "../lib/db-errors";
import { WorkflowPolicyError, serialAlreadyRecorded, type RecordedScan } from "../domain/workflow-policy";

const TASKS = new Set(["pick", "pack", "batch-pick"]);
const KINDS = new Set(["location", "plate", "item", "serial", "lot"]);
const ITEM_KINDS = ["item", "serial", "lot"] as const;

export function isScanTask(value: string): boolean {
  return TASKS.has(value);
}

export function isScanKind(value: string): boolean {
  return KINDS.has(value);
}

export async function openScanSession(
  db: AppDb,
  input: { organizationId: string; userId: string; warehouseId: string | null; task: string; refId: string },
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.floorScanSessions.id })
    .from(schema.floorScanSessions)
    .where(
      and(
        eq(schema.floorScanSessions.organizationId, input.organizationId),
        eq(schema.floorScanSessions.userId, input.userId),
        eq(schema.floorScanSessions.task, input.task),
        eq(schema.floorScanSessions.refId, input.refId),
      ),
    )
    .orderBy(desc(schema.floorScanSessions.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const id = newId();
  await db.insert(schema.floorScanSessions).values({
    id,
    organizationId: input.organizationId,
    warehouseId: input.warehouseId,
    userId: input.userId,
    task: input.task,
    refId: input.refId,
    createdAt: Date.now(),
  });
  return id;
}

export async function loadRecordedScans(
  db: AppDb,
  organizationId: string,
  userId: string,
  sessionId: string | null | undefined,
): Promise<RecordedScan[]> {
  if (!sessionId?.trim()) {
    throw new WorkflowPolicyError(
      "Start a scan session before posting. Manufacturer mode records each scan on the server.",
      "SCAN_REQUIRED",
    );
  }
  const [session] = await db
    .select({ id: schema.floorScanSessions.id })
    .from(schema.floorScanSessions)
    .where(
      and(
        eq(schema.floorScanSessions.id, sessionId),
        eq(schema.floorScanSessions.organizationId, organizationId),
        eq(schema.floorScanSessions.userId, userId),
      ),
    )
    .limit(1);
  if (!session) {
    throw new WorkflowPolicyError("Scan session not found. Scan the bay and SKU again.", "SCAN_REQUIRED");
  }
  const rows = await db
    .select()
    .from(schema.floorScans)
    .where(eq(schema.floorScans.sessionId, session.id))
    .orderBy(schema.floorScans.createdAt);
  return rows.map((row) => ({
    kind: row.kind,
    code: row.code,
    sku: row.sku,
    serial: row.serial,
    locationId: row.locationId,
    locationCode: row.locationCode,
    clientScanId: row.clientScanId,
    consumedAt: row.consumedAt,
  }));
}

export async function recordFloorScan(
  db: AppDb,
  input: {
    organizationId: string;
    userId: string;
    sessionId: string;
    clientScanId: string;
    kind: string;
    code: string;
    sku?: string | null;
    serial?: string | null;
    locationId?: string | null;
    locationCode?: string | null;
  },
): Promise<{ id: string; duplicate: boolean }> {
  const [session] = await db
    .select({ id: schema.floorScanSessions.id })
    .from(schema.floorScanSessions)
    .where(
      and(
        eq(schema.floorScanSessions.id, input.sessionId),
        eq(schema.floorScanSessions.organizationId, input.organizationId),
        eq(schema.floorScanSessions.userId, input.userId),
      ),
    )
    .limit(1);
  if (!session) {
    throw new WorkflowPolicyError("Scan session not found. Scan the bay and SKU again.", "SCAN_REQUIRED");
  }
  const existing = await db
    .select()
    .from(schema.floorScans)
    .where(eq(schema.floorScans.sessionId, session.id))
    .orderBy(schema.floorScans.createdAt);
  const prior = existing.find((row) => row.clientScanId === input.clientScanId);
  if (prior) return { id: prior.id, duplicate: true };
  const serial = input.serial?.trim() || (input.kind === "serial" ? input.code.trim() : "");
  if (serial && serialAlreadyRecorded(existing, serial, input.clientScanId)) {
    throw new WorkflowPolicyError(`Serial ${serial} was already scanned.`, "SCAN_REQUIRED");
  }
  const id = newId();
  try {
    await db.insert(schema.floorScans).values({
      id,
      sessionId: session.id,
      organizationId: input.organizationId,
      clientScanId: input.clientScanId,
      kind: input.kind,
      code: input.code,
      sku: input.sku?.trim() || null,
      serial: serial || null,
      locationId: input.locationId ?? null,
      locationCode: input.locationCode ?? null,
      consumedAt: null,
      createdAt: Date.now(),
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [raced] = await db
      .select({ id: schema.floorScans.id })
      .from(schema.floorScans)
      .where(and(eq(schema.floorScans.sessionId, session.id), eq(schema.floorScans.clientScanId, input.clientScanId)))
      .limit(1);
    if (raced) return { id: raced.id, duplicate: true };
    throw err;
  }
  return { id, duplicate: false };
}

/** Item scans a post just accepted are spent. The bay scan stays for the next post. */
export async function consumeItemScans(db: AppDb, sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  await db
    .update(schema.floorScans)
    .set({ consumedAt: Date.now() })
    .where(
      and(eq(schema.floorScans.sessionId, sessionId), isNull(schema.floorScans.consumedAt), inArray(schema.floorScans.kind, [...ITEM_KINDS])),
    );
}
