import { describe, expect, it } from "vitest";
import {
  publicReturnLabelView,
  returnDestination,
  returnLabelBlock,
  returnLabelRefusal,
  returnLabelStatusLabel,
  returnLabelVoidBlock,
  type ReturnLabelPageInput,
} from "./return-label";

describe("return label rules", () => {
  it("sends returns to the return address, else the ship-from address", () => {
    expect(returnDestination({ returnAddress: "  Returns, 2 Yard Rd  ", shipFromAddress: "14 Dock St" })).toBe("Returns, 2 Yard Rd");
    expect(returnDestination({ returnAddress: " ", shipFromAddress: "14 Dock St" })).toBe("14 Dock St");
    expect(returnDestination({ returnAddress: null, shipFromAddress: null })).toBeNull();
    expect(returnDestination(null)).toBeNull();
  });

  it("buys return labels on demo accounts and the carriers that hand back a label link", () => {
    expect(returnLabelRefusal(null)).toBeNull();
    expect(returnLabelRefusal({ provider: "rackline", mode: "demo" })).toBeNull();
    expect(returnLabelRefusal({ provider: "ups", mode: "demo" })).toBeNull();
    expect(returnLabelRefusal({ provider: "easypost", mode: "live" })).toBeNull();
    expect(returnLabelRefusal({ provider: "shipengine", mode: "live" })).toBeNull();
    expect(returnLabelRefusal({ provider: "fedex", mode: "live" })).toBeNull();
    expect(returnLabelRefusal({ provider: "ups", mode: "live" })).toBe(
      "A direct UPS account cannot buy return labels in Rackline yet. Choose a service on EasyPost, ShipEngine, or FedEx.",
    );
    expect(returnLabelRefusal({ provider: "usps", mode: "live" })).toMatch(/^A direct USPS account/);
    expect(returnLabelRefusal({ provider: "dhl", mode: "live" })).toMatch(/^A direct DHL account/);
  });

  it("allows one live label per return, and none once it is received", () => {
    expect(returnLabelBlock({ rmaStatus: "open", hasActiveLabel: false })).toBeNull();
    expect(returnLabelBlock({ rmaStatus: "receiving", hasActiveLabel: false })).toBeNull();
    expect(returnLabelBlock({ rmaStatus: "open", hasActiveLabel: true })).toBe(
      "This return already has a label. Void it before buying another.",
    );
    expect(returnLabelBlock({ rmaStatus: "received", hasActiveLabel: false })).toBe(
      "This return is already received. It does not need a label.",
    );
  });

  it("voids a label until the carrier scans it", () => {
    expect(returnLabelVoidBlock({ status: "active", trackerStatus: null })).toBeNull();
    expect(returnLabelVoidBlock({ status: "active", trackerStatus: "pre_transit" })).toBeNull();
    expect(returnLabelVoidBlock({ status: "active", trackerStatus: "in_transit" })).toMatch(/already scanned/);
    expect(returnLabelVoidBlock({ status: "active", trackerStatus: "Delivered" })).toMatch(/already scanned/);
    expect(returnLabelVoidBlock({ status: "voided", trackerStatus: null })).toBe("This return label is already voided.");
  });

  it("reads tracker wording only once the carrier has sent an update", () => {
    expect(returnLabelStatusLabel({ status: "active", trackerStatus: null })).toBe("Label ready");
    expect(returnLabelStatusLabel({ status: "active", trackerStatus: "pre_transit" })).toBe("Label ready");
    expect(returnLabelStatusLabel({ status: "active", trackerStatus: "in_transit" })).toBe("In transit");
    expect(returnLabelStatusLabel({ status: "active", trackerStatus: "out_for_delivery" })).toBe("Out for delivery");
    expect(returnLabelStatusLabel({ status: "active", trackerStatus: "delivered" })).toBe("Delivered");
    expect(returnLabelStatusLabel({ status: "voided", trackerStatus: "in_transit" })).toBe("Voided");
  });
});

function page(overrides: Partial<ReturnLabelPageInput["label"]> = {}, receipts: ReturnLabelPageInput["receipts"] = []): ReturnLabelPageInput {
  return {
    shop: { name: "Northwind Makers", brandColor: "#0f766e", logoUrl: null },
    rmaNumber: "RMA-1001",
    label: {
      status: "active",
      carrierCompany: "Rackline",
      carrierService: "rackline_ground",
      trackingNumber: "RL-ABC123",
      trackingUrl: "https://track.example/RL-ABC123",
      labelUrl: null,
      trackerStatus: null,
      fromName: "Ada Park",
      fromAddress: "9 Bay Ave, Austin, TX 78701",
      toName: "Northwind Makers",
      toAddress: "14 Dock St, Portland, OR 97209",
      createdAt: 1_000,
      ...overrides,
    },
    items: [{ name: "Desk lamp", qty: 2 }],
    receipts,
  };
}

describe("public return label view", () => {
  it("shows the label, the two printed addresses, and a label-created step", () => {
    const view = publicReturnLabelView(page());
    expect(view).toMatchObject({
      rmaNumber: "RMA-1001",
      status: "active",
      statusLabel: "Ready to send",
      trackerStatus: null,
      label: {
        carrier: "Rackline",
        service: "Ground",
        trackingNumber: "RL-ABC123",
        from: { name: "Ada Park", address: "9 Bay Ave, Austin, TX 78701" },
        to: { name: "Northwind Makers", address: "14 Dock St, Portland, OR 97209" },
      },
      items: [{ name: "Desk lamp", qty: 2 }],
    });
    expect(view.events).toEqual([{ at: 1_000, status: "pre_transit", label: "Label created", message: null, place: null }]);
  });

  it("follows carrier updates", () => {
    const receipts = [
      { payloadJson: JSON.stringify({ tracking_number: "RL-ABC123", status: "in_transit", at: 5_000 }), createdAt: 5_000 },
    ];
    const view = publicReturnLabelView(page({ trackerStatus: "in_transit" }, receipts));
    expect(view.statusLabel).toBe("On its way back");
    expect(view.trackerStatus).toBe("in_transit");
    expect(view.events[0]).toMatchObject({ at: 5_000, status: "in_transit" });
    expect(view.events.at(-1)).toMatchObject({ status: "pre_transit", label: "Label created" });
  });

  it("hides the label, addresses, and history once voided", () => {
    const view = publicReturnLabelView(page({ status: "voided", trackerStatus: "pre_transit" }));
    expect(view).toMatchObject({ status: "voided", statusLabel: "Cancelled", label: null, events: [], trackerStatus: null });
  });

  it("drops links that are not web links and never carries internal fields", () => {
    const input = page({ labelUrl: "javascript:alert(1)", trackingUrl: "data:text/html,x" });
    const view = publicReturnLabelView({
      ...input,
      label: { ...input.label, postageCents: 812, carrierShipmentId: "shp_secret", createdBy: "user_1" } as ReturnLabelPageInput["label"],
    });
    expect(view.label?.labelUrl).toBeNull();
    expect(view.label?.trackingUrl).toBeNull();
    const text = JSON.stringify(view);
    expect(text).not.toContain("812");
    expect(text).not.toContain("shp_secret");
    expect(text).not.toContain("user_1");
  });
});
