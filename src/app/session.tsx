import { createContext, useContext, type ReactNode } from "react";
import type { Me } from "./api";

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useSession must be used within SessionProvider");
  return me;
}
