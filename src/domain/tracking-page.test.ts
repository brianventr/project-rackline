import { describe, expect, it } from "vitest";
import {
  placeLine,
  publicTrackingView,
  trackerHistory,
  trackerStatusLabel,
  type TrackerReceipt,
  type TrackingPageInput,
} from "./tracking-page";

const easyPostReceipt: TrackerReceipt = {
  createdAt: Date.parse("2026-09-30T18:00:00Z"),
  payloadJson: JSON.stringify({
    id: "evt_1",
    object: "Event",
    description: "tracker.updated",
    result: {
      object: "Tracker",
      tracking_code: "1Z999",
      status: "out_for_delivery",
      est_delivery_date: "2026-10-01T20:00:00Z",
      tracking_details: [
        {
          datetime: "2026-09-29T15:00:00Z",
          status: "pre_transit",
          message: "Shipping label created",
          tracking_location: { city: null, state: null, country: null, zip: null },
        },
        {
          datetime: "2026-09-30T09:00:00Z",
          status: "in_transit",
          message: "Departed facility",
          tracking_location: { city: "SAN FRANCISCO", state: "CA", country: "US", zip: "94107" },
        },
        {
          datetime: "2026-10-01T07:00:00Z",
          status: "out_for_delivery",
          message: "Out for delivery",
          tracking_location: { city: "PORTLAND", state: "OR", country: "US", zip: "97209" },
        },
      ],
    },
  }),
};

const shipEngineReceipt: TrackerReceipt = {
  createdAt: Date.parse("2026-09-30T18:00:00Z"),
  payloadJson: JSON.stringify({
    resource_url: "https://api.shipengine.com/v1/tracking?carrier_code=ups&tracking_number=1Z777",
    resource_type: "API_TRACK",
    data: {
      tracking_number: "1Z777",
      status_code: "DE",
      estimated_delivery_date: "2026-10-02T00:00:00Z",
      events: [
        {
          occurred_at: "2026-09-30T10:00:00Z",
          description: "Arrived at facility",
          city_locality: "Reno",
          state_province: "NV",
          postal_code: "89501",
          country_code: "US",
          status_code: "IT",
        },
        {
          occurred_at: "2026-10-01T16:30:00Z",
          description: "Delivered, front door",
          city_locality: "Boise",
          state_province: "ID",
          postal_code: "83702",
          country_code: "US",
          status_code: "DE",
        },
      ],
    },
  }),
};

describe("tracker history", () => {
  it("reads EasyPost tracking details, newest first, with the estimate", () => {
    const history = trackerHistory([easyPostReceipt]);
    expect(history.events.map((event) => event.label)).toEqual(["Out for delivery", "In transit", "Label created"]);
    expect(history.events[1]).toMatchObject({ place: "San Francisco, CA, US", message: "Departed facility" });
    expect(history.estimatedDeliveryAt).toBe(Date.parse("2026-10-01T20:00:00Z"));
  });

  it("reads ShipEngine events and never keeps the postcode", () => {
    const history = trackerHistory([shipEngineReceipt]);
    expect(history.events[0]).toMatchObject({ status: "delivered", label: "Delivered", place: "Boise, ID, US" });
    expect(JSON.stringify(history)).not.toContain("83702");
  });

  it("turns demo updates into one event each and drops repeats of a full history", () => {
    const demo = [
      { createdAt: 1_000, payloadJson: JSON.stringify({ trackingNumber: "RL-1", status: "in_transit", eventId: "a" }) },
      { createdAt: 2_000, payloadJson: JSON.stringify({ trackingNumber: "RL-1", status: "delivered", eventId: "b" }) },
      { createdAt: 3_000, payloadJson: "not json" },
    ];
    expect(trackerHistory(demo).events.map((event) => [event.at, event.status])).toEqual([
      [2_000, "delivered"],
      [1_000, "in_transit"],
    ]);
    expect(trackerHistory([easyPostReceipt, { ...easyPostReceipt, createdAt: easyPostReceipt.createdAt + 1 }]).events).toHaveLength(3);
  });

  it("labels raw carrier statuses", () => {
    expect(trackerStatusLabel("AT")).toBe("Delivery attempted");
    expect(trackerStatusLabel("return_to_sender")).toBe("Returning to sender");
    expect(trackerStatusLabel("IT")).toBe("In transit");
    expect(trackerStatusLabel("mystery")).toBeNull();
  });
});

describe("place line", () => {
  it("keeps city, region, and country but never a street or postcode", () => {
    expect(placeLine("Portland", "OR", "US")).toBe("Portland, OR, US");
    expect(placeLine("1 Main St, Austin", "TX", "US")).toBe("Austin, TX, US");
    expect(placeLine("12 Test St, Portland, OR 97205", null, "US")).toBe("Portland, US");
    expect(placeLine("London", "ENG", "GB")).toBe("London, ENG, GB");
    expect(placeLine("Portland", "OR 97205", "US")).toBe("Portland, OR, US");
    expect(placeLine(null, null, null)).toBeNull();
  });
});

function baseInput(overrides: Partial<TrackingPageInput> = {}): TrackingPageInput {
  return {
    shop: { name: "Northwind Makers", brandColor: "#1f6feb", logoUrl: "https://cdn.example.com/logo.png" },
    order: {
      number: "#1004",
      status: "shipped",
      shippedAt: Date.parse("2026-09-29T14:00:00Z"),
      shipToCity: "Portland",
      shipToRegion: "OR",
      shipToCountry: "US",
      trackingNumber: "1Z999",
      trackingCompany: "UPS",
      trackingUrl: "https://www.ups.com/track?tracknum=1Z999",
      carrierService: "ups_ground",
      trackerStatus: "in_transit",
    },
    packages: [],
    items: [{ name: "Walnut desk organizer", qty: 2 }],
    receiptsByTracking: new Map([["1Z999", [easyPostReceipt]]]),
    ...overrides,
  };
}

describe("public tracking view", () => {
  it("shows one parcel with carrier, service, link, timeline, and estimate", () => {
    const view = publicTrackingView(baseInput());
    expect(view.shop).toEqual({ name: "Northwind Makers", brandColor: "#1f6feb", logoUrl: "https://cdn.example.com/logo.png" });
    expect(view.order).toMatchObject({ number: "#1004", status: "shipped", destination: "Portland, OR, US" });
    expect(view.packages).toHaveLength(1);
    const [pkg] = view.packages;
    expect(pkg).toMatchObject({
      label: "Package",
      carrier: "UPS",
      service: "UPS Ground",
      trackingNumber: "1Z999",
      trackingUrl: "https://www.ups.com/track?tracknum=1Z999",
      status: "in_transit",
      statusLabel: "Out for delivery",
      estimatedDeliveryAt: Date.parse("2026-10-01T20:00:00Z"),
      deliveredAt: null,
    });
    expect(pkg!.events.at(-1)).toMatchObject({ label: "Shipped", at: Date.parse("2026-09-29T14:00:00Z") });
    expect(pkg!.items).toEqual([{ name: "Walnut desk organizer", qty: 2 }]);
  });

  it("lists each shipped carton with its own items and drops unsent ones", () => {
    const view = publicTrackingView(
      baseInput({
        packages: [
          { ...parcel("1Z999", "in_transit"), items: [{ name: "Desk organizer", qty: 1 }] },
          { ...parcel("1Z777", "delivered"), items: [{ name: "Pen tray", qty: 1 }] },
          { ...parcel(null, null), shippedAt: null, items: [{ name: "Not yet", qty: 1 }] },
        ],
        receiptsByTracking: new Map([
          ["1Z999", [easyPostReceipt]],
          ["1Z777", [shipEngineReceipt]],
        ]),
      }),
    );
    expect(view.packages.map((row) => row.label)).toEqual(["Package 1 of 2", "Package 2 of 2"]);
    expect(view.packages[1]).toMatchObject({ status: "delivered", deliveredAt: Date.parse("2026-10-01T16:30:00Z"), estimatedDeliveryAt: null });
    expect(view.packages[1]!.items).toEqual([{ name: "Pen tray", qty: 1 }]);
  });

  it("calls the order delivered once every parcel is", () => {
    const view = publicTrackingView(baseInput({ order: { ...baseInput().order, trackerStatus: "delivered" }, receiptsByTracking: new Map() }));
    expect(view.order.status).toBe("delivered");
    expect(view.packages[0]!.statusLabel).toBe("Delivered");
  });

  it("says it is getting ready before anything ships", () => {
    const view = publicTrackingView(
      baseInput({
        order: { ...baseInput().order, status: "packed", shippedAt: null, trackingNumber: null, trackerStatus: null },
      }),
    );
    expect(view.order.status).toBe("processing");
    expect(view.packages).toEqual([]);
  });

  it("never carries ids, costs, the street, or the postcode", () => {
    const input = baseInput();
    const leaky = {
      ...input,
      order: {
        ...input.order,
        id: "order-uuid-123",
        organizationId: "org-uuid-456",
        postageCents: 1234,
        shipToAddress: "88 Harbor Ave\nPortland, OR 97209",
        customerName: "Ada Lovelace",
      },
    } as TrackingPageInput;
    const json = JSON.stringify(publicTrackingView(leaky));
    for (const secret of ["order-uuid-123", "org-uuid-456", "88 Harbor", "97209", "Ada", "postage", "organizationId"]) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toMatch(/\b1234\b/);
  });

  it("drops tracking links that are not web links", () => {
    const view = publicTrackingView(baseInput({ order: { ...baseInput().order, trackingUrl: "javascript:alert(1)" } }));
    expect(view.packages[0]!.trackingUrl).toBeNull();
  });
});

function parcel(trackingNumber: string | null, trackerStatus: string | null) {
  return {
    trackingNumber,
    trackingCompany: "UPS",
    trackingUrl: trackingNumber ? `https://www.ups.com/track?tracknum=${trackingNumber}` : null,
    carrierService: "ups_ground",
    trackerStatus,
    shippedAt: Date.parse("2026-09-29T14:00:00Z"),
  };
}
