import { describe, expect, it } from "vitest";
import {
  isPackSlipStatus,
  isPickListStatus,
  isShippingLabelStatus,
  jobsForScan,
  packSlipJobs,
  pickListJobs,
  printJobButtonLabel,
  resolvePrinterForKind,
  shippingLabelJobs,
  wavePickListJobs,
  withPrintQuery,
} from "./print-station";

describe("print station jobs", () => {
  it("prints pack slips once picking has started", () => {
    expect(isPackSlipStatus("open")).toBe(false);
    expect(isPackSlipStatus("picking")).toBe(true);
    expect(isPackSlipStatus("packed")).toBe(true);
    expect(isPackSlipStatus("draft")).toBe(false);
  });

  it("prints pick lists for open and picking tickets", () => {
    expect(isPickListStatus("open")).toBe(true);
    expect(isPickListStatus("draft")).toBe(true);
    expect(isPickListStatus("picking")).toBe(true);
    expect(isPickListStatus("picked")).toBe(false);
  });

  it("holds shipping labels until the ticket is picked", () => {
    expect(isShippingLabelStatus("picking")).toBe(false);
    expect(isShippingLabelStatus("picked")).toBe(true);
    expect(isShippingLabelStatus("packed")).toBe(true);
  });

  it("queues pick lists, pack slips, and labels from open outbound", () => {
    const orders = [
      { id: "o1", number: "ORD-1", customerName: "Harbor", status: "picking" },
      { id: "o2", number: "ORD-2", customerName: "Maya", status: "packed" },
      { id: "o3", number: "ORD-3", customerName: "Skip", status: "open" },
    ];
    expect(pickListJobs(orders).map((job) => job.title)).toEqual(["ORD-1", "ORD-3"]);
    expect(packSlipJobs(orders).map((job) => job.title)).toEqual(["ORD-1", "ORD-2"]);
    expect(shippingLabelJobs(orders).map((job) => job.title)).toEqual(["ORD-2"]);
  });

  it("queues wave pick lists until the wave is completed", () => {
    const waves = [
      { id: "w1", number: "WAV-1", status: "released", mode: "batch" },
      { id: "w2", number: "WAV-2", status: "completed", mode: "wave" },
    ];
    expect(wavePickListJobs(waves).map((job) => job.href)).toEqual(["/outbound/waves/w1/pick-list"]);
  });

  it("appends print=1 for station dispatch", () => {
    expect(withPrintQuery("/outbound/orders/o1/pick-list")).toBe("/outbound/orders/o1/pick-list?print=1");
    expect(withPrintQuery("/outbound/orders/o1/pick-list?print=1")).toBe("/outbound/orders/o1/pick-list?print=1");
  });

  it("resolves bay vs shipping printers on a station", () => {
    const printers = [
      { id: "p-browser", isDefault: true },
      { id: "p-zpl", isDefault: false },
    ];
    const station = {
      defaultPrinterId: "p-browser",
      bayPrinterId: "p-browser",
      shippingPrinterId: "p-zpl",
    };
    expect(resolvePrinterForKind(station, printers, "bay")).toBe("p-browser");
    expect(resolvePrinterForKind(station, printers, "shipping-label")).toBe("p-zpl");
    expect(resolvePrinterForKind(null, printers, "item")).toBe("p-browser");
    expect(resolvePrinterForKind(station, printers, "pick-list")).toBe("p-browser");
  });
});

describe("jobsForScan", () => {
  it("prints a bay or SKU label from a scan", () => {
    expect(
      jobsForScan({
        kind: "location",
        location: { id: "loc", code: "B-01-01", name: "Aisle B" },
      }),
    ).toEqual([
      {
        kind: "bay",
        href: "/stock/locations/loc",
        title: "B-01-01",
        subtitle: "Aisle B",
        mediaHint: "2x1",
        payloadHint: "zpl",
      },
    ]);
    expect(
      jobsForScan({
        kind: "item",
        item: { id: "it", sku: "LAMP", name: "Desk lamp" },
      })[0]?.href,
    ).toBe("/stock/items/it");
  });

  it("offers a pick list for an open order", () => {
    const jobs = jobsForScan({
      kind: "order",
      order: { id: "o1", number: "ORD-DEMO1", customerName: "Harbor", status: "open" },
    });
    expect(jobs.map((job) => job.kind)).toEqual(["pick-list"]);
    expect(jobs[0]?.href).toBe("/outbound/orders/o1/pick-list");
  });

  it("offers pick list and pack slip while picking", () => {
    const jobs = jobsForScan({
      kind: "order",
      order: { id: "o1", number: "ORD-DEMO1", customerName: "Harbor", status: "picking" },
    });
    expect(jobs.map((job) => job.kind)).toEqual(["pick-list", "pack-slip"]);
  });

  it("offers pack slip and shipping label for a picked order", () => {
    const jobs = jobsForScan({
      kind: "order",
      order: { id: "o1", number: "ORD-DEMO1", customerName: "Harbor", status: "picked" },
    });
    expect(jobs.map((job) => job.kind)).toEqual(["pack-slip", "shipping-label"]);
    expect(jobs[0]?.href).toBe("/outbound/orders/o1/pack-slip");
    expect(printJobButtonLabel("pack-slip")).toBe("Pack slip");
  });

  it("offers a wave pick list", () => {
    const jobs = jobsForScan({
      kind: "wave",
      wave: { id: "w1", number: "WAV-DEMO1", status: "released", mode: "batch" },
    });
    expect(jobs.map((job) => job.kind)).toEqual(["pick-list"]);
    expect(jobs[0]?.href).toBe("/outbound/waves/w1/pick-list");
  });

  it("returns nothing for a receipt scan", () => {
    expect(jobsForScan({ kind: "receipt" })).toEqual([]);
    expect(
      jobsForScan({
        kind: "equipment",
        equipment: { id: "eq1", code: "FL-01", name: "Sit-down" },
      })[0]?.href,
    ).toBe("/equipment/eq1");
  });
});
