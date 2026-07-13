const CACHE_KEY = "__SNOMED_SEARCH_INDEX_READINESS_CACHE_V1__";
const DEFAULT_TTL_MS = 15000;

function getCacheState() {
  const root = globalThis;
  if (!root[CACHE_KEY]) {
    root[CACHE_KEY] = {
      expiresAt: 0,
      byCollection: new Map()
    };
  }
  return root[CACHE_KEY];
}

function normalizeIndex(index) {
  return {
    name: index?.name || "",
    type: index?.type || "",
    status: index?.status || "",
    queryable: Boolean(index?.queryable)
  };
}

async function getSearchIndexes(collection, ttlMs = DEFAULT_TTL_MS) {
  const cache = getCacheState();
  const cacheKey = collection.collectionName;
  const now = Date.now();

  if (cache.expiresAt > now && cache.byCollection.has(cacheKey)) {
    return cache.byCollection.get(cacheKey);
  }

  const rows = await collection.listSearchIndexes().toArray();
  const normalized = rows.map(normalizeIndex);

  cache.byCollection.set(cacheKey, normalized);
  cache.expiresAt = now + ttlMs;

  return normalized;
}

export async function ensureSearchIndexReady({
  collection,
  indexName,
  ttlMs = DEFAULT_TTL_MS
}) {
  try {
    const indexes = await getSearchIndexes(collection, ttlMs);
    const index = indexes.find((entry) => entry.name === indexName) || null;

    if (!index) {
      return {
        ok: false,
        status: 503,
        code: "SEARCH_INDEX_MISSING",
        message: `MongoDB Search index '${indexName}' is missing on collection '${collection.collectionName}'.`,
        details: {
          indexName,
          collection: collection.collectionName,
          knownIndexes: indexes.map((entry) => entry.name)
        }
      };
    }

    if (!index.queryable) {
      return {
        ok: false,
        status: 503,
        code: "SEARCH_INDEX_NOT_READY",
        message: `MongoDB Search index '${indexName}' is not queryable yet (status: ${index.status || "unknown"}).`,
        details: {
          indexName,
          collection: collection.collectionName,
          status: index.status || null,
          queryable: false
        }
      };
    }

    return {
      ok: true,
      status: 200,
      code: "SEARCH_INDEX_READY",
      message: "",
      details: {
        indexName,
        collection: collection.collectionName,
        status: index.status || null,
        queryable: true
      }
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 503,
      code: "SEARCH_INDEX_READINESS_FAILED",
      message: "Could not verify MongoDB Search index readiness.",
      details: {
        indexName,
        collection: collection.collectionName,
        reason
      }
    };
  }
}
