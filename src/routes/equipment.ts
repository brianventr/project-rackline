import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireString, optionalString } from "../lib/http";
import { getOrgWarehouse, requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { parseExpiresOn } from "../domain/expiry";
import {
  ASSIGNMENT_TASK_TYPES,
  assertCanCheckout,
  assertOperatorCertified,
  canCheckInAssignment,
  canReturnEquipmentToService,
  checklistForClass,
  equipmentBarcode,
  EquipmentCustodyError,
  failInspection,
  gradeInspection,
  isAssignmentTaskType,
  isEquipmentClass,
  isInspectionResult,
  matchingAssignments,
  assignmentAt,
  type InspectionAnswer,
} from "../domain/equipment";
import {
  loadAssignmentHistory,
  loadOpenAssignmentForEquipment,
  loadOpenAssignmentForOperator,
  loadOperatorCerts,
  recordEquipmentEvent,
} from "../db/equipment";

export const equipmentRoute = new Hono<AppEnv>();

async function getOrgMember(db: AppEnv["Variables"]["db"], organizationId: string, userId: string) {
  const [row] = await db
    .select({
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, userId)))
    .limit(1);
  if (!row) notFound("Teammate not found");
  return row;
}

async function getOrgEquipment(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.equipment)
    .where(and(eq(schema.equipment.id, id), eq(schema.equipment.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Equipment not found");
  return row;
}

async function assignmentWithOperator(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select({
      id: schema.equipmentAssignments.id,
      organizationId: schema.equipmentAssignments.organizationId,
      warehouseId: schema.equipmentAssignments.warehouseId,
      number: schema.equipmentAssignments.number,
      equipmentId: schema.equipmentAssignments.equipmentId,
      operatorUserId: schema.equipmentAssignments.operatorUserId,
      operatorName: schema.user.name,
      status: schema.equipmentAssignments.status,
      shift: schema.equipmentAssignments.shift,
      refType: schema.equipmentAssignments.refType,
      refId: schema.equipmentAssignments.refId,
      startedAt: schema.equipmentAssignments.startedAt,
      endedAt: schema.equipmentAssignments.endedAt,
      startedBy: schema.equipmentAssignments.startedBy,
      endedBy: schema.equipmentAssignments.endedBy,
    })
    .from(schema.equipmentAssignments)
    .innerJoin(schema.user, eq(schema.user.id, schema.equipmentAssignments.operatorUserId))
    .where(and(eq(schema.equipmentAssignments.id, id), eq(schema.equipmentAssignments.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Assignment not found");
  return row;
}

async function resolveTask(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  refType: string,
  refId: string,
): Promise<{ refType: string; refId: string; number: string }> {
  if (!isAssignmentTaskType(refType)) {
    badRequest(`Task must be ${ASSIGNMENT_TASK_TYPES.join(", ")}`);
  }
  const lookup = {
    order: schema.orders,
    transfer: schema.transfers,
    replenishment: schema.replenishments,
    workOrder: schema.workOrders,
    kit: schema.kitBuilds,
    receipt: schema.receipts,
    wave: schema.waves,
    asn: schema.asns,
  } as const;
  const table = lookup[refType];
  const [row] = await db
    .select({ id: table.id, number: table.number })
    .from(table)
    .where(and(eq(table.id, refId), eq(table.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Task document not found");
  return { refType, refId: row.id, number: row.number };
}

function parseInspectionBody(raw: unknown): InspectionAnswer[] {
  if (!Array.isArray(raw) || raw.length === 0) badRequest("inspection is required");
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") badRequest(`inspection[${index}] is invalid`);
    const row = entry as { code?: unknown; result?: unknown; notes?: unknown };
    const code = requireString(row.code, `inspection[${index}].code`);
    const result = requireString(row.result, `inspection[${index}].result`);
    if (!isInspectionResult(result)) badRequest("Inspection result must be pass, fail, or n/a");
    const notes = typeof row.notes === "string" ? row.notes.trim() : "";
    return { code, result, notes: notes || undefined };
  });
}

async function equipmentDetail(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const row = await getOrgEquipment(db, organizationId, id);
  const open = await loadOpenAssignmentForEquipment(db, organizationId, id);
  const current = open ? await assignmentWithOperator(db, organizationId, open.id) : null;
  const [assignments, events, inspections] = await Promise.all([
    loadAssignmentHistory(db, organizationId, id),
    db
      .select()
      .from(schema.equipmentEvents)
      .where(and(eq(schema.equipmentEvents.organizationId, organizationId), eq(schema.equipmentEvents.equipmentId, id)))
      .orderBy(desc(schema.equipmentEvents.createdAt))
      .limit(50),
    db
      .select()
      .from(schema.equipmentInspections)
      .where(
        and(eq(schema.equipmentInspections.organizationId, organizationId), eq(schema.equipmentInspections.equipmentId, id)),
      )
      .orderBy(desc(schema.equipmentInspections.createdAt))
      .limit(20),
  ]);
  return {
    ...row,
    currentAssignment: current,
    checklist: checklistForClass(row.class),
    assignments,
    events,
    inspections: inspections.map((inspection) => ({
      ...inspection,
      items: JSON.parse(inspection.itemsJson) as InspectionAnswer[],
    })),
  };
}

equipmentRoute.get("/equipment", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");
  const rows = await db
    .select()
    .from(schema.equipment)
    .where(
      and(
        eq(schema.equipment.organizationId, organizationId),
        warehouseId ? eq(schema.equipment.warehouseId, warehouseId) : undefined,
      ),
    )
    .orderBy(schema.equipment.code);
  if (rows.length === 0) return c.json([]);
  const open = await db
    .select({
      id: schema.equipmentAssignments.id,
      number: schema.equipmentAssignments.number,
      equipmentId: schema.equipmentAssignments.equipmentId,
      operatorUserId: schema.equipmentAssignments.operatorUserId,
      operatorName: schema.user.name,
      status: schema.equipmentAssignments.status,
      shift: schema.equipmentAssignments.shift,
      refType: schema.equipmentAssignments.refType,
      refId: schema.equipmentAssignments.refId,
      startedAt: schema.equipmentAssignments.startedAt,
    })
    .from(schema.equipmentAssignments)
    .innerJoin(schema.user, eq(schema.user.id, schema.equipmentAssignments.operatorUserId))
    .where(and(eq(schema.equipmentAssignments.organizationId, organizationId), eq(schema.equipmentAssignments.status, "open")));
  const byEquipment = new Map(open.map((row) => [row.equipmentId, row]));
  return c.json(
    rows.map((row) => ({
      ...row,
      currentAssignment: byEquipment.get(row.id) ?? null,
    })),
  );
});

equipmentRoute.get("/equipment/audit", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const equipmentId = optionalString(c.req.query("equipmentId"));
  const operatorId = optionalString(c.req.query("operatorId"));
  const shift = optionalString(c.req.query("shift"));
  const refType = optionalString(c.req.query("refType"));
  const refId = optionalString(c.req.query("refId"));
  const atRaw = optionalString(c.req.query("at"));
  const at = atRaw ? Number(atRaw) : undefined;
  if (atRaw && !Number.isFinite(at)) badRequest("at must be a timestamp");

  const rows = await db
    .select({
      id: schema.equipmentAssignments.id,
      number: schema.equipmentAssignments.number,
      equipmentId: schema.equipmentAssignments.equipmentId,
      equipmentCode: schema.equipment.code,
      equipmentName: schema.equipment.name,
      operatorUserId: schema.equipmentAssignments.operatorUserId,
      operatorName: schema.user.name,
      status: schema.equipmentAssignments.status,
      shift: schema.equipmentAssignments.shift,
      refType: schema.equipmentAssignments.refType,
      refId: schema.equipmentAssignments.refId,
      startedAt: schema.equipmentAssignments.startedAt,
      endedAt: schema.equipmentAssignments.endedAt,
      startedBy: schema.equipmentAssignments.startedBy,
      endedBy: schema.equipmentAssignments.endedBy,
    })
    .from(schema.equipmentAssignments)
    .innerJoin(schema.user, eq(schema.user.id, schema.equipmentAssignments.operatorUserId))
    .innerJoin(schema.equipment, eq(schema.equipment.id, schema.equipmentAssignments.equipmentId))
    .where(
      and(
        eq(schema.equipmentAssignments.organizationId, organizationId),
        equipmentId ? eq(schema.equipmentAssignments.equipmentId, equipmentId) : undefined,
      ),
    )
    .orderBy(desc(schema.equipmentAssignments.startedAt))
    .limit(200);

  const filtered = matchingAssignments(rows, { equipmentId, operatorId, shift, refType, refId });
  const hit =
    at != null && equipmentId ? assignmentAt(filtered, equipmentId, at) : at != null && filtered.length ? assignmentAt(filtered, filtered[0]!.equipmentId, at) : null;

  return c.json({
    at: at ?? null,
    assignment: hit,
    assignments: filtered,
  });
});

equipmentRoute.get("/equipment/:id", async (c) => {
  return c.json(await equipmentDetail(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

equipmentRoute.post("/equipment", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    warehouseId?: string;
    code?: string;
    name?: string;
    class?: string;
    barcode?: string;
    notes?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const code = requireString(body.code, "code").toUpperCase();
  const name = requireString(body.name, "name");
  const equipmentClass = requireString(body.class, "class");
  if (!isEquipmentClass(equipmentClass)) badRequest("Invalid equipment class");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgWarehouse(db, organizationId, warehouseId);
  const barcode = equipmentBarcode(optionalString(body.barcode) ?? code);
  try {
    const [row] = await db
      .insert(schema.equipment)
      .values({
        id: newId(),
        organizationId,
        warehouseId,
        code,
        name,
        class: equipmentClass,
        barcode,
        status: "available",
        notes: optionalString(body.notes) ?? null,
        createdAt: Date.now(),
      })
      .returning();
    return c.json(row, 201);
  } catch {
    conflict("Equipment code or barcode already exists");
  }
});

equipmentRoute.patch("/equipment/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ code?: string; name?: string; notes?: string | null; barcode?: string }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const row = await getOrgEquipment(db, organizationId, c.req.param("id"));
  const patch: { code?: string; name?: string; notes?: string | null; barcode?: string } = {};
  if (body.code?.trim()) patch.code = body.code.trim().toUpperCase();
  if (body.name?.trim()) patch.name = body.name.trim();
  if (body.barcode?.trim()) patch.barcode = equipmentBarcode(body.barcode);
  if (body.notes !== undefined) patch.notes = body.notes?.trim() ? body.notes.trim() : null;
  if (Object.keys(patch).length === 0) badRequest("No equipment fields to update");
  try {
    await db.update(schema.equipment).set(patch).where(eq(schema.equipment.id, row.id));
  } catch {
    conflict("Equipment code or barcode already exists");
  }
  return c.json(await equipmentDetail(db, organizationId, row.id));
});

equipmentRoute.post("/equipment/:id/checkout", async (c) => {
  const body = await c.req.json<{
    operatorUserId?: string;
    shift?: string;
    refType?: string;
    refId?: string;
    inspection?: unknown;
  }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const actor = c.get("user")!;
  const role = c.get("role");
  const equipment = await getOrgEquipment(db, organizationId, c.req.param("id"));
  const operatorUserId = optionalString(body.operatorUserId) ?? actor.id;
  if (operatorUserId !== actor.id) requireOwner(role);
  await getOrgMember(db, organizationId, operatorUserId);

  const answers = parseInspectionBody(body.inspection);
  const graded = gradeInspection(equipment.class, answers);
  if (graded.missing.length) badRequest(`Inspection is missing: ${graded.missing.join(", ")}`);

  const now = Date.now();
  const inspectionId = newId();
  await db.insert(schema.equipmentInspections).values({
    id: inspectionId,
    organizationId,
    equipmentId: equipment.id,
    assignmentId: null,
    result: graded.result,
    itemsJson: JSON.stringify(answers),
    createdBy: actor.id,
    createdAt: now,
  });
  await recordEquipmentEvent(db, {
    organizationId,
    equipmentId: equipment.id,
    type: "inspected",
    actorUserId: actor.id,
    payload: { result: graded.result, failed: graded.failed },
    now,
  });

  if (graded.result === "fail") {
    await db.update(schema.equipment).set({ status: "out_of_service" }).where(eq(schema.equipment.id, equipment.id));
    await recordEquipmentEvent(db, {
      organizationId,
      equipmentId: equipment.id,
      type: "out_of_service",
      actorUserId: actor.id,
      payload: { failed: graded.failed },
      now,
    });
    throw failInspection(equipment.code);
  }

  const certs = await loadOperatorCerts(db, organizationId, operatorUserId);
  assertOperatorCertified(certs, operatorUserId, equipment.class);
  const openTruck = await loadOpenAssignmentForEquipment(db, organizationId, equipment.id);
  const openOperator = await loadOpenAssignmentForOperator(db, organizationId, operatorUserId);
  assertCanCheckout(equipment, openTruck, openOperator);

  let task: { refType: string; refId: string; number: string } | null = null;
  const refType = optionalString(body.refType);
  const refId = optionalString(body.refId);
  if (refType || refId) {
    if (!refType || !refId) badRequest("Task requires refType and refId");
    task = await resolveTask(db, organizationId, refType, refId);
  }

  const assignmentId = newId();
  await db.insert(schema.equipmentAssignments).values({
    id: assignmentId,
    organizationId,
    warehouseId: equipment.warehouseId,
    number: docNumber("CST"),
    equipmentId: equipment.id,
    operatorUserId,
    status: "open",
    shift: optionalString(body.shift) ?? null,
    refType: task?.refType ?? null,
    refId: task?.refId ?? null,
    startedAt: now,
    startedBy: actor.id,
  });
  await db
    .update(schema.equipmentInspections)
    .set({ assignmentId })
    .where(eq(schema.equipmentInspections.id, inspectionId));
  await db.update(schema.equipment).set({ status: "checked_out" }).where(eq(schema.equipment.id, equipment.id));
  await recordEquipmentEvent(db, {
    organizationId,
    equipmentId: equipment.id,
    assignmentId,
    type: "checked_out",
    actorUserId: actor.id,
    payload: {
      operatorUserId,
      shift: optionalString(body.shift) ?? null,
      refType: task?.refType ?? null,
      refId: task?.refId ?? null,
      taskNumber: task?.number ?? null,
    },
    now,
  });
  return c.json(await equipmentDetail(db, organizationId, equipment.id), 201);
});

equipmentRoute.post("/equipment/:id/transfer", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    operatorUserId?: string;
    shift?: string;
    refType?: string;
    refId?: string;
    inspection?: unknown;
  }>();
  const operatorUserId = requireString(body.operatorUserId, "operatorUserId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const actor = c.get("user")!;
  const equipment = await getOrgEquipment(db, organizationId, c.req.param("id"));
  await getOrgMember(db, organizationId, operatorUserId);
  const current = await loadOpenAssignmentForEquipment(db, organizationId, equipment.id);
  if (!current) conflict("Equipment is not checked out");
  if (current.operatorUserId === operatorUserId) badRequest("That operator already has this truck");

  const now = Date.now();
  if (body.inspection) {
    const answers = parseInspectionBody(body.inspection);
    const graded = gradeInspection(equipment.class, answers);
    if (graded.missing.length) badRequest(`Inspection is missing: ${graded.missing.join(", ")}`);
    await db.insert(schema.equipmentInspections).values({
      id: newId(),
      organizationId,
      equipmentId: equipment.id,
      assignmentId: current.id,
      result: graded.result,
      itemsJson: JSON.stringify(answers),
      createdBy: actor.id,
      createdAt: now,
    });
    await recordEquipmentEvent(db, {
      organizationId,
      equipmentId: equipment.id,
      assignmentId: current.id,
      type: "inspected",
      actorUserId: actor.id,
      payload: { result: graded.result, failed: graded.failed },
      now,
    });
    if (graded.result === "fail") {
      await db
        .update(schema.equipmentAssignments)
        .set({ status: "closed", endedAt: now, endedBy: actor.id })
        .where(eq(schema.equipmentAssignments.id, current.id));
      await db.update(schema.equipment).set({ status: "out_of_service" }).where(eq(schema.equipment.id, equipment.id));
      await recordEquipmentEvent(db, {
        organizationId,
        equipmentId: equipment.id,
        assignmentId: current.id,
        type: "out_of_service",
        actorUserId: actor.id,
        payload: { failed: graded.failed },
        now,
      });
      throw failInspection(equipment.code);
    }
  }

  const certs = await loadOperatorCerts(db, organizationId, operatorUserId);
  assertOperatorCertified(certs, operatorUserId, equipment.class);
  const openOperator = await loadOpenAssignmentForOperator(db, organizationId, operatorUserId);
  if (openOperator && openOperator.id !== current.id) {
    throw new EquipmentCustodyError(`Operator already has ${openOperator.number} open`, "OPERATOR_CHECKED_OUT", {
      assignmentId: openOperator.id,
    });
  }

  let task: { refType: string; refId: string; number: string } | null = null;
  const refType = optionalString(body.refType) ?? current.refType;
  const refId = optionalString(body.refId) ?? current.refId;
  if (refType && refId) task = await resolveTask(db, organizationId, refType, refId);

  await db
    .update(schema.equipmentAssignments)
    .set({ status: "closed", endedAt: now, endedBy: actor.id })
    .where(eq(schema.equipmentAssignments.id, current.id));
  const assignmentId = newId();
  await db.insert(schema.equipmentAssignments).values({
    id: assignmentId,
    organizationId,
    warehouseId: equipment.warehouseId,
    number: docNumber("CST"),
    equipmentId: equipment.id,
    operatorUserId,
    status: "open",
    shift: optionalString(body.shift) ?? current.shift,
    refType: task?.refType ?? null,
    refId: task?.refId ?? null,
    startedAt: now,
    startedBy: actor.id,
  });
  await recordEquipmentEvent(db, {
    organizationId,
    equipmentId: equipment.id,
    assignmentId,
    type: "transferred",
    actorUserId: actor.id,
    payload: { fromAssignmentId: current.id, operatorUserId },
    now,
  });
  return c.json(await equipmentDetail(db, organizationId, equipment.id));
});

equipmentRoute.post("/equipment/:id/return-to-service", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const actor = c.get("user")!;
  const equipment = await getOrgEquipment(db, organizationId, c.req.param("id"));
  if (!canReturnEquipmentToService(equipment.status)) conflict("Equipment is not out of service");
  const now = Date.now();
  await db.update(schema.equipment).set({ status: "available" }).where(eq(schema.equipment.id, equipment.id));
  await recordEquipmentEvent(db, {
    organizationId,
    equipmentId: equipment.id,
    type: "returned_to_service",
    actorUserId: actor.id,
    now,
  });
  return c.json(await equipmentDetail(db, organizationId, equipment.id));
});

equipmentRoute.post("/equipment/assignments/:id/checkin", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const actor = c.get("user")!;
  const role = c.get("role");
  const assignment = await assignmentWithOperator(db, organizationId, c.req.param("id"));
  if (!canCheckInAssignment(assignment.status)) conflict("Assignment is already closed");
  if (assignment.operatorUserId !== actor.id) requireOwner(role);
  const now = Date.now();
  await db
    .update(schema.equipmentAssignments)
    .set({ status: "closed", endedAt: now, endedBy: actor.id })
    .where(eq(schema.equipmentAssignments.id, assignment.id));
  await db
    .update(schema.equipment)
    .set({ status: "available" })
    .where(eq(schema.equipment.id, assignment.equipmentId));
  await recordEquipmentEvent(db, {
    organizationId,
    equipmentId: assignment.equipmentId,
    assignmentId: assignment.id,
    type: "checked_in",
    actorUserId: actor.id,
    now,
  });
  return c.json(await equipmentDetail(db, organizationId, assignment.equipmentId));
});

equipmentRoute.post("/equipment/assignments/:id/task", async (c) => {
  const body = await c.req.json<{ refType?: string | null; refId?: string | null }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const actor = c.get("user")!;
  const role = c.get("role");
  const assignment = await assignmentWithOperator(db, organizationId, c.req.param("id"));
  if (!canCheckInAssignment(assignment.status)) conflict("Assignment is already closed");
  if (assignment.operatorUserId !== actor.id) requireOwner(role);
  const refType = optionalString(body.refType ?? undefined);
  const refId = optionalString(body.refId ?? undefined);
  let task: { refType: string; refId: string; number: string } | null = null;
  if (refType || refId) {
    if (!refType || !refId) badRequest("Task requires refType and refId");
    task = await resolveTask(db, organizationId, refType, refId);
  }
  const now = Date.now();
  await db
    .update(schema.equipmentAssignments)
    .set({ refType: task?.refType ?? null, refId: task?.refId ?? null })
    .where(eq(schema.equipmentAssignments.id, assignment.id));
  await recordEquipmentEvent(db, {
    organizationId,
    equipmentId: assignment.equipmentId,
    assignmentId: assignment.id,
    type: "task_attached",
    actorUserId: actor.id,
    payload: { refType: task?.refType ?? null, refId: task?.refId ?? null, taskNumber: task?.number ?? null },
    now,
  });
  return c.json(await equipmentDetail(db, organizationId, assignment.equipmentId));
});

equipmentRoute.get("/certifications", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const userId = c.req.query("userId");
  const rows = await loadOperatorCerts(db, organizationId, userId || undefined);
  return c.json(rows);
});

equipmentRoute.post("/certifications", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ userId?: string; class?: string; expiresOn?: unknown }>();
  const userId = requireString(body.userId, "userId");
  const equipmentClass = requireString(body.class, "class");
  if (!isEquipmentClass(equipmentClass)) badRequest("Invalid equipment class");
  const expiresOn = parseExpiresOn(body.expiresOn);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgMember(db, organizationId, userId);
  try {
    const [row] = await db
      .insert(schema.operatorCertifications)
      .values({
        id: newId(),
        organizationId,
        userId,
        class: equipmentClass,
        expiresOn,
        createdAt: Date.now(),
      })
      .returning();
    return c.json(row, 201);
  } catch {
    conflict("That person already has a certification for this class");
  }
});

equipmentRoute.delete("/certifications/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [row] = await db
    .select()
    .from(schema.operatorCertifications)
    .where(
      and(
        eq(schema.operatorCertifications.id, c.req.param("id")),
        eq(schema.operatorCertifications.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) notFound("Certification not found");
  await db.delete(schema.operatorCertifications).where(eq(schema.operatorCertifications.id, row.id));
  return c.body(null, 204);
});
