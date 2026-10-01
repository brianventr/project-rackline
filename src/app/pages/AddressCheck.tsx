import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { errorText, type Order, type OrderAddressCheck } from "../api";
import { Button, Card, Field } from "../components/ui";
import { FormSheet } from "../components/form-sheet";
import { useConfirm } from "../components/confirm";
import { apiMutate, useApiQuery } from "../query";
import { Textarea } from "@/components/ui/textarea";

type AddressOrder = { id: string; number: string; shipToAddress?: string | null };

/** The carrier's address when the hold message does not already spell it out. */
export function extraSuggestion(message: string | null | undefined, suggestion: string | null | undefined): string | null {
  return suggestion && !(message ?? "").includes(suggestion) ? suggestion : null;
}

/** Writes the carrier's corrected address onto the order. Resolves true once it is there. */
export async function applySuggestedAddress(order: AddressOrder, suggestion: string | null | undefined): Promise<boolean> {
  try {
    await apiMutate(`/api/orders/${encodeURIComponent(order.id)}/address/use-suggestion`);
    toast.success(`${order.number} now ships to ${suggestion ?? "the suggested address"}.`);
    return true;
  } catch (err) {
    toast.error(errorText(err, "Could not use the suggested address. Try again."));
    return false;
  }
}

/** Retypes an order's ship-to address; its next label and quick-ship check the new one. */
export function AddressSheet({
  order,
  problem,
  open,
  onOpenChange,
  onSaved,
}: {
  order: AddressOrder;
  /** Why the address is held, shown above the field. */
  problem?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [text, setText] = useState(order.shipToAddress ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText(order.shipToAddress ?? "");
    setError(null);
  }, [open, order.shipToAddress]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await apiMutate(`/api/orders/${encodeURIComponent(order.id)}/address`, {
        method: "PUT",
        body: JSON.stringify({ shipToAddress: text }),
      });
      toast.success(`Saved the ship-to address on ${order.number}.`);
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      setError(errorText(err, "Could not save the address."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Ship-to address for ${order.number}`}
      description="One part per line: the street, then an apartment or suite, then the city with its state and ZIP code. Add the country on its own line when it is not this building's."
      submitLabel="Save address"
      onSubmit={save}
      busy={busy}
      error={error}
    >
      {problem ? <p className="text-sm text-tone-warning">{problem}</p> : null}
      <Field label="Ship to">
        <Textarea
          rows={5}
          value={text}
          placeholder={"88 Harbor Ave\nApt 4\nSeattle, WA 98101"}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
    </FormSheet>
  );
}

/**
 * The order page's view of the address check that holds a label, with the ways past it. The ship queue offers the
 * same in Garage; this is where Manufacturer, which ships from the floor, fixes or accepts an address.
 */
export function AddressCheckCard({ order, onChange }: { order: Order; onChange: () => void }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = order.status !== "shipped" && order.status !== "cancelled" && order.labelStatus !== "purchased";
  const check = useApiQuery<OrderAddressCheck>(open ? `/api/orders/${encodeURIComponent(order.id)}/address` : null);
  const data = check.data;
  if (!data?.blocked) return null;
  const extra = extraSuggestion(data.message, data.suggestion);

  async function takeSuggestion() {
    setBusy(true);
    if (await applySuggestedAddress(order, data?.suggestion)) onChange();
    setBusy(false);
  }

  async function accept() {
    const ok = await confirm({
      title: `Accept this address for ${order.number}?`,
      body: (
        <>
          <span className="block whitespace-pre-line font-medium text-foreground">{order.shipToAddress || "No address"}</span>
          <span className="mt-2 block">
            Labels for this order are bought to the address as it is. If the carrier cannot deliver it, the box comes
            back and the carrier may charge for the return.
          </span>
        </>
      ),
      confirmLabel: "Accept address",
      cancelLabel: "Keep holding",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiMutate(`/api/orders/${encodeURIComponent(order.id)}/address/accept`);
      toast.success(`Labels for ${order.number} go to this address as it is.`);
      onChange();
    } catch (err) {
      toast.error(errorText(err, "Could not accept the address. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium text-tone-warning">
        <AlertTriangle className="size-4 shrink-0" />
        Address check
      </p>
      <p className="text-sm">{data.message}</p>
      {extra ? <p className="text-xs text-muted-foreground">Suggested: {extra}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {data.suggestion ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void takeSuggestion()}>
            Use suggested address
          </Button>
        ) : null}
        <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
          Edit address
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void accept()}>
          Accept this address
        </Button>
      </div>
      <AddressSheet order={order} problem={data.message} open={editing} onOpenChange={setEditing} onSaved={onChange} />
    </Card>
  );
}
