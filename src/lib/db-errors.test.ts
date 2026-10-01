import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { constraintFailure, isDatabaseError, isUniqueViolation, publicErrorText } from "./db-errors";

const UNIQUE_SKU = "D1_ERROR: UNIQUE constraint failed: items.organization_id, items.sku: SQLITE_CONSTRAINT";
const FOREIGN_KEY = "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT";

function wrapped(query: string, cause: string) {
  return new DrizzleQueryError(query, ["org-1", "LAMP"], new Error(cause));
}

describe("constraintFailure", () => {
  it("reads a unique failure through drizzle's wrapper, with the statement and columns", () => {
    expect(constraintFailure(wrapped('insert into "items" ("id", "sku") values (?, ?)', UNIQUE_SKU))).toEqual({
      kind: "unique",
      verb: "insert",
      columns: ["organization_id", "sku"],
    });
    expect(isUniqueViolation(wrapped("insert into plates", UNIQUE_SKU))).toBe(true);
  });

  it("reads a bare batch failure, which has no statement", () => {
    expect(constraintFailure(new Error(FOREIGN_KEY))).toEqual({ kind: "foreign_key", verb: null, columns: [] });
    expect(constraintFailure(wrapped('delete from "locations" where "id" = ?', FOREIGN_KEY))?.verb).toBe("delete");
  });

  it("ignores other failures", () => {
    expect(constraintFailure(new Error("D1_ERROR: NOT NULL constraint failed: items.sku: SQLITE_CONSTRAINT"))).toBeNull();
    expect(constraintFailure(new TypeError("Cannot read properties of undefined"))).toBeNull();
    expect(constraintFailure("UNIQUE")).toBeNull();
  });
});

describe("publicErrorText", () => {
  it("keeps a sentence meant for people", () => {
    expect(publicErrorText(new Error("Etsy shop id is missing. Reconnect the shop."), "Sync failed")).toBe(
      "Etsy shop id is missing. Reconnect the shop.",
    );
  });

  it("never passes on D1 text, a failed query, or a runtime crash", () => {
    const query = wrapped('insert into "orders" ("number") values (?)', UNIQUE_SKU);
    expect(isDatabaseError(query)).toBe(true);
    expect(publicErrorText(query, "Sync failed")).toBe("Sync failed");
    expect(publicErrorText(new Error(FOREIGN_KEY), "Sync failed")).toBe("Sync failed");
    expect(publicErrorText(new Error("D1_ERROR: no such column: orders.foo"), "Sync failed")).toBe("Sync failed");
    expect(publicErrorText(new TypeError("x is not a function"), "Sync failed")).toBe("Sync failed");
    expect(publicErrorText("boom", "Sync failed")).toBe("Sync failed");
  });
});
