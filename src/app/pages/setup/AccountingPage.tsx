import { Link } from "react-router-dom";
import { Button, Card, PageHeader } from "../../components/ui";
import { useApiQuery } from "../../query";

type AccountingInfo = {
  exports: { id: string; path: string; label: string }[];
  note: string;
};

export function AccountingPage() {
  const info = useApiQuery<AccountingInfo>("/api/accounting");

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Accounting"
        description="QBO/Xero-ready CSV exports for inventory valuation, invoices, and COGS movements. Set unit cost on each SKU under Items."
      />
      <Card className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">{info.data?.note}</p>
        <div className="flex flex-wrap gap-2">
          {(info.data?.exports ?? []).map((row) => (
            <Button key={row.id} asChild variant="outline">
              <a href={row.path} download>
                {row.label}
              </a>
            </Button>
          ))}
        </div>
        <p className="text-sm">
          Also see{" "}
          <Link className="underline" to="/use-cases/stocky-replacement">
            Stocky replacement
          </Link>{" "}
          for PO and reorder workflows that feed these ledgers.
        </p>
      </Card>
    </div>
  );
}
