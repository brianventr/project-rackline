import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { OperatingMode } from "@/domain/operating-mode";
import { api, type Me } from "./api";

const SessionContext = createContext<Me | null>(null);
const SetOperatingModeContext = createContext<((mode: OperatingMode) => void) | null>(null);
const RefreshSessionContext = createContext<(() => Promise<void>) | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [current, setCurrent] = useState(me);

  useEffect(() => {
    setCurrent(me);
  }, [me]);

  const refreshSession = useCallback(async () => {
    const fresh = await api<Me>("/api/me");
    setCurrent(fresh);
  }, []);

  function setOperatingMode(operatingMode: OperatingMode) {
    setCurrent((prev) => ({
      ...prev,
      organization: { ...prev.organization, operatingMode },
    }));
  }

  return (
    <SessionContext.Provider value={current}>
      <RefreshSessionContext.Provider value={refreshSession}>
        <SetOperatingModeContext.Provider value={setOperatingMode}>{children}</SetOperatingModeContext.Provider>
      </RefreshSessionContext.Provider>
    </SessionContext.Provider>
  );
}

/** Refresh header, building selection, and organization details after an explicit setup change. */
export function useRefreshSession(): () => Promise<void> {
  const refresh = useContext(RefreshSessionContext);
  if (!refresh) throw new Error("useRefreshSession must be used within SessionProvider");
  return refresh;
}

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useSession must be used within SessionProvider");
  return me;
}

export function useSetOperatingMode(): (mode: OperatingMode) => void {
  const setOperatingMode = useContext(SetOperatingModeContext);
  if (!setOperatingMode) throw new Error("useSetOperatingMode must be used within SessionProvider");
  return setOperatingMode;
}
