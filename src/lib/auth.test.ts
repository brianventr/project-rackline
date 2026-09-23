import { describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import type { AppDb } from "../db/stock";
import { SIGN_IN_ACTION, SIGN_IN_CODE } from "../domain/audit";
import { recordSignIn, resolveAuthSecret } from "./auth";

describe("auth secret", () => {
  it("uses the env secret when it is long enough", () => {
    expect(resolveAuthSecret({ BETTER_AUTH_SECRET: "x".repeat(32) }, "https://rackline.example")).toBe(
      "x".repeat(32),
    );
  });

  it("falls back only on localhost", () => {
    expect(resolveAuthSecret({}, "http://localhost:5173").length).toBeGreaterThanOrEqual(32);
    expect(() => resolveAuthSecret({}, "https://rackline.example")).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => resolveAuthSecret({ BETTER_AUTH_SECRET: "short" }, "https://rackline.example")).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });
});

/** Just enough of drizzle for `recordSignIn`: user and membership reads, audit inserts. */
function fakeDb(input: { user?: { createdAt: Date } | null; orgs: string[]; failInsert?: boolean }) {
  const inserted: Record<string, unknown>[] = [];
  const person = input.user ? { id: "u1", name: "Op Three", email: "op3@example.test", ...input.user } : null;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === schema.user ? (person ? [person] : []) : input.orgs.map((organizationId) => ({ organizationId }));
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (rows: Record<string, unknown>[]) => {
        if (input.failInsert) throw new Error("D1 overloaded");
        if (table === schema.auditEvents) inserted.push(...rows);
      },
    }),
  };
  return { db: db as unknown as AppDb, inserted };
}

describe("recordSignIn", () => {
  const created = new Date("2026-09-01T10:00:00Z");
  const browser = "Mozilla/5.0";

  it("audits a browser sign-in in every org the person belongs to", async () => {
    const { db, inserted } = fakeDb({ user: { createdAt: created }, orgs: ["org-a", "org-b"] });
    await recordSignIn(db, { userId: "u1", createdAt: new Date(created.getTime() + 86_400_000), userAgent: browser }, "/sign-in/email");
    expect(inserted.map((row) => row.organizationId)).toEqual(["org-a", "org-b"]);
    expect(inserted[0]).toMatchObject({
      actorUserId: "u1",
      actorName: "Op Three",
      actorEmail: "op3@example.test",
      action: SIGN_IN_ACTION,
      code: SIGN_IN_CODE,
      method: "POST",
      path: "/api/auth/sign-in/email",
      status: 200,
      payloadJson: null,
    });
  });

  it("skips the agentless session a server-side invite opens with the account", async () => {
    const { db, inserted } = fakeDb({ user: { createdAt: created }, orgs: ["org-a"] });
    await recordSignIn(db, { userId: "u1", createdAt: new Date(created.getTime() + 50), userAgent: null }, "/sign-up/email");
    expect(inserted).toEqual([]);
  });

  it("writes nothing before the person has an org (the owner's own sign-up)", async () => {
    const { db, inserted } = fakeDb({ user: { createdAt: created }, orgs: [] });
    await recordSignIn(db, { userId: "u1", createdAt: created, userAgent: browser }, "/sign-up/email");
    expect(inserted).toEqual([]);
  });

  it("never fails the sign-in when the audit write fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = fakeDb({ user: { createdAt: created }, orgs: ["org-a"], failInsert: true });
    await expect(
      recordSignIn(db, { userId: "u1", createdAt: new Date(created.getTime() + 86_400_000), userAgent: browser }, "/sign-in/email"),
    ).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
