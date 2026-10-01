import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, ExternalLink, Printer } from "lucide-react";
import { api, ApiError, type PublicReturnLabel } from "../../api";
import { BarcodeLabel } from "../../components/BarcodeLabel";
import { Button, ToneBadge } from "../../components/ui";
import {
  EventTimeline,
  ItemList,
  PublicLoading,
  PublicMessage,
  PublicShell,
  trackerTone,
  useNoIndex,
} from "./public-page";

function headline(status: string | null): string {
  if (status === "in_transit") return "Your return is on its way";
  if (status === "delivered") return "Your return arrived";
  if (status === "exception") return "Your return hit a delivery problem";
  return "Your return label is ready";
}

/** `/r/:token`: the label a customer prints to send a return back. No sign-in. */
export function ReturnLabelPage() {
  const { token = "" } = useParams();
  const [view, setView] = useState<PublicReturnLabel | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<PublicReturnLabel>(`/api/return-label/${encodeURIComponent(token)}`)
      .then(setView)
      .catch((err: unknown) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setFailed(true)));
  }, [token]);

  useNoIndex(view ? `${view.shop.name} · Return ${view.rmaNumber}` : "Your return label");

  if (missing || failed) {
    return (
      <PublicShell shop={null}>
        <PublicMessage
          title={missing ? "We could not find that return label" : "The return label did not load"}
          body={
            missing
              ? "Check the link the shop sent you, or ask them for a new one."
              : "Check your connection and refresh the page."
          }
        />
      </PublicShell>
    );
  }
  if (!view) return <PublicLoading />;

  const label = view.label;
  if (!label) {
    return (
      <PublicShell shop={view.shop}>
        <PublicMessage
          title="This return label was cancelled"
          body={`Ask ${view.shop.name || "the shop"} for a new label before you send anything back.`}
        />
      </PublicShell>
    );
  }

  const sent = view.trackerStatus != null && view.trackerStatus !== "pre_transit";
  return (
    <PublicShell shop={view.shop}>
      <section className="space-y-1 print:hidden">
        <p className="text-sm text-muted-foreground">Return {view.rmaNumber}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{headline(view.trackerStatus)}</h1>
        <p className="text-sm text-muted-foreground">
          Postage is paid. Send it back with {label.carrier} {label.service}.
        </p>
      </section>

      {!sent ? (
        <section className="space-y-3 rounded-lg border bg-card p-4 shadow-xs print:hidden">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>{label.labelUrl ? "Download and print the label." : "Print the label below."}</li>
            <li>Pack the items in a sturdy box and tape the label on top.</li>
            <li>Drop the box off with {label.carrier}, or hand it to your carrier pickup.</li>
          </ol>
          {label.labelUrl ? (
            <Button asChild>
              <a href={label.labelUrl} target="_blank" rel="noreferrer noopener">
                <Download className="size-4" aria-hidden />
                Download label
              </a>
            </Button>
          ) : (
            <Button onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              Print label
            </Button>
          )}
        </section>
      ) : null}

      {!label.labelUrl && !sent ? <PrintableReturnLabel view={view} label={label} /> : null}

      <section className="space-y-4 rounded-lg border bg-card p-4 shadow-xs print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Tracking number</p>
            <p className="truncate font-mono text-sm">{label.trackingNumber}</p>
          </div>
          <ToneBadge tone={trackerTone(view.trackerStatus)}>{view.statusLabel}</ToneBadge>
        </div>
        {label.trackingUrl ? (
          <a
            href={label.trackingUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
          >
            Track with {label.carrier}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
        <EventTimeline events={view.events} />
      </section>

      <ItemList items={view.items} title="What to send back" className="print:hidden" />

      <p className="pt-2 text-center text-xs text-muted-foreground print:hidden">Sent by {view.shop.name}</p>
    </PublicShell>
  );
}

/** The demo carrier has no label image, so the page draws one to print. */
function PrintableReturnLabel({
  view,
  label,
}: {
  view: PublicReturnLabel;
  label: NonNullable<PublicReturnLabel["label"]>;
}) {
  return (
    <section className="mx-auto max-w-md space-y-4 rounded-lg border-2 border-foreground bg-card p-5 print:max-w-none print:border-black">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">From</p>
        <p className="text-sm font-medium">{label.from.name}</p>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{label.from.address}</p>
      </div>
      <div className="border-t pt-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Ship to</p>
        <p className="mt-1 text-xl font-semibold">{label.to.name}</p>
        <p className="whitespace-pre-line">{label.to.address}</p>
      </div>
      <div className="border-t pt-4">
        <p className="text-sm text-muted-foreground">
          Return {view.rmaNumber} · {label.carrier} {label.service}
        </p>
        <p className="mt-1 font-mono text-2xl font-semibold tracking-wide">{label.trackingNumber}</p>
        <BarcodeLabel value={label.trackingNumber} className="mt-3 w-full" />
      </div>
    </section>
  );
}
