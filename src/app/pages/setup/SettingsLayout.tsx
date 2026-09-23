import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { isGarageMode } from "@/domain/operating-mode";
import { useSession } from "../../session";
import { settingsForSession } from "../../navigation";

/** Settings live on one page with their own sub-nav, instead of ten entries in the main sidebar. */
export function SettingsLayout() {
  const me = useSession();
  const location = useLocation();
  const items = settingsForSession(me.role, isGarageMode(me.organization.operatingMode));

  if (location.pathname === "/setup" || location.pathname === "/setup/") {
    return <Navigate to={items[0]?.url ?? "/today"} replace />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap) lg:flex-row lg:gap-6">
      <nav aria-label="Settings" className="shrink-0 lg:w-52">
        <p className="mb-2 hidden px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground lg:block">
          Settings
        </p>
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
          {items.map((item) => (
            <li key={item.url} className="shrink-0">
              <NavLink
                to={item.url}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    isActive && "bg-card font-medium text-foreground shadow-xs ring-1 ring-border",
                  )
                }
              >
                <item.icon className="size-4" />
                {item.title}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-(--density-gap)">
        <Outlet />
      </div>
    </div>
  );
}
