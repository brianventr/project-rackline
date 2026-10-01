import { useEffect, useState } from "react";
import { Ban, Link2, Printer, Tag } from "lucide-react";
import { toast } from "sonner";
import { errorText, type CarrierHub, type ReturnLabel, type ReturnLabelDraft, type Rma, type RmaReturnLabels } from "../api";
import { Button, Card, ErrorBanner, Field, Input, Select, ToneBadge } from "../components/ui";
import { Textarea } from "@/components/ui/textarea";
import { FormSheet } from "../components/form-sheet";
import { DocumentFact } from "../components/document";
import { Muted, RelativeTime } from "../components/cells";
import { useConfirm } from "../components/confirm";
import { apiMutate, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { copyPublicLink } from "../tracking-link";
import type { StatusTone } from "@/domain/status";

export function useReturnLabels(rmaId: string) {
  return useApiQuery<RmaReturnLabels>(`/api/returns/${encodeURIComponent(rmaId)}/return-labels`);
}

function returnLabelTone(label: Pick<ReturnLabel, "status" | "trackerStatus">): StatusTone {
  if (label.status === "voided") return "neutral";
  if (label.trackerStatus === "delivered") return "success";
  if (label.trackerStatus === "exception") return "danger";
  if (label.trackerStatus === "in_transit") return "progress";
  return "info";
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The Returns list cell: the newest label on the RMA, in carrier wording once tracker updates arrive. */
export function ReturnLabelStatusCell({ rmaId }: { rmaId: string }) {
  const labels = useApiQuery<ReturnLabel[]>("/api/return-labels");
  const label = labels.data?.find((row) => row.rmaId === rmaId);
  if (!label) return <Muted>—</Muted>;
  return <ToneBadge tone={returnLabelTone(label)}>{label.statusLabel}</ToneBadge>;
}

/** The RMA's rail card: the customer's prepaid label and its link, or a way to buy one. */
export function ReturnLabelCard({
  rma,
  creating,
  onCreatingChange,
}: {
  rma: Rma;
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
}) {
  const labels = useReturnLabels(rma.id);
  const confirm = useConfirm();
  const write = useWrite();
  const active = labels.data?.labels.find((row) => row.status === "active") ?? null;
  const lastVoided = !active && labels.data?.labels[0]?.status === "voided";
  const received = rma.status === "received";

  async function voidLabel(label: ReturnLabel) {
    const ok = await confirm({
      title: `Void return label ${label.trackingNumber}?`,
      body: "The customer's link stops showing the label. A live label goes back to the carrier for a refund.",
      confirmLabel: "Void label",
      tone: "danger",
    });
    if (!ok) return;
    await write.run(
      "Void return label",
      () => apiMutate<ReturnLabel>(`/api/return-labels/${encodeURIComponent(label.id)}/void`, { body: "{}" }),
      "Return label voided.",
    );
  }

  return (
    <Card>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Return label</p>
          {active ? <ToneBadge tone={returnLabelTone(active)}>{active.statusLabel}</ToneBadge> : null}
        </div>
        <ErrorBanner error={write.error ?? labels.error?.message ?? null} />
        {active ? (
          <>
            <DocumentFact label="Service">
              {active.carrierCompany} {active.serviceName}
            </DocumentFact>
            <DocumentFact label="Tracking">
              {active.trackingUrl ? (
                <a className="font-mono underline" href={active.trackingUrl} target="_blank" rel="noreferrer">
                  {active.trackingNumber}
                </a>
              ) : (
                <span className="font-mono">{active.trackingNumber}</span>
              )}
            </DocumentFact>
            {active.postageCents != null ? <DocumentFact label="Postage">{money(active.postageCents)}</DocumentFact> : null}
            <DocumentFact label="Bought">
              <RelativeTime at={active.createdAt} />
            </DocumentFact>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" asChild>
                <a href={active.labelUrl ?? active.url} target="_blank" rel="noreferrer">
                  <Printer className="size-4" />
                  {active.labelUrl ? "Download label" : "Print label"}
                </a>
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copyPublicLink(active.url, "Return label link")}>
                <Link2 className="size-4" />
                Copy customer link
              </Button>
              <Button size="sm" variant="ghost" disabled={write.busy} onClick={() => void voidLabel(active)}>
                <Ban className="size-4" />
                Void
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {received
                ? "This return is already back."
                : lastVoided
                  ? "The last label was voided. Buy a new one before the customer sends the box."
                  : "Buy a prepaid label the customer prints at home, then send them its link."}
            </p>
            {!received ? (
              <Button size="sm" onClick={() => onCreatingChange(true)}>
                <Tag className="size-4" />
                Create return label
              </Button>
            ) : null}
          </>
        )}
      </div>
      <ReturnLabelSheet rmaId={rma.id} draft={labels.data?.draft ?? null} open={creating} onOpenChange={onCreatingChange} />
    </Card>
  );
}

function ReturnLabelSheet({
  rmaId,
  draft,
  open,
  onOpenChange,
}: {
  rmaId: string;
  draft: ReturnLabelDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const carriers = useApiQuery<CarrierHub>(open ? "/api/carriers" : null);
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [service, setService] = useState("");
  const [weightOz, setWeightOz] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !draft) return;
    setFromName(draft.fromName);
    setFromAddress(draft.fromAddress ?? "");
    setService(draft.carrierService);
    setError(null);
  }, [open, draft]);

  const services = carriers.data?.enabledServices ?? [];

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const picked = services.find((row) => row.id === service);
      const created = await apiMutate<ReturnLabel>(`/api/returns/${encodeURIComponent(rmaId)}/return-labels`, {
        body: JSON.stringify({
          fromName,
          fromAddress,
          carrierService: picked?.id ?? service,
          carrierConnectionId: picked?.connectionId ?? undefined,
          weightOz: weightOz.trim() ? Number(weightOz) : undefined,
        }),
      });
      toast.success(`Return label ${created.trackingNumber} is ready.`, {
        description: "Copy the customer link from the Return label card.",
      });
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err, "Could not buy the return label."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create return label"
      description="A prepaid label from the customer back to this building. The customer prints it from a link."
      submitLabel="Buy label"
      onSubmit={submit}
      busy={busy}
      error={error}
    >
      <Field label="Customer">
        <Input value={fromName} onChange={(event) => setFromName(event.target.value)} />
      </Field>
      <Field label="Customer address">
        <Textarea
          rows={3}
          value={fromAddress}
          placeholder="9 Bay Ave, Austin, TX 78701"
          onChange={(event) => setFromAddress(event.target.value)}
        />
      </Field>
      <Field label="Service">
        <Select value={service} onChange={(event) => setService(event.target.value)}>
          {services.length === 0 && service ? <option value={service}>{service}</option> : null}
          {services.map((row) => (
            <option key={row.id} value={row.id}>
              {row.company} {row.service}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Weight (oz)">
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="Same as the order, or 16"
          value={weightOz}
          onChange={(event) => setWeightOz(event.target.value)}
        />
      </Field>
      <div className="space-y-0.5 rounded-md border bg-muted/40 p-3 text-sm">
        <p className="text-xs text-muted-foreground">Comes back to</p>
        <p className="font-medium">{draft?.toName ?? ""}</p>
        <p className="whitespace-pre-line text-muted-foreground">
          {draft?.toAddress ?? "No return address yet. Add one in Settings → Warehouse."}
        </p>
      </div>
    </FormSheet>
  );
}
