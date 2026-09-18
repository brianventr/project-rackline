"use client";

import type { ComponentProps } from "react";
import {
  LayoutDashboard,
  Map,
  ArrowLeftRight,
  Boxes,
  Package,
  Warehouse,
  Truck,
  Repeat,
  ClipboardList,
  Store,
  Factory,
  Hammer,
  Calculator,
  SlidersHorizontal,
  ScrollText,
  BoxSelect,
} from "lucide-react";
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

const navGroups = [
  {
    label: "Floor",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Map", url: "/map", icon: Map },
      { title: "Build floor", url: "/map?edit=1", icon: BoxSelect },
      { title: "Move", url: "/move", icon: ArrowLeftRight },
      { title: "On-hand", url: "/inventory", icon: Boxes },
    ],
  },
  {
    label: "Catalog",
    items: [
      { title: "Items", url: "/items", icon: Package },
      { title: "Locations", url: "/locations", icon: Warehouse },
    ],
  },
  {
    label: "Inbound / outbound",
    items: [
      { title: "Receive", url: "/receipts", icon: Truck },
      { title: "Transfers", url: "/transfers", icon: Repeat },
      { title: "Orders", url: "/orders", icon: ClipboardList },
      { title: "Shopify", url: "/shopify", icon: Store },
    ],
  },
  {
    label: "Production",
    items: [
      { title: "BOMs", url: "/boms", icon: Factory },
      { title: "Work orders", url: "/work-orders", icon: Hammer },
    ],
  },
  {
    label: "Control",
    items: [
      { title: "Cycle counts", url: "/counts", icon: Calculator },
      { title: "Adjust", url: "/adjustments", icon: SlidersHorizontal },
      { title: "Ledger", url: "/ledger", icon: ScrollText },
    ],
  },
];

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const me = useSession();

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/dashboard">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Logo className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Rackline</span>
                  <span className="truncate text-xs opacity-80">{me.organization.name}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
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
