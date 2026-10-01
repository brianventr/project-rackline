import { describe, expect, it } from "vitest";
import {
  absenceProvesCleared,
  buildInbox,
  claimUnchanged,
  compareExceptions,
  countExceptions,
  currentClaim,
  decideClaim,
  dedupeExceptions,
  exceptionAuditSummary,
  exceptionItem,
  exceptionState,
  exceptionView,
  inBuilding,
  listText,
  parseJsonObject,
  plural,
  resolutionNote,
  RESOLUTION_NOTE_MAX,
  snoozeLabel,
  snoozeUntil,
  SNOOZE_HOURS,
  sourcesForMode,
  visibleTo,
  type ExceptionClaim,
  type ExceptionDraft,
  type ExceptionItem,
} from "./inbox";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function item(overrides: Partial<ExceptionDraft> = {}): ExceptionItem {
  return exceptionItem({
    source: "hold",
    key: "h1",
    kind: "hold",
    kindLabel: "On hold",
    severity: "warning",
    title: "A-01 is on hold: QC",
    detail: "Check it.",
    link: "/stock/holds/h1",
    ...overrides,
  });
}

function claim(overrides: Partial<ExceptionClaim> = {}): ExceptionClaim {
  return {
    source: "hold",
    key: "h1",
    claimedBy: null,
    claimedByName: null,
    claimedAt: null,
    snoozedUntil: null,
    resolvedAt: null,
    resolvedBy: null,
    resolvedByName: null,
    resolutionNote: null,
    ...overrides,
  };
}

describe("exceptionItem", () => {
  it("fills what a source leaves out", () => {
    expect(item()).toMatchObject({
      warehouseId: null,
      orderId: null,
      itemId: null,
      locationId: null,
      createdAt: null,
      floorLink: null,
      lane: "office",
      ownerOnly: false,
      action: null,
    });
  });
});

describe("compareExceptions", () => {
  it("puts blocking first, then the oldest", () => {
    const rows = [
      item({ key: "info", severity: "info", createdAt: 1 }),
      item({ key: "new", severity: "warning", createdAt: 300 }),
      item({ key: "old", severity: "warning", createdAt: 100 }),
      item({ key: "block", severity: "blocking", createdAt: 900 }),
    ];
    expect(rows.sort(compareExceptions).map((row) => row.key)).toEqual(["block", "old", "new", "info"]);
  });

  it("puts undated problems after the dated ones of their severity, then orders by id", () => {
    const rows = [
      item({ key: "b", createdAt: null }),
      item({ key: "a", createdAt: null }),
      item({ key: "dated", createdAt: 5 }),
      item({ key: "info", severity: "info", createdAt: 1 }),
    ];
    expect(rows.sort(compareExceptions).map((row) => row.key)).toEqual(["dated", "a", "b", "info"]);
  });
});

describe("dedupeExceptions", () => {
  it("keeps one item per source and key, the more severe or older one", () => {
    const kept = dedupeExceptions([
      item({ key: "x", severity: "warning", createdAt: 10 }),
      item({ key: "x", severity: "blocking", createdAt: 20 }),
      item({ key: "y", createdAt: 30 }),
      item({ key: "y", createdAt: 5 }),
      item({ source: "tracker", key: "x", createdAt: 1 }),
    ]);
    expect(kept).toHaveLength(3);
    expect(kept.find((row) => row.source === "hold" && row.key === "x")?.severity).toBe("blocking");
    expect(kept.find((row) => row.key === "y")?.createdAt).toBe(5);
  });
});

describe("sourcesForMode", () => {
  const sources = [
    { id: "count", label: "Counts", modes: ["warehouse"] as const },
    { id: "hold", label: "Holds", modes: ["garage", "warehouse"] as const },
    { id: "ship-rule", label: "Rules", modes: ["garage"] as const },
  ];

  it("keeps the sources a mode lists, in order", () => {
    expect(sourcesForMode(sources, "garage").map((row) => row.id)).toEqual(["hold", "ship-rule"]);
    expect(sourcesForMode(sources, "warehouse").map((row) => row.id)).toEqual(["count", "hold"]);
  });
});

describe("visibleTo and inBuilding", () => {
  const rows = [
    item({ key: "a", ownerOnly: true, warehouseId: null }),
    item({ key: "b", warehouseId: "wh1" }),
    item({ key: "c", warehouseId: "wh2" }),
  ];

  it("hides owner-only problems from operators", () => {
    expect(visibleTo(rows, "owner").map((row) => row.key)).toEqual(["a", "b", "c"]);
    expect(visibleTo(rows, "operator").map((row) => row.key)).toEqual(["b", "c"]);
  });

  it("shows building-less problems in every building", () => {
    expect(inBuilding(rows, "wh1").map((row) => row.key)).toEqual(["a", "b"]);
  });
});

describe("currentClaim and exceptionState", () => {
  it("drops a resolution from before the problem last started", () => {
    expect(currentClaim(item({ createdAt: 200 }), claim({ resolvedAt: 100 }))).toBeNull();
    expect(currentClaim(item({ createdAt: 50 }), claim({ resolvedAt: 100 }))?.resolvedAt).toBe(100);
    expect(currentClaim(item({ createdAt: null }), claim({ resolvedAt: 100 }))?.resolvedAt).toBe(100);
    expect(currentClaim(item({ createdAt: 200 }), claim({ claimedBy: "u1" }))?.claimedBy).toBe("u1");
  });

  it("reads resolved, then snoozed until the snooze runs out, then open", () => {
    expect(exceptionState(claim({ resolvedAt: 1, snoozedUntil: NOW + HOUR }), NOW)).toBe("resolved");
    expect(exceptionState(claim({ snoozedUntil: NOW + HOUR }), NOW)).toBe("snoozed");
    expect(exceptionState(claim({ snoozedUntil: NOW }), NOW)).toBe("open");
    expect(exceptionState(null, NOW)).toBe("open");
  });
});

describe("exceptionView", () => {
  it("shows the claimer and hides a lapsed snooze", () => {
    const view = exceptionView(
      item({ createdAt: 10 }),
      claim({ claimedBy: "u1", claimedByName: "Ana", claimedAt: 20, snoozedUntil: NOW - 1 }),
      NOW,
    );
    expect(view).toMatchObject({ id: "hold:h1", state: "open", claimedBy: "u1", claimedByName: "Ana", claimedAt: 20, snoozedUntil: null });
  });

  it("reads a problem that came back after its resolution as new and unclaimed", () => {
    const view = exceptionView(
      item({ createdAt: 500 }),
      claim({ claimedBy: "u1", claimedByName: "Ana", resolvedAt: 400, resolvedBy: "u1", resolvedByName: "Ana", resolutionNote: "Fixed" }),
      NOW,
    );
    expect(view).toMatchObject({ state: "open", claimedBy: null, resolvedAt: null, resolutionNote: null });
  });

  it("carries the resolution while it applies", () => {
    const view = exceptionView(item({ createdAt: 10 }), claim({ resolvedAt: 400, resolvedByName: "Ana", resolutionNote: "Recounted" }), NOW);
    expect(view).toMatchObject({ state: "resolved", resolvedAt: 400, resolvedByName: "Ana", resolutionNote: "Recounted" });
  });
});

describe("buildInbox and countExceptions", () => {
  it("dedupes, sorts, joins claims, and counts by state", () => {
    const views = buildInbox(
      [
        item({ key: "a", severity: "info", createdAt: 1, lane: "floor" }),
        item({ key: "b", severity: "blocking", createdAt: 2 }),
        item({ key: "c", createdAt: 3 }),
        item({ key: "d", createdAt: 4 }),
        item({ key: "e", createdAt: 5 }),
        item({ key: "e", createdAt: 5 }),
      ],
      [
        claim({ key: "b", claimedBy: "me", claimedByName: "Me" }),
        claim({ key: "c", claimedBy: "other", claimedByName: "Bo" }),
        claim({ key: "d", snoozedUntil: NOW + HOUR }),
        claim({ key: "e", resolvedAt: 10 }),
      ],
      NOW,
    );
    expect(views.map((row) => `${row.key}:${row.state}`)).toEqual(["b:open", "c:open", "d:snoozed", "e:resolved", "a:open"]);
    expect(countExceptions(views, "me")).toEqual({ open: 3, blocking: 1, mine: 1, unclaimed: 1, floor: 1, snoozed: 1, resolved: 1 });
  });
});

describe("decideClaim", () => {
  const me = { userId: "me", role: "operator", now: NOW };
  const owner = { userId: "boss", role: "owner", now: NOW };
  const theirs = claim({ claimedBy: "other", claimedByName: "Bo", claimedAt: 5 });

  it("claims an unclaimed problem and clears a snooze or resolution", () => {
    const decision = decideClaim(claim({ snoozedUntil: NOW + HOUR }), { verb: "claim" }, me);
    expect(decision).toEqual({
      ok: true,
      patch: { claimedBy: "me", claimedAt: NOW, snoozedUntil: null, resolvedAt: null, resolvedBy: null, resolutionNote: null },
    });
  });

  it("keeps the first claim time when the claimer claims again", () => {
    const decision = decideClaim(claim({ claimedBy: "me", claimedAt: 5 }), { verb: "claim" }, me);
    expect(decision.ok && decision.patch.claimedAt).toBe(5);
  });

  it("refuses an operator someone else's problem, and tells an owner to take it over", () => {
    for (const request of [{ verb: "claim" }, { verb: "unclaim" }, { verb: "snooze", until: NOW + HOUR }, { verb: "resolve", note: "x" }, { verb: "reopen" }, { verb: "action" }] as const) {
      expect(decideClaim(theirs, request, me)).toEqual({
        ok: false,
        code: "EXCEPTION_CLAIMED",
        error: "Bo has claimed this. Ask them or an owner to unclaim it.",
      });
    }
    expect(decideClaim(theirs, { verb: "claim" }, owner)).toEqual({
      ok: false,
      code: "EXCEPTION_CLAIMED",
      error: "Bo has claimed this. Take it over to work on it.",
    });
  });

  it("lets an owner take over, unclaim, or act on someone else's problem", () => {
    const takeOver = decideClaim(theirs, { verb: "claim", takeOver: true }, owner);
    expect(takeOver.ok && takeOver.patch.claimedBy).toBe("boss");
    const unclaim = decideClaim(theirs, { verb: "unclaim" }, owner);
    expect(unclaim.ok && unclaim.patch).toMatchObject({ claimedBy: null, claimedAt: null });
    expect(decideClaim(theirs, { verb: "action" }, owner).ok).toBe(true);
    const resolve = decideClaim(theirs, { verb: "resolve", note: "Done" }, owner);
    expect(resolve.ok && resolve.patch).toMatchObject({ claimedBy: "other", resolvedAt: NOW, resolvedBy: "boss", resolutionNote: "Done" });
  });

  it("snoozes and resolves without touching the claim", () => {
    const mine = claim({ claimedBy: "me", claimedAt: 5, snoozedUntil: NOW + HOUR });
    const snooze = decideClaim(mine, { verb: "snooze", until: NOW + 4 * HOUR }, me);
    expect(snooze.ok && snooze.patch).toMatchObject({ claimedBy: "me", claimedAt: 5, snoozedUntil: NOW + 4 * HOUR });
    const resolve = decideClaim(mine, { verb: "resolve", note: "Called the carrier" }, me);
    expect(resolve.ok && resolve.patch).toMatchObject({ claimedBy: "me", snoozedUntil: null, resolvedAt: NOW, resolvedBy: "me", resolutionNote: "Called the carrier" });
  });

  it("refuses to snooze or resolve a resolved problem until it is reopened", () => {
    const done = claim({ resolvedAt: 9, resolvedBy: "me" });
    expect(decideClaim(done, { verb: "snooze", until: NOW + HOUR }, me)).toMatchObject({ ok: false, code: "EXCEPTION_RESOLVED" });
    expect(decideClaim(done, { verb: "resolve", note: "again" }, me)).toMatchObject({ ok: false, code: "EXCEPTION_RESOLVED" });
    const reopen = decideClaim(done, { verb: "reopen" }, me);
    expect(reopen.ok && reopen.patch).toMatchObject({ resolvedAt: null, resolvedBy: null, resolutionNote: null, snoozedUntil: null });
  });

  it("treats claiming your own open claim as no change, and claiming it again while snoozed as a change", () => {
    const mine = claim({ claimedBy: "me", claimedAt: 5 });
    const again = decideClaim(mine, { verb: "claim" }, me);
    expect(again.ok && claimUnchanged(mine, again.patch)).toBe(true);
    const snoozed = claim({ claimedBy: "me", claimedAt: 5, snoozedUntil: NOW + HOUR });
    const wake = decideClaim(snoozed, { verb: "claim" }, me);
    expect(wake.ok && claimUnchanged(snoozed, wake.patch)).toBe(false);
  });

  it("lets anyone unclaim, snooze, or act on an unclaimed problem", () => {
    expect(decideClaim(null, { verb: "unclaim" }, me).ok).toBe(true);
    expect(decideClaim(null, { verb: "snooze", until: NOW + HOUR }, me).ok).toBe(true);
    expect(decideClaim(null, { verb: "action" }, me)).toEqual({
      ok: true,
      patch: { claimedBy: null, claimedAt: null, snoozedUntil: null, resolvedAt: null, resolvedBy: null, resolutionNote: null },
    });
  });
});

describe("proving a problem cleared", () => {
  it("trusts a complete list and not one that filled its cap", () => {
    expect(absenceProvesCleared([{ key: "a" }], "b", null)).toBe(true);
    expect(absenceProvesCleared([{ key: "b" }], "b", null)).toBe(false);
    expect(absenceProvesCleared([{ key: "a" }, { key: "c" }], "b", 3)).toBe(true);
    expect(absenceProvesCleared([{ key: "a" }, { key: "c" }], "b", 2)).toBe(false);
  });
});

describe("snooze and resolution input", () => {
  it("offers whole-hour snoozes with plain labels", () => {
    expect(SNOOZE_HOURS.map(snoozeLabel)).toEqual(["1 hour", "4 hours", "1 day", "3 days", "1 week"]);
  });

  it("accepts 1 hour to 2 weeks", () => {
    expect(snoozeUntil(4, NOW)).toBe(NOW + 4 * HOUR);
    expect(snoozeUntil("24", NOW)).toBe(NOW + 24 * HOUR);
    expect(snoozeUntil(168, NOW)).toBe(NOW + 168 * HOUR);
    for (const bad of [0, -1, 1.5, 169, 336, "", "soon", null, undefined]) expect(snoozeUntil(bad, NOW)).toBeNull();
  });

  it("trims notes, refuses blank ones, and cuts long ones", () => {
    expect(resolutionNote("  Called   the\ncarrier ")).toBe("Called the carrier");
    expect(resolutionNote("   ")).toBeNull();
    expect(resolutionNote(42)).toBeNull();
    const long = resolutionNote("x".repeat(RESOLUTION_NOTE_MAX + 20))!;
    expect(long).toHaveLength(RESOLUTION_NOTE_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("exceptionAuditSummary", () => {
  const target = { title: "Order 1042 is held by rule “Fragile”" };

  it("says what was done to which problem", () => {
    expect(exceptionAuditSummary("claim", target)).toBe("Claimed: Order 1042 is held by rule “Fragile”");
    expect(exceptionAuditSummary("claim", target, { takeOver: true })).toBe("Took over: Order 1042 is held by rule “Fragile”");
    expect(exceptionAuditSummary("unclaim", target)).toBe("Unclaimed: Order 1042 is held by rule “Fragile”");
    expect(exceptionAuditSummary("snooze", target, { hours: 4 })).toBe("Snoozed 4 hours: Order 1042 is held by rule “Fragile”");
    expect(exceptionAuditSummary("resolve", target, { note: "Checked" })).toBe("Resolved: Order 1042 is held by rule “Fragile” (Checked)");
    expect(exceptionAuditSummary("reopen", target)).toBe("Reopened: Order 1042 is held by rule “Fragile”");
    expect(exceptionAuditSummary("action", target, { actionLabel: "Ship anyway" })).toBe("Ship anyway: Order 1042 is held by rule “Fragile”");
  });
});

describe("text helpers", () => {
  it("pluralizes and lists", () => {
    expect(plural(1, "unit")).toBe("1 unit");
    expect(plural(3, "push", "pushes")).toBe("3 pushes");
    expect(listText([])).toBe("");
    expect(listText(["A"])).toBe("A");
    expect(listText(["A", "B"])).toBe("A and B");
    expect(listText(["A", "B", "C"])).toBe("A, B and C");
    expect(listText(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
  });

  it("reads only JSON objects", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject("[1]")).toBeNull();
    expect(parseJsonObject("nope")).toBeNull();
    expect(parseJsonObject(null)).toBeNull();
  });
});
