import { useEffect, useState } from "react";
import { api } from "../../api";
import { Card, ErrorBanner, PageHeader, Table } from "../../components/ui";

type CarriersPayload = {
  services: { id: string; company: string; service: string }[];
  accounts: { id: string; carrier: string; accountNumber: string; mode: string }[];
};

export function CarriersPage() {
  const [data, setData] = useState<CarriersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CarriersPayload>("/api/carriers")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div>
      <PageHeader eyebrow="Setup" title="Carriers" description="Shipping services and demo/live account numbers." />
      <ErrorBanner error={error} />
      {data ? (
        <>
          <Card className="mb-6">
            <p className="text-sm text-muted-foreground mb-2">Services</p>
            <ul className="text-sm space-y-1">
              {data.services.map((row) => (
                <li key={row.id}>
                  {row.company} — {row.service} <span className="font-mono text-muted-foreground">({row.id})</span>
                </li>
              ))}
            </ul>
          </Card>
          <Table columns={["Carrier", "Account", "Mode"]}>
            {data.accounts.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-mono">{row.carrier}</td>
                <td className="px-4 py-3">{row.accountNumber}</td>
                <td className="px-4 py-3">{row.mode}</td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}
    </div>
  );
}
