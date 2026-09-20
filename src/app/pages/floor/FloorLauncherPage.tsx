import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { useSession } from "../../session";

const verbs = [
  { to: "/floor/lookup", title: "Lookup", body: "Scan a SKU, bay, document, serial, or lot." },
  { to: "/floor/print", title: "Print", body: "Print a bay, SKU, pack slip, or shipping label." },
  { to: "/floor/receive", title: "Receive", body: "Post a receipt or purchase onto the dock, including partials." },
  { to: "/floor/putaway", title: "Put away", body: "Post remaining on a putaway ticket, or scan the dock to a bulk bay." },
  { to: "/floor/replenish", title: "Replenish", body: "Move remaining qty from bulk onto a pick face below min." },
  { to: "/floor/pick", title: "Pick", body: "Go to the suggested bay, pick remaining qty, or unpick / cancel." },
  { to: "/floor/pack", title: "Pack", body: "Pack remaining qty, print a pack slip, close the box." },
  { to: "/floor/ship", title: "Ship", body: "Buy a label, close the order, fulfill Shopify." },
  { to: "/floor/return", title: "Return", body: "Receive an RMA: restock, scrap, or hold at the dock." },
  { to: "/floor/rtv", title: "Vendor return", body: "Ship remaining qty back to the vendor from a bay." },
  { to: "/floor/count", title: "Count", body: "Blind-count a bay. System qty stays hidden until you post." },
  { to: "/floor/hold", title: "Hold", body: "Lock a bay, SKU, or lot so pick and replenish skip it." },
  { to: "/floor/assemble", title: "Assemble", body: "Complete a work order on the bench." },
  { to: "/floor/kit", title: "Kit", body: "Build a finished SKU from its recipe in one step." },
];

export function FloorLauncherPage() {
  const me = useSession();
  const items = me.role === "owner" ? [...verbs, { to: "/floor/adjust", title: "Adjust", body: "Signed qty change with a reason." }] : verbs;

  return (
    <div>
      <PageHeader
        eyebrow="Floor"
        title="What are you doing?"
        description="One job per screen. Scan first. The office menu stays out of the way."
      />
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
