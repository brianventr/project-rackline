import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { useSession } from "../../session";

const verbs = [
  { to: "/floor/lookup", title: "Lookup", body: "Scan a SKU, bay, or document." },
  { to: "/floor/receive", title: "Receive", body: "Post a receipt or purchase onto the dock, including partials." },
  { to: "/floor/putaway", title: "Put away", body: "Scan from bay, then to bay." },
  { to: "/floor/replenish", title: "Replenish", body: "Move bulk onto a pick face below min." },
  { to: "/floor/pick", title: "Pick", body: "Go to the suggested bay and pick remaining qty." },
  { to: "/floor/pack", title: "Pack", body: "Verify lines, print a pack slip, close the box." },
  { to: "/floor/ship", title: "Ship", body: "Buy a label, close the order, fulfill Shopify." },
  { to: "/floor/return", title: "Return", body: "Receive an RMA back into a bay." },
  { to: "/floor/count", title: "Count", body: "Snapshot a bay and post variance." },
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
