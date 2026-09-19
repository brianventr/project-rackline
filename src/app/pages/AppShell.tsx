import { Outlet } from "react-router-dom";
import type { Me } from "../api";
import { SessionProvider } from "../session";
import { WarehouseProvider } from "../warehouse";
import { BaseLayout } from "@/components/layouts/base-layout";

export function AppShell({ me }: { me: Me }) {
  return (
    <SessionProvider me={me}>
      <WarehouseProvider>
        <BaseLayout>
          <Outlet />
        </BaseLayout>
      </WarehouseProvider>
    </SessionProvider>
  );
}
