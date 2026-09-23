"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import type { Dashboard } from "@/app/api"
import { isNavActive, type NavItem } from "@/app/navigation"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "rackline-nav-groups"

function readOpenGroups(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, boolean>
  } catch {
    return {}
  }
}

/**
 * One sidebar group. It starts open when it holds the page you are on (or is the first group);
 * a click on the label folds it, and that choice is remembered in this browser.
 */
export function NavMain({
  label,
  items,
  dashboard,
  pinnedOpen,
}: {
  label: string
  items: NavItem[]
  dashboard?: Dashboard | null
  pinnedOpen?: boolean
}) {
  const location = useLocation()
  const { state, isMobile } = useSidebar()
  const iconOnly = state === "collapsed" && !isMobile
  const containsActive = items.some((item) => isNavActive(location.pathname, location.search, item.url))
  const [choice, setChoice] = useState<boolean | undefined>(() => readOpenGroups()[label])
  const open = iconOnly || containsActive || (choice ?? !!pinnedOpen)
  const groupCount = items.reduce((sum, item) => sum + ((dashboard && item.count?.(dashboard)?.value) || 0), 0)

  function toggle() {
    const next = !open
    setChoice(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readOpenGroups(), [label]: next }))
    } catch {
      /* Folding is a convenience. */
    }
  }

  const single = items.length === 1

  return (
    <SidebarGroup className="py-0.5">
      {single ? null : (
        <SidebarGroupLabel asChild>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="group/label w-full cursor-pointer justify-between hover:text-sidebar-foreground"
          >
            <span>{label}</span>
            <span className="flex items-center gap-1">
              {!open && groupCount ? (
                <span className="rounded-full bg-sidebar-accent px-1.5 text-[10px] tabular-nums normal-case text-sidebar-foreground">
                  {groupCount}
                </span>
              ) : null}
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </span>
          </button>
        </SidebarGroupLabel>
      )}
      {open || single ? (
        <SidebarMenu>
          {items.map((item) => {
            const active = isNavActive(location.pathname, location.search, item.url)
            const count = dashboard ? item.count?.(dashboard) : null
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild tooltip={item.title} isActive={active} className="cursor-pointer">
                  <Link to={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {count ? (
                  <SidebarMenuBadge
                    className={cn(
                      "rounded-full text-[11px]",
                      count.tone === "warning" ? "bg-tone-warning-bg text-tone-warning" : "bg-sidebar-accent text-sidebar-foreground/80",
                    )}
                    aria-label={`${count.value} open`}
                  >
                    {count.value}
                  </SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      ) : null}
    </SidebarGroup>
  )
}
