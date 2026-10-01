import { toast } from "sonner";
import { api, errorText, type TrackingLink } from "./api";

/** Puts a customer-facing link on the clipboard; when the browser refuses, the toast shows it to copy by hand. */
export async function copyPublicLink(url: string, label: string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error("No clipboard");
    await navigator.clipboard.writeText(url);
    toast.success(`${label} copied.`, { description: url });
  } catch {
    toast.message(`Copy the ${label.toLowerCase()} below.`, { description: url, duration: 15_000 });
  }
}

/** The order's tracking page link (`/t/:token`), minted on first use. */
export async function copyTrackingLink(orderId: string): Promise<void> {
  let link: TrackingLink;
  try {
    link = await api<TrackingLink>(`/api/orders/${encodeURIComponent(orderId)}/tracking-link`, { method: "POST" });
  } catch (err) {
    toast.error(errorText(err, "Could not make the tracking link."));
    return;
  }
  await copyPublicLink(link.url, "Tracking link");
}
