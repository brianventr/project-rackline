import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Location, type YardVisit } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";
import { DocumentHeader, DocumentActivity } from "../components/document";
import { YARD_STEPS, canAssignDock, canCheckInYard, canCheckOutYard } from "@/domain/status";
import { canReceiveLinkedAsn } from "@/domain/yard";
import { useWarehouse, inWarehouse } from "../warehouse";

export function YardPage() {
  const { id } = useParams();
  if (id) return <YardDetail id={id} />;
  return <YardList />;
}

function YardList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [visits, setVisits] = useState<YardVisit[]>([]);
  const [carrierName, setCarrierName] = useState("");
  const [trailerNumber, setTrailerNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setVisits(await api<YardVisit[]>("/api/yard"));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<YardVisit>("/api/yard", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          carrierName,
          trailerNumber: trailerNumber.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      navigate(`/inbound/yard/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create visit");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inbound"
        title="Yard"
        description="Carrier visits: check in at the gate, assign a dock, check out when clear."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New visit"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-6">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <Field label="Carrier">
              <Input value={carrierName} onChange={(e) => setCarrierName(e.target.value)} required placeholder="Swift Freight" />
            </Field>
            <Field label="Trailer">
              <Input value={trailerNumber} onChange={(e) => setTrailerNumber(e.target.value)} placeholder="TRL-…" />
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button type="submit">Create visit</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Carrier", "Trailer", "Status"]}>
        {inWarehouse(visits, warehouseId).map((visit) => (
          <tr key={visit.id}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/inbound/yard/${visit.id}`}>
                {visit.number}
              </Link>
            </td>
            <td className="px-4 py-3">{visit.carrierName}</td>
            <td className="px-4 py-3 font-mono">{visit.trailerNumber || "—"}</td>
            <td className="px-4 py-3">
              <StatusBadge status={visit.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function YardDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [visit, setVisit] = useState<YardVisit | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [dockLocationId, setDockLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, nextLocations] = await Promise.all([
      api<YardVisit>(`/api/yard/${id}`),
      api<Location[]>("/api/locations"),
    ]);
    setVisit(next);
    const docks = nextLocations.filter((row) => row.type === "receiving" || row.warehouseId === next.warehouseId);
    setLocations(docks.length ? docks : nextLocations);
    const dock =
      nextLocations.find((row) => row.id === next.dockLocationId) ??
      nextLocations.find((row) => row.type === "receiving" && row.warehouseId === next.warehouseId) ??
      nextLocations[0];
    if (dock) setDockLocationId(dock.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function checkIn() {
    setError(null);
    try {
      setVisit(await api<YardVisit>(`/api/yard/${id}/check-in`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check in");
    }
  }

  async function assignDock() {
    setError(null);
    try {
      setVisit(
        await api<YardVisit>(`/api/yard/${id}/dock`, {
          method: "POST",
          body: JSON.stringify({ dockLocationId }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign dock");
    }
  }

  async function checkOut() {
    setError(null);
    try {
      setVisit(await api<YardVisit>(`/api/yard/${id}/check-out`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check out");
    }
  }

  async function receiveAsn() {
    setError(null);
    try {
      await api(`/api/yard/${id}/receive-asn`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive ASN");
    }
  }

  if (!visit) return <ErrorBanner error={error} />;
  const dock = locations.find((row) => row.id === (visit.dockLocationId || dockLocationId));

  return (
    <div className="space-y-6">
      <DocumentHeader
        eyebrow="Inbound"
        title={visit.number}
        description={`${visit.carrierName}${visit.trailerNumber ? ` · ${visit.trailerNumber}` : ""}${visit.notes ? ` · ${visit.notes}` : ""}`}
        status={visit.status}
        steps={YARD_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/inbound/yard")}>
              All visits
            </Button>
            {canCheckInYard(visit.status) ? <Button onClick={() => void checkIn()}>Check in</Button> : null}
            {canAssignDock(visit.status) ? <Button onClick={() => void assignDock()}>Assign dock</Button> : null}
            {canReceiveLinkedAsn(visit) ? (
              <Button variant="secondary" onClick={() => void receiveAsn()}>
                Receive ASN
              </Button>
            ) : null}
            {canCheckOutYard(visit.status) ? <Button onClick={() => void checkOut()}>Check out</Button> : null}
            <Button variant="secondary" asChild>
              <Link to={`/floor/yard?id=${visit.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      {canAssignDock(visit.status) ? (
        <Card className="max-w-md">
          <Field label="Dock">
            <Select value={dockLocationId} onChange={(e) => setDockLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      ) : dock ? (
        <Card>
          <p className="text-sm">
            Dock <span className="font-mono">{dock.code}</span> — {dock.name}
          </p>
        </Card>
      ) : null}
      <DocumentActivity refId={visit.id} refreshKey={visit.status} />
    </div>
  );
}
