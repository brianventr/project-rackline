import { useEffect, useState } from "react";
import { firstFailure, queueCounts, type OfflinePost } from "@/domain/offline-queue";
import { dismissOfflineFailure, onOfflineQueueChange, readOfflineQueue } from "./offline-queue";

export function useOfflineQueue(): {
  pending: number;
  failed: number;
  failure: { id: string; message: string } | null;
  dismiss: () => void;
} {
  const [queue, setQueue] = useState<OfflinePost[]>([]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void readOfflineQueue().then((rows) => {
        if (live) setQueue(rows);
      });
    };
    refresh();
    const stop = onOfflineQueueChange(refresh);
    return () => {
      live = false;
      stop();
    };
  }, []);
  const counts = queueCounts(queue);
  const failure = firstFailure(queue);
  return {
    pending: counts.pending,
    failed: counts.failed,
    failure: failure ? { id: failure.id, message: failure.failureMessage ?? "The server refused this post." } : null,
    dismiss: () => {
      if (failure) void dismissOfflineFailure(failure.id);
    },
  };
}

/** Pending and failed floor posts. Renders nothing while the queue is empty. */
export function OfflineQueueNotice() {
  const { pending, failed, failure, dismiss } = useOfflineQueue();
  if (!pending && !failed) return null;
  const waiting =
    pending === 1 ? "1 post waiting to send." : pending > 1 ? `${pending} posts waiting to send.` : null;
  return (
    <div role="status" className="rounded-lg border bg-card px-3 py-2 text-sm">
      {waiting ? <p>{waiting}</p> : null}
      {failure ? (
        <p className={waiting ? "mt-1" : undefined}>
          <span className="font-medium">Not sent.</span> {failure.message}{" "}
          <button type="button" className="inline-flex min-h-11 items-center font-medium underline" onClick={dismiss}>
            Dismiss
          </button>
        </p>
      ) : null}
    </div>
  );
}
