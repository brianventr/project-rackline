import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type Me } from "./api";
import { AppShell } from "./pages/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { LandingPage } from "./pages/LandingPage";
import { TodayPage } from "./pages/TodayPage";
import { LivePage } from "./pages/LivePage";
import { ItemsPage } from "./pages/ItemsPage";
import { LocationsPage } from "./pages/LocationsPage";
import { InventoryPage } from "./pages/InventoryPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { OrdersPage } from "./pages/OrdersPage";
import { BomsPage } from "./pages/BomsPage";
import { WorkOrdersPage } from "./pages/WorkOrdersPage";
import { AdjustmentsPage } from "./pages/AdjustmentsPage";
import { ShopifyPage } from "./pages/ShopifyPage";
import { TransfersPage } from "./pages/TransfersPage";
import { CycleCountsPage } from "./pages/CycleCountsPage";
import { HoldsPage } from "./pages/HoldsPage";
import { LedgerPage } from "./pages/LedgerPage";
import { MapPage } from "./pages/MapPage";
import { FloorPutawayPage } from "./pages/floor/FloorPutawayPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { ReturnsPage } from "./pages/ReturnsPage";
import { VendorReturnsPage } from "./pages/VendorReturnsPage";
import { FloorLauncherPage } from "./pages/floor/FloorLauncherPage";
import { FloorPrintPage } from "./pages/floor/FloorPrintPage";
import { FloorLookupPage } from "./pages/floor/FloorLookupPage";
import { FloorReceivePage } from "./pages/floor/FloorReceivePage";
import { FloorPickPage } from "./pages/floor/FloorPickPage";
import { FloorPackPage } from "./pages/floor/FloorPackPage";
import { FloorShipPage } from "./pages/floor/FloorShipPage";
import { FloorCountPage } from "./pages/floor/FloorCountPage";
import { FloorHoldPage } from "./pages/floor/FloorHoldPage";
import { FloorAssemblePage } from "./pages/floor/FloorAssemblePage";
import { FloorReturnPage } from "./pages/floor/FloorReturnPage";
import { FloorRtvPage } from "./pages/floor/FloorRtvPage";
import { FloorReplenishPage } from "./pages/floor/FloorReplenishPage";
import { FloorKitPage } from "./pages/floor/FloorKitPage";
import { WarehouseSetupPage } from "./pages/setup/WarehouseSetupPage";
import { TeamPage } from "./pages/setup/TeamPage";
import { AuditPage } from "./pages/setup/AuditPage";
import { LabelsSetupPage } from "./pages/setup/LabelsSetupPage";
import { CarriersPage } from "./pages/setup/CarriersPage";
import { IntegrationsPage } from "./pages/setup/IntegrationsPage";
import { ClientsPage } from "./pages/setup/ClientsPage";
import { ZonesPage } from "./pages/setup/ZonesPage";
import { BillingPage } from "./pages/setup/BillingPage";
import { EdiPage } from "./pages/setup/EdiPage";
import { ReplenishmentsPage } from "./pages/ReplenishmentsPage";
import { KitsPage } from "./pages/KitsPage";
import { WavesPage } from "./pages/WavesPage";
import { AsnsPage } from "./pages/AsnsPage";
import { YardPage } from "./pages/YardPage";
import { LaborPage } from "./pages/LaborPage";
import { TrafficPage } from "./pages/TrafficPage";
import { RunwayPage } from "./pages/RunwayPage";
import { FloorWavePage } from "./pages/floor/FloorWavePage";
import { FloorAsnPage } from "./pages/floor/FloorAsnPage";
import { FloorYardPage } from "./pages/floor/FloorYardPage";
import { FloorCheckoutPage } from "./pages/floor/FloorCheckoutPage";
import { EquipmentPage } from "./pages/EquipmentPage";
import { ShippingLabelPage } from "./pages/ShippingLabelPage";
import { PackSlipPage } from "./pages/PackSlipPage";
import { OrderPickListPage, WavePickListPage } from "./pages/PickListPage";
import { ScannerProvider } from "./scanner/ScannerProvider";
import { PrintProvider } from "./print/PrintProvider";
import { homePath, OwnerOnly } from "./warehouse";

function Guard({ me }: { me: Me | null }) {
  if (!me) return <Navigate to="/login" replace />;
  return (
    <ScannerProvider>
      <PrintProvider>
        <AppShell me={me} />
      </PrintProvider>
    </ScannerProvider>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3 text-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          Opening the warehouse…
        </div>
      </div>
    );
  }

  const signedInHome = me ? homePath(me.role) : "/";

  return (
    <Routes>
      <Route path="/" element={me ? <Navigate to={signedInHome} replace /> : <LandingPage />} />
      <Route path="/login" element={me ? <Navigate to={signedInHome} replace /> : <AuthPage />} />
      <Route path="/signup" element={me ? <Navigate to={signedInHome} replace /> : <AuthPage mode="signup" />} />
      <Route path="/forgot" element={me ? <Navigate to={signedInHome} replace /> : <AuthPage mode="forgot" />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<Guard me={me} />}>
        <Route path="/today" element={<TodayPage />} />
        <Route
          path="/live"
          element={
            <OwnerOnly>
              <LivePage />
            </OwnerOnly>
          }
        />
        <Route
          path="/labor"
          element={
            <OwnerOnly>
              <LaborPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/labor/staff/:userId"
          element={
            <OwnerOnly>
              <LaborPage />
            </OwnerOnly>
          }
        />
        <Route path="/setup/labor" element={<Navigate to="/labor" replace />} />
        <Route path="/analytics/traffic" element={<TrafficPage />} />
        <Route path="/analytics/runway" element={<RunwayPage />} />
        <Route path="/dashboard" element={<Navigate to="/today" replace />} />
        <Route path="/floor" element={<FloorLauncherPage />} />
        <Route path="/floor/lookup" element={<FloorLookupPage />} />
        <Route path="/floor/print" element={<FloorPrintPage />} />
        <Route path="/floor/receive" element={<FloorReceivePage />} />
        <Route path="/floor/asn" element={<FloorAsnPage />} />
        <Route path="/floor/yard" element={<FloorYardPage />} />
        <Route path="/floor/checkout" element={<FloorCheckoutPage />} />
        <Route path="/floor/putaway" element={<FloorPutawayPage />} />
        <Route path="/floor/pick" element={<FloorPickPage />} />
        <Route path="/floor/wave" element={<FloorWavePage />} />
        <Route path="/floor/pack" element={<FloorPackPage />} />
        <Route path="/floor/ship" element={<FloorShipPage />} />
        <Route path="/floor/count" element={<FloorCountPage />} />
        <Route path="/floor/hold" element={<FloorHoldPage />} />
        <Route path="/floor/assemble" element={<FloorAssemblePage />} />
        <Route path="/floor/kit" element={<FloorKitPage />} />
        <Route path="/floor/replenish" element={<FloorReplenishPage />} />
        <Route path="/floor/return" element={<FloorReturnPage />} />
        <Route path="/floor/rtv" element={<FloorRtvPage />} />
        <Route
          path="/floor/adjust"
          element={
            <OwnerOnly>
              <AdjustmentsPage />
            </OwnerOnly>
          }
        />
        <Route path="/map" element={me ? <MapPage me={me} /> : null} />
        <Route path="/equipment" element={<EquipmentPage />} />
        <Route path="/equipment/:id" element={<EquipmentPage />} />
        <Route path="/move" element={<Navigate to="/floor/putaway" replace />} />
        <Route path="/inbound/receipts" element={<ReceiptsPage />} />
        <Route path="/inbound/receipts/:id" element={<ReceiptsPage />} />
        <Route path="/inbound/asns" element={<AsnsPage />} />
        <Route path="/inbound/asns/:id" element={<AsnsPage />} />
        <Route path="/inbound/yard" element={<YardPage />} />
        <Route path="/inbound/yard/:id" element={<YardPage />} />
        <Route path="/inbound/putaway" element={<TransfersPage />} />
        <Route path="/inbound/putaway/:id" element={<TransfersPage />} />
        <Route path="/inbound/purchases" element={<PurchasesPage />} />
        <Route path="/inbound/purchases/:id" element={<PurchasesPage />} />
        <Route path="/inbound/vendor-returns" element={<VendorReturnsPage />} />
        <Route path="/inbound/vendor-returns/:id" element={<VendorReturnsPage />} />
        <Route path="/stock" element={<InventoryPage />} />
        <Route path="/stock/items" element={me ? <ItemsPage me={me} /> : null} />
        <Route path="/stock/items/:id" element={me ? <ItemsPage me={me} /> : null} />
        <Route path="/stock/locations" element={me ? <LocationsPage me={me} /> : null} />
        <Route path="/stock/locations/:id" element={me ? <LocationsPage me={me} /> : null} />
        <Route path="/stock/counts" element={<CycleCountsPage />} />
        <Route path="/stock/counts/:id" element={<CycleCountsPage />} />
        <Route path="/stock/holds" element={<HoldsPage />} />
        <Route path="/stock/holds/:id" element={<HoldsPage />} />
        <Route path="/stock/replenish" element={<ReplenishmentsPage />} />
        <Route path="/stock/replenish/:id" element={<ReplenishmentsPage />} />
        <Route path="/stock/ledger" element={<LedgerPage />} />
        <Route path="/make/recipes" element={me ? <BomsPage me={me} /> : null} />
        <Route path="/make/work-orders" element={<WorkOrdersPage />} />
        <Route path="/make/work-orders/:id" element={<WorkOrdersPage />} />
        <Route path="/make/kits" element={<KitsPage />} />
        <Route path="/make/kits/:id" element={<KitsPage />} />
        <Route path="/outbound/orders" element={<OrdersPage />} />
        <Route path="/outbound/orders/:id" element={<OrdersPage />} />
        <Route path="/outbound/orders/:id/shipping-label" element={<ShippingLabelPage />} />
        <Route path="/outbound/orders/:id/packages/:packageId/shipping-label" element={<ShippingLabelPage />} />
        <Route path="/outbound/orders/:id/pack-slip" element={<PackSlipPage />} />
        <Route path="/outbound/orders/:id/pick-list" element={<OrderPickListPage />} />
        <Route path="/outbound/waves" element={<WavesPage />} />
        <Route path="/outbound/waves/:id" element={<WavesPage />} />
        <Route path="/outbound/waves/:id/pick-list" element={<WavePickListPage />} />
        <Route path="/outbound/returns" element={<ReturnsPage />} />
        <Route path="/outbound/returns/:id" element={<ReturnsPage />} />
        <Route
          path="/setup/integrations"
          element={
            <OwnerOnly>
              <IntegrationsPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/shopify"
          element={
            me ? (
              <OwnerOnly>
                <ShopifyPage me={me} />
              </OwnerOnly>
            ) : null
          }
        />
        <Route
          path="/setup/carriers"
          element={
            <OwnerOnly>
              <CarriersPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/warehouse"
          element={
            <OwnerOnly>
              <WarehouseSetupPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/clients"
          element={
            <OwnerOnly>
              <ClientsPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/zones"
          element={
            <OwnerOnly>
              <ZonesPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/team"
          element={
            <OwnerOnly>
              <TeamPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/audit"
          element={
            <OwnerOnly>
              <AuditPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/labels"
          element={
            <OwnerOnly>
              <LabelsSetupPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/billing"
          element={
            <OwnerOnly>
              <BillingPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/setup/edi"
          element={
            <OwnerOnly>
              <EdiPage />
            </OwnerOnly>
          }
        />
        <Route path="/items" element={<Navigate to="/stock/items" replace />} />
        <Route path="/locations" element={<Navigate to="/stock/locations" replace />} />
        <Route path="/inventory" element={<Navigate to="/stock" replace />} />
        <Route path="/receipts" element={<Navigate to="/inbound/receipts" replace />} />
        <Route path="/transfers" element={<Navigate to="/inbound/putaway" replace />} />
        <Route path="/orders" element={<Navigate to="/outbound/orders" replace />} />
        <Route path="/shopify" element={<Navigate to="/setup/shopify" replace />} />
        <Route path="/boms" element={<Navigate to="/make/recipes" replace />} />
        <Route path="/work-orders" element={<Navigate to="/make/work-orders" replace />} />
        <Route path="/counts" element={<Navigate to="/stock/counts" replace />} />
        <Route path="/holds" element={<Navigate to="/stock/holds" replace />} />
        <Route path="/adjustments" element={<Navigate to="/floor/adjust" replace />} />
        <Route path="/ledger" element={<Navigate to="/stock/ledger" replace />} />
      </Route>
      <Route path="*" element={<Navigate to={me ? signedInHome : "/"} replace />} />
    </Routes>
  );
}
