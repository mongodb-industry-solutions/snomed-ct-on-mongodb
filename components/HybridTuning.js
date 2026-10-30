"use client";

import { useCallback, useEffect, useState } from "react";
import Badge from "@leafygreen-ui/badge";

// Hybrid search fusion tuning, shared across the session: the navigator search,
// Ground a Note retrieval, and the benchmark all send the same `tuning` object
// so a weight change applies everywhere. Persisted to localStorage alongside
// the session model; the server clamps every value and echoes back what it used.

const INK = "#001E2B";
const GREEN = "#00684A";
const BORDER = "#e3e7ea";

const STORAGE_KEY = "hybridTuning";
const TUNING_KEYS = ["fusionMode", "lexicalWeight", "semanticWeight", "rrfK", "candidatePool", "rerank", "rerankPool"];

export function isDefaultTuning(tuning, defaults) {
  if (!tuning || !defaults) return true;
  return TUNING_KEYS.every((key) => defaults[key] === tuning[key]);
}

// Only the knobs the user changed travel with a request. Pool sizes in
// particular differ per surface (grounding uses a smaller per-phrase pool), so
// an untouched default must not override the server's surface-specific value.
export function tuningOverrides(tuning, defaults) {
  if (!tuning) return null;
  if (!defaults) return null;
  const out = {};
  for (const key of TUNING_KEYS) {
    if (tuning[key] !== defaults[key]) out[key] = tuning[key];
  }
  return Object.keys(out).length ? out : null;
}

export function restoreTuning(defaults, saved) {
  const merged = { ...defaults };
  const versioned = saved?.version === 2;
  const overrides = versioned ? saved.overrides : saved;
  if (overrides && typeof overrides === "object") {
    for (const key of TUNING_KEYS) {
      // Old snapshots saved every default, including native rankFusion, when
      // the user changed any knob. Let that inherited mode follow the new
      // default; new explicit native choices remain saved as overrides.
      if (!versioned && key === "fusionMode" && overrides[key] === "rankFusion") continue;
      if (key in overrides) merged[key] = overrides[key];
    }
  }
  return merged;
}

// Session-wide tuning state: server defaults from GET /api/navigator-search,
// overlaid with whatever the user saved this browser session.
export function useHybridTuning() {
  const [defaults, setDefaults] = useState(null);
  const [tuning, setTuningState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/navigator-search")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.tuning) return;
        let saved = null;
        try { saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"); } catch (_e) { /* ignore */ }
        const merged = restoreTuning(data.tuning, saved);
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, overrides: tuningOverrides(merged, data.tuning) || {} })); } catch (_e) { /* localStorage unavailable */ }
        setDefaults(data.tuning);
        setTuningState(merged);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setTuning = useCallback((next) => {
    setTuningState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      try {
        const persisted = { version: 2, overrides: tuningOverrides(value, defaults) || {} };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      } catch (_e) { /* localStorage unavailable */ }
      return value;
    });
  }, [defaults]);

  return { tuning, setTuning, defaults };
}

const FUSION_MODE_LABELS = {
  rankFusion: "$rankFusion (native, rank-based)",
  scoreFusion: "$scoreFusion (native, score-based)",
  appRrf: "App-side RRF (two queries)"
};

// Hybrid fusion controls. Values are sent with every hybrid search; the server
// clamps them to the same ranges as the env config and echoes back what it used.
export function HybridTuningPanel({ open, setOpen, tuning, setTuning, defaults, canRerun, onRerun, rerunLabel = "Re-run search", scopeNote = null }) {
  const set = (key, value) => setTuning((current) => ({ ...current, [key]: value }));
  const total = tuning.lexicalWeight + tuning.semanticWeight;
  const lexPct = total > 0 ? Math.round((tuning.lexicalWeight / total) * 100) : 50;
  const isDefault = isDefaultTuning(tuning, defaults);
  // One slider for the balance; weights are stored as lexical = x, semantic = 1 - x.
  const setBalance = (pct) => setTuning((current) => ({
    ...current,
    lexicalWeight: Math.round(pct) / 100,
    semanticWeight: Math.round(100 - pct) / 100
  }));
  const modes = Array.isArray(tuning.fusionModes) ? tuning.fusionModes : Object.keys(FUSION_MODE_LABELS);

  return (
    <div style={{ ...scopePanel, maxWidth: 760, padding: 0, overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={queryPlanToggle}>
        <span style={{ fontWeight: 800, color: INK, fontSize: 13 }}>Fusion tuning</span>
        <Badge variant="lightgray">{tuning.fusionMode}</Badge>
        <span style={{ fontSize: 12, color: "#5C6C75" }}>
          lexical {lexPct}% · semantic {100 - lexPct}%{tuning.fusionMode === "scoreFusion" ? "" : ` · k=${tuning.fusionMode === "rankFusion" ? 60 : tuning.rrfK}`} · rerank {tuning.rerank ? "on" : "off"}
        </span>
        {!isDefault ? <Badge variant="yellow">custom</Badge> : null}
        <span style={exampleSectionState}>{open ? "Hide" : "Tune"}</span>
      </button>
      {open ? (
        <div style={{ ...queryPlanBody, display: "grid", gap: 12 }}>
          <label style={fieldLabel}>
            Fusion method
            <select style={smallSelect} value={tuning.fusionMode} onChange={(e) => set("fusionMode", e.target.value)}>
              {modes.map((m) => <option key={m} value={m}>{FUSION_MODE_LABELS[m] || m}</option>)}
            </select>
          </label>
          <div style={{ fontSize: 11.5, color: "#5C6C75", marginTop: -6 }}>
            {tuning.fusionMode === "scoreFusion"
              ? "Blends each engine's sigmoid-normalized relevance score: score = Σ weight × sigmoid(score). Requires a MongoDB version with $scoreFusion; otherwise the search falls back to app-side RRF."
              : tuning.fusionMode === "rankFusion"
                ? "Blends rank positions in one aggregation: score = Σ weight / (60 + rank). MongoDB fixes k at 60."
                : "Runs MongoDB Search and Vector Search as two queries and blends them in the app: score = Σ weight / (k + rank)."}
          </div>
          <label style={fieldLabel}>
            Engine balance — lexical {lexPct}% / semantic {100 - lexPct}%
            <input type="range" min={0} max={100} step={5} value={lexPct} onChange={(e) => setBalance(Number(e.target.value))} />
            <span style={{ display: "flex", justifyContent: "space-between", fontWeight: 500, textTransform: "none" }}>
              <span>← all semantic (meaning)</span>
              <span>all lexical (keywords) →</span>
            </span>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label style={fieldLabel}>
              RRF k {tuning.fusionMode === "appRrf" ? "" : "(app-side only)"}
              <input type="number" min={1} max={1000} style={smallInput} value={tuning.rrfK}
                disabled={tuning.fusionMode !== "appRrf"}
                onChange={(e) => set("rrfK", Number(e.target.value))} />
            </label>
            <label style={fieldLabel}>
              Candidates per engine
              <input type="number" min={5} max={200} style={smallInput} value={tuning.candidatePool}
                onChange={(e) => set("candidatePool", Number(e.target.value))} />
            </label>
            <label style={fieldLabel}>
              Rerank pool
              <input type="number" min={5} max={200} style={smallInput} value={tuning.rerankPool}
                disabled={!tuning.rerank}
                onChange={(e) => set("rerankPool", Number(e.target.value))} />
            </label>
            <label style={{ ...fieldLabel, alignContent: "end" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={tuning.rerank} onChange={(e) => set("rerank", e.target.checked)} />
                Voyage rerank
              </span>
            </label>
          </div>
          <div style={{ fontSize: 11.5, color: "#5C6C75" }}>
            Lower k sharpens the gap between rank 1 and rank 10; higher k flattens it. When rerank is on and available, the cross-encoder sets the final order — the weights decide which candidates reach it. Turn rerank off to see the pure fusion order.
          </div>
          {scopeNote ? <div style={{ fontSize: 11.5, color: "#5C6C75" }}>{scopeNote}</div> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={ghostBtn} disabled={!defaults || isDefault}
              onClick={() => setTuning(defaults)}>Reset to defaults</button>
            {onRerun ? (
              <button type="button" style={{ ...primaryBtn, padding: "5px 12px", fontSize: 12, opacity: canRerun ? 1 : 0.5 }}
                disabled={!canRerun} onClick={onRerun}>{rerunLabel}</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// One-line statement of the algorithm the server actually ran — which can
// differ from the requested one when native fusion falls back.
export function FusionSummary({ plan, algorithm }) {
  const a = algorithm || plan?.algorithm;
  if (!a) return null;
  const total = (a.weights?.lexical || 0) + (a.weights?.semantic || 0);
  const pct = (w) => (total > 0 ? Math.round((w / total) * 100) : 0);
  return (
    <div style={{ ...scopeLatencyBox, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <strong>{a.method}</strong>
      <code style={inlineCode}>{a.formula}</code>
      <span>lexical {a.weights.lexical} ({pct(a.weights.lexical)}%) · semantic {a.weights.semantic} ({pct(a.weights.semantic)}%)</span>
      <span>· {a.candidatePool} candidates per engine</span>
      <span>· {a.rerank.applied ? `Voyage rerank of top ${a.rerank.pool}` : a.rerank.requested ? "rerank unavailable" : "rerank off"}</span>
      <Badge variant="lightgray">{a.engine}</Badge>
      {a.fallbackReason ? (
        <span style={{ color: "#8A6D1F", width: "100%" }}>Native fusion fell back to app-side RRF: {a.fallbackReason}</span>
      ) : null}
    </div>
  );
}

// Per-result "why is this here": each engine's rank, weight, and contribution
// to the fused score, plus how far rerank moved it.
export function FusionBreakdown({ row }) {
  const f = row?.fusion;
  if (!f) return null;
  const part = (label, p) => {
    if (!p?.rank) return <span key={label}>{label}: —</span>;
    const contribution = typeof p.contribution === "number" && f.method === "rrf" ? ` → ${p.contribution.toFixed(4)}` : "";
    return <span key={label}>{label} #{p.rank} × {p.weight}{contribution}</span>;
  };
  const moved = row.fusedRank && typeof row.rerankScore === "number" ? row.fusedRank : null;
  return (
    <div style={{ fontSize: 10.5, color: "#5C6C75", marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e3e7ea", display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
      {part("lexical", f.lexical)}
      {part("semantic", f.semantic)}
      {typeof f.score === "number" ? <span>fused {f.score.toFixed(4)}</span> : null}
      {moved ? <span>fusion rank #{moved}</span> : null}
    </div>
  );
}

const fieldLabel = { display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "#5C6C75", textTransform: "uppercase" };
const primaryBtn = { background: GREEN, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const queryPlanBody = { borderTop: `1px solid ${BORDER}`, padding: 10, background: "#fbfdfc" };
const scopeLatencyBox = { fontSize: 11.5, color: "#0F3D2E", background: "#F1FAF5", border: "1px solid #CBEBDB", borderRadius: 8, padding: "6px 10px", margin: "0 0 12px" };
const scopePanel = { width: "100%", marginTop: 10, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 10, background: "#fbfdfc" };
const exampleSectionState = { marginLeft: "auto", color: GREEN, fontSize: 12, fontWeight: 800 };
const ghostBtn = { background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#5C6C75" };
const inlineCode = { display: "inline-block", maxWidth: "100%", overflowWrap: "anywhere", background: "#F4F7F6", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "3px 6px", color: INK, fontSize: 11 };
const queryPlanToggle = { width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "#fff", padding: "8px 10px", cursor: "pointer", textAlign: "left" };
const smallInput = { width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 9px", color: INK, fontSize: 13, outline: "none", textTransform: "none", fontWeight: 500 };
const smallSelect = { width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 9px", color: INK, fontSize: 12, background: "#fff" };
