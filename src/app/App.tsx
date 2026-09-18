import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type Me } from "./api";
import { AppShell } from "./pages/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { LandingPage } from "./pages/LandingPage";
import { DashboardPage } from "./pages/DashboardPage";
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
import { LedgerPage } from "./pages/LedgerPage";
import { MapPage } from "./pages/MapPage";
import { MovePage } from "./pages/MovePage";
import { ScannerProvider } from "./scanner/ScannerProvider";

function Guard({ me }: { me: Me | null }) {
  if (!me) return <Navigate to="/login" replace />;
  return (
    <ScannerProvider>
      <AppShell me={me} />
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

  return (
    <Routes>
      <Route path="/" element={me ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
      <Route path="/login" element={me ? <Navigate to="/dashboard" replace /> : <AuthPage />} />
      <Route path="/signup" element={me ? <Navigate to="/dashboard" replace /> : <AuthPage mode="signup" />} />
      <Route element={<Guard me={me} />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/map" element={me ? <MapPage me={me} /> : null} />
        <Route path="/move" element={<MovePage />} />
        <Route path="/items" element={me ? <ItemsPage me={me} /> : null} />
        <Route path="/locations" element={me ? <LocationsPage me={me} /> : null} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/receipts" element={me ? <ReceiptsPage me={me} /> : null} />
        <Route path="/transfers" element={me ? <TransfersPage me={me} /> : null} />
        <Route path="/orders" element={me ? <OrdersPage me={me} /> : null} />
        <Route path="/shopify" element={me ? <ShopifyPage me={me} /> : null} />
        <Route path="/boms" element={me ? <BomsPage me={me} /> : null} />
        <Route path="/work-orders" element={me ? <WorkOrdersPage me={me} /> : null} />
        <Route path="/counts" element={me ? <CycleCountsPage me={me} /> : null} />
        <Route path="/adjustments" element={<AdjustmentsPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
      </Route>
      <Route path="*" element={<Navigate to={me ? "/dashboard" : "/"} replace />} />
    </Routes>
  );
}
