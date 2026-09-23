import { useCallback, useState } from "react";
import { toast } from "sonner";
import { refreshApi } from "./query";

/**
 * One way to run a write from a page: clear the old error, run it, toast the result,
 * refresh whatever else is on screen (sidebar counts, activity), and keep failures in a banner.
 */
export function useWrite() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T,>(
      label: string,
      write: () => Promise<T>,
      success?: string | ((result: T) => string | null | undefined),
    ): Promise<T | undefined> => {
      setError(null);
      setBusy(true);
      try {
        const result = await write();
        void refreshApi();
        const message = typeof success === "function" ? success(result) : success;
        if (message) toast.success(message);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : `${label} failed`);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { error, setError, busy, run };
}
