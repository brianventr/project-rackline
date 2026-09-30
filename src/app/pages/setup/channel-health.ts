import type { ChannelStatus } from "../../api";
import type { StatusTone } from "@/domain/status";

export function channelHealthBadge(row: Pick<ChannelStatus, "health" | "failedPostBacks">): { tone: StatusTone; label: string } {
  if (row.failedPostBacks > 0 && row.health !== "disconnected") return { tone: "danger", label: "Tracking failed" };
  switch (row.health) {
    case "live":
      return { tone: "success", label: "Live" };
    case "demo":
      return { tone: "info", label: "Sample orders" };
    case "csv":
      return { tone: "neutral", label: "CSV import" };
    case "error":
      return { tone: "danger", label: "Needs attention" };
    case "pending":
      return { tone: "warning", label: "Finishing sign-in" };
    case "paused":
      return { tone: "warning", label: "Paused" };
    default:
      return { tone: "neutral", label: "Not connected" };
  }
}
