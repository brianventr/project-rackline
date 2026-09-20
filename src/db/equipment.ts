import { and, desc, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import type { EquipmentEventType } from "./schema";

export async function loadOpenAssignmentForEquipment(db: AppDb, organizationId: string, equipmentId: string) {
  const [row] = await db
    .select()
    .from(schema.equipmentAssignments)
    .where(
      and(
        eq(schema.equipmentAssignments.organizationId, organizationId),
        eq(schema.equipmentAssignments.equipmentId, equipmentId),
        eq(schema.equipmentAssignments.status, "open"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function loadOpenAssignmentForOperator(db: AppDb, organizationId: string, operatorUserId: string) {
  const [row] = await db
    .select()
    .from(schema.equipmentAssignments)
    .where(
      and(
        eq(schema.equipmentAssignments.organizationId, organizationId),
        eq(schema.equipmentAssignments.operatorUserId, operatorUserId),
        eq(schema.equipmentAssignments.status, "open"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function loadOperatorCerts(db: AppDb, organizationId: string, userId?: string) {
  return db
    .select({
      id: schema.operatorCertifications.id,
      userId: schema.operatorCertifications.userId,
      class: schema.operatorCertifications.class,
      expiresOn: schema.operatorCertifications.expiresOn,
      createdAt: schema.operatorCertifications.createdAt,
      userName: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.operatorCertifications)
    .innerJoin(schema.user, eq(schema.user.id, schema.operatorCertifications.userId))
    .where(
      and(
        eq(schema.operatorCertifications.organizationId, organizationId),
        userId ? eq(schema.operatorCertifications.userId, userId) : undefined,
      ),
    );
}

export async function recordEquipmentEvent(
  db: AppDb,
  input: {
    organizationId: string;
    equipmentId: string;
    assignmentId?: string | null;
    type: EquipmentEventType;
    actorUserId: string;
    payload?: Record<string, unknown> | null;
    now?: number;
  },
) {
  await db.insert(schema.equipmentEvents).values({
    id: newId(),
    organizationId: input.organizationId,
    equipmentId: input.equipmentId,
    assignmentId: input.assignmentId ?? null,
    type: input.type,
    actorUserId: input.actorUserId,
    payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    createdAt: input.now ?? Date.now(),
  });
}

export async function loadAssignmentHistory(db: AppDb, organizationId: string, equipmentId: string, limit = 40) {
  return db
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
      endedAt: schema.equipmentAssignments.endedAt,
      startedBy: schema.equipmentAssignments.startedBy,
      endedBy: schema.equipmentAssignments.endedBy,
    })
    .from(schema.equipmentAssignments)
    .innerJoin(schema.user, eq(schema.user.id, schema.equipmentAssignments.operatorUserId))
    .where(
      and(
        eq(schema.equipmentAssignments.organizationId, organizationId),
        eq(schema.equipmentAssignments.equipmentId, equipmentId),
      ),
    )
    .orderBy(desc(schema.equipmentAssignments.startedAt))
    .limit(limit);
}
