import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Me } from "../api";
import { SessionProvider } from "../session";
import { WarehouseProvider } from "../warehouse";
import { BaseLayout } from "@/components/layouts/base-layout";

export function AppShell({ me }: { me: Me }) {
  const location = useLocation();
  const clientLocked = me.role === "client" && location.pathname !== "/portal";
  return (
    <SessionProvider me={me}>
      <WarehouseProvider>
        <BaseLayout>
          {clientLocked ? <Navigate to="/portal" replace /> : <Outlet />}
        </BaseLayout>
      </WarehouseProvider>
    </SessionProvider>
  );
}
