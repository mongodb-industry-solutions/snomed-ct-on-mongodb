import { resolveLlmModels } from "./llm-models.js";

const requiredInRuntime = ["MONGODB_URI"];
const DEFAULT_SNOMED_RELEASE_ID = "20260601";

function getEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function getEnvAny(names, fallback = "") {
  for (const name of names) {
    const value = getEnv(name);
    if (value) return value;
  }
  return fallback;
}

function getBooleanEnv(name, fallback = false) {
  const raw = getEnv(name);
  if (!raw) {
    return fallback;
  }
  return raw.toLowerCase() === "true";
}

function getNumberEnv(name, fallback, min, max) {
  const value = Number(getEnv(name, String(fallback)));
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

export function validateRequiredEnv() {
  const missing = requiredInRuntime.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

export function getMongoConfig() {
  const termSearchCollection = getEnv("MONGODB_TERM_SEARCH_COLLECTION", "snomed-term-search");
  return {
    uri: getEnv("MONGODB_URI"),
    authSource: getEnv("MONGODB_AUTH_SOURCE"),
    dbName: getEnv("MONGODB_DB", "terminology"),
    sourceCollection: getEnv("MONGODB_COLLECTION", "snomed-irbd"),
    termSearchCollection,
    projectionCollection: termSearchCollection,
    usageEventCollection: getEnv("MONGODB_USAGE_EVENT_COLLECTION", "snomed-usage-events"),
    modelStateCollection: getEnv("MONGODB_MODEL_STATE_COLLECTION", "snomed-model-state")
  };
}


export function getLlmConfig() {
  const { defaultModel, availableModels } = resolveLlmModels(getEnv("LLM_GROUNDING_MODEL"), getEnv("LLM_GROUNDING_MODELS"));
  // Provider-neutral: works with any OpenAI-compatible gateway. Set
  // LLM_BASE_URL to the gateway's Responses API base, LLM_API_KEY to its key,
  // and LLM_AUTH_HEADER to the header it expects ("api-key" for APIM-style
  // gateways, "authorization-bearer" for standard OpenAI-compatible APIs).
  return {
    enabled: getBooleanEnv("ENABLE_LLM_GROUNDING", false),
    baseUrl: getEnv("LLM_BASE_URL"),
    apiKey: getEnv("LLM_API_KEY"),
    authHeader: getEnv("LLM_AUTH_HEADER", "api-key"),
    // "auto" discovers separate OpenAI/Anthropic catalogs and their routes.
    // Explicit protocols support gateways exposing one API surface.
    apiStyle: (() => {
      const explicit = String(getEnv("LLM_API_STYLE", "")).trim().toLowerCase();
      if (["auto", "chat", "responses", "anthropic"].includes(explicit)) return explicit;
      if (/\/messages\/?$/.test(String(getEnv("LLM_BASE_URL", "")))) return "anthropic";
      return /\/chat\/completions\/?$/.test(String(getEnv("LLM_BASE_URL", ""))) ? "chat" : "responses";
    })(),
    model: defaultModel,
    // Display priority and fallback roster (comma-separated). Runtime gateway
    // capability discovery expands this to all advertised text models.
    models: availableModels,
    // Higher default: summary + primary + per-mention decisions on discharge
    // summaries easily exceed 1024, and truncated output = invalid JSON (502).
    maxTokens: getNumberEnv("LLM_GROUNDING_MAX_TOKENS", 4096, 256, 16384),
    timeoutMs: getNumberEnv("LLM_GROUNDING_TIMEOUT_MS", 180000, 10000, 300000)
  };
}

export function getSearchConfig() {
  const vectorMode = getEnvAny(["MONGODB_VECTOR_MODE", "ATLAS_VECTOR_MODE"], "autoEmbed");
  const usesAutoEmbedding = vectorMode.toLowerCase() === "autoembed";
  return {
    textIndex: getEnvAny(["MONGODB_SEARCH_INDEX", "ATLAS_SEARCH_INDEX"], "snomed_text_idx"),
    vectorIndex: getEnvAny(["MONGODB_VECTOR_INDEX", "ATLAS_VECTOR_INDEX"], "snomed_voyage_idx"),
    vectorMode,
    vectorPath: getEnvAny(["MONGODB_VECTOR_PATH", "ATLAS_VECTOR_PATH"], usesAutoEmbedding ? "embedText" : "embedding_voyage_4_lite_256"),
    vectorModel: getEnvAny(["MONGODB_VECTOR_AUTO_EMBED_MODEL", "ATLAS_VECTOR_AUTO_EMBED_MODEL"], "voyage-4"),
    manualVectorPath: getEnvAny(["MONGODB_MANUAL_VECTOR_PATH", "ATLAS_MANUAL_VECTOR_PATH"], "embedding_voyage_4_lite_256")
  };
}

export function getVoyageRerankConfig() {
  // Voyage reranker (cross-encoder) for the hybrid search's final ordering.
  // Provider-neutral base-URL failover mirrors the Leafy-Hospital pattern:
  // try the configured base, then the MongoDB-hosted Voyage gateway, then
  // Voyage's public API. If no key is present the hybrid search degrades
  // gracefully to reciprocal-rank-fusion order (no rerank).
  const apiKey = getEnv("VOYAGE_API_KEY");
  const configuredBase = getEnv("VOYAGE_API_BASE_URL");
  const baseUrls = [
    configuredBase,
    "https://ai.mongodb.com/v1",
    "https://api.voyageai.com/v1"
  ].filter(Boolean);
  return {
    enabled: Boolean(apiKey),
    apiKey,
    model: getEnv("VOYAGE_RERANK_MODEL", "rerank-2.5"),
    baseUrls,
    timeoutMs: getNumberEnv("VOYAGE_TIMEOUT_MS", 8000, 1000, 60000)
  };
}

export function getHybridSearchConfig() {
  // Tuning for the lexical + vector fusion and rerank pool sizes.
  const fusionMode = getEnv("HYBRID_FUSION_MODE", "appRrf").trim();
  return {
    // App-side RRF avoids the native timeout/retry cost on the demo cluster.
    // Native "rankFusion" and "scoreFusion" remain opt-in tuning options.
    fusionMode,
    // Bound native fusion experiments so the UI can fall back to the proven
    // app-side RRF path if the MongoDB deployment/version is not ready or the native
    // plan is too slow for an interactive demo.
    nativeFusionMaxTimeMs: getNumberEnv("HYBRID_NATIVE_FUSION_MAX_TIME_MS", 8000, 1000, 60000),
    // How many candidates each engine (lexical, vector) retrieves before fusion.
    candidatePool: getNumberEnv("HYBRID_CANDIDATE_POOL", 40, 5, 200),
    // Per-engine fusion weights. Native $rankFusion/$scoreFusion take them as
    // combination.weights; the app-side RRF fallback applies them the same way
    // (weight / (k + rank)) so both paths rank identically for the same input.
    lexicalWeight: getNumberEnv("HYBRID_LEXICAL_WEIGHT", 0.55, 0, 1),
    semanticWeight: getNumberEnv("HYBRID_SEMANTIC_WEIGHT", 0.45, 0, 1),
    // Reciprocal-rank-fusion constant for the app-side path; larger flattens
    // rank influence. Native $rankFusion uses a fixed k=60.
    rrfK: getNumberEnv("HYBRID_RRF_K", 60, 1, 1000),
    // Voyage rerank on top of fusion. Turning it off exposes the raw fused order.
    rerankEnabled: getBooleanEnv("HYBRID_RERANK_ENABLED", true),
    // Max fused concepts handed to the reranker (cost/latency guard).
    rerankPool: getNumberEnv("HYBRID_RERANK_POOL", 40, 5, 200),
    // Grounding combines lexical and semantic retrieval; callers can still run
    // an explicit lexical baseline for evaluation.
    groundingEnabled: getBooleanEnv("ENABLE_HYBRID_GROUNDING", true),
    // Smaller per-phrase pools keep multi-phrase notes responsive.
    groundingCandidatePool: getNumberEnv("HYBRID_GROUNDING_POOL", 20, 5, 100)
  };
}

export function getHierarchyCacheConfig() {
  return {
    ttlSeconds: getNumberEnv("HIERARCHY_CACHE_TTL_SECONDS", 86400, 60, 86400 * 365),
    maxEntries: getNumberEnv("HIERARCHY_CACHE_MAX_ENTRIES", 5000, 100, 100000)
  };
}

export function getSemanticsConfig() {
  return {
    releaseId: getEnv("SNOMED_RELEASE_ID", getEnv("RELEASE_ID_TARGET", DEFAULT_SNOMED_RELEASE_ID)),
    eclMaxResults: getNumberEnv("ECL_MAX_RESULTS", 200000, 1000, 2000000),
    smartSearchScopeMaxIds: getNumberEnv("SMARTSEARCH_SCOPE_MAX_IDS", 20000, 100, 250000),
    semanticsScopeCacheTtlSeconds: getNumberEnv("SEMANTICS_SCOPE_CACHE_TTL_SECONDS", 86400, 10, 86400 * 365),
    semanticsScopeCacheMaxEntries: getNumberEnv("SEMANTICS_SCOPE_CACHE_MAX_ENTRIES", 5000, 100, 200000)
  };
}
