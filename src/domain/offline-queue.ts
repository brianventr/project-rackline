import { IDEMPOTENCY_IN_PROGRESS } from "./idempotency";

/** Posts the floor can keep on the device when fetch cannot reach the server. */
export const OFFLINE_KINDS = ["scan-session", "scan", "receive", "pick"] as const;
export type OfflineKind = (typeof OFFLINE_KINDS)[number];

export type OfflinePost = {
  id: string;
  /** Replay order. Lower goes first. */
  seq: number;
  kind: OfflineKind;
  /** Scans and the pick they prove share the order id. */
  groupId: string | null;
  path: string;
  body: string;
  idempotencyKey: string;
  /** Placeholder in later bodies until the scan-session replay returns the server id. */
  localSessionId: string | null;
  state: "pending" | "failed";
  failureStatus: number | null;
  failureMessage: string | null;
};

export type ReplayResult = { status: number; body: unknown };

/** What a replay should do with this HTTP result. A 4xx stays failed. A dropped connection is tried again. */
export type ReplayDisposition = "done" | "retry" | "failed";

export function responseCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("code" in body)) return null;
  const code = (body as { code: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function responseError(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = (body as { error: unknown }).error;
  return typeof error === "string" && error ? error : null;
}

/**
 * 2xx is done. Status 0 and 5xx are the network or the server being down, so try again.
 * A 4xx is the server's refusal and stays failed, except a key that is still running.
 */
export function replayDisposition(status: number, code: string | null): ReplayDisposition {
  if (status >= 200 && status < 300) return "done";
  if (status === 0 || status >= 500) return "retry";
  if (code === IDEMPOTENCY_IN_PROGRESS) return "retry";
  if (status >= 400 && status < 500) return "failed";
  return "retry";
}

export function orderedQueue(queue: readonly OfflinePost[]): OfflinePost[] {
  return [...queue].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
}

/**
 * Add a post. A scan or scan-session for a pick that is already queued is inserted ahead of that pick.
 * Sequence numbers are rewritten to match the new order.
 */
function sameGroup(row: OfflinePost, groupId: string | null): boolean {
  return groupId !== null && row.groupId === groupId;
}

export function enqueuePost(queue: readonly OfflinePost[], post: OfflinePost): OfflinePost[] {
  const next = orderedQueue(queue);
  if (post.kind === "scan-session") {
    const at = next.findIndex(
      (row) => sameGroup(row, post.groupId) && (row.kind === "scan" || row.kind === "scan-session" || row.kind === "pick"),
    );
    if (at >= 0) next.splice(at, 0, post);
    else next.push(post);
  } else if (post.kind === "scan") {
    const pickAt = next.findIndex((row) => row.kind === "pick" && sameGroup(row, post.groupId));
    if (pickAt >= 0) next.splice(pickAt, 0, post);
    else next.push(post);
  } else {
    next.push(post);
  }
  return next.map((row, index) => ({ ...row, seq: index + 1 }));
}

/** The next pending post, or null when the queue is empty or a failed post is ahead. */
export function nextReplay(queue: readonly OfflinePost[]): OfflinePost | null {
  for (const post of orderedQueue(queue)) {
    if (post.state === "failed") return null;
    if (post.state === "pending") return post;
  }
  return null;
}

/** Pending posts that will not send because a failed post is ahead of them. */
export function blockedBehindFailure(queue: readonly OfflinePost[]): OfflinePost[] {
  const ordered = orderedQueue(queue);
  const failedAt = ordered.findIndex((row) => row.state === "failed");
  if (failedAt < 0) return [];
  return ordered.slice(failedAt + 1).filter((row) => row.state === "pending");
}

export function queueCounts(queue: readonly OfflinePost[]): { pending: number; failed: number } {
  return {
    pending: queue.filter((row) => row.state === "pending").length,
    failed: queue.filter((row) => row.state === "failed").length,
  };
}

export function firstFailure(queue: readonly OfflinePost[]): OfflinePost | null {
  return orderedQueue(queue).find((row) => row.state === "failed") ?? null;
}

/** Drop one failed post so the posts behind it can send. A pending post is left alone. */
export function dismissFailure(queue: readonly OfflinePost[], id: string): OfflinePost[] {
  const ordered = orderedQueue(queue);
  const next = ordered.filter((row) => !(row.id === id && row.state === "failed"));
  if (next.length === ordered.length) return ordered;
  return next.map((row, index) => ({ ...row, seq: index + 1 }));
}

/** Write the server session id into later bodies that still name the local placeholder. */
export function bindServerSession(
  queue: readonly OfflinePost[],
  localSessionId: string,
  serverSessionId: string,
): OfflinePost[] {
  if (!localSessionId || localSessionId === serverSessionId) return [...queue];
  return queue.map((row) => {
    if (!row.body.includes(localSessionId) && row.localSessionId !== localSessionId) return row;
    return {
      ...row,
      body: row.body.split(localSessionId).join(serverSessionId),
      localSessionId: row.localSessionId === localSessionId ? null : row.localSessionId,
    };
  });
}

export function noteReplayResult(queue: readonly OfflinePost[], id: string, result: ReplayResult): OfflinePost[] {
  const post = queue.find((row) => row.id === id);
  if (!post) return orderedQueue(queue);
  const disposition = replayDisposition(result.status, responseCode(result.body));
  if (disposition === "retry") return orderedQueue(queue);
  if (disposition === "failed") {
    return orderedQueue(queue).map((row) =>
      row.id === id
        ? {
            ...row,
            state: "failed",
            failureStatus: result.status,
            failureMessage: responseError(result.body) ?? "The server refused this post.",
          }
        : row,
    );
  }
  let next = queue.filter((row) => row.id !== id);
  if (post.kind === "scan-session" && post.localSessionId) {
    const serverId =
      result.body && typeof result.body === "object" && "id" in result.body && typeof (result.body as { id: unknown }).id === "string"
        ? (result.body as { id: string }).id
        : null;
    if (serverId) next = bindServerSession(next, post.localSessionId, serverId);
  }
  return orderedQueue(next);
}

/**
 * Send whatever is next until a post must wait or the queue is idle.
 * A thrown send is a dropped connection: the queue is unchanged and the loop stops.
 */
export async function replayQueue(
  queue: readonly OfflinePost[],
  send: (post: OfflinePost) => Promise<ReplayResult>,
): Promise<OfflinePost[]> {
  let current = orderedQueue(queue);
  for (;;) {
    const next = nextReplay(current);
    if (!next) return current;
    let result: ReplayResult;
    try {
      result = await send(next);
    } catch {
      result = { status: 0, body: null };
    }
    if (replayDisposition(result.status, responseCode(result.body)) === "retry") return current;
    current = noteReplayResult(current, next.id, result);
  }
}
