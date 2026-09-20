import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId, docNumber } from "../lib/ids";
import { addUtcDays, EXPIRING_WITHIN_DAYS, utcYyyymmdd } from "../domain/expiry";
import {
  applyAssign,
  applyClaim,
  applyRelease,
  desiredVerb,
  eligibleForNext,
  isFloorVerb,
  isJobRefType,
  assertVerbAllowed,
  JobClaimedError,
  jobFloorPath,
  jobOfficePath,
  materializeSuggestionTarget,
  parseFloorVerbs,
  planJobSync,
  suggestionRefId,
  terminalJobOutcome,
  type FloorVerb,
  type JobRefType,
  type JobStatus,
} from "../domain/jobs";
import { rankJobs, type RankContext, type RankInput } from "../domain/job-rank";
import { suggestReplenishments } from "../domain/replenishment";
import { shouldSuggestPutaway, suggestPutawayJobs } from "../domain/directed-putaway";
import { loadPutawayBaysByItem } from "./putaway-bays";
import { atpOnHand, loadOpenAllocations } from "./allocations";
import { loadOpenHolds } from "./holds";
import { matchingHoldForMove } from "../domain/holds";
import { forbidden, notFound } from "../lib/http";

export type DocumentJobInput = {
  organizationId: string;
  warehouseId: string;
  refType: JobRefType;
  refId: string;
  status: string;
  number?: string | null;
  title?: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  itemId?: string | null;
  qty?: number | null;
  dueAt?: number | null;
  createdAt?: number;
  now?: number;
};

export type FloorJobRow = typeof schema.floorJobs.$inferSelect;

export type FloorJobView = Omit<FloorJobRow, "pinned"> & {
  assigneeName: string | null;
  fromCode: string | null;
  fromBarcode: string | null;
  toCode: string | null;
  aisle: string | null;
  fromX: number | null;
  fromY: number | null;
  floorPath: string;
  officePath: string;
  pinned: boolean;
  score?: number;
  reason?: string;
};

async function membershipVerbs(db: AppDb, organizationId: string, userId: string, role: string): Promise<FloorVerb[]> {
  const [row] = await db
    .select({ floorVerbs: schema.memberships.floorVerbs, role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, userId)))
    .limit(1);
  return parseFloorVerbs(row?.floorVerbs, role || row?.role || "operator");
}

async function loadJobsForRef(db: AppDb, organizationId: string, refType: JobRefType, refId: string) {
  return db
    .select()
    .from(schema.floorJobs)
    .where(
      and(
        eq(schema.floorJobs.organizationId, organizationId),
        eq(schema.floorJobs.refType, refType),
        eq(schema.floorJobs.refId, refId),
      ),
    );
}

export async function syncDocumentJob(db: AppDb, input: DocumentJobInput): Promise<void> {
  const now = input.now ?? Date.now();
  const existing = await loadJobsForRef(db, input.organizationId, input.refType, input.refId);
  const desired = desiredVerb(input.refType, input.status);
  const terminal = terminalJobOutcome(input.refType, input.status);
  const ops = planJobSync(
    existing.map((row) => ({
      id: row.id,
      verb: isFloorVerb(row.verb) ? row.verb : "pick",
      status: row.status as JobStatus,
    })),
    desired,
    terminal,
  );

  for (const op of ops) {
    if (op.op === "complete") {
      await db
        .update(schema.floorJobs)
        .set({ status: "done", doneAt: now })
        .where(eq(schema.floorJobs.id, op.id));
    } else if (op.op === "cancel") {
      await db
        .update(schema.floorJobs)
        .set({ status: "cancelled", doneAt: now })
        .where(eq(schema.floorJobs.id, op.id));
    } else {
      await db.insert(schema.floorJobs).values({
        id: newId(),
        organizationId: input.organizationId,
        warehouseId: input.warehouseId,
        verb: op.verb,
        refType: input.refType,
        refId: input.refId,
        status: "open",
        number: input.number ?? null,
        title: input.title ?? null,
        fromLocationId: input.fromLocationId ?? null,
        toLocationId: input.toLocationId ?? null,
        itemId: input.itemId ?? null,
        qty: input.qty ?? null,
        dueAt: input.dueAt ?? null,
        createdAt: input.createdAt ?? now,
      });
    }
  }

  if (desired && !ops.some((op) => op.op === "create")) {
    const current = existing.find((row) => row.verb === desired && (row.status === "open" || row.status === "claimed"));
    if (current) {
      await db
        .update(schema.floorJobs)
        .set({
          number: input.number ?? current.number,
          title: input.title ?? current.title,
          fromLocationId: input.fromLocationId ?? current.fromLocationId,
          toLocationId: input.toLocationId ?? current.toLocationId,
          itemId: input.itemId ?? current.itemId,
          qty: input.qty ?? current.qty,
          dueAt: input.dueAt ?? current.dueAt,
        })
        .where(eq(schema.floorJobs.id, current.id));
    }
  }
}

async function userName(db: AppDb, userId: string | null): Promise<string> {
  if (!userId) return "someone";
  const [row] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  return row?.name || "someone";
}

export async function guardFloorJob(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    userId: string;
    role: string;
    refType: JobRefType;
    refId: string;
    verb: FloorVerb;
    number?: string | null;
    title?: string | null;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    itemId?: string | null;
    qty?: number | null;
    dueAt?: number | null;
    createdAt?: number;
    now?: number;
  },
): Promise<FloorJobRow> {
  const now = input.now ?? Date.now();
  const verbs = await membershipVerbs(db, input.organizationId, input.userId, input.role);
  assertVerbAllowed(verbs, input.verb);

  let [job] = await db
    .select()
    .from(schema.floorJobs)
    .where(
      and(
        eq(schema.floorJobs.organizationId, input.organizationId),
        eq(schema.floorJobs.refType, input.refType),
        eq(schema.floorJobs.refId, input.refId),
        eq(schema.floorJobs.verb, input.verb),
        inArray(schema.floorJobs.status, ["open", "claimed"]),
      ),
    )
    .limit(1);

  if (!job) {
    await syncDocumentJob(db, {
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      refType: input.refType,
      refId: input.refId,
      status:
        input.verb === "pack"
          ? "picked"
          : input.verb === "ship"
            ? "packed"
            : input.verb === "pick"
              ? "open"
              : "draft",
      number: input.number,
      title: input.title,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      itemId: input.itemId,
      qty: input.qty,
      dueAt: input.dueAt,
      createdAt: input.createdAt,
      now,
    });
    [job] = await db
      .select()
      .from(schema.floorJobs)
      .where(
        and(
          eq(schema.floorJobs.organizationId, input.organizationId),
          eq(schema.floorJobs.refType, input.refType),
          eq(schema.floorJobs.refId, input.refId),
          eq(schema.floorJobs.verb, input.verb),
          inArray(schema.floorJobs.status, ["open", "claimed"]),
        ),
      )
      .limit(1);
  }
  if (!job) {
    [job] = await db.insert(schema.floorJobs).values({
      id: newId(),
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      verb: input.verb,
      refType: input.refType,
      refId: input.refId,
      status: "open",
      number: input.number ?? null,
      title: input.title ?? null,
      fromLocationId: input.fromLocationId ?? null,
      toLocationId: input.toLocationId ?? null,
      itemId: input.itemId ?? null,
      qty: input.qty ?? null,
      dueAt: input.dueAt ?? null,
      createdAt: input.createdAt ?? now,
    }).returning();
  }

  const reservedId = job.assigneeId && job.assigneeId !== input.userId ? job.assigneeId : null;
  if (reservedId && input.role !== "owner") {
    throw new JobClaimedError(reservedId, await userName(db, reservedId));
  }

  const next = applyClaim(
    { status: job.status as JobStatus, assigneeId: job.assigneeId, notBefore: job.notBefore },
    input.userId,
    now,
    reservedId ? await userName(db, reservedId) : "someone",
    input.role === "owner",
  );
  const [updated] = await db
    .update(schema.floorJobs)
    .set({ status: next.status, assigneeId: next.assigneeId, claimedAt: next.claimedAt })
    .where(eq(schema.floorJobs.id, job.id))
    .returning();
  return updated ?? { ...job, status: next.status, assigneeId: next.assigneeId, claimedAt: next.claimedAt };
}

function asView(
  row: FloorJobRow,
  extra: {
    assigneeName?: string | null;
    fromCode?: string | null;
    fromBarcode?: string | null;
    toCode?: string | null;
    aisle?: string | null;
    fromX?: number | null;
    fromY?: number | null;
  } = {},
): FloorJobView {
  const verb = isFloorVerb(row.verb) ? row.verb : "pick";
  const refType = isJobRefType(row.refType) ? row.refType : "order";
  return {
    ...row,
    assigneeName: extra.assigneeName ?? null,
    fromCode: extra.fromCode ?? null,
    fromBarcode: extra.fromBarcode ?? null,
    toCode: extra.toCode ?? null,
    aisle: extra.aisle ?? null,
    fromX: extra.fromX ?? null,
    fromY: extra.fromY ?? null,
    pinned: row.pinned === 1,
    floorPath: jobFloorPath({ verb, refType, refId: row.refId, fromBarcode: extra.fromBarcode }),
    officePath: jobOfficePath({ verb, refType, refId: row.refId }),
  };
}

async function decorateJobs(db: AppDb, rows: FloorJobRow[]): Promise<FloorJobView[]> {
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.map((row) => row.assigneeId).filter((id): id is string => Boolean(id)))];
  const locationIds = [
    ...new Set(
      rows.flatMap((row) => [row.fromLocationId, row.toLocationId]).filter((id): id is string => Boolean(id)),
    ),
  ];
  const users =
    userIds.length === 0
      ? []
      : await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds));
  const locations =
    locationIds.length === 0
      ? []
      : await db
          .select({
            id: schema.locations.id,
            code: schema.locations.code,
            barcode: schema.locations.barcode,
            aisle: schema.locations.aisle,
            posX: schema.locations.posX,
            posY: schema.locations.posY,
          })
          .from(schema.locations)
          .where(inArray(schema.locations.id, locationIds));
  const userById = new Map(users.map((row) => [row.id, row.name]));
  const locById = new Map(locations.map((row) => [row.id, row]));
  return rows.map((row) => {
    const from = row.fromLocationId ? locById.get(row.fromLocationId) : undefined;
    const to = row.toLocationId ? locById.get(row.toLocationId) : undefined;
    return asView(row, {
      assigneeName: row.assigneeId ? userById.get(row.assigneeId) ?? null : null,
      fromCode: from?.code ?? null,
      fromBarcode: from?.barcode ?? null,
      toCode: to?.code ?? null,
      aisle: from?.aisle ?? to?.aisle ?? null,
      fromX: from?.posX ?? to?.posX ?? null,
      fromY: from?.posY ?? to?.posY ?? null,
    });
  });
}

export async function listFloorJobs(
  db: AppDb,
  organizationId: string,
  filters: { warehouseId?: string; verb?: FloorVerb; assigneeId?: string; mine?: string; open?: boolean },
): Promise<FloorJobView[]> {
  await backfillOpenJobs(db, organizationId, filters.warehouseId);
  const rows = await db
    .select()
    .from(schema.floorJobs)
    .where(
      and(
        eq(schema.floorJobs.organizationId, organizationId),
        filters.warehouseId ? eq(schema.floorJobs.warehouseId, filters.warehouseId) : undefined,
        filters.verb ? eq(schema.floorJobs.verb, filters.verb) : undefined,
        filters.assigneeId ? eq(schema.floorJobs.assigneeId, filters.assigneeId) : undefined,
        filters.mine ? eq(schema.floorJobs.assigneeId, filters.mine) : undefined,
        filters.open ? inArray(schema.floorJobs.status, ["open", "claimed"]) : undefined,
      ),
    )
    .orderBy(desc(schema.floorJobs.createdAt));
  const views = await decorateJobs(db, rows);
  if (!filters.open) return views;
  const now = Date.now();
  const facts = await loadRankFacts(db, organizationId, filters.warehouseId, views, now);
  const ranked = rankJobs(facts, { now });
  const byId = new Map(ranked.map((row) => [row.id, row]));
  return views.map((row) => {
    const rankedRow = byId.get(row.id);
    return rankedRow ? { ...row, score: rankedRow.score, reason: rankedRow.reason } : row;
  });
}

async function loadRankFacts(db: AppDb, organizationId: string, warehouseId: string | undefined, rows: FloorJobView[], now: number) {
  const itemIds = [...new Set(rows.map((row) => row.itemId).filter((id): id is string => Boolean(id)))];
  const allocatedItems = new Set<string>();
  if (itemIds.length > 0) {
    const allocations = await loadOpenAllocations(db, organizationId, { warehouseId });
    for (const row of allocations) {
      if (itemIds.includes(row.itemId)) allocatedItems.add(row.itemId);
    }
  }
  const locationIds = [...new Set(rows.map((row) => row.fromLocationId).filter((id): id is string => Boolean(id)))];
  const lots =
    locationIds.length === 0
      ? []
      : await db
          .select({
            locationId: schema.lotBalances.locationId,
            itemId: schema.lotBalances.itemId,
            expiresOn: schema.lotBalances.expiresOn,
            qty: schema.lotBalances.qty,
          })
          .from(schema.lotBalances)
          .where(
            and(
              eq(schema.lotBalances.organizationId, organizationId),
              inArray(schema.lotBalances.locationId, locationIds),
              gt(schema.lotBalances.qty, 0),
              lte(schema.lotBalances.expiresOn, addUtcDays(utcYyyymmdd(), EXPIRING_WITHIN_DAYS)),
            ),
          );
  const today = utcYyyymmdd();
  const expiryByKey = new Map<string, number>();
  for (const lot of lots) {
    if (lot.expiresOn == null) continue;
    const year = Math.floor(lot.expiresOn / 10000);
    const month = Math.floor((lot.expiresOn % 10000) / 100) - 1;
    const day = lot.expiresOn % 100;
    const expires = Date.UTC(year, month, day);
    const todayDate = Date.UTC(Math.floor(today / 10000), Math.floor((today % 10000) / 100) - 1, today % 100);
    const days = Math.round((expires - todayDate) / 86_400_000);
    const key = `${lot.locationId}:${lot.itemId ?? ""}`;
    const prev = expiryByKey.get(key);
    if (prev == null || days < prev) expiryByKey.set(key, days);
  }

  return rows.map((row) => {
    const dock = row.verb === "receive" || row.verb === "putaway";
    const expiry = row.fromLocationId ? expiryByKey.get(`${row.fromLocationId}:${row.itemId ?? ""}`) : undefined;
    const input: RankInput = {
      id: row.id,
      verb: isFloorVerb(row.verb) ? row.verb : "pick",
      pinned: row.pinned,
      createdAt: row.createdAt,
      dueAt: row.dueAt,
      fromX: row.fromX,
      fromY: row.fromY,
      aisle: row.aisle,
      starved: row.verb === "replenish" && Boolean(row.itemId && allocatedItems.has(row.itemId)),
      expiringDays: expiry ?? null,
      shopify: Boolean(row.title?.includes("Shopify") || row.number?.startsWith("#")),
      dockDwellMs: dock ? Math.max(0, now - row.createdAt) : 0,
    };
    return input;
  });
}

export async function nextFloorJobs(
  db: AppDb,
  input: {
    organizationId: string;
    userId: string;
    role: string;
    warehouseId?: string;
    fromLocationId?: string;
    now?: number;
  },
): Promise<FloorJobView[]> {
  const now = input.now ?? Date.now();
  await backfillOpenJobs(db, input.organizationId, input.warehouseId);
  const allowed = await membershipVerbs(db, input.organizationId, input.userId, input.role);
  const rows = await listFloorJobs(db, input.organizationId, {
    warehouseId: input.warehouseId,
    open: true,
  });
  const eligible = rows.filter((row) =>
    eligibleForNext(
      {
        status: row.status as JobStatus,
        assigneeId: row.assigneeId,
        notBefore: row.notBefore,
        verb: isFloorVerb(row.verb) ? row.verb : "pick",
      },
      input.userId,
      now,
      allowed,
    ),
  );
  let fromX: number | null = null;
  let fromY: number | null = null;
  let lastVerb: FloorVerb | null = null;
  let lastAisle: string | null = null;
  if (input.fromLocationId) {
    const [loc] = await db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, input.fromLocationId))
      .limit(1);
    fromX = loc?.posX ?? null;
    fromY = loc?.posY ?? null;
    lastAisle = loc?.aisle ?? null;
  } else {
    const [mine] = await db
      .select()
      .from(schema.floorJobs)
      .where(
        and(
          eq(schema.floorJobs.organizationId, input.organizationId),
          eq(schema.floorJobs.assigneeId, input.userId),
          inArray(schema.floorJobs.status, ["claimed", "done"]),
        ),
      )
      .orderBy(desc(schema.floorJobs.claimedAt), desc(schema.floorJobs.doneAt))
      .limit(1);
    if (mine?.fromLocationId) {
      const [loc] = await db
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, mine.fromLocationId))
        .limit(1);
      fromX = loc?.posX ?? null;
      fromY = loc?.posY ?? null;
      lastAisle = loc?.aisle ?? null;
      lastVerb = isFloorVerb(mine.verb) ? mine.verb : null;
    }
  }
  const facts = await loadRankFacts(db, input.organizationId, input.warehouseId, eligible, now);
  const ctx: RankContext = { now, fromX, fromY, lastVerb, lastAisle };
  const ranked = rankJobs(facts, ctx);
  const byId = new Map(eligible.map((row) => [row.id, row]));
  const out: FloorJobView[] = [];
  for (const row of ranked) {
    const job = byId.get(row.id);
    if (!job) continue;
    out.push({ ...job, score: row.score, reason: row.reason });
  }
  return out;
}

export async function getFloorJob(db: AppDb, organizationId: string, id: string): Promise<FloorJobView> {
  const [row] = await db
    .select()
    .from(schema.floorJobs)
    .where(and(eq(schema.floorJobs.id, id), eq(schema.floorJobs.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Job not found");
  const [view] = await decorateJobs(db, [row]);
  return view!;
}

async function materializeSuggestion(
  db: AppDb,
  job: {
    id: string;
    organizationId: string;
    warehouseId: string;
    refType: string;
    fromLocationId: string | null;
    toLocationId: string | null;
    itemId: string | null;
    qty: number | null;
  },
): Promise<FloorJobView> {
  const target = materializeSuggestionTarget(isJobRefType(job.refType) ? job.refType : "order");
  if (!target || !job.fromLocationId || !job.toLocationId || !job.itemId || !job.qty) {
    return getFloorJob(db, job.organizationId, job.id);
  }
  const now = Date.now();
  if (target.refType === "replenishment") {
    const id = newId();
    const number = docNumber("RPL");
    await db.insert(schema.replenishments).values({
      id,
      organizationId: job.organizationId,
      warehouseId: job.warehouseId,
      number,
      status: "draft",
      itemId: job.itemId,
      qty: job.qty,
      qtyMoved: 0,
      fromLocationId: job.fromLocationId,
      toLocationId: job.toLocationId,
      createdAt: now,
    });
    await db.update(schema.floorJobs).set({ refType: target.refType, refId: id, number }).where(eq(schema.floorJobs.id, job.id));
    return getFloorJob(db, job.organizationId, job.id);
  }
  const id = newId();
  const number = docNumber("XFR");
  await db.batch([
    db.insert(schema.transfers).values({
      id,
      organizationId: job.organizationId,
      warehouseId: job.warehouseId,
      number,
      status: "draft",
      fromLocationId: job.fromLocationId,
      toLocationId: job.toLocationId,
      notes: null,
      createdAt: now,
    }),
    db.insert(schema.transferLines).values({
      id: newId(),
      transferId: id,
      itemId: job.itemId,
      qty: job.qty,
      qtyMoved: 0,
    }),
  ]);
  await db.update(schema.floorJobs).set({ refType: target.refType, refId: id, number }).where(eq(schema.floorJobs.id, job.id));
  return getFloorJob(db, job.organizationId, job.id);
}

export async function claimFloorJob(
  db: AppDb,
  input: { organizationId: string; userId: string; role: string; jobId: string; now?: number },
): Promise<FloorJobView> {
  const job = await getFloorJob(db, input.organizationId, input.jobId);
  const verbs = await membershipVerbs(db, input.organizationId, input.userId, input.role);
  assertVerbAllowed(verbs, isFloorVerb(job.verb) ? job.verb : "pick");
  const now = input.now ?? Date.now();
  const reservedId = job.assigneeId && job.assigneeId !== input.userId ? job.assigneeId : null;
  if (reservedId && input.role !== "owner") {
    throw new JobClaimedError(reservedId, job.assigneeName || "someone");
  }
  const next = applyClaim(
    { status: job.status as JobStatus, assigneeId: job.assigneeId, notBefore: job.notBefore },
    input.userId,
    now,
    job.assigneeName || "someone",
    input.role === "owner",
  );
  await db
    .update(schema.floorJobs)
    .set({ status: next.status, assigneeId: next.assigneeId, claimedAt: next.claimedAt })
    .where(eq(schema.floorJobs.id, job.id));
  const claimed = await getFloorJob(db, input.organizationId, job.id);
  return materializeSuggestion(db, claimed);
}

export async function releaseFloorJob(
  db: AppDb,
  input: { organizationId: string; userId: string; role: string; jobId: string; now?: number },
): Promise<FloorJobView> {
  const job = await getFloorJob(db, input.organizationId, input.jobId);
  const now = input.now ?? Date.now();
  const next = applyRelease(
    { status: job.status as JobStatus, assigneeId: job.assigneeId, notBefore: job.notBefore },
    input.userId,
    input.role,
    now,
  );
  await db
    .update(schema.floorJobs)
    .set({ status: next.status, assigneeId: next.assigneeId, releasedAt: next.releasedAt, claimedAt: null })
    .where(eq(schema.floorJobs.id, job.id));
  return getFloorJob(db, input.organizationId, job.id);
}

export async function assignFloorJob(
  db: AppDb,
  input: { organizationId: string; actorId: string; role: string; jobId: string; userId: string | null },
): Promise<FloorJobView> {
  const job = await getFloorJob(db, input.organizationId, input.jobId);
  if (input.userId) {
    const [member] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, input.organizationId), eq(schema.memberships.userId, input.userId)))
      .limit(1);
    if (!member) notFound("Teammate not found");
  }
  const next = applyAssign(
    { status: job.status as JobStatus, assigneeId: job.assigneeId, notBefore: job.notBefore },
    input.userId,
    input.role,
    input.actorId,
  );
  await db
    .update(schema.floorJobs)
    .set({
      status: next.status,
      assigneeId: next.assigneeId,
      claimedAt: next.status === "claimed" ? job.claimedAt ?? Date.now() : null,
      releasedAt: next.assigneeId ? job.releasedAt : Date.now(),
    })
    .where(eq(schema.floorJobs.id, job.id));
  return getFloorJob(db, input.organizationId, job.id);
}

export async function pinFloorJob(
  db: AppDb,
  input: { organizationId: string; role: string; jobId: string; pinned: boolean },
): Promise<FloorJobView> {
  if (input.role !== "owner") forbidden("Owner role required");
  const job = await getFloorJob(db, input.organizationId, input.jobId);
  await db.update(schema.floorJobs).set({ pinned: input.pinned ? 1 : 0 }).where(eq(schema.floorJobs.id, job.id));
  return getFloorJob(db, input.organizationId, job.id);
}

export async function patchFloorJob(
  db: AppDb,
  input: { organizationId: string; role: string; jobId: string; notBefore?: number | null; dueAt?: number | null },
): Promise<FloorJobView> {
  if (input.role !== "owner") forbidden("Owner role required");
  const job = await getFloorJob(db, input.organizationId, input.jobId);
  await db
    .update(schema.floorJobs)
    .set({
      notBefore: input.notBefore === undefined ? job.notBefore : input.notBefore,
      dueAt: input.dueAt === undefined ? job.dueAt : input.dueAt,
    })
    .where(eq(schema.floorJobs.id, job.id));
  return getFloorJob(db, input.organizationId, job.id);
}

export async function backfillOpenJobs(db: AppDb, organizationId: string, warehouseId?: string): Promise<void> {
  const docs = await loadOpenDocuments(db, organizationId, warehouseId);
  for (const doc of docs) {
    await syncDocumentJob(db, doc);
  }
  await upsertSuggestionJobs(db, organizationId, warehouseId);
}

async function loadOpenDocuments(db: AppDb, organizationId: string, warehouseId?: string): Promise<DocumentJobInput[]> {
  const docs: DocumentJobInput[] = [];
  const wh = warehouseId;

  const orders = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        wh ? eq(schema.orders.warehouseId, wh) : undefined,
      ),
    );
  for (const row of orders) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "order",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.source === "shopify" ? `${row.customerName} · Shopify` : row.customerName,
      fromLocationId: row.pickLocationId,
      dueAt: row.source === "shopify" ? row.createdAt : null,
      createdAt: row.createdAt,
    });
  }

  const receipts = await db
    .select()
    .from(schema.receipts)
    .where(and(eq(schema.receipts.organizationId, organizationId), wh ? eq(schema.receipts.warehouseId, wh) : undefined));
  for (const row of receipts) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "receipt",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.notes || "Receive onto the dock",
      fromLocationId: row.locationId,
      createdAt: row.createdAt,
    });
  }

  const purchases = await db
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.organizationId, organizationId), wh ? eq(schema.purchases.warehouseId, wh) : undefined));
  for (const row of purchases) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "purchase",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.vendorName,
      fromLocationId: row.locationId,
      createdAt: row.createdAt,
    });
  }

  const transfers = await db
    .select()
    .from(schema.transfers)
    .where(and(eq(schema.transfers.organizationId, organizationId), wh ? eq(schema.transfers.warehouseId, wh) : undefined));
  for (const row of transfers) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "transfer",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.notes,
      fromLocationId: row.fromLocationId,
      toLocationId: row.toLocationId,
      createdAt: row.createdAt,
    });
  }

  const replenishments = await db
    .select()
    .from(schema.replenishments)
    .where(
      and(eq(schema.replenishments.organizationId, organizationId), wh ? eq(schema.replenishments.warehouseId, wh) : undefined),
    );
  for (const row of replenishments) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "replenishment",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.notes,
      fromLocationId: row.fromLocationId,
      toLocationId: row.toLocationId,
      itemId: row.itemId,
      qty: row.qty - (row.qtyMoved ?? 0),
      createdAt: row.createdAt,
    });
  }

  const rmas = await db
    .select()
    .from(schema.rmas)
    .where(and(eq(schema.rmas.organizationId, organizationId), wh ? eq(schema.rmas.warehouseId, wh) : undefined));
  for (const row of rmas) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "rma",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.customerName,
      fromLocationId: row.locationId,
      createdAt: row.createdAt,
    });
  }

  const rtvs = await db
    .select()
    .from(schema.vendorReturns)
    .where(
      and(eq(schema.vendorReturns.organizationId, organizationId), wh ? eq(schema.vendorReturns.warehouseId, wh) : undefined),
    );
  for (const row of rtvs) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "vendorReturn",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.vendorName,
      fromLocationId: row.locationId,
      createdAt: row.createdAt,
    });
  }

  const counts = await db
    .select()
    .from(schema.cycleCounts)
    .where(and(eq(schema.cycleCounts.organizationId, organizationId), wh ? eq(schema.cycleCounts.warehouseId, wh) : undefined));
  for (const row of counts) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "cycleCount",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.notes || "Bay count",
      fromLocationId: row.locationId,
      createdAt: row.createdAt,
    });
  }

  const wos = await db
    .select({
      id: schema.workOrders.id,
      warehouseId: schema.workOrders.warehouseId,
      status: schema.workOrders.status,
      number: schema.workOrders.number,
      sku: schema.items.sku,
      sourceLocationId: schema.workOrders.sourceLocationId,
      outputLocationId: schema.workOrders.outputLocationId,
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      qtyCompleted: schema.workOrders.qtyCompleted,
      createdAt: schema.workOrders.createdAt,
    })
    .from(schema.workOrders)
    .innerJoin(schema.items, eq(schema.items.id, schema.workOrders.itemId))
    .where(and(eq(schema.workOrders.organizationId, organizationId), wh ? eq(schema.workOrders.warehouseId, wh) : undefined));
  for (const row of wos) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "workOrder",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: `${row.sku} × ${row.qty}`,
      fromLocationId: row.sourceLocationId,
      toLocationId: row.outputLocationId,
      itemId: row.itemId,
      qty: row.qty - (row.qtyCompleted ?? 0),
      createdAt: row.createdAt,
    });
  }

  const kits = await db
    .select({
      id: schema.kitBuilds.id,
      warehouseId: schema.kitBuilds.warehouseId,
      status: schema.kitBuilds.status,
      number: schema.kitBuilds.number,
      sku: schema.items.sku,
      sourceLocationId: schema.kitBuilds.sourceLocationId,
      outputLocationId: schema.kitBuilds.outputLocationId,
      itemId: schema.kitBuilds.itemId,
      qty: schema.kitBuilds.qty,
      qtyCompleted: schema.kitBuilds.qtyCompleted,
      createdAt: schema.kitBuilds.createdAt,
    })
    .from(schema.kitBuilds)
    .innerJoin(schema.items, eq(schema.items.id, schema.kitBuilds.itemId))
    .where(and(eq(schema.kitBuilds.organizationId, organizationId), wh ? eq(schema.kitBuilds.warehouseId, wh) : undefined));
  for (const row of kits) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "kit",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: `${row.sku} × ${row.qty}`,
      fromLocationId: row.sourceLocationId,
      toLocationId: row.outputLocationId,
      itemId: row.itemId,
      qty: row.qty - (row.qtyCompleted ?? 0),
      createdAt: row.createdAt,
    });
  }

  const holds = await db
    .select()
    .from(schema.inventoryHolds)
    .where(
      and(eq(schema.inventoryHolds.organizationId, organizationId), wh ? eq(schema.inventoryHolds.warehouseId, wh) : undefined),
    );
  for (const row of holds) {
    docs.push({
      organizationId,
      warehouseId: row.warehouseId,
      refType: "hold",
      refId: row.id,
      status: row.status,
      number: row.number,
      title: row.reason,
      fromLocationId: row.locationId,
      itemId: row.itemId,
      createdAt: row.createdAt,
    });
  }

  return docs;
}

async function upsertSuggestionJobs(db: AppDb, organizationId: string, warehouseId?: string): Promise<void> {
  const now = Date.now();
  const slotLocations = await db
    .select({
      id: schema.locations.id,
      code: schema.locations.code,
      warehouseId: schema.locations.warehouseId,
      slotRole: schema.locations.slotRole,
      aisle: schema.locations.aisle,
      rack: schema.locations.rack,
      type: schema.locations.type,
      barcode: schema.locations.barcode,
      name: schema.locations.name,
    })
    .from(schema.locations)
    .where(
      and(eq(schema.locations.organizationId, organizationId), warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined),
    );
  const onHand = await db
    .select({
      locationId: schema.inventoryBalances.locationId,
      itemId: schema.inventoryBalances.itemId,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );
  const items = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      pickMin: schema.items.pickMin,
    })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  const openHolds = await loadOpenHolds(db, organizationId, warehouseId);
  const replenish = suggestReplenishments({
    locations: slotLocations,
    onHand: await atpOnHand(db, organizationId, onHand, { warehouseId }),
    items,
  }).filter(
    (job) =>
      !matchingHoldForMove(openHolds, job.fromLocationId, job.itemId) &&
      !matchingHoldForMove(openHolds, job.toLocationId, job.itemId),
  );

  const openReplenish = await db
    .select()
    .from(schema.replenishments)
    .where(
      and(
        eq(schema.replenishments.organizationId, organizationId),
        inArray(schema.replenishments.status, ["draft", "in_progress"]),
        warehouseId ? eq(schema.replenishments.warehouseId, warehouseId) : undefined,
      ),
    );
  const coveredReplenish = new Set(openReplenish.map((row) => `${row.itemId}:${row.toLocationId}`));

  const liveSuggestionIds = new Set<string>();
  for (const row of replenish) {
    if (coveredReplenish.has(`${row.itemId}:${row.toLocationId}`)) continue;
    const refId = suggestionRefId(row.fromLocationId, row.itemId, row.toLocationId);
    liveSuggestionIds.add(refId);
    await syncDocumentJob(db, {
      organizationId,
      warehouseId: row.warehouseId,
      refType: "replenishSuggestion",
      refId,
      status: "draft",
      number: row.sku,
      title: `${row.fromCode} → ${row.toCode}`,
      fromLocationId: row.fromLocationId,
      toLocationId: row.toLocationId,
      itemId: row.itemId,
      qty: row.qty,
      createdAt: now,
      now,
    });
  }

  const stagingRows = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      barcode: schema.locations.barcode,
      type: schema.locations.type,
      warehouseId: schema.locations.warehouseId,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
        gt(schema.inventoryBalances.qty, 0),
        inArray(schema.locations.type, ["receiving", "shipping", "production"]),
      ),
    );
  const availableStaging = (await atpOnHand(db, organizationId, stagingRows, { warehouseId })).filter((row) => row.qty > 0);
  const stagingByWarehouse = new Map<string, typeof availableStaging>();
  for (const row of availableStaging) {
    const list = stagingByWarehouse.get(row.warehouseId) ?? [];
    list.push(row);
    stagingByWarehouse.set(row.warehouseId, list);
  }
  for (const [whId, rows] of stagingByWarehouse) {
    const itemIds = [...new Set(rows.map((row) => row.itemId))];
    const baysByItem = await loadPutawayBaysByItem(db, organizationId, whId, itemIds);
    const byLocation = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byLocation.get(row.locationId) ?? [];
      list.push(row);
      byLocation.set(row.locationId, list);
    }
    for (const [locationId, contents] of byLocation) {
      const first = contents[0]!;
      if (!shouldSuggestPutaway(first.type)) continue;
      const jobs = suggestPutawayJobs(
        { id: locationId, code: first.locationCode, barcode: first.barcode, type: first.type },
        contents,
        baysByItem,
      );
      for (const job of jobs) {
        if (!job.suggested) continue;
        const refId = suggestionRefId(job.fromLocationId, job.itemId, job.suggested.locationId);
        liveSuggestionIds.add(refId);
        await syncDocumentJob(db, {
          organizationId,
          warehouseId: whId,
          refType: "putawaySuggestion",
          refId,
          status: "draft",
          number: job.sku,
          title: `${job.fromCode} → ${job.suggested.locationCode}`,
          fromLocationId: job.fromLocationId,
          toLocationId: job.suggested.locationId,
          itemId: job.itemId,
          qty: job.qty,
          createdAt: now,
          now,
        });
      }
    }
  }

  const stale = await db
    .select()
    .from(schema.floorJobs)
    .where(
      and(
        eq(schema.floorJobs.organizationId, organizationId),
        inArray(schema.floorJobs.refType, ["putawaySuggestion", "replenishSuggestion"]),
        inArray(schema.floorJobs.status, ["open", "claimed"]),
        warehouseId ? eq(schema.floorJobs.warehouseId, warehouseId) : undefined,
      ),
    );
  for (const row of stale) {
    if (liveSuggestionIds.has(row.refId)) continue;
    await db.update(schema.floorJobs).set({ status: "cancelled", doneAt: now }).where(eq(schema.floorJobs.id, row.id));
  }
}

export function orderJobInput(order: {
  id: string;
  organizationId: string;
  warehouseId: string;
  status: string;
  number: string;
  customerName: string;
  source?: string;
  pickLocationId?: string | null;
  createdAt: number;
}): DocumentJobInput {
  return {
    organizationId: order.organizationId,
    warehouseId: order.warehouseId,
    refType: "order",
    refId: order.id,
    status: order.status,
    number: order.number,
    title: order.source === "shopify" ? `${order.customerName} · Shopify` : order.customerName,
    fromLocationId: order.pickLocationId,
    dueAt: order.source === "shopify" ? order.createdAt : null,
    createdAt: order.createdAt,
  };
}

export async function guardMatchingSuggestionJobs(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    userId: string;
    role: string;
    fromLocationId: string;
    toLocationId: string;
    itemIds: string[];
  },
): Promise<void> {
  for (const itemId of input.itemIds) {
    const refId = suggestionRefId(input.fromLocationId, itemId, input.toLocationId);
    for (const [refType, verb] of [
      ["putawaySuggestion", "putaway"],
      ["replenishSuggestion", "replenish"],
    ] as const) {
      const [job] = await db
        .select()
        .from(schema.floorJobs)
        .where(
          and(
            eq(schema.floorJobs.organizationId, input.organizationId),
            eq(schema.floorJobs.refType, refType),
            eq(schema.floorJobs.refId, refId),
            inArray(schema.floorJobs.status, ["open", "claimed"]),
          ),
        )
        .limit(1);
      if (!job) continue;
      await guardFloorJob(db, {
        organizationId: input.organizationId,
        warehouseId: input.warehouseId,
        userId: input.userId,
        role: input.role,
        refType,
        refId,
        verb,
        number: job.number,
        title: job.title,
        fromLocationId: job.fromLocationId,
        toLocationId: job.toLocationId,
        itemId: job.itemId,
        qty: job.qty,
        createdAt: job.createdAt,
      });
    }
  }
}

export async function completeMatchingSuggestionJobs(
  db: AppDb,
  input: { organizationId: string; warehouseId: string; fromLocationId: string; toLocationId: string; itemIds: string[] },
): Promise<void> {
  for (const itemId of input.itemIds) {
    const refId = suggestionRefId(input.fromLocationId, itemId, input.toLocationId);
    for (const refType of ["putawaySuggestion", "replenishSuggestion"] as const) {
      await syncDocumentJob(db, {
        organizationId: input.organizationId,
        warehouseId: input.warehouseId,
        refType,
        refId,
        status: "posted",
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        itemId,
      });
    }
  }
}

export async function seedAssignedJobs(db: AppDb, organizationId: string, userId: string, pickOrderId: string, workOrderId: string): Promise<void> {
  await backfillOpenJobs(db, organizationId);
  const pick = await db
    .select()
    .from(schema.floorJobs)
    .where(
      and(
        eq(schema.floorJobs.organizationId, organizationId),
        eq(schema.floorJobs.refType, "order"),
        eq(schema.floorJobs.refId, pickOrderId),
        eq(schema.floorJobs.verb, "pick"),
        inArray(schema.floorJobs.status, ["open", "claimed"]),
      ),
    )
    .limit(1);
  const assemble = await db
    .select()
    .from(schema.floorJobs)
    .where(
      and(
        eq(schema.floorJobs.organizationId, organizationId),
        eq(schema.floorJobs.refType, "workOrder"),
        eq(schema.floorJobs.refId, workOrderId),
        eq(schema.floorJobs.verb, "assemble"),
        inArray(schema.floorJobs.status, ["open", "claimed"]),
      ),
    )
    .limit(1);
  if (pick[0]) {
    await db.update(schema.floorJobs).set({ assigneeId: userId, status: "open" }).where(eq(schema.floorJobs.id, pick[0].id));
  }
  if (assemble[0]) {
    await db.update(schema.floorJobs).set({ assigneeId: userId, status: "open" }).where(eq(schema.floorJobs.id, assemble[0].id));
  }
}
