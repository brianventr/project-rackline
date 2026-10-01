import { ApiError, api } from "./api";
import {
  dismissFailure,
  enqueuePost,
  orderedQueue,
  replayQueue,
  type OfflineKind,
  type OfflinePost,
} from "@/domain/offline-queue";

const DB_NAME = "rackline-offline";
const STORE = "posts";
const EVENT = "rackline-offline-queue";

export class OfflineQueued extends Error {
  readonly offlineQueued = true;
  constructor(
    readonly kind: OfflineKind,
    readonly sessionId: string | null = null,
  ) {
    super(offlineQueuedMessage(kind));
    this.name = "OfflineQueued";
  }
}

export function isOfflineQueued(err: unknown): err is OfflineQueued {
  return err instanceof OfflineQueued;
}

export function offlineQueuedMessage(kind: OfflineKind): string {
  if (kind === "scan" || kind === "scan-session") {
    return "Scans saved on this device. They will post when the connection returns.";
  }
  return "Saved on this device. It will post when the connection returns.";
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

type QueueInput = {
  kind: OfflineKind;
  path: string;
  body: unknown;
  groupId?: string | null;
  localSessionId?: string | null;
  idempotencyKey?: string;
};

let chain: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function publish(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function onOfflineQueueChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readOfflineQueue(): Promise<OfflinePost[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  const rows = await new Promise<OfflinePost[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    tx.oncomplete = () => {
      db.close();
      resolve(orderedQueue((req.result as OfflinePost[]) ?? []));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
  return rows;
}

async function writeQueue(rows: readonly OfflinePost[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    for (const row of rows) store.put(row);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function makePost(input: QueueInput, idempotencyKey: string): OfflinePost {
  return {
    id: newIdempotencyKey(),
    seq: 0,
    kind: input.kind,
    groupId: input.groupId ?? null,
    path: input.path,
    body: JSON.stringify(input.body ?? {}),
    idempotencyKey,
    localSessionId: input.localSessionId ?? null,
    state: "pending",
    failureStatus: null,
    failureMessage: null,
  };
}

/** Keep a post without trying the network. Used when scans are already queued ahead of a pick. */
export function queueFloorPost(input: QueueInput): Promise<void> {
  const idempotencyKey = input.idempotencyKey ?? newIdempotencyKey();
  return serial(async () => {
    const queue = await readOfflineQueue();
    await writeQueue(enqueuePost(queue, makePost(input, idempotencyKey)));
    publish();
  });
}

/**
 * Post as usual. When fetch itself fails, keep the post and throw OfflineQueued.
 * A 4xx or 5xx from the server is thrown as ApiError and is not queued.
 */
export async function postOrQueue<T>(input: QueueInput): Promise<T> {
  const idempotencyKey = input.idempotencyKey ?? newIdempotencyKey();
  const headers = new Headers();
  if (input.kind === "receive" || input.kind === "pick") headers.set("Idempotency-Key", idempotencyKey);
  try {
    return await api<T>(input.path, {
      method: "POST",
      body: JSON.stringify(input.body ?? {}),
      headers,
    });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 0) throw err;
    await queueFloorPost({ ...input, idempotencyKey });
    throw new OfflineQueued(input.kind, input.localSessionId ?? null);
  }
}

let flushing = false;

export async function flushOfflineQueue(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  flushing = true;
  try {
    await serial(async () => {
      const queue = await readOfflineQueue();
      if (!queue.length) return;
      const next = await replayQueue(queue, async (post) => {
        const headers = new Headers({ "Content-Type": "application/json" });
        if (post.kind === "receive" || post.kind === "pick") headers.set("Idempotency-Key", post.idempotencyKey);
        const res = await fetch(post.path, {
          method: "POST",
          credentials: "include",
          headers,
          body: post.body,
        });
        const body: unknown = await res.json().catch(() => ({}));
        return { status: res.status, body };
      });
      await writeQueue(next);
      publish();
    });
  } finally {
    flushing = false;
  }
}

export async function dismissOfflineFailure(id: string): Promise<void> {
  await serial(async () => {
    const queue = await readOfflineQueue();
    await writeQueue(dismissFailure(queue, id));
    publish();
  });
  void flushOfflineQueue();
}

/** Replay when the browser comes back online. */
export function watchOfflineQueue(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => {
    void flushOfflineQueue();
  });
  void flushOfflineQueue();
}
