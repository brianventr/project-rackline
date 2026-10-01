import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink, Truck } from "lucide-react";
import { api, ApiError, type PublicTracking, type PublicTrackingPackage } from "../../api";
import { ToneBadge } from "../../components/ui";
import {
  EventTimeline,
  formatDay,
  formatMoment,
  ItemList,
  PublicLoading,
  PublicMessage,
  PublicShell,
  trackerTone,
  useNoIndex,
} from "./public-page";

const HEADLINES: Record<PublicTracking["order"]["status"], string> = {
  processing: "Getting your order ready",
  shipped: "On its way",
  delivered: "Delivered",
  cancelled: "This order was cancelled",
};

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

      {single || view.packages.length === 0 ? <ItemList items={view.items} title="In your order" /> : null}

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
        <ToneBadge tone={trackerTone(pkg.status)}>{pkg.statusLabel}</ToneBadge>
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

      <EventTimeline events={pkg.events} />

      {showItems ? <ItemList items={pkg.items} title="In this package" bare /> : null}
    </section>
  );
}
