import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Asn, type Item, type Location } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { ASN_STEPS, canExpectAsn, canReceiveAsn } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields } from "./ReceiptsPage";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../components/expiry-field";

type Line = { itemId: string; qty: string };

export function AsnsPage() {
  const { id } = useParams();
  if (id) return <AsnDetail id={id} />;
  return <AsnList />;
}

function AsnList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [asns, setAsns] = useState<Asn[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendorName, setVendorName] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextAsns, nextItems] = await Promise.all([api<Asn[]>("/api/asns"), api<Item[]>("/api/items")]);
    setAsns(nextAsns);
    setItems(nextItems);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<Asn>("/api/asns", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          vendorName,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      navigate(`/inbound/asns/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create ASN");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inbound"
        title="ASNs"
        description="Advance ship notices from vendors. Expect them, then receive onto the dock."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New ASN"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-3">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <Field label="Vendor">
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required placeholder="Harbor Components" />
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Trailer, PO ref, packing slip" />
            </Field>
            <LineFields items={items} lines={lines} setLines={setLines} />
            <Button type="submit">Create ASN</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Vendor", "Status", "Lines"]}>
        {inWarehouse(asns, warehouseId).map((asn) => (
          <tr key={asn.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/inbound/asns/${asn.id}`}>
                {asn.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5">{asn.vendorName}</td>
            <td className="px-2.5 py-1.5">
              <StatusBadge status={asn.status} />
            </td>
            <td className="px-2.5 py-1.5 text-sm">
              {summarizeLines((asn.lines ?? []).map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qtyExpected })))}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function AsnDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [asn, setAsn] = useState<Asn | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, nextLocations] = await Promise.all([api<Asn>(`/api/asns/${id}`), api<Location[]>("/api/locations")]);
    setAsn(next);
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(next.locationId || dock.id);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function expect() {
    setError(null);
    try {
      setAsn(await api<Asn>(`/api/asns/${id}/expect`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark expected");
    }
  }

  async function receive() {
    if (!asn) return;
    setError(null);
    try {
      const lines = (asn.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          lotCode: lots[line.itemId] || undefined,
          serials: serials[line.itemId] || undefined,
          weightGrams: parseWeightGrams(weights[line.itemId]),
          expiresOn: parseExpiryInput(expiries[line.itemId]),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Asn>(`/api/asns/${id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      setAsn(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive");
    }
  }

  async function pasteCartons() {
    if (!asn) return;
    setError(null);
    try {
      const parsed = JSON.parse(paste) as unknown;
      const cartons = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && "cartons" in parsed ? (parsed as { cartons: unknown }).cartons : null;
      if (!Array.isArray(cartons)) throw new Error("Paste a JSON array of cartons");
      const next = await api<Asn>(`/api/asns/${id}/packages`, {
        method: "POST",
        body: JSON.stringify({ cartons }),
      });
      setAsn(next);
      setPaste("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not paste cartons");
    }
  }

  async function receiveCarton(pkgId: string) {
    setError(null);
    try {
      const next = await api<Asn>(`/api/asns/${id}/packages/${pkgId}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lots, serials }),
      });
      setAsn(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive carton");
    }
  }

  async function unreceiveCarton(pkgId: string) {
    setError(null);
    try {
      const next = await api<Asn>(`/api/asns/${id}/packages/${pkgId}/unreceive`, { method: "POST" });
      setAsn(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unreceive carton");
    }
  }

  if (!asn) return <ErrorBanner error={error} />;
  const remaining = hasRemaining(
    (asn.lines ?? []).map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qtyExpected,
      qtyReceived: line.qtyReceived,
    })),
  );

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Inbound"
        title={asn.number}
        description={`${asn.vendorName}${asn.notes ? ` · ${asn.notes}` : ""}`}
        status={asn.status}
        steps={ASN_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/inbound/asns")}>
              All ASNs
            </Button>
            {canExpectAsn(asn.status) ? <Button onClick={() => void expect()}>Mark expected</Button> : null}
            {canReceiveAsn(asn.status) && remaining && !(asn.packages ?? []).length ? (
              <Button onClick={() => void receive()}>Receive</Button>
            ) : null}
            {canReceiveAsn(asn.status) && remaining ? (
              <Button variant="secondary" asChild>
                <Link to={`/floor/asn?id=${asn.id}`}>Floor</Link>
              </Button>
            ) : (asn.packages ?? []).some((pkg) => pkg.receivedAt && !pkg.putawayAt) ? (
              <Button variant="secondary" asChild>
                <Link to={`/floor/asn?id=${asn.id}`}>Floor</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <Field label="Receive into">
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </Card>
            <DocumentActivity
              refId={asn.id}
              refreshKey={`${asn.status}:${(asn.lines ?? []).map((line) => line.qtyReceived).join(",")}`}
            />
          </DocumentRail>
        }
      >
        <Card className="mb-4 space-y-3">
          <p className="font-medium">Vendor cartons</p>
          <p className="text-sm text-muted-foreground">
            Paste JSON boxes from the vendor (no X12). Lines may include lotCode, serials, weightGrams, and expiresOn.
            Floor then receives one carton at a time. Unreceive a dock carton to reverse qty. Cartons are optional until the first box exists.
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            className="border-input w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none"
            placeholder='[{"sscc":"00012345678901234567","lines":[{"sku":"LED-BULB","qty":10,"lotCode":"LOT-2026-A"}]}]'
          />
          <Button variant="secondary" disabled={!paste.trim()} onClick={() => void pasteCartons()}>
            Paste vendor cartons
          </Button>
          {(asn.packages ?? []).length > 0 ? (
            <ul className="space-y-2 text-sm">
              {(asn.packages ?? []).map((pkg) => (
                <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <span>
                    <span className="font-mono">{pkg.number}</span>
                    {pkg.sscc ? <span className="text-muted-foreground"> · {pkg.sscc}</span> : null}
                    <span className="text-muted-foreground">
                      {" "}
                      · {(pkg.lines ?? []).map((line) => `${line.sku} × ${line.qty}${line.lotCode ? ` ${line.lotCode}` : ""}`).join(", ")}
                      {pkg.receivedAt && !pkg.putawayAt ? " · received" : ""}
                      {pkg.putawayAt ? " · put away" : ""}
                      {!pkg.receivedAt ? " · expected" : ""}
                    </span>
                  </span>
                  {canReceiveAsn(asn.status) && !pkg.receivedAt ? (
                    <Button variant="secondary" onClick={() => void receiveCarton(pkg.id)}>
                      Receive carton
                    </Button>
                  ) : null}
                  {pkg.receivedAt && !pkg.putawayAt ? (
                    <span className="flex flex-wrap gap-2">
                      <Button variant="secondary" asChild>
                        <Link to={`/floor/putaway?carton=${encodeURIComponent(pkg.sscc || pkg.number)}`}>Put away</Link>
                      </Button>
                      <Button variant="secondary" onClick={() => void unreceiveCarton(pkg.id)}>
                        Unreceive
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No vendor boxes yet. Loose receive still works.</p>
          )}
        </Card>
        <Table columns={["SKU", "Item", "Expected", "Received", "This receive", "Lot / serial"]}>
          {(asn.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-2.5 py-1.5 font-mono">{line.sku}</td>
              <td className="px-2.5 py-1.5">{line.itemName}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyExpected}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyReceived}</td>
              <td className="px-2.5 py-1.5">
                {line.remaining > 0 ? (
                  <Input
                    type="number"
                    min={0}
                    max={line.remaining}
                    value={qtys[line.itemId] ?? "0"}
                    onChange={(e) => setQtys((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : (
                  <span className="text-muted-foreground">Done</span>
                )}
              </td>
              <td className="px-2.5 py-1.5">
                {line.trackLot ? (
                  <Input
                    placeholder="Lot"
                    value={lots[line.itemId] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial ? (
                  <Input
                    className="mt-1"
                    placeholder="Serials"
                    value={serials[line.itemId] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  className="mt-1"
                  show={line.catchWeight}
                  value={weights[line.itemId] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                />
                <ExpiryInput
                  className="mt-1"
                  show={line.trackExpiry}
                  value={expiries[line.itemId] ?? ""}
                  onChange={(value) => setExpiries((current) => ({ ...current, [line.itemId]: value }))}
                />
              </td>
            </tr>
          ))}
        </Table>
      </DocumentFrame>
    </div>
  );
}
