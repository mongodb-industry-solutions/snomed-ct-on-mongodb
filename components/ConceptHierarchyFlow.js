"use client";
import { useEffect, useMemo, useRef } from "react";
import { ReactFlow, Background, Controls, MarkerType, useNodesInitialized, useNodesState, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Fit after asynchronous data and node measurements, and after inspector resize.
function FitCompletedGraph({ revision, containerRef }) {
  const initialized = useNodesInitialized();
  const { fitView, viewportInitialized } = useReactFlow();
  useEffect(() => {
    if (!initialized || !viewportInitialized || !containerRef.current) return;
    let frame;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitView({ padding: 0.18, duration: 180, maxZoom: 1, minZoom: 0.05 }));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [initialized, viewportInitialized, revision, fitView, containerRef]);
  return null;
}

const fitViewOptions = { padding: 0.18, maxZoom: 1, minZoom: 0.05 };

function MeasuredHierarchyFlow({ layoutNodes, edges, revision, containerRef, onNavigate }) {
  // React Flow reports measured sizes through onNodesChange. Retain those
  // changes so useNodesInitialized becomes true and the completed graph fits.
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  useEffect(() => { setNodes(layoutNodes); }, [layoutNodes, setNodes]);

  return <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange}
    fitView fitViewOptions={fitViewOptions} minZoom={0.05} maxZoom={1.5} proOptions={{ hideAttribution: true }}
    nodesDraggable={false} nodesConnectable={false} onNodeClick={(_event, node) => {
      if (node.data.navigateTo) onNavigate?.(node.data.navigateTo);
    }}>
    <FitCompletedGraph revision={revision} containerRef={containerRef} />
    <Background gap={16} color="#eef1f3" /><Controls showInteractive={false} />
  </ReactFlow>;
}
function nodeLabel(term, tag, id, selected) {
  return <div style={{ textAlign: "left" }} title={term || id}>
    <div style={{ fontWeight: selected ? 800 : 600, fontSize: 12, lineHeight: 1.3 }}>{term || id}</div>
    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3 }}>{tag ? `${tag} · ` : ""}#{id}</div>
  </div>;
}
export default function ConceptHierarchyFlow({ concept, neighborhood = null, onNavigate }) {
  const containerRef = useRef(null);
  const { nodes, edges } = useMemo(() => {
    if (!concept?.conceptId || !(concept.preferredTerm || concept.term || concept.displayTerm || concept.fullySpecifiedName)) return { nodes: [], edges: [] };
    const centerId = String(concept.conceptId);
    const members = new Map([[centerId, { ...concept, term: concept.preferredTerm || concept.term || concept.displayTerm || concept.fullySpecifiedName, level: 0 }]]);
    for (const parent of concept.parents || []) members.set(String(parent.conceptId), { ...parent, level: -1 });
    for (const child of (concept.children || []).slice(0, 8)) members.set(String(child.conceptId), { ...child, level: 1 });
    for (const neighbor of neighborhood?.neighbors || []) {
      const id = String(neighbor.conceptId);
      if (id !== centerId) members.set(id, { ...neighbor, level: -(Number(neighbor.depth) + 1) });
    }
    const rows = new Map();
    for (const member of members.values()) {
      if (!rows.has(member.level)) rows.set(member.level, []);
      rows.get(member.level).push(member);
    }
    const nodes = [];
    for (const [level, row] of rows) {
      row.sort((a, b) => String(a.term || "").localeCompare(String(b.term || "")));
      row.forEach((member, index) => {
        const id = String(member.conceptId), selected = id === centerId;
        const color = selected ? "#00684A" : level < 0 ? "#016BF8" : "#5C6C75";
        nodes.push({ id, position: { x: (index - (row.length - 1) / 2) * 235, y: level * 165 },
          data: { label: nodeLabel(member.term, member.semanticTag, id, selected), navigateTo: selected ? null : id },
          style: { width: 210, minHeight: 65, padding: 10, border: `${selected ? 2 : 1}px solid ${color}`, borderRadius: 10,
            background: selected ? "#E3FCEC" : "#fff", ...(selected ? { boxShadow: "0 0 0 3px #00684A22" } : {}) },
          sourcePosition: "top", targetPosition: "bottom" });
      });
    }
    const edgeIds = new Set(), edges = [];
    const connect = (child, parent) => {
      child = String(child); parent = String(parent);
      const id = `${child}-${parent}`;
      if (!members.has(child) || !members.has(parent) || child === parent || edgeIds.has(id)) return;
      edgeIds.add(id);
      edges.push({ id, source: child, target: parent, label: "is a", style: { stroke: "#016BF8" },
        labelStyle: { fontSize: 10, fill: "#016BF8" }, markerEnd: { type: MarkerType.ArrowClosed, color: "#016BF8" } });
    };
    for (const parent of concept.parents || []) connect(centerId, parent.conceptId);
    for (const child of concept.children || []) connect(child.conceptId, centerId);
    for (const member of members.values()) for (const parent of member.inferredParentIds || []) connect(member.conceptId, parent);
    return { nodes, edges };
  }, [concept, neighborhood]);
  const revision = nodes.map((n) => `${n.id}:${n.position.x}:${n.position.y}`).join("|");
  if (!nodes.length) return null;
  return <div ref={containerRef} style={{ height: 460, borderRadius: 12, overflow: "hidden", border: "1px solid #e3e7ea" }}>
    <MeasuredHierarchyFlow key={concept.conceptId} layoutNodes={nodes} edges={edges}
      revision={revision} containerRef={containerRef} onNavigate={onNavigate} />
  </div>;
}
