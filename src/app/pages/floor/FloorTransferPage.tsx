import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Repeat } from "lucide-react";
import { api, errorText, type ScanHit, type Transfer } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { canPostTransfer } from "@/domain/status";
import { hasUnmoved } from "@/domain/partial-transfer";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

export function FloorTransferPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("putaway");
  const [params] = useSearchParams();
  const [tickets, setTickets] = useState<Transfer[]>([]);
  const [active, setActive] = useState<Transfer | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  function applyTicket(transfer: Transfer) {
    setActive(transfer);
    setQtys(moveQtyDefaults(transfer));
  }

  async function load() {
    const next = await api<Transfer[]>("/api/transfers");
    setTickets(
      next.filter(
        (row) =>
          canPostTransfer(row.status) &&
          hasUnmoved(
            (row.lines ?? []).map((line) => ({
              lineId: line.id,
              sku: line.sku,
              qtyExpected: line.qty,
              qtyMoved: line.qtyMoved ?? 0,
            })),
          ),
      ),
    );
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      const match = next.find((row) => row.id === wanted) ?? (await api<Transfer>(`/api/transfers/${wanted}`));
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "transfer", match.id, "putaway"), applyTicket, setError);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load open putaway tickets.")))
      .finally(() => setLoaded(true));
  }, []);

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then(async (hit) => {
          if (hit.kind === "transfer") {
            const ticket = await api<Transfer>(`/api/transfers/${hit.transfer.id}`);
            report?.(
              openFloorRow(ticket, me.user.id, jobForRef(jobs, "transfer", ticket.id, "putaway"), applyTicket, setError),
            );
            return;
          }
          if (hit.kind === "item" && active) {
            const line = (active.lines ?? []).find((row) => row.itemId === hit.item.id || row.sku === hit.item.sku);
            if (!line) {
              setError(`${hit.item.sku} is not on this putaway ticket.`);
              report?.(false);
              return;
            }
            setQtys((current) => ({ ...current, [line.id]: String(line.remaining ?? 0) }));
            report?.(true);
            return;
          }
          setError("Scan a putaway ticket, then scan a SKU to fill remaining qty.");
          report?.(false);
        })
        .catch((err) => {
          setError(errorText(err, "That barcode did not scan. Try again."));
          report?.(false);
        });
    },
    [active, jobs, me.user.id],
  );

  async function post() {
    if (!active) return;
    setError(null);
    try {
      if (active.status === "draft") {
        const started = await api<Transfer>(`/api/transfers/${active.id}/start`, { method: "POST" });
        applyTicket(started);
      }
      const lines = (active.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(qtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const posted = await api<Transfer>(`/api/transfers/${active.id}/post`, {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      applyTicket(posted);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not post the putaway."));
    }
  }

  const remaining =
    active &&
    hasUnmoved(
      (active.lines ?? []).map((line) => ({
        lineId: line.id,
        sku: line.sku,
        qtyExpected: line.qty,
        qtyMoved: line.qtyMoved ?? 0,
      })),
    );
  const thisMove = Object.values(qtys).some((value) => Number(value) > 0);

  return (
    <FloorFrame
      title="Put away"
      description="Scan the ticket, move remaining qty from the from-bay onto the to-bay."
      error={error}
    >
      <FloorScanBox label="Scan putaway ticket or SKU" placeholder="XFR-DEMO1 or SHADE" onScan={onScan} />
      {!active ? (
        <ClaimList
          loading={!loaded}
          title="Open putaway tickets"
          empty="No open putaway tickets."
          emptyBody="Putaway tickets from the office show here until every unit has left the from-bay."
          emptyIcon={Repeat}
          emptyAction={
            <Button variant="secondary" className="h-11" asChild>
              <Link to="/floor/putaway?scan=1">Scan a bay instead</Link>
            </Button>
          }
          rows={tickets}
          userId={me.user.id}
          jobFor={(row) => jobForRef(jobs, "transfer", row.id, "putaway")}
          onOpen={(row) =>
            openFloorRow(row, me.user.id, jobForRef(jobs, "transfer", row.id, "putaway"), (ticket) => {
              api<Transfer>(`/api/transfers/${ticket.id}`)
                .then(applyTicket)
                .catch((err) => setError(errorText(err, "Could not open that putaway ticket.")));
            }, setError)
          }
          render={(row) => (
            <>
              <span className="font-mono">{row.number}</span> {row.fromCode} → {row.toCode}{" "}
              <StatusBadge status={row.status} />
            </>
          )}
          footer={
            tickets.length ? (
              <Link
                className="inline-flex min-h-11 items-center rounded-sm font-medium underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                to="/floor/putaway?scan=1"
              >
                Scan a bay instead
              </Link>
            ) : null
          }
        />
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p className="text-sm">
            <span className="text-muted-foreground">
              <Term id="putaway">Putaway</Term> ticket ·{" "}
            </span>
            <span className="font-mono">
              {active.fromCode} → {active.toCode}
            </span>
          </p>
          <ul className="space-y-3 text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="flex justify-between gap-3">
                  <span>
                    {line.sku} × {line.qty}
                    <span className="text-muted-foreground"> · moved {line.qtyMoved ?? 0}</span>
                  </span>
                </div>
                {(line.remaining ?? 0) > 0 ? (
                  <Field label={`This move (remaining ${line.remaining})`}>
                    <Input
                      className="h-11 text-base"
                      type="number"
                      min={0}
                      max={line.remaining}
                      value={qtys[line.id] ?? "0"}
                      onChange={(e) => setQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  </Field>
                ) : (
                  <p className="text-muted-foreground">Moved</p>
                )}
              </li>
            ))}
          </ul>
          {canPostTransfer(active.status) && remaining ? (
            <Button className="h-14 w-full text-lg sm:w-auto" disabled={!thisMove} onClick={() => void post()}>
              Move remaining
            </Button>
          ) : (
            <Link
              className="inline-flex min-h-11 items-center rounded-sm font-medium underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              to={`/floor/putaway?from=${encodeURIComponent(active.fromBarcode || active.fromCode || "")}`}
            >
              Scan-move leftover
            </Link>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}

function moveQtyDefaults(transfer: Transfer): Record<string, string> {
  return Object.fromEntries((transfer.lines ?? []).map((line) => [line.id, String(line.remaining ?? 0)]));
}
