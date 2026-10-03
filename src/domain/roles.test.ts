import { describe, expect, it } from "vitest";
import { requestDenied, rolePageRedirect } from "./roles";

describe("roles", () => {
  it("keeps the picker off cost, vendors, and runway", () => {
    expect(requestDenied("picker", "GET", "/api/analytics/runway")).toBe(true);
    expect(requestDenied("picker", "GET", "/api/vendors")).toBe(true);
    expect(requestDenied("picker", "GET", "/api/accounting")).toBe(true);
    expect(requestDenied("picker", "POST", "/api/floor/pick")).toBe(false);
    expect(requestDenied("picker", "GET", "/api/jobs/next")).toBe(false);
  });

  it("keeps the bookkeeper off the floor and lets them write purchases", () => {
    expect(requestDenied("bookkeeper", "GET", "/api/floor")).toBe(true);
    expect(requestDenied("bookkeeper", "POST", "/api/ship/quick-ship")).toBe(true);
    expect(requestDenied("bookkeeper", "POST", "/api/purchases")).toBe(false);
    expect(requestDenied("bookkeeper", "GET", "/api/accounting/valuation.csv")).toBe(false);
    expect(requestDenied("bookkeeper", "POST", "/api/orders")).toBe(true);
  });

  it("sends a picker back to Next job and a bookkeeper back to the books", () => {
    expect(rolePageRedirect("picker", "/analytics/runway")).toBe("/floor");
    expect(rolePageRedirect("picker", "/floor/pick")).toBeNull();
    expect(rolePageRedirect("bookkeeper", "/floor")).toBe("/setup/accounting");
    expect(rolePageRedirect("bookkeeper", "/inbound/purchases/po1")).toBeNull();
    expect(rolePageRedirect("owner", "/floor")).toBeNull();
  });

  it("does not add denies for owner or operator", () => {
    expect(requestDenied("owner", "GET", "/api/accounting")).toBe(false);
    expect(requestDenied("operator", "POST", "/api/floor/pick")).toBe(false);
  });
});