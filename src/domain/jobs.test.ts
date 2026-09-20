import { describe, expect, it } from "vitest";
import {
  applyAssign,
  applyClaim,
  applyRelease,
  desiredVerb,
  eligibleForNext,
  JobClaimedError,
  JobNotReadyError,
  jobFloorPath,
  materializeSuggestionTarget,
  parseFloorVerbs,
  planJobSync,
  suggestionRefId,
  terminalJobOutcome,
  verbAllowed,
} from "./jobs";

describe("desiredVerb", () => {
  it("maps an order through pick, pack, and ship", () => {
    expect(desiredVerb("order", "open")).toBe("pick");
    expect(desiredVerb("order", "picking")).toBe("pick");
    expect(desiredVerb("order", "picked")).toBe("pack");
    expect(desiredVerb("order", "packing")).toBe("pack");
    expect(desiredVerb("order", "packed")).toBe("ship");
    expect(desiredVerb("order", "shipped")).toBeNull();
    expect(desiredVerb("order", "cancelled")).toBeNull();
  });

  it("maps every other floor document to one verb while open", () => {
    expect(desiredVerb("receipt", "draft")).toBe("receive");
    expect(desiredVerb("purchase", "ordered")).toBe("receive");
    expect(desiredVerb("transfer", "in_progress")).toBe("putaway");
    expect(desiredVerb("replenishment", "draft")).toBe("replenish");
    expect(desiredVerb("rma", "open")).toBe("return");
    expect(desiredVerb("vendorReturn", "returning")).toBe("rtv");
    expect(desiredVerb("cycleCount", "counting")).toBe("count");
    expect(desiredVerb("workOrder", "draft")).toBe("assemble");
    expect(desiredVerb("kit", "in_progress")).toBe("kit");
    expect(desiredVerb("hold", "open")).toBe("hold");
    expect(desiredVerb("transfer", "posted")).toBeNull();
    expect(desiredVerb("kit", "dekitted")).toBeNull();
  });
});

describe("planJobSync", () => {
  it("opens a pick job for a new order", () => {
    expect(planJobSync([], "pick", null)).toEqual([{ op: "create", verb: "pick" }]);
  });

  it("completes pick and opens pack when the order is fully picked", () => {
    const ops = planJobSync([{ id: "j1", verb: "pick", status: "claimed" }], "pack", null);
    expect(ops).toEqual([
      { op: "complete", id: "j1" },
      { op: "create", verb: "pack" },
    ]);
  });

  it("cancels remaining jobs when the order is cancelled", () => {
    expect(
      planJobSync(
        [
          { id: "j1", verb: "pick", status: "claimed" },
          { id: "j2", verb: "pack", status: "open" },
        ],
        null,
        "cancelled",
      ),
    ).toEqual([
      { op: "cancel", id: "j1" },
      { op: "cancel", id: "j2" },
    ]);
  });

  it("cancels later steps and reopens pick after an unpick back to picking", () => {
    const ops = planJobSync(
      [
        { id: "pack", verb: "pack", status: "open" },
        { id: "ship", verb: "ship", status: "open" },
      ],
      "pick",
      null,
    );
    expect(ops).toEqual([
      { op: "cancel", id: "pack" },
      { op: "cancel", id: "ship" },
      { op: "create", verb: "pick" },
    ]);
  });

  it("completes the active job when the document is done", () => {
    expect(planJobSync([{ id: "j1", verb: "receive", status: "claimed" }], null, "done")).toEqual([
      { op: "complete", id: "j1" },
    ]);
  });
});

describe("claim, release, assign", () => {
  const open = { status: "open" as const, assigneeId: null, notBefore: null };

  it("auto-claims an unassigned job", () => {
    expect(applyClaim(open, "u1", 10)).toMatchObject({ status: "claimed", assigneeId: "u1", claimedAt: 10 });
  });

  it("rejects a second operator with JOB_CLAIMED", () => {
    expect(() => applyClaim({ status: "claimed", assigneeId: "u1", notBefore: null }, "u2", 11, "Avery")).toThrow(
      JobClaimedError,
    );
  });

  it("lets an owner steal a claimed job", () => {
    expect(applyClaim({ status: "claimed", assigneeId: "u1", notBefore: null }, "owner", 12, "Avery", true)).toMatchObject({
      status: "claimed",
      assigneeId: "owner",
    });
  });

  it("hides a job until notBefore", () => {
    expect(() => applyClaim({ ...open, notBefore: 100 }, "u1", 50)).toThrow(JobNotReadyError);
    expect(eligibleForNext({ ...open, notBefore: 100, verb: "pick" }, "u1", 50, ["pick"])).toBe(false);
    expect(eligibleForNext({ ...open, notBefore: 100, verb: "pick" }, "u1", 100, ["pick"])).toBe(true);
  });

  it("releases back to the pool", () => {
    expect(applyRelease({ status: "claimed", assigneeId: "u1", notBefore: null }, "u1", "operator", 20)).toMatchObject({
      status: "open",
      assigneeId: null,
    });
  });

  it("assigns without claiming, and owner can steal", () => {
    expect(applyAssign(open, "u2", "operator", "u1")).toMatchObject({ status: "open", assigneeId: "u2" });
    expect(() =>
      applyAssign({ status: "claimed", assigneeId: "u2", notBefore: null }, "u3", "operator", "u3"),
    ).toThrow(JobClaimedError);
    expect(applyAssign({ status: "claimed", assigneeId: "u2", notBefore: null }, "u3", "owner", "owner")).toMatchObject({
      status: "claimed",
      assigneeId: "u3",
    });
  });
});

describe("verbs and paths", () => {
  it("treats empty floor_verbs as all verbs, owner always all", () => {
    expect(parseFloorVerbs(null, "operator")).toHaveLength(12);
    expect(parseFloorVerbs('["pick","pack"]', "operator")).toEqual(["pick", "pack"]);
    expect(verbAllowed(parseFloorVerbs('["pick"]', "owner"), "receive")).toBe(true);
  });

  it("builds floor paths including purchase receive and suggestions", () => {
    expect(jobFloorPath({ verb: "pick", refType: "order", refId: "o1" })).toBe("/floor/pick?id=o1");
    expect(jobFloorPath({ verb: "receive", refType: "purchase", refId: "p1" })).toBe("/floor/receive?purchase=p1");
    expect(
      jobFloorPath({ verb: "putaway", refType: "putawaySuggestion", refId: "x", fromBarcode: "RECV" }),
    ).toBe("/floor/putaway?from=RECV");
    expect(suggestionRefId("from", "item", "to")).toBe("from:item:to");
  });

  it("binds a suggestion job to the document created on start", () => {
    expect(materializeSuggestionTarget("putawaySuggestion")).toEqual({ refType: "transfer" });
    expect(materializeSuggestionTarget("replenishSuggestion")).toEqual({ refType: "replenishment" });
    expect(materializeSuggestionTarget("order")).toBeNull();
  });

  it("hides jobs claimed by someone else or outside the verb allow-list", () => {
    expect(
      eligibleForNext({ status: "claimed", assigneeId: "u2", notBefore: null, verb: "pick" }, "u1", 1, ["pick"]),
    ).toBe(false);
    expect(eligibleForNext({ status: "open", assigneeId: null, notBefore: null, verb: "count" }, "u1", 1, ["pick"])).toBe(
      false,
    );
  });

  it("marks shipped and cancelled as terminal", () => {
    expect(terminalJobOutcome("order", "shipped")).toBe("done");
    expect(terminalJobOutcome("order", "cancelled")).toBe("cancelled");
    expect(terminalJobOutcome("kit", "dekitted")).toBe("cancelled");
  });
});
