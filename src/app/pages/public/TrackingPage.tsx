import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink, Package, Truck } from "lucide-react";
import { api, ApiError, type PublicTracking, type PublicTrackingPackage } from "../../api";
import { ToneBadge } from "../../components/ui";
import type { StatusTone } from "@/domain/status";
import { formatDay, formatMoment, PublicLoading, PublicMessage, PublicShell, useNoIndex } from "./public-page";

const HEADLINES: Record<PublicTracking["order"]["status"], string> = {
  processing: "Getting your order ready",
  shipped: "On its way",
  delivered: "Delivered",
  cancelled: "This order was cancelled",
};

function statusTone(status: string | null): StatusTone {
  if (status === "delivered") return "success";
  if (status === "exception") return "danger";
  if (status === "in_transit") return "progress";
  return "info";
}

/** `/t/:token`: what a customer sees from the tracking link. No sign-in. */
export function TrackingPage() {
  const { token = "" } = useParams();
  const [view, setView] = useState<PublicTracking | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<PublicTracking>(`/api/track/${encodeURIComponent(token)}`)
      .then(setView)
      .catch((err: unknown) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setFailed(true)));
  }, [token]);

  useNoIndex(view ? `${view.shop.name} · Order ${view.order.number}` : "Track your order");

  if (missing || failed) {
    return (
      <PublicShell shop={null}>
        <PublicMessage
          title={missing ? "We could not find that tracking page" : "Tracking did not load"}
          body={
            missing
              ? "Check the link in your shipping message, or ask the shop that sent it for a new one."
              : "Check your connection and refresh the page."
          }
        />
      </PublicShell>
    );
  }
  if (!view) return <PublicLoading />;

  const single = view.packages.length === 1;
  return (
    <PublicShell shop={view.shop}>
      <section className="space-y-1">
        <p className="text-sm text-muted-foreground">Order {view.order.number}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{HEADLINES[view.order.status]}</h1>
        {view.order.destination ? (
          <p className="text-sm text-muted-foreground">Shipping to {view.order.destination}</p>
        ) : null}
      </section>

      {view.packages.map((pkg, index) => (
        <PackageCard key={pkg.trackingNumber ?? index} pkg={pkg} showItems={!single} />
      ))}

      {view.packages.length === 0 && view.order.status !== "cancelled" ? (
        <PublicMessage title="Not shipped yet" body="Tracking shows up here as soon as your order leaves the shop." />
      ) : null}

      {single || view.packages.length === 0 ? <ItemList items={view.items} /> : null}

      <p className="pt-2 text-center text-xs text-muted-foreground">Sent by {view.shop.name}</p>
    </PublicShell>
  );
}

function PackageCard({ pkg, showItems }: { pkg: PublicTrackingPackage; showItems: boolean }) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{pkg.label}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
            <Truck className="size-4 text-muted-foreground" aria-hidden />
            {pkg.service ?? pkg.carrier ?? "Carrier"}
          </p>
        </div>
        <ToneBadge tone={statusTone(pkg.status)}>{pkg.statusLabel}</ToneBadge>
      </div>

      {pkg.deliveredAt ? (
        <p className="text-sm">Delivered {formatMoment(pkg.deliveredAt)}</p>
      ) : pkg.estimatedDeliveryAt ? (
        <p className="text-sm">
          Estimated delivery <span className="font-medium">{formatDay(pkg.estimatedDeliveryAt)}</span>
        </p>
      ) : null}

      {pkg.trackingNumber ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Tracking number</p>
            <p className="truncate font-mono text-sm">{pkg.trackingNumber}</p>
          </div>
          {pkg.trackingUrl ? (
            <a
              href={pkg.trackingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
            >
              Track with {pkg.carrier ?? "the carrier"}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}

      {pkg.events.length > 0 ? (
        <ol className="space-y-3 border-l pl-4">
          {pkg.events.map((event, index) => (
            <li key={`${event.at}-${index}`} className="relative">
              <span
                aria-hidden
                className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card ${index === 0 ? "bg-primary" : "bg-muted-foreground/40"}`}
              />
              <p className="text-sm font-medium">{event.label}</p>
              {event.message && event.message !== event.label ? (
                <p className="text-sm text-muted-foreground">{event.message}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {formatMoment(event.at)}
                {event.place ? ` · ${event.place}` : ""}
              </p>
            </li>
          ))}
        </ol>
      ) : null}

      {showItems && pkg.items.length > 0 ? <ItemList items={pkg.items} bare /> : null}
    </section>
  );
}

function ItemList({ items, bare = false }: { items: { name: string; qty: number }[]; bare?: boolean }) {
  if (items.length === 0) return null;
  return (
    <section className={bare ? "space-y-2 border-t pt-3" : "space-y-2 rounded-lg border bg-card p-4 shadow-xs"}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Package className="size-4 text-muted-foreground" aria-hidden />
        {bare ? "In this package" : "In your order"}
      </h2>
      <ul className="divide-y text-sm">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate">{item.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">× {item.qty}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
