import { useEffect, useState } from "react";
import { api, type Me } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, onSubmit } from "../../components/ui";
import { useApiQuery } from "../../query";
import { useWrite } from "../../use-write";
import { brandInk, parseBrandColor } from "@/domain/branding";

/** Shop branding for the customer tracking and return-label pages (`PATCH /api/organization`). */
export function TrackingPageCard({ disabled }: { disabled: boolean }) {
  const me = useApiQuery<Me>("/api/me");
  const write = useWrite();
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const org = me.data?.organization;

  useEffect(() => {
    if (!org) return;
    setBrandColor(org.brandColor ?? "");
    setLogoUrl(org.logoUrl ?? "");
  }, [org?.brandColor, org?.logoUrl]);

  let preview: string | null = null;
  try {
    preview = parseBrandColor(brandColor);
  } catch {
    preview = null;
  }

  async function save() {
    await write.run(
      "Save tracking page",
      () => api("/api/organization", { method: "PATCH", body: JSON.stringify({ brandColor, logoUrl }) }),
      "Tracking page saved.",
    );
  }

  return (
    <Card>
      <form className="space-y-3" onSubmit={onSubmit(save)}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Tracking page</h2>
          <p className="text-sm text-muted-foreground">
            Customers open it from the tracking link you copy on an order or the Ship queue, and from a return label link. It shows
            your shop name, plus this colour and logo when set.
          </p>
        </div>
        <ErrorBanner error={write.error} />
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <Field label="Brand colour">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick a brand colour"
                className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-card p-0.5"
                value={preview ?? "#111827"}
                onChange={(event) => setBrandColor(event.target.value)}
              />
              <Input value={brandColor} onChange={(event) => setBrandColor(event.target.value)} placeholder="#1f6feb" />
            </div>
          </Field>
          <Field label="Logo URL">
            <Input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://example.com/logo.png" />
          </Field>
        </div>
        <div
          className="flex h-12 items-center gap-3 rounded-md border px-3"
          style={preview ? { backgroundColor: preview, color: brandInk(preview) } : undefined}
        >
          {logoUrl.startsWith("https://") ? <img src={logoUrl} alt="" referrerPolicy="no-referrer" className="h-7 max-w-32 object-contain" /> : null}
          <span className="truncate text-sm font-semibold">{org?.name ?? "Your shop"}</span>
          <span className="ml-auto text-xs opacity-75">Preview</span>
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={disabled || write.busy || !org}>
            Save tracking page
          </Button>
        </div>
      </form>
    </Card>
  );
}
