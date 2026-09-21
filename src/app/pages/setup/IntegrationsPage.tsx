import { Link } from "react-router-dom";
import { Store, Truck } from "lucide-react";
import { Button, PageHeader } from "../../components/ui";

export function IntegrationsPage() {
  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Setup"
        title="Integrations"
        description="Connect checkout and shipping so customer orders, fulfillments, and labels stay in one workflow."
      />
      <div className="divide-y rounded-md border bg-card">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="bg-muted flex size-7 items-center justify-center rounded-md border">
            <Store className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Shopify</p>
            <p className="text-xs text-muted-foreground">Checkout → pick ticket. Sellable qty and fulfillment post back.</p>
          </div>
          <Button asChild size="xs" variant="secondary">
            <Link to="/setup/shopify">Open</Link>
          </Button>
        </div>
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="bg-muted flex size-7 items-center justify-center rounded-md border">
            <Truck className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Carriers</p>
            <p className="text-xs text-muted-foreground">UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine.</p>
          </div>
          <Button asChild size="xs" variant="secondary">
            <Link to="/setup/carriers">Open</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
