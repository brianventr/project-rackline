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
        description="Paste a BackerKit, Gamefound, or Kickstarter-style pledge CSV. Rows become open orders — optionally one wave for the ship stage."
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
