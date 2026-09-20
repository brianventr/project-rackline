import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Rma, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox, ClaimList, openFloorRow } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../../components/expiry-field";
import { DispositionSelect } from "../../components/disposition-field";
import { canReceiveReturn } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";
import {
  parseDisposition,
  returnPostedMessage,
  showPutawayAfterReturn,
  type ReturnDisposition,
} from "@/domain/return-disposition";

export function FloorReturnPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("return");
  const [params] = useSearchParams();
  const [returns, setReturns] = useState<Rma[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Rma | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, ReturnDisposition>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [postedDispositions, setPostedDispositions] = useState<string[]>([]);

  function openRma(rma: Rma) {
    setActive(rma);
    setQtys(Object.fromEntries((rma.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    setDispositions(
      Object.fromEntries(
        (rma.lines ?? []).map((line) => {
          try {
            return [line.itemId, parseDisposition(line.disposition)];
          } catch {
            return [line.itemId, "restock" as const];
          }
        }),
      ),
    );
  }

  async function load() {
    const [nextReturns, nextLocations] = await Promise.all([api<Rma[]>("/api/returns"), api<Location[]>("/api/locations")]);
    setReturns(
      nextReturns.filter(
        (row) =>
          canReceiveReturn(row.status) &&
          hasRemaining(
            (row.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qtyExpected,
              qtyReceived: line.qtyReceived,
            })),
          ),
      ),
    );
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(dock.id);
    const wanted = params.get("id");
    if (wanted) {
      const match = await api<Rma>(`/api/returns/${wanted}`);
      const nextJobs = await reloadJobs();
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "rma", match.id, "return"), openRma, setError);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    setDone(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "rma") {
          void api<Rma>(`/api/returns/${hit.rma.id}`).then((rma) =>
            openFloorRow(rma, me.user.id, jobForRef(jobs, "rma", rma.id, "return"), openRma, setError),
          );
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          return;
        }
        setError("Scan a return number or a bay barcode.");
      })
      .catch((err: Error) => setError(err.message));
  }, [jobs, me.user.id]);

  async function receive() {
    if (!active) return;
    setError(null);
    try {
      const lines = (active.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          serials: serials[line.itemId] || undefined,
          weightGrams: parseWeightGrams(weights[line.itemId]),
          expiresOn: parseExpiryInput(expiries[line.itemId]),
          disposition: dispositions[line.itemId] ?? "restock",
        }))
        .filter((line) => line.qty > 0);
      const posted = await api<Rma>(`/api/returns/${active.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      openRma(posted);
      const kinds = lines.map((line) => line.disposition);
      setPostedDispositions(kinds);
      setDone(returnPostedMessage(posted.number, kinds));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
  }

  const remaining =
    active &&
    hasRemaining(
      (active.lines ?? []).map((line) => ({
        itemId: line.itemId,
        qtyExpected: line.qtyExpected,
        qtyReceived: line.qtyReceived,
      })),
    );

  const putaway = showPutawayAfterReturn(
    postedDispositions.length
      ? postedDispositions
      : (active?.lines ?? []).filter((line) => line.qtyReceived > 0).map((line) => line.disposition ?? "restock"),
  );
  const held = (postedDispositions.length ? postedDispositions : (active?.lines ?? []).map((line) => line.disposition ?? "")).includes(
    "hold",
  );

  return (
    <FloorFrame title="Return" description="Scan an RMA, scan the bay, restock, scrap, or hold." error={error}>
      <FloorScanBox label="Scan return or bay" placeholder="RMA-DEMO1 or RECV" onScan={onScan} />
      {done ? (
        <p className="text-sm text-emerald-700">
          {done}{" "}
          {putaway ? (
            <Link
              className="font-medium underline"
              to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}
            >
              Put away
            </Link>
          ) : held ? (
            <Link className="font-medium underline" to="/floor/hold">
              Holds
            </Link>
          ) : null}
        </p>
      ) : null}
      {!active ? (
        <ClaimList
          title="Open returns"
          empty="Nothing to receive back."
          rows={returns}
          userId={me.user.id}
          jobFor={(row) => jobForRef(jobs, "rma", row.id, "return")}
          onOpen={(row) =>
            openFloorRow(row, me.user.id, jobForRef(jobs, "rma", row.id, "return"), (rma) => {
              void api<Rma>(`/api/returns/${rma.id}`).then(openRma);
            }, setError)
          }
          render={(row) => (
            <>
              <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
            </>
          )}
        />
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground">{active.customerName}</p>
            </div>
            <StatusBadge status={active.status} />
          </div>
          <ul className="space-y-3 text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
                <span>
                  {line.sku} · {line.qtyReceived}/{line.qtyExpected}
                </span>
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
                </div>
                {line.remaining > 0 ? (
                  <DispositionSelect
                    value={dispositions[line.itemId] ?? "restock"}
                    onChange={(value) => setDispositions((current) => ({ ...current, [line.itemId]: value }))}
                  />
                ) : null}
                {line.trackSerial ? (
                  <Input
                    placeholder="Serials"
                    value={serials[line.itemId] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  show={line.catchWeight}
                  value={weights[line.itemId] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                />
                <ExpiryInput
                  show={line.trackExpiry}
                  value={expiries[line.itemId] ?? ""}
                  onChange={(value) => setExpiries((current) => ({ ...current, [line.itemId]: value }))}
                />
              </li>
            ))}
          </ul>
          <Field label="Receive into">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          {canReceiveReturn(active.status) && remaining ? (
            <Button onClick={() => void receive()}>Post return</Button>
          ) : (
            <div className="space-y-2">
              <p>Already received.</p>
              {putaway ? (
                <Link
                  className="block text-sm underline"
                  to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}
                >
                  Put away from this bay
                </Link>
              ) : held ? (
                <Link className="block text-sm underline" to="/floor/hold">
                  Held at the dock
                </Link>
              ) : null}
            </div>
          )}
          <Link className="block text-sm underline" to="/outbound/returns">
            Office returns
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
