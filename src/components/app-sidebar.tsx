"use client";

import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/logo";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSession } from "@/app/session";
import { homePath } from "@/app/warehouse";
import { useDashboard } from "@/app/dashboard";
import { navForSession } from "@/app/navigation";
import { isGarageMode } from "@/domain/operating-mode";
import { OnboardingProgress } from "@/app/components/onboarding";

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  const dashboard = useDashboard();
  const groups = navForSession(me.role, garage);

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to={homePath(me.role)}>
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg shadow-xs">
                  <Logo className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">Rackline</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">
                    {garage ? "Garage Mode" : me.organization.name}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {groups.map((group, index) => (
          <NavMain
            key={group.label}
            label={group.label}
            items={group.items}
            dashboard={dashboard.data}
            pinnedOpen={index === 0}
          />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <OnboardingProgress />
        <NavUser
          user={{
            name: me.user.name,
            email: me.user.email,
            role: me.role,
          }}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
