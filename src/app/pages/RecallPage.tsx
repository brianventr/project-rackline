import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Card, ErrorBanner, PageHeader } from "../components/ui";
import { useWrite } from "../use-write";

type RecallPayload = {
  summary: { balanceQty: number; asBuiltLinks: number; locations: string[] };
  hits: { kind: string; sku: string; name?: string; detail: string; locationCode?: string | null; qty?: number }[];
};

export function RecallPage() {
  const [lot, setLot] = useState("");
  const [serial, setSerial] = useState("");
  const [data, setData] = useState<RecallPayload | null>(null);
  const write = useWrite();

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Analytics"
        title="Recall"
        description="Look up a lot or serial across on-hand balances and as-built genealogy — beauty, food, and hardware trust."
      />
      {write.error ? <ErrorBanner error={write.error} /> : null}
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Lot</span>
          <input
            className="block rounded-md border bg-background px-3 py-2 font-mono text-sm"
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            placeholder="LOT-2026-A"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Serial</span>
          <input
            className="block rounded-md border bg-background px-3 py-2 font-mono text-sm"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            placeholder="LAMP-1001"
          />
        </label>
        <Button
          type="button"
          disabled={write.busy || (!lot.trim() && !serial.trim())}
          onClick={() =>
            void write.run("Recall search", async () => {
              const params = new URLSearchParams();
              if (lot.trim()) params.set("lot", lot.trim());
              if (serial.trim()) params.set("serial", serial.trim());
              const result = await api<RecallPayload>(`/api/recall?${params}`);
              setData(result);
              return result;
            })
          }
        >
          Search
        </Button>
        <Button asChild variant="outline">
          <Link to="/floor/lookup">Floor Lookup</Link>
        </Button>
      </Card>
      {data ? (
        <Card className="space-y-3 p-4 text-sm">
          <p>
            On hand {data.summary.balanceQty} · Genealogy links {data.summary.asBuiltLinks} · Locations{" "}
            {data.summary.locations.join(", ") || "—"}
          </p>
          <ul className="space-y-2">
            {data.hits.map((hit, i) => (
              <li key={`${hit.kind}-${hit.sku}-${i}`} className="border-b border-border/60 pb-2">
                <span className="font-mono text-xs uppercase text-muted-foreground">{hit.kind}</span>{" "}
                <span className="font-medium">{hit.sku}</span> — {hit.detail}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
