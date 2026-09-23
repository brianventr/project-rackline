import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { api, errorText, type Hold, type Item, type Location, type ScanHit } from "../../api";
import { Button, Card, EmptyState, Field, Input, Select, StatusBadge } from "../../components/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { FloorFrame, FloorScanBox, ClaimList, openFloorRow, type ScanReport } from "./floor-ui";
import { useWarehouse } from "../../warehouse";
import { HOLD_REASONS, holdLabel } from "@/domain/holds";
import { canReleaseHold } from "@/domain/status";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

export function FloorHoldPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("hold");
  const [params] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  // True once the bay list came back, so a failed load does not read as "no bays".
  const [baysLoaded, setBaysLoaded] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState<Hold | null>(null);
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [reason, setReason] = useState<(typeof HOLD_REASONS)[number]>("QC");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextHolds, nextLocations, nextItems] = await Promise.all([
      api<Hold[]>("/api/holds"),
      api<Location[]>("/api/locations"),
      api<Item[]>("/api/items"),
    ]);
    setHolds(nextHolds.filter((row) => canReleaseHold(row.status)));
    setLocations(nextLocations);
    setBaysLoaded(true);
    setItems(nextItems);
    const storage = nextLocations.find((row) => row.type === "storage") ?? nextLocations[0];
    const locationWanted = params.get("location");
    const match = locationWanted
      ? nextLocations.find((row) => row.id === locationWanted)
      : storage;
    if (match) setLocationId(match.id);
    const itemWanted = params.get("item");
    if (itemWanted) setItemId(itemWanted);
    const wanted = params.get("id");
    if (wanted) {
      const match = await api<Hold>(`/api/holds/${wanted}`);
      const nextJobs = await reloadJobs();
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "hold", match.id, "hold"), setActive, setError);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load open holds.")))
      .finally(() => setLoaded(true));
  }, []);

  const selectedItem = items.find((item) => item.id === itemId);

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then(async (hit) => {
          if (hit.kind === "hold") {
            const match = await api<Hold>(`/api/holds/${hit.hold.id}`);
            report?.(openFloorRow(match, me.user.id, jobForRef(jobs, "hold", match.id, "hold"), setActive, setError));
            return;
          }
          if (hit.kind === "location") {
            setLocationId(hit.location.id);
            setActive(null);
            report?.(true);
            return;
          }
          if (hit.kind === "item") {
            setItemId(hit.item.id);
            report?.(true);
            return;
          }
          setError("Scan a bay, a SKU, or a hold.");
          report?.(false);
        })
        .catch((err) => {
          setError(errorText(err, "That barcode did not scan. Try again."));
          report?.(false);
        });
    },
    [jobs, me.user.id],
  );

  async function place() {
    setError(null);
    try {
      const created = await api<Hold>("/api/holds", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          locationId,
          itemId: itemId || undefined,
          lotCode: lotCode.trim() || undefined,
          reason,
        }),
      });
      setActive(created);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not place the hold."));
    }
  }

  async function release() {
    if (!active) return;
    setError(null);
    try {
      setActive(await api<Hold>(`/api/holds/${active.id}/release`, { method: "POST" }));
      await load();
    } catch (err) {
      setError(errorText(err, "Could not release the hold."));
    }
  }

  const location = locations.find((row) => row.id === locationId);

  return (
    <FloorFrame
      title="Hold"
      description="Scan a bay to lock it. Scan a SKU to lock only that item. Pick, replenish, kit, and move skip held stock."
      error={error}
    >
      <FloorScanBox label="Scan bay, SKU, or hold" placeholder="A-01-02 or LED-BULB" onScan={onScan} />
      {active ? (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {holdLabel(active)} · {active.reason}
          </p>
          {canReleaseHold(active.status) ? (
            <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void release()}>
              Release
            </Button>
          ) : (
            <p>Released.</p>
          )}
          <Button variant="secondary" className="h-11 w-full sm:w-auto" onClick={() => setActive(null)}>
            Place another
          </Button>
        </Card>
      ) : loaded && baysLoaded && locations.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No bays to hold yet."
          body="Add bays under Locations, then scan one here to lock it."
          action={
            <Button variant="secondary" className="h-11" asChild>
              <Link to="/stock/locations">Add bays</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Card className="space-y-3">
            <Field label="Bay">
              <Select className="h-11 text-base" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="SKU (optional)">
              <Select className="h-11 text-base" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Whole bay</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedItem?.trackLot ? (
              <Field label="Lot (optional)">
                <Input
                  className="h-11 text-base"
                  value={lotCode}
                  onChange={(e) => setLotCode(e.target.value)}
                  placeholder="LOT-…"
                />
              </Field>
            ) : null}
            <Field label="Reason">
              <Select
                className="h-11 text-base"
                value={reason}
                onChange={(e) => setReason(e.target.value as (typeof HOLD_REASONS)[number])}
              >
                {HOLD_REASONS.map((row) => (
                  <option key={row} value={row}>
                    {row}
                  </option>
                ))}
              </Select>
            </Field>
            <Button className="h-14 w-full text-lg sm:w-auto" disabled={!locationId} onClick={() => void place()}>
              Place hold{location ? ` on ${location.code}` : ""}
            </Button>
          </Card>
          {loaded ? (
            <ClaimList
              title="Open holds"
              empty="Nothing is on hold."
              emptyBody="Holds placed here or in the office stay on this list until they are released."
              emptyIcon={ShieldAlert}
              rows={holds}
              userId={me.user.id}
              jobFor={(row) => jobForRef(jobs, "hold", row.id, "hold")}
              onOpen={(row) =>
                openFloorRow(row, me.user.id, jobForRef(jobs, "hold", row.id, "hold"), (hold) => {
                  api<Hold>(`/api/holds/${hold.id}`)
                    .then(setActive)
                    .catch((err) => setError(errorText(err, "Could not open that hold.")));
                }, setError)
              }
              render={(row) => (
                <>
                  {row.number} · {holdLabel(row)} <StatusBadge status={row.status} />
                </>
              )}
            />
          ) : (
            <Skeleton className="h-40 w-full rounded-xl motion-reduce:animate-none" />
          )}
        </>
      )}
    </FloorFrame>
  );
}
