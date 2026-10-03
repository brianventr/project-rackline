"use client";

import { useMemo, type ComponentProps } from "react";
import { Link } from "react-router-dom";
import { ScanLine, Workflow } from "lucide-react";
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
import { useExceptionInbox } from "@/app/exceptions";
import { navForSession, type NavCounts } from "@/app/navigation";
import { useOnboarding } from "@/app/onboarding";
import { isGarageMode } from "@/domain/operating-mode";
import { OnboardingProgress } from "@/app/components/onboarding";

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  const dashboard = useDashboard();
  const inbox = useExceptionInbox();
  const counts = useMemo<NavCounts | null>(
    () => (dashboard.data ? { ...dashboard.data, exceptions: inbox.data?.counts } : null),
    [dashboard.data, inbox.data?.counts],
  );
  const onboarding = useOnboarding({ enabled: garage });
  const setupComplete = !garage || !onboarding.incomplete;
  const groups = navForSession(me.role, garage, { setupComplete });
  const nextStep = onboarding.steps.find((step) => step.id === onboarding.next);

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to={homePath(me.role, me.organization.operatingMode)}>
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
      <div className="px-3 pb-2">
        {me.role === "owner" && !setupComplete && nextStep ? (
          <Link
            to={nextStep.path}
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
          >
            <ScanLine className="size-4" />
            {nextStep.cta}
          </Link>
        ) : me.role === "owner" ? (
          <Link
            to="/automation"
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
          >
            <Workflow className="size-4" />
            Automation
          </Link>
        ) : (
          <Link
            to="/floor"
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
          >
            <ScanLine className="size-4" />
            Open floor
          </Link>
        )}
      </div>
      <SidebarContent className="gap-0">
        {groups.map((group, index) => (
          <NavMain
            key={group.label}
            label={group.label}
            items={group.items}
            dashboard={counts}
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
