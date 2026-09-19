import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Item, type Location, type Order } from "../../api";
import { Button, Card, ErrorBanner, PageHeader } from "../../components/ui";
import { packSlipJobs, shippingLabelJobs } from "@/domain/print-station";

export function LabelsSetupPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<Order[]>("/api/orders"), api<Item[]>("/api/items"), api<Location[]>("/api/locations")])
      .then(([nextOrders, nextItems, nextLocations]) => {
        setOrders(nextOrders);
        setItems(nextItems);
        setLocations(nextLocations);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const slips = packSlipJobs(orders);
  const labels = shippingLabelJobs(orders);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Print station"
        description="Bay labels, SKU labels, pack slips, and shipping labels from one bench."
        actions={
          <Button variant="secondary" asChild>
            <Link to="/floor/print">Floor print</Link>
          </Button>
        }
      />
      <ErrorBanner error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="space-y-3">
          <p className="font-medium">Sheets</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link className="underline" to="/stock/locations?labels=1">
                Print bay labels
              </Link>
              <span className="text-muted-foreground"> · {locations.length} bays</span>
            </li>
            <li>
              <Link className="underline" to="/stock/items?labels=1">
                Print SKU labels
              </Link>
              <span className="text-muted-foreground"> · {items.length} items</span>
            </li>
          </ul>
        </Card>
        <Card className="space-y-3">
          <p className="font-medium">Scan prefixes</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">LOC:</span>, <span className="font-mono">SKU:</span>,{" "}
            <span className="font-mono">ORD:</span>, <span className="font-mono">RCP:</span>,{" "}
            <span className="font-mono">PO:</span>, <span className="font-mono">RMA:</span>,{" "}
            <span className="font-mono">WO:</span>, <span className="font-mono">RPL:</span>,{" "}
            <span className="font-mono">KIT:</span>
          </p>
          <p className="text-sm text-muted-foreground">USB and Bluetooth guns work on every screen. Camera scan is in the header.</p>
        </Card>
      </div>
      <Card>
        <p className="mb-3 font-medium">Pack slips</p>
        <ul className="space-y-2 text-sm">
          {slips.map((job) => (
            <li key={job.href}>
              <Link className="font-mono underline" to={job.href}>
                {job.title}
              </Link>
              <span className="text-muted-foreground"> · {job.subtitle}</span>
            </li>
          ))}
          {slips.length === 0 ? <li className="text-muted-foreground">No orders far enough along to print a slip.</li> : null}
        </ul>
      </Card>
      <Card>
        <p className="mb-3 font-medium">Shipping labels</p>
        <ul className="space-y-2 text-sm">
          {labels.map((job) => (
            <li key={job.href}>
              <Link className="font-mono underline" to={job.href}>
                {job.title}
              </Link>
              <span className="text-muted-foreground"> · {job.subtitle}</span>
            </li>
          ))}
          {labels.length === 0 ? <li className="text-muted-foreground">No picked or packed orders.</li> : null}
        </ul>
      </Card>
    </div>
  );
}
