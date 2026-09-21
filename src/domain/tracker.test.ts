import { describe, expect, it } from "vitest";
import {
  laggingTrackerStatus,
  normalizeTrackerStatus,
  parseTrackerWebhook,
  rollupOrderTracker,
  trackerHmacHex,
  trackerToFlight,
  verifyTrackerHmac,
  canRelabelException,
} from "./tracker";

describe("tracker status map", () => {
  it("maps EasyPost and ShipEngine statuses onto Traffic", () => {
    expect(normalizeTrackerStatus("pre_transit")).toBe("pre_transit");
    expect(normalizeTrackerStatus("IT")).toBe("in_transit");
    expect(normalizeTrackerStatus("out_for_delivery")).toBe("in_transit");
    expect(normalizeTrackerStatus("delivered")).toBe("delivered");
    expect(normalizeTrackerStatus("DE")).toBe("delivered");
    expect(normalizeTrackerStatus("failure")).toBe("exception");
    expect(normalizeTrackerStatus("return_to_sender")).toBe("exception");
    expect(normalizeTrackerStatus("cancelled")).toBe("exception");
    expect(trackerToFlight("pre_transit")).toBe("at_gate");
    expect(trackerToFlight("in_transit")).toBe("in_flight");
    expect(trackerToFlight("delivered")).toBe("arrived");
    expect(trackerToFlight("exception")).toBe("exception");
  });

  it("uses the lagging carton when rolling up an order", () => {
    expect(laggingTrackerStatus(["delivered", "in_transit"])).toBe("in_transit");
    expect(laggingTrackerStatus(["delivered", "delivered"])).toBe("delivered");
    expect(laggingTrackerStatus(["delivered", "failure"])).toBe("exception");
    expect(rollupOrderTracker([{ trackerStatus: "in_transit" }, { trackerStatus: null }])).toBeNull();
    expect(rollupOrderTracker([{ trackerStatus: "in_transit" }, { trackerStatus: "delivered" }])).toBe("in_transit");
    expect(rollupOrderTracker([{ trackerStatus: "failure" }, { trackerStatus: null }])).toBe("exception");
  });

  it("parses EasyPost, ShipEngine, and demo payloads", () => {
    expect(
      parseTrackerWebhook({
        id: "evt_1",
        result: { id: "trk_1", tracking_code: "EZ1000000001", status: "in_transit" },
      }),
    ).toEqual({
      provider: "easypost",
      trackingNumber: "EZ1000000001",
      status: "in_transit",
      eventId: "evt_1",
    });
    expect(
      parseTrackerWebhook({
        resource_url: "https://api.shipengine.com/v1/tracking?carrier_code=ups&tracking_number=1Z",
        resource_type: "API_TRACK",
        data: { tracking_number: "1Z999", status_code: "IT" },
      }),
    ).toMatchObject({
      provider: "shipengine",
      trackingNumber: "1Z999",
      status: "IT",
    });
    expect(parseTrackerWebhook({ trackingNumber: "RL-NYC001", status: "delivered", eventId: "demo-1" })).toEqual({
      provider: "demo",
      trackingNumber: "RL-NYC001",
      status: "delivered",
      eventId: "demo-1",
    });
  });

  it("lets shipped exceptions relabel and blocks everything else", () => {
    expect(
      canRelabelException({
        status: "shipped",
        trackerStatus: "exception",
        labelStatus: "purchased",
        trackingNumber: "RL-MIA001",
      }),
    ).toEqual({ ok: true });
    expect(
      canRelabelException({
        status: "shipped",
        trackerStatus: "failure",
        trackingNumber: "RL-MIA001",
      }),
    ).toEqual({ ok: true });
    expect(
      canRelabelException({
        status: "packed",
        trackerStatus: "in_transit",
        labelStatus: "purchased",
        trackingNumber: "RL-1",
      }),
    ).toMatchObject({ ok: false, code: "NOT_EXCEPTION" });
    expect(
      canRelabelException({
        status: "cancelled",
        trackerStatus: "exception",
        trackingNumber: "RL-1",
      }),
    ).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(
      canRelabelException({
        status: "shipped",
        trackerStatus: "exception",
        labelStatus: "none",
      }),
    ).toMatchObject({ ok: false, code: "NO_LABEL" });
  });

  it("verifies hex HMAC used by EasyPost-style tracker webhooks", async () => {
    const body = '{"result":{"tracking_code":"EZ1","status":"delivered"}}';
    const hex = await trackerHmacHex("whsec", body);
    expect(await verifyTrackerHmac("whsec", body, hex)).toBe(true);
    expect(await verifyTrackerHmac("whsec", body, `sha256=${hex}`)).toBe(true);
    expect(await verifyTrackerHmac("whsec", body, "deadbeef")).toBe(false);
    expect(await verifyTrackerHmac("whsec", body, undefined)).toBe(false);
  });
});
