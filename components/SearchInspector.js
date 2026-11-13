"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Badge from "@leafygreen-ui/badge";
import { formatAggregate } from "@/lib/mongosh-format";
import { explainPipeline, explainRole } from "@/lib/pipeline-explain";
const Code = dynamic(() => import("@leafygreen-ui/code"), { ssr: false });

// Learning views for Ground a Note. Both show what actually ran — never a
// reconstruction:
//  - RetrievalInspector: pick a mention on the left; the right panel walks
//    through every step retrieval ran for it (each MongoDB aggregation exactly
//    as sent, and the app-side steps between them), annotated stage by stage.
//  - DiagnosisExplainer: how the principal diagnosis, comorbidities, symptoms,
//    history and suspected findings were derived — the rules and weights the
//    scorer applied, and this note's numbers.

const INK = "#001E2B";
const GREEN = "#00684A";
const BORDER = "#e3e7ea";
const MUTED = "#5C6C75";
const FAINT = "#889397";

const OUTCOME_BADGE = { ok: "green", skipped: "lightgray", unavailable: "yellow", timeout: "red", error: "red" };

function stepLabel(step) {
  return step.label || step.role;
}

// ---------------------------------------------------------------------------
// Retrieval inspector
// ---------------------------------------------------------------------------

export function RetrievalInspector({ traces }) {
  const items = Array.isArray(traces) ? traces : [];
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const current = items[Math.min(selected, items.length - 1)];
  const queryCount = items.reduce((n, t) => n + t.steps.filter((s) => s.kind === "mongodb").length, 0);

  return (
    <details open={open} onToggle={(e) => setOpen(e.target.open)} style={shell}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: INK, fontSize: 13 }}>
        How retrieval works — {items.length} mention{items.length === 1 ? "" : "s"}, {queryCount} MongoDB quer{queryCount === 1 ? "y" : "ies"} actually run
      </summary>
      <p style={{ ...note, margin: "8px 0 12px" }}>
        Each mention is resolved independently. Pick one to see every step it went through — the exact aggregation
        pipelines sent to MongoDB, and what the application did between them — with an explanation of each part.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 260px) 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 6, position: "sticky", top: 12 }}>
          {items.map((t, i) => {
            const on = i === selected;
            const queries = t.steps.filter((s) => s.kind === "mongodb");
            return (
              <button key={t.mentionId || i} type="button" onClick={() => setSelected(i)}
                style={{ textAlign: "left", border: `1px solid ${on ? GREEN : BORDER}`, background: on ? "#F1FBF6" : "#fff", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>“{t.phrase}”</div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                  {t.strategy} · {queries.length} quer{queries.length === 1 ? "y" : "ies"}{t.status ? ` · ${t.status}` : ""}
                </div>
              </button>
            );
          })}
        </div>
        <TracePanel trace={current} />
      </div>
    </details>
  );
}

function TracePanel({ trace }) {
  const [format, setFormat] = useState("explained");
  const steps = trace?.steps || [];
  if (!steps.length) {
    return <div style={panel}><p style={note}>No retrieval ran for this mention (it was filtered out before search).</p></div>;
  }
  // The two app-side fusion queries are issued together; mark them as parallel.
  const parallelRoles = new Set(["app-rrf-lexical", "app-rrf-vector"]);
  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>“{trace.phrase}”</div>
        <Badge variant="lightgray">{trace.strategy}</Badge>
        <div style={{ marginLeft: "auto", display: "inline-flex", border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden" }}>
          {[["explained", "Explained"], ["shell", "mongosh"], ["json", "JSON"]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFormat(k)}
              style={{ padding: "4px 12px", fontSize: 12, border: "none", cursor: "pointer", background: format === k ? GREEN : "#fff", color: format === k ? "#fff" : INK, fontWeight: format === k ? 700 : 500 }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <PathStrip steps={steps} />
      <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
        {steps.map((step, i) => (
          <li key={i}>
            <StepCard index={i + 1} step={step} format={format} collection={trace.collection}
              parallel={parallelRoles.has(step.role)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

// Compact "how it flowed" line: one chip per step, MongoDB steps in green.
function PathStrip({ steps }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, fontSize: 11 }}>
      {steps.map((s, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {i > 0 ? <span style={{ color: FAINT }}>→</span> : null}
          <span style={{
            padding: "2px 8px", borderRadius: 999, fontWeight: 700,
            background: s.kind === "mongodb" ? "#E3FCEC" : "#F4F7F6",
            color: s.kind === "mongodb" ? GREEN : MUTED,
            border: `1px solid ${s.kind === "mongodb" ? `${GREEN}33` : BORDER}`,
            opacity: s.outcome === "skipped" ? 0.6 : 1
          }}>
            {s.kind === "mongodb" ? "MongoDB · " : ""}{(explainRole(s.role)?.title) || stepLabel(s)}
          </span>
        </span>
      ))}
    </div>
  );
}

function StepCard({ index, step, format, collection, parallel }) {
  const intro = explainRole(step.role);
  const isQuery = step.kind === "mongodb";
  const explained = useMemo(() => (isQuery ? explainPipeline(step.pipeline) : []), [isQuery, step.pipeline]);
  const [copied, setCopied] = useState(false);
  const text = isQuery
    ? (format === "json" ? JSON.stringify(step.pipeline, null, 2) : formatAggregate(step.pipeline, collection || "snomed-term-search"))
    : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(text || formatAggregate(step.pipeline, collection)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (_e) { /* clipboard blocked */ }
  };

  return (
    <div style={{ border: `1px solid ${isQuery ? `${GREEN}55` : BORDER}`, borderRadius: 10, background: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: isQuery ? "#F1FBF6" : "#FAFBFB", flexWrap: "wrap" }}>
        <span style={stepNumber}>{index}</span>
        <strong style={{ color: INK, fontSize: 13 }}>{stepLabel(step)}</strong>
        <Badge variant={isQuery ? "green" : "lightgray"}>{isQuery ? "MongoDB aggregation" : "application"}</Badge>
        {parallel ? <Badge variant="blue">runs in parallel</Badge> : null}
        {step.outcome ? <Badge variant={OUTCOME_BADGE[step.outcome] || "lightgray"}>{step.outcome}</Badge> : null}
        <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>
          {typeof step.rows === "number" ? `${step.rows} row${step.rows === 1 ? "" : "s"}` : ""}
          {typeof step.ms === "number" ? ` · ${step.ms} ms` : ""}
        </span>
      </div>
      <div style={{ padding: "10px 12px", display: "grid", gap: 8 }}>
        {intro ? (
          <div style={{ fontSize: 12.5, color: INK }}>
            {intro.what} <span style={{ color: MUTED }}><strong>Why:</strong> {intro.why}</span>
          </div>
        ) : null}
        {step.detail ? <div style={{ fontSize: 12.5, color: INK }}>{step.detail}</div> : null}
        {step.error ? <div style={{ fontSize: 12, color: "#B42318" }}>{step.error}</div> : null}
        {step.fallbackReason ? <div style={{ fontSize: 12, color: "#8A6D1F" }}>Native fusion unavailable: {step.fallbackReason}</div> : null}
        {step.params ? <Params params={step.params} /> : null}
        {step.input ? <RerankInput input={step.input} /> : null}
        {isQuery ? (
          format === "explained"
            ? <ExplainedStages stages={explained} />
            : (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" onClick={copy} style={linkBtn}>{copied ? "Copied ✓" : "Copy"}</button>
                </div>
                <div style={{ maxHeight: 520, overflow: "auto", borderRadius: 8 }}>
                  <Code language={format === "shell" ? "javascript" : "json"}>{text}</Code>
                </div>
              </div>
            )
        ) : null}
        {isQuery && step.options?.maxTimeMS ? (
          <div style={{ fontSize: 11, color: FAINT }}>Sent with maxTimeMS {step.options.maxTimeMS} — the query is cut off rather than slowing the whole note down.</div>
        ) : null}
      </div>
    </div>
  );
}

function Params({ params }) {
  const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined);
  if (!entries.length) return null;
  const render = (v) => (Array.isArray(v) ? v.map((x) => `“${x}”`).join(", ") : typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k} ${x}`).join(", ") : String(v));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11.5, color: MUTED }}>
      {entries.map(([k, v]) => (
        <span key={k}><strong style={{ color: INK }}>{k === "variants" ? "query variants" : k}</strong>: {render(v)}</span>
      ))}
    </div>
  );
}

function RerankInput({ input }) {
  return (
    <div style={{ fontSize: 11.5, color: MUTED }}>
      <div>Query sent to the reranker: <code style={inlineCode}>{input.query}</code> · {input.totalDocuments} document(s), keep top {input.topK}</div>
      {input.documents?.length ? (
        <div style={{ marginTop: 4 }}>
          First documents: {input.documents.map((d, i) => <code key={i} style={{ ...inlineCode, marginRight: 4 }}>{d}</code>)}
          {input.totalDocuments > input.documents.length ? ` … +${input.totalDocuments - input.documents.length}` : ""}
        </div>
      ) : null}
    </div>
  );
}

// Stage-by-stage annotation of one pipeline, nesting into $rankFusion inputs.
function ExplainedStages({ stages, depth = 0 }) {
  return (
    <ol style={{ margin: 0, paddingLeft: depth ? 16 : 18, display: "grid", gap: 6 }}>
      {stages.map((s, i) => (
        <li key={i} style={{ fontSize: 12.5, color: INK }}>
          <code style={opCode}>{s.op}</code> {s.summary}
          {s.why ? <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{s.why}</div> : null}
          {(s.details || []).map((g, gi) => (
            <div key={gi} style={{ marginTop: 5, paddingLeft: 10, borderLeft: `2px solid ${BORDER}` }}>
              <div style={{ fontSize: 11.5, color: MUTED }}><code style={groupCode}>{g.group}</code> {g.summary}</div>
              <ul style={{ margin: "3px 0 0", paddingLeft: 16, display: "grid", gap: 2 }}>
                {g.clauses.map((c, ci) => (
                  <li key={ci} style={{ fontSize: 12 }}>
                    <code style={clauseCode}>{c.type}</code> {c.summary}
                    {c.why ? <span style={{ color: FAINT }}> — {c.why}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {(s.inputs || []).map((input) => (
            <div key={input.name} style={{ marginTop: 6, padding: "6px 10px", border: `1px dashed ${BORDER}`, borderRadius: 8, background: "#FBFDFC" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 4 }}>
                Input pipeline “{input.name}”{input.weight != null ? ` — weight ${input.weight}` : ""}
              </div>
              <ExplainedStages stages={input.stages} depth={depth + 1} />
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Diagnosis explainer
// ---------------------------------------------------------------------------

const BUCKET_LABEL = {
  principal: "Principal diagnosis",
  comorbidity: "Comorbidity",
  symptom: "Presenting symptom",
  history: "Past history",
  suspected: "Suspected",
  "not-a-diagnosis": "Not a diagnosis",
  unclassified: "Not proposed"
};
const BUCKET_COLOR = { principal: "green", comorbidity: "blue", symptom: "lightgray", history: "yellow", suspected: "yellow", "not-a-diagnosis": "lightgray", unclassified: "lightgray" };
const BUCKET_WHY = {
  principal: "Highest-scoring concept asserted as present.",
  comorbidity: "Present, and a disorder — an active problem alongside the principal.",
  symptom: "Present, but a finding — usually explained by a diagnosis, so not coded by default.",
  history: "Not present now: documented as past history.",
  suspected: "Not confirmed: documented as suspected.",
  "not-a-diagnosis": "Scored, but the concept is a procedure, substance, structure… not a diagnosis.",
  unclassified: "Scored, but neither present, historical nor suspected (e.g. negated) — not proposed in any list."
};
const EXCLUDED_WHY = {
  "not-a-clinical-finding": "The code is not a clinical finding or disorder, so it cannot be a diagnosis.",
  "no-code": "No SNOMED code was grounded for this mention.",
  "inactive-concept": "The grounded concept is inactive in this release.",
  "not-the-patient": "The mention is about someone else (e.g. family history).",
  "non-positive-score": "Its combined score was zero or negative (e.g. planned, or a weak match in a low-weight section)."
};
const PART_LABEL = { confidence: "confidence × 0.3", section: "section", assertion: "assertion", evidence: "evidence", semanticTag: "semantic tag" };

export function DiagnosisExplainer({ explanation, llm = {}, principal }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  if (!explanation?.ranking) return null;
  const ranking = explanation.ranking;
  const current = ranking[Math.min(selected, Math.max(ranking.length - 1, 0))] || null;
  const llmPick = llm?.primaryConceptId && llm.primaryConceptId !== "none" ? String(llm.primaryConceptId) : null;
  const llmDisagrees = llmPick && principal && llmPick !== String(principal.conceptId);

  return (
    <details open={open} onToggle={(e) => setOpen(e.target.open)} style={shell}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: INK, fontSize: 13 }}>
        How the principal diagnosis and comorbidities were proposed — {ranking.length} concept{ranking.length === 1 ? "" : "s"} scored, {explanation.excluded?.length || 0} left out
      </summary>

      <div style={{ ...note, margin: "8px 0 12px", display: "grid", gap: 6 }}>
        <div>
          After every mention is grounded, a <strong>deterministic scorer</strong> (no LLM) ranks the coded concepts of the
          whole note. Each mention scores on <em>where</em> it appears, <em>how</em> it is asserted, how strong its grounding
          is and <em>what kind</em> of concept it is. Mentions of the same concept are grouped, and a parent concept folds into
          a more specific descendant on the same SNOMED branch (using the ancestor ids on each candidate — no extra queries).
        </div>
        <div>
          <strong>Formula:</strong> <code style={inlineCode}>{explanation.rules.formula}</code>
        </div>
        <div>
          Only concepts asserted as <code style={inlineCode}>{explanation.rules.principalAssertions.join(", ")}</code> can be principal.
          The rest are sorted into lists by status and semantic tag. Lens: <code style={inlineCode}>{explanation.targetContext}</code>.
        </div>
        <div>
          Then the <strong>coder decides</strong>: the review list is pre-filled from this proposal (presenting symptoms, history and
          suspected start unticked), and any choice can be changed.
          {llm?.model ? <> <strong>LLM assist</strong> ({llm.model}) may suggest a different principal, chosen only from these candidates{llmDisagrees ? " — and here it disagrees with the rules; both are shown in the review list" : ""}.</> : null}
        </div>
      </div>

      <WeightTables rules={explanation.rules} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) 1fr", gap: 14, alignItems: "start", marginTop: 14 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={sectionTitle}>This note's ranking</div>
          {ranking.map((item, i) => {
            const on = i === selected;
            return (
              <button key={item.conceptId} type="button" onClick={() => setSelected(i)}
                style={{ textAlign: "left", border: `1px solid ${on ? GREEN : BORDER}`, background: on ? "#F1FBF6" : "#fff", borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span style={{ fontSize: 11, color: FAINT }}>#{item.rank}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, flex: 1 }}>{item.term}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: INK }}>{item.score}</span>
                </div>
                <div style={{ marginTop: 3 }}><Badge variant={BUCKET_COLOR[item.bucket] || "lightgray"}>{BUCKET_LABEL[item.bucket] || item.bucket}</Badge></div>
              </button>
            );
          })}
          {explanation.excluded?.length ? (
            <>
              <div style={{ ...sectionTitle, marginTop: 8 }}>Left out before ranking</div>
              {explanation.excluded.map((e, i) => (
                <div key={i} style={{ border: `1px dashed ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: INK }}>“{e.phrase}”{e.term ? <span style={{ fontWeight: 500, color: MUTED }}> → {e.term}</span> : null}</div>
                  <div style={{ fontSize: 11, color: MUTED }}>{EXCLUDED_WHY[e.reason] || e.reason}{typeof e.score === "number" ? ` Score ${e.score}.` : ""}</div>
                </div>
              ))}
            </>
          ) : null}
        </div>
        {current ? <ConceptScorePanel item={current} /> : <div style={panel}><p style={note}>No diagnosis concepts were scored.</p></div>}
      </div>
    </details>
  );
}

function WeightTables({ rules }) {
  const tables = [
    ["Section", rules.section],
    ["Assertion", rules.assertion],
    ["Evidence (status · type)", rules.evidence],
    ["Semantic tag", rules.semanticTag]
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
      {tables.map(([title, rows]) => (
        <div key={title} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", background: "#fff" }}>
          <div style={sectionTitle}>{title}</div>
          {rows.map((r) => (
            <div key={r.value} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "1px 0" }}>
              <span style={{ color: MUTED }}>{r.value}</span>
              <span style={{ fontWeight: 700, color: r.weight > 0 ? GREEN : r.weight < 0 ? "#B42318" : MUTED }}>{r.weight > 0 ? `+${r.weight}` : r.weight}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", background: "#fff", fontSize: 11.5, color: MUTED }}>
        <div style={sectionTitle}>Repeats & confidence</div>
        <div>Each extra mention: <strong style={{ color: GREEN }}>+{rules.repeatBonus}</strong> (max +{rules.maxRepeatBonus})</div>
        <div>Match confidence × <strong style={{ color: INK }}>{rules.confidenceWeight}</strong> — capped below the clinical signals.</div>
      </div>
    </div>
  );
}

function ConceptScorePanel({ item }) {
  const b = item.scoreBreakdown || {};
  const contributions = b.contributions || [];
  return (
    <div style={panel}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>{item.term}</div>
        <span style={{ fontSize: 11, color: FAINT }}>#{item.conceptId}{item.semanticTag ? ` · ${item.semanticTag}` : ""}</span>
        <Badge variant={BUCKET_COLOR[item.bucket] || "lightgray"}>{BUCKET_LABEL[item.bucket] || item.bucket}</Badge>
      </div>
      <p style={{ ...note, margin: "6px 0 10px" }}>{BUCKET_WHY[item.bucket]}</p>

      <div style={{ fontSize: 13, color: INK, marginBottom: 8 }}>
        Score <strong>{item.score}</strong> = best mention <strong>{b.bestMentionScore}</strong> + repeat bonus <strong>{b.repeatBonus}</strong>
        <span style={{ color: MUTED }}> ({contributions.length} supporting mention{contributions.length === 1 ? "" : "s"})</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: MUTED }}>
              <th style={th}>Mention</th>
              {Object.keys(PART_LABEL).map((k) => <th key={k} style={{ ...th, textAlign: "right" }}>{PART_LABEL[k]}</th>)}
              <th style={{ ...th, textAlign: "right" }}>= mention score</th>
            </tr>
          </thead>
          <tbody>
            {contributions.map((c, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${BORDER}`, background: c.score === b.bestMentionScore ? "#F1FBF6" : "transparent" }}>
                <td style={td}>
                  <div style={{ fontWeight: 700, color: INK }}>“{c.phrase}”</div>
                  <div style={{ fontSize: 10.5, color: FAINT }}>
                    {c.section} · {c.assertion}{c.mergedFrom ? ` · via “${c.mergedFrom}” (merged parent)` : ""}
                  </div>
                </td>
                {Object.keys(PART_LABEL).map((k) => (
                  <td key={k} style={{ ...td, textAlign: "right", color: c.parts?.[k] > 0 ? GREEN : c.parts?.[k] < 0 ? "#B42318" : MUTED }}>
                    {c.parts?.[k] > 0 ? `+${c.parts[k]}` : c.parts?.[k]}
                  </td>
                ))}
                <td style={{ ...td, textAlign: "right", fontWeight: 800, color: INK }}>{c.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {item.mergedConcepts?.length ? (
        <div style={{ ...note, marginTop: 10 }}>
          <strong>Hierarchy merge:</strong> {item.mergedConcepts.map((m) => `“${m.term}”`).join(", ")} {item.mergedConcepts.length === 1 ? "is an ancestor" : "are ancestors"} of this concept,
          so {item.mergedConcepts.length === 1 ? "its" : "their"} evidence was folded in here instead of competing as a separate diagnosis.
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

const shell = { marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fbfdfc", padding: "10px 14px" };
const panel = { border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fff", padding: 14, minWidth: 0 };
const note = { fontSize: 12.5, color: MUTED, lineHeight: 1.5 };
const sectionTitle = { fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: MUTED, marginBottom: 4 };
const stepNumber = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: INK, color: "#fff", fontSize: 11, fontWeight: 800 };
const inlineCode = { background: "#F4F7F6", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "1px 5px", color: INK, fontSize: 11 };
const opCode = { background: "#E3FCEC", color: GREEN, borderRadius: 5, padding: "1px 6px", fontSize: 11.5, fontWeight: 700 };
const groupCode = { background: "#EEF3FF", color: "#1254B7", borderRadius: 5, padding: "0 5px", fontSize: 11, fontWeight: 700 };
const clauseCode = { background: "#F4F7F6", color: INK, borderRadius: 5, padding: "0 5px", fontSize: 11 };
const linkBtn = { fontSize: 11, fontWeight: 700, color: "#016BF8", background: "none", border: "none", padding: 0, cursor: "pointer" };
const th = { padding: "6px 8px", fontWeight: 700, fontSize: 11 };
const td = { padding: "6px 8px", verticalAlign: "top" };
