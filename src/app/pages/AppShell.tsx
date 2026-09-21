import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Me } from "../api";
import { SessionProvider, useSession } from "../session";
import { WarehouseProvider } from "../warehouse";
import { BaseLayout } from "@/components/layouts/base-layout";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";

export function AppShell({ me }: { me: Me }) {
  return (
    <SessionProvider me={me}>
      <WarehouseProvider>
        <BaseLayout>
          <GarageGate>
            <Outlet />
          </GarageGate>
        </BaseLayout>
      </WarehouseProvider>
    </SessionProvider>
  );
}

function GarageGate({ children }: { children: ReactNode }) {
  const me = useSession();
  const location = useLocation();
  if (isGarageMode(me.organization.operatingMode) && !garageAllowsPath(location.pathname)) {
    return <Navigate to="/today" replace />;
  }
  return children;
}
