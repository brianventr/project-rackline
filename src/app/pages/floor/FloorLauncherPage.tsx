import { useEffect, useState, type ComponentType } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  Calculator,
  ClipboardList,
  Factory,
  Forklift,
  Hammer,
  Layers,
  Package,
  Printer,
  Repeat,
  ScanLine,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Truck,
  Undo2,
  Warehouse,
} from "lucide-react";
import { EmptyState, PageHeader } from "../../components/ui";
import { useSession } from "../../session";
import { MyDayCard } from "../LaborPage";
import { useWarehouse } from "../../warehouse";
import { api, type FloorJob } from "../../api";
import { VERB_LABELS, type FloorVerb, isFloorVerb } from "@/domain/jobs";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";

const verbs: { to: string; title: string; body: string; verb?: FloorVerb; icon: ComponentType<{ className?: string }> }[] = [
  { to: "/floor/lookup", title: "Lookup", body: "Scan a SKU, bay, document, serial, or lot.", icon: Search },
  { to: "/floor/print", title: "Print", body: "Print a bay, SKU, pick list, pack slip, or shipping label.", icon: Printer },
  { to: "/floor/receive", title: "Receive", body: "Post a receipt or purchase onto the dock, including partials.", verb: "receive", icon: Truck },
  { to: "/floor/asn", title: "ASN", body: "Scan an ASN- notice and receive onto the dock.", icon: Package },
  { to: "/floor/yard", title: "Yard", body: "Scan a YRD- visit to check in, dock, or check out.", icon: Warehouse },
  { to: "/floor/checkout", title: "Check out", body: "Scan a truck, inspect it, bind a shift or ticket.", icon: Forklift },
  { to: "/floor/putaway", title: "Put away", body: "Put away a vendor BOX-/SSCC, post remaining on a ticket, or scan the dock to a bulk bay.", verb: "putaway", icon: Repeat },
  { to: "/floor/replenish", title: "Replenish", body: "Move remaining qty from bulk onto a pick face below min.", verb: "replenish", icon: ArrowDownToLine },
  { to: "/floor/pick", title: "Pick", body: "Go to the suggested bay, open a pick map, pick remaining qty, or unpick / cancel.", verb: "pick", icon: ClipboardList },
  { to: "/floor/wave", title: "Wave", body: "Scan a WAV- wave; batch-pick aggregated SKUs when mode is batch.", icon: Layers },
  { to: "/floor/pack", title: "Pack", body: "Pack remaining qty, print a pack slip, close the box.", verb: "pack", icon: Box },
  { to: "/floor/ship", title: "Ship", body: "Buy a label, close the order, fulfill Shopify.", verb: "ship", icon: Send },
  { to: "/floor/return", title: "Return", body: "Receive an RMA: restock, scrap, or hold at the dock.", verb: "return", icon: Undo2 },
  { to: "/floor/rtv", title: "Vendor return", body: "Ship remaining qty back to the vendor from a bay.", verb: "rtv", icon: ArrowUpFromLine },
  { to: "/floor/count", title: "Count", body: "Blind-count a bay. System qty stays hidden until you post.", verb: "count", icon: Calculator },
  { to: "/floor/hold", title: "Hold", body: "Lock a bay, SKU, or lot so pick and replenish skip it.", verb: "hold", icon: ShieldAlert },
  { to: "/floor/assemble", title: "Assemble", body: "Complete a work order on the bench.", verb: "assemble", icon: Hammer },
  { to: "/floor/kit", title: "Kit", body: "Build a finished SKU from its recipe in one step.", verb: "kit", icon: Factory },
];

export function FloorLauncherPage() {
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const navigate = useNavigate();
  const [nextJobs, setNextJobs] = useState<FloorJob[]>([]);
  const [mine, setMine] = useState<FloorJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const garage = isGarageMode(me.organization.operatingMode);
  const allowed = new Set(me.floorVerbs ?? []);
  const items = [
    ...verbs.filter((item) => !item.verb || allowed.has(item.verb) || me.role === "owner"),
    ...(me.role === "owner"
      ? [{ to: "/floor/adjust", title: "Adjust", body: "Signed qty change with a reason.", icon: SlidersHorizontal }]
      : []),
  ].filter((item) => !garage || garageAllowsPath(item.to));

  useEffect(() => {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    Promise.all([
      api<FloorJob[]>(`/api/jobs/next${query}`),
      api<FloorJob[]>(`/api/jobs${query}${query ? "&" : "?"}mine=1&open=1`),
    ])
      .then(([ranked, myJobs]) => {
        const keep = (job: FloorJob) => !garage || garageAllowsPath(job.floorPath);
        setNextJobs(ranked.filter(keep));
        setMine(myJobs.filter(keep));
      })
      .catch((err: Error) => setError(err.message));
  }, [warehouseId, garage]);

  const next = nextJobs[0];

  async function startNext() {
    if (!next) return;
    setError(null);
    try {
      const claimed = await api<FloorJob>(`/api/jobs/${next.id}/claim`, { method: "POST" });
      navigate(claimed.floorPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim job");
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow={garage ? "Garage Mode" : "Floor"}
        title={garage ? "What are you making?" : "What are you doing?"}
        description={
          garage
            ? "Small scale: receive, make, pick, and ship. Manufacturer opens the rest of the floor when the product takes off."
            : "Next job is ranked from the same ledger. Unassigned work stays pickable — scan first, or pick a verb."
        }
      />
      <MyDayCard />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {next ? (
        <button
          type="button"
          onClick={() => void startNext()}
          className="flex w-full items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-left hover:border-primary"
        >
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Next job · claim</p>
            <p className="truncate text-sm font-semibold">
              {isFloorVerb(next.verb) ? VERB_LABELS[next.verb] : next.verb}
              {next.number ? ` · ${next.number}` : ""}
              <span className="ml-2 font-mono font-normal text-muted-foreground">
                {[next.fromCode, next.toCode].filter(Boolean).join(" → ") || "No bay yet"}
                {next.qty != null ? ` · ${next.qty}` : ""}
              </span>
            </p>
            <p className="truncate text-xs text-muted-foreground">{next.reason || next.title || "Open work"}</p>
          </div>
          <ScanLine className="size-4 shrink-0 text-primary" />
        </button>
      ) : (
        <EmptyState
          title="Nothing ranked for you right now."
          body="Unassigned work is on the verb screens."
          action={
            <Link className="text-xs font-medium underline" to="/floor/lookup">
              Lookup
            </Link>
          }
        />
      )}
      {mine.length ? (
        <div>
          <p className="mb-1 text-xs font-medium">My jobs</p>
          <ul className="divide-y rounded-md border bg-card text-sm">
            {mine.map((job) => (
              <li key={job.id}>
                <Link className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-muted/60" to={job.floorPath}>
                  <span>
                    <span className="font-medium">{isFloorVerb(job.verb) ? VERB_LABELS[job.verb] : job.verb}</span>{" "}
                    <span className="font-mono">{job.number}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{job.reason || job.title || "Assigned to you"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            title={item.body}
            className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-sm font-medium hover:border-primary/40 sm:items-start"
          >
            <item.icon className="size-4 shrink-0 text-muted-foreground sm:mt-0.5" />
            <span className="min-w-0">
              <span className="block">{item.title}</span>
              <span className="mt-0.5 hidden text-xs font-normal text-muted-foreground sm:line-clamp-2">
                {item.body}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
