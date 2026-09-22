import { describe, expect, it } from "vitest";
import { endOfZonedDay, parseTimeZone, startOfZonedDay } from "./time-zone";
import {
  LIVE_IDLE_MS,
  LIVE_PACE_WINDOW_MS,
  buildLiveDay,
  orderWorkRemaining,
  scanBay,
  type LiveDayInput,
} from "./live";

const AS_OF = Date.UTC(2026, 8, 22, 15, 30, 0);

function input(overrides: Partial<LiveDayInput> = {}): LiveDayInput {
  return {
    asOf: AS_OF,
    timeZone: "America/Los_Angeles",
    garage: false,
    warehouse: { id: "wh", name: "Main" },
    members: [
      { userId: "maya", name: "Maya Chen" },
      { userId: "jordan", name: "Jordan Dock" },
    ],
    locations: [
      { id: "a", code: "A-01-01", posX: 2, posY: 3 },
      { id: "b", code: "DOCK", posX: 1, posY: 1 },
    ],
    touches: [],
    jobs: [],
    clocks: [],
    checkouts: [],
    orders: [],
    workOrders: [],
    kits: [],
    remaining: { receipts: 0, purchases: 0, asns: 0, rmas: 0, rtvs: 0, transfers: 0, replenishments: 0, counts: 0 },
    yards: [],
    trackers: [],
    ...overrides,
  };
}

describe("warehouse day", () => {
  it("starts at Los Angeles midnight, not UTC", () => {
    expect(parseTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(() => parseTimeZone("Not/AZone")).toThrow(/Invalid timezone/);
    expect(() => parseTimeZone("  ")).toThrow(/Invalid timezone/);

    const morning = Date.UTC(2026, 8, 22, 15, 30, 0);
    expect(startOfZonedDay(morning, "America/Los_Angeles")).toBe(Date.UTC(2026, 8, 22, 7, 0, 0));
    const stillYesterday = Date.UTC(2026, 8, 22, 6, 30, 0);
    expect(startOfZonedDay(stillYesterday, "America/Los_Angeles")).toBe(Date.UTC(2026, 8, 21, 7, 0, 0));
    expect(startOfZonedDay(morning, "UTC")).toBe(Date.UTC(2026, 8, 22, 0, 0, 0));
    expect(endOfZonedDay(morning, "America/Los_Angeles")).toBe(Date.UTC(2026, 8, 23, 7, 0, 0) - 1);
  });

  it("ignores ledger lines from before local midnight", () => {
    const day = buildLiveDay(
      input({
        touches: [
          { id: "old", at: Date.UTC(2026, 8, 22, 6, 30, 0), userId: "maya", qty: 9, flow: "outbound", bayId: "a", sku: "BASE", verb: "pick", refType: "order" },
          { id: "new", at: Date.UTC(2026, 8, 22, 8, 0, 0), userId: "maya", qty: 4, flow: "outbound", bayId: "a", sku: "BASE", verb: "pick", refType: "order" },
        ],
      }),
    );
    expect(day.dayStart).toBe(Date.UTC(2026, 8, 22, 7, 0, 0));
    expect(day.pulse.unitsDone).toBe(4);
    expect(day.activity.map((row) => row.id)).toEqual(["new"]);
  });
});

describe("live day", () => {
  it("keeps a person working at 8 minutes and idle one millisecond later", () => {
    const working = buildLiveDay(
      input({
        touches: [{ id: "t", at: AS_OF - LIVE_IDLE_MS, userId: "maya", qty: 1, flow: "outbound", bayId: "a", sku: "BASE", verb: "pick", refType: "order" }],
        jobs: [
          {
            id: "job",
            verb: "pick",
            refType: "order",
            refId: "ord",
            status: "claimed",
            number: "ORD-1",
            title: null,
            assigneeId: "maya",
            claimedAt: AS_OF - LIVE_IDLE_MS,
            dueAt: null,
            fromLocationId: "b",
          },
        ],
      }),
    );
    expect(working.people[0]?.state).toBe("working");
    expect(working.attention.map((row) => row.kind)).not.toContain("idle");

    const idle = buildLiveDay(
      input({
        touches: [{ id: "t", at: AS_OF - LIVE_IDLE_MS - 1, userId: "maya", qty: 1, flow: "outbound", bayId: "a", sku: "BASE", verb: "pick", refType: "order" }],
        jobs: [
          {
            id: "job",
            verb: "pick",
            refType: "order",
            refId: "ord",
            status: "claimed",
            number: "ORD-1",
            title: null,
            assigneeId: "maya",
            claimedAt: AS_OF - LIVE_IDLE_MS,
            dueAt: null,
            fromLocationId: "b",
          },
        ],
      }),
    );
    expect(idle.people[0]?.state).toBe("idle");
    expect(idle.attention[0]).toMatchObject({ kind: "idle", jobId: "job", title: "Maya Chen is idle on ORD-1" });
  });

  it("projects clear-by from the last hour after 15 minutes of work", () => {
    const paced = buildLiveDay(
      input({
        orders: [{ status: "packed", lines: [{ qty: 120, qtyPicked: 120, qtyPacked: 120 }] }],
        touches: [{ id: "t", at: AS_OF - LIVE_PACE_WINDOW_MS, userId: "maya", qty: 60, flow: "outbound", bayId: "a", sku: "BASE", verb: "ship", refType: "order" }],
      }),
    );
    expect(paced.pulse.unitsRemaining).toBe(120);
    expect(paced.pulse.pacePerHour).toBe(60);
    expect(paced.pulse.clearBy).toBe(AS_OF + 2 * LIVE_PACE_WINDOW_MS);

    const tooSoon = buildLiveDay(
      input({
        orders: [{ status: "open", lines: [{ qty: 10, qtyPicked: 0, qtyPacked: 0 }] }],
        touches: [{ id: "t", at: AS_OF - 5 * 60 * 1000, userId: "maya", qty: 10, flow: "outbound", bayId: "a", sku: "BASE", verb: "pick", refType: "order" }],
      }),
    );
    expect(tooSoon.pulse.pacePerHour).toBeNull();
    expect(tooSoon.pulse.clearBy).toBeNull();

    const clear = buildLiveDay(input());
    expect(clear.pulse.unitsRemaining).toBe(0);
    expect(clear.pulse.clearBy).toBe(AS_OF);
  });

  it("uses the latest scan bay, then the claimed job from-bay", () => {
    expect(scanBay({ type: "pick", fromLocationId: "a", toLocationId: "pack" })).toBe("a");
    expect(scanBay({ type: "receive", fromLocationId: null, toLocationId: "b" })).toBe("b");
    expect(scanBay({ type: "move", fromLocationId: "a", toLocationId: "b" })).toBe("b");
    expect(scanBay({ type: "ship", fromLocationId: null, toLocationId: "b" })).toBe("b");

    const day = buildLiveDay(
      input({
        touches: [
          { id: "early", at: AS_OF - 60_000, userId: "maya", qty: 1, flow: "outbound", bayId: "b", sku: "BASE", verb: "pick", refType: "order" },
          { id: "late", at: AS_OF - 1_000, userId: "maya", qty: 1, flow: "outbound", bayId: "a", sku: "SHADE", verb: "pick", refType: "order" },
        ],
        jobs: [
          {
            id: "job",
            verb: "pick",
            refType: "order",
            refId: "ord",
            status: "claimed",
            number: "ORD-1",
            title: null,
            assigneeId: "maya",
            claimedAt: AS_OF - 60_000,
            dueAt: null,
            fromLocationId: "b",
          },
        ],
      }),
    );
    expect(day.people[0]?.lastBay).toMatchObject({ locationId: "a", code: "A-01-01" });

    const fromJob = buildLiveDay(
      input({
        jobs: [
          {
            id: "job",
            verb: "pick",
            refType: "order",
            refId: "ord",
            status: "claimed",
            number: "ORD-1",
            title: null,
            assigneeId: "maya",
            claimedAt: AS_OF,
            dueAt: null,
            fromLocationId: "b",
          },
        ],
      }),
    );
    expect(fromJob.people[0]?.lastBay).toMatchObject({ locationId: "b", code: "DOCK" });
    expect(fromJob.people[0]?.state).toBe("idle");
  });

  it("ranks idle, then due work, then a late dock, then tracker exceptions", () => {
    const day = buildLiveDay(
      input({
        jobs: [
          {
            id: "claimed",
            verb: "pick",
            refType: "order",
            refId: "ord",
            status: "claimed",
            number: "ORD-1",
            title: null,
            assigneeId: "maya",
            claimedAt: AS_OF - LIVE_IDLE_MS - 1,
            dueAt: null,
            fromLocationId: "a",
          },
          {
            id: "due",
            verb: "pack",
            refType: "order",
            refId: "ord2",
            status: "open",
            number: "ORD-2",
            title: null,
            assigneeId: null,
            claimedAt: null,
            dueAt: AS_OF,
            fromLocationId: null,
          },
        ],
        yards: [
          {
            id: "yard",
            number: "YRD-1",
            status: "expected",
            carrierName: "UPS Freight",
            trailerNumber: "TRL-1",
            eta: AS_OF - 1,
            dockCode: "DOCK",
            checkedOutAt: null,
          },
        ],
        trackers: [{ orderId: "ord3", number: "ORD-3", packageId: "box", packageNumber: "BOX-1" }],
      }),
    );
    expect(day.attention.map((row) => row.kind)).toEqual(["idle", "due", "dock", "tracker"]);
    expect(day.attention[2]).toMatchObject({ title: "YRD-1 is still expected", detail: "UPS Freight · TRL-1" });
  });

  it("strips yard, ASN, replenish, counts, and equipment in Garage Mode", () => {
    const day = buildLiveDay(
      input({
        garage: true,
        members: [
          { userId: "maya", name: "Maya Chen" },
          { userId: "lift", name: "Lift Only" },
        ],
        remaining: { receipts: 5, purchases: 0, asns: 10, rmas: 0, rtvs: 0, transfers: 2, replenishments: 14, counts: 3 },
        touches: [
          { id: "recv", at: AS_OF - 1_000, userId: "maya", qty: 3, flow: "inbound", bayId: "b", sku: "LED", verb: "receive", refType: "receipt" },
          { id: "rpl", at: AS_OF - 1_000, userId: "lift", qty: 14, flow: "stock", bayId: "a", sku: "LED", verb: "replenish", refType: "replenishment" },
        ],
        jobs: [
          {
            id: "pick",
            verb: "pick",
            refType: "order",
            refId: "ord",
            status: "claimed",
            number: "ORD-1",
            title: null,
            assigneeId: "maya",
            claimedAt: AS_OF - 1_000,
            dueAt: null,
            fromLocationId: "a",
          },
          {
            id: "count",
            verb: "count",
            refType: "cycleCount",
            refId: "cnt",
            status: "claimed",
            number: "CNT-1",
            title: null,
            assigneeId: "lift",
            claimedAt: AS_OF,
            dueAt: null,
            fromLocationId: "a",
          },
        ],
        checkouts: [
          { operatorUserId: "maya", equipmentCode: "FL-01" },
          { operatorUserId: "lift", equipmentCode: "FL-02" },
        ],
        yards: [
          {
            id: "yard",
            number: "YRD-1",
            status: "expected",
            carrierName: "UPS Freight",
            trailerNumber: null,
            eta: AS_OF - 1,
            dockCode: null,
            checkedOutAt: null,
          },
        ],
      }),
    );
    expect(day.flows.map((flow) => flow.id)).toEqual(["inbound", "outbound", "make", "stock"]);
    expect(day.flows.find((flow) => flow.id === "inbound")?.remaining).toBe(5);
    expect(day.flows.find((flow) => flow.id === "stock")).toMatchObject({ done: 0, remaining: 2 });
    expect(day.pulse.unitsDone).toBe(3);
    expect(day.people.map((person) => person.userId)).toEqual(["maya"]);
    expect(day.people[0]?.equipmentCode).toBeNull();
    expect(day.attention.map((row) => row.kind)).not.toContain("dock");
  });

  it("counts an open order once at its current stage", () => {
    expect(orderWorkRemaining({ status: "open", lines: [{ qty: 4, qtyPicked: 1, qtyPacked: 0 }] })).toBe(4);
    expect(orderWorkRemaining({ status: "picked", lines: [{ qty: 4, qtyPicked: 4, qtyPacked: 1 }] })).toBe(3);
    expect(orderWorkRemaining({ status: "packed", lines: [{ qty: 4, qtyPicked: 4, qtyPacked: 4 }] })).toBe(4);
    expect(orderWorkRemaining({ status: "shipped", lines: [{ qty: 4, qtyPicked: 4, qtyPacked: 4 }] })).toBe(0);
  });
});
