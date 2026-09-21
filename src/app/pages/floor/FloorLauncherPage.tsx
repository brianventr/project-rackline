import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { useSession } from "../../session";
import { MyDayCard } from "../LaborPage";
import { useWarehouse } from "../../warehouse";
import { api, type FloorJob } from "../../api";
import { VERB_LABELS, type FloorVerb, isFloorVerb } from "@/domain/jobs";

const verbs: { to: string; title: string; body: string; verb?: FloorVerb }[] = [
  { to: "/floor/lookup", title: "Lookup", body: "Scan a SKU, bay, document, serial, or lot." },
  { to: "/floor/print", title: "Print", body: "Print a bay, SKU, pack slip, or shipping label." },
  { to: "/floor/receive", title: "Receive", body: "Post a receipt or purchase onto the dock, including partials.", verb: "receive" },
  { to: "/floor/asn", title: "ASN", body: "Scan an ASN- notice and receive onto the dock." },
  { to: "/floor/yard", title: "Yard", body: "Scan a YRD- visit to check in, dock, or check out." },
  { to: "/floor/checkout", title: "Check out", body: "Scan a truck, inspect it, bind a shift or ticket." },
  { to: "/floor/putaway", title: "Put away", body: "Put away a vendor BOX-/SSCC, post remaining on a ticket, or scan the dock to a bulk bay.", verb: "putaway" },
  { to: "/floor/replenish", title: "Replenish", body: "Move remaining qty from bulk onto a pick face below min.", verb: "replenish" },
  { to: "/floor/pick", title: "Pick", body: "Go to the suggested bay, open a pick map, pick remaining qty, or unpick / cancel.", verb: "pick" },
  { to: "/floor/wave", title: "Wave", body: "Scan a WAV- wave; batch-pick aggregated SKUs when mode is batch." },
  { to: "/floor/pack", title: "Pack", body: "Pack remaining qty, print a pack slip, close the box.", verb: "pack" },
  { to: "/floor/ship", title: "Ship", body: "Buy a label, close the order, fulfill Shopify.", verb: "ship" },
  { to: "/floor/return", title: "Return", body: "Receive an RMA: restock, scrap, or hold at the dock.", verb: "return" },
  { to: "/floor/rtv", title: "Vendor return", body: "Ship remaining qty back to the vendor from a bay.", verb: "rtv" },
  { to: "/floor/count", title: "Count", body: "Blind-count a bay. System qty stays hidden until you post.", verb: "count" },
  { to: "/floor/hold", title: "Hold", body: "Lock a bay, SKU, or lot so pick and replenish skip it.", verb: "hold" },
  { to: "/floor/assemble", title: "Assemble", body: "Complete a work order on the bench.", verb: "assemble" },
  { to: "/floor/kit", title: "Kit", body: "Build a finished SKU from its recipe in one step.", verb: "kit" },
];

export function FloorLauncherPage() {
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const navigate = useNavigate();
  const [nextJobs, setNextJobs] = useState<FloorJob[]>([]);
  const [mine, setMine] = useState<FloorJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const allowed = new Set(me.floorVerbs ?? []);
  const items = [
    ...verbs.filter((item) => !item.verb || allowed.has(item.verb) || me.role === "owner"),
    ...(me.role === "owner" ? [{ to: "/floor/adjust", title: "Adjust", body: "Signed qty change with a reason." }] : []),
  ];

  useEffect(() => {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    Promise.all([
      api<FloorJob[]>(`/api/jobs/next${query}`),
      api<FloorJob[]>(`/api/jobs${query}${query ? "&" : "?"}mine=1&open=1`),
    ])
      .then(([ranked, myJobs]) => {
        setNextJobs(ranked);
        setMine(myJobs);
      })
      .catch((err: Error) => setError(err.message));
  }, [warehouseId]);

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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Floor"
        title="What are you doing?"
        description="Next job is ranked from the same ledger. Unassigned work stays pickable — scan first, or pick a verb."
      />
      <MyDayCard />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {next ? (
        <button
          type="button"
          onClick={() => void startNext()}
          className="w-full rounded-2xl border border-primary/40 bg-card p-6 text-left shadow-xs transition hover:border-primary"
        >
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Next job</p>
          <p className="mt-2 text-3xl font-semibold">
            {isFloorVerb(next.verb) ? VERB_LABELS[next.verb] : next.verb}
            {next.number ? ` · ${next.number}` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">{next.title || "Open work"}</p>
          <p className="mt-3 font-mono text-sm">
            {[next.fromCode, next.toCode].filter(Boolean).join(" → ") || "No bay yet"}
            {next.qty != null ? ` · ${next.qty}` : ""}
          </p>
          <p className="mt-2 text-sm font-medium">{next.reason || "Oldest open work"}</p>
        </button>
      ) : (
        <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
          Nothing ranked for you right now. Unassigned jobs stay on the verb screens.
        </div>
      )}
      {mine.length ? (
        <div>
          <p className="mb-3 font-medium">My jobs</p>
          <ul className="space-y-2 text-sm">
            {mine.map((job) => (
              <li key={job.id}>
                <Link className="block rounded-xl border bg-card px-4 py-3 hover:border-primary/40" to={job.floorPath}>
                  <span className="font-medium">{isFloorVerb(job.verb) ? VERB_LABELS[job.verb] : job.verb}</span>{" "}
                  <span className="font-mono">{job.number}</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    {job.reason || job.title || "Assigned to you"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-2xl border bg-card p-5 shadow-xs transition hover:border-primary/40"
          >
            <p className="text-xl font-semibold">{item.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
