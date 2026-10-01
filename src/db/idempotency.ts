import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict } from "../lib/http";
import { isDatabaseError, isUniqueViolation } from "../lib/db-errors";
import { mapDomainError } from "../lib/error-response";
import { newId } from "../lib/ids";
import { IDEMPOTENCY_IN_PROGRESS, IdempotencyKeyError, idempotencyKeyFrom } from "../domain/idempotency";

/** Status 0 means the post is running and has no outcome yet. */
const IN_PROGRESS = 0;

export function readIdempotencyKey(header: string | undefined, bodyField: unknown): string | null {
  try {
    return idempotencyKeyFrom(header, bodyField);
  } catch (err) {
    if (err instanceof IdempotencyKeyError) badRequest(err.message);
    throw err;
  }
}

/**
 * Run a receive or pick once per organization and key.
 * The same key returns the stored status and JSON and does not run again.
 * No key runs the post the way it always has.
 */
export async function runIdempotent(
  c: Context<AppEnv>,
  bodyField: unknown,
  run: () => Promise<Response>,
): Promise<Response> {
  const key = readIdempotencyKey(c.req.header("Idempotency-Key"), bodyField);
  if (!key) return run();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const userId = c.get("user")!.id;
  const replay = await storedResponse(db, organizationId, key);
  if (replay) return replay;
  const id = newId();
  try {
    await db.insert(schema.idempotencyKeys).values({
      id,
      organizationId,
      userId,
      key,
      responseStatus: IN_PROGRESS,
      responseJson: "",
      createdAt: Date.now(),
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await storedResponse(db, organizationId, key);
    if (raced) return raced;
    throw err;
  }
  try {
    const res = await run();
    const text = await res.clone().text();
    try {
      await db
        .update(schema.idempotencyKeys)
        .set({ responseStatus: res.status, responseJson: text })
        .where(eq(schema.idempotencyKeys.id, id));
    } catch (err) {
      console.error("idempotency save failed", err);
    }
    return res;
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped && mapped.status < 500 && !isDatabaseError(err)) {
      await db
        .update(schema.idempotencyKeys)
        .set({ responseStatus: mapped.status, responseJson: JSON.stringify(mapped.body) })
        .where(eq(schema.idempotencyKeys.id, id));
      return c.json(mapped.body, mapped.status);
    }
    await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, id));
    throw err;
  }
}

async function storedResponse(db: AppDb, organizationId: string, key: string): Promise<Response | null> {
  const [row] = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(and(eq(schema.idempotencyKeys.organizationId, organizationId), eq(schema.idempotencyKeys.key, key)))
    .limit(1);
  if (!row) return null;
  if (!row.responseStatus) conflict("That post is already running", IDEMPOTENCY_IN_PROGRESS);
  return new Response(row.responseJson, {
    status: row.responseStatus,
    headers: { "Content-Type": "application/json" },
  });
}
