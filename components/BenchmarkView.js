"use client";

import { useEffect, useState } from "react";
import PromptPanel from "@/components/PromptPanel";

// Extraction-model benchmark. Headline score = the LLM EVIDENCE GRAPH: for each
// gold note, how well the model extracts the expected facts (mention + assertion
// + subject), independent of MongoDB retrieval. A separate RETRIEVAL axis reports
// whether those mentions resolve to the expected SNOMED concepts under a chosen
// search mode. Runs one note at a time from the client so the grid fills live;
// click a cell to inspect note → model output → expected facts → score math.

const INK = "#001E2B";
const GREEN = "#00684A";
const BLUE = "#016BF8";
const VIOLET = "#8F4FBF";
const RED = "#DB3030";
const AMBER = "#8A6D1F";
const BORDER = "#e3e7ea";
const MODELS = (process.env.NEXT_PUBLIC_LLM_GROUNDING_MODELS || "gpt-5.5")
  .split(",").map((s) => s.trim()).filter(Boolean);

const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const accBg = (x) => `rgba(0,104,74,${(0.05 + (x || 0) * 0.25).toFixed(3)})`;
const key = (model, noteId) => `${model}::${noteId}`;

function aggregate(model, cells) {
  const present = cells.filter(Boolean);
  const scored = present.filter((c) => c.scored);
  const s = scored.length;
  const avg = (sel) => { const v = scored.map(sel).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const tokensPerNote = s ? Math.round(scored.reduce((a, c) => a + c.tokens, 0) / s) : 0;
  const evidenceComposite = avg((c) => c.evidenceComposite) || 0;
  return {
    model, pending: present.length === 0, errored: present.length > 0 && s === 0,
    scoredNotes: s, fallbacks: present.filter((c) => !c.scored).length,
    evidenceComposite,
    detection: avg((c) => c.detection), assertionAcc: avg((c) => c.assertionAcc),
    subjectAcc: avg((c) => c.subjectAcc), precision: avg((c) => c.precision),
    retrievalRecall: avg((c) => c.retrievalRecall),
    tokensPerNote,
    avgLatencyMs: present.length ? Math.round(present.reduce((a, c) => a + (c.ms || 0), 0) / present.length) : 0,
    qualityPer1kTokens: tokensPerNote > 0 ? evidenceComposite / (tokensPerNote / 1000) : null
  };
}
function computeRecommended(models) {
  const scored = models.filter((m) => !m.errored && !m.pending && m.scoredNotes > 0);
  if (!scored.length) return null;
  const top = Math.max(...scored.map((m) => m.evidenceComposite));
  const topModel = scored.slice().sort((a, b) => b.evidenceComposite - a.evidenceComposite)[0];
  const best = scored.filter((m) => m.evidenceComposite >= top - 0.02)
    .sort((a, b) => (a.tokensPerNote - b.tokensPerNote) || (a.avgLatencyMs - b.avgLatencyMs))[0];
  return best ? { model: best.model, evidenceComposite: best.evidenceComposite, tokensPerNote: best.tokensPerNote, avgLatencyMs: best.avgLatencyMs, matchesTop: best.model !== topModel.model, topModel: topModel.model } : null;
}

function MiniBar({ label, value, color = GREEN }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#5C6C75" }}>
      <span style={{ width: 58 }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: "#EDF1F0", overflow: "hidden" }}>
        <div style={{ height: "100%", width: value == null ? "0%" : pct(value), background: color }} />
      </div>
      <span style={{ width: 34, textAlign: "right", color: INK, fontWeight: 600 }}>{pct(value)}</span>
    </div>
  );
}

export default function BenchmarkView({ sessionModel, onPickModel }) {
  const [selectedModels, setSelectedModels] = useState(MODELS.slice(0, Math.min(4, MODELS.length)));
  const [gold, setGold] = useState([]);
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [searchMode, setSearchMode] = useState("lexical");
  const [grid, setGrid] = useState({});
  const [progress, setProgress] = useState({ running: false, done: 0, total: 0, current: "" });
  const [error, setError] = useState("");
  const [recommended, setRecommended] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [gridMetric, setGridMetric] = useState("quality"); // quality | time | tokens
  const [introOpen, setIntroOpen] = useState(false);

  // Load the gold pack up front so the note picker is populated before a run.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/benchmark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ metaOnly: true }) })
      .then((r) => r.json())
      .then((d) => { if (cancelled || !d?.goldNotes) return; setGold(d.goldNotes); setSelectedNotes(d.goldNotes.map((g) => g.id)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const run = async () => {
    setError(""); setRecommended(null); setGrid({}); setDrawer(null);
    const notes = gold.filter((g) => selectedNotes.includes(g.id));
    const tasks = [];
    for (const model of selectedModels) for (const note of notes) tasks.push({ model, noteId: note.id, title: note.title });
    if (!tasks.length) { setError("Select at least one model and one note."); return; }
    const acc = {};
    setProgress({ running: true, done: 0, total: tasks.length, current: "" });
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      setProgress({ running: true, done: i, total: tasks.length, current: `${t.title} · ${t.model}` });
      try {
        const res = await fetch("/api/benchmark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ models: [t.model], noteIds: [t.noteId], searchMode }) });
        const d = await res.json();
        if (!res.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${res.status}`);
        acc[key(t.model, t.noteId)] = d.models?.[0]?.notes?.[0] || { noteId: t.noteId, scored: false, error: "no result" };
      } catch (e) {
        acc[key(t.model, t.noteId)] = { noteId: t.noteId, scored: false, error: e?.message || "failed" };
      }
      setGrid({ ...acc });
      setProgress({ running: true, done: i + 1, total: tasks.length, current: "" });
    }
    setProgress({ running: false, done: tasks.length, total: tasks.length, current: "" });
    const perModel = selectedModels.map((m) => aggregate(m, notes.map((n) => acc[key(m, n.id)])));
    setRecommended(computeRecommended(perModel));
  };

  const runNotes = gold.filter((g) => selectedNotes.includes(g.id));
  const perModel = selectedModels.map((m) => aggregate(m, runNotes.map((n) => grid[key(m, n.id)])));
  const cards = perModel.slice().sort((a, b) => (b.evidenceComposite || 0) - (a.evidenceComposite || 0) || (a.errored ? 1 : 0) - (b.errored ? 1 : 0));
  const started = progress.total > 0 || Object.keys(grid).length > 0;
  const barPct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  // Grid can be viewed as quality (higher=better) or time / tokens (lower=better).
  // Each metric gets its own hue; time/tokens are normalised PER NOTE (per row)
  // so we compare models on the same note — a long note is slow for everyone.
  // Vivid MongoDB spring green for quality; blue/violet for time/tokens. Higher
  // alpha range so the gradient reads bold, not washed-out.
  const METRIC_RGB = { quality: [0, 214, 96], time: [1, 107, 248], tokens: [143, 79, 191] };
  const tint = (g) => { const c = METRIC_RGB[gridMetric]; return `rgba(${c[0]},${c[1]},${c[2]},${(0.10 + g * 0.55).toFixed(3)})`; };
  const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  const cellDisplay = (c) => {
    if (!c) return progress.running ? "·" : "—";
    if (!c.scored) return c.timedOut ? "⏱" : "fb";
    if (gridMetric === "time") return fmtMs(c.ms);
    if (gridMetric === "tokens") return c.tokens.toLocaleString();
    return pct(c.evidenceComposite);
  };
  // Goodness in [0,1] where 1 = greenest/best. Quality is absolute (already a
  // ratio); time/tokens are relative to the other models on the SAME note.
  const cellGoodness = (c, rowCells) => {
    if (!c || !c.scored) return null;
    if (gridMetric === "quality") return c.evidenceComposite;
    const vals = rowCells.filter((x) => x && x.scored).map((x) => (gridMetric === "time" ? x.ms : x.tokens));
    if (!vals.length) return 1;
    const mn = Math.min(...vals); const mx = Math.max(...vals);
    const v = gridMetric === "time" ? c.ms : c.tokens;
    return mx > mn ? 1 - (v - mn) / (mx - mn) : 1;
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "6px 4px 28px" }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.11em", textTransform: "uppercase", color: GREEN }}>Evaluation</span>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: INK, margin: "6px 0 8px", letterSpacing: "-0.02em" }}>Extraction model benchmark</h2>
      <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#4A5A64", margin: "0 0 16px" }}>
        The headline is the <strong>evidence graph</strong> the LLM extracts — each expected fact (mention + assertion +
        subject) it should surface — scored independently of MongoDB retrieval. A separate <strong>retrieval</strong> axis
        checks whether those mentions resolve to the expected SNOMED concepts.
        {introOpen ? (
          <>
            {" "}Retrieval is MongoDB&apos;s job, run on every request under the chosen search mode against the scoped
            sample dataset. Concepts that aren&apos;t in the demo sidecar are flagged as <strong>controlled scope gaps</strong>
            {" "}and excluded from the retrieval score — a known data limitation, not a model or retrieval failure. Precision
            is shown for information only, since the gold set isn&apos;t exhaustive. Pick models and notes, run, then
            {" "}<strong>click a cell</strong> to inspect the note, the model&apos;s output, and the score.
          </>
        ) : "…"}
        {" "}
        <button type="button" onClick={() => setIntroOpen((v) => !v)} style={{ ...linkBtn, fontSize: 13 }}>{introOpen ? "less" : "more"}</button>
      </p>

      <PromptPanel />


      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, background: "#fff", marginBottom: 18 }}>
        {/* Models */}
        <PickerHeader label="Models" count={`${selectedModels.length}/${MODELS.length}`} onAll={() => setSelectedModels(MODELS)} onClear={() => setSelectedModels([])} disabled={progress.running} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {MODELS.map((m) => {
            const on = selectedModels.includes(m);
            return <Chip key={m} on={on} disabled={progress.running} onClick={() => toggle(selectedModels, setSelectedModels, m)}>{on ? "✓ " : ""}{m}</Chip>;
          })}
        </div>
        {/* Notes */}
        <PickerHeader label="Gold notes" count={`${selectedNotes.length}/${gold.length}`} onAll={() => setSelectedNotes(gold.map((g) => g.id))} onClear={() => setSelectedNotes([])} disabled={progress.running} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {gold.map((g) => {
            const on = selectedNotes.includes(g.id);
            return <Chip key={g.id} on={on} disabled={progress.running} onClick={() => toggle(selectedNotes, setSelectedNotes, g.id)}>{on ? "✓ " : ""}{g.title}</Chip>;
          })}
        </div>
        {/* Retrieval mode + run */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={run} disabled={progress.running || !selectedModels.length || !selectedNotes.length}
            style={{ background: GREEN, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: progress.running ? "default" : "pointer", opacity: progress.running || !selectedModels.length || !selectedNotes.length ? 0.6 : 1 }}>
            {progress.running ? "Running…" : `Run (${selectedModels.length}×${selectedNotes.length})`}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5C6C75" }}>
            Retrieval mode
            <select value={searchMode} onChange={(e) => setSearchMode(e.target.value)} disabled={progress.running}
              style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: `1px solid #C1C7CB`, background: "#fff", color: INK }}>
              <option value="lexical">Lexical (MongoDB Search)</option>
              <option value="hybrid">Hybrid + rerank</option>
            </select>
          </label>
          <span style={{ fontSize: 12, color: "#889397" }}>Evidence-graph score is retrieval-independent; the mode only affects the retrieval axis.</span>
        </div>
        {error ? <p style={{ color: RED, fontSize: 13, marginTop: 10 }}>{error}</p> : null}

        {progress.total > 0 ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#5C6C75", marginBottom: 4 }}>
              <span>{progress.running ? (progress.current ? `Grounding ${progress.current}…` : "Scoring…") : "Complete"}</span>
              <span><strong style={{ color: INK }}>{progress.done}</strong>/{progress.total} · {barPct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "#EDF1F0", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${barPct}%`, background: GREEN, transition: "width .3s ease" }} />
            </div>
          </div>
        ) : null}
      </div>

      {started ? (
        <>
          {recommended ? (
            <div style={{ border: `1px solid ${GREEN}`, borderRadius: 12, padding: "14px 16px", background: "#F3FCF7", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: GREEN }}>Recommended default</span>
                {onPickModel ? (
                  <button type="button" onClick={() => onPickModel(recommended.model)}
                    style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: GREEN, border: "none", borderRadius: 7, padding: "4px 12px", cursor: "pointer" }}>
                    {sessionModel === recommended.model ? "✓ In use this session" : "Use for this session"}
                  </button>
                ) : null}
              </div>
              <div style={{ fontSize: 15, color: INK }}>
                <strong>{recommended.model}</strong> — evidence graph <strong>{pct(recommended.evidenceComposite)}</strong> at{" "}
                <strong>{recommended.tokensPerNote.toLocaleString()}</strong> tokens/note, <strong>{recommended.avgLatencyMs}</strong> ms/note.
                {recommended.matchesTop ? <> Matches the top model (<strong>{recommended.topModel}</strong>) at lower cost.</> : <> Also the top scorer.</>}
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 22 }}>
            {cards.map((m) => (
              <div key={m.model} style={{ border: `1px solid ${recommended && recommended.model === m.model ? GREEN : BORDER}`, borderRadius: 12, padding: 16, background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{m.model}</span>
                  {recommended && recommended.model === m.model ? <span style={{ fontSize: 10, fontWeight: 800, color: GREEN }}>★ BEST VALUE</span> : null}
                  {sessionModel === m.model ? <span style={{ fontSize: 10, fontWeight: 800, color: BLUE }}>● SESSION</span> : null}
                </div>
                {m.pending ? <div style={{ fontSize: 12.5, color: "#889397", padding: "8px 0" }}>Waiting…</div>
                  : m.errored ? <div style={{ fontSize: 12.5, color: RED, padding: "8px 0" }}>No LLM output — all notes fell back / errored ({m.fallbacks}).</div>
                  : (
                    <>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 34, fontWeight: 800, color: GREEN, lineHeight: 1 }}>{pct(m.evidenceComposite)}</span>
                        <span style={{ fontSize: 12, color: "#889397" }}>evidence graph {m.scoredNotes < runNotes.length ? `(${m.scoredNotes}/${runNotes.length})` : ""}</span>
                      </div>
                      <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#B4C0C7" }}>LLM evidence graph</div>
                        <MiniBar label="detection" value={m.detection} color={GREEN} />
                        <MiniBar label="assertion" value={m.assertionAcc} color={BLUE} />
                        <MiniBar label="subject" value={m.subjectAcc} color={VIOLET} />
                        <MiniBar label="precision" value={m.precision} color="#5C6C75" />
                        <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#B4C0C7", marginTop: 4 }}>MongoDB retrieval · {searchMode}</div>
                        <MiniBar label="concepts" value={m.retrievalRecall} color={AMBER} />
                      </div>
                      <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: "#5C6C75", flexWrap: "wrap" }}>
                        <span><strong style={{ color: INK }}>{m.tokensPerNote.toLocaleString()}</strong> tok/note</span>
                        <span><strong style={{ color: INK }}>{m.avgLatencyMs}</strong> ms/note</span>
                        {m.qualityPer1kTokens != null ? <span title="evidence-graph quality per 1k tokens"><strong style={{ color: INK }}>{m.qualityPer1kTokens.toFixed(2)}</strong> q/1k</span> : null}
                        {m.fallbacks > 0 ? <span style={{ color: AMBER }}>{m.fallbacks} fallback{m.fallbacks === 1 ? "" : "s"}</span> : null}
                      </div>
                      {onPickModel ? (
                        <button type="button" onClick={() => onPickModel(m.model)}
                          style={{ marginTop: 10, fontSize: 11.5, fontWeight: 700, color: sessionModel === m.model ? "#889397" : GREEN, background: "#fff", border: `1px solid ${sessionModel === m.model ? BORDER : GREEN}`, borderRadius: 7, padding: "4px 10px", cursor: "pointer" }}>
                          {sessionModel === m.model ? "✓ Session model" : "Use for session"}
                        </button>
                      ) : null}
                    </>
                  )}
              </div>
            ))}
          </div>

          {runNotes.length ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#5C6C75" }}>Per gold note × model — click a cell to inspect</span>
                <div style={{ display: "inline-flex", border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden", marginLeft: "auto" }}>
                  {[["quality", "Quality", GREEN], ["time", "Time", BLUE], ["tokens", "Tokens", VIOLET]].map(([k, label, color]) => (
                    <button key={k} type="button" onClick={() => setGridMetric(k)}
                      style={{ padding: "5px 12px", fontSize: 11.5, border: "none", cursor: "pointer", fontWeight: gridMetric === k ? 700 : 500,
                        background: gridMetric === k ? color : "#fff", color: gridMetric === k ? "#fff" : INK }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: 11, color: "#889397", margin: "0 0 8px" }}>
                {gridMetric === "quality" ? "Evidence-graph composite (higher is better)."
                  : gridMetric === "time" ? "Latency per note — greener is faster (lower is better)."
                  : "Extraction tokens per note — greener is fewer (lower is better). Note: token cost differs by model; latency is the model-agnostic effort signal."}
              </p>
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: `minmax(220px, 1.6fr) repeat(${selectedModels.length}, minmax(96px, 1fr))`, background: "#F7FAF9", borderBottom: `1px solid ${BORDER}`, fontSize: 11, fontWeight: 700, color: "#5C6C75" }}>
                  <div style={{ padding: "8px 12px" }}>Gold note</div>
                  {selectedModels.map((m) => <div key={m} style={{ padding: "8px 8px", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis" }}>{m}</div>)}
                </div>
                {runNotes.map((g) => {
                  const rowCells = selectedModels.map((m) => grid[key(m, g.id)]);
                  return (
                    <div key={g.id} style={{ display: "grid", gridTemplateColumns: `minmax(220px, 1.6fr) repeat(${selectedModels.length}, minmax(96px, 1fr))`, borderTop: `1px solid ${BORDER}` }}>
                      <div style={{ padding: "9px 12px" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{g.title}</div>
                        <div style={{ fontSize: 11, color: "#889397" }}>{g.factCount} facts · {g.conceptCount} concepts · {g.languageCode.toUpperCase()}</div>
                      </div>
                      {selectedModels.map((m, i) => {
                        const c = rowCells[i];
                        const good = cellGoodness(c, rowCells);
                        return (
                          <button key={m} type="button" onClick={() => c && setDrawer({ model: m, noteId: g.id })}
                            style={{ padding: "9px 8px", textAlign: "center", background: good != null ? tint(good) : "#fff", fontSize: 13, fontWeight: 700, color: good != null ? INK : "#C1C7CB", border: "none", borderLeft: `1px solid ${BORDER}`, cursor: c ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {cellDisplay(c)}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 11.5, color: "#889397", marginTop: 10 }}>
                Evidence-graph scores measure the LLM directly. Retrieval runs live against the scoped sample dataset.
                <code> fb</code> = fell back to deterministic (model couldn&apos;t produce valid output) · <code>⏱</code> = timed out (&gt;2 min) · <code>·</code> = pending.
              </p>
            </>
          ) : null}
        </>
      ) : null}

      {drawer ? (
        <InspectorDrawer note={gold.find((g) => g.id === drawer.noteId)} model={drawer.model} cell={grid[key(drawer.model, drawer.noteId)]} searchMode={searchMode} onClose={() => setDrawer(null)} />
      ) : null}
    </div>
  );
}

function PickerHeader({ label, count, onAll, onClear, disabled }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#5C6C75" }}>{label}</span>
      <span style={{ fontSize: 11, color: "#889397" }}>{count} selected</span>
      <button type="button" onClick={onAll} disabled={disabled} style={linkBtn}>Select all</button>
      <button type="button" onClick={onClear} disabled={disabled} style={linkBtn}>Clear</button>
    </div>
  );
}
function Chip({ on, disabled, onClick, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ padding: "6px 12px", fontSize: 12.5, borderRadius: 999, cursor: disabled ? "default" : "pointer", fontWeight: on ? 700 : 500,
        border: `1px solid ${on ? GREEN : BORDER}`, background: on ? "#E3FCEC" : "#fff", color: on ? GREEN : INK, opacity: disabled ? 0.7 : 1 }}>
      {children}
    </button>
  );
}

// Right-side inspector: note → model output → expected facts → score math.
function InspectorDrawer({ note, model, cell, searchMode, onClose }) {
  if (!note) return null;
  const scored = cell && cell.scored;
  const mentions = (cell?.mentions) || [];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,30,43,0.28)" }} />
      <div style={{ position: "relative", width: "min(500px, 94vw)", height: "100vh", background: "#fff", borderLeft: `1px solid ${BORDER}`, boxShadow: "-8px 0 24px rgba(0,0,0,0.10)", overflowY: "auto", padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: GREEN }}>Inspect · {model}</span>
          <button type="button" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, background: "none", border: "none", cursor: "pointer", color: "#5C6C75" }}>×</button>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: INK, margin: "2px 0 10px" }}>{note.title}</h3>

        {!cell ? <p style={sub}>Not run yet.</p> : !scored ? (
          <p style={{ ...sub, color: RED }}>This cell fell back to deterministic or errored ({cell.error || "fallback"}) — not scored.</p>
        ) : null}

        <Section title="Clinical note (input)">
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.5, color: INK, background: "#FAFBFB", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", margin: 0, fontFamily: "inherit" }}>{note.text}</pre>
        </Section>

        {scored ? (
          <>
            <Section title={`Model output — evidence graph (${mentions.length} mentions)`}>
              <div style={{ fontSize: 11, color: "#889397", margin: "0 0 6px" }}>
                <span style={{ color: GREEN, fontWeight: 800 }}>●</span> coded (present · patient) &nbsp;·&nbsp; <span style={{ fontWeight: 800 }}>○</span> context (negated / family — not coded)
              </div>
              {mentions.length ? mentions.map((g, i) => (
                <Row key={i} mark={g.present ? "●" : "○"} markColor={g.present ? GREEN : "#889397"}
                  main={<>“{g.verbatim || g.phrase}” {g.term ? <span style={{ color: "#889397" }}>→ {g.term}</span> : null}</>}
                  sub={`${g.assertion} · ${g.subject} · ${g.section}${g.phrase && g.verbatim && g.phrase !== g.verbatim ? ` · normalized: ${g.phrase}` : ""}`} />
              )) : <p style={sub}>No mentions extracted.</p>}
            </Section>

            <Section title="Expected facts (golden record)">
              {note.facts.map((f, i) => {
                const h = (cell.factHits || [])[i] || (cell.factHits || []).find((x) => x.phrase === f.phrase);
                const mark = h?.full ? "✓" : h?.detected ? "~" : "✗";
                const col = h?.full ? GREEN : h?.detected ? AMBER : RED;
                const detail = !h?.detected ? "not detected"
                  : `detected${h.assertionOk ? "" : `, assertion ${h.got?.assertion} ≠ ${f.assertion}`}${h.subjectOk ? "" : `, subject ${h.got?.subject} ≠ ${f.subject}`}`;
                return <Row key={i} mark={mark} markColor={col}
                  main={<>“{f.phrase}” <span style={{ color: "#889397" }}>{f.assertion} · {f.subject}{f.conceptId ? ` · #${f.conceptId}` : ""}</span></>}
                  sub={detail} />;
              })}
            </Section>

            <Section title="How the score was computed">
              <ScoreLine label="Detection" formula="facts found" value={cell.detection} color={GREEN} />
              <ScoreLine label="Assertion" formula="present/absent/… correct" value={cell.assertionAcc} color={BLUE} />
              <ScoreLine label="Subject" formula="patient vs family correct" value={cell.subjectAcc} color={VIOLET} />
              <ScoreLine label="Precision" formula="mentions matching a fact (info only — gold isn't exhaustive)" value={cell.precision} color="#5C6C75" />
              <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 6, paddingTop: 6 }}>
                <ScoreLine label="Evidence graph" formula="graph recall — facts detected with correct assertion + subject" value={cell.evidenceComposite} color={INK} bold />
                <ScoreLine label={`Retrieval (${searchMode})`} formula={cell.inScopeCount ? `${(cell.retrievalHits || []).filter((h) => h.hit && h.inScope).length} / ${cell.inScopeCount} in-scope${cell.outOfScopeCount ? ` · ${cell.outOfScopeCount} out-of-scope (controlled)` : ""}` : (cell.outOfScopeCount ? `all ${cell.outOfScopeCount} concepts out of demo scope (controlled)` : "no expected concepts")} value={cell.retrievalRecall} color={AMBER} />
                {(cell.retrievalHits || []).some((h) => !h.inScope) ? (
                  <div style={{ fontSize: 11, color: "#889397", marginTop: 4 }}>
                    Out of demo scope (concept not in the sidecar — controlled): {(cell.retrievalHits || []).filter((h) => !h.inScope).map((h) => `${h.term} #${h.conceptId}`).join("; ")}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, color: "#5C6C75" }}>
                <span><strong style={{ color: INK }}>{cell.tokens?.toLocaleString?.() ?? cell.tokens}</strong> tokens</span>
                <span><strong style={{ color: INK }}>{cell.ms}</strong> ms</span>
                {cell.extraMentions ? <span style={{ color: AMBER }}>{cell.extraMentions} extra mention{cell.extraMentions === 1 ? "" : "s"}</span> : null}
              </div>
            </Section>

            {(cell.llmPrompt || cell.llmRaw) ? (
              <Section title="LLM request & response (log)">
                <details style={{ marginBottom: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: VIOLET }}>Prompt sent</summary>
                  <pre style={preStyle}>{cell.llmPrompt}</pre>
                </details>
                <details open>
                  <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: VIOLET }}>Raw model response</summary>
                  <pre style={preStyle}>{cell.llmRaw}</pre>
                </details>
              </Section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

const preStyle = { whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, lineHeight: 1.5, color: INK, background: "#FAFBFB", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", margin: "6px 0 0", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", maxHeight: 260, overflow: "auto" };

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#5C6C75", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ main, sub, mark, markColor }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0", fontSize: 12.5 }}>
      <span style={{ color: markColor, fontWeight: 800, width: 14, flexShrink: 0 }}>{mark}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: INK }}>{main}</div>
        {sub ? <div style={{ fontSize: 11, color: "#889397" }}>{sub}</div> : null}
      </div>
    </div>
  );
}
function ScoreLine({ label, formula, value, color, bold }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
      <span style={{ width: 150, color: "#5C6C75", fontWeight: bold ? 800 : 500 }}>{label}</span>
      <span style={{ flex: 1, color: "#889397", fontSize: 11 }}>{formula}</span>
      <span style={{ color, fontWeight: 800 }}>{pct(value)}</span>
    </div>
  );
}

const sub = { fontSize: 12.5, color: "#5C6C75", margin: "4px 0" };
const linkBtn = { fontSize: 11, fontWeight: 700, color: BLUE, background: "none", border: "none", cursor: "pointer", padding: 0 };
