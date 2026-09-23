import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ImagePlus, ListTree, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api, errorText, uploadFile, type Bom, type BomStep, type Item, type Me } from "../api";
import { Button, EmptyState, Input, PageHeader, Select, Table, summarizeLines } from "../components/ui";
import { SkuThumb } from "../components/sku-thumb";
import { KitRecipeCard } from "../components/kit-recipe";
import { useConfirm } from "../components/confirm";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { LineChips, Muted, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { LinesField, SelectField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
import { apiMutate, refreshApi, useApiQuery } from "../query";
import { blankLine, lineDraftSchema, requiredChoice, uniqueLinesSchema } from "@/domain/form-schemas";

/**
 * POST /api/boms (`src/routes/manufacturing.ts`): a parent SKU, then components with a qty of 1 or
 * more. Each component once per recipe (the `bom_lines` unique index), and never the parent itself.
 * Lines are checked raw so the self-component message lands on its own row.
 */
const recipeFormSchema = z
  .object({
    itemId: requiredChoice("Pick the SKU this recipe builds."),
    lines: z.array(lineDraftSchema),
  })
  .superRefine((value, ctx) => {
    const lines = uniqueLinesSchema.safeParse(value.lines);
    if (!lines.success) {
      for (const issue of lines.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message, path: ["lines", ...issue.path], input: issue.input });
      }
    }
    value.lines.forEach((line, index) => {
      if (line.itemId && line.itemId === value.itemId) {
        ctx.addIssue({
          code: "custom",
          message: "A recipe cannot use the SKU it builds.",
          path: ["lines", index, "itemId"],
          input: line.itemId,
        });
      }
    });
  })
  .transform((value) => ({ itemId: value.itemId, lines: uniqueLinesSchema.parse(value.lines) }));
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

const RECIPE_TABS: TabDef<Bom>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "steps", label: "With steps", match: (bom) => (bom.steps ?? []).length > 0 },
  { id: "no-steps", label: "No steps", match: (bom) => (bom.steps ?? []).length === 0 },
];

const RECIPE_COLUMNS: DataColumn<Bom>[] = [
  {
    id: "item",
    header: "Builds",
    sortValue: (bom) => bom.sku,
    csv: (bom) => `${bom.sku} — ${bom.itemName}`,
    cell: (bom) => <SkuCell sku={bom.sku} name={bom.itemName} imageUrl={bom.imageUrl} />,
  },
  {
    id: "components",
    header: "Components",
    csv: (bom) => summarizeLines(bom.lines),
    cell: (bom) => <LineChips lines={bom.lines} max={4} />,
  },
  {
    id: "count",
    header: "Parts",
    align: "right",
    defaultHidden: true,
    sortValue: (bom) => bom.lines.length,
    cell: (bom) => <span className="font-mono">{bom.lines.length}</span>,
  },
  {
    id: "steps",
    header: "Steps",
    align: "right",
    sortValue: (bom) => (bom.steps ?? []).length,
    cell: (bom) => {
      const count = (bom.steps ?? []).length;
      return count ? <span className="font-mono">{count}</span> : <Muted>None</Muted>;
    },
  },
];

export function BomsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const boms = useApiQuery<Bom[]>("/api/boms");
  const [creating, setCreating] = useState(false);
  const rows = boms.data ?? [];

  const itemParam = params.get("item");
  const openId = params.get("recipe") ?? (itemParam ? rows.find((bom) => bom.itemId === itemParam)?.id : undefined);
  const openBom = openId ? rows.find((bom) => bom.id === openId) ?? null : null;

  function hrefFor(bom: Bom) {
    const next = new URLSearchParams(params);
    next.delete("item");
    next.set("recipe", bom.id);
    return `/make/recipes?${next.toString()}`;
  }

  function closeRecipe() {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("recipe");
        next.delete("item");
        return next;
      },
      { replace: true },
    );
  }

  function openRecipe(id: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("item");
      next.set("recipe", id);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Make"
        title="Recipes"
        description={
          <>
            One <Term id="recipe">recipe</Term> per finished or <Term id="wip">WIP</Term> SKU. Numbered steps guide the
            bench; complete still explodes qty.
          </>
        }
      />
      <DataTable
        id="recipes"
        data={rows}
        loading={boms.isLoading}
        error={boms.error?.message}
        columns={RECIPE_COLUMNS}
        getRowId={(bom) => bom.id}
        rowHref={hrefFor}
        tabs={RECIPE_TABS}
        defaultTab="all"
        defaultSort={{ id: "item", desc: false }}
        search={{
          placeholder: "Search SKU, component",
          text: (bom) => [bom.sku, bom.itemName, ...bom.lines.map((line) => line.sku)].filter(Boolean).join(" "),
        }}
        exportName="recipes"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New recipe
          </Button>
        }
        empty={
          <EmptyState
            icon={ListTree}
            title="No recipes yet."
            body="A recipe lists the components one finished or WIP SKU consumes. Work orders and kits need one."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New recipe
              </Button>
            }
          />
        }
      />
      <NewRecipeSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={(bom) => {
          setCreating(false);
          openRecipe(bom.id);
        }}
      />
      {openBom ? (
        <RecipeSheet
          key={openBom.id}
          bom={openBom}
          canDelete={me.role === "owner"}
          onClose={closeRecipe}
          onSaved={async () => {
            await boms.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function NewRecipeSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (bom: Bom) => void;
}) {
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const form = useZodForm(recipeFormSchema, { itemId: "", lines: [blankLine()] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = items.data ?? [];
  const parents = useMemo(() => all.filter((item) => item.type === "finished" || item.type === "wip"), [all]);

  // Keep what was typed between opens, but start each open without stale inline errors.
  const { reset, getValues, setValue, watch, trigger, getFieldState } = form;
  useEffect(() => {
    if (open) reset(getValues(), { keepDefaultValues: true });
  }, [open, reset, getValues]);

  const itemId = watch("itemId");
  useEffect(() => {
    if (!itemId && parents[0]) setValue("itemId", parents[0].id);
  }, [parents, itemId, setValue]);

  // The "cannot use the SKU it builds" message sits on a line row, so re-check the lines when the
  // parent changes (once they have been checked), or the message stays after the parent is fixed.
  const submitted = form.formState.isSubmitted;
  const submittedRef = useRef(submitted);
  submittedRef.current = submitted;
  useEffect(() => {
    if (submittedRef.current || getFieldState("lines").invalid) void trigger("lines");
  }, [itemId, trigger, getFieldState]);

  async function create(values: ZodFormOutput<typeof recipeFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      // Same body as before: blank rows are already dropped and qty is a number.
      const created = await apiMutate<Bom>("/api/boms", {
        body: JSON.stringify({
          itemId: values.itemId,
          lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        }),
      });
      reset({ itemId: values.itemId, lines: [blankLine()] }, { keepDefaultValues: true });
      toast.success(`Recipe saved for ${created.sku}. Add bench steps next.`);
      onCreated(created);
    } catch (err) {
      setError(errorText(err, "Could not save the recipe."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New recipe"
      description="What one unit of a finished or WIP SKU consumes. Steps come after you save."
      submitLabel="Save recipe"
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
    >
      <SelectField
        form={form}
        name="itemId"
        label="Parent item"
        placeholder="Select parent"
        options={parents.map((item) => ({ value: item.id, label: `${item.sku} — ${item.name}` }))}
      />
      <LinesField form={form} name="lines" label="Components" items={all} />
    </FormSheet>
  );
}

function RecipeSheet({
  bom,
  canDelete,
  onClose,
  onSaved,
}: {
  bom: Bom;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [steps, setSteps] = useState<StepDraft[]>(() => draftsFrom(bom.steps));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    setSteps(draftsFrom(bom.steps));
  }, [bom.id, bom.steps]);

  function patchStep(index: number, patch: Partial<StepDraft>) {
    setSteps((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function saveSteps() {
    setError(null);
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
      void refreshApi();
      toast.success(`Saved ${payload.length} ${payload.length === 1 ? "step" : "steps"} for ${bom.sku}.`);
    } catch (err) {
      setError(errorText(err, "Could not save the steps."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete the ${bom.sku} recipe?`,
      body: `Its components, steps, and step photos are removed. Stock does not move, but open work orders and kits for ${bom.sku} cannot complete until it has a recipe again.`,
      confirmLabel: "Delete recipe",
      cancelLabel: "Keep recipe",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    setDeleting(true);
    try {
      await api(`/api/boms/${bom.id}`, { method: "DELETE" });
      void refreshApi();
      toast.success(`${bom.sku} recipe deleted.`);
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not delete the recipe."));
    } finally {
      setDeleting(false);
    }
  }

  const savedSteps = bom.steps ?? [];

  return (
    <FormSheet
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={`${bom.sku} recipe`}
      description={`${bom.itemName} · ${bom.lines.length} ${bom.lines.length === 1 ? "component" : "components"}`}
      submitLabel="Save steps"
      onSubmit={saveSteps}
      busy={saving}
      error={error}
      wide
    >
      <div className="flex items-center gap-3">
        <SkuThumb sku={bom.sku} name={bom.itemName} imageUrl={bom.imageUrl} />
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">{bom.sku}</p>
          <p className="truncate text-sm text-muted-foreground">{bom.itemName}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Components</p>
        <Table columns={["Component", "Qty each"]}>
          {bom.lines.map((line) => (
            <tr key={line.id}>
              <td>
                <SkuCell sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} />
              </td>
              <td className="font-mono tabular-nums">{line.qty}</td>
            </tr>
          ))}
        </Table>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium">Kitting steps</p>
          <p className="text-xs text-muted-foreground">Steps with no title or text are dropped on save.</p>
        </div>
        <ol className="space-y-2">
          {steps.map((step, index) => {
            const partSku = bom.lines.find((line) => line.itemId === step.componentItemId)?.sku || bom.sku;
            return (
              <li key={step.id ?? `new-${index}`} className="space-y-2 rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-semibold">
                    {index + 1}
                  </span>
                  <Input
                    placeholder={`Step ${index + 1} title`}
                    aria-label={`Step ${index + 1} title`}
                    value={step.title}
                    onChange={(e) => patchStep(index, { title: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove step ${index + 1}`}
                    title="Remove step"
                    onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-2 pl-8 sm:grid-cols-[1fr_10rem]">
                  <Input
                    placeholder="What to do"
                    aria-label={`Step ${index + 1} instructions`}
                    value={step.body}
                    onChange={(e) => patchStep(index, { body: e.target.value })}
                  />
                  <Select
                    aria-label={`Step ${index + 1} component`}
                    value={step.componentItemId}
                    onChange={(e) => patchStep(index, { componentItemId: e.target.value })}
                  >
                    <option value="">Component</option>
                    {bom.lines.map((line) => (
                      <option key={line.itemId} value={line.itemId}>
                        {line.sku}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center gap-2 pl-8">
                  <SkuThumb sku={partSku} imageUrl={step.imageUrl} size="sm" />
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                    <ImagePlus className="size-4" />
                    {step.file ? step.file.name : step.imageUrl ? "Replace photo" : "Add photo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        e.target.value = "";
                        patchStep(index, { file });
                      }}
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSteps((current) => [...current, { title: "", body: "", componentItemId: "" }])}
        >
          <Plus className="size-4" />
          Add step
        </Button>
      </div>

      {savedSteps.length ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">What the bench sees</p>
          <div className="rounded-lg border bg-card p-3">
            <KitRecipeCard sku={bom.sku} itemName={bom.itemName} imageUrl={bom.imageUrl} components={bom.lines} steps={savedSteps} />
          </div>
        </div>
      ) : null}

      {canDelete ? (
        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">Owners can delete a recipe. Open builds of {bom.sku} cannot complete without one.</p>
          <Button size="sm" variant="outline" className="text-tone-danger" disabled={deleting} onClick={() => void remove()}>
            <Trash2 className="size-4" />
            Delete recipe
          </Button>
        </div>
      ) : null}
    </FormSheet>
  );
}
