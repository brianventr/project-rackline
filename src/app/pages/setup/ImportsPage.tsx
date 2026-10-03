import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { Button, Card, ErrorBanner, PageHeader } from "../../components/ui";
import { useWrite } from "../../use-write";
import { useWarehouse } from "../../warehouse";

type Preview = {
  source: string;
  parseErrors: string[];
  rowCount: number;
  orderCount: number;
  missingSkus: string[];
};

type ImportResult = {
  source: string;
  created: number;
  orders: { id: string; number: string }[];
  waveNumber: string | null;
  missingSkus: string[];
};

export function ImportsPage() {
  const { warehouseId } = useWarehouse();
  const [csv, setCsv] = useState("");
  const [createWave, setCreateWave] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const write = useWrite();

  const sampleHint = useMemo(
    () =>
      `Backer Name,Email,SKU,Qty,Address,Tier,Add-ons
Ada Maker,ada@example.com,LAMP,1,"123 Bay St",Early Bird,SHADE|BASE`,
    [],
  );

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Imports"
        description="Paste a pledge CSV, or a Stocky purchase order or stocktake. Stocky suppliers become vendors. A stocktake opens a count on the first bay."
      />
      {write.error ? <ErrorBanner error={write.error} /> : null}
      <Card className="space-y-4 p-4">
        <label className="block space-y-2 text-sm">
          <span className="font-medium">Pledge CSV</span>
          <textarea
            className="min-h-40 w-full rounded-md border bg-background p-3 font-mono text-xs"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={sampleHint}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createWave} onChange={(e) => setCreateWave(e.target.checked)} />
          Create a wave for this import
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={write.busy || !csv.trim()}
            onClick={() =>
              void write.run("Preview import", async () => {
                setResult(null);
                const data = await api<Preview>("/api/imports/crowdfunding/preview", {
                  method: "POST",
                  body: JSON.stringify({ csv }),
                });
                setPreview(data);
                return data;
              })
            }
          >
            Preview
          </Button>
          <Button
            type="button"
            disabled={write.busy || !csv.trim()}
            onClick={() =>
              void write.run(
                "Crowdfunding import",
                async () => {
                  const data = await api<ImportResult>("/api/imports/crowdfunding", {
                    method: "POST",
                    body: JSON.stringify({
                      csv,
                      warehouseId,
                      createWave,
                      allowMissingSkus: false,
                    }),
                  });
                  setResult(data);
                  setPreview(null);
                  return data;
                },
                (data) => `Imported ${data.created} orders`,
              )
            }
          >
            Import orders
          </Button>
        </div>
      </Card>
      {preview ? (
        <Card className="space-y-2 p-4 text-sm">
          <p>
            Source <span className="font-mono">{preview.source}</span> · {preview.rowCount} rows · {preview.orderCount}{" "}
            orders
          </p>
          {preview.missingSkus.length ? (
            <p className="text-amber-700 dark:text-amber-400">Missing SKUs: {preview.missingSkus.join(", ")}</p>
          ) : null}
          {preview.parseErrors.length ? <p className="text-destructive">{preview.parseErrors.join("; ")}</p> : null}
        </Card>
      ) : null}
      <StockyImport />
      {result ? (
        <Card className="space-y-2 p-4 text-sm">
          <p>
            Created {result.created} orders from <span className="font-mono">{result.source}</span>
            {result.waveNumber ? <> on wave {result.waveNumber}</> : null}
          </p>
          <p>
            <Link className="underline" to="/outbound/orders">
              Open orders
            </Link>
          </p>
        </Card>
      ) : null}
    </div>
  );
}

type StockyPreview = {
  kind: string;
  parseErrors: string[];
  purchaseCount: number;
  lineCount: number;
  countCount: number;
  suppliers: string[];
};

type StockyResult = {
  kind: string;
  purchases: { id: string; number: string }[];
  count: { id: string; number: string } | null;
  parseErrors: string[];
};

function StockyImport() {
  const { warehouseId } = useWarehouse();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<StockyPreview | null>(null);
  const [result, setResult] = useState<StockyResult | null>(null);
  const write = useWrite();

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">Stocky</h2>
        <p className="text-sm text-muted-foreground">
          Paste a purchase-order export (supplier, SKU, quantity) or a stocktake (SKU, counted). Closed POs are skipped. Suppliers cannot be exported from Stocky on their own; the supplier column creates the vendor.
        </p>
      </div>
      <label className="block space-y-2 text-sm">
        <span className="font-medium">Stocky CSV</span>
        <textarea
          className="min-h-32 w-full rounded-md border bg-background p-3 font-mono text-xs"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder={"PO Number,Supplier,Status,SKU,Product,Quantity,Received,Cost\nPO-9,Harbor,ordered,LED,Bulb,10,0,1.50"}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={write.busy || !csv.trim()}
          onClick={() =>
            void write.run("Preview Stocky import", async () => {
              setResult(null);
              const data = await api<StockyPreview>("/api/imports/stocky/preview", {
                method: "POST",
                body: JSON.stringify({ csv }),
              });
              setPreview(data);
              return data;
            })
          }
        >
          Preview
        </Button>
        <Button
          type="button"
          disabled={write.busy || !csv.trim()}
          onClick={() =>
            void write.run(
              "Stocky import",
              async () => {
                const data = await api<StockyResult>("/api/imports/stocky", {
                  method: "POST",
                  body: JSON.stringify({ csv, warehouseId }),
                });
                setResult(data);
                setPreview(null);
                return data;
              },
              (data) => `Imported ${data.purchases.length} purchases${data.count ? ` and count ${data.count.number}` : ""}`,
            )
          }
        >
          Import
        </Button>
      </div>
      {preview ? (
        <p className="text-sm text-muted-foreground">
          {preview.kind === "stocktake"
            ? `${preview.countCount} counted SKUs`
            : `${preview.purchaseCount} purchases, ${preview.lineCount} lines${preview.suppliers.length ? ` from ${preview.suppliers.join(", ")}` : ""}`}
          {preview.parseErrors.length ? ` · ${preview.parseErrors.join("; ")}` : ""}
        </p>
      ) : null}
      {result ? (
        <p className="text-sm">
          {result.purchases.length ? (
            <Link className="underline" to="/inbound/purchases">
              Open purchases
            </Link>
          ) : null}
          {result.count ? (
            <>
              {" "}
              <Link className="underline" to={`/stock/counts/${result.count.id}`}>
                Open {result.count.number}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </Card>
  );
}
