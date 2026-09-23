import { describe, expect, it } from "vitest";
import {
  FLOOR_GROUPS,
  HEARD_TONE_WINDOW_MS,
  defaultScanPrefs,
  floorGroupFor,
  floorUsageKey,
  groupFloorTiles,
  jobBayRoute,
  jobReasonText,
  openWorkByVerb,
  parseFloorUsage,
  parseScanPrefs,
  recordFloorTap,
  scanResultTone,
  scanVibration,
  usualFloorPaths,
} from "./floor-usage";
import { DEFAULT_JOB_REASON } from "./job-rank";

describe("floor groups", () => {
  it("files every verb screen under its flow", () => {
    expect(floorGroupFor("/floor/receive")).toBe("inbound");
    expect(floorGroupFor("/floor/putaway")).toBe("inbound");
    expect(floorGroupFor("/floor/pick?id=abc")).toBe("outbound");
    expect(floorGroupFor("/floor/rtv")).toBe("outbound");
    expect(floorGroupFor("/floor/count")).toBe("stock");
    expect(floorGroupFor("/floor/adjust")).toBe("stock");
    expect(floorGroupFor("/floor/kit")).toBe("make");
    expect(floorGroupFor("/floor/lookup")).toBe("tools");
    expect(floorGroupFor("/floor/something-new")).toBe("tools");
  });

  it("groups tiles in flow order, keeps tile order, and drops empty groups", () => {
    const tiles = [
      { to: "/floor/lookup" },
      { to: "/floor/pack" },
      { to: "/floor/receive" },
      { to: "/floor/pick" },
      { to: "/floor/kit" },
    ];
    const groups = groupFloorTiles(tiles);
    expect(groups.map((group) => group.id)).toEqual(["inbound", "outbound", "make", "tools"]);
    expect(groups[1]!.tiles.map((tile) => tile.to)).toEqual(["/floor/pack", "/floor/pick"]);
    expect(groups.find((group) => group.id === "stock")).toBeUndefined();
    expect(FLOOR_GROUPS.map((group) => group.label)).toEqual(["Inbound", "Outbound", "Stock", "Make", "Tools"]);
  });
});

describe("floor usage", () => {
  it("keys counts per user", () => {
    expect(floorUsageKey("u1")).toBe("rackline.floorUsage.u1");
    expect(floorUsageKey("u1")).not.toBe(floorUsageKey("u2"));
  });

  it("parses stored counts defensively", () => {
    expect(parseFloorUsage(null)).toEqual({});
    expect(parseFloorUsage("not json")).toEqual({});
    expect(parseFloorUsage("[1,2]")).toEqual({});
    expect(
      parseFloorUsage(JSON.stringify({ "/floor/pick": 3.7, "/floor/pack": -1, "/floor/ship": "2", "/orders": 4 })),
    ).toEqual({ "/floor/pick": 3 });
  });

  it("counts a tap without mutating the input and ignores query strings", () => {
    const before = { "/floor/pick": 1 };
    const after = recordFloorTap(before, "/floor/pick?id=1");
    expect(after).toEqual({ "/floor/pick": 2 });
    expect(before).toEqual({ "/floor/pick": 1 });
    expect(recordFloorTap(after, "/floor/pack")).toEqual({ "/floor/pick": 2, "/floor/pack": 1 });
    expect(recordFloorTap(after, "/orders")).toBe(after);
  });

  it("halves every count when one path reaches the cap, keeping the order", () => {
    const next = recordFloorTap({ "/floor/pick": 500, "/floor/pack": 40, "/floor/ship": 1 }, "/floor/pick");
    expect(next).toEqual({ "/floor/pick": 250, "/floor/pack": 20 });
  });

  it("returns the four most used allowed paths, best first, ties in tile order", () => {
    const allowed = ["/floor/lookup", "/floor/receive", "/floor/pick", "/floor/pack", "/floor/ship", "/floor/count"];
    const usage = {
      "/floor/pick": 9,
      "/floor/pack": 4,
      "/floor/receive": 4,
      "/floor/ship": 2,
      "/floor/count": 1,
      "/floor/adjust": 50,
    };
    expect(usualFloorPaths(usage, allowed)).toEqual(["/floor/pick", "/floor/receive", "/floor/pack", "/floor/ship"]);
    expect(usualFloorPaths(usage, allowed, 2)).toEqual(["/floor/pick", "/floor/receive"]);
    expect(usualFloorPaths({}, allowed)).toEqual([]);
  });
});

describe("openWorkByVerb", () => {
  it("counts unassigned work and my claims, not a teammate's", () => {
    const counts = openWorkByVerb(
      [
        { verb: "pick", assigneeId: null, status: "open" },
        { verb: "pick", assigneeId: "me", status: "claimed" },
        { verb: "pick", assigneeId: "someone", status: "claimed" },
        { verb: "receive", assigneeId: null },
        { verb: "pack", assigneeId: null, status: "done" },
      ],
      "me",
    );
    expect(counts).toEqual({ pick: 2, receive: 1 });
  });
});

describe("next job copy", () => {
  it("joins the bays that are known", () => {
    expect(jobBayRoute({ fromCode: "B-01-01-2", toCode: "B-01-01" })).toBe("B-01-01-2 → B-01-01");
    expect(jobBayRoute({ fromCode: null, toCode: "DOCK" })).toBe("DOCK");
    expect(jobBayRoute({ fromCode: " ", toCode: null })).toBeNull();
  });

  it("hides the default reason", () => {
    expect(jobReasonText({ reason: DEFAULT_JOB_REASON })).toBeNull();
    expect(jobReasonText({ reason: undefined })).toBeNull();
    expect(jobReasonText({ reason: "Due now" })).toBe("Due now");
  });
});

describe("scan feedback", () => {
  it("defaults beep, vibrate, and flash on, camera-first off", () => {
    expect(defaultScanPrefs()).toEqual({ beep: true, preferCamera: false, vibrate: true, flash: true });
    expect(parseScanPrefs(null)).toEqual(defaultScanPrefs());
    expect(parseScanPrefs("{oops")).toEqual(defaultScanPrefs());
  });

  it("keeps older stored prefs and reads the new switches", () => {
    expect(parseScanPrefs(JSON.stringify({ beep: false, preferCamera: true }))).toEqual({
      beep: false,
      preferCamera: true,
      vibrate: true,
      flash: true,
    });
    expect(parseScanPrefs(JSON.stringify({ vibrate: false, flash: false }))).toEqual({
      beep: true,
      preferCamera: false,
      vibrate: false,
      flash: false,
    });
  });

  it("buzzes once for a good scan and twice for a bad one", () => {
    expect(scanVibration(true)).toHaveLength(1);
    expect(scanVibration(false)).toHaveLength(3);
    scanVibration(true).push(1);
    expect(scanVibration(true)).toHaveLength(1);
  });

  it("does not double-beep an accept that follows the heard beep", () => {
    const now = 10_000;
    expect(scanResultTone(false, now - 10, now)).toBe("bad");
    expect(scanResultTone(true, now - 200, now)).toBeNull();
    expect(scanResultTone(true, now - HEARD_TONE_WINDOW_MS, now)).toBe("ok");
    expect(scanResultTone(true, null, now)).toBe("ok");
  });
});
