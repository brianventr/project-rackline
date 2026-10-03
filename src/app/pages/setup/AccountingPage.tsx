import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, errorText } from "../../api";
import { Button, Card, Field, Input, PageHeader } from "../../components/ui";
import { useApiQuery, refreshApi } from "../../query";

type AccountingInfo = {
  exports: { id: string; path: string; label: string }[];
  note: string;
  quickbooks?: boolean;
};

export function AccountingPage() {
  const info = useApiQuery<AccountingInfo>("/api/accounting");
  const [realmId, setRealmId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try {
      await api("/api/accounting/quickbooks", {
        method: "POST",
        body: JSON.stringify({ realmId, accessToken, expenseAccountId }),
      });
      setAccessToken("");
      toast.success("QuickBooks is connected. CSV stays available.");
      await refreshApi("/api/accounting");
    } catch (err) {
      toast.error(errorText(err, "Could not connect QuickBooks."));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const result = await api<{ sent: { number: string }[] }>("/api/accounting/quickbooks/send", { method: "POST" });
      toast.success(`Sent ${result.sent.length} ${result.sent.length === 1 ? "bill" : "bills"} to QuickBooks.`);
    } catch (err) {
      toast.error(errorText(err, "QuickBooks did not take the bill. Download the CSV instead."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Accounting"
        description="Download a CSV for QuickBooks or Xero, or send received purchases as bills when QuickBooks is connected."
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
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">QuickBooks</h2>
          <p className="text-sm text-muted-foreground">
            {info.data?.quickbooks
              ? "Connected. Send posts each received purchase that has not been sent yet. The CSV is still there if a bill is rejected."
              : "Paste a realm id, access token, and the expense account the bill should hit. Until then, use the CSV."}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Realm id">
            <Input value={realmId} onChange={(event) => setRealmId(event.target.value)} autoComplete="off" />
          </Field>
          <Field label="Access token">
            <Input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} type="password" autoComplete="off" />
          </Field>
          <Field label="Expense account id">
            <Input value={expenseAccountId} onChange={(event) => setExpenseAccountId(event.target.value)} autoComplete="off" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || !realmId || !accessToken || !expenseAccountId} onClick={() => void connect()}>
            Save QuickBooks
          </Button>
          <Button type="button" disabled={busy || !info.data?.quickbooks} onClick={() => void send()}>
            Send received purchases
          </Button>
        </div>
      </Card>
    </div>
  );
}
