import type { BulkGap, ReorderAlert, ReplenishMode } from "@/domain/automation";
import { REMIND_HOURS_MAX } from "@/domain/automation";
import type { CustomerMailPolicy } from "@/domain/customer-mail";
import type { RestockPolicy } from "@/domain/restock";
import { cn } from "@/lib/utils";
import type { AutomationDraft } from "./model";
import { nodeReads } from "./model";

const MAIL: { value: CustomerMailPolicy; label: string }[] = [
  { value: "store", label: "Only when the store doesn't notify" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
];

function Choice({
  on,
  title,
  detail,
  onClick,
}: {
  on: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3 py-2 text-left transition-colors",
        on ? "border-primary bg-accent" : "border-border bg-card hover:bg-muted",
      )}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

function MailSelect({
  value,
  onChange,
}: {
  value: CustomerMailPolicy;
  onChange: (value: CustomerMailPolicy) => void;
}) {
  return (
    <select
      className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value as CustomerMailPolicy)}
    >
      {MAIL.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Inspector({
  draft,
  selectedId,
  counts,
  onChange,
}: {
  draft: AutomationDraft;
  selectedId: string | null;
  counts: { suggestions: number; openReplenishments: number; exceptions: number; restock: number; reorder: number };
  onChange: (next: AutomationDraft) => void;
}) {
  function patchPolicy(patch: Partial<AutomationDraft["policy"]>) {
    onChange({ ...draft, policy: { ...draft.policy, ...patch } });
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-4">
      <section>
        <p className="text-sm font-semibold">Flow health</p>
        <p className="text-xs text-muted-foreground">This warehouse, from the live counts.</p>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="Suggestions" value={counts.suggestions} />
          <Metric label="Open replenishments" value={counts.openReplenishments} />
          <Metric label="Open exceptions" value={counts.exceptions} />
          <Metric label="Restock alerts" value={counts.restock} />
          <Metric label="Below reorder" value={counts.reorder} />
        </dl>
      </section>

      <section className="space-y-3">
        <p className="text-sm font-semibold">Selected step</p>
        <Editor draft={draft} selectedId={selectedId} onChange={onChange} patchPolicy={patchPolicy} />
      </section>

      <section>
        <p className="text-sm font-semibold">Reads</p>
        <p className="text-xs text-muted-foreground">Fields this step uses. They stay on the item, location, or organization.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {nodeReads(selectedId).map((field) => (
            <code key={field} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              {field}
            </code>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card px-2.5 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Editor({
  draft,
  selectedId,
  onChange,
  patchPolicy,
}: {
  draft: AutomationDraft;
  selectedId: string | null;
  onChange: (next: AutomationDraft) => void;
  patchPolicy: (patch: Partial<AutomationDraft["policy"]>) => void;
}) {
  if (!selectedId) {
    return <p className="text-sm text-muted-foreground">Select a step on the map to change it. Publish saves every flow together.</p>;
  }

  if (selectedId === "r-start" || selectedId === "a-start" || selectedId === "m-start") {
    return <p className="text-sm text-muted-foreground">This step is the trigger. Change the branches under it.</p>;
  }

  if (selectedId === "r-bulk") {
    return (
      <div className="grid gap-2">
        <Choice
          on={draft.policy.replenishMode === "suggest"}
          title="Suggest"
          detail="Show the move on the replenish page, Today, and the floor. Someone queues it."
          onClick={() => patchPolicy({ replenishMode: "suggest" satisfies ReplenishMode })}
        />
        <Choice
          on={draft.policy.replenishMode === "auto_queue"}
          title="Auto-queue"
          detail="Open a draft replenishment when bulk can cover the pick face. A second pass skips a face that already has one open."
          onClick={() => patchPolicy({ replenishMode: "auto_queue" satisfies ReplenishMode })}
        />
      </div>
    );
  }

  if (selectedId === "r-gap") {
    return (
      <div className="grid gap-2">
        <Choice
          on={draft.policy.bulkGap === "silent"}
          title="Silent"
          detail="Leave a starved pick face off Exceptions."
          onClick={() => patchPolicy({ bulkGap: "silent" satisfies BulkGap })}
        />
        <Choice
          on={draft.policy.bulkGap === "exception"}
          title="Exception"
          detail="List the pick face in Exceptions until bulk can cover it."
          onClick={() => patchPolicy({ bulkGap: "exception" satisfies BulkGap })}
        />
      </div>
    );
  }

  if (selectedId === "r-doc" || selectedId === "m-remind") {
    const hours = draft.policy.remindOpenAfterHours;
    return (
      <div className="space-y-3">
        <Choice
          on={hours == null}
          title="Off"
          detail="An open replenishment does not raise its own exception."
          onClick={() => patchPolicy({ remindOpenAfterHours: null })}
        />
        <Choice
          on={hours != null}
          title="Remind"
          detail="Raise an exception while a draft or in-progress replenishment stays open."
          onClick={() => patchPolicy({ remindOpenAfterHours: hours ?? 8 })}
        />
        {hours != null ? (
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Hours before the reminder</span>
            <input
              type="number"
              min={1}
              max={REMIND_HOURS_MAX}
              value={hours}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next) && next >= 1 && next <= REMIND_HOURS_MAX) patchPolicy({ remindOpenAfterHours: next });
              }}
              className="mt-1 h-9 w-full rounded-lg border bg-background px-3"
            />
          </label>
        ) : null}
      </div>
    );
  }

  if (selectedId === "a-runway") {
    const options: { value: RestockPolicy; title: string; detail: string }[] = [
      { value: "off", title: "Off", detail: "No exception. The restock board still shows the forecast." },
      { value: "alert", title: "Alert", detail: "A due restock shows in Exceptions." },
      { value: "draft", title: "Alert and draft a purchase", detail: "Also opens a draft purchase. Nothing is sent to the vendor." },
    ];
    return (
      <div className="grid gap-2">
        {options.map((option) => (
          <Choice
            key={option.value}
            on={draft.restockPolicy === option.value}
            title={option.title}
            detail={option.detail}
            onClick={() => onChange({ ...draft, restockPolicy: option.value })}
          />
        ))}
      </div>
    );
  }

  if (selectedId === "a-reorder") {
    return (
      <div className="grid gap-2">
        <Choice
          on={draft.policy.reorderAlert === "today"}
          title="Today"
          detail="SKUs at the reorder point stay on Today."
          onClick={() => patchPolicy({ reorderAlert: "today" satisfies ReorderAlert })}
        />
        <Choice
          on={draft.policy.reorderAlert === "exception"}
          title="Today and Exceptions"
          detail="The Today list stays. Owners also see them in Exceptions."
          onClick={() => patchPolicy({ reorderAlert: "exception" satisfies ReorderAlert })}
        />
      </div>
    );
  }

  const mailKey = MAIL_NODE[selectedId];
  if (mailKey) {
    return <MailSelect value={draft[mailKey]} onChange={(value) => onChange({ ...draft, [mailKey]: value })} />;
  }

  if (selectedId === "m-sender") {
    return (
      <div className="space-y-3">
        {!draft.mailConfigured ? (
          <p className="text-xs text-tone-warning">
            Mail is not configured, so these messages are logged instead of sent.
          </p>
        ) : null}
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Sender name</span>
          <input
            value={draft.senderName}
            onChange={(event) => onChange({ ...draft, senderName: event.target.value })}
            className="mt-1 h-9 w-full rounded-lg border bg-background px-3"
            placeholder="Northwind Makers"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Reply-to</span>
          <input
            value={draft.replyTo}
            onChange={(event) => onChange({ ...draft, replyTo: event.target.value })}
            className="mt-1 h-9 w-full rounded-lg border bg-background px-3"
            placeholder="hello@northwind.example"
          />
        </label>
      </div>
    );
  }

  return <p className="text-sm text-muted-foreground">This step has nothing to edit.</p>;
}

const MAIL_NODE: Record<string, "shipped" | "outForDelivery" | "delivered" | "deliveryException" | "returnLabel"> = {
  "m-shipped": "shipped",
  "m-ofd": "outForDelivery",
  "m-delivered": "delivered",
  "m-exception": "deliveryException",
  "m-return": "returnLabel",
};
