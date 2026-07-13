import { useState } from "react";
import styles from "./ConceptBrowser.module.css";

const FULLY_DEFINED_ID = "900000000000073002";
const MAX_VISIBLE_CHILDREN = 30;
export const PRIMARY_PATH_POLICY_LABEL = "Lowest branching first";
export const PRIMARY_PATH_POLICY_HINT = "Prefer ancestors with fewer alternative parents, then preferred term, then SCTID.";

function normalizeConceptId(value) {
  return String(value || "").trim();
}

function summarizeNeighbor(node) {
  const conceptId = normalizeConceptId(node?.conceptId);
  return {
    conceptId,
    term: node?.term || conceptId,
    parentCount: Array.isArray(node?.inferredParentIds) ? node.inferredParentIds.length : 0,
    inferredParentIds: Array.isArray(node?.inferredParentIds) ? node.inferredParentIds.map(normalizeConceptId) : [],
    definitionStatusId: node?.definitionStatusId || null,
    depth: Number(node?.depth) || 0
  };
}

function sortByLabelThenId(a, b) {
  const aLabel = String(a?.term || a?.conceptId || "").toLowerCase();
  const bLabel = String(b?.term || b?.conceptId || "").toLowerCase();
  const labelCmp = aLabel.localeCompare(bLabel);
  if (labelCmp !== 0) return labelCmp;
  return String(a?.conceptId || "").localeCompare(String(b?.conceptId || ""));
}

function sortByPrimaryPathPriority(a, b) {
  const aParents = Number(a?.parentCount) || 0;
  const bParents = Number(b?.parentCount) || 0;
  const parentCmp = aParents - bParents;
  if (parentCmp !== 0) return parentCmp;
  return sortByLabelThenId(a, b);
}

/**
 * Build a single, deterministic ancestor chain from graph neighbors.
 * Returns ordered array: [root, ..., directParent]
 */
export function buildAncestorChain(neighbors, focusId) {
  if (!Array.isArray(neighbors) || neighbors.length === 0) return [];

  const byId = new Map();
  for (const n of neighbors) {
    byId.set(normalizeConceptId(n.conceptId), summarizeNeighbor(n));
  }

  const depth0 = neighbors
    .filter((n) => Number(n?.depth) === 0)
    .map((n) => summarizeNeighbor(n))
    .sort(sortByPrimaryPathPriority);

  if (depth0.length === 0) return [];

  const chain = [];
  const visited = new Set();
  let current = depth0[0];

  while (current) {
    const id = normalizeConceptId(current.conceptId);
    if (!id || visited.has(id)) break;
    visited.add(id);

    chain.unshift({
      conceptId: id,
      term: current.term || id,
      parentCount: current.parentCount,
      definitionStatusId: current.definitionStatusId || null
    });

    const parentIds = Array.isArray(current?.inferredParentIds) ? current.inferredParentIds : [];

    const candidates = parentIds
      .filter((parentId) => byId.has(parentId) && !visited.has(parentId))
      .map((parentId) => byId.get(parentId))
      .sort(sortByPrimaryPathPriority);

    current = candidates[0] || null;
  }

  return chain;
}

/**
 * Group all ancestor neighbors by depth to support polyhierarchy exploration.
 */
export function buildAncestorLevels(neighbors) {
  if (!Array.isArray(neighbors) || neighbors.length === 0) return [];

  const byDepth = new Map();
  for (const node of neighbors) {
    const summary = summarizeNeighbor(node);
    if (!summary.conceptId) continue;

    if (!byDepth.has(summary.depth)) {
      byDepth.set(summary.depth, new Map());
    }
    byDepth.get(summary.depth).set(summary.conceptId, summary);
  }

  return Array.from(byDepth.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([depth, map]) => ({
      depth,
      items: Array.from(map.values()).sort(sortByPrimaryPathPriority)
    }));
}

function DefBadge({ definitionStatusId }) {
  const isFd = definitionStatusId === FULLY_DEFINED_ID;
  return (
    <span className={`${styles.defBadge} ${isFd ? styles.defBadgeFd : styles.defBadgePrim}`}>
      {isFd ? "Fully Defined" : "Primitive"}
    </span>
  );
}

function AncestorCard({ item, onClick }) {
  return (
    <button className={styles.nodeCard} onClick={() => onClick(item.conceptId)}>
      <p className={styles.cardTerm}>{item.term}</p>
      <p className={styles.cardMeta}>#{item.conceptId}</p>
      {item.parentCount > 1 && <span className={styles.parentsBadge}>+{item.parentCount - 1} parents</span>}
    </button>
  );
}

function ChildCard({ item, onClick }) {
  return (
    <button className={styles.nodeCard} onClick={() => onClick(item.conceptId)}>
      <p className={styles.cardTerm}>{item.term}</p>
      <p className={styles.cardMeta}>#{item.conceptId}</p>
    </button>
  );
}

export default function ConceptBrowser({
  concept,
  ancestorChain,
  ancestorNeighbors,
  children: childConcepts,
  onNavigate,
  loading
}) {
  const [showAllParents, setShowAllParents] = useState(false);

  if (loading) {
    return <div className={styles.loadingShell}>Loading hierarchy...</div>;
  }

  if (!concept) {
    return <div className={styles.loadingShell}>Select a concept to browse</div>;
  }

  const ancestors = Array.isArray(ancestorChain) ? ancestorChain : [];
  const ancestorLevels = buildAncestorLevels(ancestorNeighbors || []);
  const hasPolyhierarchy = Number(concept?.parentCount || 0) > 1;
  const canToggleParents = hasPolyhierarchy || ancestorLevels.some((level) => level.items.length > 1);

  const kids = Array.isArray(childConcepts) ? childConcepts : [];
  const visibleKids = kids.slice(0, MAX_VISIBLE_CHILDREN);
  const hiddenCount = kids.length - visibleKids.length;

  const focusTerm = concept.preferredTerm || concept.term || String(concept.conceptId);
  const pathPolicyTitle = showAllParents ? "All parent branches" : PRIMARY_PATH_POLICY_LABEL;
  const pathPolicyHint = showAllParents
    ? "Every loaded parent branch is visible. Switch back to Stable path to return to the deterministic default branch."
    : PRIMARY_PATH_POLICY_HINT;

  return (
    <div className={styles.browserShell}>
      <div className={styles.colAncestors}>
        <div className={styles.colLabelRow}>
          <div className={styles.colLabel}>{showAllParents ? "All Parent Branches" : "Stable Ancestor Path"}</div>
          {canToggleParents && (
            <div className={styles.parentsModeToggle}>
              <button
                type="button"
                className={`${styles.parentsModeButton} ${!showAllParents ? styles.parentsModeButtonActive : ""}`}
                onClick={() => setShowAllParents(false)}
              >
                Stable path
              </button>
              <button
                type="button"
                className={`${styles.parentsModeButton} ${showAllParents ? styles.parentsModeButtonActive : ""}`}
                onClick={() => setShowAllParents(true)}
              >
                All parents
              </button>
            </div>
          )}
        </div>

        <div className={styles.pathPolicyCard}>
          <span className={styles.pathPolicyLabel}>Path policy</span>
          <strong>{pathPolicyTitle}</strong>
          <p>{pathPolicyHint}</p>
        </div>

        {!showAllParents && ancestors.length === 0 && <div className={styles.emptyCol}>Root concept</div>}
        {!showAllParents &&
          ancestors.map((item, idx) => (
            <div className={styles.connectorWrap} key={item.conceptId}>
              <AncestorCard item={item} onClick={onNavigate} />
              {idx < ancestors.length - 1 && <div className={styles.connectorArrow}>&#8595;</div>}
            </div>
          ))}

        {showAllParents && ancestorLevels.length === 0 && <div className={styles.emptyCol}>No ancestor branches loaded</div>}
        {showAllParents &&
          ancestorLevels.map((level) => (
            <div className={styles.ancestorLevel} key={`depth-${level.depth}`}>
              <div className={styles.ancestorLevelHead}>
                {level.depth === 0 ? "Direct parents" : `Depth ${level.depth}`}
              </div>
              <div className={styles.ancestorLevelRow}>
                {level.items.map((item) => (
                  <AncestorCard key={`${level.depth}-${item.conceptId}`} item={item} onClick={onNavigate} />
                ))}
              </div>
            </div>
          ))}
      </div>

      <div className={styles.colFocus}>
        <div className={styles.focusCard}>
          <p className={styles.focusTerm}>{focusTerm}</p>
          <p className={styles.focusCode}>SCTID {concept.conceptId}</p>
          <div className={styles.focusBadges}>
            <DefBadge definitionStatusId={concept.definitionStatusId} />
            {concept.parentCount > 0 && <span className={styles.parentsBadge}>{concept.parentCount} parents</span>}
          </div>
        </div>
      </div>

      <div className={styles.colChildren}>
        <div className={styles.colLabel}>Children ({kids.length})</div>
        {kids.length === 0 && <div className={styles.emptyCol}>Leaf concept</div>}
        {visibleKids.map((item) => (
          <div className={styles.connectorWrap} key={item.conceptId}>
            <ChildCard item={item} onClick={onNavigate} />
          </div>
        ))}
        {hiddenCount > 0 && <div className={styles.moreBadge}>+{hiddenCount} more children</div>}
      </div>
    </div>
  );
}
