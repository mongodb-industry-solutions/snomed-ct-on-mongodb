// Shared client for OpenAI-compatible LLM gateways.
// Provider-neutral raw fetch, no SDK. Supports both gateway surfaces:
//   - "chat":      POST /chat/completions  { model, messages }
//   - "responses": POST /responses         { model, input }
// The style comes from cfg.apiStyle (see getLlmConfig). Response text and usage
// parsing already cover both shapes, so only the request differs.

// Resolve the endpoint + style from config, tolerating a base URL that already
// ends in /responses or /chat/completions.
export function resolveGateway(cfg) {
  const root = String(cfg?.baseUrl || "").replace(/\/$/, "").replace(/\/(responses|chat\/completions)$/, "");
  // Default to the universal Responses surface; only use chat when asked.
  const style = cfg?.apiStyle === "chat" ? "chat" : "responses";
  const endpoint = style === "responses" ? `${root}/responses` : `${root}/chat/completions`;
  return { endpoint, style, root };
}

function gatewayBody(style, cfg, prompt) {
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
  return data?.choices?.[0]?.message?.content || "";
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
export async function callLlmGateway(cfg, prompt) {
  const { endpoint, style } = resolveGateway(cfg);
  const headers = { "content-type": "application/json" };
  if (cfg.authHeader === "authorization-bearer") headers.authorization = `Bearer ${cfg.apiKey}`;
  else headers[cfg.authHeader || "api-key"] = cfg.apiKey;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(gatewayBody(style, cfg, prompt))
  });
  const raw = await res.text();
  if (!res.ok) return { ok: false, status: res.status, detail: raw.slice(0, 500), endpoint, style };
  let data;
  try { data = JSON.parse(raw); } catch (_e) { return { ok: false, status: 502, detail: raw.slice(0, 400), endpoint, style }; }
  return { ok: true, data, text: extractLlmText(data), usage: data?.usage || null, endpoint, style };
}
