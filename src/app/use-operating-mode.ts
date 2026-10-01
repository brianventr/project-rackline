import { useState } from "react";
import { isGarageMode, type OperatingMode } from "@/domain/operating-mode";
import { api } from "./api";
import { refreshApi } from "./query";
import { useSession, useSetOperatingMode } from "./session";

export function useOperatingMode() {
  const me = useSession();
  const setOperatingMode = useSetOperatingMode();
  const [busy, setBusy] = useState(false);

  async function setMode(operatingMode: OperatingMode) {
    setBusy(true);
    try {
      await api("/api/organization", {
        method: "PATCH",
        body: JSON.stringify({ operatingMode }),
      });
      setOperatingMode(operatingMode);
      void refreshApi("/api/exceptions");
    } finally {
      setBusy(false);
    }
  }

  return {
    garage: isGarageMode(me.organization.operatingMode),
    owner: me.role === "owner",
    busy,
    setMode,
  };
}
