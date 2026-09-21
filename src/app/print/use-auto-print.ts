import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export function useAutoPrint(ready: boolean) {
  const [params] = useSearchParams();
  useEffect(() => {
    if (!ready || params.get("print") !== "1") return;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [ready, params]);
}
