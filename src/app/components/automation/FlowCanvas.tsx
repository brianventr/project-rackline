import { useMemo } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FlowNode } from "./FlowNode";
import { flowGraph, type AutomationDraft, type FlowNodeData, type FlowStepId } from "./model";

const nodeTypes = { flow: FlowNode };

export function FlowCanvas({
  step,
  saved,
  draft,
  selectedId,
  onSelect,
}: {
  step: FlowStepId;
  saved: AutomationDraft;
  draft: AutomationDraft;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const graph = useMemo(() => flowGraph(step, saved, draft), [step, saved, draft]);
  const nodes = graph.nodes.map((node) => ({ ...node, selected: node.id === selectedId }));

  return (
    <div className="automation-flow h-full min-h-[420px] w-full">
      <ReactFlow
        key={step}
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        panOnScroll
        onNodeClick={(_event, node: Node<FlowNodeData>) => onSelect(node.id)}
        onPaneClick={() => onSelect("")}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.15} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-center" />
      </ReactFlow>
    </div>
  );
}
