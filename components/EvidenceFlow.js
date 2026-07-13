"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Visual evidence graph for a grounded clinical note. Renders the evidenceGraph
// the /api/nlp-map endpoint already returns (mentions, cue objects, relations)
// as an interactive node-link diagram: clinical-term nodes on a row, context
// cues attached above them, and relation edges between mentions. Clicking a
// mention selects its span in the reviewer, so the graph drives the same
// inspector as the lists below it.

const CUE_COLORS = {
  negation: "#DB3030",
  "family-history": "#8F4FBF",
  history: "#B8860B",
  plan: "#016BF8",
  certainty: "#00A35C",
  relation: "#5C6C75"
};

const ASSERTION_COLORS = {
  present: "#00684A",
  absent: "#DB3030",
  "family-history": "#8F4FBF",
  historical: "#B8860B",
  planned: "#016BF8",
  suspected: "#00A35C"
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function EvidenceFlow({ graph, reviewRows, selectedSpanId, onSelectSpan }) {
  const rowByMentionId = useMemo(
    () => new Map((Array.isArray(reviewRows) ? reviewRows : []).map((row) => [row.mentionId, row])),
    [reviewRows]
  );

  const { nodes, edges } = useMemo(() => {
    const mentions = Array.isArray(graph?.mentions)
      ? graph.mentions
          .slice()
          .sort((a, b) => toNumber(a?.anchorSpan?.start, 0) - toNumber(b?.anchorSpan?.start, 0))
      : [];
    const cueById = new Map((graph?.cueObjects || []).map((cue) => [cue.cueId, cue]));
    const relations = Array.isArray(graph?.relations) ? graph.relations : [];

    const nodes = [];
    const edges = [];
    const mentionX = new Map();

    mentions.forEach((mention, index) => {
      const x = 40 + index * 240;
      const y = 230;
      mentionX.set(mention.mentionId, x);
      const row = rowByMentionId.get(mention.mentionId) || null;
      const assertion = mention.derivedAssertion || "present";
      const color = ASSERTION_COLORS[assertion] || "#00684A";
      const grounded = row?.selectedCandidate?.term || mention?.groundedConcept?.term || null;
      const isSelected = row && row.id === selectedSpanId;

      nodes.push({
        id: mention.mentionId,
        position: { x, y },
        data: {
          rowId: row?.id || null,
          label: (
            <div style={{ textAlign: "left", maxWidth: 190 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{mention.text || "mention"}</div>
              {grounded ? (
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{grounded}</div>
              ) : null}
              <div style={{ fontSize: 10, marginTop: 4, color }}>{assertion}</div>
            </div>
          )
        },
        style: {
          border: `2px solid ${color}`,
          borderRadius: 10,
          padding: 8,
          background: "#ffffff",
          boxShadow: isSelected ? `0 0 0 3px ${color}44` : "0 1px 3px rgba(0,0,0,0.12)",
          width: 210
        },
        sourcePosition: "right",
        targetPosition: "left"
      });

      // Cues attached above their mention. Skip "relation" cues (linguistic
      // connectors like "with"/"con") — they aren't clinically meaningful as
      // standalone nodes; genuine relations are shown as edges between mentions.
      const appliedCues = (mention.appliedCueIds || [])
        .map((id) => cueById.get(id))
        .filter((cue) => cue && cue.cueType !== "relation");
      appliedCues.forEach((cue, cueIndex) => {
        const cueColor = CUE_COLORS[cue.cueType] || "#5C6C75";
        const cueNodeId = `${mention.mentionId}__${cue.cueId}`;
        nodes.push({
          id: cueNodeId,
          position: { x: x + 30, y: 60 + cueIndex * 68 },
          data: {
            label: (
              <div style={{ textAlign: "left", maxWidth: 150 }}>
                <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: cueColor }}>
                  {cue.cueType}
                </div>
                <div style={{ fontSize: 11 }}>{cue.text || cue.value}</div>
              </div>
            )
          },
          style: {
            border: `1px dashed ${cueColor}`,
            borderRadius: 8,
            padding: 6,
            background: `${cueColor}0F`,
            width: 160
          },
          sourcePosition: "bottom",
          targetPosition: "bottom"
        });
        edges.push({
          id: `e-${cueNodeId}`,
          source: cueNodeId,
          target: mention.mentionId,
          label: "modifies",
          style: { stroke: cueColor },
          labelStyle: { fontSize: 9, fill: cueColor },
          markerEnd: { type: MarkerType.ArrowClosed, color: cueColor }
        });
      });
    });

    relations.forEach((relation) => {
      if (!mentionX.has(relation.sourceMentionId) || !mentionX.has(relation.targetMentionId)) return;
      edges.push({
        id: relation.relationId,
        source: relation.sourceMentionId,
        target: relation.targetMentionId,
        label: relation.relationType || "related-to",
        animated: true,
        style: { stroke: "#016BF8" },
        labelStyle: { fontSize: 10, fill: "#016BF8", fontWeight: 700 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#016BF8" }
      });
    });

    return { nodes, edges };
  }, [graph, rowByMentionId, selectedSpanId]);

  if (!graph || nodes.length === 0) return null;

  return (
    <div style={{ height: 360, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border, #e3e7ea)" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => {
          if (node?.data?.rowId) onSelectSpan?.(node.data.rowId);
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={16} color="#eef1f3" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
