import { describe, expect, it } from "vitest";
import { shellCachePlan } from "./offline-shell";

describe("shellCachePlan", () => {
  it("does not cache API calls", () => {
    expect(shellCachePlan("/api/receipts/r/receive", "POST")).toBe("network-only");
    expect(shellCachePlan("/api/orders/o/pick", "POST")).toBe("network-only");
    expect(shellCachePlan("/api/floor/scans", "POST")).toBe("network-only");
    expect(shellCachePlan("/api/floor/scan-sessions", "POST")).toBe("network-only");
    expect(shellCachePlan("/api/me", "GET")).toBe("network-only");
    expect(shellCachePlan("/api", "GET")).toBe("network-only");
  });

  it("keeps the floor shell on the network first so a refresh can fall back", () => {
    expect(shellCachePlan("/floor/receive", "GET")).toBe("network-first");
    expect(shellCachePlan("/floor/pick", "GET")).toBe("network-first");
    expect(shellCachePlan("/", "GET")).toBe("network-first");
    expect(shellCachePlan("/index.html", "GET")).toBe("network-first");
    expect(shellCachePlan("/assets/index-abc.js", "GET")).toBe("network-first");
  });

  it("leaves non-GET requests to the network", () => {
    expect(shellCachePlan("/floor/receive", "POST")).toBe("network-only");
  });
});
