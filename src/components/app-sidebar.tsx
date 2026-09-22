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
  Shield,
  Factory,
  Hammer,
  ClipboardList,
  Undo2,
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
  Activity,
  Plug,
  Hourglass,
  type LucideIcon,
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
import { garageNavForRole, isGarageMode, type GarageNavItem } from "@/domain/operating-mode";

const GARAGE_ICONS: Record<string, LucideIcon> = {
  "/today": LayoutDashboard,
  "/floor": ScanLine,
  "/map": Map,
  "/inbound/purchases": ShoppingCart,
  "/inbound/receipts": Truck,
  "/make/recipes": Factory,
  "/make/work-orders": Hammer,
  "/make/kits": Layers,
  "/outbound/orders": ClipboardList,
  "/outbound/returns": Undo2,
  "/stock": Boxes,
  "/stock/items": Package,
  "/analytics/runway": Hourglass,
  "/setup/shopify": Plug,
  "/setup/carriers": Truck,
  "/setup/team": Users,
  "/setup/labels": Tag,
  "/setup/warehouse": Settings2,
};

function garageIcon(item: GarageNavItem): LucideIcon | undefined {
  return GARAGE_ICONS[item.url];
}

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const me = useSession();
  const owner = me.role === "owner";
  const garage = isGarageMode(me.organization.operatingMode);

  const navGroups = [
    {
      label: "Today",
      items: [
        { title: "Today", url: "/today", icon: LayoutDashboard },
        ...(owner ? [{ title: "Live", url: "/live", icon: Activity }] : []),
        ...(owner ? [{ title: "Performance", url: "/labor", icon: Gauge }] : []),
        { title: "Floor", url: "/floor", icon: ScanLine },
        { title: "Map", url: "/map", icon: Map },
        { title: "Equipment", url: "/equipment", icon: Forklift },
        ...(owner ? [{ title: "Build floor", url: "/map?edit=1", icon: BoxSelect }] : []),
      ],
    },
    {
      label: "Analytics",
      items: [
        { title: "Traffic", url: "/analytics/traffic", icon: Radar },
        { title: "Runway", url: "/analytics/runway", icon: Hourglass },
      ],
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
              {
                title: "Integrations",
                url: "/setup/integrations",
                icon: Plug,
                items: [
                  { title: "Overview", url: "/setup/integrations" },
                  { title: "Shopify", url: "/setup/shopify" },
                  { title: "Carriers", url: "/setup/carriers" },
                ],
              },
              { title: "Warehouse", url: "/setup/warehouse", icon: Settings2 },
              { title: "Clients", url: "/setup/clients", icon: Users },
              { title: "Zones", url: "/setup/zones", icon: BoxSelect },
              { title: "Team", url: "/setup/team", icon: Users },
              { title: "Audit", url: "/setup/audit", icon: Shield },
              { title: "Printers", url: "/setup/labels", icon: Tag },
              { title: "Billing", url: "/setup/billing", icon: Calculator },
              { title: "Carriers", url: "/setup/carriers", icon: Truck },
              { title: "EDI", url: "/setup/edi", icon: ScrollText },
            ],
          },
        ]
      : []),
  ];

  const visibleGroups = garage
    ? garageNavForRole(me.role).map((group) => ({
        label: group.label,
        items: group.items.map((item) => ({ ...item, icon: garageIcon(item) })),
      }))
    : navGroups;

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" asChild>
              <Link to={homePath(me.role)}>
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-6 items-center justify-center rounded-md">
                  <Logo className="size-3.5" />
                </div>
                <div className="grid flex-1 text-left text-xs leading-tight">
                  <span className="truncate font-semibold">Rackline</span>
                  <span className="truncate text-[11px] opacity-80">
                    {garage ? "Garage" : me.organization.name}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((group) => (
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
