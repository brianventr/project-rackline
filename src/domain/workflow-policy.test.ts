import { describe, expect, it } from "vitest";
import {
  GARAGE_POLICY,
  WAREHOUSE_POLICY,
  WorkflowPolicyError,
  assertQuickShip,
  assertScanned,
  checkScanEvidence,
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

  it("throws SCAN_REQUIRED only when the policy asks for scans", () => {
    expect(() => assertScanned(GARAGE_POLICY, "pick", lines, null, bay)).not.toThrow();
    try {
      assertScanned(WAREHOUSE_POLICY, "pick", lines, { locationScan: "A-01-01" }, bay);
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowPolicyError);
      expect((err as WorkflowPolicyError).code).toBe("SCAN_REQUIRED");
      expect((err as Error).message).toMatch(/Scan LAMP/);
    }
    expect(() => assertScanned(WAREHOUSE_POLICY, "pack", lines, { itemScans: ["LAMP", "CORD"] }, bay)).not.toThrow();
  });
});
