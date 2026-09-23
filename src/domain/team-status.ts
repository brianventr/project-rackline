import type { StatusTone } from "./status";

export type TeamMemberStatus = "active" | "invited";

/**
 * better-auth opens a session inside every `signUpEmail`. When the server signs someone up
 * (a team invite, the demo seed) nobody ever holds that cookie: it carries no user agent and
 * opens within moments of the account itself. It is not a sign-in, so it does not count.
 */
export const SIGNUP_SESSION_WINDOW_MS = 60_000;

export type SessionTrace = {
  createdAt: number;
  updatedAt: number;
  userAgent: string | null | undefined;
};

/** The throwaway session a server-side sign-up leaves behind. `GET /api/team` mirrors this in SQL. */
export function isSignupSession(session: Pick<SessionTrace, "createdAt" | "userAgent">, userCreatedAt: number): boolean {
  return !(session.userAgent ?? "").trim() && session.createdAt - userCreatedAt < SIGNUP_SESSION_WINDOW_MS;
}

/** Latest `updatedAt` across the stored sessions this person actually opened, or null when none is stored. */
export function lastActiveAt(sessions: readonly SessionTrace[], userCreatedAt: number): number | null {
  let latest: number | null = null;
  for (const session of sessions) {
    if (isSignupSession(session, userCreatedAt)) continue;
    if (latest === null || session.updatedAt > latest) latest = session.updatedAt;
  }
  return latest;
}

/**
 * The latest real time among a person's activity signals, or null when there is none. Sessions
 * alone are not enough: better-auth deletes the session row on sign-out, so `GET /api/team` also
 * passes times that outlive it (stock moves, audited writes). Values may arrive as SQL numbers or
 * numeric strings; blanks, zero, negatives and non-numbers are ignored.
 */
export function latestActivity(times: readonly unknown[]): number | null {
  let latest: number | null = null;
  for (const value of times) {
    const at = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    if (!Number.isFinite(at) || at <= 0) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/**
 * Invited until Rackline has any record of this person using it: a session they opened that is
 * still stored, or activity that outlives one. Someone who only looked around and then signed
 * out leaves no record, so the UI words this as "no activity on record", not "never signed in".
 */
export function teamMemberStatus(lastActive: number | null | undefined): TeamMemberStatus {
  return typeof lastActive === "number" && Number.isFinite(lastActive) && lastActive > 0 ? "active" : "invited";
}

export function teamStatusLabel(status: TeamMemberStatus): string {
  return status === "active" ? "Active" : "Invited";
}

/** Active reads green; invited is amber because the owner is waiting on that person to sign in. */
export function teamStatusTone(status: TeamMemberStatus): StatusTone {
  return status === "active" ? "success" : "warning";
}
