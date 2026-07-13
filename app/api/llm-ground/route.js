import { getLlmConfig } from "@/lib/config";
import { callLlmGateway } from "@/lib/llm";
import { elapsedMs, fail, ok, parseJson, normalizeUsage } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Optional LLM grounding fallback - the last tier of the pipeline.
//
// Provider-neutral: calls an OpenAI-compatible gateway via the shared client:
// chat/completions
// (universal) or the Responses API, per LLM_API_STYLE. It runs ONLY on the
// mentions the deterministic + search tiers left ambiguous, and may only choose
// from the SNOMED candidates those tiers already retrieved (or abstain). Output
// is constrained and guarded, so the model never invents a code. Off unless
// ENABLE_LLM_GROUNDING=true with LLM_BASE_URL + LLM_API_KEY set.

function buildPrompt(mentions, languageCode) {
  const lines = mentions.map((m) => {
    const cands = (m.candidates || [])
      .map((c) => `    - ${c.conceptId}: ${c.term}${c.semanticTag ? ` (${c.semanticTag})` : ""}`)
      .join("\n");
    const ctx = [m.assertion && `assertion=${m.assertion}`, m.subject && `subject=${m.subject}`, m.status && `status=${m.status}`]
      .filter(Boolean).join(", ");
    return `  ${m.mentionId} | "${m.phrase}"${ctx ? ` [${ctx}]` : ""} | sentence: "${m.sentence || ""}"\n  candidates:\n${cands || "    (none)"}`;
  });
  return [
    `You are a clinical coding assistant reviewing SNOMED CT candidates that a search engine already retrieved from a clinical note (language: ${languageCode || "en"}).`,
    `Do three things:`,
    `1. CONFIRM each mention: choose the single best conceptId FROM ITS candidate list (the meaning that matches the phrase in context). If no candidate fits, use "none". NEVER invent a conceptId that is not in the candidate list.`,
    `2. PICK THE PRIMARY DIAGNOSIS: among mentions that are present and about the patient (not negated, not family history), choose the one conceptId that is the principal/most clinically significant diagnosis. If none qualifies, use "none".`,
    `3. SUMMARIZE in 2-3 plain-language sentences what you confirmed, what you excluded and why (negation/family/uncertainty), and why you chose the primary diagnosis. Write it for a clinician, referring to concepts by their term.`,
    `Respond with ONLY this JSON object, no prose, no code fences:`,
    `{"summary":"...","primaryConceptId":"...","decisions":[{"mentionId":"...","conceptId":"...","confidence":0.0,"rationale":"one line"}]}`,
    ``,
    `Mentions:`,
    ...lines
  ].join("\n");
}

function parseResult(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const parsed = JSON.parse(t);
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    primaryConceptId: parsed.primaryConceptId ? String(parsed.primaryConceptId) : "none",
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : []
  };
}

export async function POST(request) {
  const startedAt = process.hrtime.bigint();
  const cfg = getLlmConfig();

  if (!cfg.enabled) {
    return fail("LLM grounding is disabled. Set ENABLE_LLM_GROUNDING=true to enable it.", 503, { code: "llm-disabled" });
  }
  if (!cfg.baseUrl || !cfg.apiKey) {
    return fail("LLM gateway not configured. Set LLM_BASE_URL (.../openai/v1) and LLM_API_KEY in .env.local, then restart the dev server.", 503, { code: "llm-not-configured" });
  }

  try {
    const body = await parseJson(request);
    const mentions = Array.isArray(body.mentions) ? body.mentions.slice(0, 25) : [];
    const languageCode = typeof body.languageCode === "string" ? body.languageCode : "en";
    if (mentions.length === 0) {
      return ok({ ok: true, pattern: "llm-ground", model: cfg.model, decisions: [], latencyMs: elapsedMs(startedAt) });
    }

    // Shared gateway client (chat/completions or responses per LLM_API_STYLE).
    const call = await callLlmGateway(cfg, buildPrompt(mentions, languageCode));
    if (!call.ok) {
      const status = call.status || 502;
      let friendly = `LLM gateway error (${status})`;
      if (status === 401 || status === 403) friendly = `Gateway rejected the key (${status}). Check LLM_API_KEY / LLM_AUTH_HEADER.`;
      else if (status === 404) friendly = `Gateway endpoint not found (404). Check LLM_BASE_URL / LLM_API_STYLE (tried ${call.style}).`;
      else if (status === 429) friendly = "Gateway rate limit hit (429). Try again shortly.";
      return fail(friendly, status, { detail: call.detail, endpoint: call.endpoint, latencyMs: elapsedMs(startedAt) });
    }
    const data = call.data;

    let result;
    try { result = parseResult(call.text); }
    catch (_e) { return fail("LLM returned unparseable output.", 502, { detail: (call.text || "").slice(0, 400) }); }

    // Guard against hallucinated ids: keep only choices within each mention's candidate set (or "none").
    const allowed = new Map(mentions.map((m) => [m.mentionId, new Set((m.candidates || []).map((c) => String(c.conceptId)))]));
    const decisions = result.decisions.filter((d) => {
      const set = allowed.get(d.mentionId);
      return set && (d.conceptId === "none" || set.has(String(d.conceptId)));
    });
    // Primary must be a real candidate id somewhere in the set (or "none").
    const allIds = new Set([].concat(...mentions.map((m) => (m.candidates || []).map((c) => String(c.conceptId)))));
    const primaryConceptId = result.primaryConceptId !== "none" && allIds.has(result.primaryConceptId) ? result.primaryConceptId : "none";

    return ok({
      ok: true,
      pattern: "llm-ground",
      model: cfg.model,
      summary: result.summary,
      primaryConceptId,
      decisions,
      usage: normalizeUsage(data?.usage),
      latencyMs: elapsedMs(startedAt)
    });
  } catch (error) {
    return fail("LLM grounding failed", 500, { message: error?.message || String(error), latencyMs: elapsedMs(startedAt) });
  }
}
