import { describe, expect, it } from "vitest";
import {
  isPackSlipStatus,
  isShippingLabelStatus,
  jobsForScan,
  packSlipJobs,
  resolvePrinterForKind,
  shippingLabelJobs,
} from "./print-station";

describe("print station jobs", () => {
  it("prints pack slips once picking has started", () => {
    expect(isPackSlipStatus("open")).toBe(false);
    expect(isPackSlipStatus("picking")).toBe(true);
    expect(isPackSlipStatus("packed")).toBe(true);
    expect(isPackSlipStatus("draft")).toBe(false);
  });

  it("holds shipping labels until the ticket is picked", () => {
    expect(isShippingLabelStatus("picking")).toBe(false);
    expect(isShippingLabelStatus("picked")).toBe(true);
    expect(isShippingLabelStatus("packed")).toBe(true);
  });

  it("queues pack slips and labels from open outbound", () => {
    const orders = [
      { id: "o1", number: "ORD-1", customerName: "Harbor", status: "picking" },
      { id: "o2", number: "ORD-2", customerName: "Maya", status: "packed" },
      { id: "o3", number: "ORD-3", customerName: "Skip", status: "open" },
    ];
    expect(packSlipJobs(orders).map((job) => job.title)).toEqual(["ORD-1", "ORD-2"]);
    expect(shippingLabelJobs(orders).map((job) => job.title)).toEqual(["ORD-2"]);
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

  it("offers pack slip and shipping label for a picked order", () => {
    const jobs = jobsForScan({
      kind: "order",
      order: { id: "o1", number: "ORD-DEMO1", customerName: "Harbor", status: "picked" },
    });
    expect(jobs.map((job) => job.kind)).toEqual(["pack-slip", "shipping-label"]);
    expect(jobs[0]?.href).toBe("/outbound/orders/o1/pack-slip");
  });

  it("returns nothing for a receipt scan", () => {
    expect(jobsForScan({ kind: "receipt" })).toEqual([]);
  });
});
