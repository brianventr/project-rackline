import { useEffect, useState, type ChangeEvent } from "react";
import { api, type Item, type ItemCustoms } from "../api";
import { Button, Card, ErrorBanner, Field, Input, onSubmit } from "../components/ui";
import { Term } from "../components/term";
import { useWrite } from "../use-write";

type Draft = { hsCode: string; originCountry: string; customsDescription: string; customsValue: string };

function draftFrom(item: Pick<Item, "hsCode" | "originCountry" | "customsDescription" | "customsValueCents">): Draft {
  return {
    hsCode: item.hsCode ?? "",
    originCountry: item.originCountry ?? "",
    customsDescription: item.customsDescription ?? "",
    customsValue: item.customsValueCents ? (item.customsValueCents / 100).toFixed(2) : "",
  };
}

/** What an international label declares for one unit of this SKU (`PATCH /api/items/:id/customs`). */
export function ItemCustomsCard({ item }: { item: Item }) {
  const write = useWrite();
  const [saved, setSaved] = useState(() => draftFrom(item));
  const [draft, setDraft] = useState(saved);

  useEffect(() => {
    const next = draftFrom(item);
    setSaved(next);
    setDraft(next);
    // Only a different SKU resets the form; saving the item's other settings keeps a customs edit in progress.
  }, [item.id]);

  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((key) => draft[key] !== saved[key]);
  const edit = (key: keyof Draft) => (event: ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    const typed = draft.customsValue.trim().replace(/^\$/, "");
    const cents = typed ? Math.round(Number(typed) * 100) : null;
    const row = await write.run(
      "Save customs",
      () =>
        api<ItemCustoms>(`/api/items/${item.id}/customs`, {
          method: "PATCH",
          body: JSON.stringify({
            hsCode: draft.hsCode,
            originCountry: draft.originCountry,
            customsDescription: draft.customsDescription,
            customsValueCents: cents === null || Number.isFinite(cents) ? cents : typed,
          }),
        }),
      (next) => `Saved customs for ${next.sku}.`,
    );
    if (row) {
      const next = draftFrom(row);
      setSaved(next);
      setDraft(next);
    }
  }

  return (
    <Card className="mt-4">
      <form className="space-y-3" onSubmit={onSubmit(save)}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Customs</h2>
          <p className="text-sm text-muted-foreground">
            International labels declare these for each unit on the <Term id="customs-form">customs form</Term>. Without an{" "}
            <Term id="hs-code" />, country of origin, and declared value, an order shipping abroad waits under Needs attention.
          </p>
        </div>
        <ErrorBanner error={write.error} />
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label="HS code">
            <Input value={draft.hsCode} onChange={edit("hsCode")} placeholder="9405.20" inputMode="numeric" />
          </Field>
          <Field label="Country of origin">
            <Input value={draft.originCountry} onChange={edit("originCountry")} placeholder="US" maxLength={56} />
          </Field>
          <Field label="Customs description">
            <Input value={draft.customsDescription} onChange={edit("customsDescription")} placeholder={item.name} maxLength={100} />
          </Field>
          <Field label="Declared value per unit (USD)">
            <Input value={draft.customsValue} onChange={edit("customsValue")} placeholder="0.00" inputMode="decimal" />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(saved)}>
              Discard
            </Button>
          ) : null}
          <Button type="submit" size="sm" variant="outline" disabled={!dirty || write.busy}>
            Save customs
          </Button>
        </div>
      </form>
    </Card>
  );
}
