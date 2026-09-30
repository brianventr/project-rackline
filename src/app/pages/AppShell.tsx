import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Me } from "../api";
import { SessionProvider, useSession } from "../session";
import { WarehouseProvider } from "../warehouse";
import { BaseLayout } from "@/components/layouts/base-layout";
import { garageAllowsPath, isGarageMode, manufacturerRedirect } from "@/domain/operating-mode";

export function AppShell({ me }: { me: Me }) {
  return (
    <SessionProvider me={me}>
      <WarehouseProvider>
        <BaseLayout>
          <ModeGate>
            <Outlet />
          </ModeGate>
        </BaseLayout>
      </WarehouseProvider>
    </SessionProvider>
  );
}

function ModeGate({ children }: { children: ReactNode }) {
  const me = useSession();
  const location = useLocation();
  if (isGarageMode(me.organization.operatingMode)) {
    if (!garageAllowsPath(location.pathname)) return <Navigate to="/today" replace />;
    return children;
  }
  const replacement = manufacturerRedirect(location.pathname);
  if (replacement) return <Navigate to={replacement} replace />;
  return children;
}
