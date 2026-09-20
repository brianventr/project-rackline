import { utcYyyymmdd } from "./expiry";

export const EQUIPMENT_CLASSES = ["sit_down", "reach", "pallet_jack", "order_picker", "other"] as const;
export type EquipmentClassName = (typeof EQUIPMENT_CLASSES)[number];

export const EQUIPMENT_STATUSES = ["available", "checked_out", "out_of_service"] as const;
export const ASSIGNMENT_STEPS = ["open", "closed"] as const;
export const ASSIGNMENT_TASK_TYPES = [
  "order",
  "transfer",
  "replenishment",
  "workOrder",
  "kit",
  "receipt",
  "wave",
  "asn",
] as const;
export type AssignmentTaskType = (typeof ASSIGNMENT_TASK_TYPES)[number];

export const INSPECTION_RESULTS = ["pass", "fail", "na"] as const;
export type InspectionResultValue = (typeof INSPECTION_RESULTS)[number];

export const CERT_EXPIRING_WITHIN_DAYS = 30;

export type EquipmentCustodyCode =
  | "EQUIPMENT_IN_USE"
  | "OPERATOR_CHECKED_OUT"
  | "EQUIPMENT_OUT_OF_SERVICE"
  | "CERT_REQUIRED"
  | "CERT_EXPIRED"
  | "INSPECTION_FAILED";

export class EquipmentCustodyError extends Error {
  constructor(
    message: string,
    public code: EquipmentCustodyCode,
    public extras: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "EquipmentCustodyError";
  }
}

export type InspectionItem = {
  code: string;
  label: string;
};

export type InspectionAnswer = {
  code: string;
  result: InspectionResultValue;
  notes?: string;
};

export type OpenAssignment = {
  id: string;
  number: string;
  equipmentId: string;
  operatorUserId: string;
  status: string;
};

export type TimedAssignment = {
  id: string;
  equipmentId: string;
  operatorUserId: string;
  shift: string | null;
  refType: string | null;
  refId: string | null;
  startedAt: number;
  endedAt: number | null;
};

const SHARED_CHECKS: InspectionItem[] = [
  { code: "data_plate", label: "Nameplate / data plate legible" },
  { code: "forks", label: "Forks / load rest" },
  { code: "hydraulics", label: "Mast, chains, hoses, leaks" },
  { code: "horn", label: "Horn" },
  { code: "lights", label: "Lights" },
  { code: "tires", label: "Tires / casters" },
  { code: "battery", label: "Battery connector / cables (or fuel)" },
  { code: "controls", label: "Controls and brakes" },
];

const COUNTERBALANCE_CHECKS: InspectionItem[] = [
  ...SHARED_CHECKS,
  { code: "overhead_guard", label: "Overhead guard" },
  { code: "seat_belt", label: "Seat belt / operator restraint" },
  { code: "steering", label: "Steering" },
];

const PALLET_JACK_CHECKS: InspectionItem[] = [
  { code: "data_plate", label: "Nameplate / data plate legible" },
  { code: "forks", label: "Forks" },
  { code: "hydraulics", label: "Hydraulics / leaks" },
  { code: "horn", label: "Horn" },
  { code: "tires", label: "Load wheels / steer casters" },
  { code: "battery", label: "Battery connector / cables" },
  { code: "controls", label: "Tiller, controls, and brakes" },
];

const CHECKLIST_BY_CLASS: Record<EquipmentClassName, InspectionItem[]> = {
  sit_down: COUNTERBALANCE_CHECKS,
  reach: COUNTERBALANCE_CHECKS,
  order_picker: COUNTERBALANCE_CHECKS,
  pallet_jack: PALLET_JACK_CHECKS,
  other: SHARED_CHECKS,
};

export function isEquipmentClass(value: string): value is EquipmentClassName {
  return (EQUIPMENT_CLASSES as readonly string[]).includes(value);
}

export function isAssignmentTaskType(value: string): value is AssignmentTaskType {
  return (ASSIGNMENT_TASK_TYPES as readonly string[]).includes(value);
}

export function isInspectionResult(value: string): value is InspectionResultValue {
  return (INSPECTION_RESULTS as readonly string[]).includes(value);
}

export function equipmentBarcode(code: string): string {
  const value = code.trim().toUpperCase().replace(/\s+/g, "");
  return value.startsWith("EQ:") ? value : `EQ:${value}`;
}

export function equipmentClassLabel(value: string): string {
  switch (value) {
    case "sit_down":
      return "Sit-down forklift";
    case "reach":
      return "Reach truck";
    case "pallet_jack":
      return "Pallet jack";
    case "order_picker":
      return "Order picker";
    default:
      return "Other";
  }
}

export function checklistForClass(equipmentClass: string): InspectionItem[] {
  if (!isEquipmentClass(equipmentClass)) return CHECKLIST_BY_CLASS.other;
  return CHECKLIST_BY_CLASS[equipmentClass];
}

export function gradeInspection(
  equipmentClass: string,
  answers: InspectionAnswer[],
): { result: "pass" | "fail"; missing: string[]; failed: string[] } {
  const template = checklistForClass(equipmentClass);
  const byCode = new Map(answers.map((row) => [row.code, row]));
  const missing: string[] = [];
  const failed: string[] = [];
  for (const item of template) {
    const answer = byCode.get(item.code);
    if (!answer) {
      missing.push(item.code);
      continue;
    }
    if (answer.result === "fail") failed.push(item.code);
  }
  return {
    result: failed.length > 0 ? "fail" : "pass",
    missing,
    failed,
  };
}

export function certForClass(
  certs: { userId: string; class: string; expiresOn: number }[],
  operatorUserId: string,
  equipmentClass: string,
): { userId: string; class: string; expiresOn: number } | null {
  return certs.find((row) => row.userId === operatorUserId && row.class === equipmentClass) ?? null;
}

export function isCertExpired(expiresOn: number, asOf = utcYyyymmdd()): boolean {
  return expiresOn < asOf;
}

export function isCertExpiring(expiresOn: number, asOf = utcYyyymmdd(), withinDays = CERT_EXPIRING_WITHIN_DAYS): boolean {
  const year = Math.floor(asOf / 10000);
  const month = Math.floor((asOf % 10000) / 100) - 1;
  const day = asOf % 100;
  const horizon = new Date(Date.UTC(year, month, day + withinDays));
  const horizonDay =
    horizon.getUTCFullYear() * 10000 + (horizon.getUTCMonth() + 1) * 100 + horizon.getUTCDate();
  return expiresOn <= horizonDay;
}

export function assertOperatorCertified(
  certs: { userId: string; class: string; expiresOn: number }[],
  operatorUserId: string,
  equipmentClass: string,
  asOf = utcYyyymmdd(),
): void {
  const cert = certForClass(certs, operatorUserId, equipmentClass);
  if (!cert) {
    throw new EquipmentCustodyError(
      `Operator is not certified for ${equipmentClassLabel(equipmentClass)}`,
      "CERT_REQUIRED",
      { equipmentClass },
    );
  }
  if (isCertExpired(cert.expiresOn, asOf)) {
    throw new EquipmentCustodyError(
      `${equipmentClassLabel(equipmentClass)} certification expired`,
      "CERT_EXPIRED",
      { equipmentClass, expiresOn: cert.expiresOn },
    );
  }
}

export function assertCanCheckout(
  equipment: { id: string; status: string; code?: string },
  openForEquipment: OpenAssignment | null,
  openForOperator: OpenAssignment | null,
): void {
  if (equipment.status === "out_of_service") {
    throw new EquipmentCustodyError(
      `${equipment.code ?? "Equipment"} is out of service`,
      "EQUIPMENT_OUT_OF_SERVICE",
      { equipmentId: equipment.id },
    );
  }
  if (openForEquipment) {
    throw new EquipmentCustodyError(
      `${equipment.code ?? "Equipment"} is already checked out (${openForEquipment.number})`,
      "EQUIPMENT_IN_USE",
      { equipmentId: equipment.id, assignmentId: openForEquipment.id, assignmentNumber: openForEquipment.number },
    );
  }
  if (openForOperator) {
    throw new EquipmentCustodyError(
      `Operator already has ${openForOperator.number} open`,
      "OPERATOR_CHECKED_OUT",
      { assignmentId: openForOperator.id, assignmentNumber: openForOperator.number, equipmentId: openForOperator.equipmentId },
    );
  }
}

export function failInspection(equipmentCode?: string): EquipmentCustodyError {
  return new EquipmentCustodyError(
    `${equipmentCode ?? "Equipment"} failed pre-use inspection and is out of service`,
    "INSPECTION_FAILED",
    {},
  );
}

export function canCheckInAssignment(status: string): boolean {
  return status === "open";
}

export function canReturnEquipmentToService(status: string): boolean {
  return status === "out_of_service";
}

export function assignmentAt<T extends TimedAssignment>(
  assignments: T[],
  equipmentId: string,
  at: number,
): T | null {
  const covering = assignments.filter(
    (row) => row.equipmentId === equipmentId && row.startedAt <= at && (row.endedAt == null || row.endedAt >= at),
  );
  covering.sort((a, b) => b.startedAt - a.startedAt);
  return covering[0] ?? null;
}

export function taskFromScanKind(kind: string): AssignmentTaskType | null {
  if (isAssignmentTaskType(kind)) return kind;
  return null;
}

export function matchingAssignments<T extends TimedAssignment>(
  assignments: T[],
  filters: {
    equipmentId?: string;
    operatorId?: string;
    shift?: string;
    refType?: string;
    refId?: string;
  },
): T[] {
  const shift = filters.shift?.trim().toLowerCase();
  return assignments.filter((row) => {
    if (filters.equipmentId && row.equipmentId !== filters.equipmentId) return false;
    if (filters.operatorId && row.operatorUserId !== filters.operatorId) return false;
    if (shift && (row.shift ?? "").trim().toLowerCase() !== shift) return false;
    if (filters.refType && row.refType !== filters.refType) return false;
    if (filters.refId && row.refId !== filters.refId) return false;
    return true;
  });
}
