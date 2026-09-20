import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type ShippingLabel } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, ErrorBanner, PageHeader } from "../components/ui";

export function ShippingLabelPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [label, setLabel] = useState<ShippingLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsBuy, setNeedsBuy] = useState(false);

  function load() {
    if (!id) return;
    setError(null);
    api<ShippingLabel>(`/api/orders/${id}/label`)
      .then((next) => {
        setLabel(next);
        setNeedsBuy(false);
      })
      .catch((err: Error) => {
        if (err instanceof ApiError && err.status === 409) {
          setNeedsBuy(true);
          setError(null);
        } else {
          setError(err.message);
        }
      });
  }

  useEffect(() => {
    load();
  }, [id]);

  async function buy() {
    if (!id) return;
    setError(null);
    try {
      const next = await api<ShippingLabel>(`/api/orders/${id}/label`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setLabel(next);
      setNeedsBuy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not buy label");
    }
  }

  if (!label) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <PageHeader eyebrow="Outbound" title="Shipping label" description="Buy a carrier label before printing." />
        <ErrorBanner error={error} />
        {needsBuy ? (
          <Button onClick={() => void buy()}>Buy label</Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 print:max-w-none">
      <PageHeader
        eyebrow="Outbound"
        title="Shipping label"
        description={`${label.carrierCompany} ${label.carrierService}`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="ghost" onClick={() => navigate(`/outbound/orders/${label.orderId}`)}>
              Order
            </Button>
            <Button variant="secondary" asChild>
              <Link to={`/floor/ship?id=${label.orderId}`}>Ship</Link>
            </Button>
            <Button onClick={() => window.print()}>Print</Button>
          </div>
        }
      />
      <ErrorBanner error={error} />
      <div className="rounded-2xl border bg-card p-6">
        {label.shipFromAddress ? (
          <div className="mb-4">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Ship from</p>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{label.shipFromAddress}</p>
          </div>
        ) : null}
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Ship to</p>
        <p className="mt-2 text-xl font-semibold">{label.customerName}</p>
        <p className="whitespace-pre-line text-muted-foreground">{label.shipToAddress}</p>
        <div className="mt-6 border-t pt-6">
          <p className="text-sm text-muted-foreground">
            {label.orderNumber} · {label.carrierCompany} {label.carrierService}
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-wide">{label.trackingNumber}</p>
          {label.trackingUrl ? (
            <a className="mt-1 inline-block text-sm underline print:hidden" href={label.trackingUrl} target="_blank" rel="noreferrer">
              Track shipment
            </a>
          ) : null}
          <BarcodeLabel value={label.trackingNumber} className="mt-4 w-full" />
        </div>
      </div>
    </div>
  );
}
