import { describe, expect, it } from "vitest";
import { utcYyyymmdd, addUtcDays } from "./expiry";
import {
  assignmentAt,
  assertCanCheckout,
  assertOperatorCertified,
  canCheckInAssignment,
  canReturnEquipmentToService,
  equipmentBarcode,
  equipmentClassLabel,
  EquipmentCustodyError,
  checklistForClass,
  gradeInspection,
  isCertExpiring,
  matchingAssignments,
  taskFromScanKind,
} from "./equipment";

const openTruck = {
  id: "a1",
  number: "CST-1",
  equipmentId: "fl01",
  operatorUserId: "maya",
  status: "open",
};

describe("equipmentBarcode", () => {
  it("prefixes EQ: and uppercases", () => {
    expect(equipmentBarcode("fl-01")).toBe("EQ:FL-01");
    expect(equipmentBarcode("EQ:pj-01")).toBe("EQ:PJ-01");
  });
});

describe("checklistForClass", () => {
  it("adds restraint checks on sit-down trucks and a tiller check on pallet jacks", () => {
    expect(checklistForClass("sit_down").some((row) => row.code === "seat_belt")).toBe(true);
    expect(checklistForClass("pallet_jack").some((row) => row.code === "seat_belt")).toBe(false);
    expect(checklistForClass("pallet_jack").some((row) => row.code === "controls")).toBe(true);
  });
});

describe("gradeInspection", () => {
  it("passes when every item is pass or n/a", () => {
    const answers = checklistForClass("pallet_jack").map((item) => ({
      code: item.code,
      result: item.code === "horn" ? ("na" as const) : ("pass" as const),
    }));
    expect(gradeInspection("pallet_jack", answers)).toEqual({ result: "pass", missing: [], failed: [] });
  });

  it("fails on any fail and reports missing items", () => {
    const graded = gradeInspection("pallet_jack", [
      { code: "data_plate", result: "pass" },
      { code: "horn", result: "fail" },
    ]);
    expect(graded.result).toBe("fail");
    expect(graded.failed).toEqual(["horn"]);
    expect(graded.missing).toContain("forks");
  });
});

describe("assertOperatorCertified", () => {
  const today = utcYyyymmdd();

  it("requires a matching unexpired class", () => {
    expect(() => assertOperatorCertified([], "maya", "sit_down", today)).toThrow(EquipmentCustodyError);
    try {
      assertOperatorCertified([], "maya", "sit_down", today);
    } catch (err) {
      expect((err as EquipmentCustodyError).code).toBe("CERT_REQUIRED");
    }
    expect(() =>
      assertOperatorCertified([{ userId: "maya", class: "sit_down", expiresOn: addUtcDays(today, -1) }], "maya", "sit_down", today),
    ).toThrow(/expired/);
    expect(() =>
      assertOperatorCertified([{ userId: "maya", class: "sit_down", expiresOn: today }], "maya", "sit_down", today),
    ).not.toThrow();
  });
});

describe("assertCanCheckout", () => {
  it("blocks out of service, occupied trucks, and operators already on a truck", () => {
    expect(() => assertCanCheckout({ id: "fl02", status: "out_of_service", code: "FL-02" }, null, null)).toThrow(
      /out of service/,
    );
    expect(() => assertCanCheckout({ id: "fl01", status: "available", code: "FL-01" }, openTruck, null)).toThrow(
      /already checked out/,
    );
    expect(() => assertCanCheckout({ id: "pj01", status: "available", code: "PJ-01" }, null, openTruck)).toThrow(
      /already has/,
    );
    expect(() => assertCanCheckout({ id: "pj01", status: "available", code: "PJ-01" }, null, null)).not.toThrow();
  });
});

describe("assignmentAt", () => {
  it("returns the session covering a timestamp", () => {
    const rows = [
      {
        id: "closed",
        equipmentId: "pj01",
        operatorUserId: "maya",
        shift: "days",
        refType: null,
        refId: null,
        startedAt: 1_000,
        endedAt: 2_000,
      },
      {
        id: "open",
        equipmentId: "fl01",
        operatorUserId: "maya",
        shift: "days",
        refType: "transfer",
        refId: "xfr",
        startedAt: 1_500,
        endedAt: null,
      },
    ];
    expect(assignmentAt(rows, "pj01", 1_500)?.id).toBe("closed");
    expect(assignmentAt(rows, "pj01", 2_500)).toBeNull();
    expect(assignmentAt(rows, "fl01", 2_000)?.id).toBe("open");
  });
});

describe("matchingAssignments", () => {
  it("filters by shift, operator, and task", () => {
    const rows = [
      {
        id: "a",
        equipmentId: "fl01",
        operatorUserId: "maya",
        shift: "days",
        refType: "transfer",
        refId: "xfr",
        startedAt: 1,
        endedAt: null,
      },
      {
        id: "b",
        equipmentId: "pj01",
        operatorUserId: "alex",
        shift: "nights",
        refType: "order",
        refId: "ord",
        startedAt: 1,
        endedAt: null,
      },
    ];
    expect(matchingAssignments(rows, { shift: "Days" }).map((row) => row.id)).toEqual(["a"]);
    expect(matchingAssignments(rows, { operatorId: "alex", refType: "order" }).map((row) => row.id)).toEqual(["b"]);
  });
});

describe("taskFromScanKind", () => {
  it("maps WMS document scans onto assignment tasks", () => {
    expect(taskFromScanKind("transfer")).toBe("transfer");
    expect(taskFromScanKind("equipment")).toBeNull();
  });
});

describe("labels and gates", () => {
  it("names classes and gates check-in / return-to-service", () => {
    expect(equipmentClassLabel("sit_down")).toBe("Sit-down forklift");
    expect(canCheckInAssignment("open")).toBe(true);
    expect(canCheckInAssignment("closed")).toBe(false);
    expect(canReturnEquipmentToService("out_of_service")).toBe(true);
    const today = utcYyyymmdd();
    expect(isCertExpiring(addUtcDays(today, 10), today)).toBe(true);
    expect(isCertExpiring(addUtcDays(today, 90), today)).toBe(false);
  });
});
