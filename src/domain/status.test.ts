import { describe, expect, it } from "vitest";
import {
  canPackOrder,
  canPickOrder,
  canReceive,
  canReceivePurchase,
  canReceiveReturn,
  canShipOrder,
  canCompleteKit,
  canPostReplenishment,
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

  it("requires pack before ship", () => {
    expect(canPackOrder("picked")).toBe(true);
    expect(canShipOrder("picked")).toBe(false);
    expect(canShipOrder("packed")).toBe(true);
  });

  it("stays open for picking until the ticket is filled", () => {
    expect(canPickOrder("picking")).toBe(true);
    expect(canPackOrder("picking")).toBe(false);
    expect(canShipOrder("picking")).toBe(false);
    expect(canPickOrder("picked")).toBe(false);
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

  it("posts replenishments like transfers and completes kits from draft", () => {
    expect(canPostReplenishment("draft")).toBe(true);
    expect(canPostReplenishment("in_progress")).toBe(true);
    expect(canPostReplenishment("posted")).toBe(false);
    expect(canCompleteKit("draft")).toBe(true);
    expect(canCompleteKit("completed")).toBe(false);
  });
});
