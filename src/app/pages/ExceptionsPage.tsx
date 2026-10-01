import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BellOff, CheckCircle2, Loader2, MoreHorizontal, RefreshCw, RotateCcw, ScanLine, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { ApiError, errorText } from "../api";
import { Button, EmptyState, ErrorBanner, Field, PageHeader, ToneBadge } from "../components/ui";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { Muted, PersonAvatar, RelativeTime } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { useConfirm, type ConfirmOptions } from "../components/confirm";
import { Term } from "../components/term";
import { changeException, SEVERITY_TONE, useExceptionInbox, type ExceptionChange, type ExceptionChangeInput } from "../exceptions";
import { refreshApi } from "../query";
import { useSession } from "../session";
import { toastError } from "../use-write";
import { useWarehouse } from "../warehouse";
import { Button as UiButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  EXCEPTION_SEVERITIES,
  RESOLUTION_NOTE_MAX,
  SEVERITY_LABELS,
  SNOOZE_HOURS,
  SOURCE_LIMIT,
  listText,
  snoozeLabel,
  type ExceptionSeverity,
  type ExceptionVerb,
  type ExceptionView,
} from "@/domain/exceptions/inbox";
import { isGarageMode } from "@/domain/operating-mode";
import { relativeTime } from "@/domain/relative-time";
import { cn } from "@/lib/utils";

type Run = (row: ExceptionView, verb: ExceptionVerb, input?: ExceptionChangeInput) => Promise<void>;

/** Inline actions that change stock or spend money ask first; retries do not. */
function actionConfirm(row: ExceptionView): ConfirmOptions | null {
  switch (row.action?.id) {
    case "ship-anyway":
      return {
        title: "Ship this order anyway?",
        body: `${row.title}. Rackline buys the label and ships it now, skipping the rule's hold for this order only.`,
        confirmLabel: "Ship anyway",
      };
    case "release-hold":
      return {
        title: "Release this hold?",
        body: "Pick, replenish, kit, and move can use the stock again. A released hold cannot be reopened; place a new one if you need it back.",
        confirmLabel: "Release hold",
        tone: "danger",
      };
    default:
      return null;
  }
}

function doneText(row: ExceptionView, verb: ExceptionVerb, input: ExceptionChangeInput, result: ExceptionChange): string {
  switch (verb) {
    case "claim":
      return input.takeOver ? "Taken over. It is yours now." : "Claimed. It is yours now.";
    case "unclaim":
      return "Unclaimed. Anyone can take it.";
    case "snooze":
      return `Snoozed for ${snoozeLabel(input.hours ?? 1)}.`;
    case "resolve":
      return "Resolved. It leaves the inbox once its source clears.";
    case "reopen":
      return "Back in the open list.";
    case "action":
      return result.cleared ? `${row.action?.label ?? "Done"}: that cleared it.` : `${row.action?.label ?? "Done"} ran, but the problem is still there.`;
  }
}

export function ExceptionsPage() {
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  const owner = me.role === "owner";
  const userId = me.user.id;
  const { warehouseId, warehouse } = useWarehouse();
  const inbox = useExceptionInbox();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<ExceptionView | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  const data = inbox.data;
  const sourceLabels = useMemo(() => new Map((data?.sources ?? []).map((source) => [source.id, source.label])), [data?.sources]);

  const run: Run = async (row, verb, input = {}) => {
    if (verb === "action") {
      const ask = actionConfirm(row);
      if (ask && !(await confirm(ask))) return;
    }
    setBusyId(row.id);
    try {
      const result = await changeException(warehouseId, row, verb, input);
      toast.success(doneText(row, verb, input, result));
    } catch (err) {
      void refreshApi("/api/exceptions");
      if (err instanceof ApiError && err.code === "EXCEPTION_CLEARED") toast.success("That problem already cleared.");
      else toastError(err, "That did not go through. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  function openResolve(row: ExceptionView) {
    setResolving(row);
    setNote("");
    setNoteError(null);
  }

  async function submitResolve() {
    if (!resolving) return;
    if (!note.trim()) {
      setNoteError("Say what you did, so the next person knows.");
      return;
    }
    setBusyId(resolving.id);
    setNoteError(null);
    try {
      const result = await changeException(warehouseId, resolving, "resolve", { note });
      toast.success(doneText(resolving, "resolve", { note }, result));
      setResolving(null);
    } catch (err) {
      void refreshApi("/api/exceptions");
      setNoteError(errorText(err, "Could not resolve it. Try again."));
    } finally {
      setBusyId(null);
    }
  }

  const tabs: TabDef<ExceptionView>[] = [
    { id: "open", label: "Open", match: (row) => row.state === "open" },
    { id: "mine", label: "Mine", match: (row) => row.state === "open" && row.claimedBy === userId },
    { id: "unclaimed", label: "Unclaimed", match: (row) => row.state === "open" && !row.claimedBy },
    { id: "snoozed", label: "Snoozed", match: (row) => row.state === "snoozed" },
    { id: "resolved", label: "Resolved", match: (row) => row.state === "resolved" },
  ];

  const facets: FacetDef<ExceptionView>[] = [
    {
      id: "severity",
      label: "Severity",
      value: (row) => row.severity,
      format: (value) => SEVERITY_LABELS[value as ExceptionSeverity] ?? value,
    },
    { id: "source", label: "Source", value: (row) => row.source, format: (value) => sourceLabels.get(value) ?? value },
    { id: "lane", label: "Fixed in", value: (row) => row.lane, format: (value) => (value === "floor" ? "Floor" : "Office") },
  ];

  const columns: DataColumn<ExceptionView>[] = [
    {
      id: "severity",
      header: "Severity",
      sortValue: (row) => EXCEPTION_SEVERITIES.indexOf(row.severity),
      csv: (row) => SEVERITY_LABELS[row.severity],
      cell: (row) => <ToneBadge tone={SEVERITY_TONE[row.severity]}>{SEVERITY_LABELS[row.severity]}</ToneBadge>,
    },
    {
      id: "problem",
      header: "Problem",
      sortValue: (row) => row.title,
      csv: (row) => `${row.title}. ${row.detail}`,
      cell: (row) => (
        <span className="flex min-w-64 max-w-xl flex-col gap-0.5 whitespace-normal">
          <Link to={row.link} className="font-medium text-foreground hover:text-primary hover:underline">
            {row.title}
          </Link>
          <span className="text-xs text-muted-foreground">{row.detail}</span>
        </span>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      sortValue: (row) => row.kindLabel,
      csv: (row) => row.kindLabel,
      cell: (row) => (
        <span className="flex flex-col">
          <span className="whitespace-nowrap">{row.kindLabel}</span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">{sourceLabels.get(row.source) ?? row.source}</span>
        </span>
      ),
    },
    {
      id: "since",
      header: "Since",
      sortValue: (row) => row.createdAt,
      csv: (row) => (row.createdAt ? new Date(row.createdAt).toISOString() : ""),
      cell: (row) => <RelativeTime at={row.createdAt} />,
    },
    {
      id: "owner",
      header: "Owner",
      sortValue: (row) => row.claimedByName,
      csv: (row) => row.claimedByName ?? "",
      cell: (row) => <OwnerCell row={row} userId={userId} />,
    },
    {
      id: "actions",
      header: "",
      hideable: false,
      cell: (row) => (
        <RowActions row={row} userId={userId} owner={owner} busy={busyId === row.id} run={run} onResolve={openResolve} />
      ),
    },
  ];

  const failed = data?.failed ?? [];
  const capped = data?.capped ?? [];
  const watching = (data?.sources ?? []).map((source) => source.label.toLowerCase());

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow={garage ? "Garage Mode" : warehouse?.name}
        title="Exceptions"
        description={
          <>
            Problems from every screen in one <Term id="exception-inbox">inbox</Term>. Claim one like a job, fix it where it lives, and
            it leaves on its own.
          </>
        }
        actions={
          <Button size="sm" variant="outline" aria-label="Refresh" disabled={inbox.isFetching} onClick={() => void refreshApi("/api/exceptions")}>
            <RefreshCw className={cn("size-4", inbox.isFetching && "animate-spin")} />
          </Button>
        }
      />

      <ErrorBanner
        error={
          failed.length
            ? `Could not read ${listText(failed.map((source) => source.label.toLowerCase()), 5)} just now. Those problems are missing from this list, not fixed. Refresh to try again.`
            : null
        }
      />
      {capped.length ? (
        <p className="rounded-lg border bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning">
          {listText(capped.map((source) => source.label), 5)}: showing the {SOURCE_LIMIT} most urgent. Clear those and the rest come in.
        </p>
      ) : null}

      <DataTable
        id="exceptions"
        data={data?.items}
        loading={inbox.isLoading}
        error={inbox.error?.message}
        columns={columns}
        getRowId={(row) => row.id}
        tabs={tabs}
        defaultTab="open"
        facets={facets}
        search={{
          placeholder: "Search problem, order, SKU, bay",
          text: (row) => [row.title, row.detail, row.kindLabel, row.claimedByName].filter(Boolean).join(" "),
        }}
        exportName="exceptions"
        empty={
          <EmptyState
            icon={CheckCircle2}
            title="Nothing needs attention."
            body={
              watching.length
                ? `Rackline is watching ${listText(watching, 20)}. A problem shows up here as it happens and leaves once it is fixed.`
                : "Problems show up here as they happen and leave once they are fixed."
            }
          />
        }
      />

      <FormSheet
        open={resolving != null}
        onOpenChange={(open) => (open ? null : setResolving(null))}
        title="Resolve"
        description={resolving?.title}
        submitLabel="Resolve"
        busy={resolving != null && busyId === resolving.id}
        error={noteError}
        onSubmit={submitResolve}
      >
        <Field label="What did you do?">
          <Textarea
            rows={3}
            maxLength={RESOLUTION_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Refunded the customer; the parcel is coming back to us."
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          The note goes in the audit log. A resolved problem stays under Resolved until its source clears, and opens again if it comes back.
        </p>
      </FormSheet>
    </div>
  );
}

function OwnerCell({ row, userId }: { row: ExceptionView; userId: string }) {
  if (row.state === "resolved") {
    return (
      <span className="flex max-w-56 flex-col whitespace-normal text-sm">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 text-tone-success" />
          {row.resolvedByName ?? "Resolved"}
          {row.resolvedAt ? <RelativeTime at={row.resolvedAt} className="text-xs" /> : null}
        </span>
        {row.resolutionNote ? <span className="text-xs text-muted-foreground">{row.resolutionNote}</span> : null}
      </span>
    );
  }
  const claimer = row.claimedBy ? (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <PersonAvatar name={row.claimedByName} />
      {row.claimedBy === userId ? "You" : (row.claimedByName ?? "Someone")}
    </span>
  ) : (
    <Muted>Unclaimed</Muted>
  );
  if (row.state === "snoozed" && row.snoozedUntil) {
    return (
      <span className="flex flex-col text-sm">
        {claimer}
        <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
          <BellOff className="size-3" />
          Wakes {relativeTime(row.snoozedUntil)}
        </span>
      </span>
    );
  }
  return claimer;
}

function RowActions({
  row,
  userId,
  owner,
  busy,
  run,
  onResolve,
}: {
  row: ExceptionView;
  userId: string;
  owner: boolean;
  busy: boolean;
  run: Run;
  onResolve: (row: ExceptionView) => void;
}) {
  const mine = row.claimedBy === userId;
  const other = Boolean(row.claimedBy) && !mine;
  if (other && !owner) return null;
  const open = row.state === "open";
  const action = open ? row.action : null;

  return (
    <div className="flex items-center justify-end gap-1.5">
      {busy ? <Loader2 aria-label="Working" className="size-4 animate-spin text-muted-foreground" /> : null}
      {action ? (
        <Button size="xs" disabled={busy} onClick={() => void run(row, "action", { actionId: action.id })}>
          {action.label}
        </Button>
      ) : null}
      {open && !row.claimedBy ? (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(row, "claim")}>
          Claim
        </Button>
      ) : null}
      {open && other ? (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(row, "claim", { takeOver: true })}>
          Take over
        </Button>
      ) : null}
      {row.state === "snoozed" ? (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(row, "reopen")}>
          Wake
        </Button>
      ) : null}
      {row.state === "resolved" ? (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(row, "reopen")}>
          <RotateCcw className="size-3.5" />
          Reopen
        </Button>
      ) : null}
      {row.state === "resolved" && !row.claimedBy && !row.floorLink ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <UiButton type="button" variant="ghost" size="icon-xs" disabled={busy} aria-label={`More for ${row.title}`}>
              <MoreHorizontal />
            </UiButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {row.state !== "resolved" ? (
              <DropdownMenuItem className="cursor-pointer" onSelect={() => onResolve(row)}>
                <CheckCircle2 />
                Resolve…
              </DropdownMenuItem>
            ) : null}
            {open ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="cursor-pointer">
                  <BellOff className="size-4 text-muted-foreground" />
                  Snooze
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {SNOOZE_HOURS.map((hours) => (
                    <DropdownMenuItem key={hours} className="cursor-pointer" onSelect={() => void run(row, "snooze", { hours })}>
                      {snoozeLabel(hours)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {row.claimedBy ? (
              <DropdownMenuItem className="cursor-pointer" onSelect={() => void run(row, "unclaim")}>
                <UserMinus />
                {mine ? "Unclaim" : `Unclaim from ${row.claimedByName ?? "them"}`}
              </DropdownMenuItem>
            ) : null}
            {row.floorLink ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link to={row.floorLink}>
                    <ScanLine />
                    Fix on the floor
                  </Link>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
