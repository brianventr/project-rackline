import { describe, expect, it } from "vitest";
import {
  canCancelOrder,
  canPackOrder,
  canPickOrder,
  canUnpickOrder,
  canReceive,
  canReceivePurchase,
  canReceiveReturn,
  canPostVendorReturn,
  canShipOrder,
  canCompleteKit,
  canDekit,
  canPostReplenishment,
  canPostTransfer,
  canReleaseHold,
  canReleaseWave,
  canPickWave,
  canReceiveAsn,
  canCheckInYard,
  canCheckOutYard,
  isOpenOrder,
  isOpenPurchase,
  normalizeOrderStatus,
  statusLabel,
} from "./status";

describe("order status", () => {
  it("treats legacy draft as open", () => {
    expect(normalizeOrderStatus("draft")).toBe("open");
    expect(canPickOrder("draft")).toBe(true);
    expect(isOpenOrder("draft")).toBe(true);
  });

  it("stays packing until every picked unit is packed", () => {
    expect(canPackOrder("packing")).toBe(true);
    expect(canShipOrder("packing")).toBe(false);
    expect(canShipOrder("packed")).toBe(true);
  });

  it("stays open for picking until the ticket is filled", () => {
    expect(canPickOrder("picking")).toBe(true);
    expect(canPackOrder("picking")).toBe(false);
    expect(canShipOrder("picking")).toBe(false);
    expect(canPickOrder("picked")).toBe(false);
  });

  it("lets an unshipped ticket unpick or cancel", () => {
    expect(canUnpickOrder("picking")).toBe(true);
    expect(canUnpickOrder("packed")).toBe(true);
    expect(canUnpickOrder("open")).toBe(false);
    expect(canCancelOrder("picking")).toBe(true);
    expect(canCancelOrder("packed")).toBe(true);
    expect(canCancelOrder("shipped")).toBe(false);
    expect(canCancelOrder("cancelled")).toBe(false);
  });

  it("labels in-progress statuses for people", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("open")).toBe("open");
    expect(statusLabel("draft")).toBe("draft");
  });

  it("lets a purchase receive from draft through receiving", () => {
    expect(canReceivePurchase("draft")).toBe(true);
    expect(canReceivePurchase("ordered")).toBe(true);
    expect(canReceivePurchase("receiving")).toBe(true);
    expect(canReceivePurchase("received")).toBe(false);
    expect(isOpenPurchase("ordered")).toBe(true);
  });

  it("lets a vendor return post while open", () => {
    expect(canPostVendorReturn("open")).toBe(true);
    expect(canPostVendorReturn("returning")).toBe(true);
    expect(canPostVendorReturn("returned")).toBe(false);
  });

  it("lets a return receive while open", () => {
    expect(canReceiveReturn("open")).toBe(true);
    expect(canReceiveReturn("receiving")).toBe(true);
    expect(canReceiveReturn("received")).toBe(false);
  });

  it("lets a blank receipt receive from draft through receiving", () => {
    expect(canReceive("draft")).toBe(true);
    expect(canReceive("receiving")).toBe(true);
    expect(canReceive("received")).toBe(false);
  });

  it("posts transfers until every expected unit is moved", () => {
    expect(canPostTransfer("draft")).toBe(true);
    expect(canPostTransfer("in_progress")).toBe(true);
    expect(canPostTransfer("posted")).toBe(false);
  });

  it("posts replenishments like transfers and completes kits from draft", () => {
    expect(canPostReplenishment("draft")).toBe(true);
    expect(canPostReplenishment("in_progress")).toBe(true);
    expect(canPostReplenishment("posted")).toBe(false);
    expect(canCompleteKit("draft")).toBe(true);
    expect(canCompleteKit("in_progress")).toBe(true);
    expect(canCompleteKit("completed")).toBe(false);
    expect(canDekit("completed")).toBe(true);
    expect(canDekit("in_progress")).toBe(false);
    expect(canDekit("dekitted")).toBe(false);
  });

  it("releases holds while they are open", () => {
    expect(canReleaseHold("open")).toBe(true);
    expect(canReleaseHold("released")).toBe(false);
  });

  it("releases waves from draft and receives ASNs while open", () => {
    expect(canReleaseWave("draft")).toBe(true);
    expect(canReleaseWave("released")).toBe(false);
    expect(canPickWave("released")).toBe(true);
    expect(canReceiveAsn("expected")).toBe(true);
    expect(canReceiveAsn("received")).toBe(false);
    expect(canCheckInYard("expected")).toBe(true);
    expect(canCheckOutYard("at_dock")).toBe(true);
    expect(statusLabel("checked_in")).toBe("Checked in");
  });
});
