"use client";

import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { useSidebarConfig } from "@/hooks/use-sidebar-config";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useSession } from "@/app/session";
import { FLOOR_TAB_BAR_HEIGHT, FloorTabBar } from "@/app/components/floor-tab-bar";
import { isGarageMode } from "@/domain/operating-mode";

interface BaseLayoutProps {
  children: ReactNode;
  title?: string;
  description?: string;
}

export function BaseLayout({ children, title, description }: BaseLayoutProps) {
  const { config } = useSidebarConfig();
  const location = useLocation();
  const me = useSession();
  const floor = location.pathname.startsWith("/floor");
  const garage = isGarageMode(me.organization.operatingMode);

  return (
    <SidebarProvider
      defaultOpen={!floor}
      style={
        {
          "--sidebar-width": floor ? "0px" : "15rem",
          "--sidebar-width-icon": "3rem",
          "--header-height": "3.25rem",
        } as React.CSSProperties
      }
      className={config.collapsible === "none" ? "sidebar-none-mode" : ""}
      data-garage={garage ? "on" : "off"}
    >
      {floor ? null : <AppSidebar variant={config.variant} collapsible={config.collapsible} side={config.side} />}
      <SidebarInset>
        <SiteHeader floor={floor} />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="@container/main flex min-h-0 flex-1 flex-col">
            <div
              className={`flex min-h-0 flex-1 flex-col gap-(--density-gap) px-(--page-pad-x) py-(--page-pad-y) print:p-0 ${floor ? "max-w-3xl mx-auto w-full print:max-w-none" : "mx-auto w-full max-w-[1600px]"}`}
            >
              {title ? (
                <div className="flex flex-col gap-1">
                  <h1 className="text-sm font-semibold tracking-tight" title={description}>
                    {title}
                  </h1>
                </div>
              ) : null}
              {children}
              {floor ? (
                // Room for the phone tab bar so the last card is not hidden behind it.
                <div
                  aria-hidden
                  className="shrink-0 md:hidden print:hidden"
                  style={{ height: `calc(${FLOOR_TAB_BAR_HEIGHT} + env(safe-area-inset-bottom))` }}
                />
              ) : null}
            </div>
          </div>
        </div>
      </SidebarInset>
      {floor ? <FloorTabBar /> : null}
      <Toaster
        mobileOffset={
          floor ? { bottom: `calc(${FLOOR_TAB_BAR_HEIGHT} + 1rem + env(safe-area-inset-bottom))` } : undefined
        }
      />
    </SidebarProvider>
  );
}
