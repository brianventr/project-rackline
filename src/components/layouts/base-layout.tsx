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
import { TourDialog } from "@/app/components/tour/TourDialog";
import { useTourAutoOpen } from "@/app/tour";

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
  const canvas = location.pathname.startsWith("/automation");
  const garage = isGarageMode(me.organization.operatingMode);
  const frame = (
    <>
      <SiteHeader floor={floor} />
      <div className={`flex min-h-0 flex-1 flex-col ${canvas ? "overflow-hidden" : "overflow-auto"}`}>
        <div className="@container/main flex min-h-0 flex-1 flex-col">
          <div
            className={
              canvas
                ? "flex min-h-0 flex-1 flex-col"
                : `flex min-h-0 flex-1 flex-col gap-(--density-gap) px-(--page-pad-x) py-(--page-pad-y) print:p-0 ${floor ? "max-w-3xl mx-auto w-full print:max-w-none" : "mx-auto w-full max-w-[1600px]"}`
            }
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
    </>
  );

  return (
    <SidebarProvider
      defaultOpen={!floor}
      style={
        {
          "--sidebar-width": floor ? "0px" : "16.25rem",
          "--sidebar-width-icon": "3rem",
          "--header-height": "3.25rem",
        } as React.CSSProperties
      }
      className={`h-svh ${config.collapsible === "none" ? "sidebar-none-mode" : ""} ${floor ? "bg-background" : "bg-stage md:p-3"}`}
      data-garage={garage ? "on" : "off"}
      data-shell={floor ? "floor" : "office"}
    >
      {floor ? (
        <SidebarInset className="min-h-0 overflow-hidden bg-background">{frame}</SidebarInset>
      ) : (
        <div className="office-frame relative flex min-h-0 w-full flex-1 overflow-hidden bg-background shadow-none md:rounded-[1.35rem] md:shadow-[0_24px_60px_-28px_rgba(17,20,26,0.45)] md:ring-1 md:ring-black/5">
          <AppSidebar variant={config.variant} collapsible={config.collapsible} side={config.side} />
          <SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-background">{frame}</SidebarInset>
        </div>
      )}
      {floor ? <FloorTabBar /> : null}
      <TourMount />
      <Toaster
        mobileOffset={
          floor ? { bottom: `calc(${FLOOR_TAB_BAR_HEIGHT} + 1rem + env(safe-area-inset-bottom))` } : undefined
        }
      />
    </SidebarProvider>
  );
}

/** The one tour dialog for the whole app, and the once-per-person auto-open on the home screen. */
function TourMount() {
  useTourAutoOpen();
  return <TourDialog />;
}
