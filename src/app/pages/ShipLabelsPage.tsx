import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { api, errorText, type ShippingLabel } from "../api";
import { Button, EmptyState, ErrorBanner, PageHeader } from "../components/ui";
import { usePrint } from "../print/PrintProvider";
import { resolvePrinterForKind } from "@/domain/print-station";
import { ShippingLabelCard, shippingLabelJob } from "./ShippingLabelPage";

/** Every label from one ship run on one page: a single browser print, or one job per label on a thermal printer. */
export function ShipLabelsPage() {
  const [params] = useSearchParams();
  const printer = usePrint();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const [labels, setLabels] = useState<ShippingLabel[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled(ids.map((id) => api<ShippingLabel>(`/api/orders/${id}/label`))).then((results) => {
      if (cancelled) return;
      setLabels(results.flatMap((row) => (row.status === "fulfilled" ? [row.value] : [])));
      setErrors(results.flatMap((row) => (row.status === "rejected" ? [errorText(row.reason, "A label could not load.")] : [])));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const printerId = resolvePrinterForKind(printer.station, printer.printers, "shipping-label");
  const thermal = printer.printers.find((row) => row.id === printerId && row.connection !== "browser") ?? null;

  async function printAll() {
    if (!labels?.length) return;
    if (!thermal) {
      window.print();
      setMessage(`Opened print for ${labels.length} ${labels.length === 1 ? "label" : "labels"}.`);
      return;
    }
    let sent = 0;
    for (const label of labels) {
      const result = await printer.print(shippingLabelJob(label));
      if (!result.ok) {
        setMessage(`${label.orderNumber}: ${result.message}`);
        return;
      }
      sent += 1;
    }
    setMessage(`Sent ${sent} ${sent === 1 ? "label" : "labels"} to ${thermal.name}.`);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 print:max-w-none print:space-y-0">
      <PageHeader
        eyebrow="Ship"
        title={labels ? `${labels.length} ${labels.length === 1 ? "label" : "labels"}` : "Labels"}
        description={printer.statusLabel}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="ghost" asChild>
              <Link to="/ship">Back to Ship</Link>
            </Button>
            <Button disabled={!labels?.length} onClick={() => void printAll()}>
              <Printer className="size-4" />
              Print all
            </Button>
          </div>
        }
      />
      {errors.length ? <ErrorBanner error={errors.join(" ")} /> : null}
      {message ? <p className="text-sm text-muted-foreground print:hidden">{message}</p> : null}
      {labels && labels.length === 0 ? (
        <EmptyState icon={Printer} title="No labels to print." body="Ship an order first, then its label shows up here." />
      ) : null}
      {(labels ?? []).map((label) => (
        <ShippingLabelCard key={label.orderId} label={label} className="print:break-after-page print:rounded-none print:border-0" />
      ))}
    </div>
  );
}
