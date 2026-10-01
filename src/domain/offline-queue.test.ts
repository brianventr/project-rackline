import { describe, expect, it } from "vitest";
import {
  blockedBehindFailure,
  dismissFailure,
  enqueuePost,
  nextReplay,
  noteReplayResult,
  queueCounts,
  replayQueue,
  type OfflinePost,
} from "./offline-queue";

function post(patch: Partial<OfflinePost> & Pick<OfflinePost, "id" | "kind">): OfflinePost {
  return {
    seq: 1,
    groupId: null,
    path: "/api/test",
    body: "{}",
    idempotencyKey: `key-${patch.id}`,
    localSessionId: null,
    state: "pending",
    failureStatus: null,
    failureMessage: null,
    ...patch,
  };
}

describe("enqueuePost", () => {
  it("puts a late scan session ahead of that pick's scans", () => {
    const pick = post({ id: "pick", kind: "pick", seq: 2, groupId: "order-1" });
    const scan = post({ id: "scan", kind: "scan", seq: 1, groupId: "order-1" });
    const session = post({ id: "session", kind: "scan-session", groupId: "order-1" });
    expect(enqueuePost([scan, pick], session).map((row) => row.kind)).toEqual(["scan-session", "scan", "pick"]);
  });

  it("puts a scan for a pick ahead of that pick", () => {
    const pick = post({ id: "pick", kind: "pick", seq: 1, groupId: "order-1", path: "/api/orders/order-1/pick" });
    const scan = post({ id: "scan", kind: "scan", seq: 9, groupId: "order-1", path: "/api/floor/scans" });
    const queued = enqueuePost([pick], scan);
    expect(queued.map((row) => row.kind)).toEqual(["scan", "pick"]);
    expect(queued.map((row) => row.seq)).toEqual([1, 2]);
  });

  it("leaves a scan for another order behind an unrelated pick", () => {
    const pick = post({ id: "pick", kind: "pick", seq: 1, groupId: "order-1" });
    const scan = post({ id: "scan", kind: "scan", seq: 2, groupId: "order-2" });
    expect(enqueuePost([pick], scan).map((row) => row.id)).toEqual(["pick", "scan"]);
  });

  it("appends a receive after what is already waiting", () => {
    const first = post({ id: "a", kind: "receive", seq: 1 });
    const second = post({ id: "b", kind: "receive", seq: 2 });
    expect(enqueuePost([first], second).map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("nextReplay", () => {
  it("sends the scan before the pick", () => {
    const pick = post({ id: "pick", kind: "pick", seq: 2, groupId: "order-1" });
    const scan = post({ id: "scan", kind: "scan", seq: 1, groupId: "order-1" });
    expect(nextReplay([pick, scan])?.id).toBe("scan");
  });

  it("sends nothing while a failed scan is ahead of the pick", () => {
    const scan = post({
      id: "scan",
      kind: "scan",
      seq: 1,
      groupId: "order-1",
      state: "failed",
      failureStatus: 409,
      failureMessage: "Scan session not found",
    });
    const pick = post({ id: "pick", kind: "pick", seq: 2, groupId: "order-1" });
    const receive = post({ id: "recv", kind: "receive", seq: 3 });
    expect(nextReplay([scan, pick, receive])).toBeNull();
    expect(blockedBehindFailure([scan, pick, receive]).map((row) => row.id)).toEqual(["pick", "recv"]);
  });

  it("returns null for an empty queue", () => {
    expect(nextReplay([])).toBeNull();
    expect(blockedBehindFailure([])).toEqual([]);
  });
});

describe("noteReplayResult", () => {
  it("keeps a 4xx as a visible failure", () => {
    const receive = post({ id: "recv", kind: "receive" });
    const next = noteReplayResult([receive], "recv", {
      status: 409,
      body: { error: "Receipt has nothing remaining", code: "CONFLICT" },
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ state: "failed", failureStatus: 409, failureMessage: "Receipt has nothing remaining" });
    expect(nextReplay(next)).toBeNull();
  });

  it("leaves the post pending when the key is still running", () => {
    const receive = post({ id: "recv", kind: "receive" });
    const next = noteReplayResult([receive], "recv", {
      status: 409,
      body: { error: "That post is already running", code: "IDEMPOTENCY_IN_PROGRESS" },
    });
    expect(next[0]?.state).toBe("pending");
  });

  it("writes the server session id into the scan and the pick", () => {
    const session = post({
      id: "session",
      kind: "scan-session",
      seq: 1,
      groupId: "order-1",
      localSessionId: "local-1",
      body: JSON.stringify({ task: "pick", refId: "order-1" }),
    });
    const scan = post({
      id: "scan",
      kind: "scan",
      seq: 2,
      groupId: "order-1",
      body: JSON.stringify({ sessionId: "local-1", clientScanId: "c1" }),
    });
    const pick = post({
      id: "pick",
      kind: "pick",
      seq: 3,
      groupId: "order-1",
      body: JSON.stringify({ sessionId: "local-1", locationId: "bay" }),
    });
    const next = noteReplayResult([session, scan, pick], "session", { status: 200, body: { id: "srv-9" } });
    expect(next.map((row) => row.kind)).toEqual(["scan", "pick"]);
    expect(next[0]?.body).toContain("srv-9");
    expect(next[1]?.body).toContain("srv-9");
    expect(next[0]?.body).not.toContain("local-1");
  });
});

describe("replayQueue", () => {
  it("keeps the post when fetch fails, then drops it after a 200", async () => {
    const receive = post({ id: "recv", kind: "receive", path: "/api/receipts/r/receive", idempotencyKey: "same-key" });
    let calls = 0;
    const held = await replayQueue([receive], async () => {
      calls += 1;
      throw new Error("network down");
    });
    expect(calls).toBe(1);
    expect(held).toEqual([receive]);

    const sent: string[] = [];
    const done = await replayQueue(held, async (row) => {
      sent.push(row.idempotencyKey);
      return { status: 200, body: { id: "r", number: "RCP-1" } };
    });
    expect(sent).toEqual(["same-key"]);
    expect(done).toEqual([]);
  });

  it("does not send the pick again after its scan was refused", async () => {
    const scan = post({ id: "scan", kind: "scan", seq: 1, groupId: "order-1" });
    const pick = post({ id: "pick", kind: "pick", seq: 2, groupId: "order-1" });
    const sent: string[] = [];
    const left = await replayQueue([scan, pick], async (row) => {
      sent.push(row.id);
      return { status: 400, body: { error: "kind must be location, plate, item, serial, or lot" } };
    });
    expect(sent).toEqual(["scan"]);
    expect(left.map((row) => row.id)).toEqual(["scan", "pick"]);
    expect(left[0]?.state).toBe("failed");
    expect(queueCounts(left)).toEqual({ pending: 1, failed: 1 });

    const again = await replayQueue(left, async () => {
      throw new Error("should not send");
    });
    expect(again[0]?.state).toBe("failed");
  });

  it("replays a scan session, then its scans, then the pick, with the server session id", async () => {
    const session = post({
      id: "session",
      kind: "scan-session",
      seq: 1,
      groupId: "order-1",
      localSessionId: "local-1",
      path: "/api/floor/scan-sessions",
      body: JSON.stringify({ task: "pick", refId: "order-1" }),
    });
    const scan = post({
      id: "scan",
      kind: "scan",
      seq: 2,
      groupId: "order-1",
      path: "/api/floor/scans",
      body: JSON.stringify({ sessionId: "local-1", clientScanId: "c1" }),
    });
    const pick = post({
      id: "pick",
      kind: "pick",
      seq: 3,
      groupId: "order-1",
      path: "/api/orders/order-1/pick",
      body: JSON.stringify({ sessionId: "local-1", locationId: "bay" }),
    });
    const bodies: string[] = [];
    const left = await replayQueue(enqueuePost(enqueuePost([pick], scan), session), async (row) => {
      bodies.push(`${row.kind}:${row.body}`);
      if (row.kind === "scan-session") return { status: 200, body: { id: "srv-9" } };
      return { status: 200, body: { ok: true } };
    });
    expect(left).toEqual([]);
    expect(bodies.map((row) => row.split(":")[0])).toEqual(["scan-session", "scan", "pick"]);
    expect(bodies[1]).toContain("srv-9");
    expect(bodies[2]).toContain("srv-9");
  });
});

describe("dismissFailure", () => {
  it("drops the failed post and lets the next one send", () => {
    const scan = post({ id: "scan", kind: "scan", seq: 1, state: "failed", failureStatus: 409 });
    const pick = post({ id: "pick", kind: "pick", seq: 2, groupId: "order-1" });
    const next = dismissFailure([scan, pick], "scan");
    expect(next.map((row) => row.id)).toEqual(["pick"]);
    expect(nextReplay(next)?.id).toBe("pick");
    expect(dismissFailure([pick], "pick")).toEqual([pick]);
  });
});
