import { Hono } from "hono";
import type { Context } from "hono";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound } from "../lib/http";
import { requireOwner } from "../lib/org";
import { newId } from "../lib/ids";
import { internalApi, type InternalResult } from "../lib/internal-api";
import { loadAtpBaysByItem, loadOpenAllocations } from "../db/allocations";
import { loadCarrierConnections } from "./carriers";
import { ordersRoute } from "./orders";
import { enabledServicesFromConnections, resolveLabelPurchase, resolveService } from "../domain/carriers";
import { isLivePostage, liveShipAddress } from "../domain/carrier-live";
import { buildingDefaultService, orderParcel, parsePresetInput, pickPreset, type PackagePreset } from "../domain/ship-defaults";
import { parseShipRuleInput, reorderShipRules, type ShipRule, type ShipRuleInput } from "../domain/ship-rules";
import {
  holdMessage,
  planShipment,
  shipBoxReason,
  shipReasonSummary,
  shipServiceReason,
  type ShipPlan,
} from "../domain/ship-decision";
import { loadShipRules } from "../db/ship-rules";
import {
  planQuickShip,
  quickShipLabelBlocker,
  runQuickShip,
  shipSetupSteps,
  summarizeQuickShip,
  withOwnReservations,
  type QuickShipOutcome,
  type QuickShipSnapshot,
  type QuickShipStep,
  type QuickShipUndone,
} from "../domain/quick-ship";
import { assertQuickShip } from "../domain/workflow-policy";
import { loadWorkflowPolicy } from "../db/workflow";
import { membershipVerbs } from "../db/jobs";
import { JobVerbDeniedError, verbAllowed, type FloorVerb } from "../domain/jobs";
import { planQuickShipUndo, restoreQuickShip, snapshotQuickShip } from "../db/quick-ship";
import { loadSetupSignals } from "../db/setup-signals";

export const shipRoute = new Hono<AppEnv>();

type Db = AppEnv["Variables"]["db"];

type QuickShipBody = {
  presetId?: string;
  carrierService?: string;
  carrierConnectionId?: string;
  weightOz?: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
};

const MAX_BULK = 50;

async function loadPresets(db: Db, organizationId: string): Promise<PackagePreset[]> {
  return db
    .select({
      id: schema.packagePresets.id,
      name: schema.packagePresets.name,
      lengthIn: schema.packagePresets.lengthIn,
      widthIn: schema.packagePresets.widthIn,
      heightIn: schema.packagePresets.heightIn,
      tareOz: schema.packagePresets.tareOz,
      isDefault: schema.packagePresets.isDefault,
    })
    .from(schema.packagePresets)
    .where(eq(schema.packagePresets.organizationId, organizationId));
}

async function loadShipLines(db: Db, orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return db
    .select({
      id: schema.orderLines.id,
      orderId: schema.orderLines.orderId,
      itemId: schema.orderLines.itemId,
      qty: schema.orderLines.qty,
      qtyPicked: schema.orderLines.qtyPicked,
      qtyPacked: schema.orderLines.qtyPacked,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
      shipWeightOz: schema.items.shipWeightOz,
      shipLengthIn: schema.items.shipLengthIn,
      shipWidthIn: schema.items.shipWidthIn,
      shipHeightIn: schema.items.shipHeightIn,
    })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(inArray(schema.orderLines.orderId, orderIds));
}

type OrderRow = typeof schema.orders.$inferSelect;
type WarehouseRow = typeof schema.warehouses.$inferSelect;
type ShipLine = Awaited<ReturnType<typeof loadShipLines>>[number];

/** What every order in one queue load or one bulk ship is decided against. */
type ShipContext = {
  rules: ShipRule[];
  presets: PackagePreset[];
  connections: Awaited<ReturnType<typeof loadCarrierConnections>>;
  services: ReturnType<typeof enabledServicesFromConnections>;
};

async function loadShipContext(db: Db, organizationId: string): Promise<ShipContext> {
  const [rules, presets, connections] = await Promise.all([
    loadShipRules(db, organizationId),
    loadPresets(db, organizationId),
    loadCarrierConnections(db, organizationId),
  ]);
  return { rules, presets, connections, services: enabledServicesFromConnections(connections) };
}

type ShipDecision = {
  plan: ShipPlan;
  parcel: ReturnType<typeof orderParcel>;
  serviceId: string | null;
  connectionId: string | null;
  serviceName: string | null;
  live: boolean;
  boxReason: string | null;
  serviceReason: string | null;
  summary: string | null;
};

/** The box, service, and parcel quick-ship would use, and why. The queue, the scan station, and quick-ship all ask here. */
function decideShip(
  ctx: ShipContext,
  warehouse: WarehouseRow | null | undefined,
  order: OrderRow,
  lines: ShipLine[],
  picked: QuickShipBody = {},
): ShipDecision {
  const typed = picked.weightOz
    ? { packageWeightOz: picked.weightOz, packageLengthIn: picked.lengthIn, packageWidthIn: picked.widthIn, packageHeightIn: picked.heightIn }
    : order;
  const plan = planShipment({
    order: { ...order, lines, weightOz: typed.packageWeightOz },
    rules: ctx.rules,
    presets: ctx.presets,
    connections: ctx.connections,
    buildingDefault: buildingDefaultService(ctx.connections, warehouse),
    picked,
  });
  const parcel = orderParcel({ lines, preset: plan.box.preset, order: typed });
  const serviceId = plan.service.kind === "service" ? plan.service.serviceId : null;
  const connectionId = plan.service.kind === "service" ? plan.service.connectionId : null;
  const service = resolveService(serviceId);
  const connection = ctx.connections.find((row) => row.id === connectionId);
  const serviceName = service ? `${service.company} ${service.service}` : null;
  const boxReason = shipBoxReason(plan);
  const serviceReason = shipServiceReason(plan);
  return {
    plan,
    parcel,
    serviceId,
    connectionId,
    serviceName,
    live: connection ? isLivePostage(connection.provider, connection.mode) : false,
    boxReason,
    serviceReason,
    summary: shipReasonSummary({ boxName: plan.box.preset?.name ?? null, boxReason, serviceName, serviceReason }),
  };
}

shipRoute.get("/ship/queue", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");
  if (!warehouseId) badRequest("warehouseId is required");
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  if (!warehouse) notFound("Warehouse not found");

  const policy = await loadWorkflowPolicy(db, organizationId);
  const ctx = await loadShipContext(db, organizationId);
  const { presets, services } = ctx;
  const fallback = buildingDefaultService(ctx.connections, warehouse);
  const signals = await loadSetupSignals(db, organizationId);

  const orders = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.warehouseId, warehouseId),
        notInArray(schema.orders.status, ["cancelled"]),
      ),
    );
  const recentCutoff = Date.now() - 7 * 86_400_000;
  const visible = orders
    .filter((row) => row.status !== "shipped" || (row.shippedAt ?? 0) >= recentCutoff)
    .sort((a, b) => a.createdAt - b.createdAt);
  const lines = await loadShipLines(
    db,
    visible.map((row) => row.id),
  );
  const packageRows = visible.length
    ? await db
        .select({ orderId: schema.orderPackages.orderId })
        .from(schema.orderPackages)
        .where(
          inArray(
            schema.orderPackages.orderId,
            visible.map((row) => row.id),
          ),
        )
    : [];
  const packageCount = new Map<string, number>();
  for (const row of packageRows) packageCount.set(row.orderId, (packageCount.get(row.orderId) ?? 0) + 1);

  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const bays = await loadAtpBaysByItem(db, organizationId, itemIds, undefined, warehouseId);
  const reservations = await loadOpenAllocations(db, organizationId, { warehouseId });
  const defaultPreset = pickPreset(presets);

  const rows = visible.map((order) => {
    const orderLines = lines.filter((line) => line.orderId === order.id);
    const shipped = order.status === "shipped";
    const decision = shipped ? null : decideShip(ctx, warehouse, order, orderLines);
    const parcel = decision?.parcel ?? orderParcel({ lines: orderLines, preset: defaultPreset, order });
    const plan = shipped
      ? null
      : planQuickShip(
          { status: order.status, packageCount: packageCount.get(order.id) ?? 0, lines: orderLines },
          withOwnReservations(
            bays,
            reservations.filter((row) => row.orderId === order.id),
          ),
        );
    const blocker =
      plan && !plan.ok
        ? { code: plan.code, error: plan.error, sku: plan.sku ?? null }
        : decision?.plan.problem
          ? { code: "SHIP_RULE_SERVICE", error: decision.plan.problem, sku: null }
          : decision?.plan.hold
            ? { code: "SHIP_RULE_HOLD", error: holdMessage(decision.plan), sku: null }
            : null;
    const box = decision?.plan.box;
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      source: order.source,
      customerName: order.customerName,
      createdAt: order.createdAt,
      shippedAt: order.shippedAt,
      shipToAddress: order.shipToAddress,
      shipToCity: order.shipToCity,
      shipToRegion: order.shipToRegion,
      shipToCountry: order.shipToCountry,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      postageCents: order.postageCents,
      lines: orderLines.map((line) => ({
        id: line.id,
        sku: line.sku,
        itemName: line.itemName,
        imageUrl: line.imageUrl,
        qty: line.qty,
        shipWeightOz: line.shipWeightOz,
      })),
      parcel: parcel.parcel,
      missingWeight: parcel.missingWeight,
      box: box?.preset
        ? { presetId: box.preset.id, name: box.preset.name, source: box.source, reason: decision?.boxReason ?? null, note: box.note }
        : null,
      serviceId: decision?.serviceId ?? order.carrierService,
      serviceName: decision ? decision.serviceName : null,
      serviceReason: decision?.serviceReason ?? null,
      serviceLive: decision?.live ?? false,
      rule: decision?.plan.rule ?? null,
      shipReason: order.shipReason,
      ready: Boolean(plan?.ok) && !blocker,
      blocker,
    };
  });

  return c.json({
    policy,
    presets,
    services: services.map((row) => ({
      id: row.id,
      name: `${row.company} ${row.service}`,
      company: row.company,
      connectionId: row.connectionId,
      provider: row.provider,
    })),
    defaults: {
      presetId: defaultPreset?.id ?? null,
      carrierService: fallback?.serviceId ?? null,
      carrierConnectionId: fallback?.connectionId ?? null,
    },
    setup: shipSetupSteps({
      storeConnected: signals.stores > 0,
      carrierConnected: signals.carriers > 0,
      hasShipFrom: Boolean(warehouse.shipFromAddress?.trim()),
      hasBox: presets.length > 0,
    }),
    orders: rows,
  });
});

shipRoute.get("/ship/presets", async (c) => {
  return c.json(await loadPresets(c.get("db"), c.get("organizationId")!));
});

shipRoute.post("/ship/presets", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<Record<string, unknown>>();
  let input;
  try {
    input = parsePresetInput(body);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid box");
  }
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const existing = await loadPresets(db, organizationId);
  if (existing.some((row) => row.name.toLowerCase() === input.name.toLowerCase())) {
    conflict(`A box named ${input.name} already exists`);
  }
  const isDefault = body.isDefault === true || existing.length === 0;
  const id = newId();
  if (isDefault) {
    await db
      .update(schema.packagePresets)
      .set({ isDefault: false })
      .where(eq(schema.packagePresets.organizationId, organizationId));
  }
  await db.batch([
    db.insert(schema.packagePresets).values({ id, organizationId, ...input, isDefault, createdAt: Date.now() }),
  ]);
  return c.json(await loadPresets(db, organizationId), 201);
});

shipRoute.patch("/ship/presets/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<Record<string, unknown>>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = c.req.param("id");
  const existing = await loadPresets(db, organizationId);
  const current = existing.find((row) => row.id === id);
  if (!current) notFound("Box not found");
  let input;
  try {
    input = parsePresetInput({ ...current, ...body });
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid box");
  }
  if (existing.some((row) => row.id !== id && row.name.toLowerCase() === input.name.toLowerCase())) {
    conflict(`A box named ${input.name} already exists`);
  }
  const makeDefault = body.isDefault === true;
  if (makeDefault) {
    await db
      .update(schema.packagePresets)
      .set({ isDefault: false })
      .where(eq(schema.packagePresets.organizationId, organizationId));
  }
  await db.batch([
    db
      .update(schema.packagePresets)
      .set({ ...input, ...(makeDefault ? { isDefault: true } : {}) })
      .where(and(eq(schema.packagePresets.id, id), eq(schema.packagePresets.organizationId, organizationId))),
  ]);
  return c.json(await loadPresets(db, organizationId));
});

shipRoute.delete("/ship/presets/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = c.req.param("id");
  const usedBy = (await loadShipRules(db, organizationId)).find((rule) => rule.presetId === id);
  if (usedBy) conflict(`Rule “${usedBy.name}” packs in this box. Change the rule first.`);
  await db
    .delete(schema.packagePresets)
    .where(and(eq(schema.packagePresets.id, id), eq(schema.packagePresets.organizationId, organizationId)));
  return c.json(await loadPresets(db, organizationId));
});

async function rulesPayload(db: Db, organizationId: string) {
  const ctx = await loadShipContext(db, organizationId);
  const buildings = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId));
  const rules = await loadShipRules(db, organizationId);
  return {
    rules: rules.map((rule) => {
      const purchase = rule.carrierService
        ? resolveLabelPurchase({ connections: ctx.connections, serviceId: rule.carrierService, connectionId: rule.carrierConnectionId })
        : null;
      return {
        ...rule,
        problem: purchase && !purchase.ok ? "No connected carrier account offers this service" : null,
      };
    }),
    presets: ctx.presets,
    services: ctx.services.map((row) => ({
      id: row.id,
      name: `${row.company} ${row.service}`,
      company: row.company,
      connectionId: row.connectionId,
      provider: row.provider,
    })),
    warehouses: buildings,
  };
}

/**
 * Checks the rule's building, box, and service belong to this org, and pins the service to the account that offers it.
 * An edit only rechecks what it changed, so a rule whose service went away can still be turned off or renamed.
 */
async function resolveRuleRefs(db: Db, organizationId: string, input: ShipRuleInput, current?: ShipRule): Promise<ShipRuleInput> {
  if (input.warehouseId && input.warehouseId !== current?.warehouseId) {
    const [building] = await db
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, input.warehouseId), eq(schema.warehouses.organizationId, organizationId)))
      .limit(1);
    if (!building) badRequest("Building not found");
  }
  if (
    input.presetId &&
    input.presetId !== current?.presetId &&
    !(await loadPresets(db, organizationId)).some((row) => row.id === input.presetId)
  ) {
    badRequest("Box not found");
  }
  if (!input.carrierService) return input;
  if (current && input.carrierService === current.carrierService && input.carrierConnectionId === current.carrierConnectionId) {
    return input;
  }
  const purchase = resolveLabelPurchase({
    connections: await loadCarrierConnections(db, organizationId),
    serviceId: input.carrierService,
    connectionId: input.carrierConnectionId,
  });
  if (!purchase.ok) badRequest(purchase.error);
  return { ...input, carrierService: purchase.service.id, carrierConnectionId: purchase.connectionId };
}

function ruleColumns(input: ShipRuleInput) {
  return {
    name: input.name,
    enabled: input.enabled,
    warehouseId: input.warehouseId,
    conditionsJson: JSON.stringify(input.conditions),
    presetId: input.presetId,
    carrierService: input.carrierService,
    carrierConnectionId: input.carrierConnectionId,
    rateStrategy: input.rateStrategy,
    hold: input.hold,
  };
}

function parseRule(body: Record<string, unknown>): ShipRuleInput {
  try {
    return parseShipRuleInput(body);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid rule");
  }
}

shipRoute.get("/ship/rules", async (c) => {
  return c.json(await rulesPayload(c.get("db"), c.get("organizationId")!));
});

shipRoute.post("/ship/rules", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const input = await resolveRuleRefs(db, organizationId, parseRule(body));
  const existing = await loadShipRules(db, organizationId);
  const now = Date.now();
  await db.insert(schema.shipRules).values({
    id: newId(),
    organizationId,
    position: existing.reduce((max, rule) => Math.max(max, rule.position), 0) + 1,
    ...ruleColumns(input),
    createdAt: now,
    updatedAt: now,
  });
  return c.json(await rulesPayload(db, organizationId), 201);
});

shipRoute.post("/ship/rules/reorder", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  if (!Array.isArray(body.ids)) badRequest("ids must list the rules in their new order");
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  const rules = await loadShipRules(db, organizationId);
  const current = new Map(rules.map((rule) => [rule.id, rule.position]));
  const moves = reorderShipRules(rules, ids).filter((row) => current.get(row.id) !== row.position);
  const now = Date.now();
  if (moves.length) {
    const [first, ...rest] = moves.map((row) =>
      db
        .update(schema.shipRules)
        .set({ position: row.position, updatedAt: now })
        .where(and(eq(schema.shipRules.id, row.id), eq(schema.shipRules.organizationId, organizationId))),
    );
    await db.batch([first!, ...rest]);
  }
  return c.json(await rulesPayload(db, organizationId));
});

shipRoute.patch("/ship/rules/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = c.req.param("id");
  const current = (await loadShipRules(db, organizationId)).find((rule) => rule.id === id);
  if (!current) notFound("Rule not found");
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const merged: Record<string, unknown> = { ...current, ...body };
  if ("carrierService" in body && !("carrierConnectionId" in body)) merged.carrierConnectionId = null;
  const input = await resolveRuleRefs(db, organizationId, parseRule(merged), current);
  await db
    .update(schema.shipRules)
    .set({ ...ruleColumns(input), updatedAt: Date.now() })
    .where(and(eq(schema.shipRules.id, id), eq(schema.shipRules.organizationId, organizationId)));
  return c.json(await rulesPayload(db, organizationId));
});

shipRoute.delete("/ship/rules/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await db
    .delete(schema.shipRules)
    .where(and(eq(schema.shipRules.id, c.req.param("id")), eq(schema.shipRules.organizationId, organizationId)));
  return c.json(await rulesPayload(db, organizationId));
});

type ShipOrderRow = {
  id: string;
  number: string;
  status: string;
  warehouseId: string;
  trackingNumber: string | null;
  labelStatus: string;
  carrierService: string | null;
  carrierConnectionId: string | null;
  packageWeightOz: number | null;
  packageLengthIn: number | null;
  packageWidthIn: number | null;
  packageHeightIn: number | null;
};

async function quickShipOne(
  c: Context<AppEnv>,
  call: ReturnType<typeof internalApi>,
  orderId: string,
  body: QuickShipBody,
  options: { ctx?: ShipContext; releaseHold?: boolean } = {},
): Promise<QuickShipOutcome> {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!order) return { orderId, ok: false, status: 404, error: "Order not found" };
  const fail = (status: number, error: string, code?: string): QuickShipOutcome => ({
    orderId,
    ok: false,
    number: order.number,
    status,
    error,
    code,
  });

  const lines = await loadShipLines(db, [order.id]);
  const packages = await db
    .select({ id: schema.orderPackages.id })
    .from(schema.orderPackages)
    .where(eq(schema.orderPackages.orderId, order.id));
  const bays = await loadAtpBaysByItem(
    db,
    organizationId,
    [...new Set(lines.map((line) => line.itemId))],
    order.id,
    order.warehouseId,
  );
  const plan = planQuickShip({ status: order.status, packageCount: packages.length, lines }, bays);
  if (!plan.ok) return fail(409, plan.error, plan.code);

  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, order.warehouseId))
    .limit(1);
  const ctx = options.ctx ?? (await loadShipContext(db, organizationId));
  const { connections } = ctx;
  const decision = decideShip(ctx, warehouse, order, lines, body);
  const current = order as ShipOrderRow;
  const hasLabel = Boolean(current.trackingNumber) && current.labelStatus === "purchased";
  if (decision.plan.hold && !options.releaseHold) return fail(409, holdMessage(decision.plan), "SHIP_RULE_HOLD");
  if (decision.plan.problem && !hasLabel) return fail(409, decision.plan.problem, "SHIP_RULE_SERVICE");
  const { parcel, serviceId: carrierService, connectionId: carrierConnectionId } = decision;
  const connection = connections.find((row) => row.id === carrierConnectionId) ?? null;
  const live = Boolean(connection && isLivePostage(connection.provider, connection.mode));
  if (live && parcel.missingWeight.length) {
    return fail(409, `Add a ship weight for ${parcel.missingWeight.join(", ")} before buying live postage`, "NEED_WEIGHT");
  }

  if (!hasLabel) {
    const purchase = resolveLabelPurchase({ connections, serviceId: carrierService, connectionId: carrierConnectionId });
    const blocked = quickShipLabelBlocker({
      purchaseError: purchase.ok ? null : purchase.error,
      live,
      hasApiKey: Boolean(connection?.apiKey),
      shipFrom: live
        ? liveShipAddress({
            name: warehouse?.name || "Warehouse",
            text: warehouse?.shipFromAddress,
            city: warehouse?.city,
            region: warehouse?.region,
            country: warehouse?.country,
          })
        : null,
      shipTo: live
        ? liveShipAddress({
            name: order.customerName,
            text: order.shipToAddress,
            city: order.shipToCity,
            region: order.shipToRegion,
            country: order.shipToCountry,
          })
        : null,
    });
    if (blocked) return fail(blocked.status, blocked.error, blocked.code);
  }
  const verbs = await membershipVerbs(db, organizationId, c.get("user")!.id, c.get("role")!);
  const needed: FloorVerb[] = [...(plan.picks.length > 0 ? ["pick" as const] : []), ...(plan.packNeeded ? ["pack" as const] : []), "ship"];
  const denied = needed.find((verb) => !verbAllowed(verbs, verb));
  if (denied) return fail(403, new JobVerbDeniedError(denied).message, "JOB_VERB_DENIED");

  const asFailure = (res: InternalResult<unknown>, suffix = "") =>
    res.ok ? null : { status: res.status, error: `${res.error}${suffix}`, code: res.code };
  const steps: QuickShipStep[] = plan.picks.map((pick) => ({
    id: "pick",
    run: async () =>
      asFailure(
        await call("POST", `/orders/${order.id}/pick`, { locationId: pick.locationId, lines: pick.lines }),
        ` (bay ${pick.locationCode})`,
      ),
  }));
  if (plan.packNeeded) {
    steps.push({ id: "pack", run: async () => asFailure(await call("POST", `/orders/${order.id}/pack`, {})) });
  }
  if (!hasLabel) {
    steps.push({
      id: "label",
      run: async () =>
        asFailure(
          await call("POST", `/orders/${order.id}/label`, {
            carrierService,
            carrierConnectionId: carrierConnectionId ?? undefined,
            ...parcel.parcel,
          }),
        ),
    });
  }
  steps.push({
    id: "ship",
    run: async () => {
      const [labeled] = await db
        .select({
          trackingNumber: schema.orders.trackingNumber,
          carrierService: schema.orders.carrierService,
          carrierConnectionId: schema.orders.carrierConnectionId,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, order.id))
        .limit(1);
      return asFailure(
        await call("POST", `/orders/${order.id}/ship`, {
          trackingNumber: labeled?.trackingNumber ?? undefined,
          carrierService: labeled?.carrierService ?? undefined,
          carrierConnectionId: labeled?.carrierConnectionId ?? undefined,
        }),
      );
    },
  });

  const snapshot = await snapshotQuickShip(db, organizationId, order.id);
  const run = await runQuickShip(steps, () => undoQuickShip(c, call, order.id, snapshot));
  if (!run.ok) return fail(run.failure.status, run.failure.error, run.failure.code);
  if (!hasLabel && decision.summary) {
    await db.update(schema.orders).set({ shipReason: decision.summary }).where(eq(schema.orders.id, order.id));
  }
  const [shipped] = await db
    .select({ trackingNumber: schema.orders.trackingNumber, channelSyncStatus: schema.orders.channelSyncStatus })
    .from(schema.orders)
    .where(eq(schema.orders.id, order.id))
    .limit(1);
  return {
    orderId,
    ok: true,
    number: order.number,
    trackingNumber: shipped?.trackingNumber ?? null,
    manualPostBack: shipped?.channelSyncStatus === "manual",
  };
}

/** Voids a label this run bought, then puts stock, pack counts, status, and reservations back. */
async function undoQuickShip(
  c: Context<AppEnv>,
  call: ReturnType<typeof internalApi>,
  orderId: string,
  snapshot: QuickShipSnapshot,
): Promise<QuickShipUndone> {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const plan = await planQuickShipUndo(db, organizationId, orderId, snapshot);
  if (plan.shipped) return { shipped: true };
  let voidError: string | null = null;
  if (plan.voidLabel) {
    const voided = await call("POST", `/orders/${orderId}/label/void`, {});
    if (!voided.ok) voidError = voided.error;
  }
  const labelVoided = plan.voidLabel && !voidError;
  let restoreError: string | null = null;
  try {
    await restoreQuickShip(db, { organizationId, userId: c.get("user")!.id, orderId, snapshot, plan, labelVoided });
  } catch (err) {
    console.error(err);
    restoreError = err instanceof Error ? err.message : "Restore failed";
  }
  return { shipped: false, voidedLabel: labelVoided, voidError, restoreError };
}

shipRoute.post("/orders/:id/quick-ship", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  assertQuickShip(await loadWorkflowPolicy(db, organizationId));
  const body = await c.req.json<QuickShipBody & { releaseHold?: boolean }>().catch(() => ({}) as QuickShipBody & { releaseHold?: boolean });
  const call = internalApi(c, [ordersRoute]);
  const outcome = await quickShipOne(c, call, c.req.param("id"), body, { releaseHold: body.releaseHold === true });
  if (!outcome.ok) return c.json({ error: outcome.error, code: outcome.code, orderId: outcome.orderId }, outcome.status as 400 | 404 | 409);
  return c.json(outcome);
});

shipRoute.post("/ship/quick-ship", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  assertQuickShip(await loadWorkflowPolicy(db, organizationId));
  const body = await c.req.json<QuickShipBody & { ids?: unknown }>().catch(() => ({}) as QuickShipBody & { ids?: unknown });
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length > 0))] : [];
  if (ids.length === 0) badRequest("Pick at least one order to ship");
  if (ids.length > MAX_BULK) badRequest(`Ship at most ${MAX_BULK} orders at a time`);
  const call = internalApi(c, [ordersRoute]);
  const ctx = await loadShipContext(db, organizationId);
  const outcomes: QuickShipOutcome[] = [];
  for (const id of ids) {
    try {
      outcomes.push(await quickShipOne(c, call, id, body, { ctx }));
    } catch (err) {
      outcomes.push({ orderId: id, ok: false, status: 500, error: err instanceof Error ? err.message : "Ship failed" });
    }
  }
  return c.json({ ...summarizeQuickShip(outcomes), outcomes });
});
