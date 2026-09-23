import { describe, expect, it } from "vitest";
import {
  isSignupSession,
  lastActiveAt,
  latestActivity,
  SIGNUP_SESSION_WINDOW_MS,
  teamMemberStatus,
  teamStatusLabel,
  teamStatusTone,
} from "./team-status";

const USER_CREATED = 1_790_000_000_000;
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64)";

describe("isSignupSession", () => {
  it("flags the agentless session a server-side sign-up opens with the account", () => {
    expect(isSignupSession({ createdAt: USER_CREATED + 11, userAgent: "" }, USER_CREATED)).toBe(true);
    expect(isSignupSession({ createdAt: USER_CREATED + 11, userAgent: null }, USER_CREATED)).toBe(true);
    expect(isSignupSession({ createdAt: USER_CREATED + 11, userAgent: "   " }, USER_CREATED)).toBe(true);
  });

  it("keeps a sign-up from a browser, which hands the cookie to a person", () => {
    expect(isSignupSession({ createdAt: USER_CREATED + 9, userAgent: BROWSER }, USER_CREATED)).toBe(false);
  });

  it("keeps an agentless session opened well after the account", () => {
    expect(
      isSignupSession({ createdAt: USER_CREATED + SIGNUP_SESSION_WINDOW_MS, userAgent: "" }, USER_CREATED),
    ).toBe(false);
    expect(isSignupSession({ createdAt: USER_CREATED + 3_600_000, userAgent: undefined }, USER_CREATED)).toBe(false);
  });
});

describe("lastActiveAt", () => {
  it("is null with no sessions", () => {
    expect(lastActiveAt([], USER_CREATED)).toBeNull();
  });

  it("is null when the only session is the invite's own", () => {
    expect(
      lastActiveAt([{ createdAt: USER_CREATED + 7, updatedAt: USER_CREATED + 7, userAgent: "" }], USER_CREATED),
    ).toBeNull();
  });

  it("takes the latest updatedAt across real sign-ins, ignoring the invite session", () => {
    const sessions = [
      { createdAt: USER_CREATED + 7, updatedAt: USER_CREATED + 99_000_000, userAgent: "" },
      { createdAt: USER_CREATED + 5_000_000, updatedAt: USER_CREATED + 8_000_000, userAgent: BROWSER },
      { createdAt: USER_CREATED + 9_000_000, updatedAt: USER_CREATED + 9_500_000, userAgent: "curl/8.5.0" },
      { createdAt: USER_CREATED + 2_000_000, updatedAt: USER_CREATED + 2_000_000, userAgent: BROWSER },
    ];
    expect(lastActiveAt(sessions, USER_CREATED)).toBe(USER_CREATED + 9_500_000);
  });

  it("counts the owner's browser sign-up session as activity", () => {
    expect(
      lastActiveAt([{ createdAt: USER_CREATED + 8, updatedAt: USER_CREATED + 8, userAgent: BROWSER }], USER_CREATED),
    ).toBe(USER_CREATED + 8);
  });
});

describe("latestActivity", () => {
  it("is null with no signals", () => {
    expect(latestActivity([])).toBeNull();
    expect(latestActivity([null, undefined])).toBeNull();
  });

  it("keeps the activity of someone whose session was deleted at sign-out", () => {
    // No stored session, but a stock move and an audited write outlive it.
    expect(latestActivity([null, USER_CREATED + 5_000, USER_CREATED + 9_000])).toBe(USER_CREATED + 9_000);
    expect(teamMemberStatus(latestActivity([null, USER_CREATED + 5_000, undefined]))).toBe("active");
  });

  it("keeps someone who signed in, only looked around, and signed out", () => {
    // Session, stock move and write are all gone or never happened; only the audited sign-in is left.
    const signedIn = USER_CREATED + 60_000;
    expect(latestActivity([null, null, undefined, signedIn])).toBe(signedIn);
    expect(teamMemberStatus(latestActivity([null, null, undefined, signedIn]))).toBe("active");
  });

  it("takes the latest of session, stock move and audited write", () => {
    expect(latestActivity([USER_CREATED + 3, USER_CREATED + 1, USER_CREATED + 2])).toBe(USER_CREATED + 3);
    expect(latestActivity([USER_CREATED + 1, USER_CREATED + 3, USER_CREATED + 2])).toBe(USER_CREATED + 3);
    expect(latestActivity([USER_CREATED + 1, null, USER_CREATED + 7])).toBe(USER_CREATED + 7);
  });

  it("reads numeric strings from SQL and ignores anything that is not a real time", () => {
    expect(latestActivity([String(USER_CREATED + 4), USER_CREATED + 2])).toBe(USER_CREATED + 4);
    expect(latestActivity(["", "  ", "soon", 0, -5, Number.NaN, Number.POSITIVE_INFINITY, true, {}])).toBeNull();
  });
});

describe("teamMemberStatus", () => {
  it("is invited until the first sign-in", () => {
    expect(teamMemberStatus(null)).toBe("invited");
    expect(teamMemberStatus(undefined)).toBe("invited");
    expect(teamMemberStatus(0)).toBe("invited");
    expect(teamMemberStatus(Number.NaN)).toBe("invited");
  });

  it("is active once there is a sign-in time", () => {
    expect(teamMemberStatus(USER_CREATED)).toBe("active");
  });

  it("labels and tones each status", () => {
    expect(teamStatusLabel("active")).toBe("Active");
    expect(teamStatusLabel("invited")).toBe("Invited");
    expect(teamStatusTone("active")).toBe("success");
    expect(teamStatusTone("invited")).toBe("warning");
  });
});
