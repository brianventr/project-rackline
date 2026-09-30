import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowUp, Pencil, Plus, Split, Trash2 } from "lucide-react";
import { api, type ShipRuleRow, type ShipRulesPayload } from "../../api";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, ToneBadge } from "../../components/ui";
import { ActionMenu } from "../../components/document";
import { FormSheet } from "../../components/form-sheet";
import { apiMutate, useApiQuery } from "../../query";
import { useSession } from "../../session";
import { toastError, useWrite } from "../../use-write";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  describeShipRuleConditions,
  RATE_STRATEGY_LABELS,
  SHIP_RULE_CHANNEL_LABELS,
  SHIP_RULE_CHANNELS,
  type ShipRuleChannel,
} from "@/domain/ship-rules";

type SheetState = { mode: "new" } | { mode: "edit"; rule: ShipRuleRow } | null;

export function ShippingRulesPage() {
  const me = useSession();
  const garage = me.organization.operatingMode === "garage";
  const query = useApiQuery<ShipRulesPayload>("/api/ship/rules");
  const [sheet, setSheet] = useState<SheetState>(null);
  const [moving, setMoving] = useState(false);
  const data = query.data;
  const rules = useMemo(
    () => [...(data?.rules ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [data],
  );
  const buildingName = (id: string | null) =>
    id ? (data?.warehouses.find((row) => row.id === id)?.name ?? "One building") : "All buildings";

  async function move(rule: ShipRuleRow, by: -1 | 1) {
    const ids = rules.map((row) => row.id);
    const from = ids.indexOf(rule.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    setMoving(true);
    try {
      await apiMutate("/api/ship/rules/reorder", { body: JSON.stringify({ ids }), refresh: "/api/ship" });
    } catch (err) {
      toastError(err, "Could not move the rule. Try again.");
    } finally {
      setMoving(false);
    }
  }

  async function toggle(rule: ShipRuleRow, enabled: boolean) {
    try {
      await apiMutate(`/api/ship/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
        refresh: "/api/ship",
      });
    } catch (err) {
      toastError(err, `Could not turn ${rule.name} ${enabled ? "on" : "off"}. Try again.`);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Shipping rules"
        description="Rules pick the box and service for each order before one-click ship. Rackline checks them top to bottom and the first rule that is on and matches wins."
        actions={
          <Button size="sm" onClick={() => setSheet({ mode: "new" })}>
            <Plus className="size-4" />
            New rule
          </Button>
        }
      />

      {!garage ? (
        <Card className="text-sm">
          <p className="font-medium">Rules drive one-click ship, which runs in Garage mode</p>
          <p className="text-muted-foreground">
            In Manufacturer, orders ship through waves and the floor, and each label is bought on its order. Your rules stay
            here and apply again when you switch back to Garage.
          </p>
        </Card>
      ) : null}

      {!query.isLoading && !query.error && rules.length === 0 ? (
        <EmptyState
          icon={Split}
          title="No shipping rules yet."
          body="Without rules, every order ships in the default box with the building's default service. Add a rule to send small orders in a mailer, heavy ones by ground, or hold orders for a look before they ship."
          action={
            <Button size="sm" onClick={() => setSheet({ mode: "new" })}>
              New rule
            </Button>
          }
        />
      ) : (
        <Table columns={["#", "Rule", "When", "Then", "On", ""]} loading={query.isLoading}>
          {query.error ? (
            <tr>
              <td colSpan={6} className="text-sm text-destructive">
                {query.error.message}
              </td>
            </tr>
          ) : null}
          {rules.map((rule, index) => (
            <tr key={rule.id} className={rule.enabled ? undefined : "text-muted-foreground"}>
              <td className="w-px whitespace-nowrap">
                <span className="inline-flex items-center gap-0.5">
                  <span className="w-5 text-right font-mono text-xs tabular-nums">{index + 1}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move ${rule.name} up`}
                    disabled={moving || index === 0}
                    onClick={() => void move(rule, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move ${rule.name} down`}
                    disabled={moving || index === rules.length - 1}
                    onClick={() => void move(rule, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </span>
              </td>
              <td>
                <span className="flex flex-col">
                  <span className="font-medium">{rule.name}</span>
                  <span className="text-xs text-muted-foreground">{buildingName(rule.warehouseId)}</span>
                </span>
              </td>
              <td>
                <Chips items={describeShipRuleConditions(rule.conditions)} />
              </td>
              <td>
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1">
                    {rule.hold ? <ToneBadge tone="warning">Hold for review</ToneBadge> : null}
                    <Chips items={ruleActions(rule, data)} />
                  </span>
                  {rule.problem ? (
                    <span className="inline-flex items-start gap-1 text-xs text-tone-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {rule.problem}. Matching orders wait until the rule is fixed.
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="w-px">
                <Switch
                  checked={rule.enabled}
                  aria-label={`${rule.name} is ${rule.enabled ? "on" : "off"}`}
                  onCheckedChange={(value) => void toggle(rule, value)}
                />
              </td>
              <td className="w-px text-right">
                <ActionMenu
                  label={`${rule.name} actions`}
                  actions={[
                    { label: "Edit", icon: Pencil, onSelect: () => setSheet({ mode: "edit", rule }) },
                    {
                      label: "Delete rule",
                      icon: Trash2,
                      tone: "danger",
                      onSelect: () => apiMutate(`/api/ship/rules/${rule.id}`, { method: "DELETE", refresh: "/api/ship" }),
                      success: `Rule ${rule.name} deleted.`,
                      confirm: {
                        title: `Delete rule ${rule.name}?`,
                        body: "Orders it matched fall through to the next rule, or to the default box and service.",
                        confirmLabel: "Delete rule",
                        cancelLabel: "Keep rule",
                        tone: "danger",
                      },
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </Table>
      )}

      <p className="text-sm text-muted-foreground">
        Orders no rule matches ship in the default box with the building's default service. Change those in{" "}
        <Link to="/ship?setup=box" className="underline">
          Boxes
        </Link>{" "}
        and{" "}
        <Link to="/setup/warehouse" className="underline">
          Setup → Warehouse
        </Link>
        . Held orders wait under Needs attention on the ship queue until someone ships them.
      </p>

      <RuleSheet state={sheet} data={data} onClose={() => setSheet(null)} />
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((text) => (
        <span key={text} className="rounded border bg-muted/50 px-1.5 py-0.5 text-xs">
          {text}
        </span>
      ))}
    </span>
  );
}

function ruleActions(rule: ShipRuleRow, data: ShipRulesPayload | undefined): string[] {
  const out: string[] = [];
  const box = rule.presetId ? data?.presets.find((row) => row.id === rule.presetId) : null;
  if (box) out.push(`Box: ${box.name}`);
  if (rule.carrierService) {
    out.push(data?.services.find((row) => row.id === rule.carrierService)?.name ?? rule.carrierService);
  }
  if (rule.rateStrategy) out.push(RATE_STRATEGY_LABELS[rule.rateStrategy]);
  return out;
}

type RuleForm = {
  name: string;
  warehouseId: string;
  enabled: boolean;
  skus: string;
  minWeightOz: string;
  maxWeightOz: string;
  minItems: string;
  maxItems: string;
  minUnits: string;
  maxUnits: string;
  countries: string;
  regions: string;
  postalPrefixes: string;
  channels: ShipRuleChannel[];
  presetId: string;
  /** `""` (the building decides), `rate:<strategy>`, or `svc:<connectionId>:<serviceId>`. */
  service: string;
  hold: boolean;
};

const EMPTY_FORM: RuleForm = {
  name: "",
  warehouseId: "",
  enabled: true,
  skus: "",
  minWeightOz: "",
  maxWeightOz: "",
  minItems: "",
  maxItems: "",
  minUnits: "",
  maxUnits: "",
  countries: "",
  regions: "",
  postalPrefixes: "",
  channels: [],
  presetId: "",
  service: "",
  hold: false,
};

function formFromRule(rule: ShipRuleRow): RuleForm {
  const c = rule.conditions;
  const num = (value: number | undefined) => (value == null ? "" : String(value));
  const list = (value: string[] | undefined) => (value ?? []).join(", ");
  return {
    name: rule.name,
    warehouseId: rule.warehouseId ?? "",
    enabled: rule.enabled,
    skus: list(c.skus),
    minWeightOz: num(c.minWeightOz),
    maxWeightOz: num(c.maxWeightOz),
    minItems: num(c.minItems),
    maxItems: num(c.maxItems),
    minUnits: num(c.minUnits),
    maxUnits: num(c.maxUnits),
    countries: list(c.countries),
    regions: list(c.regions),
    postalPrefixes: list(c.postalPrefixes),
    channels: c.channels ?? [],
    presetId: rule.presetId ?? "",
    service: rule.rateStrategy
      ? `rate:${rule.rateStrategy}`
      : rule.carrierService
        ? `svc:${rule.carrierConnectionId ?? ""}:${rule.carrierService}`
        : "",
    hold: rule.hold,
  };
}

function ruleBody(form: RuleForm) {
  const [kind, first = "", ...rest] = form.service.split(":");
  return {
    name: form.name,
    warehouseId: form.warehouseId || null,
    enabled: form.enabled,
    hold: form.hold,
    presetId: form.presetId || null,
    rateStrategy: kind === "rate" ? first : null,
    carrierService: kind === "svc" ? rest.join(":") : null,
    carrierConnectionId: kind === "svc" ? first || null : null,
    conditions: {
      skus: form.skus,
      minWeightOz: form.minWeightOz,
      maxWeightOz: form.maxWeightOz,
      minItems: form.minItems,
      maxItems: form.maxItems,
      minUnits: form.minUnits,
      maxUnits: form.maxUnits,
      countries: form.countries,
      regions: form.regions,
      postalPrefixes: form.postalPrefixes,
      channels: form.channels,
    },
  };
}

function RuleSheet({ state, data, onClose }: { state: SheetState; data: ShipRulesPayload | undefined; onClose: () => void }) {
  const editing = state?.mode === "edit" ? state.rule : null;
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const write = useWrite();

  useEffect(() => {
    if (!state) return;
    setForm(editing ? formFromRule(editing) : EMPTY_FORM);
    write.setError(null);
  }, [state]);

  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const services = data?.services ?? [];
  const serviceKnown =
    !form.service.startsWith("svc:") || services.some((row) => form.service === `svc:${row.connectionId ?? ""}:${row.id}`);

  async function submit() {
    const saved = await write.run(
      editing ? "Save rule" : "Add rule",
      () =>
        api<ShipRulesPayload>(editing ? `/api/ship/rules/${editing.id}` : "/api/ship/rules", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(ruleBody(form)),
        }),
      () => `Rule ${form.name.trim()} ${editing ? "saved" : "added"}.`,
    );
    if (saved) onClose();
  }

  return (
    <FormSheet
      open={!!state}
      onOpenChange={(open) => (open ? null : onClose())}
      title={editing ? `Edit ${editing.name}` : "New shipping rule"}
      description="Every condition you fill in must match. Leave a field blank to skip it."
      submitLabel={editing ? "Save rule" : "Add rule"}
      onSubmit={submit}
      busy={write.busy}
      error={write.error}
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Small parcels" autoFocus />
        </Field>
        <Field label="Building">
          <Select value={form.warehouseId} onChange={(event) => set("warehouseId", event.target.value)}>
            <option value="">All buildings</option>
            {(data?.warehouses ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">When the order</h3>
        <Field label="Has any of these SKUs">
          <Input value={form.skus} onChange={(event) => set("skus", event.target.value)} placeholder="LAMP-01, SHADE-02" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <RangeField
            label="Weighs (oz)"
            min={form.minWeightOz}
            max={form.maxWeightOz}
            onMin={(value) => set("minWeightOz", value)}
            onMax={(value) => set("maxWeightOz", value)}
          />
          <RangeField
            label="Different SKUs"
            min={form.minItems}
            max={form.maxItems}
            onMin={(value) => set("minItems", value)}
            onMax={(value) => set("maxItems", value)}
          />
          <RangeField
            label="Units"
            min={form.minUnits}
            max={form.maxUnits}
            onMin={(value) => set("minUnits", value)}
            onMax={(value) => set("maxUnits", value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ships to country">
            <Input value={form.countries} onChange={(event) => set("countries", event.target.value)} placeholder="US, CA" />
          </Field>
          <Field label="State or province">
            <Input value={form.regions} onChange={(event) => set("regions", event.target.value)} placeholder="CA, OR, WA" />
          </Field>
          <Field label="Postal code starts">
            <Input value={form.postalPrefixes} onChange={(event) => set("postalPrefixes", event.target.value)} placeholder="97, 98" />
          </Field>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Came from</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {SHIP_RULE_CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.channels.includes(channel)}
                  onCheckedChange={(value) =>
                    set("channels", value === true ? [...form.channels, channel] : form.channels.filter((row) => row !== channel))
                  }
                />
                {SHIP_RULE_CHANNEL_LABELS[channel]}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">
          Weight is the weight typed on the order or read off the scale; otherwise the SKUs' ship weights added up. An
          order with a SKU missing its ship weight never matches a weight range.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Then</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Box">
            <Select value={form.presetId} onChange={(event) => set("presetId", event.target.value)}>
              <option value="">Pick for me</option>
              {(data?.presets ?? []).map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.lengthIn}×{preset.widthIn}×{preset.heightIn})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service">
            <Select value={form.service} onChange={(event) => set("service", event.target.value)}>
              <option value="">The building's choice</option>
              <option value="rate:default">{RATE_STRATEGY_LABELS.default}</option>
              <optgroup label="Always ship with">
                {services.map((row) => (
                  <option key={`${row.connectionId ?? "rl"}-${row.id}`} value={`svc:${row.connectionId ?? ""}:${row.id}`}>
                    {row.name}
                  </option>
                ))}
                {serviceKnown ? null : <option value={form.service}>{editing?.carrierService ?? "Service"} (not offered)</option>}
              </optgroup>
            </Select>
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Switch checked={form.hold} onCheckedChange={(value) => set("hold", value)} className="mt-0.5" />
          <span>
            <span className="font-medium">Hold for review</span>
            <span className="block text-xs text-muted-foreground">
              Matching orders stay out of one-click ship and wait under Needs attention until someone opens them and ships.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.enabled} onCheckedChange={(value) => set("enabled", value)} />
          Rule is on
        </label>
      </section>
    </FormSheet>
  );
}

function RangeField({
  label,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (value: string) => void;
  onMax: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium leading-none">{label}</legend>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          aria-label={`${label}, at least`}
          inputMode="numeric"
          placeholder="At least"
          value={min}
          onChange={(event) => onMin(event.target.value)}
        />
        <Input
          aria-label={`${label}, at most`}
          inputMode="numeric"
          placeholder="At most"
          value={max}
          onChange={(event) => onMax(event.target.value)}
        />
      </div>
    </fieldset>
  );
}
