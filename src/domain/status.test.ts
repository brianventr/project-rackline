import { describe, expect, it } from "vitest";
import {
  canPackOrder,
  canPickOrder,
  canShipOrder,
  isOpenOrder,
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

  it("labels in-progress statuses for people", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("open")).toBe("open");
    expect(statusLabel("draft")).toBe("draft");
  });
});
