import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api, type Dashboard } from "../api";
import { ErrorBanner, PageHeader } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>("/api/dashboard")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  const stats = data
    ? [
        { label: "Units on hand", value: data.onHandUnits, hint: "Across every bin" },
        { label: "Bin rows", value: data.binRows, hint: "On-hand location lines" },
        { label: "SKUs", value: data.skuCount, hint: "In the catalog" },
        { label: "Open receipts", value: data.openReceipts, hint: "Waiting to post" },
        { label: "Open orders", value: data.openOrders, hint: "Pick or ship" },
        { label: "Open work orders", value: data.openWorkOrders, hint: "On the bench" },
        { label: "Open transfers", value: data.openTransfers, hint: "Putaway drafts" },
        { label: "Open counts", value: data.openCycleCounts, hint: "Unposted worksheets" },
        { label: "Shopify to pick", value: data.shopifyOpenOrders, hint: "Channel orders" },
      ]
    : [];

  const shortcuts = [
    { to: "/receipts", label: "Post a receipt" },
    { to: "/map", label: "Open the map" },
    { to: "/move", label: "Scan to move" },
    { to: "/transfers", label: "Put away / transfer" },
    { to: "/work-orders", label: "Complete a work order" },
    { to: "/orders", label: "Pick and ship" },
    { to: "/counts", label: "Start a cycle count" },
    { to: "/shopify", label: "Shopify channel" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bay 00"
        title="Floor board"
        description="A snapshot of stock, putaway, outbound, counts, and the assembly bench."
      />
      <ErrorBanner error={error} />
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="@container/card">
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {stat.value}
              </CardTitle>
              <CardAction>
                <Badge variant="outline">{stat.hint}</Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent movements</CardTitle>
            <CardDescription>Last ledger lines across the warehouse.</CardDescription>
          </CardHeader>
          <CardFooter className="flex-col items-stretch gap-2">
            {data?.recent.length ? (
              <ul className="w-full space-y-2 text-sm">
                {data.recent.map((row) => (
                  <li key={row.id} className="flex justify-between gap-4 border-b py-2 last:border-0">
                    <span>
                      <span className="font-mono text-xs uppercase text-muted-foreground">{row.type}</span>{" "}
                      <span className="font-medium">{row.sku}</span>
                    </span>
                    <span className="font-mono tabular-nums">{row.qty}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No ledger activity yet.</p>
            )}
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Below reorder point</CardTitle>
            <CardDescription>SKUs at or under their threshold.</CardDescription>
          </CardHeader>
          <CardFooter className="flex-col items-stretch gap-2">
            {data?.lowStock.length ? (
              <ul className="w-full space-y-2 text-sm">
                {data.lowStock.map((row) => (
                  <li key={row.itemId} className="flex justify-between gap-4 border-b py-2 last:border-0">
                    <span>
                      <span className="font-mono">{row.sku}</span> {row.name}
                    </span>
                    <span className="font-mono tabular-nums text-warn">
                      {row.onHand}/{row.reorderPoint}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No SKUs are at or below their reorder point.</p>
            )}
          </CardFooter>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Floor shortcuts</CardTitle>
            <CardDescription>Jump into the loop you are running right now.</CardDescription>
          </CardHeader>
          <CardFooter className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {shortcuts.map((item) => (
              <Button key={item.to} variant="outline" className="justify-between" asChild>
                <Link to={item.to}>
                  {item.label}
                  <ArrowRight />
                </Link>
              </Button>
            ))}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
