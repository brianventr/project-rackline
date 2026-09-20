import { describe, expect, it } from "vitest";
import { buildLabelPayload, zplBayLabel, zplItemLabel, zplShippingLabel } from "./zpl";

describe("zpl labels", () => {
  it("builds bay and item Code 128 labels", () => {
    const bay = zplBayLabel({ code: "A-01-01", name: "Pick face", barcode: "A-01-01" });
    expect(bay).toContain("^XA");
    expect(bay).toContain("^XZ");
    expect(bay).toContain("A-01-01");
    expect(bay).toContain("^BCN");

    const item = zplItemLabel({ sku: "LAMP", name: "Desk lamp", barcode: "LAMP" });
    expect(item).toContain("LAMP");
    expect(item).toContain("Desk lamp");
  });

  it("builds a 4x6 shipping label with tracking", () => {
    const zpl = zplShippingLabel({
      orderNumber: "ORD-DEMO1",
      customerName: "Acme",
      shipToAddress: "1 Main St\nAustin TX",
      carrierCompany: "Rackline",
      carrierService: "Ground",
      trackingNumber: "RL-ABCDEF1234",
    });
    expect(zpl).toContain("RL-ABCDEF1234");
    expect(zpl).toContain("ORD-DEMO1");
    expect(zpl).toContain("Acme");
  });

  it("routes buildLabelPayload by kind", () => {
    const payload = buildLabelPayload("item", { sku: "SHADE", name: "Shade", barcode: "SHADE" }, "2x1");
    expect(payload.format).toBe("zpl");
    expect(payload.filename).toBe("SHADE.zpl");
    expect(payload.body).toContain("SHADE");
  });
});
