import { describe, expect, it } from "vitest";
import { clientLabel, filterByClient } from "./clients";

describe("clients", () => {
  it("filters by client id", () => {
    const rows = [
      { id: "1", clientId: "c1" },
      { id: "2", clientId: null },
      { id: "3", clientId: "c2" },
    ];
    expect(filterByClient(rows, "c1").map((r) => r.id)).toEqual(["1"]);
    expect(filterByClient(rows, null)).toHaveLength(3);
  });

  it("labels house brand when unset", () => {
    expect(clientLabel(null)).toBe("House");
    expect(clientLabel({ code: "ACME", name: "Acme Co" })).toBe("ACME — Acme Co");
  });
});
