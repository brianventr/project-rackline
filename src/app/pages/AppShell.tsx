import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { authClient, type Me } from "../api";

const links = [
  { to: "/", label: "Floor board", end: true },
  { to: "/inventory", label: "On-hand" },
  { to: "/items", label: "Items" },
  { to: "/locations", label: "Locations" },
  { to: "/receipts", label: "Receive" },
  { to: "/transfers", label: "Transfers" },
  { to: "/orders", label: "Orders" },
  { to: "/boms", label: "BOMs" },
  { to: "/work-orders", label: "Work orders" },
  { to: "/counts", label: "Cycle counts" },
  { to: "/adjustments", label: "Adjust" },
  { to: "/ledger", label: "Ledger" },
];

export function AppShell({ me }: { me: Me }) {
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col bg-bay text-paper">
        <div className="border-b border-white/10 px-5 py-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-amber">Rackline WMS</p>
          <p className="mt-2 text-lg font-semibold leading-tight">{me.organization.name}</p>
          <p className="mt-1 text-xs text-paper/60">
            {me.user.name} · {me.role}
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm ${
                  isActive ? "bg-amber text-ink font-semibold" : "text-paper/80 hover:bg-white/5"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <button onClick={signOut} className="text-sm text-paper/70 hover:text-amber">
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
