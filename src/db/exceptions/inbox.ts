import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  buildInbox,
  compareExceptions,
  countExceptions,
  dedupeExceptions,
  exceptionId,
  inBuilding,
  SOURCE_LIMIT,
  sourcesForMode,
  visibleTo,
  type ClaimPatch,
  type ExceptionClaim,
  type ExceptionInbox,
  type ExceptionItem,
  type ExceptionSourceRef,
} from "../../domain/exceptions/inbox";
import { newId } from "../../lib/ids";
import * as schema from "../schema";
import type { AppDb } from "../stock";
import { EXCEPTION_SOURCES } from "./registry";
import type { ExceptionSource, ExceptionSourceContext } from "./source";

export type InboxViewer = { userId: string; role: string };

/** A claim row as stored, with what the next write needs to check nobody changed it meanwhile. */
export type StoredClaim = ExceptionClaim & { id: string; updatedAt: number };

function sourceRef(source: ExceptionSource): ExceptionSourceRef {
  return { id: source.id, label: source.label };
}

/**
 * The building's problems from every source the mode lists, the most pressing `SOURCE_LIMIT` per
 * source. A source that throws is reported in `failed` and the rest still load.
 */
export async function loadExceptionItems(
  ctx: ExceptionSourceContext,
  role: string,
): Promise<Pick<ExceptionInbox, "sources" | "capped" | "failed"> & { items: ExceptionItem[] }> {
  const sources = sourcesForMode(EXCEPTION_SOURCES, ctx.mode);
  const loaded = await Promise.all(
    sources.map(async (source) => {
      try {
        return { source, items: await source.load(ctx) };
      } catch (err) {
        console.error(`exception source ${source.id} failed`, err);
        return { source, items: null };
      }
    }),
  );
  const items: ExceptionItem[] = [];
  const capped: ExceptionSourceRef[] = [];
  const failed: ExceptionSourceRef[] = [];
  for (const { source, items: found } of loaded) {
    if (!found) {
      failed.push(sourceRef(source));
      continue;
    }
    const kept = dedupeExceptions(visibleTo(inBuilding(found, ctx.warehouseId), role)).sort(compareExceptions);
    if (kept.length > SOURCE_LIMIT) capped.push(sourceRef(source));
    items.push(...kept.slice(0, SOURCE_LIMIT));
  }
  return { items, sources: sources.map(sourceRef), capped, failed };
}

/** The problem as its source reports it now, or null once it has cleared. */
export async function findException(ctx: ExceptionSourceContext, source: ExceptionSource, key: string): Promise<ExceptionItem | null> {
  return inBuilding(await source.load(ctx), ctx.warehouseId).find((item) => item.key === key) ?? null;
}

export async function loadClaims(
  db: AppDb,
  organizationId: string,
  items: readonly Pick<ExceptionItem, "source" | "key">[],
): Promise<StoredClaim[]> {
  if (items.length === 0) return [];
  const claims = schema.exceptionClaims;
  const claimer = alias(schema.user, "claimer");
  const resolver = alias(schema.user, "resolver");
  const wanted = new Set(items.map((item) => exceptionId(item.source, item.key)));
  // One JSON array parameter instead of one per key: D1 binds at most 100 parameters a query.
  const keys = sql`(select value from json_each(${JSON.stringify([...new Set(items.map((item) => item.key))])}))`;
  const rows = await db
    .select({
      id: claims.id,
      source: claims.source,
      key: claims.key,
      claimedBy: claims.claimedBy,
      claimedByName: claimer.name,
      claimedAt: claims.claimedAt,
      snoozedUntil: claims.snoozedUntil,
      resolvedAt: claims.resolvedAt,
      resolvedBy: claims.resolvedBy,
      resolvedByName: resolver.name,
      resolutionNote: claims.resolutionNote,
      updatedAt: claims.updatedAt,
    })
    .from(claims)
    .leftJoin(claimer, eq(claimer.id, claims.claimedBy))
    .leftJoin(resolver, eq(resolver.id, claims.resolvedBy))
    .where(and(eq(claims.organizationId, organizationId), inArray(claims.key, keys)));
  return rows.filter((row) => wanted.has(exceptionId(row.source, row.key)));
}

export async function loadInbox(ctx: ExceptionSourceContext, viewer: InboxViewer): Promise<ExceptionInbox> {
  const { items, sources, capped, failed } = await loadExceptionItems(ctx, viewer.role);
  const claims = await loadClaims(ctx.db, ctx.organizationId, items);
  const views = buildInbox(items, claims, ctx.now);
  return { items: views, counts: countExceptions(views, viewer.userId), sources, capped, failed };
}

/**
 * Writes the claim only if the row is still as `stored` read it, so two people acting at once cannot
 * both win. `updated_at` always moves forward, even within one millisecond, which makes it a version.
 */
export async function saveClaim(
  db: AppDb,
  input: { organizationId: string; item: ExceptionItem; stored: StoredClaim | null; patch: ClaimPatch; now: number },
): Promise<boolean> {
  const claims = schema.exceptionClaims;
  const { organizationId, item, stored, patch } = input;
  const updatedAt = stored ? Math.max(input.now, stored.updatedAt + 1) : input.now;
  const rows = await db
    .insert(claims)
    .values({
      id: newId(),
      organizationId,
      warehouseId: item.warehouseId,
      source: item.source,
      key: item.key,
      ...patch,
      createdAt: input.now,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [claims.organizationId, claims.source, claims.key],
      set: { ...patch, warehouseId: item.warehouseId, updatedAt },
      setWhere: stored ? eq(claims.updatedAt, stored.updatedAt) : sql`0`,
    })
    .returning({ id: claims.id });
  return rows.length > 0;
}

/** Forgets a problem's claim once it has cleared, so if it ever comes back it starts unclaimed. */
export async function forgetClaim(db: AppDb, organizationId: string, item: Pick<ExceptionItem, "source" | "key">): Promise<void> {
  const claims = schema.exceptionClaims;
  await db
    .delete(claims)
    .where(and(eq(claims.organizationId, organizationId), eq(claims.source, item.source), eq(claims.key, item.key)));
}
