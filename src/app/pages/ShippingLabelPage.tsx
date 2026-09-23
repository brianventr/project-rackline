import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { api, ApiError, errorText, type ShippingLabel } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, EmptyState, ErrorBanner, PageHeader } from "../components/ui";
import { usePrint } from "../print/PrintProvider";

export function ShippingLabelPage() {
  const { id, packageId } = useParams();
  const navigate = useNavigate();
  const printer = usePrint();
  const [label, setLabel] = useState<ShippingLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [needsBuy, setNeedsBuy] = useState(false);

  function load() {
    if (!id) return;
    setError(null);
    const path = packageId ? `/api/orders/${id}/packages/${packageId}/label` : `/api/orders/${id}/label`;
    api<ShippingLabel>(path)
      .then((next) => {
        setLabel(next);
        setNeedsBuy(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) {
          setNeedsBuy(true);
          setError(null);
        } else {
          setError(errorText(err, "Could not load the label."));
        }
      });
  }

  useEffect(() => {
    load();
  }, [id, packageId]);

  async function buy() {
    if (!id) return;
    setError(null);
    try {
      const next = await api<ShippingLabel>(
        packageId ? `/api/orders/${id}/packages/${packageId}/label` : `/api/orders/${id}/label`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      setLabel(next);
      setNeedsBuy(false);
    } catch (err) {
      setError(errorText(err, "Could not buy the label."));
    }
  }

  if (!label) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <PageHeader eyebrow="Outbound" title="Shipping label" description="Buy a carrier label before printing." />
        <ErrorBanner error={error} />
        {needsBuy ? (
          <EmptyState
            icon={Printer}
            title="No label yet."
            body="Buy a carrier label for this order, then print it here."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => void buy()}>
                  Buy label
                </Button>
                {id ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/outbound/orders/${id}`}>Back to order</Link>
                  </Button>
                ) : null}
              </div>
            }
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 print:max-w-none">
      <PageHeader
        eyebrow="Outbound"
        title="Shipping label"
        description={`${label.carrierCompany} ${label.carrierService} · ${printer.statusLabel}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="ghost" onClick={() => navigate(`/outbound/orders/${label.orderId}`)}>
              Order
            </Button>
            <Button variant="secondary" asChild>
              <Link to={`/floor/ship?id=${label.orderId}`}>Ship</Link>
            </Button>
            <Button
              onClick={() => {
                void printer
                  .print({
                    kind: "shipping-label",
                    title: label.orderNumber,
                    data: {
                      orderNumber: label.orderNumber,
                      customerName: label.customerName,
                      shipToAddress: label.shipToAddress,
                      carrierCompany: label.carrierCompany,
                      carrierService: label.carrierService,
                      trackingNumber: label.trackingNumber,
                    },
                    refType: "order",
                    refId: label.orderId,
                  })
                  .then((result) => {
                    setMessage(result.message);
                    if (!result.ok) setError(result.message);
                  });
              }}
            >
              Print
            </Button>
          </div>
        }
      />
      <ErrorBanner error={error} />
      {message ? <p className="print:hidden text-sm text-muted-foreground">{message}</p> : null}
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
            <a
              className="mt-1 inline-block text-sm underline print:hidden"
              href={label.trackingUrl}
              target="_blank"
              rel="noreferrer"
            >
              Track shipment
            </a>
          ) : null}
          <BarcodeLabel value={label.trackingNumber} className="mt-4 w-full" />
        </div>
      </div>
    </div>
  );
}
