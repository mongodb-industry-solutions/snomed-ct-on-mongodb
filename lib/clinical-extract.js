import { getLlmConfig } from "@/lib/config";
import { callLlmGateway, parseLooseJson } from "@/lib/llm";
import { buildExtractionPrompt } from "@/lib/prompts";

// Stage-1 clinical extraction with an LLM. The LLM does what it is genuinely
// good at — finding clinical mentions and reading their context (negation,
// assertion, patient-vs-family, temporality) — and returns TEXT + CONTEXT only.
// It never returns SNOMED codes: MongoDB stays the retrieval engine and code
// authority (the extracted phrases are handed to MongoDB Search downstream).
//
// Returns { ok, model, mentions:[{phrase, verbatim, assertion, subject, temporality}] }
// or { ok:false, error } so the caller can fall back to deterministic extraction.

const VALID_ASSERTION = new Set(["present", "absent", "suspected", "planned"]);
const VALID_SUBJECT = new Set(["patient", "family"]);
const VALID_TEMPORALITY = new Set(["current", "historical"]);
const VALID_SECTION = new Set(["chief_complaint", "history", "active", "procedures", "medications", "family_history", "plan", "other"]);

export async function extractMentionsWithLlm({ text, languageCode, model }) {
  const baseCfg = getLlmConfig();
  if (!baseCfg.enabled) return { ok: false, error: "LLM grounding disabled" };
  // Allow a per-request model override, but only to a model the gateway lists.
  const cfg = model && baseCfg.models.includes(model) ? { ...baseCfg, model } : baseCfg;
  const note = String(text || "").trim();
  if (!note) return { ok: false, error: "empty note" };

  const prompt = buildExtractionPrompt(note, languageCode);
  const call = await callLlmGateway(cfg, prompt);
  // Opt-in I/O logging for prompt tuning: LLM_LOG_IO=true logs the exact prompt
  // sent and the raw text returned by the model (server console).
  if (process.env.LLM_LOG_IO === "true") {
    console.log(`\n[llm-extract] model=${cfg.model} lang=${languageCode || "en"} endpoint=${call.endpoint || ""}\n--- PROMPT ---\n${prompt}\n--- RAW RESPONSE ---\n${call.text || call.detail || "(empty)"}\n--- END ---\n`);
  }
  if (!call.ok) return { ok: false, error: call.error || `LLM HTTP ${call.status}` };

  let parsed;
  try {
    parsed = parseLooseJson(call.text);
  } catch (error) {
    return { ok: false, error: `LLM returned non-JSON: ${error?.message || "parse error"}` };
  }

  const raw = Array.isArray(parsed?.mentions) ? parsed.mentions : [];
  const seen = new Set();
  const mentions = [];
  for (const m of raw) {
    const phrase = String(m?.phrase || "").trim();
    if (!phrase) continue;
    const assertion = VALID_ASSERTION.has(m?.assertion) ? m.assertion : "present";
    const subject = VALID_SUBJECT.has(m?.subject) ? m.subject : "patient";
    // Dedupe by phrase + subject + assertion so a distinct occurrence of the
    // same term survives (e.g. the patient's diabetes AND a family-history
    // "mother with diabetes" are both kept, not collapsed to one).
    const key = `${phrase.toLowerCase()}|${subject}|${assertion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({
      phrase,
      verbatim: String(m?.verbatim || phrase).trim(),
      assertion,
      subject,
      temporality: VALID_TEMPORALITY.has(m?.temporality) ? m.temporality : "current",
      section: VALID_SECTION.has(m?.section) ? m.section : "other"
    });
  }

  if (mentions.length === 0) return { ok: false, error: "LLM extracted no mentions" };
  // prompt + raw are returned so the pipeline can surface the exact LLM I/O
  // (opt-in) for prompt-tuning transparency in the UI.
  return { ok: true, model: cfg.model, usage: call.data?.usage || null, mentions, prompt, raw: call.text || "" };
}

// Map an LLM mention's (assertion, subject, temporality) onto the internal
// { assertion, contextType, experiencer } triple the grounding pipeline uses —
// matching deriveContextFromSignals() so downstream scoring is identical.
export function llmMentionContext(m) {
  if (m.assertion === "absent") return { assertion: "absent", contextType: "negated", experiencer: "patient" };
  if (m.subject === "family") return { assertion: "family-history", contextType: "family-history", experiencer: "family" };
  if (m.assertion === "planned") return { assertion: "planned", contextType: "plan", experiencer: "patient" };
  if (m.assertion === "suspected") return { assertion: "suspected", contextType: "hypothetical", experiencer: "patient" };
  if (m.temporality === "historical") return { assertion: "historical", contextType: "history", experiencer: "patient" };
  return { assertion: "present", contextType: "current", experiencer: "patient" };
}
