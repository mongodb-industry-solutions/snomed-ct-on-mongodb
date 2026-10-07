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
  // Provider-neutral: works with any OpenAI-compatible gateway. Set
  // LLM_BASE_URL to the gateway's Responses API base, LLM_API_KEY to its key,
  // and LLM_AUTH_HEADER to the header it expects ("api-key" for APIM-style
  // gateways, "authorization-bearer" for standard OpenAI-compatible APIs).
  return {
    enabled: getBooleanEnv("ENABLE_LLM_GROUNDING", false),
    baseUrl: getEnv("LLM_BASE_URL"),
    apiKey: getEnv("LLM_API_KEY"),
    authHeader: getEnv("LLM_AUTH_HEADER", "api-key"),
    // Gateway API surface: "responses" (universal on Grove/Azure Foundry — the
    // only path that serves OpenAI, Anthropic, Mistral, DeepSeek, xAI, Kimi, …
    // through one shape) or "chat" (/chat/completions; OpenAI needs
    // max_completion_tokens, and Anthropic is not served there). Default:
    // "responses" unless the base URL explicitly ends in /chat/completions or
    // LLM_API_STYLE=chat is set.
    apiStyle: (() => {
      const explicit = String(getEnv("LLM_API_STYLE", "")).trim().toLowerCase();
      if (explicit === "chat" || explicit === "responses") return explicit;
      return /\/chat\/completions\/?$/.test(String(getEnv("LLM_BASE_URL", ""))) ? "chat" : "responses";
    })(),
    model: getEnv("LLM_GROUNDING_MODEL", "gpt-5.5"),
    // Optional list of selectable models the gateway serves (comma-separated).
    // Enables the model picker + the benchmark:models comparison. Falls back to
    // the single default model.
    models: (() => {
      const raw = getEnv("LLM_GROUNDING_MODELS");
      const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const def = getEnv("LLM_GROUNDING_MODEL", "gpt-5.5");
      return Array.from(new Set([def, ...list]));
    })(),
    // Higher default: summary + primary + per-mention decisions on discharge
    // summaries easily exceed 1024, and truncated output = invalid JSON (502).
    maxTokens: getNumberEnv("LLM_GROUNDING_MAX_TOKENS", 4096, 256, 16384)
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
  const fusionMode = getEnv("HYBRID_FUSION_MODE", "rankFusion").trim();
  return {
    // Native MongoDB fusion mode for navigator hybrid retrieval. Use
    // "rankFusion" by default; "scoreFusion" is available for experiments, and
    // "appRrf" forces the legacy two-query application-layer fusion fallback.
    fusionMode,
    // Bound native fusion experiments so the UI can fall back to the proven
    // app-side RRF path if the MongoDB deployment/version is not ready or the native
    // plan is too slow for an interactive demo.
    nativeFusionMaxTimeMs: getNumberEnv("HYBRID_NATIVE_FUSION_MAX_TIME_MS", 8000, 1000, 60000),
    // How many candidates each engine (lexical, vector) retrieves before fusion.
    candidatePool: getNumberEnv("HYBRID_CANDIDATE_POOL", 40, 5, 200),
    // Reciprocal-rank-fusion constant; larger flattens rank influence.
    rrfK: getNumberEnv("HYBRID_RRF_K", 60, 1, 1000),
    // Max fused concepts handed to the reranker (cost/latency guard).
    rerankPool: getNumberEnv("HYBRID_RERANK_POOL", 40, 5, 200),
    // Deterministic lexical retrieval is the default for note grounding: the
    // gold benchmark showed hybrid-in-grounding did not improve accuracy and
    // added latency/tokens. Hybrid stays available as an opt-in experiment.
    groundingEnabled: getBooleanEnv("ENABLE_HYBRID_GROUNDING", false),
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
