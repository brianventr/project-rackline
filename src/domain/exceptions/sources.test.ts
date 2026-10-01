import { describe, expect, it } from "vitest";
import type { CarrierConnectionLike } from "../carriers";
import type { ShipRule } from "../ship-rules";
import { backorderProblems } from "./backorder";
import { capacityProblems } from "./capacity";
import { carrierProblems, type CarrierEventRow } from "./carrier";
import { channelSyncProblems } from "./channel-sync";
import { countProblems } from "./count";
import { ediProblems } from "./edi";
import { holdProblems, type HoldRow } from "./hold";
import { DAY_MS } from "./inbox";
import { postBackProblems, type PostBackRow } from "./post-back";
import { shipRuleProblems, type ShipRuleOrderRow } from "./ship-rule";
import { shopifyFulfillmentProblems, shopifyStockPushProblem, STOCK_PUSH_KEY } from "./shopify";
import { isReturnToSender, trackerProblem, trackerProblems, trackerRawStatus, type TrackerRow } from "./tracker";

const NOW = 1_800_000_000_000;

describe("shipRuleProblems", () => {
  const rackline: CarrierConnectionLike = {
    id: "conn-rl",
    provider: "rackline",
    nickname: "Rackline",
    mode: "demo",
    enabledServicesJson: '["rackline_ground"]',
    isDefault: true,
  };
  const rule = (overrides: Partial<ShipRule>): ShipRule => ({
    id: "r1",
    name: "Fragile",
    position: 0,
    enabled: true,
    warehouseId: null,
    conditions: {},
    presetId: null,
    carrierService: null,
    carrierConnectionId: null,
    rateStrategy: null,
    hold: false,
    ...overrides,
  });
  const order = (overrides: Partial<ShipRuleOrderRow>): ShipRuleOrderRow => ({
    id: "o1",
    number: "SO-1",
    customerName: "Ada",
    warehouseId: "wh1",
    source: "manual",
    shipToAddress: null,
    shipToRegion: null,
    shipToCountry: null,
    packageWeightOz: null,
    carrierService: null,
    carrierConnectionId: null,
    createdAt: 100,
    hasLabel: false,
    lines: [{ sku: "VASE", qty: 1, shipWeightOz: 20 }],
    ...overrides,
  });

  it("lists each order a hold rule matches, with ship anyway", () => {
    const items = shipRuleProblems({
      orders: [order({}), order({ id: "o2", number: "SO-2", lines: [{ sku: "MUG", qty: 1, shipWeightOz: 8 }] })],
      rules: [rule({ hold: true, conditions: { skus: ["VASE"] } })],
      connections: [rackline],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "ship-rule",
      key: "o1",
      kind: "rule_hold",
      severity: "blocking",
      title: "Order SO-1 is held by rule “Fragile”",
      orderId: "o1",
      warehouseId: "wh1",
      link: "/outbound/orders/o1",
      action: { id: "ship-anyway", label: "Ship anyway" },
    });
  });

  it("follows first match: an earlier rule without a hold wins", () => {
    const items = shipRuleProblems({
      orders: [order({})],
      rules: [rule({ id: "r0", name: "Everything", position: 0 }), rule({ position: 1, hold: true })],
      connections: [rackline],
    });
    expect(items).toEqual([]);
  });

  it("groups orders a broken rule stops into one owner problem", () => {
    const items = shipRuleProblems({
      orders: [order({ id: "o2", number: "SO-2", createdAt: 200 }), order({ createdAt: 100 }), order({ id: "o3", number: "SO-3", hasLabel: true })],
      rules: [rule({ name: "Rush", carrierService: "ups_next_day", hold: true })],
      connections: [rackline],
    });
    expect(items.map((row) => `${row.kind}:${row.key}`)).toEqual(["rule_hold:o3", "rule_service:rule.r1"]);
    const broken = items[1]!;
    expect(broken).toMatchObject({
      title: "Rule “Rush” is stopping 2 orders",
      ownerOnly: true,
      link: "/setup/shipping-rules",
      createdAt: 100,
      orderId: null,
      action: null,
    });
    expect(broken.detail).toContain("Waiting: SO-1 and SO-2.");
  });
});

describe("backorderProblems", () => {
  it("says who is still owed what", () => {
    const [row] = backorderProblems([
      {
        id: "bo1",
        number: "SO-1-BO1",
        parentId: "o1",
        parentNumber: "SO-1",
        customerName: "Ada",
        warehouseId: "wh1",
        createdAt: 50,
        units: 3,
        skus: ["MUG", "VASE"],
      },
    ]);
    expect(row).toMatchObject({
      source: "backorder",
      key: "bo1",
      severity: "warning",
      title: "Ada is still owed 3 units on SO-1-BO1",
      orderId: "bo1",
      link: "/outbound/orders/bo1",
      createdAt: 50,
    });
    expect(row!.detail).toContain("Order SO-1 shipped short, so SO-1-BO1 holds what is left (MUG and VASE).");
  });
});

describe("postBackProblems", () => {
  const base: PostBackRow = {
    id: "o1",
    number: "SO-1",
    source: "etsy",
    status: "shipped",
    channelSyncStatus: "failed",
    channelSyncError: "token expired",
    customerName: "Ada",
    warehouseId: "wh1",
    shippedAt: 70,
    createdAt: 10,
  };

  it("lists failed post-backs a retry can fix", () => {
    const [row] = postBackProblems([base]);
    expect(row).toMatchObject({
      key: "o1",
      kind: "post_back_failed",
      title: "Etsy was not told order SO-1 shipped",
      createdAt: 70,
      action: { id: "retry-post-back" },
    });
    expect(row!.detail.startsWith("Token expired. Ada gets no tracking from Etsy")).toBe(true);
  });

  it("skips manual post-backs, other channels, and unshipped orders", () => {
    expect(
      postBackProblems([
        { ...base, channelSyncStatus: "manual" },
        { ...base, source: "faire" },
        { ...base, status: "packed" },
      ]),
    ).toEqual([]);
  });
});

describe("shopify problems", () => {
  it("lists a failed fulfillment with a retry", () => {
    const [row] = shopifyFulfillmentProblems([
      {
        id: "o1",
        number: "SO-1",
        shopifyOrderName: "#1001",
        customerName: "Ada",
        warehouseId: "wh1",
        shopifySyncError: "Fulfillment order is closed",
        shippedAt: 40,
        createdAt: 10,
      },
    ]);
    expect(row).toMatchObject({ key: "order.o1", kind: "fulfillment_failed", createdAt: 40, action: { id: "retry-shopify" } });
    expect(row!.detail).toContain("Order SO-1 (#1001 in Shopify) still reads unfulfilled");
  });

  it("turns the run of failed stock pushes at the top into one owner problem", () => {
    const item = shopifyStockPushProblem([
      { status: "failed", responseJson: '{"error":"Access denied","code":"SHOPIFY_TOKEN"}', createdAt: 300 },
      { status: "failed", responseJson: '{"errors":[{"message":"Throttled"}]}', createdAt: 200 },
      { status: "ok", responseJson: null, createdAt: 100 },
      { status: "failed", responseJson: null, createdAt: 50 },
    ]);
    expect(item).toMatchObject({ key: STOCK_PUSH_KEY, createdAt: 200, ownerOnly: true, warehouseId: null, action: { id: "push-shopify-stock" } });
    expect(item!.detail.startsWith("Access denied. The last 2 pushes failed.")).toBe(true);
  });

  it("clears once the newest push worked, and reads GraphQL errors", () => {
    expect(shopifyStockPushProblem([{ status: "ok", responseJson: null, createdAt: 2 }, { status: "failed", responseJson: null, createdAt: 1 }])).toBeNull();
    expect(shopifyStockPushProblem([])).toBeNull();
    const item = shopifyStockPushProblem([{ status: "failed", responseJson: '{"errors":[{"message":"Throttled"}]}', createdAt: 1 }]);
    expect(item!.detail.startsWith("Throttled. Shopify may sell")).toBe(true);
  });
});

describe("carrierProblems", () => {
  let seq = 0;
  const event = (overrides: Partial<CarrierEventRow>): CarrierEventRow => ({
    id: `e${(seq += 1)}`,
    orderId: "o1",
    orderNumber: "SO-1",
    orderStatus: "packed",
    warehouseId: "wh1",
    kind: "buy",
    status: "failed",
    requestJson: "{}",
    responseJson: '{"error":"address not found"}',
    createdAt: 100,
    ...overrides,
  });

  it("keeps a run of failed buys open, dated from its first failure", () => {
    const items = carrierProblems([event({ createdAt: 300 }), event({ createdAt: 200 })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "buy.o1", kind: "label_buy_failed", createdAt: 200, orderId: "o1" });
    expect(items[0]!.detail).toBe("Address not found. It failed 2 times. Fix what it says on the order, then buy the label again.");
  });

  it("clears a failed buy once a later buy works or the order ships or is cancelled", () => {
    expect(carrierProblems([event({ createdAt: 100 }), event({ status: "ok", createdAt: 200 })])).toEqual([]);
    expect(carrierProblems([event({ orderStatus: "shipped" })])).toEqual([]);
    expect(carrierProblems([event({ orderStatus: "cancelled" })])).toEqual([]);
    const again = carrierProblems([event({ createdAt: 100 }), event({ status: "ok", createdAt: 200 }), event({ createdAt: 300 })]);
    expect(again.map((row) => row.createdAt)).toEqual([300]);
  });

  it("matches a failed void to a later void of the same box", () => {
    const failed = event({ kind: "void", requestJson: '{"packageId":"p1"}', createdAt: 100 });
    expect(carrierProblems([failed, event({ kind: "void", status: "ok", requestJson: '{"packageId":"p2"}', createdAt: 200 })]).map((row) => row.key)).toEqual([
      "void.o1.p1",
    ]);
    expect(carrierProblems([failed, event({ kind: "void", status: "ok", requestJson: '{"packageId":"p1"}', createdAt: 200 })])).toEqual([]);
    expect(carrierProblems([{ ...failed, orderStatus: "cancelled" }]).map((row) => row.kind)).toEqual(["label_void_failed"]);
  });

  it("keeps a replaced label that did not void until someone resolves it", () => {
    const items = carrierProblems([
      event({ kind: "void", requestJson: '{"packageId":"p1","relabel":true}', createdAt: 100, orderStatus: "shipped" }),
      event({ kind: "void", status: "ok", requestJson: '{"packageId":"p1"}', createdAt: 200, orderStatus: "shipped" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "old_label_not_voided", createdAt: 100 });
    expect(items[0]!.key.startsWith("replaced.")).toBe(true);
  });

  it("ignores rate and tracker events", () => {
    expect(carrierProblems([event({ kind: "rates" }), event({ kind: "tracker" })])).toEqual([]);
  });

  it("keeps a return-label buy or void that was logged on an already shipped order", () => {
    const buy = event({
      orderStatus: "shipped",
      requestJson: '{"returnLabel":true,"rmaId":"rma1"}',
      responseJson: '{"error":"address not found"}',
    });
    const [item] = carrierProblems([buy]);
    expect(item).toMatchObject({
      kind: "return_label_buy_failed",
      link: "/outbound/returns/rma1",
      title: "The carrier would not sell a return label for order SO-1",
    });
    const voided = event({
      kind: "void",
      orderStatus: "shipped",
      requestJson: '{"returnLabel":true,"rmaId":"rma1","returnLabelId":"lbl1"}',
      responseJson: '{"error":"already scanned"}',
    });
    expect(carrierProblems([voided])[0]).toMatchObject({ kind: "return_label_void_failed", link: "/outbound/returns/rma1" });
    expect(carrierProblems([event({ orderStatus: "shipped" })])).toEqual([]);
  });
});

describe("tracker problems", () => {
  const row = (overrides: Partial<TrackerRow>): TrackerRow => ({
    orderId: "o1",
    orderNumber: "SO-1",
    customerName: "Ada",
    warehouseId: "wh1",
    packageId: null,
    packageNumber: null,
    trackingNumber: "1Z999",
    trackerStatus: "exception",
    trackerUpdatedAt: NOW - DAY_MS,
    ...overrides,
  });

  it("reads the carrier's own word from a stored webhook", () => {
    expect(trackerRawStatus(JSON.stringify({ tracking_number: "1Z999", status: "return_to_sender" }))).toBe("return_to_sender");
    expect(trackerRawStatus(JSON.stringify({ result: { tracking_code: "EZ1", status: "returned" } }))).toBe("returned");
    expect(trackerRawStatus("not json")).toBeNull();
    expect(isReturnToSender("Return To Sender")).toBe(true);
    expect(isReturnToSender("return-to-sender")).toBe(true);
    expect(isReturnToSender("failure")).toBe(false);
  });

  it("tells a return from other delivery exceptions", () => {
    expect(trackerProblem(row({}), "return_to_sender", NOW)).toMatchObject({
      key: "order.o1",
      kind: "return_to_sender",
      severity: "blocking",
      title: "Order SO-1 is going back to the sender",
    });
    const other = trackerProblem(row({ packageId: "p1", packageNumber: "BOX-2" }), "undeliverable", NOW)!;
    expect(other).toMatchObject({ key: "package.p1", kind: "delivery_exception", severity: "warning", title: "BOX-2 on order SO-1 hit a delivery problem" });
    expect(other.detail).toContain("The carrier says: undeliverable.");
  });

  it("flags parcels with no news for five days before delivery", () => {
    const stuck = trackerProblem(row({ trackerStatus: "in_transit", trackerUpdatedAt: NOW - 6 * DAY_MS }), null, NOW);
    expect(stuck).toMatchObject({ kind: "stuck_in_transit", title: "Order SO-1 has had no tracking news for 6 days", createdAt: NOW - 6 * DAY_MS });
    expect(trackerProblem(row({ trackerStatus: "in_transit", trackerUpdatedAt: NOW - 4 * DAY_MS }), null, NOW)).toBeNull();
    expect(trackerProblem(row({ trackerStatus: "delivered", trackerUpdatedAt: NOW - 9 * DAY_MS }), null, NOW)).toBeNull();
    expect(trackerProblem(row({ trackerStatus: "pre_transit", trackerUpdatedAt: NOW - 5 * DAY_MS }), null, NOW)?.detail).toContain(
      "The carrier has not scanned it since the label was made",
    );
  });

  it("looks up each row's raw status by tracking number", () => {
    const items = trackerProblems([row({}), row({ orderId: "o2", trackingNumber: "1Z888" })], new Map([["1Z999", "returned"]]), NOW);
    expect(items.map((item) => item.kind)).toEqual(["return_to_sender", "delivery_exception"]);
  });
});

describe("countProblems", () => {
  it("lists posted counts that found a difference, biggest first", () => {
    const items = countProblems([
      {
        id: "cc1",
        number: "CC-1",
        warehouseId: "wh1",
        locationId: "loc1",
        locationCode: "A-01",
        postedAt: 500,
        lines: [
          { sku: "MUG", systemQty: 10, countedQty: 12 },
          { sku: "VASE", systemQty: 8, countedQty: 3 },
          { sku: "BOWL", systemQty: 4, countedQty: 4 },
        ],
      },
      { id: "cc2", number: "CC-2", warehouseId: "wh1", locationId: "loc2", locationCode: "A-02", postedAt: 600, lines: [{ sku: "MUG", systemQty: 1, countedQty: 1 }] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "cc1",
      severity: "info",
      lane: "floor",
      title: "Count CC-1 changed stock at A-01",
      link: "/stock/counts/cc1",
      floorLink: "/floor/count?location=loc1",
      createdAt: 500,
    });
    expect(items[0]!.detail.startsWith("VASE -5 and MUG +2.")).toBe(true);
  });
});

describe("holdProblems", () => {
  const hold: HoldRow = {
    id: "h1",
    number: "HLD-1",
    reason: "QC",
    notes: "dented boxes",
    warehouseId: "wh1",
    locationId: "loc1",
    locationCode: "A-01",
    itemId: "i1",
    sku: "MUG",
    lotCode: null,
    createdAt: 10,
  };

  it("links Manufacturer to the hold and the floor hold screen", () => {
    const [row] = holdProblems([hold], "warehouse");
    expect(row).toMatchObject({
      title: "MUG @ A-01 is on hold: QC",
      link: "/stock/holds/h1",
      floorLink: "/floor/hold?id=h1",
      lane: "floor",
      action: { id: "release-hold" },
    });
    expect(row!.detail).toContain("Note: Dented boxes.");
  });

  it("links Garage to the item or bay, since it has no hold screens", () => {
    expect(holdProblems([hold], "garage")[0]).toMatchObject({ link: "/stock/items/i1", floorLink: null });
    expect(holdProblems([{ ...hold, itemId: null, sku: null }], "garage")[0]).toMatchObject({ link: "/stock/locations/loc1", title: "A-01 is on hold: QC" });
  });
});

describe("ediProblems", () => {
  it("names the ASN and vendor when the refused body has them", () => {
    const [named, bare] = ediProblems([
      { id: "e1", error: "SKU WIDGET not in catalog", createdAt: 5, vendorName: " Acme ", reference: "PO-9" },
      { id: "e2", error: null, createdAt: 6, vendorName: 42, reference: null },
    ]);
    expect(named).toMatchObject({ title: "ASN PO-9 from Acme was refused", ownerOnly: true, warehouseId: null, link: "/setup/edi" });
    expect(named!.detail.startsWith("SKU WIDGET not in catalog.")).toBe(true);
    expect(bare).toMatchObject({ title: "An ASN was refused" });
  });
});

describe("capacityProblems", () => {
  it("lists bays past a limit, with the override that filled them", () => {
    const items = capacityProblems([
      {
        locationId: "loc1",
        code: "A-01",
        barcode: "LOC-A01",
        warehouseId: "wh1",
        capacity: { maxQty: 60, maxWeightOz: null, maxVolumeCuIn: null },
        usage: { qty: 72, weightOz: 0, volumeCuIn: 0 },
        overriddenAt: 900,
      },
      {
        locationId: "loc2",
        code: "A-02",
        barcode: "LOC-A02",
        warehouseId: "wh1",
        capacity: { maxQty: 60, maxWeightOz: null, maxVolumeCuIn: null },
        usage: { qty: 60, weightOz: 0, volumeCuIn: 0 },
        overriddenAt: null,
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "loc1", createdAt: 900, lane: "floor", floorLink: "/floor/putaway?from=LOC-A01" });
    expect(items[0]!.detail.startsWith("It holds 72 units, over its limit of 60 units. An owner overrode the limit to fill it.")).toBe(true);
  });
});

describe("channelSyncProblems", () => {
  it("lists a broken pull as a blocking owner problem with sync now", () => {
    const [row] = channelSyncProblems([
      { id: "c1", channel: "woocommerce", externalShop: "shop.example", warehouseId: null, lastSyncError: "401 unauthorized", lastSyncAt: 70, createdAt: 10 },
    ]);
    expect(row).toMatchObject({
      key: "woocommerce",
      severity: "blocking",
      title: "WooCommerce orders are not coming in",
      ownerOnly: true,
      createdAt: 70,
      action: { id: "sync-channel" },
    });
    expect(row!.detail.startsWith("401 unauthorized. New WooCommerce (shop.example) orders")).toBe(true);
  });
});
