"use client";

import * as React from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { useSidebarConfig } from "@/hooks/use-sidebar-config";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";

interface BaseLayoutProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
}

export function BaseLayout({ children, title, description }: BaseLayoutProps) {
  const { config } = useSidebarConfig();

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "16rem",
          "--sidebar-width-icon": "3rem",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
      className={config.collapsible === "none" ? "sidebar-none-mode" : ""}
    >
      {config.side === "left" ? (
        <>
          <AppSidebar variant={config.variant} collapsible={config.collapsible} side={config.side} />
          <SidebarInset>
            <SiteHeader />
            <div className="flex flex-1 flex-col">
              <div className="@container/main flex flex-1 flex-col gap-2">
                <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:px-6 md:py-6">
                  {title ? (
                    <div className="flex flex-col gap-1">
                      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                      {description ? <p className="text-muted-foreground">{description}</p> : null}
                    </div>
                  ) : null}
                  {children}
                </div>
              </div>
            </div>
          </SidebarInset>
        </>
      ) : (
        <>
          <SidebarInset>
            <SiteHeader />
            <div className="flex flex-1 flex-col">
              <div className="@container/main flex flex-1 flex-col gap-2">
                <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:px-6 md:py-6">
                  {title ? (
                    <div className="flex flex-col gap-1">
                      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                      {description ? <p className="text-muted-foreground">{description}</p> : null}
                    </div>
                  ) : null}
                  {children}
                </div>
              </div>
            </div>
          </SidebarInset>
          <AppSidebar variant={config.variant} collapsible={config.collapsible} side={config.side} />
        </>
      )}
      <Toaster />
    </SidebarProvider>
  );
}
