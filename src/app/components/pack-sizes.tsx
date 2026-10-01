import { useState } from "react";
import { Save } from "lucide-react";
import { api, type Item, type ItemPack } from "../api";
import { Button, Card, ErrorBanner, Input, Table } from "./ui";
import { ActionButton } from "./document";
import { Muted } from "./cells";
import { useWrite } from "../use-write";
import { normalizePackSizes, PACK_LABELS, PACK_LEVELS, PackSizeError, type PackLevel } from "@/domain/pack-sizes";

const FIELDS = ["qty", "barcode", "weightOz", "lengthIn", "widthIn", "heightIn"] as const;
type PackField = (typeof FIELDS)[number];
type PackDraft = Record<PackLevel, Record<PackField, string>>;

const FIELD_LABELS: Record<PackField, string> = {
  qty: "eaches",
  barcode: "barcode",
  weightOz: "weight (oz)",
  lengthIn: "length (in)",
  widthIn: "width (in)",
  heightIn: "height (in)",
};

function draftFrom(packs: ItemPack[]): PackDraft {
  const text = (value: number | string | null | undefined) => (value == null ? "" : String(value));
  return Object.fromEntries(
    PACK_LEVELS.map((level) => {
      const pack = packs.find((row) => row.level === level);
      return [level, Object.fromEntries(FIELDS.map((field) => [field, text(pack?.[field])]))];
    }),
  ) as PackDraft;
}

export function packSize(pack: Pick<ItemPack, "lengthIn" | "widthIn" | "heightIn">): string | null {
  return pack.lengthIn && pack.widthIn && pack.heightIn ? `${pack.lengthIn} × ${pack.widthIn} × ${pack.heightIn} in` : null;
}

/** Read-only pack levels, for lookup screens. */
export function PackSizesTable({ packs }: { packs: ItemPack[] }) {
  return (
    <Table columns={["Pack", "Eaches", "Barcode", "Weight", "Size"]}>
      {packs.map((pack) => (
        <tr key={pack.level}>
          <td>{PACK_LABELS[pack.level]}</td>
          <td className="font-mono tabular-nums">{pack.qty}</td>
          <td className="font-mono">{pack.barcode ?? <Muted>—</Muted>}</td>
          <td className="font-mono tabular-nums">{pack.weightOz ? `${pack.weightOz} oz` : <Muted>—</Muted>}</td>
          <td className="font-mono tabular-nums">{packSize(pack) ?? <Muted>—</Muted>}</td>
        </tr>
      ))}
    </Table>
  );
}

/** Inner, case, and pallet for one item. A level with no eaches is not used. */
export function PackSizesEditor({ item, onSaved }: { item: Item; onSaved: (next: Item) => void }) {
  const saved = draftFrom(item.packs ?? []);
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const { error, run } = useWrite();
  const dirty = PACK_LEVELS.some((level) => FIELDS.some((field) => draft[level][field] !== saved[level][field]));

  function set(level: PackLevel, field: PackField, value: string) {
    setDraft((current) => ({ ...current, [level]: { ...current[level], [field]: value } }));
  }

  async function save() {
    const rows = PACK_LEVELS.filter((level) => draft[level].qty.trim()).map((level) => ({ level, ...draft[level] }));
    try {
      normalizePackSizes(rows);
    } catch (err) {
      if (err instanceof PackSizeError) {
        setProblem(`${err.message}.`);
        return;
      }
      throw err;
    }
    setProblem(null);
    const next = await run(
      "Save pack sizes",
      () => api<Item>(`/api/items/${item.id}/packs`, { method: "PUT", body: JSON.stringify({ packs: rows }) }),
      "Pack sizes saved.",
    );
    if (next) {
      onSaved(next);
      setDraft(draftFrom(next.packs ?? []));
    }
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">Pack sizes</p>
          <p className="text-xs text-muted-foreground">
            Stock stays in eaches. Scanning a pack barcode on the floor counts all of its eaches at once. Each level holds whole
            packs of the one below it. Leave eaches blank for a level you do not use.
          </p>
        </div>
        <ErrorBanner error={problem ?? error} />
        <Table columns={["Level", "Eaches", "Barcode", "Weight (oz)", "L (in)", "W (in)", "H (in)"]}>
          {PACK_LEVELS.map((level) => (
            <tr key={level}>
              <td className="font-medium">{PACK_LABELS[level]}</td>
              {FIELDS.map((field) => (
                <td key={field} className={field === "barcode" ? "min-w-40" : "min-w-20"}>
                  <Input
                    aria-label={`${PACK_LABELS[level]} ${FIELD_LABELS[field]}`}
                    inputMode={field === "barcode" ? undefined : "numeric"}
                    className={field === "barcode" ? "font-mono" : "font-mono tabular-nums"}
                    placeholder={field === "qty" ? "—" : ""}
                    value={draft[level][field]}
                    onChange={(e) => set(level, field, e.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </Table>
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          {dirty ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(saved);
                setProblem(null);
              }}
            >
              Discard
            </Button>
          ) : null}
          <ActionButton action={{ label: "Save pack sizes", icon: Save, onSelect: save, disabled: !dirty }} />
        </div>
      </div>
    </Card>
  );
}
