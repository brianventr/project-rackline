import { useEffect, useState } from "react";
import { api, uploadFile, type Bom, type BomStep, type Item, type Me } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";
import { SkuThumb } from "../components/sku-thumb";
import { KitRecipeCard } from "../components/kit-recipe";

type Line = { itemId: string; qty: string };
type StepDraft = {
  id?: string;
  title: string;
  body: string;
  componentItemId: string;
  imageUrl?: string | null;
  file?: File | null;
};

function draftsFrom(steps: BomStep[] | undefined): StepDraft[] {
  if (!steps?.length) return [{ title: "", body: "", componentItemId: "" }];
  return steps.map((step) => ({
    id: step.id,
    title: step.title,
    body: step.body,
    componentItemId: step.componentItemId ?? "",
    imageUrl: step.imageUrl,
  }));
}

export function BomsPage({ me }: { me: Me }) {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemId, setItemId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextBoms, nextItems] = await Promise.all([api<Bom[]>("/api/boms"), api<Item[]>("/api/items")]);
    setBoms(nextBoms);
    setItems(nextItems);
    const finished = nextItems.find((item) => item.type === "finished" || item.type === "wip");
    if (!itemId && finished) setItemId(finished.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api("/api/boms", {
        method: "POST",
        body: JSON.stringify({
          itemId,
          lines: lines
            .filter((line) => line.itemId)
            .map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      setLines([{ itemId: "", qty: "1" }]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create BOM");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/api/boms/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete BOM");
    }
  }

  const parents = items.filter((item) => item.type === "finished" || item.type === "wip");

  return (
    <div>
      <PageHeader
        eyebrow="Make"
        title="Recipes"
        description="One recipe per finished or WIP SKU. Numbered steps guide the bench; complete still explodes qty."
      />
      <ErrorBanner error={error} />
      <Card className="mb-3">
        <form className="space-y-4" onSubmit={onSubmit(create)}>
          <Field label="Parent item">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Select parent</option>
              {parents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} — {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[1fr_120px]">
                <Select
                  value={line.itemId}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((row, i) => (i === index ? { ...row, itemId: e.target.value } : row)),
                    )
                  }
                >
                  <option value="">Component</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((row, i) => (i === index ? { ...row, qty: e.target.value } : row)),
                    )
                  }
                />
              </div>
            ))}
            <Button variant="ghost" onClick={() => setLines((current) => [...current, { itemId: "", qty: "1" }])}>
              Add component
            </Button>
          </div>
          <Button type="submit">Save BOM</Button>
        </form>
      </Card>
      {boms.map((bom) => (
        <BomCard
          key={bom.id}
          bom={bom}
          canDelete={me.role === "owner"}
          onDelete={() => void remove(bom.id)}
          onError={setError}
          onSaved={load}
        />
      ))}
    </div>
  );
}

function BomCard({
  bom,
  canDelete,
  onDelete,
  onError,
  onSaved,
}: {
  bom: Bom;
  canDelete: boolean;
  onDelete: () => void;
  onError: (message: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [steps, setSteps] = useState<StepDraft[]>(() => draftsFrom(bom.steps));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSteps(draftsFrom(bom.steps));
  }, [bom.id, bom.steps]);

  async function saveSteps() {
    onError(null);
    setSaving(true);
    try {
      const payload = steps
        .filter((step) => step.title.trim() || step.body.trim())
        .map((step, index) => ({
          id: step.id,
          seq: index + 1,
          title: step.title,
          body: step.body,
          componentItemId: step.componentItemId || null,
          imageUrl: step.imageUrl ?? null,
        }));
      const saved = await api<Bom>(`/api/boms/${bom.id}/steps`, {
        method: "PUT",
        body: JSON.stringify({ steps: payload }),
      });
      const files = steps.filter((step) => step.file);
      for (const draft of files) {
        const match = (saved.steps ?? []).find(
          (step) =>
            step.title === draft.title.trim() &&
            step.body === draft.body.trim() &&
            (step.componentItemId ?? "") === (draft.componentItemId || ""),
        );
        if (match && draft.file) {
          await uploadFile(`/api/boms/${bom.id}/steps/${match.id}/image`, draft.file);
        }
      }
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save steps");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SkuThumb sku={bom.sku} name={bom.itemName} imageUrl={bom.imageUrl} />
          <h2 className="font-semibold">
            {bom.sku} — {bom.itemName}
          </h2>
        </div>
        {canDelete ? (
          <button className="text-sm text-bad" onClick={onDelete}>
            Delete
          </button>
        ) : null}
      </div>
      <Table columns={["", "Component", "Qty each"]}>
        {bom.lines.map((line) => (
          <tr key={line.id}>
            <td className="px-2.5 py-1.5">
              <SkuThumb sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} size="sm" />
            </td>
            <td className="px-2.5 py-1.5">
              <span className="font-mono">{line.sku}</span> {line.itemName}
            </td>
            <td className="px-2.5 py-1.5 font-mono tabular">{line.qty}</td>
          </tr>
        ))}
      </Table>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Kitting steps</h3>
        {steps.map((step, index) => (
          <div key={step.id ?? `new-${index}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-[auto_1fr_1fr_160px]">
            <SkuThumb
              sku={bom.lines.find((line) => line.itemId === step.componentItemId)?.sku || bom.sku}
              imageUrl={step.imageUrl}
              size="sm"
            />
            <Input
              placeholder={`Step ${index + 1} title`}
              value={step.title}
              onChange={(e) =>
                setSteps((current) => current.map((row, i) => (i === index ? { ...row, title: e.target.value } : row)))
              }
            />
            <Input
              placeholder="What to do"
              value={step.body}
              onChange={(e) =>
                setSteps((current) => current.map((row, i) => (i === index ? { ...row, body: e.target.value } : row)))
              }
            />
            <Select
              value={step.componentItemId}
              onChange={(e) =>
                setSteps((current) =>
                  current.map((row, i) => (i === index ? { ...row, componentItemId: e.target.value } : row)),
                )
              }
            >
              <option value="">Component</option>
              {bom.lines.map((line) => (
                <option key={line.itemId} value={line.itemId}>
                  {line.sku}
                </option>
              ))}
            </Select>
            <div className="flex flex-wrap items-center gap-2 md:col-span-4">
              <label className="inline-flex cursor-pointer text-sm underline">
                Photo
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    setSteps((current) => current.map((row, i) => (i === index ? { ...row, file } : row)));
                  }}
                />
              </label>
              <Button
                variant="ghost"
                onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setSteps((current) => [...current, { title: "", body: "", componentItemId: "" }])}>
            Add step
          </Button>
          <Button onClick={() => void saveSteps()} disabled={saving}>
            {saving ? "Saving…" : "Save steps"}
          </Button>
        </div>
      </div>
      {(bom.steps ?? []).length ? (
        <KitRecipeCard sku={bom.sku} itemName={bom.itemName} imageUrl={bom.imageUrl} components={bom.lines} steps={bom.steps} />
      ) : null}
    </Card>
  );
}
