import { getSemanticsConfig, getMongoConfig } from "@/lib/config";
import { expandEclExpression, parseEclExpression } from "@/lib/ecl";
import { getCollection } from "@/lib/mongo";

const CACHE_GLOBAL_KEY = "__SNOMED_SEMANTIC_SCOPE_CACHE_V1__";

function normalizeId(value) {
  return String(value || "").trim();
}

function toSet(values) {
  if (values instanceof Set) return values;
  if (!Array.isArray(values)) return new Set();
  const result = new Set();
  for (const value of values) {
    result.add(String(value));
  }
  return result;
}

function toArray(values) {
  if (Array.isArray(values)) return values.map((value) => String(value));
  if (values instanceof Set) return Array.from(values).map((value) => String(value));
  return [];
}

function getCacheState() {
  const root = globalThis;
  if (!root[CACHE_GLOBAL_KEY]) {
    root[CACHE_GLOBAL_KEY] = {
      entries: new Map(),
      hits: 0,
      misses: 0
    };
  }
  return root[CACHE_GLOBAL_KEY];
}

function pruneExpired(cache, now) {
  for (const [key, value] of cache.entries()) {
    if (!value || value.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function ensureCapacity(cache, maxEntries) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

async function getOrComputeCachedClause({
  clauseKey,
  ttlMs,
  maxEntries,
  forceRefresh,
  compute
}) {
  const now = Date.now();
  const state = getCacheState();
  const cache = state.entries;

  pruneExpired(cache, now);

  if (!forceRefresh) {
    const cached = cache.get(clauseKey);
    if (cached && cached.expiresAt > now) {
      cache.delete(clauseKey);
      cache.set(clauseKey, cached);
      state.hits += 1;
      return {
        cacheHit: true,
        latencyMs: 0,
        payload: cached.payload
      };
    }
  }

  state.misses += 1;
  const startedAt = Date.now();
  const payload = await compute();
  const latencyMs = Date.now() - startedAt;

  cache.set(clauseKey, {
    expiresAt: now + ttlMs,
    payload
  });
  ensureCapacity(cache, maxEntries);

  return {
    cacheHit: false,
    latencyMs,
    payload
  };
}

function intersectConcepts(leftValues, rightValues, maxResults) {
  const left = toSet(leftValues);
  const right = toSet(rightValues);
  const intersection = [];

  for (const value of left) {
    if (right.has(value)) {
      intersection.push(value);
      if (intersection.length > maxResults) {
        throw new Error(`Semantic scope result exceeds max size (${maxResults})`);
      }
    }
  }

  return intersection;
}

function applyScopeLimit(conceptIds, maxApplied) {
  const normalized = toArray(conceptIds);
  if (normalized.length <= maxApplied) {
    return {
      conceptIds: normalized,
      truncated: false
    };
  }

  return {
    conceptIds: normalized.slice(0, maxApplied),
    truncated: true
  };
}

function ancestorLookupValues(ancestorId) {
  const normalized = normalizeId(ancestorId);
  const values = [normalized];
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && String(numeric) === normalized) {
    values.push(numeric);
  }
  return values;
}

function relationshipKey(attributeTypeId, destinationId) {
  return `${normalizeId(attributeTypeId)}|${normalizeId(destinationId)}`;
}

async function expandDescendantsFromSource({
  sourceCollection,
  releaseId,
  ancestorId,
  includeSelf = true,
  maxResults = 200000
}) {
  const normalizedAncestorId = normalizeId(ancestorId);
  const cursor = sourceCollection.find(
    {
      releaseId,
      active: { $in: [true, 1, "1", "true", "TRUE", "True"] },
      inferredAncestorIds: { $in: ancestorLookupValues(normalizedAncestorId) }
    },
    {
      projection: {
        _id: 0,
        conceptId: 1
      }
    }
  );

  const result = new Set();
  for await (const doc of cursor) {
    const conceptId = normalizeId(doc?.conceptId);
    if (!conceptId) continue;
    result.add(conceptId);
    if (result.size > maxResults) {
      throw new Error(`ECL result exceeds max size (${maxResults})`);
    }
  }

  if (includeSelf) {
    result.add(normalizedAncestorId);
  } else {
    result.delete(normalizedAncestorId);
  }

  return result;
}

async function expandRelationshipAttributeFromSource({
  sourceCollection,
  releaseId,
  attributeTypeId,
  destinationIds,
  focusFilter = {},
  maxResults = 200000
}) {
  const normalizedTypeId = normalizeId(attributeTypeId);
  const normalizedDestinationIds = toArray(destinationIds).map(normalizeId).filter(Boolean);
  if (!normalizedTypeId || normalizedDestinationIds.length === 0) {
    return new Set();
  }

  const keys = normalizedDestinationIds.map((destinationId) => relationshipKey(normalizedTypeId, destinationId));
  const hasRelationshipKeys = await sourceCollection.findOne(
    {
      releaseId,
      relationshipAttributeKeys: { $exists: true }
    },
    { projection: { _id: 1 } }
  );
  const attributeFilter = hasRelationshipKeys
    ? { relationshipAttributeKeys: { $in: keys } }
    : {
        relationships: {
          $elemMatch: {
            active: { $in: [true, 1, "1", "true", "TRUE", "True"] },
            typeId: normalizedTypeId,
            destinationId: { $in: normalizedDestinationIds }
          }
        }
      };
  const cursor = sourceCollection.find(
    {
      releaseId,
      active: { $in: [true, 1, "1", "true", "TRUE", "True"] },
      ...focusFilter,
      ...attributeFilter
    },
    {
      projection: {
        _id: 0,
        conceptId: 1
      }
    }
  );

  const result = new Set();
  for await (const doc of cursor) {
    const conceptId = normalizeId(doc?.conceptId);
    if (!conceptId) continue;
    result.add(conceptId);
    if (result.size > maxResults) {
      throw new Error(`ECL attribute refinement result exceeds max size (${maxResults})`);
    }
  }

  return result;
}

function focusFilterFromNode(node) {
  if (!node) return null;

  if (node.type === "id") {
    const conceptId = normalizeId(node.conceptId);
    return conceptId ? { conceptId } : null;
  }

  if (node.type === "desc") {
    const conceptId = normalizeId(node.conceptId);
    if (!conceptId) return null;

    const ancestorFilter = {
      inferredAncestorIds: { $in: ancestorLookupValues(conceptId) }
    };

    if (node.includeSelf) {
      return {
        $or: [
          ancestorFilter,
          { conceptId }
        ]
      };
    }

    return ancestorFilter;
  }

  return null;
}

async function expandValueNodeFromSource({ sourceCollection, releaseId, node, maxResults }) {
  if (!node) return null;

  if (node.type === "id") {
    return new Set([normalizeId(node.conceptId)].filter(Boolean));
  }

  if (node.type === "desc") {
    return expandDescendantsFromSource({
      sourceCollection,
      releaseId,
      ancestorId: node.conceptId,
      includeSelf: node.includeSelf !== false,
      maxResults
    });
  }

  return null;
}

function unionConceptSets(left, right, maxResults) {
  const result = new Set(left);
  for (const value of right) {
    result.add(value);
    if (result.size > maxResults) {
      throw new Error(`ECL result exceeds max size (${maxResults})`);
    }
  }
  return result;
}

function intersectConceptSets(left, right) {
  const rightSet = right instanceof Set ? right : new Set(right);
  const result = new Set();
  for (const value of left) {
    if (rightSet.has(value)) {
      result.add(value);
    }
  }
  return result;
}

async function expandRefinementWithFocusFromSource({
  sourceCollection,
  releaseId,
  focusFilter,
  refinement,
  maxResults
}) {
  if (!refinement) return null;

  if (refinement.type === "attrEq") {
    const destinationIds = await expandValueNodeFromSource({
      sourceCollection,
      releaseId,
      node: refinement.value,
      maxResults
    });

    if (!destinationIds) return null;

    return expandRelationshipAttributeFromSource({
      sourceCollection,
      releaseId,
      attributeTypeId: refinement.attributeTypeId,
      destinationIds,
      focusFilter,
      maxResults
    });
  }

  if (refinement.type === "refOr" || refinement.type === "refAnd") {
    const left = await expandRefinementWithFocusFromSource({
      sourceCollection,
      releaseId,
      focusFilter,
      refinement: refinement.left,
      maxResults
    });
    const right = await expandRefinementWithFocusFromSource({
      sourceCollection,
      releaseId,
      focusFilter,
      refinement: refinement.right,
      maxResults
    });

    if (!left || !right) return null;
    return refinement.type === "refOr"
      ? unionConceptSets(left, right, maxResults)
      : intersectConceptSets(left, right);
  }

  return null;
}

async function expandOptimizedRefinedEclFromSource({
  sourceCollection,
  releaseId,
  expr,
  maxResults
}) {
  const ast = parseEclExpression(expr);
  if (ast.type !== "refined") {
    return null;
  }

  const focusFilter = focusFilterFromNode(ast.focus);
  if (!focusFilter) {
    return null;
  }

  const conceptIds = await expandRefinementWithFocusFromSource({
    sourceCollection,
    releaseId,
    focusFilter,
    refinement: ast.refinement,
    maxResults
  });

  if (!conceptIds) {
    return null;
  }

  return {
    ast,
    conceptIds: Array.from(conceptIds),
    count: conceptIds.size,
    optimized: true
  };
}

export function getSemanticScopeCacheStats() {
  const state = getCacheState();
  const now = Date.now();
  pruneExpired(state.entries, now);

  return {
    size: state.entries.size,
    hits: state.hits,
    misses: state.misses
  };
}

export async function resolveSemanticScope({
  ecl,
  areaConceptId,
  releaseIdInput,
  forceRefresh = false
}) {
  const normalizedEcl = String(ecl || "").trim();
  const normalizedArea = normalizeId(areaConceptId);

  if (!normalizedEcl && !normalizedArea) {
    return {
      conceptIdScope: [],
      scope: null
    };
  }

  const {
    releaseId,
    eclMaxResults,
    smartSearchScopeMaxIds,
    semanticsScopeCacheTtlSeconds,
    semanticsScopeCacheMaxEntries
  } = getSemanticsConfig();
  const { sourceCollection } = getMongoConfig();

  const effectiveReleaseId = normalizeId(releaseIdInput) || releaseId;
  const ttlMs = semanticsScopeCacheTtlSeconds * 1000;

  const source = await getCollection(sourceCollection);

  let eclClause = null;
  let areaClause = null;

  if (normalizedEcl) {
    const clauseKey = `ecl|${effectiveReleaseId}|${normalizedEcl}|${eclMaxResults}`;
    eclClause = await getOrComputeCachedClause({
      clauseKey,
      ttlMs,
      maxEntries: semanticsScopeCacheMaxEntries,
      forceRefresh,
      compute: async () => {
        const optimizedExpansion = await expandOptimizedRefinedEclFromSource({
          sourceCollection: source,
          releaseId: effectiveReleaseId,
          expr: normalizedEcl,
          maxResults: eclMaxResults
        });

        let expansion = optimizedExpansion;
        if (!expansion) {
          expansion = await expandEclExpression({
            expr: normalizedEcl,
            maxResults: eclMaxResults,
            expandDescendants: async (ancestorId, options = {}) =>
              expandDescendantsFromSource({
                sourceCollection: source,
                releaseId: effectiveReleaseId,
                ancestorId,
                includeSelf: options.includeSelf !== false,
                maxResults: eclMaxResults
              }),
            expandRelationshipAttribute: async (attributeTypeId, destinationIds) =>
              expandRelationshipAttributeFromSource({
                sourceCollection: source,
                releaseId: effectiveReleaseId,
                attributeTypeId,
                destinationIds,
                maxResults: eclMaxResults
              })
          });
        }

        return {
          type: "ecl",
          expr: normalizedEcl,
          ast: expansion.ast,
          conceptIds: expansion.conceptIds,
          count: expansion.count,
          optimized: Boolean(expansion.optimized)
        };
      }
    });
  }

  if (normalizedArea) {
    const clauseKey = `area|${effectiveReleaseId}|${normalizedArea}|${eclMaxResults}`;
    areaClause = await getOrComputeCachedClause({
      clauseKey,
      ttlMs,
      maxEntries: semanticsScopeCacheMaxEntries,
      forceRefresh,
      compute: async () => {
        const descendants = await expandDescendantsFromSource({
          sourceCollection: source,
          releaseId: effectiveReleaseId,
          ancestorId: normalizedArea,
          includeSelf: true,
          maxResults: eclMaxResults
        });
        const conceptIds = toArray(descendants);

        return {
          type: "area",
          areaConceptId: normalizedArea,
          conceptIds,
          count: conceptIds.length
        };
      }
    });
  }

  let combined = [];
  let rawCombinedCount = 0;
  let mode = "none";

  if (eclClause && areaClause) {
    mode = "ecl+area";
    combined = intersectConcepts(eclClause.payload.conceptIds, areaClause.payload.conceptIds, eclMaxResults);
    rawCombinedCount = combined.length;
  } else if (eclClause) {
    mode = "ecl";
    combined = toArray(eclClause.payload.conceptIds);
    rawCombinedCount = eclClause.payload.count;
  } else if (areaClause) {
    mode = "area";
    combined = toArray(areaClause.payload.conceptIds);
    rawCombinedCount = areaClause.payload.count;
  }

  const scoped = applyScopeLimit(combined, smartSearchScopeMaxIds);

  return {
    conceptIdScope: scoped.conceptIds,
    scope: {
      mode,
      releaseId: effectiveReleaseId,
      ecl: normalizedEcl || null,
      areaConceptId: normalizedArea || null,
      expandedCount: rawCombinedCount,
      appliedScopeCount: scoped.conceptIds.length,
      truncated: scoped.truncated,
      ast: eclClause?.payload?.ast || null,
      optimized: eclClause?.payload?.optimized || false,
      cache: {
        eclClauseHit: eclClause?.cacheHit || false,
        areaClauseHit: areaClause?.cacheHit || false,
        warm:
          (eclClause ? eclClause.cacheHit : true) &&
          (areaClause ? areaClause.cacheHit : true)
      },
      timings: {
        eclClauseMs: eclClause?.latencyMs || 0,
        areaClauseMs: areaClause?.latencyMs || 0,
        expansionMs: (eclClause?.latencyMs || 0) + (areaClause?.latencyMs || 0)
      }
    }
  };
}
