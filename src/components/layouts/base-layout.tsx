"use client";

import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { useSidebarConfig } from "@/hooks/use-sidebar-config";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";

interface BaseLayoutProps {
  children: ReactNode;
  title?: string;
  description?: string;
}

export function BaseLayout({ children, title, description }: BaseLayoutProps) {
  const { config } = useSidebarConfig();
  const location = useLocation();
  const floor = location.pathname.startsWith("/floor");

  return (
    <SidebarProvider
      defaultOpen={!floor}
      style={
        {
          "--sidebar-width": floor ? "0px" : "13rem",
          "--sidebar-width-icon": "3rem",
          "--header-height": "2.5rem",
        } as React.CSSProperties
      }
      className={config.collapsible === "none" ? "sidebar-none-mode" : ""}
    >
      {floor ? null : <AppSidebar variant={config.variant} collapsible={config.collapsible} side={config.side} />}
      <SidebarInset>
        <div className="print:hidden">
          <SiteHeader floor={floor} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="@container/main flex min-h-0 flex-1 flex-col">
            <div className={`flex min-h-0 flex-1 flex-col gap-2 px-3 py-2 print:p-0 ${floor ? "max-w-3xl mx-auto w-full print:max-w-none" : ""}`}>
              {title ? (
                <div className="flex flex-col gap-1">
                  <h1 className="text-sm font-semibold tracking-tight" title={description}>
                    {title}
                  </h1>
                </div>
              ) : null}
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
