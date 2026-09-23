import { useState } from "react";
import { Link } from "react-router-dom";
import { Send } from "lucide-react";
import { api } from "../../api";
import { Button, Card, DoneBanner, ErrorBanner, Field, Input, PageHeader, onSubmit } from "../../components/ui";
import { useWrite } from "../../use-write";
import { useWarehouse } from "../../warehouse";

export function EdiPage() {
  const { warehouseId, warehouse } = useWarehouse();
  const [vendorName, setVendorName] = useState("Harbor Components");
  const [sku, setSku] = useState("LED-BULB");
  const [qty, setQty] = useState("12");
  const [clientCode, setClientCode] = useState("ACME");
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  const write = useWrite();

  const body = {
    warehouseId,
    vendorName,
    clientCode: clientCode.trim() || undefined,
    lines: [{ sku, qty: Number(qty) }],
  };

  async function submit() {
    setCreated(null);
    const res = await write.run(
      "EDI",
      () => api<{ asn: { id: string; number: string } }>("/api/edi/asn", { method: "POST", body: JSON.stringify(body) }),
      (result) => `Created ${result.asn.number}.`,
    );
    if (res) setCreated(res.asn);
  }

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Supplier EDI"
        description="Thin ASN ingest (JSON stub). A supplier posts one ASN and it lands as expected inbound."
      />
      <ErrorBanner error={write.error} />
      {created ? (
        <DoneBanner>
          Created{" "}
          <Link className="font-mono font-medium underline" to={`/inbound/asns/${created.id}`}>
            {created.number}
          </Link>
          . It is expected at {warehouse?.name ?? "this warehouse"} now.
        </DoneBanner>
      ) : null}

      <div className="grid gap-(--density-gap) lg:grid-cols-2">
        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Post a test ASN</h2>
              <p className="text-sm text-muted-foreground">
                Runs the same ingest a supplier would. The SKU must be in the catalog; the client code is optional.
              </p>
            </div>
            <form className="space-y-3" onSubmit={onSubmit(submit)}>
              <div className="grid gap-3 sm:grid-cols-2">
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
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={write.busy}>
                  <Send className="size-4" />
                  Post ASN
                </Button>
              </div>
            </form>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Payload</h2>
              <p className="text-sm text-muted-foreground">
                The JSON this form sends to <span className="font-mono">POST /api/edi/asn</span>.
              </p>
            </div>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
              {JSON.stringify(body, null, 2)}
            </pre>
          </div>
        </Card>
      </div>
    </div>
  );
}
