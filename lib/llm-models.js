export const DEFAULT_LLM_MODEL = "gpt-5.4-nano";
export const DEFAULT_LLM_MODELS = [DEFAULT_LLM_MODEL, "gpt-5.4-mini", "gpt-5.4", "gpt-5.5"];

export function resolveLlmModels(model, configuredModels) {
  const defaultModel = String(model || "").trim() || DEFAULT_LLM_MODEL;
  const raw = String(configuredModels || "").trim();
  const models = raw ? raw.split(",").map((value) => value.trim()).filter(Boolean) : DEFAULT_LLM_MODELS;
  return { defaultModel, availableModels: [...new Set([defaultModel, ...models])] };
}

// Only this allowlist crosses the browser boundary; gateway secrets stay server-side.
export function publicLlmConfig(config) {
  return { enabled: config.enabled, defaultModel: config.model, availableModels: config.models,
    ...(config.modelCatalog ? { modelCatalog: {
      source: config.modelCatalog.source, state: config.modelCatalog.state, count: config.modelCatalog.count,
      checkedAt: config.modelCatalog.checkedAt, defaultAvailable: config.modelCatalog.defaultAvailable,
      ...(config.modelCatalog.reason ? { reason: config.modelCatalog.reason } : {})
    } } : {}) };
}
