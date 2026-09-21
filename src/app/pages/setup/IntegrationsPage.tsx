import { Link } from "react-router-dom";
import { Store, Truck } from "lucide-react";
import { Integration, IntegrationCard } from "@/components/ui/integration-card";
import { Button, Card, PageHeader } from "../../components/ui";

export function IntegrationsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Integrations"
        description="Connect checkout and shipping so customer orders, fulfillments, and labels stay in one workflow."
      />

      <IntegrationCard
        visual={<Integration />}
        title="Seamless Integrations"
        description="Connect Shopify checkout and carrier accounts without switching between platforms to finish a ship."
        url="/setup/shopify"
      />

      <div className="mx-auto mt-6 grid w-full gap-4 sm:max-w-141 sm:grid-cols-2">
        <Card>
          <div className="flex items-start gap-3">
            <div className="bg-muted flex size-9 items-center justify-center rounded-md border">
              <Store className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Shopify</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Customer checkout lands as a pick ticket. Sellable qty is pushed back so the storefront does not oversell. After ship, Rackline posts fulfillment.
              </p>
              <Button asChild className="mt-4" variant="secondary">
                <Link to="/setup/shopify">Open Shopify</Link>
              </Button>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div className="bg-muted flex size-9 items-center justify-center rounded-md border">
              <Truck className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Carriers</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine. Live EasyPost / ShipEngine buys postage; direct accounts still mint tracking locally.
              </p>
              <Button asChild className="mt-4" variant="secondary">
                <Link to="/setup/carriers">Open carriers</Link>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
