import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, errorText } from "../../api";
import { Button, Card, EmptyState, ToneBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { changeException, SEVERITY_TONE, useExceptionInbox } from "../../exceptions";
import { refreshApi } from "../../query";
import { useSession } from "../../session";
import { useWarehouse } from "../../warehouse";
import { FloorFrame } from "./floor-ui";
import { SEVERITY_LABELS, type ExceptionView } from "@/domain/exceptions/inbox";
import { Skeleton } from "@/components/ui/skeleton";

export function FloorExceptionsPage() {
  const me = useSession();
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const inbox = useExceptionInbox();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const userId = me.user.id;

  const rows = (inbox.data?.items ?? []).filter((item) => item.state === "open" && item.lane === "floor");
  const mine = rows.filter((row) => row.claimedBy === userId);
  const pool = rows.filter((row) => !row.claimedBy);
  const others = rows.filter((row) => row.claimedBy && row.claimedBy !== userId);

  async function start(row: ExceptionView) {
    const to = row.floorLink ?? row.link;
    setError(null);
    if (row.claimedBy === userId) {
      navigate(to);
      return;
    }
    setBusyId(row.id);
    try {
      await changeException(warehouseId, row, "claim");
      navigate(to);
    } catch (err) {
      void refreshApi("/api/exceptions");
      if (err instanceof ApiError && err.code === "EXCEPTION_CLEARED") toast.success("That problem already cleared.");
      else setError(errorText(err, "Could not claim it. Try again."));
    } finally {
      setBusyId(null);
    }
  }

  function section(label: string, items: ExceptionView[], disabled: boolean) {
    if (!items.length) return null;
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <ul className="space-y-2 text-sm">
          {items.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                disabled={disabled || busyId != null}
                onClick={() => void start(row)}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block font-medium">{row.title}</span>
                    <span className="block text-xs text-muted-foreground">{row.detail}</span>
                    {disabled ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">Claimed by {row.claimedByName ?? "someone else"}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <ToneBadge tone={SEVERITY_TONE[row.severity]}>{SEVERITY_LABELS[row.severity]}</ToneBadge>
                    {busyId === row.id ? (
                      <Loader2 aria-label="Claiming" className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <FloorFrame
      title="Exceptions"
      description={
        <>
          Held stock, count variances, and over-full bays from the <Term id="exception-inbox">exception inbox</Term>. Tap one to claim
          it and fix it.
        </>
      }
      error={error ?? inbox.error?.message ?? null}
    >
      {inbox.isLoading ? (
        <div role="status" aria-label="Loading" className="space-y-2">
          <Skeleton className="h-14 w-full motion-reduce:animate-none" />
          <Skeleton className="h-14 w-full motion-reduce:animate-none" />
        </div>
      ) : rows.length ? (
        <Card className="space-y-4">
          {section("Mine", mine, false)}
          {section("Unclaimed", pool, false)}
          {section("Claimed by others", others, true)}
        </Card>
      ) : (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing to fix on the floor."
          body="Labels, tracking, and store syncs are fixed in the office, so they stay in the office inbox."
          action={
            <Button variant="secondary" className="h-11" asChild>
              <Link to="/floor">Back to the floor</Link>
            </Button>
          }
        />
      )}
    </FloorFrame>
  );
}
