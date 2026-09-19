import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { useSession } from "../../session";

const verbs = [
  { to: "/floor/lookup", title: "Lookup", body: "Scan a SKU, bay, or document." },
  { to: "/floor/receive", title: "Receive", body: "Post a receipt onto the dock." },
  { to: "/floor/putaway", title: "Put away", body: "Scan from bay, then to bay." },
  { to: "/floor/pick", title: "Pick", body: "Take an order out of storage." },
  { to: "/floor/pack", title: "Pack", body: "Confirm lines into the box." },
  { to: "/floor/ship", title: "Ship", body: "Close the order and fulfill Shopify." },
  { to: "/floor/count", title: "Count", body: "Snapshot a bay and post variance." },
  { to: "/floor/assemble", title: "Assemble", body: "Complete a work order on the bench." },
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
