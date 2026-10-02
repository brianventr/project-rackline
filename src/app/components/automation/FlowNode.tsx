import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, ArrowDownToLine, Clock, Mail, Play } from "lucide-react";
import type { FlowNodeData } from "./model";

const ICONS = {
  start: Play,
  move: ArrowDownToLine,
  alert: AlertTriangle,
  mail: Mail,
  clock: Clock,
} as const;

export function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData, "flow">>) {
  const Icon = ICONS[data.kind];
  return (
    <div
      className={`w-60 rounded-2xl border bg-card px-3 py-2.5 text-left shadow-sm ${selected ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
    >
      <Handle type="target" position={Position.Top} className="!size-2 !border-0 !bg-border" />
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-foreground">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold leading-tight">{data.title}</p>
            {data.draft ? (
              <span className="shrink-0 rounded-full bg-tone-success-bg px-1.5 py-0.5 text-[10px] font-medium text-tone-success">
                Draft
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{data.detail}</p>
        </div>
      </div>
      {data.chips.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.chips.map((chip) => (
            <span key={chip} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!size-2 !border-0 !bg-border" />
    </div>
  );
}
