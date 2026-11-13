// Protocol adapters shared by extraction, semantic review and query planning.
// Auto routing uses the model's catalog provenance and provider metadata.
// Explicit styles preserve compatibility with a single-protocol gateway.

export function gatewayCatalogs(cfg) {
  if (cfg.apiStyle === "auto") {
    const base = String(cfg.baseUrl || "").replace(/\/+$/, "")
      .replace(/\/(openai|anthropic)\/v1(?:\/(?:responses|chat\/completions|messages|models))?$/, "");
    return [
      { family: "openai", root: `${base}/openai/v1`, style: "responses" },
      { family: "anthropic", root: `${base}/anthropic/v1`, style: "anthropic" }
    ];
  }
  const { root, style } = resolveGateway(cfg);
  return [{ family: style === "anthropic" ? "anthropic" : "capabilities", root, style }];
}

// Resolve the endpoint + style from config, tolerating a base URL that already
// ends in /responses or /chat/completions.
export function resolveGateway(cfg) {
  const route = cfg.apiStyle === "auto" ? cfg.modelRoutes?.[cfg.model] : null;
  if (cfg.apiStyle === "auto" && !route) {
    throw Object.assign(new Error("The gateway model catalog is required to route this model."), { status: 503, code: "llm-routing-unavailable" });
  }
  const root = String(route?.root || cfg?.baseUrl || "").replace(/\/+$/, "").replace(/\/(responses|chat\/completions|messages)$/, "");
  const style = route?.style || (["chat", "anthropic"].includes(cfg?.apiStyle) ? cfg.apiStyle : "responses");
  const suffix = style === "responses" ? "responses" : style === "anthropic" ? "messages" : "chat/completions";
  const endpoint = `${root}/${suffix}`;
  return { endpoint, style, root };
}

export function gatewayHeaders(cfg, style) {
  const headers = { "content-type": "application/json" };
  if (style === "anthropic") {
    headers["x-api-key"] = cfg.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (cfg.authHeader === "authorization-bearer") headers.authorization = `Bearer ${cfg.apiKey}`;
  else headers[cfg.authHeader || "api-key"] = cfg.apiKey;
  return headers;
}

export function gatewayBody(style, cfg, prompt) {
  if (style === "responses") {
    return { model: cfg.model, input: prompt, max_output_tokens: cfg.maxTokens };
  }
  // Chat Completions uses max_tokens as the broadly compatible output cap.
  return { model: cfg.model, messages: [{ role: "user", content: prompt }], max_tokens: cfg.maxTokens };
}

export function extractLlmText(data) {
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;
  const fromOutput = (Array.isArray(data?.output) ? data.output : [])
    .flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
    .map((c) => (typeof c?.text === "string" ? c.text : ""))
    .join("");
  if (fromOutput) return fromOutput;
  const content = data?.content || data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return (Array.isArray(content) ? content : []).filter((block) => block.type === "text")
    .map((block) => typeof block.text === "string" ? block.text : "").join("");
}

export function normalizeGatewayUsage(usage) {
  if (!usage) return null;
  const input = (Number(usage.input_tokens ?? usage.prompt_tokens) || 0)
    + (Number(usage.cache_read_input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens) || 0;
  return { ...usage, input_tokens: input, output_tokens: output, total_tokens: input + output };
}

export function parseLooseJson(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// Calls the gateway (chat or responses per cfg.apiStyle).
// Returns { ok, text, data, usage, endpoint, style, status, detail }.
export async function callLlmGateway(cfg, prompt, { fetchImpl = fetch } = {}) {
  const { endpoint, style } = resolveGateway(cfg);
  const headers = gatewayHeaders(cfg, style);

  let res, raw;
  try { res = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(gatewayBody(style, cfg, prompt)),
    signal: AbortSignal.timeout(Number(cfg.timeoutMs) || 120000)
  }); raw = await res.text(); } catch (error) { return {ok:false,status:504,error:error?.name==='TimeoutError'?'LLM request timed out':String(error.message),endpoint,style}; }
  if (!res.ok) return { ok: false, status: res.status, detail: raw.slice(0, 500), endpoint, style };
  let data;
  try { data = JSON.parse(raw); } catch (_e) { return { ok: false, status: 502, detail: raw.slice(0, 400), endpoint, style }; }
  return { ok: true, data, text: extractLlmText(data), usage: normalizeGatewayUsage(data?.usage), endpoint, style };
}
