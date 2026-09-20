"use client";

import type { ComponentProps } from "react";
import {
  LayoutDashboard,
  Map,
  ScanLine,
  Truck,
  Repeat,
  ShoppingCart,
  Boxes,
  Package,
  Warehouse,
  Calculator,
  ScrollText,
  Factory,
  Hammer,
  ClipboardList,
  Undo2,
  Store,
  Settings2,
  Users,
  Tag,
  BoxSelect,
  ArrowDownToLine,
  ArrowUpFromLine,
  Layers,
  ShieldAlert,
  Forklift,
  Radar,
  Gauge,
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
import { homePath } from "@/app/warehouse";

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const me = useSession();
  const owner = me.role === "owner";

  const navGroups = [
    {
      label: "Today",
      items: [
        { title: "Today", url: "/today", icon: LayoutDashboard },
        ...(owner ? [{ title: "Performance", url: "/labor", icon: Gauge }] : []),
        { title: "Floor", url: "/floor", icon: ScanLine },
        { title: "Map", url: "/map", icon: Map },
        { title: "Equipment", url: "/equipment", icon: Forklift },
        ...(owner ? [{ title: "Build floor", url: "/map?edit=1", icon: BoxSelect }] : []),
      ],
    },
    {
      label: "Analytics",
      items: [{ title: "Traffic", url: "/analytics/traffic", icon: Radar }],
    },
    {
      label: "Inbound",
      items: [
        { title: "Receipts", url: "/inbound/receipts", icon: Truck },
        { title: "ASNs", url: "/inbound/asns", icon: Package },
        { title: "Yard", url: "/inbound/yard", icon: Warehouse },
        { title: "Putaway", url: "/inbound/putaway", icon: Repeat },
        { title: "Purchases", url: "/inbound/purchases", icon: ShoppingCart },
        { title: "Vendor returns", url: "/inbound/vendor-returns", icon: ArrowUpFromLine },
      ],
    },
    {
      label: "Stock",
      items: [
        { title: "On hand", url: "/stock", icon: Boxes },
        { title: "Items", url: "/stock/items", icon: Package },
        { title: "Locations", url: "/stock/locations", icon: Warehouse },
        { title: "Counts", url: "/stock/counts", icon: Calculator },
        { title: "Holds", url: "/stock/holds", icon: ShieldAlert },
        { title: "Replenish", url: "/stock/replenish", icon: ArrowDownToLine },
        { title: "Ledger", url: "/stock/ledger", icon: ScrollText },
      ],
    },
    {
      label: "Make",
      items: [
        { title: "Recipes", url: "/make/recipes", icon: Factory },
        { title: "Work orders", url: "/make/work-orders", icon: Hammer },
        { title: "Kits", url: "/make/kits", icon: Layers },
      ],
    },
    {
      label: "Outbound",
      items: [
        { title: "Orders", url: "/outbound/orders", icon: ClipboardList },
        { title: "Waves", url: "/outbound/waves", icon: Layers },
        { title: "Returns", url: "/outbound/returns", icon: Undo2 },
      ],
    },
    ...(owner
      ? [
          {
            label: "Setup",
            items: [
              { title: "Shopify", url: "/setup/shopify", icon: Store },
              { title: "Carriers", url: "/setup/carriers", icon: Truck },
              { title: "Warehouse", url: "/setup/warehouse", icon: Settings2 },
              { title: "Clients", url: "/setup/clients", icon: Users },
              { title: "Zones", url: "/setup/zones", icon: BoxSelect },
              { title: "Team", url: "/setup/team", icon: Users },
              { title: "Labels", url: "/setup/labels", icon: Tag },
            ],
          },
        ]
      : []),
  ];

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to={homePath(me.role)}>
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
