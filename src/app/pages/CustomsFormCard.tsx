import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { api, errorText, type CustomsGap, type OrderCustoms } from "../api";
import { Button, ErrorBanner } from "../components/ui";
import { cn } from "@/lib/utils";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const ounces = (oz: number) => `${oz} oz`;

const FIELD_LABELS: Record<CustomsGap["missing"][number], string> = {
  hsCode: "HS code",
  originCountry: "country of origin",
  customsValueCents: "declared value",
};

/**
 * The customs form for an international label. The carrier's own form opens from a link to print beside the
 * label; without one, Rackline's copy of the declaration prints on the page after the label.
 */
export function CustomsFormCard({ orderId, packageId, className }: { orderId: string; packageId?: string | null; className?: string }) {
  const [customs, setCustoms] = useState<OrderCustoms | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const query = packageId ? `?packageId=${encodeURIComponent(packageId)}` : "";
    api<OrderCustoms>(`/api/orders/${encodeURIComponent(orderId)}/customs${query}`)
      .then((next) => {
        if (!cancelled) setCustoms(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err, "Could not load the customs form."));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, packageId]);

  if (error) return <ErrorBanner error={error} />;
  if (!customs?.international) return null;
  const { declaration, formUrl, gaps } = customs;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-2xl border bg-card p-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Customs · {customs.fromCountry} to {customs.toCountry}
            </p>
            <p className="text-sm text-muted-foreground">
              {formUrl
                ? "The carrier made its own customs form. Print it and attach it with the label."
                : declaration
                  ? "Print this declaration with the label and attach it to the parcel."
                  : "This parcel crosses a border, so it needs customs details before a label."}
            </p>
          </div>
          {formUrl ? (
            <Button size="sm" variant="outline" asChild>
              <a href={formUrl} target="_blank" rel="noreferrer">
                <FileText className="size-4" />
                Open customs form
              </a>
            </Button>
          ) : null}
        </div>
        {gaps.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {gaps.map((gap) => (
              <li key={gap.sku}>
                {gap.itemId ? (
                  <Link className="font-medium underline" to={`/stock/items/${gap.itemId}`}>
                    {gap.sku}
                  </Link>
                ) : (
                  <span className="font-medium">{gap.sku}</span>
                )}{" "}
                <span className="text-muted-foreground">needs {gap.missing.map((field) => FIELD_LABELS[field]).join(", ")}.</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {declaration ? (
        <div
          className={cn(
            "rounded-2xl border bg-card p-6 text-sm print:break-before-page print:rounded-none print:border-0",
            formUrl && "print:hidden",
          )}
        >
          <div className="flex items-baseline justify-between gap-3 border-b pb-3">
            <p className="font-semibold uppercase tracking-wide">Customs declaration</p>
            <p className="font-mono text-xs text-muted-foreground">
              {customs.formKind} · {declaration.contents}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Fact label="From">{declaration.fromCountry}</Fact>
            <Fact label="To">{declaration.toCountry}</Fact>
            <Fact label="Invoice">{declaration.invoiceNumber}</Fact>
          </div>
          <table className="mt-4 w-full text-left">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Qty</th>
                <th className="py-1 pr-2 font-medium">Description</th>
                <th className="py-1 pr-2 font-medium">HS code</th>
                <th className="py-1 pr-2 font-medium">Origin</th>
                <th className="py-1 pr-2 text-right font-medium">Weight</th>
                <th className="py-1 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {declaration.items.map((item) => (
                <tr key={item.sku} className="border-t align-top">
                  <td className="py-1 pr-2 tabular-nums">{item.qty}</td>
                  <td className="py-1 pr-2">{item.description}</td>
                  <td className="py-1 pr-2 font-mono">{item.hsCode}</td>
                  <td className="py-1 pr-2">{item.originCountry}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{ounces(item.weightOz)}</td>
                  <td className="py-1 text-right tabular-nums">{money(item.valueCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td className="py-1 pr-2" colSpan={4}>
                  Total ({declaration.currency})
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {ounces(declaration.items.reduce((sum, item) => sum + item.weightOz, 0))}
                </td>
                <td className="py-1 text-right tabular-nums">{money(declaration.valueCents)}</td>
              </tr>
            </tfoot>
          </table>
          {declaration.exportFiling ? <p className="mt-3 font-mono text-xs">{declaration.exportFiling}</p> : null}
          <p className="mt-4 text-xs text-muted-foreground">
            I certify that the particulars given in this customs declaration are correct and that this parcel does not
            contain any dangerous article prohibited by legislation or by postal or customs regulations.
          </p>
          <p className="mt-2 text-xs">Signed: {declaration.signer}</p>
          {!customs.declared ? (
            <p className="mt-2 text-xs text-muted-foreground print:hidden">Built from each item's customs details today.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{children}</p>
    </div>
  );
}
