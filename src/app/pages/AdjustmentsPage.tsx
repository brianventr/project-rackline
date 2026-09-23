import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { SlidersHorizontal } from "lucide-react";
import { api, errorText, type Item, type Location } from "../api";
import { Button, Card, EmptyState } from "../components/ui";
import { SelectField, TextField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { FloorFrame } from "./floor/floor-ui";
import { requiredChoice, requiredText } from "@/domain/form-schemas";

/**
 * POST /api/adjustments (`src/routes/adjustments.ts`, `planAdjust`): a whole, non-zero qty (minus takes
 * stock out) and a reason. Whether the bay holds enough to take out is left to the server.
 */
const adjustmentSchema = z.object({
  itemId: requiredChoice("Pick a SKU."),
  locationId: requiredChoice("Pick a bay."),
  qtyDelta: z.union([z.string(), z.number()]).transform((value, ctx): number => {
    const text = String(value).trim();
    const n = Number(text);
    if (!text) {
      ctx.addIssue({ code: "custom", message: "Enter a qty, like 2 or -2.", input: value });
      return z.NEVER;
    }
    if (!Number.isInteger(n)) {
      ctx.addIssue({ code: "custom", message: "Qty must be a whole number.", input: value });
      return z.NEVER;
    }
    if (n === 0) {
      ctx.addIssue({ code: "custom", message: "Qty cannot be 0.", input: value });
      return z.NEVER;
    }
    return n;
  }),
  reason: requiredText("Enter a reason."),
});

export function AdjustmentsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const form = useZodForm(adjustmentSchema, { itemId: "", locationId: "", qtyDelta: "1", reason: "" });
  const { reset, getValues } = form;

  useEffect(() => {
    Promise.all([api<Item[]>("/api/items"), api<Location[]>("/api/locations")])
      .then(([nextItems, nextLocations]) => {
        setItems(nextItems);
        setLocations(nextLocations);
        reset({ ...getValues(), itemId: nextItems[0]?.id ?? "", locationId: nextLocations[0]?.id ?? "" });
        setLoaded(true);
      })
      .catch((err: unknown) => setError(errorText(err, "Could not load SKUs and bays. Try again.")));
  }, [reset, getValues]);

  async function submit(values: ZodFormOutput<typeof adjustmentSchema>) {
    setError(null);
    setOk(null);
    try {
      await api("/api/adjustments", {
        method: "POST",
        body: JSON.stringify({
          itemId: values.itemId,
          locationId: values.locationId,
          qtyDelta: values.qtyDelta,
          reason: values.reason,
        }),
      });
      reset({ ...getValues(), reason: "" });
      setOk("Adjustment posted to the ledger.");
    } catch (err) {
      setError(errorText(err, "Could not post the adjustment. Try again."));
    }
  }

  const missing = loaded && (items.length === 0 || locations.length === 0);

  return (
    <FloorFrame
      title="Adjust"
      description="Signed quantity change with a reason. Negative qty cannot drive a bay below zero."
      error={error}
    >
      {ok ? <p className="text-sm text-ok">{ok}</p> : null}
      {missing ? (
        <EmptyState
          className="max-w-xl"
          icon={SlidersHorizontal}
          title={items.length === 0 ? "No items yet." : "No locations yet."}
          body={
            items.length === 0
              ? "An adjustment changes one SKU in one bay. Add the SKU first, then correct its qty here."
              : "An adjustment changes one SKU in one bay. Add the bay first, then correct its qty here."
          }
          action={
            <Button size="sm" asChild>
              {items.length === 0 ? <Link to="/stock/items">Go to items</Link> : <Link to="/stock/locations">Go to locations</Link>}
            </Button>
          }
        />
      ) : (
        <Card className="max-w-xl">
          {/* Floor fields are 44px tall with 16px text, like the other floor screens. */}
          <form
            className="space-y-3 [&_input]:h-11 [&_input]:text-base [&_select]:h-11 [&_select]:text-base"
            onSubmit={form.handleSubmit(submit)}
          >
            <SelectField
              form={form}
              name="itemId"
              label="Item"
              options={items.map((item) => ({ value: item.id, label: `${item.sku} — ${item.name}` }))}
            />
            <SelectField
              form={form}
              name="locationId"
              label="Location"
              options={locations.map((location) => ({ value: location.id, label: `${location.code} — ${location.name}` }))}
            />
            {/* A plain number input, not NumberField: its numeric keypad has no minus key on phones. */}
            <TextField
              form={form}
              name="qtyDelta"
              label="Qty delta"
              type="number"
              description="Use a minus sign to take stock out, like -2."
            />
            <TextField form={form} name="reason" label="Reason" placeholder="Cycle count variance" />
            <Button type="submit" className="h-14 w-full text-lg sm:w-auto" disabled={form.formState.isSubmitting}>
              Post adjustment
            </Button>
          </form>
        </Card>
      )}
    </FloorFrame>
  );
}
