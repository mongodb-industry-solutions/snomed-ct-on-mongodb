"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Badge from "@leafygreen-ui/badge";
const Code = dynamic(() => import("@leafygreen-ui/code"), { ssr: false });
import ConceptHierarchyFlow from "@/components/ConceptHierarchyFlow";
import ConceptBrowser from "@/components/ConceptBrowser";

// Search & Navigate, three states:
//  1) Landing  — a centered search box + suggestions (search-engine style).
//  2) Browse   — search results as concept cards.
//  3) Focus    — one concept: is-a graph + descriptions in the center, all
//                details in a collapsible right "curtain", with a breadcrumb
//                back to search.
// Self-contained: talks to /api/navigator-search and /api/hierarchy directly.

const SUGGESTIONS = [
  { label: "Type 2 diabetes", query: "type 2 diabetes", languageCode: "en" },
  { label: "Carcinoma de mama", query: "carcinoma de mama", languageCode: "es" },
  { label: "Myocardial infarction", query: "myocardial infarction", languageCode: "en" },
  { label: "Atrial fibrillation", query: "atrial fibrillation", languageCode: "en" },
  { label: "Cáncer de pulmón", query: "cáncer de pulmón", languageCode: "es" },
  { label: "Heart failure", query: "heart failure", languageCode: "en" }
];

// Natural-language queries that share few or no tokens with the official SNOMED
// preferred terms — these only resolve well through semantic (vector) retrieval
// + rerank, so they showcase the hybrid mode. One click runs them in hybrid.
// All chosen so their best semantic match is a concept that exists in the
// scoped term sidecar (cardiovascular / oncology / diabetes branches).
const NLP_EXAMPLES = [
  { label: "high blood sugar", query: "high blood sugar", languageCode: "en" },
  { label: "irregular heartbeat", query: "irregular heartbeat", languageCode: "en" },
  { label: "hardening of the arteries", query: "hardening of the arteries", languageCode: "en" },
  { label: "leaky heart valve", query: "leaky heart valve", languageCode: "en" },
  { label: "mini stroke", query: "mini stroke", languageCode: "en" },
  { label: "azúcar alta en sangre", query: "azucar alta en sangre", languageCode: "es" }
];

const ECL_EXAMPLES = [
  { label: "Clinical findings", ecl: "<< 404684003" },
  { label: "Cardiovascular disorders", ecl: "<< 49601007" },
  { label: "Clinical findings minus neoplasms", ecl: "<< 404684003 MINUS << 363346000" },
  { label: "Findings at heart structure", ecl: "<< 404684003 : 363698007 = << 80891009" },
  { label: "Findings at breast structure", ecl: "<< 404684003 : 363698007 = << 76752008" },
  { label: "Procedures at heart structure", ecl: "<< 71388002 : 363704007 = << 80891009" }
];

const SCOPED_SEARCH_EXAMPLES = [
  {
    id: "heart-findings",
    marker: "ATTR",
    title: "Heart findings",
    query: "cardiaca",
    languageCode: "es",
    mode: "hybrid",
    scope: { areaConceptId: "", ecl: "<< 404684003 : 363698007 = << 80891009" },
    scopeLabel: "Clinical finding + finding site heart structure"
  },
  {
    id: "cardio-disorders",
    marker: "ECL",
    title: "Cardiovascular disorders",
    query: "heart failure",
    languageCode: "en",
    mode: "hybrid",
    scope: { areaConceptId: "49601007", ecl: "" },
    scopeLabel: "Descendants of cardiovascular disorder"
  },
  {
    id: "breast-findings",
    marker: "ATTR",
    title: "Breast findings",
    query: "carcinoma",
    languageCode: "en",
    mode: "hybrid",
    scope: { areaConceptId: "", ecl: "<< 404684003 : 363698007 = << 76752008" },
    scopeLabel: "Clinical finding + finding site breast structure"
  },
  {
    id: "heart-procedures",
    marker: "ATTR",
    title: "Heart procedures",
    query: "bypass",
    languageCode: "en",
    mode: "hybrid",
    scope: { areaConceptId: "", ecl: "<< 71388002 : 363704007 = << 80891009" },
    scopeLabel: "Procedure + procedure site heart structure"
  },
  {
    id: "non-neoplasm-findings",
    marker: "MINUS",
    title: "Findings excluding neoplasms",
    query: "pain",
    languageCode: "en",
    mode: "lexical",
    scope: { areaConceptId: "", ecl: "<< 404684003 MINUS << 363346000" },
    scopeLabel: "Clinical findings with neoplasms removed"
  },
  {
    id: "products",
    marker: "AREA",
    title: "Medicinal products",
    query: "insulin",
    languageCode: "en",
    mode: "hybrid",
    scope: { areaConceptId: "373873005", ecl: "" },
    scopeLabel: "Descendants of pharmaceutical / biologic product"
  }
];

const ECL_FOCUS_OPTIONS = [
  { label: "Clinical finding", value: "<< 404684003" },
  { label: "Disorder", value: "<< 64572001" },
  { label: "Procedure", value: "<< 71388002" },
  { label: "Product", value: "<< 373873005" }
];

const ECL_ATTRIBUTE_OPTIONS = [
  { label: "Finding site", value: "363698007" },
  { label: "Associated morphology", value: "116676008" },
  { label: "Causative agent", value: "246075003" },
  { label: "Procedure site", value: "363704007" },
  { label: "Method", value: "260686004" }
];

const ECL_TARGET_OPTIONS = [
  { label: "Heart structure", value: "<< 80891009" },
  { label: "Breast structure", value: "<< 76752008" },
  { label: "Lung structure", value: "<< 39607008" },
  { label: "Malignant neoplasm", value: "<< 367651003" },
  { label: "Bacteria", value: "<< 409822003" }
];

const INK = "#001E2B";
const GREEN = "#00684A";
const BORDER = "#e3e7ea";
const SLOW_SCOPE_NOTICE_MS = 1200;

// Lightweight ES/EN detector for the "Auto" language mode: Spanish-specific
// characters or common clinical stopwords tip the query to "es", else "en".
const ES_HINT = /[áéíóúñ¿¡]|(^|\s)(de|del|con|sin|por|dolor|derech[oa]|izquierd[oa]|cáncer|corazón|diabético|crónic[oa])(\s|$)/i;
function detectLanguage(text) {
  return ES_HINT.test(String(text || "")) ? "es" : "en";
}

function semanticTagOf(concept) {
  if (concept?.semanticTag) return concept.semanticTag;
  const m = /\(([^)]+)\)\s*$/.exec(concept?.fullySpecifiedName || "");
  return m ? m[1] : null;
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

export default function NavigateWorkbench({ defaultLanguageCode = "en", seed = null }) {
  const [languageCode, setLanguageCode] = useState(defaultLanguageCode || "auto");
  const [mode, setMode] = useState("hybrid");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState([]);
  const [searchState, setSearchState] = useState({ loading: false, error: "" });
  const [searchMeta, setSearchMeta] = useState({ scope: null, stats: null, releaseId: "" });
  const [scopeWarmup, setScopeWarmup] = useState({ active: false, slow: false, expression: "" });
  const [queryPlanOpen, setQueryPlanOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scope, setScope] = useState({ areaConceptId: "", ecl: "" });
  const [expandedScopedExampleId, setExpandedScopedExampleId] = useState("");
  const [expandedExampleGroup, setExpandedExampleGroup] = useState("basic");

  // Resolve "auto" to a concrete language once, so the concept inspector's
  // history / value-set / API calls never send the literal "auto" (which no
  // description matches, silently mis-selecting the preferred term).
  const effectiveLanguage = languageCode === "auto" ? detectLanguage(submitted || query) : languageCode;

  const [concept, setConcept] = useState(null);
  const [hierData, setHierData] = useState({ ancestorChain: [], ancestorNeighbors: [] });
  const [conceptState, setConceptState] = useState({ loading: false, error: "" });
  const [tagFilter, setTagFilter] = useState("all");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [focusTab, setFocusTab] = useState("graph");
  const [inspectorTab, setInspectorTab] = useState("summary");
  const [history, setHistory] = useState({ loading: false, error: "", items: [] });
  const [valueSet, setValueSet] = useState({ loading: false, error: "", members: [], total: 0 });
  const [valueSetFilter, setValueSetFilter] = useState("");
  const [valueSetTagFilter, setValueSetTagFilter] = useState("all");
  const [valueSetSort, setValueSetSort] = useState("term");

  const runSearch = useCallback(async (q, lang, m, scopeOverride = null) => {
    const text = String(q || "").trim();
    if (!text) return;
    const searchMode = m || mode;
    const activeScope = scopeOverride || scope;
    const areaConceptId = String(activeScope.areaConceptId || "").trim();
    const ecl = String(activeScope.ecl || "").trim();
    setSubmitted(text);
    setResults([]);
    setTagFilter("all");
    setSearchState({ loading: true, error: "" });
    setQueryPlanOpen(false);
    setSearchMeta({ scope: null, stats: null, releaseId: "", mode: searchMode, reranked: false, queryPlan: null });
    const scopedExpression = ecl || (areaConceptId ? `<< ${areaConceptId}` : "");
    let scopeTimer = null;
    if (scopedExpression) {
      setScopeWarmup({ active: true, slow: false, expression: scopedExpression });
      scopeTimer = window.setTimeout(() => {
        setScopeWarmup((current) => (
          current.active && current.expression === scopedExpression
            ? { ...current, slow: true }
            : current
        ));
      }, SLOW_SCOPE_NOTICE_MS);
    } else {
      setScopeWarmup({ active: false, slow: false, expression: "" });
    }
    const requested = lang || languageCode;
    const effectiveLang = requested === "auto" ? detectLanguage(text) : requested;
    try {
      const res = await fetch("/api/navigator-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: text,
          languageCode: effectiveLang,
          mode: searchMode,
          limit: 24,
          ...(areaConceptId ? { areaConceptId } : {}),
          ...(ecl ? { ecl } : {})
        })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setResults(Array.isArray(data.results) ? data.results : []);
      setSearchMeta({
        scope: data.scope || null,
        stats: data.stats || null,
        releaseId: data.releaseId || "",
        mode: data.mode || searchMode,
        reranked: Boolean(data.reranked),
        queryPlan: data.queryPlan || null
      });
      setSearchState({ loading: false, error: "" });
    } catch (error) {
      setSearchState({ loading: false, error: error?.message || "Search failed" });
    } finally {
      if (scopeTimer) window.clearTimeout(scopeTimer);
      setScopeWarmup({ active: false, slow: false, expression: "" });
    }
  }, [languageCode, mode, scope.areaConceptId, scope.ecl]);

  const resetStagedSearch = useCallback((nextMode = mode) => {
    setSubmitted("");
    setResults([]);
    setTagFilter("all");
    setQueryPlanOpen(false);
    setSearchState({ loading: false, error: "" });
    setSearchMeta({ scope: null, stats: null, releaseId: "", mode: nextMode, reranked: false, queryPlan: null });
    setScopeWarmup({ active: false, slow: false, expression: "" });
  }, [mode]);

  const stageScopedExample = useCallback((example) => {
    const nextScope = {
      areaConceptId: example.scope?.areaConceptId || "",
      ecl: example.scope?.ecl || ""
    };
    const nextMode = example.mode || "hybrid";
    setExpandedScopedExampleId(example.id);
    setScopeOpen(true);
    setScope(nextScope);
    setQuery(example.query);
    setLanguageCode(example.languageCode);
    setMode(nextMode);
    resetStagedSearch(nextMode);
  }, [resetStagedSearch]);

  const stageSimpleExample = useCallback((example, nextMode) => {
    const emptyScope = { areaConceptId: "", ecl: "" };
    const searchMode = nextMode || mode;
    setExpandedScopedExampleId("");
    setScopeOpen(false);
    setScope(emptyScope);
    setQuery(example.query);
    setLanguageCode(example.languageCode);
    setMode(searchMode);
    resetStagedSearch(searchMode);
  }, [mode, resetStagedSearch]);

  const openConcept = useCallback(async (conceptId, lang) => {
    const id = String(conceptId || "").trim();
    if (!id) return;
    setConcept({ conceptId: id });
    setConceptState({ loading: true, error: "" });
    setInspectorOpen(true);
    const requested = lang || languageCode;
    const effectiveLang = requested === "auto" ? detectLanguage(submitted || query) : requested;
    try {
      const res = await fetch("/api/hierarchy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conceptId: id, languageCode: effectiveLang })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setConcept(data.concept || { conceptId: id });
      setHierData({
        ancestorChain: Array.isArray(data.ancestorChain) ? data.ancestorChain : [],
        ancestorNeighbors: Array.isArray(data.graph?.neighbors) ? data.graph.neighbors : []
      });
      setConceptState({ loading: false, error: "" });
    } catch (error) {
      setConceptState({ loading: false, error: error?.message || "Concept load failed" });
    }
  }, [languageCode, submitted, query]);

  // Seed a concept from another tab (e.g. grounding "open in navigate").
  useEffect(() => {
    if (seed?.conceptId) openConcept(seed.conceptId, seed.languageCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.conceptId]);

  // Lazy-load release history when the History tab is opened.
  useEffect(() => {
    const id = concept?.conceptId;
    if (!id || inspectorTab !== "history") return;
    let cancelled = false;
    setHistory({ loading: true, error: "", items: [] });
    fetch(`/api/concept-history?conceptId=${encodeURIComponent(id)}&languageCode=${effectiveLanguage}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.ok === false) throw new Error(d.error || "History failed");
        const items = Array.isArray(d.history) ? d.history : (Array.isArray(d.entries) ? d.entries : []);
        setHistory({ loading: false, error: "", items });
      })
      .catch((e) => { if (!cancelled) setHistory({ loading: false, error: e?.message || "History failed", items: [] }); });
    return () => { cancelled = true; };
  }, [concept?.conceptId, inspectorTab, effectiveLanguage]);

  // Lazy-expand the value set (descendants) when the Value set tab is opened.
  useEffect(() => {
    const id = concept?.conceptId;
    if (!id || inspectorTab !== "valueset") return;
    let cancelled = false;
    setValueSet({ loading: true, error: "", members: [], total: 0 });
    setValueSetFilter("");
    setValueSetTagFilter("all");
    fetch("/api/ecl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "expand", expr: `<< ${id}`, languageCode: effectiveLanguage, limit: 200 })
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.ok === false) throw new Error(d.error || "Value set failed");
        const members = Array.isArray(d.concepts) ? d.concepts : [];
        setValueSet({ loading: false, error: "", members, total: d.stats?.totalExpanded ?? members.length });
      })
      .catch((e) => { if (!cancelled) setValueSet({ loading: false, error: e?.message || "Value set failed", members: [], total: 0 }); });
    return () => { cancelled = true; };
  }, [concept?.conceptId, inspectorTab, effectiveLanguage]);

  const backToSearch = () => {
    setConcept(null);
    setConceptState({ loading: false, error: "" });
  };
  const resetAll = () => {
    backToSearch();
    setSubmitted("");
    setResults([]);
    setQuery("");
    setSearchMeta({ scope: null, stats: null, releaseId: "" });
    setScopeWarmup({ active: false, slow: false, expression: "" });
  };

  const tags = useMemo(() => {
    const set = new Set(results.map((r) => r.semanticTag).filter(Boolean));
    return ["all", ...Array.from(set)];
  }, [results]);
  const visibleResults = tagFilter === "all" ? results : results.filter((r) => r.semanticTag === tagFilter);
  const valueSetTags = useMemo(() => {
    const set = new Set(valueSet.members.map((m) => m.semanticTag).filter(Boolean));
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [valueSet.members]);
  const visibleValueSetMembers = useMemo(() => {
    const needle = normalizeText(valueSetFilter);
    const filtered = valueSet.members.filter((member) => {
      if (valueSetTagFilter !== "all" && member.semanticTag !== valueSetTagFilter) return false;
      if (!needle) return true;
      const haystack = normalizeText(`${member.term || ""} ${member.fsn || ""} ${member.conceptId || ""}`);
      return haystack.includes(needle);
    });

    filtered.sort((left, right) => {
      if (valueSetSort === "semanticTag") {
        const tagDiff = String(left.semanticTag || "").localeCompare(String(right.semanticTag || ""));
        if (tagDiff !== 0) return tagDiff;
      } else if (valueSetSort === "sctid") {
        const idDiff = String(left.conceptId || "").localeCompare(String(right.conceptId || ""));
        if (idDiff !== 0) return idDiff;
      } else if (valueSetSort === "parents") {
        const parentDiff = Number(right.parentCount || 0) - Number(left.parentCount || 0);
        if (parentDiff !== 0) return parentDiff;
      }
      const termDiff = String(left.term || "").localeCompare(String(right.term || ""));
      if (termDiff !== 0) return termDiff;
      return String(left.conceptId || "").localeCompare(String(right.conceptId || ""));
    });

    return filtered;
  }, [valueSet.members, valueSetFilter, valueSetSort, valueSetTagFilter]);
  const hasScope = Boolean(String(scope.areaConceptId || "").trim() || String(scope.ecl || "").trim());

  // ---------- FOCUS VIEW ----------
  if (concept) {
    const tag = semanticTagOf(concept);
    const term = concept.preferredTerm || concept.term || concept.fullySpecifiedName || concept.conceptId;
    const synonyms = Array.isArray(concept.synonymPreview) ? concept.synonymPreview : [];
    return (
      <div>
        <Breadcrumb term={term} onSearch={resetAll} onResults={submitted ? backToSearch : null} submitted={submitted} />
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>{term}</div>
              <div style={{ fontSize: 12, color: "#5C6C75", marginTop: 4 }}>
                {tag ? <Badge variant="green">{tag}</Badge> : null}
                <span style={{ marginLeft: 8 }}>#{concept.conceptId}</span>
                {concept.active === false ? <span style={{ ...pill("#DB3030"), marginLeft: 8 }}>inactive</span> : null}
              </div>
            </div>
            {conceptState.loading ? <p style={sub}>Loading concept…</p> : null}
            {conceptState.error ? <p style={errBox}>{conceptState.error}</p> : null}

            {/* Concept visualization sub-tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {[
                { key: "graph", label: "Graph" },
                { key: "hierarchy", label: "Hierarchy" },
                { key: "table", label: "Table" },
                { key: "relationships", label: `Relationships${concept.relationshipCount ? ` (${concept.relationshipCount})` : ""}` },
                { key: "api", label: "API" }
              ].map((t) => (
                <button key={t.key} type="button" onClick={() => setFocusTab(t.key)}
                  style={focusTab === t.key ? chipActive : chip}>{t.label}</button>
              ))}
            </div>

            {focusTab === "graph" ? (
              <>
                <ConceptHierarchyFlow concept={concept} onNavigate={(id) => openConcept(id)} />
                <p style={{ ...sub, marginTop: 8 }}>
                  Rendered from precomputed <code>parentIds</code> / <code>ancestorIds</code> arrays on the concept document — no graph engine required for navigation or subsumption.
                </p>
              </>
            ) : null}

            {focusTab === "hierarchy" ? (
              <ConceptBrowser
                concept={concept}
                ancestorChain={hierData.ancestorChain}
                ancestorNeighbors={hierData.ancestorNeighbors}
                onNavigate={(id) => openConcept(id)}
                loading={conceptState.loading}
              >
                {concept.children || []}
              </ConceptBrowser>
            ) : null}

            {focusTab === "table" ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#5C6C75", borderBottom: `1px solid ${BORDER}` }}>
                      <th style={{ padding: "8px 6px" }}>Relation</th>
                      <th style={{ padding: "8px 6px" }}>Term</th>
                      <th style={{ padding: "8px 6px" }}>Semantic tag</th>
                      <th style={{ padding: "8px 6px" }}>Concept ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(concept.parents || []).map((p) => (
                      <tr key={`p-${p.conceptId}`} style={rowStyle} onClick={() => openConcept(p.conceptId)}>
                        <td style={td}><Badge variant="blue">parent</Badge></td>
                        <td style={td}>{p.term}</td>
                        <td style={td}>{p.semanticTag || "—"}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>#{p.conceptId}</td>
                      </tr>
                    ))}
                    {(concept.children || []).map((c) => (
                      <tr key={`c-${c.conceptId}`} style={rowStyle} onClick={() => openConcept(c.conceptId)}>
                        <td style={td}><Badge variant="lightgray">child</Badge></td>
                        <td style={td}>{c.term}</td>
                        <td style={td}>{c.semanticTag || "—"}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>#{c.conceptId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {focusTab === "relationships" ? (
              <div style={{ display: "grid", gap: 6 }}>
                {(concept.relationshipPreview || []).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 13, alignItems: "baseline" }}>
                    <span style={{ color: "#5C6C75", minWidth: 130 }}>{r.typeTerm || r.typeId}</span>
                    <button type="button" style={{ ...crumbLink, textAlign: "left" }} onClick={() => r.destinationId && openConcept(r.destinationId)}>
                      {r.destinationTerm || r.destinationId}
                    </button>
                    <span style={{ color: "#889397", fontSize: 11 }}>{r.destinationSemanticTag || ""}{r.group ? ` · group ${r.group}` : ""}</span>
                  </div>
                ))}
                {(concept.relationshipPreview || []).length === 0 ? <p style={sub}>No relationship preview available.</p> : null}
              </div>
            ) : null}

            {focusTab === "api" ? (
              <div style={{ display: "grid", gap: 16 }}>
                <p style={sub}>The API calls behind this view — contextual to <code>#{concept.conceptId}</code>.</p>
                <ApiCall
                  title="Concept + hierarchy"
                  method="POST" path="/api/hierarchy"
                  body={{ conceptId: concept.conceptId, languageCode: effectiveLanguage }}
                />
                <ApiCall
                  title="Value set — expand descendants (ECL)"
                  method="POST" path="/api/ecl"
                  body={{ mode: "expand", expr: `<< ${concept.conceptId}`, languageCode: effectiveLanguage, limit: 200 }}
                />
                <ApiCall
                  title="Lexical search"
                  method="POST" path="/api/navigator-search"
                  body={{
                    query: submitted || concept.preferredTerm || "",
                    languageCode: effectiveLanguage,
                    limit: 24,
                    ...(String(scope.areaConceptId || "").trim() ? { areaConceptId: String(scope.areaConceptId).trim() } : {}),
                    ...(String(scope.ecl || "").trim() ? { ecl: String(scope.ecl).trim() } : {})
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Right detail curtain */}
          <button type="button" onClick={() => setInspectorOpen((v) => !v)} style={curtainHandle}>
            {inspectorOpen ? "›" : "‹"}
          </button>
          {inspectorOpen ? (
            <aside style={curtain}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <strong style={{ color: INK, fontSize: 14 }}>Concept details</strong>
                <button type="button" onClick={() => setInspectorOpen(false)} style={ghostBtn}>Collapse</button>
              </div>

              {/* Identity (always visible) */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {tag ? <Badge variant="green">{tag}</Badge> : null}
                <Badge variant={concept.active === false ? "red" : "blue"}>
                  {concept.active === false ? "inactive" : "active"}
                </Badge>
                {concept.definitionStatusId === "900000000000073002"
                  ? <Badge variant="darkgray">fully defined</Badge>
                  : <Badge variant="lightgray">primitive</Badge>}
              </div>
              <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "#5C6C75", marginBottom: 12 }}>
                #{concept.conceptId}
              </div>

              {/* Inspector tabs */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                {[
                  { key: "summary", label: "Summary" },
                  { key: "descriptions", label: "Descriptions" },
                  { key: "history", label: "History" },
                  { key: "valueset", label: "Descendants (ECL)" },
                  { key: "raw", label: "Raw" }
                ].map((t) => (
                  <button key={t.key} type="button" onClick={() => setInspectorTab(t.key)}
                    style={inspectorTab === t.key ? miniTabActive : miniTab}>{t.label}</button>
                ))}
              </div>

              {inspectorTab === "summary" ? (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                    <StatTile label="Parents" value={concept.parentCount} />
                    <StatTile label="Children" value={concept.childCount} />
                    <StatTile label="Descriptions" value={concept.descriptionCount} />
                    <StatTile label="Relationships" value={concept.relationshipCount} />
                  </div>
                  <SectionTitle>Metadata</SectionTitle>
                  <Detail label="Preferred term" value={concept.preferredTerm} />
                  <Detail label="Module" value={concept.moduleId} />
                  <Detail label="Release" value={concept.releaseId} />
                  <Detail label="Effective time" value={concept.effectiveTime} />
                  <Detail label="Refsets" value={(concept.memberOfRefsetIds || []).length || null} />
                </div>
              ) : null}

              {inspectorTab === "descriptions" ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <DescRow label="Preferred term" value={concept.preferredTerm} />
                  <DescRow label="Fully specified name" value={concept.fullySpecifiedName} />
                  {synonyms.map((s, i) => <DescRow key={i} label="Synonym" value={s} />)}
                </div>
              ) : null}

              {inspectorTab === "history" ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {history.loading ? <p style={sub}>Loading history…</p> : null}
                  {history.error ? <p style={errBox}>{history.error}</p> : null}
                  {history.items.map((h, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid #f1f4f6" }}>
                      <span style={{ color: INK }}>{h.releaseId || h.effectiveTime}</span>
                      <span style={{ color: h.active === false ? "#DB3030" : "#00684A" }}>{h.active === false ? "inactive" : "active"}</span>
                    </div>
                  ))}
                  {!history.loading && !history.error && history.items.length === 0 ? <p style={sub}>No release history.</p> : null}
                </div>
              ) : null}

              {inspectorTab === "valueset" ? (
                <div>
                  <div style={{ fontSize: 11, color: "#5C6C75", marginBottom: 6 }}>ECL <code>{`<< ${concept.conceptId}`}</code></div>
                  <Code language="javascript">{`// Goal: expand "${concept.term || concept.conceptId}" into its full value set —\n// every concept that is this one or a more specific kind of it (ECL: << ${concept.conceptId}).\n//\n// Each concept stores its complete ancestor chain in inferredAncestorIds, so\n// asking "which concepts list ${concept.conceptId} as an ancestor?" returns the\n// whole subtree in one indexed lookup — no recursive graph traversal.\ndb.snomed_concepts.find({\n  inferredAncestorIds: "${concept.conceptId}"   // = this concept + all descendants\n})`}</Code>
                  <p style={{ ...sub, marginTop: 6 }}>On the full release this returns the complete subtree; in this demo it returns whatever descendants exist in the scoped sample dataset.</p>
                  {valueSet.loading ? <p style={sub}>Expanding value set…</p> : null}
                  {valueSet.error ? <p style={errBox}>{valueSet.error}</p> : null}
                  {!valueSet.loading && !valueSet.error ? (
                    <>
                      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                        <input
                          value={valueSetFilter}
                          onChange={(e) => setValueSetFilter(e.target.value)}
                          placeholder="Filter descendants by term or SNOMED identifier"
                          style={smallInput}
                        />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <select value={valueSetTagFilter} onChange={(e) => setValueSetTagFilter(e.target.value)} style={smallSelect}>
                            {valueSetTags.map((tagValue) => (
                              <option key={tagValue} value={tagValue}>{tagValue === "all" ? "All semantic tags" : tagValue}</option>
                            ))}
                          </select>
                          <select value={valueSetSort} onChange={(e) => setValueSetSort(e.target.value)} style={smallSelect}>
                            <option value="term">Term A-Z</option>
                            <option value="semanticTag">Semantic tag</option>
                            <option value="sctid">SNOMED identifier</option>
                            <option value="parents">Parent count</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: INK, fontWeight: 700, margin: "10px 0 6px" }}>
                        {valueSet.total} members{valueSet.members.length < valueSet.total ? ` (loaded ${valueSet.members.length})` : ""}
                        {visibleValueSetMembers.length !== valueSet.members.length ? ` · ${visibleValueSetMembers.length} visible` : ""}
                      </div>
                      <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                        {visibleValueSetMembers.map((m) => (
                          <button key={m.conceptId} type="button" style={{ ...crumbLink, textAlign: "left" }}
                            onClick={() => openConcept(m.conceptId)}>
                            {m.term || m.conceptId} <span style={{ color: "#889397" }}>#{m.conceptId}</span>
                            {m.semanticTag ? <span style={{ color: "#889397" }}> · {m.semanticTag}</span> : null}
                          </button>
                        ))}
                        {visibleValueSetMembers.length === 0 ? <p style={sub}>No loaded descendants match the current filters.</p> : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {inspectorTab === "raw" ? (
                <Code language="json">{JSON.stringify(concept, null, 2)}</Code>
              ) : null}
            </aside>
          ) : null}
        </div>
      </div>
    );
  }

  // ---------- LANDING / BROWSE ----------
  const isLanding = !submitted;
  return (
    <div>
      <div style={isLanding ? searchLandingShell : searchBrowseShell}>
        <div style={isLanding ? searchTitleLarge : searchTitleSmall}>SNOMED CT terminology search</div>
        <div style={isLanding ? searchSubtitleLarge : searchSubtitleSmall}>
          Find, scope, and validate concepts for clinical coding.
        </div>
        <SearchBox
          big={isLanding}
          query={query}
          setQuery={setQuery}
          languageCode={languageCode}
          setLanguageCode={setLanguageCode}
          onSubmit={() => runSearch(query, languageCode)}
        />
        <ModeToggle mode={mode} setMode={setMode} />
        <ScopeControls
          open={scopeOpen}
          setOpen={setScopeOpen}
          scope={scope}
          setScope={setScope}
          hasScope={hasScope}
          compact={!isLanding}
        />
        {isLanding ? (
          <ExampleLibrary
            expandedGroup={expandedExampleGroup}
            setExpandedGroup={setExpandedExampleGroup}
            expandedId={expandedScopedExampleId}
            onRunBasic={(example) => stageSimpleExample(example, "lexical")}
            onRunScoped={stageScopedExample}
            onRunNlp={(example) => stageSimpleExample(example, "hybrid")}
          />
        ) : null}
      </div>

      {!isLanding ? (
        <div style={resultsShell}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
            <span style={sub}>
              {searchState.loading && scopeWarmup.active
                ? "Expanding terminology scope…"
                : searchState.loading
                  ? "Searching…"
                  : `${results.length} concepts for “${submitted}”`}
            </span>
            {searchMeta?.mode ? (
              <Badge variant={searchMeta.mode === "hybrid" ? "blue" : "lightgray"}>
                {searchMeta.mode === "hybrid" ? (searchMeta.reranked ? "hybrid + rerank" : "hybrid (fusion)") : searchMeta.mode}
              </Badge>
            ) : null}
            {searchMeta?.stats?.engine ? <Badge variant="lightgray">{searchMeta.stats.engine}</Badge> : null}
            <ScopeSummary meta={searchMeta} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {tags.map((t) => (
                <button key={t} type="button" onClick={() => setTagFilter(t)}
                  style={t === tagFilter ? chipActive : chip}>{t}</button>
              ))}
            </div>
          </div>
          {searchState.error ? <p style={errBox}>{searchState.error}</p> : null}
          {scopeWarmup.slow ? (
            <p style={scopeLatencyBox}>
              Expanding <code>{scopeWarmup.expression}</code> for the first time can take a few seconds while MongoDB builds the scoped candidate set. The result is cached in memory, so repeating the same ECL or area scope is much faster.
            </p>
          ) : null}
          {!searchState.loading && submitted ? (
            <p style={sampleScopeBox}>
              <strong>Term sidecar scope.</strong> Search runs over the projected term sidecar, not every RF2 description in the licensed source collection. This keeps the demo cluster responsive, but terms outside the projection can be missing or approximate; rebuild an area/full sidecar for production-like coverage.
            </p>
          ) : null}
          <AdvancedQueryPanel
            plan={searchMeta.queryPlan}
            open={queryPlanOpen}
            setOpen={setQueryPlanOpen}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {visibleResults.map((r) => {
              const preferred = r.preferredTerm || r.displayTerm || r.term || r.conceptId;
              const matched = (r.matchedText || r.matchedTerm || r.term || r.displayTerm || "").trim();
              // Show what actually matched (often an ES synonym) when it differs
              // from the preferred term the concept is stored under.
              const matchedDiffers = matched && matched.toLowerCase() !== String(preferred).toLowerCase();
              return (
                <button key={r.conceptId} type="button" style={cardBtn} onClick={() => openConcept(r.conceptId, languageCode)}>
                  <div style={{ fontWeight: 700, color: INK }}>{matchedDiffers ? matched : preferred}</div>
                  {matchedDiffers ? (
                    <div style={{ fontSize: 11, color: "#5C6C75", marginTop: 2 }}>Preferred: {preferred}</div>
                  ) : null}
                  <div style={{ fontSize: 11, color: "#5C6C75", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {r.semanticTag ? <Badge variant="green">{r.semanticTag}</Badge> : null}
                    {Array.isArray(r.foundBy) && r.foundBy.length === 2 ? (
                      <Badge variant="blue">lexical + vector</Badge>
                    ) : Array.isArray(r.foundBy) && r.foundBy[0] === "vector" ? (
                      <Badge variant="blue">semantic</Badge>
                    ) : r.matchReason ? (
                      <Badge variant="lightgray">{r.matchReason}</Badge>
                    ) : null}
                    {typeof r.rerankScore === "number" ? (
                      <Badge variant="yellow">rerank {r.rerankScore.toFixed(2)}</Badge>
                    ) : null}
                    <span>#{r.conceptId}</span>
                  </div>
                  {r.fsn ? <div style={{ fontSize: 11, color: "#889397", marginTop: 6 }}>{r.fsn}</div> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Breadcrumb({ term, onSearch, onResults, submitted }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13 }}>
      <button type="button" onClick={onSearch} style={crumbLink}>Search</button>
      {submitted && onResults ? (
        <>
          <span style={{ color: "#889397" }}>›</span>
          <button type="button" onClick={onResults} style={crumbLink}>“{submitted}”</button>
        </>
      ) : null}
      <span style={{ color: "#889397" }}>›</span>
      <span style={{ color: INK, fontWeight: 700 }}>{term}</span>
    </div>
  );
}

function SearchBox({ query, setQuery, languageCode, setLanguageCode, onSubmit, big }) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      style={{ display: "flex", gap: 8, width: "100%", maxWidth: big ? 680 : 840 }}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a clinical term, synonym, translation, or SNOMED identifier…"
        autoFocus
        style={{
          flex: 1, padding: big ? "14px 16px" : "10px 14px", fontSize: big ? 16 : 14,
          border: `1px solid ${BORDER}`, borderRadius: 10, outline: "none", color: INK
        }}
      />
      <select value={languageCode} onChange={(e) => setLanguageCode(e.target.value)}
        style={{ padding: "0 10px", border: `1px solid ${BORDER}`, borderRadius: 10, color: INK }}>
        <option value="auto">Auto</option>
        <option value="en">EN</option>
        <option value="es">ES</option>
      </select>
      <button type="submit" style={{ ...primaryBtn, padding: big ? "0 22px" : "0 16px" }}>Find</button>
    </form>
  );
}

const MODES = [
  { key: "lexical", label: "Lexical", hint: "MongoDB Search — exact terms, synonyms, formal names, SNOMED identifiers" },
  { key: "vector", label: "Semantic", hint: "Vector search — meaning, even with no shared words" },
  { key: "hybrid", label: "Hybrid + rerank", hint: "MongoDB lexical + vector fusion, with optional Voyage rerank" }
];

function ModeToggle({ mode, setMode, onChange }) {
  const active = MODES.find((m) => m.key === mode) || MODES[2];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginTop: 12 }}>
      <div style={{ display: "inline-flex", border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            title={m.hint}
            onClick={() => { setMode(m.key); onChange?.(m.key); }}
            style={{
              padding: "7px 14px", fontSize: 13, border: "none", cursor: "pointer",
              background: m.key === mode ? GREEN : "#fff",
              color: m.key === mode ? "#fff" : INK,
              fontWeight: m.key === mode ? 700 : 500
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#889397" }}>{active.hint}</div>
    </div>
  );
}

function ScopeControls({ open, setOpen, scope, setScope, hasScope, compact }) {
  const [focusExpr, setFocusExpr] = useState("");
  const [attributeId, setAttributeId] = useState("");
  const [targetExpr, setTargetExpr] = useState("");

  const update = (key, value) => {
    setScope((current) => ({ ...current, [key]: value }));
  };

  const clear = () => {
    setScope({ areaConceptId: "", ecl: "" });
  };

  const applyEcl = (ecl) => {
    setScope((current) => ({ ...current, areaConceptId: "", ecl }));
  };

  const updateAttributeBuilder = (key, value) => {
    const next = { focusExpr, attributeId, targetExpr, [key]: value };
    if (key === "focusExpr") setFocusExpr(value);
    if (key === "attributeId") setAttributeId(value);
    if (key === "targetExpr") setTargetExpr(value);
    if (next.focusExpr && next.attributeId && next.targetExpr) {
      applyEcl(`${next.focusExpr} : ${next.attributeId} = ${next.targetExpr}`);
    }
  };

  return (
    <div style={{ ...scopePanel, maxWidth: compact ? "100%" : 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen((value) => !value)} style={hasScope ? chipActive : chip}>
          Semantic scope
        </button>
        {hasScope ? <span style={sub}>Search restricted by terminology scope</span> : <span style={sub}>Optional area or ECL restriction</span>}
        {hasScope ? <button type="button" onClick={clear} style={ghostBtn}>Clear</button> : null}
      </div>
      {open ? (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <label style={fieldLabel}>
              Area concept
              <input
                value={scope.areaConceptId}
                onChange={(e) => update("areaConceptId", e.target.value)}
                placeholder="Optional concept id"
                style={smallInput}
              />
            </label>
            <label style={fieldLabel}>
              ECL scope
              <input
                value={scope.ecl}
                onChange={(e) => update("ecl", e.target.value)}
                placeholder="Optional ECL expression"
                style={smallInput}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ECL_EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                title={example.ecl}
                onClick={() => applyEcl(example.ecl)}
                style={miniChip}
              >
                {example.label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" }}>
            <label style={fieldLabel}>
              Focus
              <select value={focusExpr} onChange={(e) => updateAttributeBuilder("focusExpr", e.target.value)} style={smallSelect}>
                <option value="">Select focus</option>
                {ECL_FOCUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label style={fieldLabel}>
              Attribute
              <select value={attributeId} onChange={(e) => updateAttributeBuilder("attributeId", e.target.value)} style={smallSelect}>
                <option value="">Select attribute</option>
                {ECL_ATTRIBUTE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label style={fieldLabel}>
              Target
              <select value={targetExpr} onChange={(e) => updateAttributeBuilder("targetExpr", e.target.value)} style={smallSelect}>
                <option value="">Select target</option>
                {ECL_TARGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExampleLibrary({ expandedGroup, setExpandedGroup, expandedId, onRunBasic, onRunScoped, onRunNlp }) {
  const toggleGroup = (group) => {
    setExpandedGroup((current) => current === group ? "" : group);
  };

  return (
    <div style={exampleLibrary}>
      <ExampleSection
        title="Basic examples"
        expanded={expandedGroup === "basic"}
        onToggle={() => toggleGroup("basic")}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SUGGESTIONS.map((example) => (
            <button key={example.label} type="button" style={chip} onClick={() => onRunBasic(example)}>
              {example.label}
            </button>
          ))}
        </div>
      </ExampleSection>

      <ExampleSection
        title="Scoped and ECL examples"
        expanded={expandedGroup === "scoped"}
        onToggle={() => toggleGroup("scoped")}
      >
        <ScopedExampleGallery expandedId={expandedId} onRun={onRunScoped} />
      </ExampleSection>

      <ExampleSection
        title="Natural language examples"
        expanded={expandedGroup === "nlp"}
        onToggle={() => toggleGroup("nlp")}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {NLP_EXAMPLES.map((example) => (
            <button key={example.label} type="button" style={chipNlp} onClick={() => onRunNlp(example)}>
              {example.label}
            </button>
          ))}
        </div>
      </ExampleSection>
    </div>
  );
}

function ExampleSection({ title, expanded, onToggle, children }) {
  return (
    <div style={exampleSection}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        style={exampleSectionToggle}
      >
        <span style={{ color: INK, fontWeight: 800 }}>{title}</span>
        <span style={exampleSectionState}>{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded ? <div style={exampleSectionBody}>{children}</div> : null}
    </div>
  );
}

function ScopedExampleGallery({ expandedId, onRun }) {
  return (
    <div style={scopedExamplesWrap}>
      <p style={{ ...sub, margin: "0 0 8px" }}>
        Scoped examples expand an ECL or ancestor set before search. First run may warm the scope cache; repeated runs reuse the cached concept set.
      </p>
      <div style={scopedExamplesGrid}>
        {SCOPED_SEARCH_EXAMPLES.map((example) => {
          const expanded = expandedId === example.id;
          const scopeExpression = example.scope.ecl || `<< ${example.scope.areaConceptId}`;
          return (
            <button
              key={example.id}
              type="button"
              onClick={() => onRun(example)}
              aria-expanded={expanded}
              style={expanded ? { ...scopedExampleCard, ...scopedExampleCardActive } : scopedExampleCard}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={scopeExampleMarker}>{example.marker}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 800, color: INK }}>{example.title}</span>
                  <span style={{ display: "block", fontSize: 12, color: "#5C6C75", marginTop: 2 }}>
                    “{example.query}” · {example.languageCode.toUpperCase()} · {example.mode}
                  </span>
                </span>
              </div>
              {expanded ? (
                <div style={scopedExampleDetail}>
                  <div style={{ color: "#5C6C75", marginBottom: 4 }}>{example.scopeLabel}</div>
                  <code style={inlineCode}>{scopeExpression}</code>
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AdvancedQueryPanel({ plan, open, setOpen }) {
  if (!plan) return null;
  const payload = plan.mql ?? plan;
  const json = JSON.stringify(payload, null, 2);
  const postProcessing = Array.isArray(plan.postProcessing) ? plan.postProcessing : [];

  return (
    <div style={queryPlanBox}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={queryPlanToggle}
      >
        <span style={{ fontWeight: 800, color: INK }}>Advanced query</span>
        {plan.engine ? <Badge variant="lightgray">{plan.engine}</Badge> : null}
        <span style={exampleSectionState}>{open ? "Hide" : "Show MQL"}</span>
      </button>
      {open ? (
        <div style={queryPlanBody}>
          {plan.description ? <p style={{ ...sub, marginBottom: 8 }}>{plan.description}</p> : null}
          {plan.fallbackReason ? (
            <p style={{ fontSize: 11.5, color: "#8A6D1F", background: "#FBF7E9", border: "1px solid #E9E2C8", borderRadius: 8, padding: "6px 10px", margin: "0 0 8px" }}>
              Native fusion fallback: {plan.fallbackReason}
            </p>
          ) : null}
          <Code language="json">{json}</Code>
          {postProcessing.length > 0 ? (
            <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
              {postProcessing.map((item) => (
                <div key={item} style={{ fontSize: 11.5, color: "#5C6C75" }}>{item}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScopeSummary({ meta }) {
  const scope = meta?.scope;
  const stats = meta?.stats;
  if (!scope && !stats?.areaScoped && !stats?.eclScoped) return null;
  const chunks = [];
  if (scope?.areaConceptId) chunks.push(`area ${scope.areaConceptId}`);
  if (scope?.ecl) chunks.push(scope.ecl);
  if (Number.isFinite(Number(scope?.appliedScopeCount))) chunks.push(`${scope.appliedScopeCount} scoped ids`);
  const expansionMs = Number(stats?.scopeExpansionMs ?? scope?.timings?.expansionMs);
  if (Number.isFinite(expansionMs) && expansionMs > 0) chunks.push(`scope ${Math.round(expansionMs)} ms`);
  if (scope?.cache?.warm === true || stats?.scopeCacheWarm === true) chunks.push("cache warm");
  if (scope?.cache?.warm === false || stats?.scopeCacheWarm === false) chunks.push("cache warmed");
  return <span style={scopeBadge}>{chunks.join(" · ") || "scoped"}</span>;
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#5C6C75", margin: "0 0 8px" }}>{children}</div>;
}
function DescRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 13 }}>
      <span style={{ color: "#889397", minWidth: 150 }}>{label}</span>
      <span style={{ color: INK }}>{value}</span>
    </div>
  );
}
function ApiCall({ title, method, path, body }) {
  const json = JSON.stringify(body, null, 2);
  const curl = `curl -s -X ${method} ${path} \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(body)}'`;
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f4f7f6", borderBottom: `1px solid ${BORDER}` }}>
        <Badge variant="green">{method}</Badge>
        <code style={{ fontSize: 12, color: INK }}>{path}</code>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#5C6C75" }}>{title}</span>
      </div>
      <Code language="json">{json}</Code>
      <Code language="bash">{curl}</Code>
    </div>
  );
}
function StatTile({ label, value }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: INK, lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 11, color: "#889397", marginTop: 3 }}>{label}</div>
    </div>
  );
}
function Detail({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: `1px solid #f1f4f6` }}>
      <span style={{ color: "#889397" }}>{label}</span>
      <span style={{ color: INK, fontWeight: 600 }}>{String(value)}</span>
    </div>
  );
}

const sub = { fontSize: 13, color: "#5C6C75", margin: 0 };
const errBox = { fontSize: 13, color: "#DB3030", background: "#FDECEC", padding: "8px 12px", borderRadius: 8 };
const primaryBtn = { background: GREEN, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const ghostBtn = { background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#5C6C75" };
const searchLandingShell = { display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 920, margin: "0 auto", padding: "52px 16px 32px", boxSizing: "border-box" };
const searchBrowseShell = { display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 920, margin: "0 auto", padding: "18px 16px 18px", boxSizing: "border-box" };
const searchTitleLarge = { fontSize: 26, fontWeight: 800, color: INK, marginBottom: 6, textAlign: "center" };
const searchTitleSmall = { fontSize: 20, fontWeight: 800, color: INK, marginBottom: 3, textAlign: "center" };
const searchSubtitleLarge = { ...sub, textAlign: "center", marginBottom: 20 };
const searchSubtitleSmall = { ...sub, textAlign: "center", marginBottom: 12 };
const resultsShell = { width: "100%", maxWidth: 1320, margin: "0 auto", padding: "0 16px 24px", boxSizing: "border-box" };
const chip = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer", color: INK };
const chipActive = { ...chip, background: "#E3FCEC", border: `1px solid ${GREEN}`, color: GREEN, fontWeight: 700 };
const chipNlp = { ...chip, background: "#F1F0FF", border: "1px solid #C2B9F0", color: "#5A3FC0" };
const miniChip = { ...chip, padding: "4px 10px", fontSize: 11 };
const chipGroupLabel = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#889397", textAlign: "center", marginBottom: 8, letterSpacing: 0 };
const exampleLibrary = { width: "100%", maxWidth: 760, marginTop: 22, display: "grid", gap: 12 };
const exampleSection = { border: `1px solid ${BORDER}`, borderRadius: 8, background: "#fff", overflow: "hidden" };
const exampleSectionToggle = { width: "100%", display: "flex", alignItems: "center", gap: 10, border: "none", background: "#fff", padding: "10px 12px", cursor: "pointer", textAlign: "left" };
const exampleSectionMarker = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 24, borderRadius: 6, background: "#F4F7F6", color: "#5C6C75", border: `1px solid ${BORDER}`, fontSize: 11, fontWeight: 800 };
const exampleSectionState = { marginLeft: "auto", color: GREEN, fontSize: 12, fontWeight: 800 };
const exampleSectionBody = { borderTop: `1px solid ${BORDER}`, padding: 10, background: "#fbfdfc" };
const queryPlanBox = { border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fff", overflow: "hidden", margin: "0 0 12px" };
const queryPlanToggle = { width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "#fff", padding: "8px 10px", cursor: "pointer", textAlign: "left" };
const queryPlanBody = { borderTop: `1px solid ${BORDER}`, padding: 10, background: "#fbfdfc" };
const scopePanel = { width: "100%", marginTop: 10, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 10, background: "#fbfdfc" };
const scopeBadge = { fontSize: 11, color: GREEN, background: "#E3FCEC", border: `1px solid ${GREEN}33`, borderRadius: 999, padding: "3px 8px", fontWeight: 700 };
const scopeLatencyBox = { fontSize: 11.5, color: "#0F3D2E", background: "#F1FAF5", border: "1px solid #CBEBDB", borderRadius: 8, padding: "6px 10px", margin: "0 0 12px" };
const sampleScopeBox = { fontSize: 11.5, color: "#8A6D1F", background: "#FBF7E9", border: "1px solid #E9E2C8", borderRadius: 8, padding: "6px 10px", margin: "0 0 12px" };
const scopedExamplesWrap = { width: "100%" };
const scopedExamplesGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 };
const scopedExampleCard = { display: "grid", gap: 8, width: "100%", textAlign: "left", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, cursor: "pointer", color: INK };
const scopedExampleCardActive = { border: `1px solid ${GREEN}`, background: "#F1FBF6", boxShadow: `0 0 0 1px ${GREEN}22 inset` };
const scopeExampleMarker = { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 44, height: 28, borderRadius: 6, background: "#E3FCEC", color: GREEN, border: `1px solid ${GREEN}33`, fontSize: 11, fontWeight: 800 };
const scopedExampleDetail = { borderTop: `1px solid ${BORDER}`, paddingTop: 8, fontSize: 12 };
const inlineCode = { display: "inline-block", maxWidth: "100%", overflowWrap: "anywhere", background: "#F4F7F6", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "3px 6px", color: INK, fontSize: 11 };
const fieldLabel = { display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "#5C6C75", textTransform: "uppercase" };
const smallInput = { width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 9px", color: INK, fontSize: 13, outline: "none", textTransform: "none", fontWeight: 500 };
const smallSelect = { width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 9px", color: INK, fontSize: 12, background: "#fff" };
const cardBtn = { textAlign: "left", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, cursor: "pointer" };
const curtain = { width: 360, flexShrink: 0, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, background: "#fbfdfc", maxHeight: "calc(100vh - 220px)", overflowY: "auto", position: "sticky", top: 16 };
const miniTab = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 999, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "#5C6C75" };
const miniTabActive = { ...miniTab, background: "#E3FCEC", border: `1px solid ${GREEN}`, color: GREEN, fontWeight: 700 };
const curtainHandle = { alignSelf: "stretch", width: 22, border: `1px solid ${BORDER}`, borderRadius: 8, background: "#fff", cursor: "pointer", color: "#5C6C75", fontWeight: 700 };
const code = { background: "#001E2B", color: "#E3FCEC", padding: 10, borderRadius: 8, fontSize: 11, overflowX: "auto", margin: 0 };
const crumbLink = { background: "transparent", border: "none", color: GREEN, cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 13 };
const linkRow = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%", textAlign: "left", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", marginBottom: 6, cursor: "pointer", color: INK, fontSize: 13 };
const rowStyle = { cursor: "pointer", borderBottom: "1px solid #f1f4f6" };
const td = { padding: "8px 6px", color: INK };
function pill(color) {
  return { display: "inline-block", background: `${color}14`, color, borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700 };
}
