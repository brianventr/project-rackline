import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { OperatingMode } from "@/domain/operating-mode";
import type { Me } from "./api";

const SessionContext = createContext<Me | null>(null);
const SetOperatingModeContext = createContext<((mode: OperatingMode) => void) | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [current, setCurrent] = useState(me);

  useEffect(() => {
    setCurrent(me);
  }, [me]);

  function setOperatingMode(operatingMode: OperatingMode) {
    setCurrent((prev) => ({
      ...prev,
      organization: { ...prev.organization, operatingMode },
    }));
  }

  return (
    <SessionContext.Provider value={current}>
      <SetOperatingModeContext.Provider value={setOperatingMode}>{children}</SetOperatingModeContext.Provider>
    </SessionContext.Provider>
  );
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
