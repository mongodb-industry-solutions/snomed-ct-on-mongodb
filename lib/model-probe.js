// Model-shape probes answer "has this collection been migrated to field X yet?".
//
// These used to run as one `findOne({ field: { $exists: true } })` per field. The
// planner cannot serve an unindexed `$exists` from a btree index, so every probe fell
// back to a COLLSCAN, and a field that is absent from every document forced that scan
// to run to the end of the collection. Against terminology.snomed-irbd that meant nine
// full scans per /api/readiness call, which showed up as cluster overload.
//
// One bounded natural-order read answers every probe for a collection at once. The
// result is memoised because a collection's shape only changes when a migration
// script runs, not between page loads.

const CACHE_KEY = "__SNOMED_MODEL_PROBE_CACHE_V1__";
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const SAMPLE_SIZE = 20;

function getCacheState() {
  const root = globalThis;
  if (!root[CACHE_KEY]) {
    root[CACHE_KEY] = new Map();
  }
  return root[CACHE_KEY];
}

function isNamespaceMissingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return lowered.includes("namespace") && lowered.includes("not") && lowered.includes("exist");
}

function isPresent(value) {
  return value !== undefined && value !== null;
}

function isNonEmpty(value) {
  return Array.isArray(value) ? value.length > 0 : isPresent(value);
}

// Mirrors MongoDB's $type semantics: a type predicate against an array field
// matches when any ELEMENT is of that type, not just when the field itself is.
// `typeof` alone misses [138875005, 404684003] and would report a legacy
// collection's numeric IDs as already normalised.
function someValue(value, predicate) {
  return Array.isArray(value) ? value.some(predicate) : predicate(value);
}

function isNumber(value) {
  return typeof value === "number";
}

// Field paths are configurable and may be dotted (e.g. "vectors.manual"). A
// projection of a dotted path returns a nested object, so a literal property
// lookup silently yields undefined.
function readPath(doc, path) {
  if (typeof path !== "string" || path.length === 0) return undefined;
  if (!path.includes(".")) return doc[path];
  return path
    .split(".")
    .reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), doc);
}

async function sampleDocuments(collection, paths) {
  const projection = { _id: 0 };
  for (const path of paths) {
    projection[path] = 1;
  }

  try {
    return await collection.find({}, { projection }).limit(SAMPLE_SIZE).toArray();
  } catch (error) {
    if (isNamespaceMissingError(error)) {
      return [];
    }
    throw error;
  }
}

async function memoized(collection, key, ttlMs, compute) {
  const cache = getCacheState();
  const cacheKey = `${collection.collectionName}:${key}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await compute();
  cache.set(cacheKey, { expiresAt: now + ttlMs, value });
  return value;
}

export async function probeSourceModel(collection, ttlMs = DEFAULT_TTL_MS) {
  return memoized(collection, "source-model", ttlMs, async () => {
    const docs = await sampleDocuments(collection, [
      "releaseId",
      "effectiveTime",
      "releaseDate",
      "inferredDescendantIds",
      "inferredAncestorIds",
      "inferredParentIds",
      "inferredChildIds",
      "relationshipAttributeKeys",
      "descriptions.conceptId"
    ]);

    return {
      hasReleaseId: docs.some((doc) => isPresent(doc.releaseId)),
      hasEffectiveTime: docs.some((doc) => isPresent(doc.effectiveTime)),
      hasReleaseDate: docs.some((doc) => isPresent(doc.releaseDate)),
      hasStoredDescendantClosure: docs.some((doc) => isPresent(doc.inferredDescendantIds)),
      hasNumericAncestorIds: docs.some((doc) => someValue(doc.inferredAncestorIds, isNumber)),
      hasNumericParentIds: docs.some((doc) => someValue(doc.inferredParentIds, isNumber)),
      hasNumericChildIds: docs.some((doc) => someValue(doc.inferredChildIds, isNumber)),
      hasNumericDescriptionConceptIds: docs.some((doc) =>
        someValue(doc.descriptions, (entry) => isNumber(entry?.conceptId))
      ),
      hasRelationshipAttributeKeys: docs.some((doc) => isNonEmpty(doc.relationshipAttributeKeys))
    };
  });
}

export async function probeProjectionModel(
  collection,
  { manualVectorPath, vectorPath },
  ttlMs = DEFAULT_TTL_MS
) {
  const paths = ["releaseDate", "semanticTagKey", manualVectorPath, vectorPath].filter(Boolean);

  return memoized(collection, `projection-model:${paths.join(",")}`, ttlMs, async () => {
    const docs = await sampleDocuments(collection, paths);

    return {
      hasProjectionReleaseDate: docs.some((doc) => isPresent(doc.releaseDate)),
      hasSemanticTagKey: docs.some((doc) => isPresent(doc.semanticTagKey)),
      hasManualVectors: docs.some((doc) => isPresent(readPath(doc, manualVectorPath))),
      hasAutoEmbedVectors: docs.some((doc) => {
        const value = readPath(doc, vectorPath);
        return typeof value === "string" && value !== "";
      })
    };
  });
}
