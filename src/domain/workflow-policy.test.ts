import { describe, expect, it } from "vitest";
import {
  GARAGE_POLICY,
  WAREHOUSE_POLICY,
  WorkflowPolicyError,
  assertQuickShip,
  assertScanned,
  checkScanEvidence,
  countScans,
  requiresScan,
  workflowPolicy,
} from "./workflow-policy";

const bay = { code: "A-01-01", barcode: "LOC-0001" };
const lines = [
  { lineId: "l1", qty: 3, sku: "LAMP", barcode: "0123456789" },
  { lineId: "l2", qty: 1, sku: "CORD", barcode: null },
];

describe("workflow policy", () => {
  it("splits Garage from Manufacturer", () => {
    expect(workflowPolicy("garage")).toBe(GARAGE_POLICY);
    expect(workflowPolicy("warehouse")).toBe(WAREHOUSE_POLICY);
    expect(workflowPolicy(null)).toBe(WAREHOUSE_POLICY);
    expect(requiresScan(GARAGE_POLICY, "pick")).toBe(false);
    expect(requiresScan(WAREHOUSE_POLICY, "pick")).toBe(true);
    expect(requiresScan(WAREHOUSE_POLICY, "pack")).toBe(true);
  });

  it("refuses quick-ship in Manufacturer mode", () => {
    expect(() => assertQuickShip(GARAGE_POLICY)).not.toThrow();
    expect(() => assertQuickShip(WAREHOUSE_POLICY)).toThrow(WorkflowPolicyError);
  });
});

describe("scan evidence", () => {
  it("needs the bay first on a pick", () => {
    expect(checkScanEvidence(lines, { itemScans: ["LAMP", "CORD"] }, { bay })).toBe("Scan bay A-01-01 before posting");
    expect(checkScanEvidence(lines, { locationScan: "B-02-02", itemScans: ["LAMP", "CORD"] }, { bay })).toMatch(
      /this pick is from A-01-01/,
    );
  });

  it("accepts the bay by code or barcode and each SKU by SKU or barcode", () => {
    expect(checkScanEvidence(lines, { locationScan: "a-01-01", itemScans: ["lamp", "cord"] }, { bay })).toBeNull();
    expect(checkScanEvidence(lines, { locationScan: "LOC-0001", itemScans: ["0123456789", "CORD"] }, { bay })).toBeNull();
  });

  it("names the first unscanned SKU and ignores zero-qty lines", () => {
    expect(checkScanEvidence(lines, { itemScans: ["LAMP"] })).toBe("Scan CORD before posting");
    expect(checkScanEvidence([{ ...lines[0]!, qty: 0 }], { itemScans: [] })).toBeNull();
  });

  it("takes one scan per SKU on a pick, whatever qty is typed after it", () => {
    expect(checkScanEvidence(lines, { locationScan: "A-01-01", itemScans: ["LAMP", "CORD"] }, { bay })).toBeNull();
  });

  it("needs one scan per unit on a pack", () => {
    expect(checkScanEvidence(lines, { itemScans: ["LAMP", "CORD"] }, { perUnit: true })).toBe(
      "Scan every unit of LAMP: 1 of 3 scanned",
    );
    expect(checkScanEvidence(lines, { itemScans: ["CORD"] }, { perUnit: true })).toBe("Scan LAMP before posting");
    expect(checkScanEvidence(lines, { itemScans: ["LAMP", "lamp", "0123456789", "CORD"] }, { perUnit: true })).toBeNull();
    expect(checkScanEvidence(lines, { itemScans: ["LAMP", "LAMP", "LAMP", "LAMP", "CORD"] }, { perUnit: true })).toBeNull();
  });

  it("adds up a SKU that sits on two lines before counting its scans", () => {
    const split = [
      { lineId: "l1", qty: 2, sku: "LAMP", barcode: null },
      { lineId: "l3", qty: 1, sku: "lamp", barcode: null },
    ];
    expect(checkScanEvidence(split, { itemScans: ["LAMP", "LAMP"] }, { perUnit: true })).toBe(
      "Scan every unit of LAMP: 2 of 3 scanned",
    );
    expect(checkScanEvidence(split, { itemScans: ["LAMP", "LAMP", "LAMP"] }, { perUnit: true })).toBeNull();
  });

  it("counts scans of a SKU by SKU or barcode", () => {
    expect(countScans([" lamp", "0123456789", "CORD", ""], { sku: "LAMP", barcode: "0123456789" })).toBe(2);
    expect(countScans(null, { sku: "LAMP", barcode: null })).toBe(0);
  });

  it("counts a pack barcode scan as the pack's units", () => {
    const packs = [{ barcode: "10012345678902", qty: 6 }, { barcode: null, qty: 48 }];
    expect(countScans(["10012345678902", "lamp"], { sku: "LAMP", barcode: null, packs })).toBe(7);
    const caseLines = [{ lineId: "l1", qty: 6, sku: "LAMP", barcode: null, packs }];
    expect(checkScanEvidence(caseLines, { itemScans: ["10012345678902"] }, { perUnit: true })).toBeNull();
    expect(checkScanEvidence([{ ...caseLines[0]!, qty: 8 }], { itemScans: ["10012345678902"] }, { perUnit: true })).toBe(
      "Scan every unit of LAMP: 6 of 8 scanned",
    );
    expect(checkScanEvidence(caseLines, { locationScan: "A-01-01", itemScans: ["10012345678902"] }, { bay })).toBeNull();
  });

  it("throws SCAN_REQUIRED only when the policy asks for scans", () => {
    expect(() => assertScanned(GARAGE_POLICY, "pick", lines, null, bay)).not.toThrow();
    expect(() => assertScanned(GARAGE_POLICY, "pack", lines, null)).not.toThrow();
    try {
      assertScanned(WAREHOUSE_POLICY, "pick", lines, { locationScan: "A-01-01" }, bay);
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowPolicyError);
      expect((err as WorkflowPolicyError).code).toBe("SCAN_REQUIRED");
      expect((err as Error).message).toMatch(/Scan LAMP/);
    }
    expect(() => assertScanned(WAREHOUSE_POLICY, "pick", lines, { locationScan: "A-01-01", itemScans: ["LAMP", "CORD"] }, bay)).not.toThrow();
  });

  it("makes a Manufacturer pack scan every unit and ignores the bay", () => {
    expect(() => assertScanned(WAREHOUSE_POLICY, "pack", lines, { itemScans: ["LAMP", "CORD"] }, bay)).toThrow(
      "Scan every unit of LAMP: 1 of 3 scanned. Manufacturer mode packs by scan on the floor.",
    );
    expect(() => assertScanned(WAREHOUSE_POLICY, "pack", lines, { itemScans: ["LAMP", "LAMP", "LAMP", "CORD"] }, bay)).not.toThrow();
  });
});
