import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { authClient, type Me } from "../api";
import { useScanner } from "../scanner/ScannerProvider";

const links = [
  { to: "/", label: "Floor board", end: true },
  { to: "/map", label: "Map" },
  { to: "/move", label: "Move" },
  { to: "/inventory", label: "On-hand" },
  { to: "/items", label: "Items" },
  { to: "/locations", label: "Locations" },
  { to: "/receipts", label: "Receive" },
  { to: "/transfers", label: "Transfers" },
  { to: "/orders", label: "Orders" },
  { to: "/shopify", label: "Shopify" },
  { to: "/boms", label: "BOMs" },
  { to: "/work-orders", label: "Work orders" },
  { to: "/counts", label: "Cycle counts" },
  { to: "/adjustments", label: "Adjust" },
  { to: "/ledger", label: "Ledger" },
];

function NavItems() {
  return (
    <>
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) =>
            `whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
              isActive ? "bg-amber text-ink font-semibold" : "text-paper/80 hover:bg-white/5"
            }`
          }
        >
          {link.label}
        </NavLink>
      ))}
    </>
  );
}

export function AppShell({ me }: { me: Me }) {
  const navigate = useNavigate();
  const scanner = useScanner();

  async function signOut() {
    await authClient.signOut();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex items-center gap-3 bg-bay px-4 py-3 text-paper md:hidden print:hidden">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber">Rackline</p>
          <p className="truncate text-sm font-semibold">{me.organization.name}</p>
        </div>
        <button className="rounded-lg bg-amber px-3 py-2 text-sm font-semibold text-ink" onClick={scanner.openCamera}>
          Scan
        </button>
      </header>
      <nav className="flex gap-1 overflow-x-auto bg-bay px-2 pb-3 md:hidden print:hidden">
        <NavItems />
      </nav>
      <aside className="hidden w-64 shrink-0 flex-col bg-bay text-paper md:flex print:hidden">
        <div className="border-b border-white/10 px-5 py-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-amber">Rackline WMS</p>
          <p className="mt-2 text-lg font-semibold leading-tight">{me.organization.name}</p>
          <p className="mt-1 text-xs text-paper/60">
            {me.user.name} · {me.role}
          </p>
        </div>
        <nav className="flex flex-1 flex-col space-y-1 px-3 py-4">
          <NavItems />
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <button onClick={scanner.openCamera} className="mb-3 block text-sm text-amber hover:text-paper">
            {scanner.cameraSupported ? "Open camera scanner" : "Camera scanner unavailable"}
          </button>
          {scanner.lastScan ? (
            <p className="mb-3 font-mono text-[11px] text-paper/50">Last scan {scanner.lastScan.raw}</p>
          ) : (
            <p className="mb-3 text-[11px] text-paper/40">USB / Bluetooth scanners work on every screen.</p>
          )}
          <button onClick={signOut} className="text-sm text-paper/70 hover:text-amber">
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8 print:px-4">
        <Outlet />
      </main>
    </div>
  );
}
