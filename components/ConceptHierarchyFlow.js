"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Concept neighborhood as an interactive is-a graph: immediate parents on top,
// the selected concept in the center, children below. Renders the parents/
// children the /api/hierarchy endpoint already returns, and clicking any
// neighbor navigates to it — so SNOMED reads as the directed graph it is,
// without a separate graph database.

const CENTER_COLOR = "#00684A";
const PARENT_COLOR = "#016BF8";
const CHILD_COLOR = "#5C6C75";

function clamp(text, max = 46) {
  const t = String(text || "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function label(term, semanticTag, conceptId, weight = 600) {
  return (
    <div style={{ textAlign: "left", maxWidth: 170 }} title={term || conceptId}>
      <div style={{ fontWeight: weight, fontSize: 12, lineHeight: 1.25 }}>{clamp(term || conceptId)}</div>
      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
        {semanticTag ? `${semanticTag} · ` : ""}#{conceptId}
      </div>
    </div>
  );
}

function rowLayout(items, y, canvasWidth) {
  const gap = 210;
  const totalWidth = Math.max((items.length - 1) * gap, 0);
  const startX = canvasWidth / 2 - totalWidth / 2;
  return items.map((item, i) => ({ item, x: startX + i * gap, y }));
}

export default function ConceptHierarchyFlow({ concept, onNavigate }) {
  const { nodes, edges } = useMemo(() => {
    if (!concept?.conceptId) return { nodes: [], edges: [] };

    const centerId = String(concept.conceptId);
    const centerTerm =
      concept.preferredTerm || concept.term || concept.displayTerm || concept.fullySpecifiedName || centerId;
    const tagMatch = /\(([^)]+)\)\s*$/.exec(concept.fullySpecifiedName || "");
    const centerTag = concept.semanticTag || (tagMatch ? tagMatch[1] : null);
    const parents = Array.isArray(concept.parents) ? concept.parents.slice(0, 6) : [];
    const children = Array.isArray(concept.children) ? concept.children.slice(0, 8) : [];

    const canvasWidth = Math.max(children.length, parents.length, 1) * 210 + 120;
    const nodes = [];
    const edges = [];

    nodes.push({
      id: centerId,
      position: { x: canvasWidth / 2 - 90, y: 200 },
      data: { label: label(centerTerm, centerTag, centerId, 800), navigable: false },
      style: {
        border: `2px solid ${CENTER_COLOR}`,
        borderRadius: 12,
        padding: 10,
        background: "#E3FCEC",
        width: 200,
        boxShadow: `0 0 0 3px ${CENTER_COLOR}22`
      },
      sourcePosition: "top",
      targetPosition: "bottom"
    });

    rowLayout(parents, 30, canvasWidth).forEach(({ item, x, y }) => {
      const id = String(item.conceptId);
      nodes.push({
        id: `p-${id}`,
        position: { x, y },
        data: { label: label(item.term, item.semanticTag, id), navigateTo: id },
        style: { border: `1px solid ${PARENT_COLOR}`, borderRadius: 10, padding: 8, background: "#fff", width: 190 },
        sourcePosition: "bottom",
        targetPosition: "bottom"
      });
      // center is-a parent
      edges.push({
        id: `e-c-${id}`,
        source: centerId,
        target: `p-${id}`,
        label: "is a",
        style: { stroke: PARENT_COLOR },
        labelStyle: { fontSize: 9, fill: PARENT_COLOR },
        markerEnd: { type: MarkerType.ArrowClosed, color: PARENT_COLOR }
      });
    });

    rowLayout(children, 370, canvasWidth).forEach(({ item, x, y }) => {
      const id = String(item.conceptId);
      nodes.push({
        id: `c-${id}`,
        position: { x, y },
        data: { label: label(item.term, item.semanticTag, id), navigateTo: id },
        style: { border: `1px solid ${CHILD_COLOR}`, borderRadius: 10, padding: 8, background: "#fff", width: 190 },
        sourcePosition: "top",
        targetPosition: "top"
      });
      // child is-a center
      edges.push({
        id: `e-${id}-c`,
        source: `c-${id}`,
        target: centerId,
        label: "is a",
        style: { stroke: CHILD_COLOR },
        labelStyle: { fontSize: 9, fill: CHILD_COLOR },
        markerEnd: { type: MarkerType.ArrowClosed, color: CHILD_COLOR }
      });
    });

    return { nodes, edges };
  }, [concept]);

  if (nodes.length === 0) return null;

  return (
    <div style={{ height: 460, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border, #e3e7ea)" }}>
      <ReactFlow
        key={concept?.conceptId || "graph"}
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onInit={(instance) => {
          // The flex container often has no width on first paint, so the initial
          // fitView is a no-op. Refit on the next frames once it has real size.
          requestAnimationFrame(() => instance.fitView({ padding: 0.2 }));
          setTimeout(() => instance.fitView({ padding: 0.2 }), 120);
        }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_event, node) => {
          if (node?.data?.navigateTo) onNavigate?.(node.data.navigateTo);
        }}
      >
        <Background gap={16} color="#eef1f3" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
