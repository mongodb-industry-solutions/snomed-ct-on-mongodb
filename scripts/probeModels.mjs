// Probe the configured LLM gateway: list the model ids it advertises, then send
// a minimal chat/completions call to each candidate model and report which
// actually respond. Uses the same env as the app (LLM_BASE_URL / LLM_API_KEY /
// LLM_AUTH_HEADER / LLM_API_STYLE).
//
//   node scripts/probeModels.mjs                 # probe LLM_GROUNDING_MODELS (+ discovered ids)
//   node scripts/probeModels.mjs gpt-5.5 DeepSeek-V3.2   # probe explicit ids
import "./loadEnv.mjs";

const rawBase = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
const root = rawBase.replace(/\/(responses|chat\/completions)$/, "");
const apiKey = process.env.LLM_API_KEY || "";
const authHeader = process.env.LLM_AUTH_HEADER || "api-key";
const style = (process.env.LLM_API_STYLE || (/\/responses\/?$/.test(rawBase) ? "responses" : "chat")).toLowerCase();

if (!root || !apiKey) {
  console.error("LLM_BASE_URL and LLM_API_KEY must be set in .env.local.");
  process.exit(1);
}

function headers() {
  const h = { "content-type": "application/json" };
  if (authHeader === "authorization-bearer") h.authorization = `Bearer ${apiKey}`;
  else h[authHeader] = apiKey;
  return h;
}

async function listModels() {
  const url = `${root}/models`;
  try {
    const res = await fetch(url, { headers: headers() });
    const txt = await res.text();
    if (!res.ok) return { ok: false, status: res.status, detail: txt.slice(0, 200) };
    const data = JSON.parse(txt);
    const ids = (Array.isArray(data?.data) ? data.data : []).map((m) => m.id || m.name).filter(Boolean);
    return { ok: true, ids };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function probe(model) {
  const endpoint = style === "responses" ? `${root}/responses` : `${root}/chat/completions`;
  const body = style === "responses"
    ? { model, input: "Reply with the single word: ok", max_output_tokens: 16 }
    : { model, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 16 };
  const t0 = Date.now();
  try {
    const res = await fetch(endpoint, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    const txt = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { model, ok: false, status: res.status, ms, detail: txt.replace(/\s+/g, " ").slice(0, 160) };
    let data; try { data = JSON.parse(txt); } catch { return { model, ok: false, status: "bad-json", ms }; }
    const text = data?.output_text
      || (data?.output || []).flatMap((o) => o?.content || []).map((c) => c?.text || "").join("")
      || data?.choices?.[0]?.message?.content || "";
    const usage = data?.usage || {};
    return { model, ok: true, ms, sample: String(text).replace(/\s+/g, " ").trim().slice(0, 40), tokens: usage.total_tokens ?? "?" };
  } catch (e) {
    return { model, ok: false, status: "network", ms: Date.now() - t0, detail: e.message };
  }
}

// Candidate roster (best-guess ids by observed convention; the /models list is
// authoritative when available).
const DEFAULT_CANDIDATES = [
  // OpenAI
  "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o1",
  // Anthropic (try both native + display-style ids)
  "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5", "Claude-Opus-4.8", "Claude-Sonnet-5", "Claude-Haiku-4.5", "claude-fable-5",
  // Mistral
  "Mistral-Large-3", "mistral-large-2505", "Mistral-Medium-2505", "Mistral-Small-2503",
  // DeepSeek
  "DeepSeek-V3.2", "DeepSeek-V4-Flash",
  // xAI
  "grok-4-30", "grok-4-3", "grok-4-20-reasoning", "grok-4-2-reasoning",
  // Cohere / Meta / Microsoft / Moonshot
  "Cohere-Command-A", "Llama-4-Scout-17B-16E-Instruct", "Phi-4", "Kimi-K2-Thinking", "Kimi-K2.6"
];

async function main() {
  console.log(`Gateway root: ${root}\nStyle: ${style}\nAuth header: ${authHeader}\n`);

  const list = await listModels();
  if (list.ok) {
    console.log(`GET /models advertised ${list.ids.length} model id(s):`);
    console.log(list.ids.map((id) => `  ${id}`).join("\n") || "  (empty)");
    console.log("");
  } else {
    console.log(`GET /models not available (${list.status || list.error}); falling back to probing candidate ids.\n`);
  }

  const argModels = process.argv.slice(2);
  const envModels = (process.env.LLM_GROUNDING_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const candidates = argModels.length ? argModels
    : (list.ok && list.ids.length ? list.ids
      : Array.from(new Set([...envModels, ...DEFAULT_CANDIDATES])));

  console.log(`Probing ${candidates.length} model(s) via ${style}/${style === "responses" ? "responses" : "chat completions"}:\n`);
  const results = [];
  for (const m of candidates) {
    const r = await probe(m);
    results.push(r);
    if (r.ok) console.log(`  ✅ ${m.padEnd(34)} ${String(r.ms).padStart(6)}ms  tokens=${r.tokens}  "${r.sample}"`);
    else console.log(`  ❌ ${m.padEnd(34)} ${String(r.ms).padStart(6)}ms  [${r.status}] ${r.detail || ""}`);
  }

  const okIds = results.filter((r) => r.ok).map((r) => r.model);
  console.log(`\n=== ${okIds.length}/${results.length} responded ===`);
  if (okIds.length) {
    console.log(`\nWorking ids (paste into LLM_GROUNDING_MODELS):\n${okIds.join(",")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
