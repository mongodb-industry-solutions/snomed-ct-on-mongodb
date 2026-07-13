import { getCollection } from "@/lib/mongo";
import { getHierarchyCacheConfig, getMongoConfig, getSemanticsConfig } from "@/lib/config";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { emitUsageEventSafe } from "@/lib/usage-events";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";

export const runtime = "nodejs";

const CACHE_GLOBAL_KEY = "__SNOMED_HIERARCHY_CACHE_V3__";
const DESC_TYPE_FSN = "900000000000003001";
const DESC_TYPE_SYNONYM = "900000000000013009";
const ACCEPTABILITY_PREFERRED = "900000000000548007";
const RELEASE_CONCEPT_INDEX = "release_concept";
const IS_A_TYPE_ID = "116680003";
const OTHER_RELATIONSHIP_PATTERN = /(module|status|map|historical|replaced|same as|alternative|equivalent|association|refset)/i;

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

function normalizeBool(value) {
  return value === true || value === "true";
}

function normalizeActive(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "TRUE" || value === "True";
}

function isMissingHintIndexError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  const code = typeof error?.code === "number" ? error.code : null;
  const codeName = typeof error?.codeName === "string" ? error.codeName : "";

  return (
    lowered.includes("hint provided does not correspond to an existing index") ||
    (lowered.includes("hint") && lowered.includes("index") && (lowered.includes("exist") || lowered.includes("correspond"))) ||
    (lowered.includes("index not found") && lowered.includes(RELEASE_CONCEPT_INDEX)) ||
    (codeName === "BadValue" && lowered.includes("hint")) ||
    (code === 2 && lowered.includes("hint"))
  );
}

function asRequiredIndexError(error, indexName) {
  if (!isMissingHintIndexError(error)) {
    return error;
  }

  const wrapped = new Error(`Required source index '${indexName}' is missing`);
  wrapped.code = "required-index-missing";
  wrapped.statusCode = 503;
  wrapped.indexName = indexName;
  return wrapped;
}

function normalizeIdList(values, max = Infinity) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const set = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    set.add(normalized);
    if (set.size >= max) break;
  }
  return Array.from(set);
}

function parseSemanticTag(term) {
  const normalized = String(term || "");
  const match = normalized.match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : null;
}

function descriptionScore(desc, languageCode) {
  if (!desc || !normalizeActive(desc.active)) return -1;

  const language = String(desc.languageCode || "").toLowerCase();
  const target = String(languageCode || "es").toLowerCase();
  const typeId = String(desc.typeId || "");
  const values = Object.values(desc.acceptabilityMap || {});
  const preferred = values.includes(ACCEPTABILITY_PREFERRED);

  let score = 0;
  if (language === target) score += 40;
  if (preferred) score += 20;
  if (typeId === DESC_TYPE_SYNONYM) score += 12;
  if (typeId === DESC_TYPE_FSN) score += 8;
  if (String(desc.term || "").length <= 28) score += 2;
  return score;
}

function pickPreferredTermFromDescriptions(descriptions, languageCode = "es") {
  const list = Array.isArray(descriptions) ? descriptions : [];
  let best = null;
  let bestScore = -1;

  for (const desc of list) {
    const score = descriptionScore(desc, languageCode);
    if (score > bestScore) {
      best = desc;
      bestScore = score;
    }
  }

  const fallback = list.find((entry) => normalizeActive(entry?.active) && entry?.term) || list.find((entry) => entry?.term);
  const term = String(best?.term || fallback?.term || "").trim();

  return {
    term,
    semanticTag: parseSemanticTag(term)
  };
}

function pruneCache(cacheMap, now) {
  for (const [key, value] of cacheMap.entries()) {
    if (value.expiresAt <= now) {
      cacheMap.delete(key);
    }
  }
}

function ensureCapacity(cacheMap, maxEntries) {
  while (cacheMap.size > maxEntries) {
    const oldestKey = cacheMap.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cacheMap.delete(oldestKey);
  }
}

function indexByConceptId(docs) {
  const map = new Map();
  for (const doc of docs) {
    const id = String(doc?.conceptId || "").trim();
    if (!id) continue;
    map.set(id, doc);
  }
  return map;
}

function sortByPrimaryPathPriority(left, right) {
  const leftParentCount = Array.isArray(left?.inferredParentIds) ? left.inferredParentIds.length : 0;
  const rightParentCount = Array.isArray(right?.inferredParentIds) ? right.inferredParentIds.length : 0;
  if (leftParentCount !== rightParentCount) {
    return leftParentCount - rightParentCount;
  }

  const leftTerm = String(left?.term || left?.conceptId || "").toLowerCase();
  const rightTerm = String(right?.term || right?.conceptId || "").toLowerCase();
  const termDiff = leftTerm.localeCompare(rightTerm);
  if (termDiff !== 0) return termDiff;

  return String(left?.conceptId || "").localeCompare(String(right?.conceptId || ""));
}

function buildTermDocId(releaseId, conceptId, languageCode) {
  return `${releaseId}|${conceptId}|${languageCode}`;
}

function termProjectionScore(doc) {
  let score = 0;
  if (doc?.preferred === true || doc?.isPreferred === true) score += 40;
  if (String(doc?.termType || "") === "synonym" || String(doc?.typeId || "") === DESC_TYPE_SYNONYM) score += 20;
  if (String(doc?.termType || "") === "fsn" || String(doc?.typeId || "") === DESC_TYPE_FSN) score += 8;
  const term = String(doc?.preferredTerm || doc?.displayTerm || doc?.term || "").trim();
  if (term.length > 0 && term.length <= 28) score += 2;
  return score;
}

async function fetchTermMap({ projectionCollection, conceptIds, releaseId, languageCode }) {
  const ids = normalizeIdList(conceptIds);
  const map = new Map();
  if (ids.length === 0) return map;

  const keyIds = ids.map((conceptId) => buildTermDocId(releaseId, conceptId, languageCode));

  const docs = await projectionCollection
    .find(
      {
        $or: [
          { _id: { $in: keyIds } },
          {
            releaseId,
            languageCode,
            conceptId: { $in: ids }
          }
        ]
      },
      {
        projection: {
          _id: 1,
          conceptId: 1,
          term: 1,
          matchedTerm: 1,
          displayTerm: 1,
          preferredTerm: 1,
          fsn: 1,
          semanticTag: 1,
          termType: 1,
          typeId: 1,
          preferred: 1,
          isPreferred: 1
        }
      }
    )
    .toArray();

  for (const doc of docs) {
    const conceptId = String(doc?.conceptId || doc?._id?.split("|")[1] || "").trim();
    if (!conceptId) continue;
    const term = String(doc?.preferredTerm || doc?.displayTerm || doc?.term || doc?.matchedTerm || "").trim();
    const existing = map.get(conceptId);
    const candidate = {
      term: term || conceptId,
      semanticTag: doc?.semanticTag || parseSemanticTag(doc?.fsn || term),
      score: termProjectionScore(doc)
    };
    if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.term.localeCompare(existing.term) < 0)) {
      map.set(conceptId, candidate);
    }
  }

  for (const [conceptId, summary] of map.entries()) {
    map.set(conceptId, {
      term: summary.term,
      semanticTag: summary.semanticTag
    });
  }

  return map;
}

function mergeSourceTermSummaries(termMap, docs, languageCode) {
  for (const doc of Array.isArray(docs) ? docs : []) {
    const conceptId = String(doc?.conceptId || "").trim();
    if (!conceptId) continue;

    const existing = termMap.get(conceptId);
    if (existing?.term && existing.term !== conceptId) continue;

    const fallback = pickPreferredTermFromDescriptions(doc?.descriptions, languageCode);
    if (!fallback.term) continue;

    termMap.set(conceptId, {
      term: fallback.term,
      semanticTag: fallback.semanticTag || null
    });
  }
}

async function hydrateMissingTermSummaries({ sourceCollection, termMap, conceptIds, releaseId, languageCode }) {
  const ids = normalizeIdList(conceptIds).filter((conceptId) => {
    const existing = termMap.get(conceptId);
    return !existing?.term || existing.term === conceptId;
  });

  if (ids.length === 0) return;

  let docs;
  try {
    docs = await sourceCollection.find(
      { releaseId, conceptId: { $in: ids } },
      {
        projection: {
          _id: 0,
          conceptId: 1,
          descriptions: 1
        },
        hint: RELEASE_CONCEPT_INDEX
      }
    ).toArray();
  } catch (error) {
    throw asRequiredIndexError(error, RELEASE_CONCEPT_INDEX);
  }

  mergeSourceTermSummaries(termMap, docs, languageCode);
}

function toLinkedSummary(doc, languageCode, termMap) {
  const conceptId = String(doc?.conceptId || "").trim();
  const termSummary = termMap?.get(conceptId);
  const fallback = pickPreferredTermFromDescriptions(doc?.descriptions, languageCode);

  return {
    conceptId,
    term: termSummary?.term || fallback.term || conceptId,
    semanticTag: termSummary?.semanticTag || fallback.semanticTag || null,
    effectiveTime: doc?.effectiveTime || null
  };
}

function classifyRelationshipCategory(typeId, typeTerm) {
  if (String(typeId || "").trim() === IS_A_TYPE_ID) {
    return "defining";
  }

  const normalized = String(typeTerm || "").trim();
  if (OTHER_RELATIONSHIP_PATTERN.test(normalized)) {
    return "other";
  }

  return "defining";
}

async function fetchConceptDocsByIds(collection, conceptIds, releaseId) {
  const ids = normalizeIdList(conceptIds);
  if (ids.length === 0) return [];

  const filter = { releaseId, conceptId: { $in: ids } };
  const options = {
    projection: {
      _id: 0,
      conceptId: 1,
      effectiveTime: 1,
      definitionStatusId: 1,
      inferredParentIds: 1,
      inferredChildIds: 1,
      releaseId: 1
    }
  };

  try {
    return await collection.find(filter, { ...options, hint: RELEASE_CONCEPT_INDEX }).toArray();
  } catch (error) {
    throw asRequiredIndexError(error, RELEASE_CONCEPT_INDEX);
  }
}

async function buildAncestorData({
  sourceCollection,
  projectionCollection,
  conceptDoc,
  languageCode,
  maxDepth,
  limit,
  releaseId
}) {
  const neighbors = [];
  const byId = new Map();
  const visited = new Set();
  const termMap = new Map();

  let depth = 0;
  let frontier = normalizeIdList(conceptDoc?.inferredParentIds);

  while (frontier.length > 0 && depth <= maxDepth && neighbors.length < limit) {
    const missing = frontier.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const docs = await fetchConceptDocsByIds(sourceCollection, missing, releaseId);
      for (const doc of docs) {
        byId.set(String(doc.conceptId), doc);
      }

      const labels = await fetchTermMap({
        projectionCollection,
        conceptIds: docs.map((doc) => String(doc.conceptId)),
        releaseId,
        languageCode
      });
      for (const [id, summary] of labels.entries()) {
        termMap.set(id, summary);
      }
      await hydrateMissingTermSummaries({
        sourceCollection,
        termMap,
        conceptIds: docs.map((doc) => String(doc.conceptId)),
        releaseId,
        languageCode
      });
    }

    const next = [];

    for (const conceptId of frontier) {
      if (visited.has(conceptId)) continue;
      visited.add(conceptId);

      const doc = byId.get(conceptId);
      if (!doc) continue;

      const preferred = termMap.get(conceptId);
      const parentIds = normalizeIdList(doc.inferredParentIds, 24);
      const childIds = normalizeIdList(doc.inferredChildIds, 24);

      neighbors.push({
        conceptId,
        term: preferred?.term || conceptId,
        depth,
        effectiveTime: doc.effectiveTime || null,
        definitionStatusId: doc.definitionStatusId || null,
        inferredParentIds: parentIds,
        inferredChildIds: childIds
      });

      if (neighbors.length >= limit) break;
      if (depth < maxDepth) {
        next.push(...parentIds);
      }
    }

    frontier = normalizeIdList(next);
    depth += 1;
  }

  const neighborMap = new Map(neighbors.map((item) => [String(item.conceptId), item]));
  const chain = [];
  const chainVisited = new Set();
  let currentId = normalizeIdList(conceptDoc?.inferredParentIds)
    .map((parentId) => neighborMap.get(parentId))
    .filter(Boolean)
    .sort(sortByPrimaryPathPriority)[0]?.conceptId || null;

  while (currentId && !chainVisited.has(currentId)) {
    chainVisited.add(currentId);
    const item = neighborMap.get(currentId);
    if (!item) break;

    chain.unshift({
      conceptId: item.conceptId,
      term: item.term || item.conceptId,
      parentCount: Array.isArray(item.inferredParentIds) ? item.inferredParentIds.length : 0,
      definitionStatusId: item.definitionStatusId || null
    });

    currentId = normalizeIdList(item.inferredParentIds)
      .map((parentId) => neighborMap.get(parentId))
      .filter((candidate) => candidate && !chainVisited.has(String(candidate.conceptId)))
      .sort(sortByPrimaryPathPriority)[0]?.conceptId || null;
  }

  return {
    neighbors,
    chain
  };
}

function buildConceptPayload({
  conceptDoc,
  parentDocs,
  childDocs,
  childLimit,
  languageCode,
  termMap,
  conceptTermSummary
}) {
  const parentIdsAll = normalizeIdList(conceptDoc?.inferredParentIds);
  const childIdsAll = normalizeIdList(conceptDoc?.inferredChildIds);
  const byId = indexByConceptId([...(parentDocs || []), ...(childDocs || [])]);

  const parents = parentIdsAll
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((doc) => toLinkedSummary(doc, languageCode, termMap))
    .sort((a, b) => a.term.localeCompare(b.term));

  const children = childIdsAll
    .slice(0, childLimit)
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((doc) => toLinkedSummary(doc, languageCode, termMap))
    .sort((a, b) => a.term.localeCompare(b.term));

  const descriptions = Array.isArray(conceptDoc?.descriptions)
    ? conceptDoc.descriptions.filter((desc) => normalizeActive(desc?.active))
    : [];
  const relationships = Array.isArray(conceptDoc?.relationships)
    ? conceptDoc.relationships
        .filter((rel) => rel?.active === undefined || normalizeActive(rel?.active))
        .slice(0, 40)
    : [];

  const fallbackPreferred = pickPreferredTermFromDescriptions(descriptions, languageCode);
  const preferred = {
    term: conceptTermSummary?.term || fallbackPreferred.term,
    semanticTag: conceptTermSummary?.semanticTag || fallbackPreferred.semanticTag
  };

  const normalizedLanguage = String(languageCode || "es").toLowerCase();
  const fsnByLanguage = descriptions.find(
    (desc) => String(desc?.typeId || "") === DESC_TYPE_FSN && String(desc?.languageCode || "").toLowerCase() === normalizedLanguage
  );
  const fsnFallback = descriptions.find((desc) => String(desc?.typeId || "") === DESC_TYPE_FSN);
  const fullySpecifiedName = String(fsnByLanguage?.term || fsnFallback?.term || preferred.term || conceptDoc?.conceptId || "").trim();

  const synonymPreview = descriptions
    .filter(
      (desc) =>
        String(desc?.typeId || "") === DESC_TYPE_SYNONYM &&
        String(desc?.languageCode || "").toLowerCase() === normalizedLanguage &&
        String(desc?.term || "").trim().length > 0
    )
    .slice(0, 6)
    .map((desc) => String(desc.term).trim());

  const relationshipPreview = relationships
    .map((rel) => {
      const destinationId = String(rel?.destinationId || "").trim();
      const typeId = String(rel?.typeId || "").trim();
      const destinationSummary = termMap?.get(destinationId);
      const typeSummary = termMap?.get(typeId);
      return {
        destinationId,
        destinationTerm: destinationSummary?.term || destinationId,
        destinationSemanticTag: destinationSummary?.semanticTag || null,
        typeId,
        typeTerm: typeId === IS_A_TYPE_ID ? "Is a" : (typeSummary?.term || typeId),
        category: classifyRelationshipCategory(typeId, typeId === IS_A_TYPE_ID ? "Is a" : (typeSummary?.term || typeId)),
        group: rel?.relationshipGroup ?? null
      };
    })
    .filter((rel) => rel.destinationId && rel.typeId)
    .sort((left, right) => {
      const leftIsA = left.typeId === IS_A_TYPE_ID ? 0 : 1;
      const rightIsA = right.typeId === IS_A_TYPE_ID ? 0 : 1;
      if (leftIsA !== rightIsA) return leftIsA - rightIsA;

      const typeDiff = String(left.typeTerm || "").localeCompare(String(right.typeTerm || ""));
      if (typeDiff !== 0) return typeDiff;

      const destinationDiff = String(left.destinationTerm || "").localeCompare(String(right.destinationTerm || ""));
      if (destinationDiff !== 0) return destinationDiff;

      return String(left.destinationId || "").localeCompare(String(right.destinationId || ""));
    });

  return {
    conceptId: String(conceptDoc?.conceptId || "").trim(),
    active: normalizeActive(conceptDoc?.active),
    preferredTerm: preferred.term || String(conceptDoc?.conceptId || "").trim(),
    fullySpecifiedName,
    synonymPreview,
    effectiveTime: conceptDoc?.effectiveTime || null,
    moduleId: conceptDoc?.moduleId || null,
    definitionStatusId: conceptDoc?.definitionStatusId || null,
    releaseId: conceptDoc?.releaseId || null,
    memberOfRefsetIds: normalizeIdList(conceptDoc?.memberOfRefsetIds, 25),
    descriptionCount: descriptions.length,
    relationshipCount: relationships.length,
    parentCount: parentIdsAll.length,
    childCount: childIdsAll.length,
    parents,
    children,
    relationshipPreview: relationshipPreview.slice(0, 25)
  };
}

export async function POST(request) {
  const startedAt = process.hrtime.bigint();

  try {
    const body = await parseJson(request);
    const conceptId = typeof body.conceptId === "string" ? body.conceptId.trim() : "";
    const childLimit = Math.min(Math.max(Number(body.childLimit) || 25, 1), 100);
    const direction = body.direction === "descendants" ? "descendants" : "ancestors";
    const maxDepth = Math.min(Math.max(Number(body.maxDepth) || 2, 0), 6);
    const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 250);
    const forceRefresh = normalizeBool(body.forceRefresh);
    const languageCode = typeof body.languageCode === "string" ? body.languageCode.trim().toLowerCase() : "es";
    const releaseIdInput = typeof body.releaseId === "string" ? body.releaseId.trim() : "";

    if (!conceptId) {
      return fail("conceptId is required", 400);
    }

    const { sourceCollection, projectionCollection } = getMongoConfig();
    const { ttlSeconds, maxEntries } = getHierarchyCacheConfig();
    const { releaseId: defaultReleaseId } = getSemanticsConfig();
    const effectiveRelease = releaseIdInput || defaultReleaseId || "latest";
    const ttlMs = ttlSeconds * 1000;

    const cacheKey = `${effectiveRelease}|${conceptId}|${languageCode}|${direction}|${maxDepth}|${limit}|${childLimit}`;
    const now = Date.now();
    const cacheState = getCacheState();
    const cacheMap = cacheState.entries;

    pruneCache(cacheMap, now);

    if (!forceRefresh) {
      const cached = cacheMap.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        cacheMap.delete(cacheKey);
        cacheMap.set(cacheKey, cached);
        cacheState.hits += 1;

        const cachedLatencyMs = elapsedMs(startedAt);
        emitUsageEventSafe({
          eventType: "concept.opened",
          source: "api/hierarchy",
          releaseId: cached.payload?.concept?.releaseId || effectiveRelease,
          languageCode,
          conceptId,
          conceptIds: [conceptId],
          resultCount: 1,
          durationMs: cachedLatencyMs,
          metadata: {
            cacheHit: true,
            direction,
            maxDepth,
            limit,
            childLimit,
            neighborCount: cached.payload?.graphResponse?.stats?.returned || 0,
            strategy: "release-scoped-sidecar-labels"
          }
        });

        return ok({
          ...cached.payload,
          stats: {
            ...cached.payload.stats,
            latencyMs: cachedLatencyMs,
            cacheHit: true
          },
          cache: {
            hit: true,
            key: cacheKey,
            size: cacheMap.size,
            hits: cacheState.hits,
            misses: cacheState.misses,
            ttlSeconds,
            expiresInMs: Math.max(cached.expiresAt - now, 0)
          }
        });
      }
    }

    cacheState.misses += 1;

    const source = await getCollection(sourceCollection);
    const projection = await getCollection(projectionCollection);

    const conceptProjection = {
      _id: 0,
      conceptId: 1,
      active: 1,
      effectiveTime: 1,
      moduleId: 1,
      definitionStatusId: 1,
      releaseId: 1,
      memberOfRefsetIds: 1,
      descriptions: 1,
      relationships: 1,
      inferredParentIds: 1,
      inferredChildIds: 1,
      inferredAncestorIds: 1
    };

    let conceptDoc;
    try {
      conceptDoc = await source.findOne(
        { releaseId: effectiveRelease, conceptId },
        { projection: conceptProjection, hint: RELEASE_CONCEPT_INDEX }
      );
    } catch (error) {
      throw asRequiredIndexError(error, RELEASE_CONCEPT_INDEX);
    }

    if (!conceptDoc) {
      return fail(`conceptId ${conceptId} was not found for release ${effectiveRelease}`, 404, {
        latencyMs: elapsedMs(startedAt)
      });
    }

    const resolvedReleaseId = String(conceptDoc.releaseId || effectiveRelease);
    const parentIds = normalizeIdList(conceptDoc.inferredParentIds, 20);
    const childIds = normalizeIdList(conceptDoc.inferredChildIds, childLimit);

    const linkedDocs = await fetchConceptDocsByIds(source, [...parentIds, ...childIds], resolvedReleaseId);
    const linkedById = indexByConceptId(linkedDocs);

    const parentDocs = parentIds.map((id) => linkedById.get(id)).filter(Boolean);
    const childDocs = childIds.map((id) => linkedById.get(id)).filter(Boolean);

    const relationshipIds = Array.isArray(conceptDoc?.relationships)
      ? conceptDoc.relationships
          .filter((rel) => rel?.active === undefined || normalizeActive(rel?.active))
          .slice(0, 40)
          .flatMap((rel) => [String(rel?.typeId || "").trim(), String(rel?.destinationId || "").trim()])
          .filter(Boolean)
      : [];

    const termMap = await fetchTermMap({
      projectionCollection: projection,
      conceptIds: [conceptId, ...parentIds, ...childIds, ...relationshipIds],
      releaseId: resolvedReleaseId,
      languageCode
    });
    await hydrateMissingTermSummaries({
      sourceCollection: source,
      termMap,
      conceptIds: [conceptId, ...parentIds, ...childIds, ...relationshipIds],
      releaseId: resolvedReleaseId,
      languageCode
    });

    const conceptPayload = buildConceptPayload({
      conceptDoc,
      parentDocs,
      childDocs,
      childLimit,
      languageCode,
      termMap,
      conceptTermSummary: termMap.get(conceptId)
    });

    let graphDoc = {
      conceptId,
      sourceTerm: conceptPayload.preferredTerm,
      neighbors: []
    };
    let ancestorChain = [];

    if (direction === "ancestors") {
      const ancestorData = await buildAncestorData({
        sourceCollection: source,
        projectionCollection: projection,
        conceptDoc,
        languageCode,
        maxDepth,
        limit,
        releaseId: resolvedReleaseId
      });

      graphDoc = {
        conceptId,
        sourceTerm: conceptPayload.preferredTerm,
        neighbors: ancestorData.neighbors
      };
      ancestorChain = ancestorData.chain;
    }

    const conceptResponse = {
      ok: true,
      pattern: "concept-360",
      pipeline: [{ stage: "release-scoped-direct-fetch" }],
      stats: {
        returned: 1,
        latencyMs: null
      },
      results: [conceptPayload],
      concept: conceptPayload
    };

    const graphResponse = {
      ok: true,
      pattern: direction === "ancestors" ? "parent-walk" : "children-inline",
      direction,
      pipeline: [{ stage: "release-scoped-parent-walk" }],
      stats: {
        returned: Array.isArray(graphDoc.neighbors) ? graphDoc.neighbors.length : 0,
        latencyMs: null
      },
      result: graphDoc
    };

    const latencyMs = elapsedMs(startedAt);
    conceptResponse.stats.latencyMs = latencyMs;
    graphResponse.stats.latencyMs = latencyMs;

    const payload = {
      ok: true,
      pattern: "hierarchy",
      concept: conceptPayload,
      graph: graphDoc,
      ancestorChain,
      conceptResponse,
      graphResponse,
      stats: {
        latencyMs,
        cacheHit: false
      }
    };

    cacheMap.set(cacheKey, {
      expiresAt: now + ttlMs,
      payload
    });
    ensureCapacity(cacheMap, maxEntries);
        emitUsageEventSafe({
      eventType: "concept.opened",
      source: "api/hierarchy",
      releaseId: conceptPayload?.releaseId || resolvedReleaseId,
      languageCode,
      conceptId,
      conceptIds: [conceptId],
      resultCount: 1,
      durationMs: latencyMs,
      metadata: {
        cacheHit: false,
        direction,
        maxDepth,
        limit,
        childLimit,
        neighborCount: graphResponse?.stats?.returned || 0,
        strategy: "release-scoped-sidecar-labels"
      }
    });

    return ok({
      ...payload,
      cache: {
        hit: false,
        key: cacheKey,
        size: cacheMap.size,
        hits: cacheState.hits,
        misses: cacheState.misses,
        ttlSeconds,
        expiresInMs: ttlMs
      }
    });
  } catch (error) {
    if (error?.code === "required-index-missing") {
      return fail(error.message, error.statusCode || 503, {
        code: error.code,
        index: error.indexName,
        latencyMs: elapsedMs(startedAt)
      });
    }

    return fail("Hierarchy merge failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
