import { createHash } from "node:crypto";
import { getLlmConfig } from "./config.js";
import { gatewayCatalogs, gatewayHeaders } from "./llm.js";

// The gateway owns model availability. Configuration supplies display order
// and a fallback for gateways that do not expose capability metadata.
export function languageModelIds(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .filter((row) => row?.capabilities?.inference === true && row.capabilities.chat_completion === true)
    .map((row) => row.id)
    .filter((id) => typeof id === "string" && id.trim()))];
}

function nativeLanguageModel(row, family) {
  if (typeof row?.id !== "string" || !row.id.trim()) return false;
  const capabilities = row.capabilities;
  if (capabilities?.inference === false || capabilities?.chat_completion === false) return false;
  if (capabilities?.embeddings === true && capabilities?.chat_completion !== true) return false;
  if (["embedding", "embeddings", "rerank", "image", "audio"].includes(row.mode || row.type)) return false;
  // Standard /models omits modality. Use the advertised ID's modality marker
  // only in that case; explicit capability metadata takes precedence.
  if (capabilities?.chat_completion !== true && /(?:^|[-_.])(?:embed(?:ding|dings)?|rerank)(?:[-_.]|$)/i.test(row.id)) return false;
  return family === "anthropic" ? row.type === "model" :
    (capabilities?.inference === true && capabilities?.chat_completion === true) || row.object === "model" && typeof row.owned_by === "string";
}

async function discoverCatalog(config, catalog, fetchImpl) {
  const rows = [], seenCursors = new Set();
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const suffix = cursor ? `?after_id=${encodeURIComponent(cursor)}` : "";
    const response = await fetchImpl(`${catalog.root}/models${suffix}`, { headers: gatewayHeaders(config, catalog.style), cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Gateway catalog request failed.");
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error("Invalid model catalog.");
    rows.push(...payload.data);
    if (!payload.has_more) return rows;
    if (!payload.last_id || seenCursors.has(payload.last_id)) throw new Error("Invalid model catalog pagination.");
    cursor = payload.last_id; seenCursors.add(cursor);
  }
  throw new Error("Model catalog pagination exceeded the supported limit.");
}

export function createRuntimeLlmConfigResolver({ fetchImpl = (...args) => fetch(...args), now = Date.now, ttlMs = 300000 } = {}) {
  const cache = new Map(), pending = new Map();
  return async function resolve(config) {
    if (!config.enabled || !config.baseUrl || !config.apiKey) return config;
    const catalogs = gatewayCatalogs(config);
    const key = createHash("sha256").update(JSON.stringify([catalogs, config.apiStyle, config.authHeader, config.apiKey, config.model, config.models])).digest("hex");
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.config;
    if (pending.has(key)) return pending.get(key);
    const operation = (async () => {
      let result, lifetime = ttlMs;
      try {
        const outcomes = await Promise.allSettled(catalogs.map((catalog) => discoverCatalog(config, catalog, fetchImpl)));
        const modelRoutes = {}, discovered = [];
        let unifiedLegacyCatalog = false;
        outcomes.forEach((outcome, index) => {
          if (outcome.status !== "fulfilled") return;
          const catalog = catalogs[index];
          const ids = catalog.family === "capabilities" ? languageModelIds(outcome.value) : outcome.value.filter((row) => nativeLanguageModel(row, catalog.family)).map((row) => row.id);
          for (const id of ids) {
            discovered.push(id);
            const row = outcome.value.find((entry) => entry.id === id);
            const legacy = catalog.family === "openai" && typeof row.owned_by !== "string"
              && row.capabilities?.inference === true && row.capabilities?.chat_completion === true;
            unifiedLegacyCatalog ||= legacy;
            modelRoutes[id] = { root: catalog.root, style: catalog.family === "openai" && !legacy && row.owned_by.toLowerCase() !== "openai" ? "chat" : catalog.style };
          }
        });
        if (!discovered.length) throw new Error("Gateway catalog has no inference-enabled chat models.");
        const available = new Set(discovered);
        const preferred = [config.model, ...(config.models || [])].filter((id) => available.has(id));
        const models = [...new Set([...preferred, ...discovered.sort((a, b) => a.localeCompare(b))])];
        const partial = !unifiedLegacyCatalog && outcomes.some((outcome) => outcome.status === "rejected");
        result = { ...config, models, modelRoutes, modelCatalog: { source: "gateway", state: partial ? "partial" : "ready", count: models.length,
          checkedAt: new Date(now()).toISOString(), defaultAvailable: available.has(config.model),
          ...(partial ? { reason: "One gateway model catalog is unavailable; verified choices from the other catalog are shown." } : {}) } };
      } catch {
        lifetime = Math.min(ttlMs, 15000);
        const previous = cached?.config;
        if (previous?.modelCatalog?.source === "gateway" && now() - Date.parse(previous.modelCatalog.checkedAt) <= 1800000) {
          result = { ...previous, modelCatalog: { ...previous.modelCatalog, state: "stale",
            reason: "Model catalog refresh unavailable; last known choices are shown." } };
        } else {
          result = { ...config, modelCatalog: { source: "configured", state: "unavailable", count: config.models.length,
            checkedAt: new Date(now()).toISOString(), reason: "Gateway catalog unavailable; configured models are shown." } };
        }
      }
      if (cache.size >= 16) cache.delete(cache.keys().next().value);
      cache.set(key, { config: result, expiresAt: now() + lifetime });
      return result;
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  };
}

const resolveRuntimeConfig = createRuntimeLlmConfigResolver();
export function getRuntimeLlmConfig() { return resolveRuntimeConfig(getLlmConfig()); }

export function withLlmModel(config, requestedModel) {
  if (requestedModel != null && typeof requestedModel !== "string") {
    throw Object.assign(new Error("A model selection must be a model ID."), { code: "invalid-model-selection", status: 400 });
  }
  const selected = typeof requestedModel === "string" && requestedModel.trim() ? requestedModel.trim() : config.model;
  if (!config.models.includes(selected)) {
    throw Object.assign(new Error(`Model ${selected} is unavailable for text generation in the configured gateway.`),
      { code: "llm-model-unavailable", status: requestedModel ? 400 : 503 });
  }
  if (config.apiStyle === "auto" && !config.modelRoutes?.[selected]) {
    throw Object.assign(new Error("Gateway model discovery is unavailable; routing cannot be verified. Retry when the catalog is available."),
      { code: "llm-routing-unavailable", status: 503 });
  }
  return { ...config, model: selected };
}

export function benchmarkModels(config, requestedModels) {
  if (requestedModels == null) return [withLlmModel(config).model];
  if (!Array.isArray(requestedModels) || !requestedModels.length || requestedModels.length > 32) {
    throw Object.assign(new Error("Select between 1 and 32 models per benchmark request."), { status: 400, code: "invalid-model-selection" });
  }
  return [...new Set(requestedModels.map((model) => {
    if (typeof model !== "string" || !model.trim()) {
      throw Object.assign(new Error("Each selected model must be a non-empty model ID."), { status: 400, code: "invalid-model-selection" });
    }
    return withLlmModel(config, model).model;
  }))];
}
