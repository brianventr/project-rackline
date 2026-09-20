import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type ShippingLabel } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, ErrorBanner, PageHeader } from "../components/ui";
import { usePrint } from "../print/PrintProvider";

export function ShippingLabelPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const printer = usePrint();
  const [label, setLabel] = useState<ShippingLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<ShippingLabel>(`/api/orders/${id}/label`, { method: "POST", body: JSON.stringify({}) })
      .then(setLabel)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (!label) return <ErrorBanner error={error} />;

  return (
    <div className="mx-auto max-w-xl space-y-6 print:max-w-none">
      <PageHeader
        eyebrow="Outbound"
        title="Shipping label"
        description={`${label.carrierCompany} ${label.carrierService} · ${printer.statusLabel}`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="ghost" onClick={() => navigate(`/outbound/orders/${label.orderId}`)}>
              Order
            </Button>
            <Button variant="secondary">
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
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Ship to</p>
        <p className="mt-2 text-xl font-semibold">{label.customerName}</p>
        <p className="whitespace-pre-line text-muted-foreground">{label.shipToAddress}</p>
        <div className="mt-6 border-t pt-6">
          <p className="text-sm text-muted-foreground">
            {label.orderNumber} · {label.carrierCompany} {label.carrierService}
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-wide">{label.trackingNumber}</p>
          <BarcodeLabel value={label.trackingNumber} className="mt-4 w-full" />
        </div>
      </div>
    </div>
  );
}
