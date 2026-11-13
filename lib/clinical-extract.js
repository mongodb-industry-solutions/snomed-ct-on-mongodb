import { getRuntimeLlmConfig, withLlmModel } from "./runtime-llm-config.js";
import { callLlmGateway, parseLooseJson } from "@/lib/llm";
import { buildExtractionPrompt } from "@/lib/prompts";
import { normalizeExtractedMentions } from "./clinical-mentions.js";
import { buildExtractionWindows } from "./extraction-windows.js";
export const EXTRACTION_POLICY_VERSION='source-windows-v1';

// Stage-1 clinical extraction with an LLM. The LLM does what it is genuinely
// good at — finding clinical mentions and reading their context (negation,
// assertion, patient-vs-family, temporality) — and returns TEXT + CONTEXT only.
// It never returns SNOMED codes: MongoDB stays the retrieval engine and code
// authority (the extracted phrases are handed to MongoDB Search downstream).
//
// Returns { ok, model, mentions:[{phrase, verbatim, assertion, subject, temporality}] }
// or { ok:false, error } so the caller can fall back to deterministic extraction.

export async function extractMentionsWithLlm({ text, languageCode, model }) {
  const baseCfg = await getRuntimeLlmConfig();
  if (!baseCfg.enabled) return { ok: false, error: "LLM grounding disabled" };
  // Allow a per-request model override, but only to a model the gateway lists.
  const cfg = withLlmModel(baseCfg, model);
  const note = String(text || "");
  if (!note.trim()) return { ok: false, error: "empty note" };

  const prompt = buildExtractionPrompt(note, languageCode);
  // Occurrence-level output needs more room than a short adjudication summary.
  const extractionTokens = Math.min(Math.max(Number(process.env.LLM_EXTRACTION_MAX_TOKENS) || 8192, 1024), 16384);
  const windows=buildExtractionWindows(note,Math.max(300,Math.min(3000,Number(process.env.LLM_EXTRACTION_WINDOW_CHARS)||500)));
  const calls=new Array(windows.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(2,windows.length)},async()=>{
    while(cursor<windows.length){
      const index=cursor++,window=windows[index];
      const focused=windows.length===1?prompt:`${prompt}\n\nExtract ONLY occurrences whose verbatim is inside this focus passage. Use the full note above for context (current/historical state, certainty, relatives and event linking), but do not emit occurrences from outside the focus passage. Preserve the complete exact sourceSentence.\nFocus passage (source offsets ${window.start} to ${window.end}):\n"""\n${window.text}\n"""`;
      const call=await callLlmGateway({...cfg,maxTokens:Math.max(cfg.maxTokens,extractionTokens)},focused);
      calls[index]={...call,window,prompt:focused};
    }
  }));
  const failed=calls.find(c=>!c.ok);
  if(failed)return {ok:false,error:failed.error||`LLM extraction HTTP ${failed.status}; incomplete source passages`};
  let rawMentions=[];
  try{for(const call of calls){const parsed=parseLooseJson(call.text);if(!Array.isArray(parsed?.mentions))throw new Error('Missing mentions array');rawMentions.push(...parsed.mentions.map(m=>({...m,sourceWindow:{start:call.window.start,end:call.window.end}})));}}
  catch(error){return {ok:false,error:`LLM returned incomplete/non-JSON passages: ${error.message}`};}
  const usage=calls.reduce((out,c)=>{for(const key of ['input_tokens','output_tokens','total_tokens'])out[key]=(out[key]||0)+(c.usage?.[key]||0);return out;},{});
  const call={ok:true,text:JSON.stringify({mentions:rawMentions}),usage};
  // Opt-in I/O logging for prompt tuning: LLM_LOG_IO=true logs the exact prompt
  // sent and the raw text returned by the model (server console).
  if (process.env.LLM_LOG_IO === "true") {
    console.log(`\n[llm-extract] model=${cfg.model} lang=${languageCode || "en"} endpoint=${call.endpoint || ""}\n--- PROMPT ---\n${prompt}\n--- RAW RESPONSE ---\n${call.text || call.detail || "(empty)"}\n--- END ---\n`);
  }
  if (!call.ok) return { ok: false, error: call.error || `LLM HTTP ${call.status}` };

  const mentions = normalizeExtractedMentions(rawMentions);

  if (mentions.length === 0) return { ok: false, error: "LLM extracted no mentions" };
  // prompt + raw are returned so the pipeline can surface the exact LLM I/O
  // (opt-in) for prompt-tuning transparency in the UI.
  return { ok: true, model: cfg.model, policyVersion:EXTRACTION_POLICY_VERSION,usage, mentions, prompt:calls.map(c=>c.prompt).join('\n\n--- next source passage ---\n\n'),raw:call.text,requests:calls.map(c=>({sourceWindow:c.window,prompt:c.prompt,raw:c.text,usage:c.usage})) };
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
