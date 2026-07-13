"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Badge from "@leafygreen-ui/badge";
const Code = dynamic(() => import("@leafygreen-ui/code"), { ssr: false });
import EvidenceFlow from "@/components/EvidenceFlow";
import PromptPanel from "@/components/PromptPanel";
import { EXAMPLE_GROUPS } from "@/lib/example-notes";

// Map our semantic states to LeafyGreen Badge variants.
function statusVariant(status) {
  if (status === "accepted") return "green";
  if (status === "abstain" || status === "timed-out") return "lightgray";
  return "yellow"; // review
}
function assertionVariant(assertion) {
  return assertion === "absent" ? "red" : "blue";
}

// Ground Clinical Note — a clean, staged flow (mirrors the Navigate tab):
//   Landing: pick an example note or paste one, then "Ground note".
//   Result (step tabs, one at a time):
//     1) Extraction — deterministic layer: candidate terms, cue spans
//        (negation/history/family/plan) and temporal expressions, highlighted
//        in the note. Works even if grounding is slow.
//     2) Grounding — the evidence graph (full-text + vector retrieval).
//     3) Concepts — resulting SNOMED codings + principal diagnosis + payoff.
//     4) API — the contextual /api/nlp-map call.

const INK = "#001E2B";
const GREEN = "#00684A";
const BORDER = "#e3e7ea";

// Selectable extraction models (set NEXT_PUBLIC_LLM_GROUNDING_MODELS to a
// comma-separated list the gateway serves). Defaults to a single model.
const LLM_MODELS = (process.env.NEXT_PUBLIC_LLM_GROUNDING_MODELS || "gpt-5.5")
  .split(",").map((s) => s.trim()).filter(Boolean);

const CUE_COLORS = {
  negation: "#DB3030",
  "family-history": "#8F4FBF",
  history: "#B8860B",
  plan: "#016BF8",
  certainty: "#00A35C",
  temporal: "#0EA5A5",
  relation: "#5C6C75"
};

// Deterministic temporal expressions (client-side regex demo layer).
const TEMPORAL_RE = /\b(hace\s+\w+\s+(?:año|años|mes|meses|semana|semanas|día|días)|(?:one|two|three|\d+)\s+(?:year|years|month|months|week|weeks|day|days)\s+ago|last\s+(?:year|month|week)|en\s+seguimiento|follow[-\s]?up|since\s+\d{4}|desde\s+\d{4}|\b\d{4}-\d{2}-\d{2}\b)\b/gi;

function statusColor(status) {
  if (status === "accepted") return GREEN;
  if (status === "abstain" || status === "timed-out") return "#889397";
  return "#B8860B"; // review
}

export default function GroundWorkbench({ defaultLanguageCode = "en", sessionModel, onSessionModelChange }) {
  const [text, setText] = useState("");
  const [languageCode, setLanguageCode] = useState(defaultLanguageCode || "en");
  const [state, setState] = useState({ loading: false, error: "" });
  const [response, setResponse] = useState(null);
  const [step, setStep] = useState("extraction");
  const [groundingView, setGroundingView] = useState("graph");
  // Retrieval (Stage 2) runs separately from extraction (Stage 1).
  const [retrieval, setRetrieval] = useState({ running: false, error: "" });
  // The extraction model is the session model (chosen in the header). Fall back
  // to local state only if this component is used without a session model.
  const [localModel, setLocalModel] = useState(LLM_MODELS[0]);
  const groundingModel = sessionModel || localModel;
  const setGroundingModel = onSessionModelChange || setLocalModel;
  const [llm, setLlm] = useState({ loading: false, error: "", byMention: {}, model: "", summary: "", primaryConceptId: "none" });
  const [save, setSave] = useState({ loading: false, error: "", result: null });

  const runSave = async (codings) => {
    if (!codings || codings.length === 0) {
      setSave({ loading: false, error: "No concepts accepted to save.", result: null });
      return;
    }
    setSave({ loading: true, error: "", result: null });
    try {
      const res = await fetch("/api/coding-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: response?._text || "", languageCode, codings })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setSave({ loading: false, error: "", result: data });
    } catch (error) {
      setSave({ loading: false, error: error?.message || "Save failed", result: null });
    }
  };

  const runLlmAssist = async (resp) => {
    const results = Array.isArray(resp?.results) ? resp.results : [];
    // Send every grounded mention (candidates + context) so the LLM can confirm,
    // sort, and pick the primary diagnosis across the whole note.
    const mentions = results
      .filter((r) => r.mentionId && (r.topCandidate || (r.alternatives || []).length))
      .map((r) => ({
        mentionId: r.mentionId,
        phrase: r.span?.text || r.phrase,
        sentence: r.sentence || "",
        assertion: r.assertion,
        subject: r.experiencer || "patient",
        status: r.status,
        candidates: [r.topCandidate, ...(r.alternatives || [])].filter(Boolean).map((c) => ({
          conceptId: c.conceptId, term: c.term, semanticTag: c.semanticTag
        }))
      }));
    const empty = { loading: false, error: "", byMention: {}, model: "", summary: "", primaryConceptId: "none" };
    if (mentions.length === 0) {
      setLlm({ ...empty, error: "No grounded mentions to review." });
      return;
    }
    setStep("concepts");
    setLlm({ ...empty, loading: true });
    try {
      const res = await fetch("/api/llm-ground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mentions, languageCode })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      const byMention = {};
      for (const d of data.decisions || []) byMention[d.mentionId] = d;
      setLlm({ loading: false, error: "", byMention, model: data.model || "", summary: data.summary || "", primaryConceptId: data.primaryConceptId || "none" });
    } catch (error) {
      setLlm({ ...empty, error: error?.message || "LLM assist failed" });
    }
  };

  // Stage 1 — LLM extraction only (fast). Lands on the Extraction step; the
  // MongoDB retrieval is a separate, explicit step (runRetrieval).
  const runGrounding = async (noteText, lang) => {
    const body = String(noteText ?? text).trim();
    if (!body) return;
    setState({ loading: true, error: "" });
    setResponse(null);
    setRetrieval({ running: false, error: "" });
    setStep("extraction");
    try {
      const res = await fetch("/api/nlp-map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body, languageCode: lang || languageCode, model: groundingModel, extractOnly: true })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setResponse({ ...data, _text: body, retrieved: false });
      setState({ loading: false, error: "" });
    } catch (error) {
      setState({ loading: false, error: error?.message || "Extraction failed" });
    }
  };

  // Stage 2 — retrieve SNOMED candidates from MongoDB for the extracted mentions.
  const runRetrieval = async () => {
    if (!response || retrieval.running) return;
    const mentions = Array.isArray(response.mentions) ? response.mentions : [];
    const body = response._text || "";
    if (!mentions.length) { setRetrieval({ running: false, error: "No mentions to retrieve." }); return; }
    setRetrieval({ running: true, error: "" });
    try {
      const res = await fetch("/api/nlp-map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body, languageCode, groundMentions: mentions, searchTimeoutMs: 12000 })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setResponse((prev) => ({ ...prev, ...data, _text: body, retrieved: true }));
      setRetrieval({ running: false, error: "" });
      setStep("grounding");
    } catch (error) {
      setRetrieval({ running: false, error: error?.message || "Retrieval failed" });
    }
  };

  const loadExample = (note) => {
    // Load the example into the editor only — the user triggers grounding manually.
    setText(note.text);
    setLanguageCode(note.languageCode);
  };

  // ---------- LANDING ----------
  if (!response) {
    return (
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 16px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: GREEN, marginBottom: 4 }}>Applied example</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: INK, marginBottom: 6 }}>Ground a clinical note</div>
        <div style={{ ...sub, marginBottom: 18 }}>
          An applied example of the terminology service. An <strong>LLM reads the note</strong> for clinical mentions,
          negation and context (Stage 1); <strong>MongoDB retrieves the SNOMED candidates</strong> for each mention with
          MongoDB Search (Stage 2 — the code authority); a reviewer confirms before anything is stored (Stage 3). The LLM
          never invents codes, and it falls back to deterministic extraction when no gateway is configured.
        </div>

        <PipelineRail extractor="llm" extractorModel={groundingModel} />

        <PromptPanel note={text} languageCode={languageCode} />

        <div style={{ marginBottom: 12 }}>
          {EXAMPLE_GROUPS.map((g) => (
            <div key={g.group} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#889397", marginBottom: 6 }}>{g.group}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {g.notes.map((n) => (
                  <button key={n.id} type="button" style={chip} onClick={() => loadExample(n)}
                    title={n.recommendedPrimary ? `Main documented problem: ${n.recommendedPrimary}` : ""}>
                    {n.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a clinical note or a full report (discharge summary, multi-section report)…"
          rows={12}
          style={{ width: "100%", padding: 14, fontSize: 14, border: `1px solid ${BORDER}`, borderRadius: 10, color: INK, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <select value={languageCode} onChange={(e) => setLanguageCode(e.target.value)}
            style={{ padding: "8px 10px", border: `1px solid ${BORDER}`, borderRadius: 10, color: INK }}>
            <option value="en">EN</option>
            <option value="es">ES</option>
          </select>
          {/* Model is chosen once in the header "Session model" selector. */}
          <button type="button" style={{ ...primaryBtn, padding: "10px 22px" }}
            disabled={state.loading || !text.trim()} onClick={() => runGrounding()}>
            {state.loading ? "Grounding…" : "Ground note"}
          </button>
          {state.error ? <span style={{ color: "#DB3030", fontSize: 13 }}>{state.error}</span> : null}
        </div>
      </div>
    );
  }

  // ---------- RESULT ----------
  const results = Array.isArray(response.results) ? response.results : [];
  const graph = response.evidenceGraph || null;
  const principal = response.principalDiagnosis || null;
  const noteText = response._text || "";
  const retrieved = response.retrieved === true;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13 }}>
        <button type="button" style={crumbLink} onClick={() => { setResponse(null); setState({ loading: false, error: "" }); }}>Notes</button>
        <span style={{ color: "#889397" }}>›</span>
        <span style={{ color: INK, fontWeight: 700 }}>Grounded note</span>
        {response.degraded ? <span style={{ marginLeft: 8 }}><Badge variant="yellow">partial (search slow)</Badge></span> : null}
        {llm.model ? <span style={{ marginLeft: 8 }}><Badge variant="blue">LLM assist · {llm.model}</Badge></span> : null}
        <button type="button" style={{ ...llmBtn, marginLeft: "auto" }}
          onClick={() => runLlmAssist(response)} disabled={llm.loading}
          title="Disambiguate low-confidence mentions with the configured LLM (optional, candidate-constrained)">
          {llm.loading ? "✦ LLM assisting…" : "✦ LLM assist"}
        </button>
        <button type="button" style={ghostBtn} onClick={() => runGrounding(noteText, languageCode)}>Re-run</button>
      </div>
      {llm.error ? (
        <div style={{ ...errBox, marginBottom: 12 }}>
          <strong>LLM assist unavailable.</strong> {llm.error}
        </div>
      ) : null}
      {!llm.model && !llm.error && !llm.loading ? (
        <p style={{ ...sub, marginBottom: 12 }}>
          ✦ Optional: use <strong>LLM assist</strong> (candidate-constrained) to disambiguate the mentions the search tier left as “review”.
        </p>
      ) : null}


      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { key: "extraction", label: "1 · Extraction" },
          { key: "grounding", label: "2 · Grounding" },
          { key: "concepts", label: `3 · Concepts (${results.filter((r) => r.topCandidate).length})` },
          { key: "api", label: "API" }
        ].map((t) => (
          <button key={t.key} type="button" onClick={() => setStep(t.key)} style={step === t.key ? chipActive : chip}>{t.label}</button>
        ))}
      </div>

      {/* Stage 2 trigger — retrieval is separate from extraction. */}
      {!retrieved ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1px solid #8F4FBF", borderRadius: 10, background: "#FBF9FE", marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ ...sub, margin: 0 }}>
            <strong style={{ color: INK }}>Stage 1 done</strong> — {(response.mentions || []).length} mention{(response.mentions || []).length === 1 ? "" : "s"} extracted by the LLM. Stage 2 retrieves the SNOMED candidates from MongoDB Search / Vector Search.
          </span>
          <button type="button" style={{ ...primaryBtn, marginLeft: "auto", padding: "8px 18px" }} disabled={retrieval.running} onClick={runRetrieval}>
            {retrieval.running ? "Retrieving from MongoDB…" : "Retrieve SNOMED candidates"}
          </button>
          {retrieval.running ? <span style={{ width: "100%", ...sub, marginTop: 4 }}>Running MongoDB Search / Vector Search queries for {(response.mentions || []).length} mentions…</span> : null}
          {retrieval.error ? <span style={{ color: "#DB3030", fontSize: 12, width: "100%" }}>{retrieval.error}</span> : null}
        </div>
      ) : null}

      {step === "extraction" ? (
        <>
          <PromptPanel note={noteText} languageCode={languageCode} />
          <ExtractionView noteText={noteText} results={results} graph={graph} />
        </>
      ) : null}
      {step === "grounding" ? (
        !retrieved ? (
          <p style={sub}>Run <strong>Retrieve SNOMED candidates</strong> above to populate grounding.</p>
        ) : (
        <>
          <div style={{ display: "inline-flex", border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
            {[["graph", "Graph"], ["grouped", "Grouped"]].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setGroundingView(k)}
                style={{ padding: "6px 14px", fontSize: 13, border: "none", cursor: "pointer",
                  background: groundingView === k ? GREEN : "#fff", color: groundingView === k ? "#fff" : INK, fontWeight: groundingView === k ? 700 : 500 }}>
                {label}
              </button>
            ))}
          </div>
          {groundingView === "grouped" ? (
            <GroupedGrounding results={results} />
          ) : graph ? (
            <EvidenceFlow graph={graph} reviewRows={[]} selectedSpanId="" onSelectSpan={() => {}} />
          ) : <p style={sub}>No evidence graph.</p>}
          <MqlPanel mql={response.mql} />
        </>
        )
      ) : null}
      {step === "concepts" ? (
        !retrieved ? (
          <p style={sub}>Run <strong>Retrieve SNOMED candidates</strong> above to populate concepts.</p>
        ) : (
        <>
          <SampleScopeNotice />
          <ConceptsView results={results} principal={principal} llm={llm} onSave={runSave} saveState={save} languageCode={languageCode} />
          <GoldRecordPanel results={results} noteText={noteText} languageCode={languageCode} />
        </>
        )
      ) : null}
      {step === "api" ? (
        <ApiBlock body={{ text: noteText.slice(0, 60) + "…", languageCode, searchTimeoutMs: 12000 }} />
      ) : null}
    </div>
  );
}

// ---- Step 1: deterministic extraction highlighting ----
function ExtractionView({ noteText, results, graph }) {
  const highlights = useMemo(() => {
    const hs = [];
    for (const r of results) {
      const s = Number(r?.span?.start), e = Number(r?.span?.end);
      if (Number.isFinite(s) && Number.isFinite(e)) hs.push({ start: s, end: e, kind: "term", assertion: r.assertion, status: r.status });
    }
    for (const cue of graph?.cueObjects || []) {
      if (cue?.cueType === "relation") continue; // skip linguistic connectors ("with"/"con")
      const s = Number(cue?.span?.start), e = Number(cue?.span?.end);
      if (Number.isFinite(s) && Number.isFinite(e)) hs.push({ start: s, end: e, kind: "cue", cueType: cue.cueType });
    }
    for (const m of noteText.matchAll(TEMPORAL_RE)) {
      hs.push({ start: m.index, end: m.index + m[0].length, kind: "cue", cueType: "temporal" });
    }
    // Mark repeated occurrences of an already-extracted concept, so a concept
    // that reappears (e.g. "breast cancer" restated in the assessment) is shown
    // as a repeat rather than looking un-analyzed.
    const termSpans = hs.filter((h) => h.kind === "term");
    const seenPhrases = new Set();
    for (const r of results) {
      const phrase = String(r?.phrase || "").trim();
      if (phrase.length < 4) continue;
      const key = phrase.toLowerCase();
      if (seenPhrases.has(key)) continue;
      seenPhrases.add(key);
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      for (const m of noteText.matchAll(re)) {
        const s = m.index, e = m.index + m[0].length;
        const overlaps = termSpans.some((t) => s < t.end && e > t.start);
        if (!overlaps) hs.push({ start: s, end: e, kind: "repeat" });
      }
    }
    return hs.sort((a, b) => a.start - b.start);
  }, [noteText, results, graph]);

  // Render text with non-overlapping highlights (first wins).
  const segments = [];
  let cursor = 0;
  for (const h of highlights) {
    if (h.start < cursor) continue;
    if (h.start > cursor) segments.push({ text: noteText.slice(cursor, h.start) });
    segments.push({ text: noteText.slice(h.start, h.end), h });
    cursor = h.end;
  }
  if (cursor < noteText.length) segments.push({ text: noteText.slice(cursor) });

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, fontSize: 12 }}>
        <LegendDot color={GREEN} label="clinical term" solid />
        <LegendDot color={CUE_COLORS.negation} label="negation" />
        <LegendDot color={CUE_COLORS.history} label="history" />
        <LegendDot color={CUE_COLORS["family-history"]} label="family" />
        <LegendDot color={CUE_COLORS.plan} label="plan" />
        <LegendDot color={CUE_COLORS.temporal} label="temporal" />
        <LegendDot color="#889397" label="repeated" />
      </div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, background: "#fff", fontSize: 15, lineHeight: 2, whiteSpace: "pre-wrap", color: INK }}>
        {segments.map((seg, i) => {
          if (!seg.h) return <span key={i}>{seg.text}</span>;
          if (seg.h.kind === "term") {
            const c = seg.h.assertion === "absent" ? CUE_COLORS.negation : GREEN;
            return <span key={i} title={`${seg.h.status || ""} · ${seg.h.assertion || ""}`}
              style={{ background: `${c}18`, borderBottom: `2px solid ${c}`, borderRadius: 3, padding: "1px 2px" }}>{seg.text}</span>;
          }
          if (seg.h.kind === "repeat") {
            return <span key={i} title="repeated mention (already extracted above)"
              style={{ borderBottom: "2px dotted #889397", borderRadius: 3, padding: "1px 2px", color: "#5C6C75" }}>{seg.text}</span>;
          }
          const c = CUE_COLORS[seg.h.cueType] || CUE_COLORS.relation;
          return <span key={i} title={seg.h.cueType}
            style={{ background: `${c}14`, border: `1px dashed ${c}`, borderRadius: 4, padding: "0 3px", fontSize: 13 }}>{seg.text}</span>;
        })}
      </div>
      <p style={{ ...sub, marginTop: 10 }}>
        Highlights mark each extracted clinical mention and its context (negation, history, family, plan). A concept
        stated more than once is extracted once and its later mentions are shown as <em>repeated</em>. Un-highlighted
        text is non-clinical or out of scope for the sample dataset.
      </p>
    </div>
  );
}

// ---- Sample-scope notice: this demo runs on a scoped subset of SNOMED CT ----
function SampleScopeNotice() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid #E9E2C8", background: "#FBF7E9", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "#5C4F26" }}>
        <strong>Sample dataset.</strong> This demo runs on a small, scoped subset of SNOMED CT — not the full release.
        Some mentions may map to an approximate concept or to none (common procedures, medications, and symptoms are
        sparsely represented here). A full licensed SNOMED CT release would ground every concept precisely; the
        pipeline is unchanged.
      </p>
    </div>
  );
}

// ---- Pipeline provenance rail: makes the three stages + who did extraction explicit ----
function PipelineRail({ extractor, extractorModel }) {
  const VIOLET = "#8F4FBF";
  const isLlm = extractor === "llm";
  const stageBox = { flex: 1, minWidth: 150, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px", background: "#fff" };
  const stageNum = { fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#889397" };
  const stageTitle = { fontSize: 13, fontWeight: 700, color: INK, margin: "3px 0 2px" };
  const stageSub = { fontSize: 11.5, color: "#5C6C75" };
  const arrow = { color: "#B4C0C7", fontWeight: 700, alignSelf: "center" };
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
      <div style={{ ...stageBox, borderColor: isLlm ? VIOLET : BORDER, background: isLlm ? "#FAF5FE" : "#fff" }}>
        <div style={stageNum}>1 · Extraction</div>
        <div style={stageTitle}>{isLlm ? `✦ LLM · ${extractorModel || "model"}` : "Deterministic rules"}</div>
        <div style={stageSub}>
          {isLlm
            ? "Reads mentions, negation & context"
            : "Rule-based spans, negation & context"}
        </div>
      </div>
      <span style={arrow}>›</span>
      <div style={{ ...stageBox, borderColor: GREEN, background: "#F1FAF5" }}>
        <div style={stageNum}>2 · Grounding</div>
        <div style={stageTitle}>MongoDB Search</div>
        <div style={stageSub}>Retrieves SNOMED candidates + evidence — the code authority</div>
      </div>
      <span style={arrow}>›</span>
      <div style={stageBox}>
        <div style={stageNum}>3 · Concepts</div>
        <div style={stageTitle}>Review &amp; output</div>
        <div style={stageSub}>Confirm codings, then use them (see outputs below)</div>
      </div>
    </div>
  );
}

// ---- Grouped grounding: the same mentions arranged by clinical category ----
function GroupedGrounding({ results }) {
  const groups = { diagnoses: [], procedures: [], medications: [], history: [], family: [], negated: [] };
  const seen = new Set();
  for (const r of Array.isArray(results) ? results : []) {
    const tc = r.topCandidate;
    if (!tc) continue;
    const tag = String(tc.semanticTag || "").toLowerCase();
    let b;
    if (r.assertion === "absent") b = "negated";
    else if ((r.experiencer || "patient") === "family" || r.assertion === "family-history") b = "family";
    else if (PROCEDURE_TAGS.includes(tag)) b = "procedures";
    else if (PRODUCT_TAGS.includes(tag)) b = "medications";
    else if (r.assertion === "historical" || r.llmSection === "history") b = "history";
    else b = "diagnoses";
    const key = `${b}:${tc.conceptId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups[b].push({ term: tc.term, conceptId: tc.conceptId, phrase: r.span?.text || r.phrase });
  }
  const cols = [
    { key: "diagnoses", label: "Diagnoses", color: GREEN },
    { key: "procedures", label: "Procedures", color: "#016BF8" },
    { key: "medications", label: "Medications", color: "#00857B" },
    { key: "history", label: "History", color: CUE_COLORS.history },
    { key: "family", label: "Family history", color: CUE_COLORS["family-history"] },
    { key: "negated", label: "Negated / ruled out", color: CUE_COLORS.negation }
  ].filter((c) => groups[c.key].length > 0);
  if (cols.length === 0) return <p style={sub}>No grounded mentions.</p>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "start" }}>
      {cols.map((c) => (
        <div key={c.key} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ background: `${c.color}12`, borderBottom: `2px solid ${c.color}`, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: c.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>{c.label}</span>
            <span style={{ fontSize: 11, color: "#889397" }}>{groups[c.key].length}</span>
          </div>
          <div style={{ display: "grid", gap: 8, padding: 10 }}>
            {groups[c.key].map((m, i) => (
              <div key={i}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{m.term}</div>
                <div style={{ fontSize: 11, color: "#889397" }}>#{m.conceptId} · “{m.phrase}”</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Coder worklist: codings grouped by clinical ROLE, with one principal ----
function WorklistRow({ m, chosen, chooseConcept, isPrincipal, leading, trailing }) {
  const [open, setOpen] = useState(false);
  const c = m.candidates.find((x) => String(x.conceptId) === String(chosen)) || m.candidates[0];
  const hasAlts = m.candidates.length > 1;
  if (!c) return null;
  return (
    <div style={{ borderTop: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px" }}>
        {leading}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ color: INK, fontSize: 13.5 }}>{c.term}</strong>
            {isPrincipal ? <Badge variant="green">★ principal</Badge> : null}
            {m.llmPicked ? <Badge variant="blue">AI-picked</Badge> : null}
            {c.matchReason ? <Badge variant="lightgray">{c.matchReason}</Badge> : null}
          </div>
          <div style={{ fontSize: 11, color: "#5C6C75", marginTop: 2 }}>
            {c.semanticTag ? `${c.semanticTag} · ` : ""}#{c.conceptId}
            {m.phrase ? <span style={{ color: "#889397" }}> · from “{m.phrase}”</span> : null}
            {c.matchedBy ? <span style={{ color: "#889397" }}> · {c.matchedBy}</span> : null}
            {m.confidencePct > 0 ? <span style={{ color: "#889397" }}> · {m.confidencePct}% conf.</span> : null}
          </div>
          {m.rationale ? <div style={{ fontSize: 11, color: "#889397", marginTop: 3, fontStyle: "italic" }}>{m.rationale}</div> : null}
          {hasAlts ? (
            <button type="button" onClick={() => setOpen((v) => !v)}
              style={{ marginTop: 5, fontSize: 11, fontWeight: 700, color: "#016BF8", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              {open ? "▾ hide candidates" : `▸ change concept — ${m.candidates.length} candidates from MongoDB`}
            </button>
          ) : null}
          {open ? (
            <div style={{ marginTop: 6, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden" }}>
              {m.candidates.map((cand, idx) => {
                const on = String(cand.conceptId) === String(chosen);
                return (
                  <button key={cand.conceptId} type="button" onClick={() => chooseConcept(cand.conceptId)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none",
                      borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`, cursor: "pointer", background: on ? "#E3FCEC" : "#fff" }}>
                    <div style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: INK }}>{on ? "✓ " : ""}{cand.term}</div>
                    <div style={{ fontSize: 10.5, color: "#889397" }}>
                      {cand.semanticTag ? `${cand.semanticTag} · ` : ""}#{cand.conceptId}
                      {cand.matchReason ? ` · ${cand.matchReason}` : ""}
                      {cand.matchedBy ? ` · ${cand.matchedBy}` : ""}
                      {Number.isFinite(cand.score) && cand.score ? ` · score ${Math.round(cand.score)}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {trailing}
      </div>
    </div>
  );
}

function ReviewWorklist({ mentions, roleOf, chosen, chooseConcept, accepted, toggle, principalKey, setPrincipal, excludeReason, addConcept, languageCode }) {
  const byRole = (role) => mentions.filter((m) => roleOf(m) === role);
  const diagnoses = byRole("diagnosis");
  const procedures = byRole("procedure");
  const medications = byRole("medication");
  const family = byRole("family-history");
  const context = mentions.filter((m) => ["ruled-out", "planned"].includes(roleOf(m)));
  const principal = diagnoses.find((m) => m.key === principalKey) || null;
  const secondary = diagnoses.filter((m) => m.key !== principalKey);

  const checkbox = (key, on) => (
    <button type="button" onClick={() => toggle(key)} aria-pressed={on} title={on ? "Included — click to exclude" : "Click to include"}
      style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 5, cursor: "pointer", marginTop: 1,
        border: `1.5px solid ${on ? GREEN : "#B4C0C7"}`, background: on ? GREEN : "#fff", color: "#fff",
        fontSize: 13, lineHeight: "16px", fontWeight: 800 }}>{on ? "✓" : ""}</button>
  );
  const makePrincipalBtn = (key) => (
    <button type="button" onClick={() => setPrincipal(key)} title="Set as principal diagnosis"
      style={{ flexShrink: 0, alignSelf: "center", fontSize: 11, fontWeight: 700, color: GREEN, background: "#fff", border: `1px solid ${GREEN}`, borderRadius: 7, padding: "4px 10px", cursor: "pointer" }}>
      Set principal
    </button>
  );
  const row = (m, leading, trailing) => (
    <WorklistRow key={m.key} m={m} chosen={chosen[m.key]} chooseConcept={(id) => chooseConcept(m.key, id)}
      isPrincipal={m.key === principalKey} leading={leading} trailing={trailing} />
  );
  const sectionHead = (label, n, color, hint) => (
    <div style={{ margin: "16px 0 6px" }}>
      <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color }}>{label}</span>
      {typeof n === "number" ? <span style={{ fontSize: 11, color: "#889397", marginLeft: 8 }}>{n}</span> : null}
      {hint ? <span style={{ fontSize: 11, color: "#889397", marginLeft: 8 }}>· {hint}</span> : null}
    </div>
  );
  const box = (children, bg = "#fff") => <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: bg }}>{children}</div>;

  return (
    <div>
      <p style={{ ...sub, margin: "0 0 4px" }}>
        A coder assigns <strong>one principal diagnosis</strong> plus the other problems (comorbidities), procedures,
        and medications. Choose the principal, tick everything to include, then <strong>Confirm &amp; save</strong>.
        Family history and ruled-out findings are context, not patient diagnoses.
      </p>

      {sectionHead("Principal diagnosis", null, GREEN, "the main reason for the encounter")}
      {box(
        principal
          ? row(principal, checkbox(principal.key, accepted[principal.key] !== false))
          : <p style={{ ...sub, padding: "10px 12px", margin: 0 }}>No principal chosen — use “Set principal” on a diagnosis below.</p>,
        "#F6FFF9"
      )}

      {secondary.length > 0 ? (
        <>
          {sectionHead("Other diagnoses (comorbidities)", secondary.length, INK)}
          {box(secondary.map((m) => row(m, checkbox(m.key, !!accepted[m.key]), makePrincipalBtn(m.key))))}
        </>
      ) : null}

      {procedures.length > 0 ? (
        <>
          {sectionHead("Procedures", procedures.length, "#016BF8")}
          {box(procedures.map((m) => row(m, checkbox(m.key, !!accepted[m.key]))))}
        </>
      ) : null}

      {medications.length > 0 ? (
        <>
          {sectionHead("Medications", medications.length, "#00857B")}
          {box(medications.map((m) => row(m, checkbox(m.key, !!accepted[m.key]))))}
        </>
      ) : null}

      {family.length > 0 ? (
        <>
          {sectionHead("Family history", family.length, CUE_COLORS["family-history"], "context — coded as family history if included")}
          {box(family.map((m) => row(m, checkbox(m.key, !!accepted[m.key]))), "#FAFBFB")}
        </>
      ) : null}

      {context.length > 0 ? (
        <>
          {sectionHead("Ruled out / planned", context.length, "#889397", "context — not coded")}
          {box(context.map((m) => row(m,
            <span style={{ flexShrink: 0, marginTop: 2 }}><Badge variant="lightgray">{excludeReason[roleOf(m)] || "context"}</Badge></span>
          )), "#FAFBFB")}
        </>
      ) : null}

      {addConcept ? <AddConceptSearch onAdd={addConcept} languageCode={languageCode} /> : null}
    </div>
  );
}

// P0.5 — search-to-code. When the pipeline missed a mention or grounded it
// wrongly, the coder searches the terminology directly (MongoDB Search over
// snomed-term-search) and adds the right concept to the worklist by hand.
function AddConceptSearch({ onAdd, languageCode = "en" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [state, setState] = useState({ loading: false, error: "", results: [] });

  const search = async () => {
    const query = q.trim();
    if (!query) return;
    setState({ loading: true, error: "", results: [] });
    try {
      const res = await fetch("/api/navigator-search", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, languageCode, mode: "hybrid", limit: 6 })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setState({ loading: false, error: "", results: Array.isArray(data.results) ? data.results : [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || "Search failed", results: [] });
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: "#016BF8", background: "none", border: `1px dashed ${BORDER}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>
        + Add a concept the pipeline missed — search the terminology
      </button>
    );
  }
  return (
    <div style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12, background: "#FAFBFB" }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "#5C6C75", marginBottom: 6 }}>
        Search-to-code · add a missed or mis-grounded concept
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          placeholder="e.g. atrial fibrillation" autoFocus
          style={{ flex: 1, minWidth: 200, padding: "8px 10px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 8 }} />
        <button type="button" onClick={search} disabled={state.loading || !q.trim()} style={{ ...primaryBtn, padding: "8px 16px", opacity: state.loading || !q.trim() ? 0.6 : 1 }}>
          {state.loading ? "Searching…" : "Search"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ ...ghostBtn, padding: "8px 12px" }}>Close</button>
      </div>
      {state.error ? <p style={{ color: "#DB3030", fontSize: 12, marginTop: 8 }}>{state.error}</p> : null}
      {state.results.length ? (
        <div style={{ marginTop: 10, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
          {state.results.map((c, idx) => (
            <div key={c.conceptId} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderTop: idx === 0 ? "none" : `1px solid ${BORDER}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{c.preferredTerm || c.term}</div>
                <div style={{ fontSize: 11, color: "#889397" }}>{c.semanticTag ? `${c.semanticTag} · ` : ""}#{c.conceptId}{c.term && c.preferredTerm && c.term !== c.preferredTerm ? ` · matched “${c.term}”` : ""}</div>
              </div>
              <button type="button" onClick={() => { onAdd(c, q.trim()); }}
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: GREEN, background: "#fff", border: `1px solid ${GREEN}`, borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>
                Add
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <p style={{ ...sub, margin: "8px 0 0", fontSize: 11 }}>MongoDB Search over the terminology — the same retrieval that powers Navigate.</p>
    </div>
  );
}

// ---- Step 3: grounded concepts ----
// The exact MongoDB aggregation pipelines retrieval ran, per mention — so the
// query layer is transparent, not a black box behind "grounding".
function MqlPanel({ mql }) {
  const [open, setOpen] = useState(false);
  const items = Array.isArray(mql) ? mql : [];
  if (!items.length) return null;
  return (
    <details open={open} onToggle={(e) => setOpen(e.target.open)} style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fbfdfc", padding: "10px 14px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: INK, fontSize: 13 }}>
        MongoDB queries (MQL) — {items.length} pipeline{items.length === 1 ? "" : "s"} run by retrieval
      </summary>
      <p style={{ ...sub, margin: "8px 0" }}>The aggregation pipeline MongoDB ran to ground each mention (MongoDB Search over the term sidecar).</p>
      {items.map((q, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 2 }}>“{q.phrase}”</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, lineHeight: 1.45, color: INK, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", maxHeight: 220, overflow: "auto" }}>{JSON.stringify(q.pipeline, null, 2)}</pre>
        </div>
      ))}
    </details>
  );
}

// Turn the current grounding into a gold-note fixture (evidence graph → facts),
// shown as ready-to-paste JSON for lib/gold-notes.js. This closes the loop:
// author the benchmark's ground truth from real, human-reviewed groundings.
function GoldRecordPanel({ results, noteText, languageCode = "en" }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("gold-custom");
  const [title, setTitle] = useState("Custom note");
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState({ loading: false, ok: false, error: "" });

  const mentions = (Array.isArray(results) ? results : []).filter((r) => r.verbatim || r.span?.text || r.phrase);
  const facts = mentions.map((r) => {
    const assertion = r.assertion || "present";
    const subject = r.experiencer || "patient";
    const fact = {
      phrase: r.verbatim || r.span?.text || r.phrase,
      assertion,
      subject,
      section: r.llmSection || "other"
    };
    // Only present-patient facts carry an expected conceptId (retrieval axis).
    if (r.topCandidate && assertion === "present" && subject === "patient") {
      fact.conceptId = String(r.topCandidate.conceptId);
      fact.term = r.topCandidate.term;
    }
    return fact;
  });
  const entry = { id: id.trim() || "gold-custom", title: title.trim() || "Custom note", languageCode: languageCode || "en", text: noteText || "", facts };
  const json = JSON.stringify(entry, null, 2);
  const copy = () => {
    try { navigator.clipboard?.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (_e) { /* clipboard unavailable */ }
  };
  const saveToDb = async () => {
    setSaveState({ loading: true, ok: false, error: "" });
    try {
      const res = await fetch("/api/gold-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entry }) });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setSaveState({ loading: false, ok: true, error: "" });
      setTimeout(() => setSaveState((s) => ({ ...s, ok: false })), 2500);
    } catch (e) {
      setSaveState({ loading: false, ok: false, error: e?.message || "Save failed" });
    }
  };

  const input = { padding: "6px 9px", fontSize: 12.5, border: `1px solid ${BORDER}`, borderRadius: 8, color: INK };
  return (
    <details open={open} onToggle={(e) => setOpen(e.target.open)} style={{ marginTop: 18, border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fbfdfc", padding: "10px 14px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: INK, fontSize: 13 }}>
        Gold record (JSON) — freeze this grounding as a benchmark fixture
      </summary>
      <p style={{ ...sub, margin: "8px 0" }}>
        The <strong>evidence graph</strong> below becomes a gold note: expected facts (mention · assertion · subject ·
        section) plus the concept present‑patient findings should resolve to. <strong>Review and correct it</strong> —
        a gold record is the human‑trusted expected output — then paste the entry into <code>lib/gold-notes.js</code>.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "end" }}>
        <label style={{ fontSize: 11, color: "#5C6C75", display: "grid", gap: 3 }}>id<input value={id} onChange={(e) => setId(e.target.value)} style={input} /></label>
        <label style={{ fontSize: 11, color: "#5C6C75", display: "grid", gap: 3 }}>title<input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...input, minWidth: 220 }} /></label>
        <button type="button" onClick={saveToDb} disabled={saveState.loading} style={{ ...primaryBtn, padding: "7px 14px", opacity: saveState.loading ? 0.6 : 1 }}>
          {saveState.loading ? "Saving…" : saveState.ok ? "Saved ✓" : "Save to database"}
        </button>
        <button type="button" onClick={copy} style={{ ...ghostBtn, padding: "6px 14px" }}>{copied ? "Copied ✓" : "Copy JSON"}</button>
      </div>
      {saveState.error ? <p style={{ color: "#DB3030", fontSize: 12, margin: "0 0 8px" }}>{saveState.error}</p> : null}
      {saveState.ok ? <p style={{ color: "#00684A", fontSize: 12, margin: "0 0 8px" }}>Added to the benchmark gold set — it now appears in the Benchmark note picker.</p> : null}
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11.5, lineHeight: 1.5, color: INK, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 14px", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", maxHeight: 340, overflow: "auto" }}>{json}</pre>
    </details>
  );
}

function ConceptsView({ results, principal, llm = {}, onSave, saveState = {}, languageCode = "en" }) {
  const grounded = results.filter((r) => r.topCandidate);
  const llmByMention = llm.byMention || {};
  const VIOLET = "#8F4FBF";

  // Concepts the coder added by hand via terminology search (P0.5: a missed or
  // mis-grounded mention can always be coded by searching MongoDB directly).
  const [extraMentions, setExtraMentions] = useState([]);

  // One review row per grounded mention. Each carries the ranked candidates
  // MongoDB retrieved, so the coder can swap the chosen concept per mention.
  const groundedMentions = grounded.map((r, i) => {
    const candidates = [r.topCandidate, ...(r.alternatives || [])].filter(Boolean);
    const decision = r.mentionId ? llmByMention[r.mentionId] : null;
    const llmPick = decision && decision.conceptId !== "none"
      ? candidates.find((c) => String(c.conceptId) === String(decision.conceptId))
      : null;
    return {
      key: r.mentionId ? String(r.mentionId) : `m${i}`,
      phrase: (r.span && r.span.text) || r.phrase,
      assertion: r.assertion || "present",
      experiencer: r.experiencer || "patient",
      status: r.status,
      confidencePct: r.confidencePct ?? 0,
      section: r.llmSection || "other",
      candidates,
      defaultChoice: String((llmPick || r.topCandidate).conceptId),
      llmPicked: Boolean(llmPick),
      rationale: decision?.rationale || null
    };
  });
  const mentions = [...groundedMentions, ...extraMentions];

  const [chosen, setChosen] = useState(() => {
    const init = {}; groundedMentions.forEach((m) => { init[m.key] = m.defaultChoice; }); return init;
  });
  const chosenCandidate = (m) => m.candidates.find((c) => String(c.conceptId) === String(chosen[m.key])) || m.candidates[0];

  // Add a concept found via terminology search as a new (manual) review row.
  const addConcept = (concept, query) => {
    const conceptId = String(concept.conceptId);
    const key = `manual-${conceptId}`;
    if (mentions.some((m) => m.key === key)) return;
    setExtraMentions((cur) => [...cur, {
      key,
      phrase: query || "added by coder",
      assertion: "present", experiencer: "patient", status: "accepted",
      confidencePct: 100, section: "other",
      candidates: [{
        conceptId, term: concept.preferredTerm || concept.term,
        semanticTag: concept.semanticTag || null,
        ancestorIds: Array.isArray(concept.ancestorIds) ? concept.ancestorIds.map(String) : [],
        matchReason: "added by search", matchedBy: "manual",
        score: Number(concept.score) || 0
      }],
      defaultChoice: conceptId, llmPicked: false,
      rationale: "Added by coder via terminology search", manual: true
    }]);
    setChosen((cur) => ({ ...cur, [key]: conceptId }));
    setAccepted((cur) => ({ ...cur, [key]: true }));
  };

  // Clinical role a coder would assign, based on the *chosen* candidate.
  const roleOf = (m) => {
    if (m.assertion === "absent") return "ruled-out";
    if (m.experiencer === "family" || m.assertion === "family-history") return "family-history";
    if (m.assertion === "planned") return "planned";
    const tag = String(chosenCandidate(m)?.semanticTag || "").toLowerCase();
    if (PROCEDURE_TAGS.includes(tag)) return "procedure";
    if (PRODUCT_TAGS.includes(tag)) return "medication";
    return "diagnosis";
  };
  const EXCLUDE_REASON = { "ruled-out": "negated / ruled out", planned: "planned / not yet done", "family-history": "family history" };
  const CODEABLE_ROLES = ["diagnosis", "procedure", "medication"];

  const diagnosisMentions = mentions.filter((m) => roleOf(m) === "diagnosis");
  // Default principal: the mention whose chosen concept is the suggested
  // primary, else the first diagnosis (highest-ranked; mentions preserve order).
  const suggestedPrimary = (llm.primaryConceptId && llm.primaryConceptId !== "none" ? String(llm.primaryConceptId) : null)
    || (principal ? String(principal.conceptId) : null);
  const defaultPrincipalKey = diagnosisMentions.find((m) => String(chosen[m.key]) === suggestedPrimary)?.key
    || (diagnosisMentions[0]?.key || null);
  const [principalKey, setPrincipalKey] = useState(defaultPrincipalKey);

  const [accepted, setAccepted] = useState(() => {
    const init = {};
    mentions.forEach((m) => { init[m.key] = CODEABLE_ROLES.includes(roleOf(m)) && m.status === "accepted"; });
    if (defaultPrincipalKey) init[defaultPrincipalKey] = true;
    return init;
  });
  const toggle = (key) => setAccepted((cur) => ({ ...cur, [key]: !cur[key] }));
  const setPrincipal = (key) => { setPrincipalKey(key); setAccepted((cur) => ({ ...cur, [key]: true })); };
  const chooseConcept = (key, conceptId) => setChosen((cur) => ({ ...cur, [key]: String(conceptId) }));
  const [outputLens, setOutputLens] = useState("codings");
  const [sectionFilter, setSectionFilter] = useState("all");

  // Lens rows reflect the coder's *chosen* concept per mention (+ manual adds),
  // so the downstream outputs (problem list, FHIR, corpus query...) honor swaps and
  // search-to-code additions — not just the pipeline's top-1.
  const lensCodings = mentions.map((m) => {
    const c = chosenCandidate(m);
    return {
      conceptId: String(c?.conceptId || ""),
      term: c?.term || m.phrase,
      tag: String(c?.semanticTag || "").toLowerCase(),
      ancestorIds: Array.isArray(c?.ancestorIds) ? c.ancestorIds.map(String) : [],
      assertion: m.assertion,
      subject: m.experiencer,
      section: m.section || "other",
      phrase: m.phrase
    };
  });

  // Codings: dedupe by chosen concept so the same code isn't saved twice.
  const acceptedCodings = (() => {
    const seen = new Set(); const out = [];
    mentions.filter((m) => accepted[m.key]).forEach((m) => {
      const c = chosenCandidate(m); if (!c) return;
      const id = String(c.conceptId); if (seen.has(id)) return; seen.add(id);
      const baseRole = roleOf(m);
      const role = m.key === principalKey && baseRole === "diagnosis" ? "principal"
        : baseRole === "diagnosis" ? "secondary" : baseRole;
      out.push({
        conceptId: id,
        display: c.term,
        semanticTag: c.semanticTag || null,
        role,
        target: baseRole === "procedure" ? "Procedure.code" : baseRole === "medication" ? "MedicationStatement.medication" : "Condition.code",
        assertion: m.assertion,
        subject: m.experiencer,
        evidence: m.phrase ? { text: m.phrase } : null
      });
    });
    return out;
  })();
  const principalCandidate = (() => {
    const m = mentions.find((x) => x.key === principalKey);
    return m ? chosenCandidate(m) : null;
  })();

  return (
    <div>
      <OutputSelector lens={outputLens} setLens={setOutputLens} />

      {outputLens !== "codings" ? (
        <>
          <SectionFilter items={lensCodings} value={sectionFilter} setValue={setSectionFilter} />
          <OutputLensView
            lens={outputLens}
            codings={sectionFilter === "all" ? lensCodings : lensCodings.filter((c) => (c.section || "other") === sectionFilter)}
          />
        </>
      ) : (
      <>
      {llm.loading ? (
        <div style={{ border: `1px solid ${VIOLET}`, borderRadius: 12, padding: 14, background: "#FAF5FE", marginBottom: 14, color: VIOLET, fontWeight: 600 }}>
          ✦ Reviewing candidates with {llm.model || "the LLM"} — confirming concepts, sorting, and selecting the primary diagnosis…
        </div>
      ) : null}

      {llm.summary ? (
        <div style={{ border: `2px solid ${VIOLET}`, borderRadius: 12, padding: 16, background: "#FAF5FE", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: VIOLET }}>✦ LLM review · summary</span>
            <Badge variant="blue">{llm.model}</Badge>
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: INK }}>{llm.summary}</p>
        </div>
      ) : null}

      {grounded.length === 0 ? (
        <p style={sub}>No concepts grounded (search may have timed out — try Re-run).</p>
      ) : (
        <ReviewWorklist
          mentions={mentions}
          roleOf={roleOf}
          chosen={chosen}
          chooseConcept={chooseConcept}
          accepted={accepted}
          toggle={toggle}
          principalKey={principalKey}
          setPrincipal={setPrincipal}
          excludeReason={EXCLUDE_REASON}
          addConcept={addConcept}
          languageCode={languageCode}
        />
      )}

      {grounded.length > 0 ? (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#5C6C75", margin: "18px 0 4px" }}>
            Store &amp; query by ancestor — the payoff
          </div>
          <p style={{ ...sub, margin: "0 0 8px" }}>
            Persisting the codings isn&apos;t the point — it&apos;s what the codings let you do next. Each confirmed coding
            carries its full SNOMED ancestor path, so the free-text note becomes queryable by concept hierarchy: one
            indexed lookup finds this note (and every other) coded to a term <em>or any of its descendants</em>.
          </p>
        </>
      ) : null}
      {grounded.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 0, padding: "12px 14px", border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fbfdfc", flexWrap: "wrap" }}>
          <span style={{ ...sub }}>{(() => {
            const n = (role) => acceptedCodings.filter((c) => c.role === role).length;
            const parts = [];
            if (n("principal")) parts.push("1 principal");
            if (n("secondary")) parts.push(`${n("secondary")} secondary`);
            if (n("procedure")) parts.push(`${n("procedure")} procedure${n("procedure") === 1 ? "" : "s"}`);
            if (n("medication")) parts.push(`${n("medication")} medication${n("medication") === 1 ? "" : "s"}`);
            if (n("family-history")) parts.push(`${n("family-history")} family-history`);
            return parts.length ? `Saving ${acceptedCodings.length} codings — ${parts.join(", ")}` : "Nothing selected to save";
          })()}</span>
          <button type="button" style={{ ...primaryBtn, padding: "8px 18px", marginLeft: "auto" }}
            disabled={saveState.loading || acceptedCodings.length === 0} onClick={() => onSave?.(acceptedCodings)}>
            {saveState.loading ? "Saving…" : "Confirm & save codings"}
          </button>
          {saveState.error ? <span style={{ color: "#DB3030", fontSize: 12, width: "100%" }}>{saveState.error}</span> : null}
          {saveState.result ? (
            <div style={{ width: "100%", fontSize: 12, color: "#00684A", marginTop: 4 }}>
              Saved {saveState.result.savedCodings} codings to <code>{saveState.result.collection}</code> (id {saveState.result.insertedId}).
              The ancestor query below now matches this note.
            </div>
          ) : null}
        </div>
      ) : null}

      {grounded.length > 0 ? (
        <PayoffSnippet
          concept={principalCandidate || principal || grounded[0]?.topCandidate || null}
          collection={saveState.result?.collection || "grounded_notes"}
          open={Boolean(saveState.result)}
        />
      ) : null}
      </>
      )}
    </div>
  );
}

// The payoff: grounded codings store their ancestor path, so finding every
// note with this concept or any descendant is one indexed $elemMatch.
function PayoffSnippet({ concept, collection = "grounded_notes", open = false }) {
  const [run, setRun] = useState({ loading: false, error: "", data: null });
  const id = concept?.conceptId;
  useEffect(() => { setRun({ loading: false, error: "", data: null }); }, [id]);
  if (!concept) return null;
  const term = concept.term || id;
  const mql = `// Goal: find every note where the patient actually has "${term}" —
// or anything more specific than it (a subtype), without listing the subtypes.
//
//   1. Look inside each note's coded findings (the codings array).
//   2. Match on ancestorIds, not the exact code: because every coding saved its
//      full parent chain, "${term}" matches the concept itself AND all of its
//      descendants — the entire value set lives in one field.
//   3. Keep only findings the patient has, about the patient, human-confirmed —
//      so ruled-out and family-history mentions are excluded.
db.${collection}.find({
  codings: { $elemMatch: {
    ancestorIds: "${id}",   // this concept OR any descendant (subsumption)
    assertion: "present",   // the patient has it (not negated / suspected)
    subject:   "patient",   // about the patient (not a relative)
    status:    "accepted"   // a human coder confirmed it
  }}
})`;

  const runQuery = async () => {
    setRun({ loading: true, error: "", data: null });
    try {
      const res = await fetch("/api/grounded-corpus", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conceptId: String(id) })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setRun({ loading: false, error: "", data });
    } catch (e) {
      setRun({ loading: false, error: e?.message || "Query failed", data: null });
    }
  };

  const d = run.data;
  return (
    <details open={open} style={{ marginTop: 18, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", background: "#fbfdfc" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: INK, fontSize: 13 }}>
        The query this unlocks: find notes by SNOMED ancestor
      </summary>
      <p style={{ ...sub, margin: "8px 0" }}>
        Because each coding stored its ancestor path (<code>codings.ancestorIds</code>), a subsumption search across the
        whole corpus is a single indexed <code>$elemMatch</code> — no runtime value-set expansion, no graph traversal.
      </p>
      <Code language="javascript">{mql}</Code>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={runQuery} disabled={run.loading}
          style={{ ...primaryBtn, padding: "7px 16px", opacity: run.loading ? 0.6 : 1 }}>
          {run.loading ? "Running…" : "Run this query"}
        </button>
        <span style={{ ...sub }}>Runs live over the stored <code>{collection}</code> corpus.</span>
      </div>
      {run.error ? <p style={{ color: "#DB3030", fontSize: 12, marginTop: 8 }}>{run.error}</p> : null}
      {d ? (
        <div style={{ marginTop: 10, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
          <div style={{ fontSize: 14, color: INK }}>
            <strong style={{ color: GREEN, fontSize: 20 }}>{d.matchCount}</strong> of {d.totalCount} stored note{d.totalCount === 1 ? "" : "s"} are
            coded to <strong>{term}</strong> or one of its descendants
            {d.matchCount > 1 ? <span style={{ color: "#5C6C75" }}> — this note joins {d.matchCount - 1} other{d.matchCount - 1 === 1 ? "" : "s"} in the grounded corpus.</span> : d.matchCount === 1 ? <span style={{ color: "#5C6C75" }}> — this note, so far.</span> : "."}
          </div>
          {d.sample?.length ? (
            <div style={{ marginTop: 8 }}>
              {d.sample.map((s) => (
                <div key={s.id} style={{ fontSize: 12, color: "#5C6C75", padding: "4px 0", borderTop: `1px solid ${BORDER}` }}>
                  <span style={{ color: INK }}>{s.snippet || "(no text)"}{(s.snippet || "").length >= 120 ? "…" : ""}</span>
                  {s.via ? <span style={{ color: "#889397" }}> · via {s.via.display} {s.via.exact ? "(exact)" : "(descendant)"}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

// ---- Output lenses: one grounding, many downstream applications ----
const OUTPUT_LENSES = [
  { key: "codings", label: "Codings & save" },
  { key: "problems", label: "Problem list" },
  { key: "procedures", label: "Procedures" },
  { key: "medications", label: "Medications" },
  { key: "family", label: "Family history" },
  { key: "ruledout", label: "Ruled-out" },
  { key: "corpus", label: "Corpus query" },
  { key: "fhir", label: "FHIR bundle" }
];
const DISORDER_TAGS = ["disorder", "finding", "trastorno", "hallazgo"];
const PROCEDURE_TAGS = ["procedure", "procedimiento", "regime/therapy", "régimen/tratamiento"];
const PRODUCT_TAGS = ["product", "producto", "medicinal product", "clinical drug", "medicinal product form", "fármaco de uso clínico", "producto medicinal", "forma farmacéutica de producto medicinal", "presentación farmacéutica"];
// Scope roots chosen to exist in the demo scope (cardio / oncology / diabetes).
const SCOPE_ROOTS = [
  { label: "Diabetes mellitus", root: "73211009" },
  { label: "Cardiovascular disease", root: "49601007" },
  { label: "Heart failure", root: "84114007" },
  { label: "Chronic kidney disease", root: "709044004" },
  { label: "Malignant neoplasm", root: "363346000" },
  { label: "Ischemic heart disease", root: "414545008" }
];

const SECTION_LABELS = {
  chief_complaint: "Chief complaint",
  history: "History / antecedents",
  active: "Active problems",
  procedures: "Procedures",
  medications: "Medications",
  family_history: "Family history",
  plan: "Plan",
  other: "Other"
};

function OutputSelector({ lens, setLens }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5C6C75", marginBottom: 6 }}>
        Output — one grounding, many uses
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {OUTPUT_LENSES.map((l) => (
          <button key={l.key} type="button" onClick={() => setLens(l.key)} style={l.key === lens ? chipActive : chip}>{l.label}</button>
        ))}
      </div>
    </div>
  );
}

// Section navigator: filter the outputs to a document section (History /
// antecedents, Active problems, Family history, Plan…). Only shown when the
// note actually spans more than one section.
function SectionFilter({ items, value, setValue }) {
  const present = [];
  const seen = new Set();
  for (const c of Array.isArray(items) ? items : []) {
    const s = c.section || "other";
    if (!seen.has(s)) { seen.add(s); present.push(s); }
  }
  if (present.length <= 1) return null;
  const order = ["chief_complaint", "history", "active", "procedures", "medications", "family_history", "plan", "other"];
  const ordered = present.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5C6C75", marginBottom: 6 }}>Section</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setValue("all")} style={value === "all" ? chipActive : chip}>All</button>
        {ordered.map((s) => (
          <button key={s} type="button" onClick={() => setValue(s)} style={value === s ? chipActive : chip}>{SECTION_LABELS[s] || s}</button>
        ))}
      </div>
    </div>
  );
}

function LensList({ intro, items, empty }) {
  return (
    <div>
      <p style={{ ...sub, margin: "0 0 10px" }}>{intro}</p>
      {items.length === 0 ? <p style={sub}>{empty}</p> : (
        <div style={{ display: "grid", gap: 6 }}>
          {items.map((c, i) => (
            <div key={`${c.conceptId}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "#fff", fontSize: 13, flexWrap: "wrap" }}>
              <strong style={{ color: INK }}>{c.term}</strong>
              <span style={{ color: "#889397" }}>#{c.conceptId}</span>
              {c.tag ? <Badge variant="green">{c.tag}</Badge> : null}
              {c.section && c.section !== "other" ? <Badge variant="lightgray">{SECTION_LABELS[c.section] || c.section}</Badge> : null}
              <span style={{ marginLeft: "auto", color: "#889397", fontSize: 11 }}>“{c.phrase}”</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutputLensView({ lens, codings: codingsIn }) {
  const codings = (Array.isArray(codingsIn) ? codingsIn : []).filter((c) => c.conceptId);
  const present = codings.filter((c) => c.assertion !== "absent" && c.subject === "patient");

  if (lens === "problems") {
    return <LensList intro="Active patient problems — present findings and disorders, ready for a coded problem list (Condition.code)." empty="No present patient disorders grounded." items={present.filter((c) => DISORDER_TAGS.includes(c.tag))} />;
  }
  if (lens === "procedures") {
    return <LensList intro="Procedures mentioned for the patient (Procedure.code)." empty="No procedures grounded." items={present.filter((c) => PROCEDURE_TAGS.includes(c.tag))} />;
  }
  if (lens === "medications") {
    return <LensList intro="Medicinal products mentioned (MedicationStatement.medication)." empty="No medications grounded." items={present.filter((c) => PRODUCT_TAGS.includes(c.tag))} />;
  }
  if (lens === "family") {
    return <LensList intro="Family-history mentions — recorded about relatives, not the patient (FamilyMemberHistory)." empty="No family-history mentions." items={codings.filter((c) => c.subject === "family")} />;
  }
  if (lens === "ruledout") {
    return <LensList intro="Explicitly negated / ruled-out findings — valuable for decision support and to avoid re-investigation." empty="No ruled-out findings." items={codings.filter((c) => c.assertion === "absent")} />;
  }
  if (lens === "corpus") {
    return <CorpusLens present={present} />;
  }
  if (lens === "fhir") {
    return <FhirLens codings={codings} />;
  }
  return null;
}

// Corpus query / eligibility: preset roots (instant ancestorIds check) + a custom
// ECL scope tested via /api/ecl expansion, intersected with the note's coded concepts.
function CorpusLens({ present }) {
  const [ecl, setEcl] = useState("");
  const [custom, setCustom] = useState({ loading: false, error: "", matched: null, total: 0 });
  const conceptIds = new Set(present.map((c) => c.conceptId));

  const rows = SCOPE_ROOTS.map((co) => ({
    ...co,
    matched: present.filter((c) => c.conceptId === co.root || c.ancestorIds.includes(co.root))
  }));

  const testEcl = async () => {
    const expr = ecl.trim();
    if (!expr) return;
    setCustom({ loading: true, error: "", matched: null, total: 0 });
    try {
      const res = await fetch("/api/ecl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "expand", expr, languageCode: "en", limit: 200000 })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      const set = new Set((data.conceptIds || []).map(String));
      const matched = present.filter((c) => set.has(c.conceptId));
      setCustom({ loading: false, error: "", matched, total: (data.stats || {}).totalExpanded || set.size });
    } catch (error) {
      setCustom({ loading: false, error: error?.message || "ECL failed", matched: null, total: 0 });
    }
  };

  return (
    <div>
      <p style={{ ...sub, margin: "0 0 10px" }}>
        Does this note match a reusable SNOMED scope? Each coding carries its SNOMED ancestor path, so membership is a
        subsumption check — the same pattern as a <code>{"<< root"}</code> ECL query, run over one note.
      </p>
      <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
        {rows.map((co) => (
          <div key={co.root} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `1px solid ${co.matched.length ? GREEN : BORDER}`, borderRadius: 8, background: co.matched.length ? "#F1FAF5" : "#fff", fontSize: 13, flexWrap: "wrap" }}>
            <Badge variant={co.matched.length ? "green" : "lightgray"}>{co.matched.length ? "match" : "no match"}</Badge>
            <strong style={{ color: INK }}>{co.label}</strong>
            <span style={{ color: "#889397" }}>&laquo; #{co.root}</span>
            {co.matched.length ? <span style={{ marginLeft: "auto", color: "#5C6C75", fontSize: 12 }}>{co.matched.map((m) => m.term).join(", ")}</span> : null}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#5C6C75", marginBottom: 6 }}>Custom scope (ECL)</div>
      <form onSubmit={(e) => { e.preventDefault(); testEcl(); }} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input value={ecl} onChange={(e) => setEcl(e.target.value)} placeholder="e.g. << 73211009 MINUS << 46635009"
          style={{ flex: 1, minWidth: 240, padding: "8px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, color: INK }} />
        <button type="submit" style={{ ...primaryBtn, padding: "0 16px" }} disabled={custom.loading}>{custom.loading ? "Testing…" : "Test"}</button>
      </form>
      {custom.error ? <p style={errBox}>{custom.error}</p> : null}
      {custom.matched ? (
        <div style={{ padding: "8px 12px", border: `1px solid ${custom.matched.length ? GREEN : BORDER}`, borderRadius: 8, background: custom.matched.length ? "#F1FAF5" : "#fff", fontSize: 13 }}>
          <Badge variant={custom.matched.length ? "green" : "lightgray"}>{custom.matched.length ? "match" : "no match"}</Badge>
          <span style={{ marginLeft: 8, color: "#5C6C75" }}>
            {custom.matched.length ? custom.matched.map((m) => m.term).join(", ") : "No coded concept falls in this set"} · scope {Number(custom.total).toLocaleString()} concepts
          </span>
        </div>
      ) : null}
    </div>
  );
}

// FHIR: deterministic serialization of the grounded codings into a Bundle.
// No LLM, no DB call — MongoDB already supplied every SNOMED code.
function fhirResourceFor(c) {
  const code = { coding: [{ system: "http://snomed.info/sct", code: c.conceptId, display: c.term }], text: c.term };
  const subject = { reference: "Patient/example" };
  if (c.subject === "family") {
    return { resourceType: "FamilyMemberHistory", status: "completed", patient: subject, condition: [{ code }] };
  }
  if (PROCEDURE_TAGS.includes(c.tag)) {
    return { resourceType: "Procedure", status: "completed", code, subject };
  }
  if (PRODUCT_TAGS.includes(c.tag)) {
    return { resourceType: "MedicationStatement", status: "active", medicationCodeableConcept: code, subject };
  }
  const verification = c.assertion === "absent" ? "refuted" : c.assertion === "suspected" ? "provisional" : "confirmed";
  return {
    resourceType: "Condition",
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: c.assertion === "absent" ? "inactive" : "active" }] },
    verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: verification }] },
    code,
    subject
  };
}

function FhirLens({ codings }) {
  const bundle = {
    resourceType: "Bundle",
    type: "collection",
    entry: codings.map((c) => ({ resource: fhirResourceFor(c) }))
  };
  const json = JSON.stringify(bundle, null, 2);
  return (
    <div>
      <p style={{ ...sub, margin: "0 0 10px" }}>
        A FHIR <code>Bundle</code> generated deterministically from the grounded codings — Condition / Procedure /
        MedicationStatement / FamilyMemberHistory, each carrying its SNOMED code. Ruled-out findings appear as
        <code> verificationStatus: refuted</code>. No LLM or extra query: MongoDB already supplied the codes.
      </p>
      <Code language="json">{json}</Code>
    </div>
  );
}

function ApiBlock({ body }) {
  const curl = `curl -s -X POST /api/nlp-map \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(body)}'`;
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", background: "#f4f7f6", borderBottom: `1px solid ${BORDER}` }}>
        <Badge variant="green">POST</Badge><code style={{ fontSize: 12, color: INK }}>/api/nlp-map</code>
      </div>
      <Code language="json">{JSON.stringify(body, null, 2)}</Code>
      <Code language="bash">{curl}</Code>
    </div>
  );
}

function LegendDot({ color, label, solid }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: solid ? `${color}18` : `${color}14`, border: solid ? `2px solid ${color}` : `1px dashed ${color}` }} />
      <span style={{ color: "#5C6C75" }}>{label}</span>
    </span>
  );
}

const sub = { fontSize: 13, color: "#5C6C75", margin: 0 };
const errBox = { fontSize: 13, color: "#DB3030", background: "#FDECEC", padding: "8px 12px", borderRadius: 8 };
const primaryBtn = { background: GREEN, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const ghostBtn = { background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#5C6C75" };
const llmBtn = { background: "#8F4FBF", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 1px 3px rgba(143,79,191,0.35)" };
const chip = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer", color: INK };
const chipActive = { ...chip, background: "#E3FCEC", border: `1px solid ${GREEN}`, color: GREEN, fontWeight: 700 };
const crumbLink = { background: "transparent", border: "none", color: GREEN, cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 13 };
const code = { background: "#001E2B", color: "#E3FCEC", padding: 10, fontSize: 11, overflowX: "auto", margin: 0 };
function pill(color) {
  return { display: "inline-block", background: `${color}14`, color, borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700 };
}
