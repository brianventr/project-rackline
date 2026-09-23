import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Undo2 } from "lucide-react";
import { api, errorText, type Location, type Rma, type ScanHit } from "../../api";
import { Button, Card, DoneBanner, Field, Input, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { BayCombobox } from "../../components/BayCombobox";
import { FloorFrame, FloorScanBox, ClaimList, openFloorRow, type ScanReport } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../../components/expiry-field";
import { DispositionSelect } from "../../components/disposition-field";
import { canReceiveReturn } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useSession } from "../../session";
import { useWarehouse } from "../../warehouse";
import { jobForRef, useOpenJobs } from "../../jobs";
import {
  parseDisposition,
  returnPostedMessage,
  showPutawayAfterReturn,
  type ReturnDisposition,
} from "@/domain/return-disposition";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FloorReturnPage() {
  const me = useSession();
  const { warehouseId } = useWarehouse();
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
    load().catch((err) => setError(errorText(err, "Could not load open returns.")));
  }, []);

  const onScan = useCallback((raw: string, report?: ScanReport) => {
    setError(null);
    setDone(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then(async (hit) => {
        if (hit.kind === "rma") {
          const rma = await api<Rma>(`/api/returns/${hit.rma.id}`);
          report?.(openFloorRow(rma, me.user.id, jobForRef(jobs, "rma", rma.id, "return"), openRma, setError));
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          report?.(true);
          return;
        }
        setError("Scan a return number or a bay barcode.");
        report?.(false);
      })
      .catch((err) => {
        setError(errorText(err, "That barcode did not scan. Try again."));
        report?.(false);
      });
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
      setError(errorText(err, "Could not post the return."));
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
      <DoneBanner>
        {done ? (
          <>
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
          </>
        ) : null}
      </DoneBanner>
      {!active ? (
        <ClaimList
          title="Open returns"
          empty="Nothing to receive back."
          emptyBody="Customer returns booked in the office show here until every line is back in a bay."
          emptyIcon={Undo2}
          emptyAction={
            <Button variant="secondary" className="h-11" asChild>
              <Link to="/outbound/returns">Office returns</Link>
            </Button>
          }
          rows={returns}
          userId={me.user.id}
          jobFor={(row) => jobForRef(jobs, "rma", row.id, "return")}
          onOpen={(row) =>
            openFloorRow(row, me.user.id, jobForRef(jobs, "rma", row.id, "return"), (rma) => {
              api<Rma>(`/api/returns/${rma.id}`)
                .then(openRma)
                .catch((err) => setError(errorText(err, "Could not open that return.")));
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
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground">{active.customerName}</p>
            </div>
            <StatusBadge status={active.status} />
          </div>
          {canReceiveReturn(active.status) && remaining ? (
            <p className="text-sm text-muted-foreground">
              Choose a <Term id="disposition">disposition</Term> for each line before you post.
            </p>
          ) : null}
          <ul className="space-y-3 text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
                <span>
                  {line.sku} · {line.qtyReceived}/{line.qtyExpected}
                </span>
                {line.remaining > 0 ? (
                  <Input
                    className="h-11 text-base"
                    type="number"
                    aria-label={`${line.sku} qty to receive`}
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
                    className="h-11 text-base"
                    aria-label={`${line.sku} serials`}
                    placeholder="Serials"
                    value={serials[line.itemId] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  className="h-11 text-base"
                  show={line.catchWeight}
                  value={weights[line.itemId] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                />
                <ExpiryInput
                  className="h-11 text-base"
                  show={line.trackExpiry}
                  value={expiries[line.itemId] ?? ""}
                  onChange={(value) => setExpiries((current) => ({ ...current, [line.itemId]: value }))}
                />
              </li>
            ))}
          </ul>
          <Field label="Receive into">
            <BayCombobox
              locations={locations}
              warehouseId={active.warehouseId || warehouseId}
              value={locationId}
              onChange={setLocationId}
              onCreated={(location) => setLocations((current) => [...current, location])}
            />
          </Field>
          {canReceiveReturn(active.status) && remaining ? (
            <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void receive()}>
              Post return
            </Button>
          ) : (
            <div className="space-y-2">
              <p>Already received.</p>
              {putaway ? (
                <Button className="h-14 w-full text-lg sm:w-auto" asChild>
                  <Link to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}>
                    Put away from this bay
                  </Link>
                </Button>
              ) : held ? (
                <Link className={textLink} to="/floor/hold">
                  Held at the dock
                </Link>
              ) : null}
            </div>
          )}
          <Link className={textLink} to="/outbound/returns">
            Office returns
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
