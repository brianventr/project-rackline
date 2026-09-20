import { useState } from "react";
import { api } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, onSubmit } from "../../components/ui";
import { useWarehouse } from "../../warehouse";

export function EdiPage() {
  const { warehouseId } = useWarehouse();
  const [vendorName, setVendorName] = useState("Harbor Components");
  const [sku, setSku] = useState("LED-BULB");
  const [qty, setQty] = useState("12");
  const [clientCode, setClientCode] = useState("ACME");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setResult(null);
    try {
      const res = await api<{ asn: { number: string } }>("/api/edi/asn", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          vendorName,
          clientCode: clientCode.trim() || undefined,
          lines: [{ sku, qty: Number(qty) }],
        }),
      });
      setResult(`Created ${res.asn.number}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "EDI failed");
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Setup" title="Supplier EDI" description="Thin ASN ingest (JSON stub)." />
      <ErrorBanner error={error} />
      <Card className="max-w-md">
        <form className="space-y-4" onSubmit={onSubmit(submit)}>
          <Field label="Vendor">
            <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required />
          </Field>
          <Field label="Client code">
            <Input value={clientCode} onChange={(e) => setClientCode(e.target.value)} placeholder="ACME" />
          </Field>
          <Field label="SKU">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} required />
          </Field>
          <Field label="Qty">
            <Input value={qty} onChange={(e) => setQty(e.target.value)} required type="number" min={1} />
          </Field>
          <Button type="submit">Post ASN</Button>
        </form>
        {result ? <p className="mt-4 text-sm text-emerald-700">{result}</p> : null}
      </Card>
    </div>
  );
}
