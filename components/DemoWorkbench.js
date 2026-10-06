"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "@/components/DemoWorkbench.module.css";
import ConceptBrowser, { PRIMARY_PATH_POLICY_HINT, PRIMARY_PATH_POLICY_LABEL, buildAncestorChain } from "./ConceptBrowser";
import ConceptHierarchyFlow from "./ConceptHierarchyFlow";
import NavigateWorkbench from "./NavigateWorkbench";
import GroundWorkbench from "./GroundWorkbench";
import dynamic from "next/dynamic";
import Badge from "@leafygreen-ui/badge";
import Icon from "@leafygreen-ui/icon";
// LeafyGreen Code touches `document` at render — load it client-only.
const Code = dynamic(() => import("@leafygreen-ui/code"), { ssr: false });
// API docs fetch the OpenAPI contract client-side.
const ApiDocsPanel = dynamic(() => import("@/components/ApiDocsPanel"), { ssr: false });
const BenchmarkView = dynamic(() => import("@/components/BenchmarkView"), { ssr: false });
import { buildWorkflowApiExamples, formatApiPayload } from "./workflowApiExamples";

// Models selectable as the active grounding model for the session.
const SESSION_MODELS = (process.env.NEXT_PUBLIC_LLM_GROUNDING_MODELS || "gpt-5.5")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Operator-only maintenance advisories (model:harden, index hints, etc.) are
// hidden by default so the public blueprint doesn't surface internal TODOs.
// Opt in with NEXT_PUBLIC_SHOW_OPS_DIAGNOSTICS=true for a maintenance view.
const SHOW_OPS_DIAGNOSTICS = process.env.NEXT_PUBLIC_SHOW_OPS_DIAGNOSTICS === "true";

/* Flat monochrome SVG icons — inherit currentColor */
const ico = (d, vb = "0 0 16 16") => (
  <svg width="16" height="16" viewBox={vb} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

const ICONS = {
  search: ico(<><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></>),
  fileText: ico(<><rect x="3" y="1.5" width="10" height="13" rx="1.5"/><line x1="5.5" y1="5" x2="10.5" y2="5"/><line x1="5.5" y1="7.5" x2="10.5" y2="7.5"/><line x1="5.5" y1="10" x2="8.5" y2="10"/></>),
  target: ico(<><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="0.5" fill="currentColor" stroke="none"/></>),
  shield: ico(<><path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4Z"/></>),
  users: ico(<><circle cx="6" cy="5" r="2.5"/><path d="M1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"/><circle cx="11.5" cy="5.5" r="2"/><path d="M14.5 14c0-2 -1.5-3.5-3-3.5"/></>),
  barChart: ico(<><rect x="2" y="9" width="2.5" height="5.5" rx="0.5"/><rect x="6.75" y="5" width="2.5" height="9.5" rx="0.5"/><rect x="11.5" y="2" width="2.5" height="12.5" rx="0.5"/></>),
  layers: ico(<><polygon points="8 1.5 1.5 5.5 8 9.5 14.5 5.5"/><polyline points="1.5 8 8 12 14.5 8"/><polyline points="1.5 10.5 8 14.5 14.5 10.5"/></>),
};

const TAB_META = {
  foundations: {
    label: "Overview",
    icon: ICONS.layers,
    title: "SNOMED CT on MongoDB",
    summary: "What clinical terminology is, why SNOMED is hard to model, why MongoDB fits, and the demo journey to try."
  },
  intelligent: {
    label: "Ground a Note",
    icon: ICONS.fileText,
    title: "Ground a Clinical Note — applied example",
    summary: "An applied example of the terminology service: MongoDB retrieves SNOMED candidates for each mention, a reviewer confirms the codings (optionally with candidate-constrained AI assist), and results are stored with ancestor paths so they can be queried by meaning."
  },
  navigate: {
    label: "Navigation",
    icon: ICONS.search,
    title: "SNOMED Navigation",
    summary: "Search, inspect, and navigate SNOMED CT concepts with deterministic lexical retrieval."
  },
  api: {
    label: "API",
    icon: ICONS.fileText,
    title: "API Reference",
    summary: "OpenAPI reference for the SNOMED navigation and note-grounding endpoints."
  },
  benchmark: {
    label: "Benchmark",
    icon: ICONS.barChart,
    title: "Grounding accuracy benchmark",
    summary: "Score the configured extraction models on the gold-note pack — subsumption-aware accuracy, tokens, and latency."
  },
  model: {
    label: "Data Model",
    icon: ICONS.layers,
    title: "SNOMED Data Model in JSON",
    summary: "MongoDB document model for SNOMED CT — collections, and the ancestor arrays plus multikey indexes that power ECL subsumption."
  }
};

// v1 close-out: the demo tells one story — turning unstructured clinical notes
// into governed SNOMED codings. Three screens: Overview (a small "what you can
// do" intro + the data model), Search & Navigate, and Ground Clinical Note (the
// star). Cohort/secondary-use and the Synthea dataset are removed; the "grounded
// data is queryable by ancestor" payoff lives on the grounding screen. The
// legacy secondary-use, value-set authoring, and governance surfaces are removed
// from the public product.
const SIDEBAR_SECTIONS = [
  { label: "SNOMED CT on MongoDB", tabs: ["foundations", "navigate", "intelligent", "benchmark", "api"] }
];

// Navigate has its own contextual "API" sub-tab (per concept), so the shared
// top drawer is only used on the grounding tab.
const API_DRAWER_TABS = ["intelligent"];
const APPENDIX_TABS = ["model"];

function normalizeTabKey(value) {
  const key = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(TAB_META, key) ? key : "";
}

const EMPTY_CALL = {
  loading: false,
  error: "",
  response: null
};

const DEFAULT_LANGUAGE = "en";
const DEFAULT_LIMIT = 18;
const DEFAULT_CLINICAL_TEXT = [
  "HPI: Patient with type 2 diabetes.",
  "Assessment: History of diabetic nephropathy. No evidence of retinopathy on current review.",
  "Family history: Mother with type 2 diabetes.",
  "Plan: Continue metformin and repeat urine albumin."
].join("\n");
const NAVIGATE_TYPEAHEAD_MIN_CHARS = 2;
const NAVIGATE_TYPEAHEAD_DEBOUNCE_MS = 180;

// Inline styles for the Overview guided-landing sections (hero CTAs, the
// "what this demo shows" trio, and the recommended demo journey). Kept local
// so the Overview polish needs no CSS-module changes.
const OV_GREEN = "#00684A";
const OV_INK = "#001E2B";
const OV_BORDER = "#e3e7ea";
const OV = {
  // Hero: two columns (value proposition + "idea in one line" callout) to use
  // the full width and kill the big right-side whitespace.
  hero: { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 24, alignItems: "stretch", border: `1px solid ${OV_BORDER}`, borderRadius: 14, padding: 24, background: "#fff", marginBottom: 16 },
  heroLeft: { display: "flex", gap: 16, alignItems: "flex-start" },
  heroIcon: { width: 56, height: 56, objectFit: "contain", flexShrink: 0 },
  eyebrow: { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.11em", textTransform: "uppercase", color: OV_GREEN, display: "block" },
  heroTitle: { fontSize: 24, fontWeight: 800, color: OV_INK, letterSpacing: "-0.02em", margin: "6px 0 8px", lineHeight: 1.15 },
  heroSub: { margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-secondary, #5C6C75)" },
  heroCallout: { background: "#F1FAF5", border: `1px solid #CBEBDB`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", justifyContent: "center" },
  heroCalloutLabel: { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: OV_GREEN, marginBottom: 6 },
  heroCalloutText: { margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#0F3D2E", fontWeight: 500 },

  // "Why this demo" — three narratives, editorial (no card chrome) so they read
  // as larger, calmer explanations rather than a wall of boxes.
  whyGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px 48px", padding: "26px 4px 6px" },
  whyCard: { paddingLeft: 16, borderLeft: `3px solid #DDECE4` },
  whyLabel: { fontSize: 15, fontWeight: 700, color: OV_INK, display: "block", marginBottom: 8 },
  whyText: { margin: 0, fontSize: 15, lineHeight: 1.65, color: "#4A5A64" },

  flowHead: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "#5C6C75", margin: "4px 0 12px" },

  // Narrative "manual" layout for the Solution overview — a single readable
  // column, generous line-height, minimal chrome.
  article: { maxWidth: 820, margin: "0 auto", padding: "6px 4px" },
  articleTitle: { fontSize: 26, fontWeight: 800, color: OV_INK, letterSpacing: "-0.02em", margin: "6px 0 12px", lineHeight: 1.15 },
  lead: { fontSize: 17, lineHeight: 1.65, color: "#3D4B54", margin: "0 0 8px" },
  h3: { fontSize: 17, fontWeight: 700, color: OV_INK, margin: "28px 0 8px" },
  p: { fontSize: 15, lineHeight: 1.72, color: "#4A5A64", margin: "0 0 12px" },

  journeyWrap: { marginTop: 22, border: `1px solid ${OV_BORDER}`, borderRadius: 12, padding: 18, background: "#fbfdfc" },
  journeyHead: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "#5C6C75", marginBottom: 14 },
  journeyGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 },
  step: { display: "flex", gap: 12, alignItems: "flex-start" },
  stepNum: { flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: OV_GREEN, color: "#fff", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" },
  stepBody: { display: "flex", flexDirection: "column", gap: 4 },
  stepTitle: { fontSize: 14, fontWeight: 700, color: OV_INK },
  stepDesc: { fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-secondary, #5C6C75)" },

  // Uniform stat pills for the readiness panel (fixes the uneven ovals).
  pillRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 },
  pill: { display: "inline-flex", alignItems: "center", height: 24, boxSizing: "border-box", background: "#E3FCF2", color: OV_GREEN, border: "1px solid #B8F0D8", borderRadius: 6, padding: "0 10px", fontSize: 12, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap" },

  licenseBox: { marginTop: 18, border: `1px solid #E9E2C8`, background: "#FBF7E9", borderRadius: 12, padding: "14px 18px" },
  licenseTitle: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: "#8A6D1F", marginBottom: 6 },
  licenseText: { margin: "0 0 6px", fontSize: 13, lineHeight: 1.5, color: "#5C4F26" }
};
const EXPLORER_EXAMPLES = [
  { label: "Type 2 diabetes", query: "type 2 diabetes", languageCode: "en" },
  { label: "Carcinoma de mama", query: "carcinoma de mama", languageCode: "es" },
  { label: "Above elbow amputation", query: "above elbow amputation", languageCode: "en" },
  { label: "Retinopatia diabetica", query: "retinopatia diabetica", languageCode: "es" }
];
const QUICK_CONCEPTS = [
  { conceptId: "44054006", label: "Diabetes mellitus type 2" },
  { conceptId: "254838004", label: "Breast carcinoma" },
  { conceptId: "397956004", label: "Prosthesis complication" }
];
const EXPLORER_CENTER_TABS = [
  { key: "graph", label: "Graph" },
  { key: "hierarchy", label: "Hierarchy" },
  { key: "table", label: "Table" },
  { key: "descriptions", label: "Descriptions" },
  { key: "relationships", label: "Relationships" }
];
const EXPLORER_INSPECTOR_TABS = [
  { key: "summary", label: "Summary" },
  { key: "descriptions", label: "Descriptions" },
  { key: "relationships", label: "Relationships" },
  { key: "history", label: "History" },
  { key: "definition", label: "Definition" },
  { key: "raw", label: "Raw JSON" }
];
const NAVIGATOR_RESULT_GROUPS = [
  {
    key: "exact",
    label: "Exact first",
    caption: "Direct SCTID, exact preferred terms, exact synonyms, and exact FSN matches.",
    includes: (tier) => tier >= 0 && tier <= 3
  },
  {
    key: "normalized",
    label: "Normalized / lemma",
    caption: "Language normalization and lemmatization broaden the search without leaving deterministic lexical ranking.",
    includes: (tier) => tier === 4
  },
  {
    key: "prefix",
    label: "Prefix matches",
    caption: "Strong starts-with matches kept below exact and normalized hits.",
    includes: (tier) => tier === 5 || tier === 6
  },
  {
    key: "fuzzy",
    label: "Broader lexical",
    caption: "Contains and fuzzy lexical matches, useful for discovery but visually separated from exact navigation.",
    includes: (tier) => tier >= 7
  }
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function shortLabel(text, max = 40) {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

function normalizeLooseText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSimpleConceptIdFromExpr(expr) {
  const normalized = String(expr || "").trim();
  const match = normalized.match(/^(?:<<|<)?\s*(\d+)\s*$/);
  return match ? match[1] : "";
}

function extractHighlightTexts(item) {
  const highlights = Array.isArray(item?.highlights) ? item.highlights : [];
  for (const entry of highlights) {
    const path = String(entry?.path || "");
    if (path !== "displayTerm" && path !== "fsn" && path !== "synonyms") continue;
    const texts = Array.isArray(entry?.texts) ? entry.texts : [];
    if (texts.some((part) => part?.type === "hit")) {
      return texts;
    }
  }
  return null;
}

function renderTermWithHighlights(item, fallback = "") {
  const texts = extractHighlightTexts(item);
  if (!texts) return fallback || item?.term || "";

  return texts.map((part, idx) => {
    const key = `${item?.conceptId || "concept"}-${idx}`;
    const value = part?.value || "";
    if (part?.type === "hit") {
      return (
        <mark key={key} className={styles.searchHit}>
          {value}
        </mark>
      );
    }
    return <span key={key}>{value}</span>;
  });
}

function searchHighlightPath(item) {
  const highlights = Array.isArray(item?.highlights) ? item.highlights : [];
  const first = highlights.find((entry) => {
    const texts = Array.isArray(entry?.texts) ? entry.texts : [];
    return texts.some((part) => part?.type === "hit");
  });
  return String(first?.path || "");
}

function navigatorMatchReason(item, queryText = "") {
  if (item?.matchReason) return item.matchReason;

  const query = normalizeLooseText(queryText);
  const term = normalizeLooseText(item?.term);
  const fsn = normalizeLooseText(item?.fsn);
  const path = searchHighlightPath(item);

  if (/^\d{4,}$/.test(query) && String(item?.conceptId || "") === queryText.trim()) {
    return "SCTID";
  }
  if (query && term === query) return "Exact";
  if (query && term.startsWith(query)) return "Prefix";
  if (path === "fsn") return "FSN";
  if (path === "displayTerm") return "Preferred";
  if (query && fsn.includes(query)) return "Definition";
  return "Text";
}

function navigatorResultGroup(item) {
  const tier = Number(item?.matchTier);
  return NAVIGATOR_RESULT_GROUPS.find((group) => group.includes(tier)) || NAVIGATOR_RESULT_GROUPS[NAVIGATOR_RESULT_GROUPS.length - 1];
}

function groupNavigatorResults(results) {
  const seededGroups = NAVIGATOR_RESULT_GROUPS.map((group) => ({
    ...group,
    items: []
  }));

  (Array.isArray(results) ? results : []).forEach((item, index) => {
    const group = navigatorResultGroup(item);
    const bucket = seededGroups.find((entry) => entry.key === group.key);
    if (!bucket) return;
    bucket.items.push({
      item,
      rank: index + 1
    });
  });

  return seededGroups.filter((group) => group.items.length > 0);
}

function describeNavigatorScope(scope, areaConceptId = "") {
  const mode = String(scope?.mode || "").trim();
  if (!mode || mode === "none") {
    return normalizeLooseText(areaConceptId) ? `Descendants of #${String(areaConceptId).trim()}` : "All concepts";
  }
  if (mode === "area-concept") {
    return `Descendants of #${String(scope?.areaConceptId || areaConceptId || "").trim()}`;
  }
  if (mode === "ecl" || mode === "explicit-only" || mode === "intent∩explicit") {
    return `Scoped set · ${scope?.expandedCount || scope?.count || 0} concepts`;
  }
  return mode.replace(/[-_]+/g, " ");
}

function navigatorReasonToneClass(item) {
  const key = navigatorResultGroup(item)?.key || "fuzzy";
  if (key === "exact") return styles.searchReasonExact;
  if (key === "normalized") return styles.searchReasonNormalized;
  if (key === "prefix") return styles.searchReasonPrefix;
  return styles.searchReasonFuzzy;
}

function deriveNavigatorKind(item) {
  const tag = String(item?.semanticTag || "").trim().toLowerCase();
  if (!tag) return "Other";
  if (tag.includes("disorder")) return "Condition";
  if (tag.includes("finding")) return "Finding";
  if (tag.includes("procedure")) return "Procedure";
  if (tag.includes("body structure")) return "Body structure";
  if (tag.includes("observable entity")) return "Observable";
  if (tag.includes("regime") || tag.includes("therapy")) return "Therapy";
  if (tag.includes("substance")) return "Substance";
  if (tag.includes("product")) return "Product";
  if (tag.includes("situation")) return "Situation";
  if (tag.includes("event")) return "Event";
  if (tag.includes("organism")) return "Organism";
  if (tag.includes("qualifier")) return "Qualifier";
  return "Other";
}

function buildFacetCounts(values) {
  const map = new Map();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    map.set(normalized, (map.get(normalized) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.value.localeCompare(right.value);
    });
}



async function postJson(endpoint, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.details || "Request failed");
  }

  return payload;
}

async function getJson(endpoint) {
  const response = await fetch(endpoint, { method: "GET" });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.details || "Request failed");
  }
  return payload;
}

function makeExplorerSession() {
  return {
    sessionId:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `explorer-${Date.now()}`,
    startedAt: Date.now(),
    firstSearchAt: null,
    lastSearchAt: null,
    submittedQuery: "",
    searchCount: 0,
    reformulations: 0
  };
}


function SidebarItem({ icon, label, active, onClick }) {
  return (
    <button
      className={`sidebarItem ${active ? "sidebarItemActive" : ""}`}
      onClick={onClick}
    >
      <span className="sidebarItemIcon">{icon}</span>
      {label}
    </button>
  );
}

function StatPill({ label, value }) {
  return (
    <span className={styles.statPill}>
      {label}: {String(value)}
    </span>
  );
}

function ReadinessChip({ label, ok }) {
  return (
    <Badge variant={ok ? "green" : "yellow"}>
      {ok ? "\u2713" : "\u26A0"} {label}
    </Badge>
  );
}

function ReleaseDiffPanel({ call, onRun }) {
  const data = call.response;
  const releases = Array.isArray(data?.releases) ? data.releases : [];
  const counts = data?.counts || {};
  const samples = data?.samples || {};

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid #e3e7ea", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: OV_INK }}>Release lifecycle</span>
        {data ? <Badge variant={data.ready ? "green" : "yellow"}>{data.ready ? "diff ready" : "needs 2 releases"}</Badge> : null}
        <button className={styles.runButton} type="button" onClick={onRun} disabled={call.loading}>
          {call.loading ? "Checking..." : "Check release diff"}
        </button>
      </div>
      {!data && !call.loading ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-secondary)" }}>
          Verifies whether the canonical collection can compare two loaded SNOMED releases.
        </p>
      ) : null}
      {call.loading ? <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-secondary)" }}>Reading release metadata...</p> : null}
      {call.error ? <p className={styles.errorBox}>{call.error}</p> : null}
      {data && !data.ready ? (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "#8A6D1F", background: "#FBF7E9", border: "1px solid #E9E2C8", borderRadius: 8, padding: "8px 10px" }}>
          Release diff is intentionally gated until at least two <code>releaseId</code> values are loaded. Current releases: {releases.length ? releases.join(", ") : "none"}.
        </p>
      ) : null}
      {data?.ready ? (
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-secondary)" }}>
            Comparing <code>{data.fromReleaseId}</code> to <code>{data.toReleaseId}</code>.
          </p>
          <div style={OV.pillRow}>
            <span style={OV.pill}>Added: {Number(counts.added || 0).toLocaleString()}</span>
            <span style={OV.pill}>Retired: {Number(counts.retired || 0).toLocaleString()}</span>
            <span style={OV.pill}>Changed: {Number(counts.changed || 0).toLocaleString()}</span>
            <span style={OV.pill}>Carried: {Number(counts.carried || 0).toLocaleString()}</span>
          </div>
          {["added", "retired", "changed"].map((kind) => (
            Array.isArray(samples[kind]) && samples[kind].length > 0 ? (
              <div className={styles.indexList} key={kind}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#5C6C75", textTransform: "uppercase" }}>{kind} sample</div>
                {samples[kind].slice(0, 5).map((entry) => (
                  <div className={styles.indexItem} key={`${kind}-${entry.conceptId}`}>
                    <strong>#{entry.conceptId}</strong>
                    <span>{Array.isArray(entry.changes) ? entry.changes.join(", ") : (entry.effectiveTime || "concept membership")}</span>
                  </div>
                ))}
              </div>
            ) : null
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TechBadge({ label, color = "green" }) {
  const colorMap = {
    green: styles.techBadgeGreen,
    blue: styles.techBadgeBlue,
    purple: styles.techBadgePurple,
    red: styles.techBadgeRed,
    orange: styles.techBadgeOrange
  };
  return <span className={`${styles.techBadge} ${colorMap[color] || colorMap.green}`}>{label}</span>;
}

function AdvantageBox({ children }) {
  return (
    <div className={styles.advantageBox}>
      <div className={styles.advantageBoxLabel}>MongoDB Advantage</div>
      <p>{children}</p>
    </div>
  );
}

function formatDefinitionStatus(definitionStatusId) {
  return String(definitionStatusId || "") === "900000000000073002" ? "Fully defined" : "Primitive";
}

function ConceptNormativeView({ concept, onNavigate }) {
  if (!concept) return null;

  const parent = Array.isArray(concept.parents) && concept.parents.length > 0 ? concept.parents[0] : null;
  const relationRows = Array.isArray(concept.relationshipPreview)
    ? concept.relationshipPreview.filter((row) => row?.typeId && row?.destinationId).slice(0, 4)
    : [];

  const definitionStatus = formatDefinitionStatus(concept.definitionStatusId);

  return (
    <section className={styles.normativePanel}>
      <div className={styles.normativeTitle}>Definition</div>

      <div className={styles.normativeGraph}>
        <span className={`${styles.normNode} ${styles.normNodeRoot}`}>SNOMED CT Concept</span>
        {parent && (
          <>
            <span className={styles.normArrow}>→</span>
            <button
              className={`${styles.normNode} ${styles.normNodeParent}`}
              onClick={() => onNavigate?.(parent.conceptId, parent.term)}
            >
              {shortLabel(parent.term, 30)}
            </button>
          </>
        )}
        <span className={styles.normArrow}>→</span>
        <span className={`${styles.normNode} ${styles.normNodeActive}`}>{shortLabel(concept.preferredTerm, 34)}</span>
      </div>

      {relationRows.length > 0 && (
        <div className={styles.normativeRelations}>
          {relationRows.map((row, idx) => (
            <div key={`rel-${row.typeId}-${row.destinationId}-${idx}`} className={styles.normativeRelationRow}>
              <span className={styles.normativeRelationLabel}>type</span>
              <code>{row.typeId}</code>
              <span className={styles.normativeRelationArrow}>→</span>
              <span className={styles.normativeRelationLabel}>dest</span>
              <code>{row.destinationId}</code>
            </div>
          ))}
        </div>
      )}

      <div className={styles.normativeAttributes}>
        <div className={`${styles.normativeAttr} ${styles.normAttrRose}`}>
          <span>effectiveTime</span>
          <strong>{concept.effectiveTime || "n/a"}</strong>
        </div>
        <div className={`${styles.normativeAttr} ${styles.normAttrLime}`}>
          <span>moduleId</span>
          <strong>{concept.moduleId || "n/a"}</strong>
        </div>
        <div className={`${styles.normativeAttr} ${styles.normAttrSky}`}>
          <span>definition</span>
          <strong>{definitionStatus}</strong>
        </div>
      </div>
    </section>
  );
}

function groupRelationshipPreview(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const groups = new Map();

  for (const row of items) {
    const typeId = String(row?.typeId || "").trim();
    const typeTerm = String(row?.typeTerm || typeId).trim();
    const category = String(row?.category || "defining").trim() || "defining";
    if (!typeId) continue;
    const key = `${category}|${typeId}|${typeTerm}`;
    if (!groups.has(key)) {
      groups.set(key, {
        category,
        typeId,
        typeTerm,
        rows: []
      });
    }
    groups.get(key).rows.push(row);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      rows: group.rows.slice().sort((left, right) => {
        const termDiff = String(left?.destinationTerm || "").localeCompare(String(right?.destinationTerm || ""));
        if (termDiff !== 0) return termDiff;
        return String(left?.destinationId || "").localeCompare(String(right?.destinationId || ""));
      })
    }))
    .sort((left, right) => {
      const leftIsA = left.typeId === "116680003" ? 0 : 1;
      const rightIsA = right.typeId === "116680003" ? 0 : 1;
      if (leftIsA !== rightIsA) return leftIsA - rightIsA;
      return String(left.typeTerm || "").localeCompare(String(right.typeTerm || ""));
    });
}

function ConceptRelationshipTable({ concept, onNavigate, compact = false }) {
  const groups = groupRelationshipPreview(concept?.relationshipPreview);
  const definingGroups = groups.filter((group) => group.category !== "other");
  const otherGroups = groups.filter((group) => group.category === "other");

  if (definingGroups.length === 0 && otherGroups.length === 0) {
    return <p className={styles.subtitle}>No active related concepts were returned for this concept.</p>;
  }

  const renderCompactSection = (title, caption, sectionGroups) => {
    if (sectionGroups.length === 0) return null;
    return (
      <section className={styles.relationshipSection}>
        <div className={styles.relationshipSectionHead}>
          <strong className={styles.relationshipSectionTitle}>{title}</strong>
          <span className={styles.relationshipSectionCaption}>{caption}</span>
        </div>
        <div className={styles.relationshipGroupList}>
          {sectionGroups.map((group) => (
            <div key={`rel-group-${group.category}-${group.typeId}`} className={styles.relationshipGroupCard}>
              <div className={styles.relationshipGroupHead}>
                <strong>{group.typeTerm}</strong>
                <span className={styles.nodeChipStatic}>{group.rows.length}</span>
              </div>
              <div className={styles.relationshipTargetList}>
                {group.rows.map((row, idx) => (
                  <button
                    key={`compact-rel-${group.category}-${group.typeId}-${row.destinationId}-${idx}`}
                    type="button"
                    className={styles.relationshipTargetChip}
                    onClick={() => onNavigate?.(row.destinationId, row.destinationTerm || row.destinationId)}
                  >
                    <span>{row.destinationTerm || row.destinationId}</span>
                    <span className={styles.resultMeta}>#{row.destinationId}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const renderTableSection = (title, caption, sectionGroups) => {
    if (sectionGroups.length === 0) return null;
    return (
      <section className={styles.relationshipSection}>
        <div className={styles.relationshipSectionHead}>
          <strong className={styles.relationshipSectionTitle}>{title}</strong>
          <span className={styles.relationshipSectionCaption}>{caption}</span>
        </div>
        <div className={styles.relationshipTableWrap}>
          <table className={styles.relationshipTable}>
            <thead>
              <tr>
                <th>Relationship</th>
                <th>Relates to</th>
                <th>Concept ID</th>
                <th>Vocabulary</th>
              </tr>
            </thead>
            <tbody>
              {sectionGroups.map((group) =>
                group.rows.map((row, index) => (
                  <tr key={`table-rel-${group.category}-${group.typeId}-${row.destinationId}-${index}`}>
                    {index === 0 ? (
                      <td rowSpan={group.rows.length} className={styles.relationshipTypeCell}>
                        <strong>{group.typeTerm}</strong>
                        <span>{group.rows.length} connection{group.rows.length === 1 ? "" : "s"}</span>
                      </td>
                    ) : null}
                    <td>
                      <button
                        type="button"
                        className={styles.relationshipTargetButton}
                        onClick={() => onNavigate?.(row.destinationId, row.destinationTerm || row.destinationId)}
                      >
                        {row.destinationTerm || row.destinationId}
                      </button>
                      <div className={styles.resultBadges}>
                        {row.destinationSemanticTag ? <span className={styles.semTag}>{row.destinationSemanticTag}</span> : null}
                        {row.group !== null && row.group !== undefined ? <span className={styles.nodeChipStatic}>group {row.group}</span> : null}
                      </div>
                    </td>
                    <td className={styles.relationshipCodeCell}>#{row.destinationId}</td>
                    <td>SNOMED CT</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  if (compact) {
    return (
      <div className={styles.relationshipSectionStack}>
        {renderCompactSection(
          "Defining relationships",
          "Clinical semantics that define what this concept means.",
          definingGroups
        )}
        {renderCompactSection(
          "Other related concepts",
          "Administrative, historical, or crosswalk-style links.",
          otherGroups
        )}
      </div>
    );
  }

  return (
    <div className={styles.relationshipSectionStack}>
      {renderTableSection(
        "Defining relationships",
        "Clinical semantics that define what this concept means.",
        definingGroups
      )}
      {renderTableSection(
        "Other related concepts",
        "Administrative, historical, or crosswalk-style links.",
        otherGroups
      )}
    </div>
  );
}

function NavigatorFlatTable({ results, query, selectedConceptId, onOpenConcept }) {
  const [groupFilter, setGroupFilter] = useState("all");
  const [semanticTagFilter, setSemanticTagFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState("rank");
  const [preferredOnly, setPreferredOnly] = useState(false);

  const rankedResults = useMemo(
    () =>
      (Array.isArray(results) ? results : []).map((item, index) => ({
      ...item,
      _rank: index + 1,
      _group: navigatorResultGroup(item)?.key || "fuzzy",
      _kind: deriveNavigatorKind(item),
      _status: item?.active === false ? "inactive" : "active"
    })),
    [results]
  );

  const facetCounts = useMemo(
    () => ({
      semanticTags: buildFacetCounts(rankedResults.map((item) => item.semanticTag || "")),
      kinds: buildFacetCounts(rankedResults.map((item) => item._kind || "")),
      statuses: buildFacetCounts(rankedResults.map((item) => item._status || ""))
    }),
    [rankedResults]
  );

  const filteredResults = useMemo(() => {
    const visible = rankedResults.filter((item) => {
      if (preferredOnly && !item.isPreferred) return false;
      if (groupFilter !== "all" && item._group !== groupFilter) return false;
      if (semanticTagFilter !== "all" && String(item.semanticTag || "") !== semanticTagFilter) return false;
      if (kindFilter !== "all" && item._kind !== kindFilter) return false;
      if (statusFilter !== "all" && item._status !== statusFilter) return false;
      return true;
    });

    visible.sort((left, right) => {
      if (sortKey === "term") {
        const termDiff = String(left.term || "").localeCompare(String(right.term || ""));
        if (termDiff !== 0) return termDiff;
      } else if (sortKey === "conceptId") {
        const idDiff = String(left.conceptId || "").localeCompare(String(right.conceptId || ""));
        if (idDiff !== 0) return idDiff;
      } else if (sortKey === "match") {
        const tierDiff = Number(left.matchTier || 99) - Number(right.matchTier || 99);
        if (tierDiff !== 0) return tierDiff;
      } else {
        const rankDiff = Number(left._rank || 0) - Number(right._rank || 0);
        if (rankDiff !== 0) return rankDiff;
      }

      return Number(left._rank || 0) - Number(right._rank || 0);
    });

    return visible;
  }, [groupFilter, kindFilter, preferredOnly, rankedResults, semanticTagFilter, sortKey, statusFilter]);

  if (!Array.isArray(results) || results.length === 0) {
    return <p className={styles.subtitle}>Search results will appear here as a flat browser once you run a query.</p>;
  }

  return (
    <div className={styles.navigatorTableShell}>
      <div className={styles.navigatorTableToolbar}>
        <div className={styles.inlineList}>
          <button
            type="button"
            className={`${styles.tabPill} ${groupFilter === "all" ? styles.tabPillActive : ""}`}
            onClick={() => setGroupFilter("all")}
          >
            All
          </button>
          {NAVIGATOR_RESULT_GROUPS.map((group) => (
            <button
              key={`table-filter-${group.key}`}
              type="button"
              className={`${styles.tabPill} ${groupFilter === group.key ? styles.tabPillActive : ""}`}
              onClick={() => setGroupFilter(group.key)}
            >
              {group.label}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.tabPill} ${preferredOnly ? styles.tabPillActive : ""}`}
            onClick={() => setPreferredOnly((current) => !current)}
          >
            Preferred only
          </button>
        </div>

        <div className={styles.navigatorTableControls}>
          <label>
            Sort
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
              <option value="rank">Search rank</option>
              <option value="match">Match quality</option>
              <option value="term">Term A-Z</option>
              <option value="conceptId">SCTID</option>
            </select>
          </label>
          <span className={styles.nodeChipStatic}>{filteredResults.length} rows</span>
        </div>
      </div>

      <div className={styles.navigatorFacetGrid}>
        {facetCounts.kinds.length > 1 ? (
          <div className={styles.navigatorFacetBlock}>
            <span className={styles.navigatorFacetLabel}>Kind</span>
            <div className={styles.inlineList}>
              <button
                type="button"
                className={`${styles.tabPill} ${kindFilter === "all" ? styles.tabPillActive : ""}`}
                onClick={() => setKindFilter("all")}
              >
                All
              </button>
              {facetCounts.kinds.map((entry) => (
                <button
                  key={`facet-kind-${entry.value}`}
                  type="button"
                  className={`${styles.tabPill} ${kindFilter === entry.value ? styles.tabPillActive : ""}`}
                  onClick={() => setKindFilter(entry.value)}
                >
                  {entry.value} ({entry.count})
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {facetCounts.semanticTags.length > 1 ? (
          <div className={styles.navigatorFacetBlock}>
            <span className={styles.navigatorFacetLabel}>Semantic tag</span>
            <div className={styles.inlineList}>
              <button
                type="button"
                className={`${styles.tabPill} ${semanticTagFilter === "all" ? styles.tabPillActive : ""}`}
                onClick={() => setSemanticTagFilter("all")}
              >
                All
              </button>
              {facetCounts.semanticTags.slice(0, 8).map((entry) => (
                <button
                  key={`facet-tag-${entry.value}`}
                  type="button"
                  className={`${styles.tabPill} ${semanticTagFilter === entry.value ? styles.tabPillActive : ""}`}
                  onClick={() => setSemanticTagFilter(entry.value)}
                >
                  {entry.value} ({entry.count})
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {facetCounts.statuses.length > 1 ? (
          <div className={styles.navigatorFacetBlock}>
            <span className={styles.navigatorFacetLabel}>Status</span>
            <div className={styles.inlineList}>
              <button
                type="button"
                className={`${styles.tabPill} ${statusFilter === "all" ? styles.tabPillActive : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                All
              </button>
              {facetCounts.statuses.map((entry) => (
                <button
                  key={`facet-status-${entry.value}`}
                  type="button"
                  className={`${styles.tabPill} ${statusFilter === entry.value ? styles.tabPillActive : ""}`}
                  onClick={() => setStatusFilter(entry.value)}
                >
                  {entry.value} ({entry.count})
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <p className={styles.searchUsageHint}>
        Flat browser for the current search set{query ? ` matching "${query}"` : ""}. Use it when you want quick scanning and comparison before opening the hierarchy.
      </p>

      <div className={styles.navigatorTableWrap}>
        <table className={styles.navigatorTable}>
          <thead>
            <tr>
              <th>#</th>
              <th>SCTID</th>
              <th>Name</th>
              <th>Match</th>
              <th>Semantic tag</th>
              <th>FSN</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.map((item) => (
              <tr
                key={`navigator-row-${item.conceptId}`}
                className={selectedConceptId === item.conceptId ? styles.navigatorTableRowActive : ""}
              >
                <td className={styles.navigatorTableCodeCell}>{item._rank}</td>
                <td className={styles.navigatorTableCodeCell}>#{item.conceptId}</td>
                <td>
                  <button
                    type="button"
                    className={styles.navigatorTableTermButton}
                    onClick={() => onOpenConcept?.(item.conceptId, item.term || item.conceptId)}
                  >
                    {item.term || item.conceptId}
                  </button>
                  {item.languageCode ? <div className={styles.resultMeta}>{item.languageCode.toUpperCase()}</div> : null}
                </td>
                <td>
                  <span className={`${styles.searchReasonChip} ${navigatorReasonToneClass(item)}`}>
                    {navigatorMatchReason(item, query)}
                  </span>
                </td>
                <td>
                  <div className={styles.inlineList}>
                    {item.semanticTag ? <span className={styles.semTag}>{item.semanticTag}</span> : <span>n/a</span>}
                    <span className={styles.nodeChipStatic}>{item._kind}</span>
                    <span className={styles.nodeChipStatic}>{item._status}</span>
                  </div>
                </td>
                <td className={styles.navigatorTableFsnCell}>{item.fsn || "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function buildSnomedVersionUri(releaseId) {
  const normalized = String(releaseId || "").trim();
  if (!normalized || normalized.toLowerCase() === "latest") {
    return "http://snomed.info/sct";
  }
  return `http://snomed.info/sct/${normalized}`;
}

function TerminologyUriStrip({ releaseId }) {
  const systemUri = "http://snomed.info/sct";
  const versionUri = buildSnomedVersionUri(releaseId);

  return (
    <div className={styles.uriStrip}>
      <div className={styles.uriRow}>
        <span className={styles.uriKey}>url</span>
        <span className={styles.uriValue}>{systemUri}</span>
      </div>
      <div className={styles.uriRow}>
        <span className={styles.uriKey}>version</span>
        <span className={styles.uriValue}>{versionUri}</span>
      </div>
    </div>
  );
}

function ConceptPropertyTable({ concept, languageCode = "en" }) {
  if (!concept) return null;

  const primitive = String(concept.definitionStatusId || "") !== "900000000000073002";
  const rows = [
    ["System", "http://snomed.info/sct"],
    ["Code", concept.conceptId || "n/a"],
    ["Preferred", concept.preferredTerm || "n/a"],
    ["Display", `${String(languageCode || "en").toLowerCase()} ${concept.preferredTerm || "n/a"}`],
    ["Effective Time", concept.effectiveTime || "n/a"],
    ["Primitive", primitive ? "true" : "false"],
    ["Fully specified name", concept.fullySpecifiedName || concept.preferredTerm || "n/a"],
    ["Inactive", concept.active === false ? "true" : "false"],
    ["Module ID", concept.moduleId || "n/a"],
    ["Synonym (acceptable)", Array.isArray(concept.synonymPreview) && concept.synonymPreview[0] ? concept.synonymPreview[0] : "n/a"]
  ];

  return (
    <div className={styles.propertyTableWrap}>
      <table className={styles.propertyTable}>
        <thead>
          <tr>
            <th>Property</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <td>{key}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApiDrawer({ examples, docsHref = "/docs", docsLabel = "Open API docs" }) {
  const [activeKey, setActiveKey] = useState(examples[0]?.key || "");
  const [copyState, setCopyState] = useState("");

  useEffect(() => {
    setActiveKey(examples[0]?.key || "");
    setCopyState("");
  }, [examples]);

  const activeExample = examples.find((entry) => entry.key === activeKey) || examples[0] || null;
  if (!activeExample) return null;

  const copyCurl = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeExample.curl);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = activeExample.curl;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyState("Copied");
      window.setTimeout(() => setCopyState(""), 1800);
    } catch {
      setCopyState("Copy failed");
      window.setTimeout(() => setCopyState(""), 1800);
    }
  };

  return (
    <details className={styles.apiDrawer}>
      <summary className={styles.apiDrawerSummary}>
        <span className={styles.apiDrawerTitle}>Developer API</span>
        <span className={styles.apiDrawerCaption}>Contextual request, response, and curl for this workflow</span>
      </summary>

      <div className={styles.apiDrawerBody}>
        <div className={styles.apiDrawerTopbar}>
          <div className={styles.apiDrawerTabs}>
            {examples.map((example) => (
              <button
                key={example.key}
                type="button"
                className={`${styles.apiMiniTab} ${activeExample.key === example.key ? styles.apiMiniTabActive : ""}`}
                onClick={() => setActiveKey(example.key)}
              >
                {example.label}
              </button>
            ))}
          </div>

          <a className={styles.apiDrawerLink} href={docsHref}>
            {docsLabel}
          </a>
        </div>

        <div className={styles.apiEndpointBar}>
          <span className={`${styles.apiMethodPill} ${activeExample.method === "GET" ? styles.apiMethodGet : styles.apiMethodPost}`}>
            {activeExample.method}
          </span>
          <code className={styles.apiPathCode}>{activeExample.path}</code>
        </div>

        <div className={styles.apiDrawerGrid}>
          <div className={styles.apiPane}>
            <div className={styles.apiPaneHead}>
              <div className={styles.apiPaneLabel}>cURL</div>
            </div>
            <Code language="bash">{activeExample.curl}</Code>
          </div>

          <div className={styles.apiPane}>
            <div className={styles.apiPaneLabel}>{activeExample.body ? "Request body" : "Response preview"}</div>
            <Code language="json">{formatApiPayload(activeExample.body || activeExample.response)}</Code>
          </div>

          {activeExample.body ? (
            <div className={`${styles.apiPane} ${styles.apiPaneWide}`}>
              <div className={styles.apiPaneLabel}>Response preview</div>
              <Code language="json">{formatApiPayload(activeExample.response)}</Code>
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}

export default function DemoWorkbench() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const urlTab = normalizeTabKey(searchParams.get("tab")) || "foundations";
  const [activeTab, setActiveTab] = useState(urlTab);
  // Active grounding model for the session — chosen in the header (informed by
  // the benchmark), used as the default extraction model in Ground a Note.
  // Persisted to localStorage; synced after mount to avoid a hydration mismatch.
  const [sessionModel, setSessionModelState] = useState(SESSION_MODELS[0]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("sessionModel");
      if (saved && SESSION_MODELS.includes(saved)) setSessionModelState(saved);
    } catch (_e) { /* localStorage unavailable */ }
  }, []);
  const setSessionModel = (m) => {
    setSessionModelState(m);
    try { window.localStorage.setItem("sessionModel", m); } catch (_e) { /* ignore */ }
  };
  // Sidebar is always visible; appendixOpen retained for compatibility
  const [appendixOpen, setAppendixOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE);
  const [areaConceptId, setAreaConceptId] = useState("");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [smartEcl, setSmartEcl] = useState("<<404684003");
  const [scopeLabelHints, setScopeLabelHints] = useState({});
  const [smartScopeSourceLabel, setSmartScopeSourceLabel] = useState("shared draft");
  const [smartReleaseId, setSmartReleaseId] = useState("");


  const [conceptIdInput, setConceptIdInput] = useState("");
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [navSeed, setNavSeed] = useState(null);
  const [schemaTab, setSchemaTab] = useState("concept");
  const [overviewSub, setOverviewSub] = useState("overview");
  const [navigationTrail, setNavigationTrail] = useState([]);
  const [explorerCenterTab, setExplorerCenterTab] = useState("graph");
  const [explorerInspectorTab, setExplorerInspectorTab] = useState("summary");
  const [explorerDeveloperMode, setExplorerDeveloperMode] = useState(false);
  const [explorerFeedback, setExplorerFeedback] = useState({ conceptId: "", outcome: "" });

  const [clinicalText, setClinicalText] = useState(DEFAULT_CLINICAL_TEXT);
  const [mapTargetContext, setMapTargetContext] = useState("Condition.code");
  const [mapRetrievalProfile, setMapRetrievalProfile] = useState("lexical_exact");

  const [searchCall, setSearchCall] = useState(EMPTY_CALL);
  const [conceptCall, setConceptCall] = useState(EMPTY_CALL);
  const [conceptHistoryCall, setConceptHistoryCall] = useState(EMPTY_CALL);
  const [graphCall, setGraphCall] = useState(EMPTY_CALL);
  const [readinessCall, setReadinessCall] = useState(EMPTY_CALL);
  const readinessInFlightRef = useRef(false);
  const [statsCall, setStatsCall] = useState(EMPTY_CALL);
  const [releaseDiffCall, setReleaseDiffCall] = useState(EMPTY_CALL);

  const [assistantPrincipalDx, setAssistantPrincipalDx] = useState(null);
  const [assistantBindingCall, setAssistantBindingCall] = useState(EMPTY_CALL);

  const searchReadinessKnown = Boolean(readinessCall.response?.readiness);
  const searchBlocked = searchReadinessKnown && readinessCall.response.readiness.textIndexReady !== true;
  const searchBlockedMessage = "MongoDB Search index is not queryable. Open the Data Model section and wait for the search index to become ready.";

  const [ancestorChain, setAncestorChain] = useState([]);

  const hierarchyCacheRef = useRef(new Map());
  const searchRequestSeqRef = useRef(0);
  const conceptHistorySeqRef = useRef(0);
  const explorerSessionRef = useRef(null);
  const searchResults = searchCall.response?.results || [];
  const groupedSearchResults = useMemo(() => groupNavigatorResults(searchResults), [searchResults]);
  const concept = conceptCall.response?.concept || conceptCall.response?.results?.[0] || null;
  const conceptHistory = conceptHistoryCall.response?.entries || [];
  const ancestorNeighbors = graphCall.response?.result?.neighbors || [];
  const navigatorScopeLabel = useMemo(
    () => describeNavigatorScope(searchCall.response?.scope, areaConceptId),
    [searchCall.response?.scope, areaConceptId]
  );

  const primaryPath = useMemo(() => {
    const chain = Array.isArray(ancestorChain) ? ancestorChain : [];
    const focus = concept
      ? [{
          conceptId: String(concept.conceptId || ""),
          term: concept.preferredTerm || concept.term || String(concept.conceptId || "")
        }]
      : [];

    const fromHistory = !concept && Array.isArray(navigationTrail) ? navigationTrail : [];
    const source = concept ? [...chain, ...focus] : fromHistory;

    const deduped = [];
    const seen = new Set();
    for (const item of source) {
      const conceptId = String(item?.conceptId || "").trim();
      if (!conceptId || seen.has(conceptId)) continue;
      seen.add(conceptId);
      deduped.push({
        conceptId,
        term: String(item?.term || conceptId).trim()
      });
    }
    return deduped;
  }, [ancestorChain, concept, navigationTrail]);
  const hasAlternativeAncestorBranches =
    Number(concept?.parentCount || 0) > 1 ||
    ancestorNeighbors.some((node) => Array.isArray(node?.inferredParentIds) && node.inferredParentIds.length > 1);

  const primaryPathLabel = concept?.parentCount > 1
    ? "Stable path (1 of " + concept.parentCount + " parent branches)"
    : "Stable path";
  const primaryPathHint = hasAlternativeAncestorBranches
    ? `${PRIMARY_PATH_POLICY_LABEL}: ${PRIMARY_PATH_POLICY_HINT} Use All parents in Hierarchy to inspect the alternative branches.`
    : "Single-parent concept in the selected release. The displayed path is direct.";
  const explorerHasSelection = Boolean(concept);
  const recentConcepts = navigationTrail.slice(-4).reverse();
  const foundationScopeSeedId = useMemo(() => extractSimpleConceptIdFromExpr(smartEcl), [smartEcl]);
  const foundationScopeSeedLabel = useMemo(() => {
    if (!foundationScopeSeedId) return "";
    if (concept?.conceptId && String(concept.conceptId) === foundationScopeSeedId) {
      return concept.preferredTerm || concept.term || foundationScopeSeedId;
    }
    return scopeLabelHints[foundationScopeSeedId] || foundationScopeSeedId;
  }, [concept, foundationScopeSeedId, scopeLabelHints]);
  const foundationSelectedConceptLabel = concept?.preferredTerm || concept?.term || "";

  const emitExplorerEvent = (eventType, payload = {}) => {
    if (typeof window === "undefined") return;

    const body = JSON.stringify({
      eventType,
      tenantId: "demo-minister",
      actorId: "explorer-user",
      languageCode,
      releaseId: concept?.releaseId || "latest",
      ...payload
    });

    try {
      if (navigator?.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/explorer-feedback", blob);
        return;
      }
    } catch {
      // fall through to fetch
    }

    fetch("/api/explorer-feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body,
      keepalive: true
    }).catch(() => {});
  };

  const runSearch = async (overrides = {}) => {
    if (!explorerSessionRef.current) {
      explorerSessionRef.current = makeExplorerSession();
    }

    const params = {
      query: String(overrides.query ?? query ?? "").trim(),
      languageCode: overrides.languageCode ?? languageCode,
      areaConceptId: overrides.areaConceptId ?? areaConceptId,
      limit: overrides.limit ?? limit
    };

    if (!params.query) {
      setSearchCall({ loading: false, error: "", response: null });
      return null;
    }

    if (searchBlocked) {
      setSearchCall({ loading: false, error: searchBlockedMessage, response: null });
      return null;
    }

    const requestSeq = ++searchRequestSeqRef.current;
    setSearchCall((current) => ({ ...current, loading: true, error: "" }));

    try {
      const endpoint = overrides.typeahead ? "/api/navigator-suggest" : "/api/navigator-search";
      const payload = await postJson(endpoint, params);

      // Ignore stale responses from older typeahead requests.
      if (requestSeq !== searchRequestSeqRef.current) {
        return payload;
      }

      setSearchCall({ loading: false, error: "", response: payload });

      if (!overrides.typeahead) {
        const now = Date.now();
        const session = explorerSessionRef.current;
        if (!session.firstSearchAt) {
          session.firstSearchAt = now;
        }
        if (session.submittedQuery && session.submittedQuery !== params.query) {
          session.reformulations += 1;
        }
        session.submittedQuery = params.query;
        session.lastSearchAt = now;
        session.searchCount += 1;

        emitExplorerEvent("explorer.search.submitted", {
          query: params.query,
          resultCount: payload?.results?.length || 0,
          durationMs: payload?.stats?.latencyMs || null,
          metadata: {
            sessionId: session.sessionId,
            searchCount: session.searchCount,
            reformulations: session.reformulations,
            areaConceptId: params.areaConceptId || null,
            limit: params.limit
          }
        });
      }

      return payload;
    } catch (error) {
      if (requestSeq !== searchRequestSeqRef.current) {
        return null;
      }

      setSearchCall({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        response: null
      });
      return null;
    }
  };

  const applyHierarchyPayload = (payload, normalizedConceptId) => {
    const conceptResponse = payload?.conceptResponse || null;
    const graphResponse = payload?.graphResponse || null;

    setConceptCall({ loading: false, error: "", response: conceptResponse });
    setGraphCall({ loading: false, error: "", response: graphResponse });

    const resolved = conceptResponse?.concept || conceptResponse?.results?.[0] || null;
    if (resolved) {
      setSelectedConcept({
        conceptId: resolved.conceptId,
        term: resolved.preferredTerm || resolved.term || normalizedConceptId
      });
    }

    const chain = Array.isArray(payload?.ancestorChain) ? payload.ancestorChain : [];
    setAncestorChain(chain);
  };

  const runHierarchy = async (conceptId, overrides = {}) => {
    const normalized = String(conceptId || "").trim();
    if (!normalized) return null;

    const direction = overrides.direction === "descendants" ? "descendants" : "ancestors";
    const maxDepth = clamp(Number(overrides.maxDepth ?? 6), 0, 6);
    const graphLimit = clamp(Number(overrides.limit ?? limit), 10, 60);
    const childLimit = clamp(Number(overrides.childLimit ?? 25), 1, 100);
    const forceRefresh = overrides.forceRefresh === true;
    const hierarchyLanguageCode = overrides.languageCode ?? languageCode;

    const cacheKey = `${normalized}|${hierarchyLanguageCode}|${direction}|${maxDepth}|${graphLimit}|${childLimit}`;

    if (!forceRefresh) {
      const cached = hierarchyCacheRef.current.get(cacheKey);
      if (cached) {
        applyHierarchyPayload(cached, normalized);
        return cached;
      }
    }

    setConceptCall((current) => ({ ...current, loading: true, error: "" }));
    setGraphCall((current) => ({ ...current, loading: true, error: "" }));

    try {
      const payload = await postJson("/api/hierarchy", {
        conceptId: normalized,
        direction,
        maxDepth,
        limit: graphLimit,
        childLimit,
        forceRefresh,
        languageCode: hierarchyLanguageCode
      });

      const graphNeighbors = payload?.graphResponse?.result?.neighbors || [];
      const computedAncestorChain = buildAncestorChain(graphNeighbors, normalized);
      const normalizedPayload = {
        ...payload,
        ancestorChain: computedAncestorChain.length > 0
          ? computedAncestorChain
          : (Array.isArray(payload?.ancestorChain) ? payload.ancestorChain : [])
      };

      hierarchyCacheRef.current.set(cacheKey, normalizedPayload);
      applyHierarchyPayload(normalizedPayload, normalized);
      return normalizedPayload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConceptCall({
        loading: false,
        error: message,
        response: null
      });
      setGraphCall({
        loading: false,
        error: message,
        response: null
      });
      return null;
    }
  };

  const runConceptHistory = async (conceptId, overrides = {}) => {
    const normalized = String(conceptId || "").trim();
    if (!normalized) {
      setConceptHistoryCall(EMPTY_CALL);
      return null;
    }

    const requestSeq = ++conceptHistorySeqRef.current;
    setConceptHistoryCall((current) => ({
      loading: true,
      error: "",
      response:
        current.response?.conceptId === normalized && current.response?.languageCode === (overrides.languageCode ?? languageCode)
          ? current.response
          : null
    }));

    try {
      const params = new URLSearchParams({
        conceptId: normalized,
        languageCode: overrides.languageCode ?? languageCode,
        limit: String(clamp(Number(overrides.limit) || 12, 1, 30))
      });
      const payload = await getJson(`/api/concept-history?${params.toString()}`);

      if (requestSeq !== conceptHistorySeqRef.current) {
        return payload;
      }

      setConceptHistoryCall({
        loading: false,
        error: "",
        response: payload
      });
      return payload;
    } catch (error) {
      if (requestSeq !== conceptHistorySeqRef.current) {
        return null;
      }

      setConceptHistoryCall({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        response: null
      });
      return null;
    }
  };

  const updateNavigationTrail = (conceptId, term, options = {}) => {
    const normalized = String(conceptId);
    const resolvedTerm = term || normalized;

    setNavigationTrail((current) => {
      if (options.resetTrail || !Array.isArray(current) || current.length === 0) {
        return [{ conceptId: normalized, term: resolvedTerm }];
      }

      const existingIndex = current.findIndex((item) => item.conceptId === normalized);
      if (existingIndex >= 0) {
        const sliced = current.slice(0, existingIndex + 1);
        sliced[existingIndex] = { ...sliced[existingIndex], term: resolvedTerm };
        return sliced;
      }

      return [...current, { conceptId: normalized, term: resolvedTerm }].slice(-8);
    });
  };

  const loadConcept = async (conceptId, term = "", options = {}) => {
    if (!conceptId) return;

    const normalized = String(conceptId);
    const resolvedTerm = term || normalized;

    setConceptIdInput(normalized);
    setSelectedConcept({ conceptId: normalized, term: resolvedTerm });
    updateNavigationTrail(normalized, resolvedTerm, options);

    await runHierarchy(normalized, {
      limit: options.limit,
      forceRefresh: options.forceRefresh === true,
      languageCode: options.languageCode
    });

    if (options.source) {
      const session = explorerSessionRef.current || makeExplorerSession();
      explorerSessionRef.current = session;
      const now = Date.now();

      emitExplorerEvent("explorer.result.selected", {
        conceptId: normalized,
        conceptIds: [normalized],
        query: options.queryText || session.submittedQuery || "",
        metadata: {
          sessionId: session.sessionId,
          source: options.source,
          rank: Number.isFinite(Number(options.rank)) ? Number(options.rank) : null,
          matchReason: options.matchReason || null,
          reformulations: session.reformulations,
          searchCount: session.searchCount,
          timeFromFirstSearchMs: session.firstSearchAt ? now - session.firstSearchAt : null,
          timeFromLastSearchMs: session.lastSearchAt ? now - session.lastSearchAt : null
        }
      });
    }
  };

  const runExplorerExample = async (example) => {
    if (!example?.query) return;
    setQuery(example.query);
    if (example.languageCode) {
      setLanguageCode(example.languageCode);
    }
    await runSearch({
      query: example.query,
      languageCode: example.languageCode || languageCode,
      autoOpen: false
    });
  };

  const openBySctid = async () => {
    const normalized = String(conceptIdInput || "").trim();
    if (!normalized) return;
    await loadConcept(normalized, normalized, { resetTrail: true, source: "sctid-open" });
  };

  const copyConceptId = async () => {
    if (!concept?.conceptId) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(concept.conceptId));
      }
    } catch {
      // best-effort copy
    }
  };

  const openFoundationScopeSeed = () => {
    if (!foundationScopeSeedId) return;
    openTab("navigate");
    loadConcept(
      foundationScopeSeedId,
      foundationScopeSeedLabel || foundationScopeSeedId,
      { resetTrail: true, source: "scope-seed-open" }
    );
  };

  const submitExplorerFeedback = (outcome) => {
    if (!concept?.conceptId || !outcome) return;
    setExplorerFeedback({ conceptId: concept.conceptId, outcome });
    emitExplorerEvent("explorer.feedback.submitted", {
      conceptId: concept.conceptId,
      conceptIds: [concept.conceptId],
      query,
      metadata: {
        sessionId: explorerSessionRef.current?.sessionId || null,
        outcome,
        reformulations: explorerSessionRef.current?.reformulations || 0,
        searchCount: explorerSessionRef.current?.searchCount || 0
      }
    });
  };
  // Sidebar counters. Cheap O(1) metadata reads, so this is safe to call on mount —
  // unlike readiness, which is a diagnostic and loads on demand.
  const runStats = async () => {
    try {
      const payload = await getJson("/api/stats");
      setStatsCall({ loading: false, error: "", response: payload });
    } catch (error) {
      setStatsCall({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        response: null
      });
    }
  };

  const runReadiness = async () => {
    // Two effects used to race into this on mount, so a single page load could
    // issue two readiness calls. Guard on a ref rather than the loading state,
    // which is not yet visible to an effect running in the same commit.
    if (readinessInFlightRef.current) return;
    readinessInFlightRef.current = true;

    setReadinessCall((current) => ({ ...current, loading: true, error: "" }));
    try {
      const payload = await getJson("/api/readiness");
      setReadinessCall({ loading: false, error: "", response: payload });
    } catch (error) {
      setReadinessCall({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        response: null
      });
    } finally {
      readinessInFlightRef.current = false;
    }
  };

  const runReleaseDiff = async () => {
    setReleaseDiffCall((current) => ({ ...current, loading: true, error: "" }));
    try {
      const payload = await getJson("/api/release-diff");
      setReleaseDiffCall({ loading: false, error: "", response: payload });
    } catch (error) {
      setReleaseDiffCall({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        response: null
      });
    }
  };

  const handlePrincipalDiagnosisReady = (candidates) => {
    if (Array.isArray(candidates) && candidates.length > 0) {
      setAssistantPrincipalDx(candidates[0]);
    } else {
      setAssistantPrincipalDx(null);
    }
  };

  useEffect(() => {
    explorerSessionRef.current = makeExplorerSession();
    runStats();
    // Readiness is deliberately not fetched here. It is a diagnostic whose every
    // consumer lives in MODEL STUDIO, and the tab effect below loads it on demand.
    // Fetching on mount meant a full collection scan per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab !== "navigate") return;
    if (searchBlocked) return;

    const normalizedQuery = String(query || "").trim();
    if (normalizedQuery.length < NAVIGATE_TYPEAHEAD_MIN_CHARS) {
      if (!normalizedQuery) {
        setSearchCall((current) => ({ ...current, loading: false, error: "", response: null }));
      }
      return;
    }

    const timer = setTimeout(() => {
      runSearch({
        query: normalizedQuery,
        autoOpen: false,
        typeahead: true,
        limit: Math.min(limit, 10)
      });
    }, NAVIGATE_TYPEAHEAD_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, query, languageCode, areaConceptId, limit, searchBlocked]);

  useEffect(() => {
    if (APPENDIX_TABS.includes(activeTab) && !appendixOpen) {
      setAppendixOpen(true);
    }
  }, [activeTab, appendixOpen]);

  useEffect(() => {
    // MODEL STUDIO is the only place readiness is rendered, so only fetch when it
    // is actually on screen. The default tab is "foundations" with the "overview"
    // subtab, which renders neither the readiness panel nor the live stats.
    const modelStudioOpen =
      activeTab === "model" || (activeTab === "foundations" && overviewSub === "model");

    if (modelStudioOpen && !readinessCall.response && !readinessCall.loading) {
      runReadiness();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, overviewSub]);

  useEffect(() => {
    if (!explorerDeveloperMode && explorerInspectorTab === "raw") {
      setExplorerInspectorTab("summary");
    }
  }, [explorerDeveloperMode, explorerInspectorTab]);

  useEffect(() => {
    if (!concept?.conceptId) return;
    if (explorerFeedback.conceptId !== concept.conceptId) {
      setExplorerFeedback({ conceptId: concept.conceptId, outcome: "" });
    }
  }, [concept?.conceptId, explorerFeedback.conceptId]);

  useEffect(() => {
    if (!concept?.conceptId) {
      setConceptHistoryCall(EMPTY_CALL);
      return;
    }

    setConceptHistoryCall((current) => (
      current.response?.conceptId === concept.conceptId && current.response?.languageCode === languageCode
        ? current
        : EMPTY_CALL
    ));
  }, [concept?.conceptId, languageCode]);

  useEffect(() => {
    if (explorerInspectorTab !== "history") return;
    if (!concept?.conceptId) return;
    if (conceptHistoryCall.loading) return;
    if (conceptHistoryCall.response?.conceptId === concept.conceptId && conceptHistoryCall.response?.languageCode === languageCode) {
      return;
    }
    runConceptHistory(concept.conceptId, { languageCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concept?.conceptId, explorerInspectorTab, languageCode]);

  const readiness = readinessCall.response;

  const activeMeta = TAB_META[activeTab];
  const statsSummary = statsCall.response?.counts || {};
  const activeApiExamples = buildWorkflowApiExamples({
    activeTab,
    conceptIdInput,
    selectedConcept,
    languageCode,
    smartEcl,
    scopeReleaseId: smartReleaseId,
    targetContext: mapTargetContext,
    retrievalProfile: mapRetrievalProfile,
    query,
    clinicalText
  });

  function openTab(nextTab) {
    const normalized = normalizeTabKey(nextTab) || "foundations";
    setActiveTab(normalized);

    const nextParams = new URLSearchParams(searchParams.toString());
    if (normalized === "foundations") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", normalized);
    }

    const nextQuery = nextParams.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }

  useEffect(() => {
    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [urlTab, activeTab]);

  return (
    <main className="page-shell">
      {/* ── SIDEBAR ── */}
      <nav className="appSidebar">
        <div className="sidebarBrand">
          <div className="sidebarMark">
            <img src="/mongodb-mark.svg" alt="MongoDB" width={18} height={38} />
          </div>
          <div className="sidebarBrandText">
            <small>MongoDB</small>
            <strong>SNOMED CT</strong>
          </div>
        </div>

        {SIDEBAR_SECTIONS.map((section) => (
          <div key={section.label} className="sidebarSection">
            <div className="sidebarSectionLabel">{section.label}</div>
            <div className="sidebarNav">
              {section.tabs.map((key) => (
                <SidebarItem
                  key={key}
                  icon={TAB_META[key].icon}
                  label={TAB_META[key].label}
                  active={activeTab === key}
                  onClick={() => openTab(key)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="sidebarStats">
          <div className="sidebarLiveRow">
            <span className="sidebarLiveDot" />
            SNOMED on MongoDB
          </div>
          <div className="sidebarStat">
            <span>Concepts</span>
            <span>{statsSummary.sourceCount?.toLocaleString() ?? "—"}</span>
          </div>
          <div className="sidebarStat">
            <span>Search index</span>
            <span>{statsSummary.projectionCount?.toLocaleString() ?? "—"}</span>
          </div>
        </div>
      </nav>

      {/* ── TOP HEADER ── */}
      <header className="appHeader">
        <div className="appHeaderLeft">
          <div className="appBreadcrumb">
            <span className="appBreadcrumbRoot">SNOMED CT</span>
            <span className="appBreadcrumbSep">›</span>
            <span className="appBreadcrumbCurrent">{activeMeta?.title || "Workspace"}</span>
          </div>
          <p className="appBreadcrumbSub">{activeMeta?.summary || ""}</p>
        </div>
        <div className="appHeaderRight">
          {SESSION_MODELS.length > 1 ? (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#5C6C75" }}>
              <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10.5 }}>Session model</span>
              <select value={sessionModel} onChange={(e) => setSessionModel(e.target.value)} title="Extraction model used when you Ground a Note"
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 7, border: "1px solid #C1C7CB", background: "#fff", color: "#001E2B", fontWeight: 600, cursor: "pointer", maxWidth: 200 }}>
                {SESSION_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          ) : null}
          <span className="appStatusLive">
            <span className="appStatusLiveDot" />
            Live
          </span>
          <span className="appPill">SNOMED CT</span>
          <button className="appHeaderLink" type="button" onClick={() => openTab("api")} style={{ background: "none", border: "none", cursor: "pointer" }}>
            API docs
          </button>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <div className="appMain">
        <section className={styles.workbench}>
          {API_DRAWER_TABS.includes(activeTab) && activeApiExamples.length > 0 && (
            <ApiDrawer examples={activeApiExamples} />
          )}

      {/* ============================================================
          TAB: FOUNDATIONS
          ============================================================ */}
      {/* ── Overview subtabs (rendered outside the tall studioShell so the
          buttons keep their natural height) ── */}
      {activeTab === "foundations" && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          {[["overview", "Solution overview"], ["architecture", "Architecture"], ["model", "Data model"], ["licensing", "Licensing"]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setOverviewSub(key)}
              style={{
                padding: "8px 16px", fontSize: 13, cursor: "pointer", borderRadius: 8, alignSelf: "center",
                fontWeight: overviewSub === key ? 700 : 600,
                border: `1px solid ${overviewSub === key ? OV_GREEN : OV_BORDER}`,
                background: overviewSub === key ? OV_GREEN : "#fff",
                color: overviewSub === key ? "#fff" : OV_INK
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "foundations" && overviewSub === "overview" && (
        <div className={styles.studioShell}>
          <article style={OV.article}>
            <span style={OV.eyebrow}>MongoDB · SNOMED CT terminology service</span>
            <h2 style={OV.articleTitle}>SNOMED CT on MongoDB</h2>
            <p style={OV.lead}>
              Healthcare applications need to understand clinical meaning, not just store clinical text. This solution
              models SNOMED CT — one of the major clinical coding systems — on MongoDB, so teams can search,
              navigate, and code clinical language on a single platform.
            </p>

            <h3 style={OV.h3}>The problem it solves</h3>
            <p style={OV.p}>
              A clinician may write “heart failure,” “cardiac failure,” or “insuficiencia cardíaca” to describe the same
              idea. When meaning stays locked in free text, software cannot reliably store, exchange, or analyze care.
              Clinical coding fixes this by giving every clinical idea a standard, stable identifier that systems agree
              on — so a patient’s conditions, procedures, and findings become data, not just words.
            </p>

            <h3 style={OV.h3}>What SNOMED CT is — and why it is hard to model</h3>
            <p style={OV.p}>
              SNOMED CT is a large clinical terminology covering problems, findings, procedures, body structures,
              organisms, substances, and more. It is far richer than a flat list of codes: each concept carries many
              human-readable terms (synonyms and translations included), sits within a hierarchy of broader and
              more-specific concepts, and connects to other concepts through formal relationships. That graph-like shape
              is what makes it powerful — and what makes it awkward to implement. Teams usually end up spreading it
              across a relational database for the raw files, a search engine for text lookup, a graph database for the
              hierarchy, and a separate vector database for semantic search.
            </p>

            <h3 style={OV.h3}>Why a document model on MongoDB</h3>
            <p style={OV.p}>
              This solution keeps each concept whole. One MongoDB document holds a concept’s identity, its descriptions,
              its relationships, its parents and children, and its full ancestor path — so displaying or reasoning about
              a concept needs no joins. Because the ancestor path is precomputed on every document, answering “is this a
              kind of heart disease?” or “give me everything under diabetes” becomes a single indexed lookup rather than
              a live graph traversal. MongoDB Search (lexical), MongoDB Vector Search (semantic), and the aggregation
              pipeline all run on that same data, so one platform covers terminology storage, search, hierarchy
              navigation, and clinical coding — no external search engine, graph database, or vector store required.
            </p>

            <h3 style={OV.h3}>How the data flows</h3>
            <p style={OV.p}>
              A licensed SNOMED RF2 release is transformed into two collections: <code>snomed_concepts</code>, the
              canonical concept documents, and <code>snomed_terms</code>, a term-level projection shaped for MongoDB Search
              and Vector Search. Clinical notes grounded in the app are stored in <code>grounded_notes</code> as reviewed
              codings that carry their ancestor paths.
            </p>
          </article>

          {/* ── Architecture flow (inline figure) ── */}
          <div className={styles.pipelineFlow}>
            <div className={styles.pipelineNode}>
              <img src="/mdb-database.png" alt="" className={styles.pipelineNodeIcon} />
              <span className={styles.pipelineNodeLabel}>SNOMED RF2</span>
              <span className={styles.pipelineNodeSub}>Licensed release</span>
            </div>
            <div className={styles.pipelineArrow}>›</div>
            <div className={`${styles.pipelineNode} ${styles.pipelineNodeActive}`}>
              <img src="/mdb-data-modeling.png" alt="" className={styles.pipelineNodeIcon} />
              <span className={styles.pipelineNodeLabel}>snomed_concepts</span>
              <span className={styles.pipelineNodeSub}>Concept documents</span>
            </div>
            <div className={styles.pipelineArrow}>›</div>
            <div className={`${styles.pipelineNode} ${styles.pipelineNodeActive}`}>
              <img src="/mdb-search.png" alt="" className={styles.pipelineNodeIcon} />
              <span className={styles.pipelineNodeLabel}>snomed_terms</span>
              <span className={styles.pipelineNodeSub}>Search + Vector</span>
            </div>
            <div className={styles.pipelineArrow}>›</div>
            <div className={`${styles.pipelineNode} ${styles.pipelineNodeActive}`}>
              <img src="/mdb-healthcare-query.png" alt="" className={styles.pipelineNodeIcon} />
              <span className={styles.pipelineNodeLabel}>grounded_notes</span>
              <span className={styles.pipelineNodeSub}>Reviewed codings</span>
            </div>
          </div>

          {/* ── What to try (narrative) ── */}
          <article style={OV.article}>
            <h3 style={OV.h3}>What to try</h3>
            <p style={OV.p}>
              <strong style={{ color: OV_INK }}>Search and find a concept.</strong> In the Navigation tab, search a
              clinical term such as “heart failure” using lexical, semantic, or hybrid search, and see matching SNOMED
              terms ranked by relevance.
            </p>
            <p style={OV.p}>
              <strong style={{ color: OV_INK }}>Navigate the hierarchy.</strong> Open a concept to inspect its parents,
              children, relationships, and descendants — resolved from the precomputed ancestor arrays, with a graph,
              table, and value-set view.
            </p>
            <p style={OV.p}>
              <strong style={{ color: OV_INK }}>Ground a clinical note.</strong> In the Ground Clinical Note tab, paste
              or pick a note and watch it extract mentions, detect negation and context, and let a reviewer confirm the
              SNOMED codings before anything is stored.
            </p>
            <p style={OV.p}>
              <strong style={{ color: OV_INK }}>Query by meaning.</strong> Stored codings keep their ancestor paths, so
              grounded notes can be found by SNOMED ancestor — one indexed subsumption query, not exact-text matching.
            </p>
          </article>

        </div>
      )}

      {/* ============================================================
          TAB: NAVIGATE
          ============================================================ */}
      {activeTab === "navigate" && (
        <NavigateWorkbench defaultLanguageCode={languageCode} seed={navSeed} />
      )}

      {/* ============================================================
          TAB: CLINICAL ASSISTANT
          ============================================================ */}
      {activeTab === "intelligent" && (
        <GroundWorkbench defaultLanguageCode={languageCode} sessionModel={sessionModel} onSessionModelChange={setSessionModel} />
      )}

      {/* ============================================================
          TAB: API REFERENCE (curated OpenAPI view)
          ============================================================ */}
      {activeTab === "api" && (
        <div className={styles.studioShell}>
          <ApiDocsPanel />
        </div>
      )}

      {/* ============================================================
          TAB: BENCHMARK (gold-note accuracy across models)
          ============================================================ */}
      {activeTab === "benchmark" && (
        <div className={styles.studioShell}>
          <BenchmarkView sessionModel={sessionModel} onPickModel={setSessionModel} />
        </div>
      )}

      {/* ── Architecture reference (Overview subtab) ── */}
      {activeTab === "foundations" && overviewSub === "architecture" && (
        <ArchitectureDiagram />
      )}

      {/* ============================================================
          TAB: MODEL STUDIO
          ============================================================ */}
      {(activeTab === "model" || (activeTab === "foundations" && overviewSub === "model")) && (
        <div className={styles.studioShell}>

          {/* ── Hero ── */}
          <div className={styles.studioActHero}>
            <img src="/mdb-database.png" alt="" className={styles.studioActIcon} />
            <div className={styles.studioActText}>
              <span className={styles.studioActEyebrow}>Data model</span>
              <h2 className={styles.studioActTitle}>MongoDB Architecture & Data Model</h2>
              <p className={styles.studioActDesc}>
                A focused set of collections runs on MongoDB: canonical SNOMED concept documents, a term-level search projection, and grounded clinical notes. Ancestor arrays and multikey indexes support subsumption queries; descendants are resolved from the ancestor index instead of stored as giant inverse arrays. MongoDB Search and MongoDB Vector Search support lexical, semantic, and hybrid terminology search. No external search engine, graph database, or vector database is required for this demo architecture.
              </p>
            </div>
          </div>

          {/* ── Live stats when readiness loaded ── */}
          {readiness?.counts && (
            <div className={styles.studioStatRow}>
              <div className={styles.studioStat}>
                <span className={styles.studioStatValue}>{(readiness.counts.sourceCount ?? 0).toLocaleString()}</span>
                <span className={styles.studioStatLabel}>Concept documents</span>
              </div>
              <div className={styles.studioStat}>
                <span className={styles.studioStatValue}>{(readiness.counts.projectionCount ?? 0).toLocaleString()}</span>
                <span className={styles.studioStatLabel}>Searchable term documents</span>
              </div>
              <div className={styles.studioStat}>
                <span className={styles.studioStatValue}>EN + ES</span>
                <span className={styles.studioStatLabel}>Searchable languages</span>
              </div>
            </div>
          )}

          {/* ── Three panels ── */}
          <div className={styles.studioActGrid}>

            {/* Panel 1: Collection map */}
            <div className={styles.studioPanel}>
              <div className={styles.studioPanelHeader}>
                <img src="/mdb-database.png" alt="" className={styles.studioPanelIcon} />
                <span className={styles.studioPanelTitle}>Collection map</span>
              </div>
              <div className={styles.studioPanelBody}>
                <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--ink-secondary)" }}>
                  Three core collections cover the terminology service; telemetry is optional. Friendly names shown; implementation names in small text.
                </p>
                <table className={styles.studioIndexTable}>
                  <thead>
                    <tr>
                      <th>Collection</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <code style={{fontSize:11}}>snomed_concepts</code>
                        <div style={{ fontSize: 10, color: "#889397", marginTop: 2 }}>impl: snomed-irbd</div>
                      </td>
                      <td>Canonical concept documents — descriptions, relationships, parents, children, bounded ancestor arrays, release metadata</td>
                    </tr>
                    <tr>
                      <td>
                        <code style={{fontSize:11}}>snomed_terms</code>
                        <div style={{ fontSize: 10, color: "#889397", marginTop: 2 }}>impl: snomed-term-search</div>
                      </td>
                      <td>One searchable document per active description term, language, and release — powers lexical, semantic, hybrid search, and label lookup</td>
                    </tr>
                    <tr>
                      <td><code style={{fontSize:11}}>grounded_notes</code></td>
                      <td>Reviewed clinical note codings with evidence spans, assertion context, and ancestor IDs</td>
                    </tr>
                    <tr>
                      <td>
                        <code style={{fontSize:11}}>snomed_usage_events</code>
                        <div style={{ fontSize: 10, color: "#889397", marginTop: 2 }}>impl: snomed-usage-events · optional</div>
                      </td>
                      <td>Optional telemetry for search, hierarchy, grounding, and feedback activity</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Panel 2: Collection data models (two tabs) */}
            <div className={styles.studioPanel}>
              <div className={styles.studioPanelHeader}>
                <img src="/mdb-doc-model.png" alt="" className={styles.studioPanelIcon} />
                <span className={styles.studioPanelTitle}>Collection data models</span>
              </div>
              <div className={styles.studioPanelBody}>
                {/* Tab toggle between the two core collections */}
                <div style={{ display: "inline-flex", border: `1px solid ${OV_BORDER}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
                  {[["concept", "snomed_concepts"], ["term", "snomed_terms"]].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSchemaTab(key)}
                      style={{
                        padding: "6px 14px", fontSize: 12.5, border: "none", cursor: "pointer",
                        background: schemaTab === key ? OV_GREEN : "#fff",
                        color: schemaTab === key ? "#fff" : OV_INK,
                        fontWeight: schemaTab === key ? 700 : 500
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {schemaTab === "concept" ? (
                  <>
                    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--ink-secondary)" }}>
                      The source of truth: one document per SNOMED concept, carrying its RF2 descriptions, defining relationships, release metadata, and the precomputed ancestor closure that powers hierarchy and subsumption.
                    </p>
                    <div className={styles.schemaDoc}>
                      <div className={styles.schemaDocHeader}>
                        <span className={styles.schemaDocLabel}>Collection</span>
                        <span className={styles.schemaDocCollection}>snomed_concepts · impl snomed-irbd</span>
                      </div>
                      <Code language="json">{`{
  "conceptId":          "44054006",
  "active":             true,
  "effectiveTime":      "20020131",
  "moduleId":           "900000000000207008",
  "definitionStatusId": "900000000000074008",
  "descriptions": [
    { "id": "73465010", "term": "Diabetes mellitus type II",
      "typeId": "900000000000013009", "languageCode": "en",
      "acceptabilityMap": { "900000000000509007": "..." } }
  ],
  "relationships": [
    { "typeId": "116680003", "destinationId": "73211009",
      "relationshipGroup": "0", "active": "1" }
  ],
  "inferredParentIds":   ["73211009"],
  "inferredAncestorIds": ["73211009", "64572001", "138875005"],
  "inferredChildIds":    ["..."],
  "relationshipAttributeKeys": ["116680003|73211009"],
  "memberOfRefsetIds":   ["..."],
  "releaseId":           "20260601",
  "releaseDate":         "2026-06-01T00:00:00.000Z",
  "releaseAppliedAt":    "2026-07-06T00:00:00.000Z"
}`}</Code>
                    </div>
                    <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 11.5, lineHeight: 1.65, color: "var(--ink-secondary, #5C6C75)" }}>
                      <li><code>conceptId</code> — the SNOMED identifier (SCTID); the stable concept identity.</li>
                      <li><code>descriptions[]</code> — every term / synonym / formal name (FSN) with language and <code>acceptabilityMap</code> (RF2 Description rows).</li>
                      <li><code>relationships[]</code> — is-a (<code>typeId 116680003</code>) and attribute relationships, grouped by <code>relationshipGroup</code>.</li>
                      <li><code>relationshipAttributeKeys[]</code> — denormalized <code>typeId|destinationId</code> keys for indexed attribute-refinement ECL.</li>
                      <li><code>inferredParentIds / ChildIds / AncestorIds</code> — bounded precomputed is-a closure for subsumption without graph traversal.</li>
                      <li>Descendants are queried with <code>{"{ inferredAncestorIds: conceptId }"}</code> rather than stored on every parent concept.</li>
                      <li><code>definitionStatusId · moduleId · active · effectiveTime · releaseDate</code> — RF2 provenance and versioning.</li>
                    </ul>
                  </>
                ) : (
                  <>
                    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--ink-secondary)" }}>
                      The search sidecar: one document per active description term × language × release — denormalized for MongoDB Search, scoped filtering, and auto-embedded MongoDB Vector Search.
                    </p>
                    <div className={styles.schemaDoc}>
                      <div className={styles.schemaDocHeader}>
                        <span className={styles.schemaDocLabel}>Collection</span>
                        <span className={styles.schemaDocCollection}>snomed_terms · impl snomed-term-search</span>
                      </div>
                      <Code language="json">{`{
  "conceptId":     "44054006",
  "descriptionId": "116680003",
  "term":          "Type 2 diabetes mellitus",
  "preferredTerm": "Type 2 diabetes mellitus",
  "fsn":           "Type 2 diabetes mellitus (disorder)",
  "semanticTag":   "disorder",
  "semanticTagKey":"disorder",
  "termType":      "synonym",
  "preferred":     true,
  "languageCode":  "en",
  "definitionStatusId": "900000000000074008",
  "moduleId":      "900000000000207008",
  "effectiveTime": "20020131",
  "parentIds":     ["73211009"],
  "ancestorIds":   ["404684003", "73211009"],
  "topRoots":      ["404684003"],
  "areaTags":      ["disorder"],
  "releaseId":     "20260601",
  "releaseDate":   "2026-06-01T00:00:00.000Z",
  "embedText":     "Type 2 diabetes mellitus | disorder | ..."
}`}</Code>
                    </div>
                    <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 11.5, lineHeight: 1.65, color: "var(--ink-secondary, #5C6C75)" }}>
                      <li><code>conceptId / descriptionId</code> — link back to the concept and the specific description.</li>
                      <li><code>term / preferredTerm / fsn</code> — matched term plus concept context, so search results are self-contained.</li>
                      <li><code>semanticTag / semanticTagKey / termType / preferred</code> — filtering and ranking signals.</li>
                      <li><code>parentIds / ancestorIds / topRoots / areaTags</code> — scope filters without joining back to <code>snomed_concepts</code>.</li>
                      <li><code>releaseId / releaseDate / effectiveTime</code> — release-scoped search and release maintenance visibility.</li>
                      <li><code>embedText</code> — the field MongoDB auto-embeds for Vector Search (semantic + hybrid).</li>
                    </ul>
                  </>
                )}
              </div>
            </div>

            {/* Panel 3: Runtime readiness */}
            <div className={styles.studioPanel}>
              <div className={styles.studioPanelHeader}>
                <img src="/mdb-search.png" alt="" className={styles.studioPanelIcon} />
                <span className={styles.studioPanelTitle}>Runtime readiness</span>
              </div>
              <div className={styles.studioPanelBody}>
                <button className={styles.runButton} onClick={runReadiness} disabled={readinessCall.loading} style={{ marginBottom: 12 }}>
                  {readinessCall.loading ? <><span className={`${styles.spinner} ${styles.spinnerOnDark}`} />Checking…</> : "Check readiness"}
                </button>
                {!readiness && !readinessCall.loading && (
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-secondary)" }}>
                    Verify that all MongoDB indexes and collections are populated and queryable.
                  </p>
                )}
                {readinessCall.loading && (
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-secondary)" }}>
                    <span className={styles.spinner} />Checking cluster…
                  </p>
                )}

                {readiness?.readiness && (
                  <div className={styles.readinessRow}>
                    <ReadinessChip label="Projection populated" ok={readiness.readiness.projectionPopulated} />
                    <ReadinessChip label="Search index ready" ok={readiness.readiness.textIndexReady} />
                    <ReadinessChip label="Ancestor lookup ready" ok={readiness.readiness.ancestorLookupReady} />
                    <ReadinessChip label="Release metadata" ok={readiness.readiness.releaseMetadataReady} />
                    <ReadinessChip label="Sidecar lookup indexed" ok={readiness.readiness.termSidecarModelReady} />
                    <ReadinessChip label="Attribute ECL indexed" ok={readiness.readiness.relationshipAttributeReady} />
                    <ReadinessChip label="No descendant closure" ok={readiness.readiness.descendantClosureRetired} />
                    <ReadinessChip label="SCTIDs as strings" ok={readiness.readiness.sctidStringNormalized} />
                    <ReadinessChip label="Hardened model" ok={readiness.readiness.hardenedModelReady} />
                    <ReadinessChip label="Architecture ready" ok={readiness.readiness.architectureReady} />
                  </div>
                )}

                {readiness?.counts && (
                  <div style={OV.pillRow}>
                    <span style={OV.pill}>Concept docs: {Number(readiness.counts.sourceCount ?? 0).toLocaleString()}</span>
                    <span style={OV.pill}>Term docs: {Number(readiness.counts.projectionCount ?? 0).toLocaleString()}</span>
                    <span style={OV.pill}>Usage events: {Number(readiness.counts.usageEventDocs ?? 0).toLocaleString()}</span>
                  </div>
                )}

                {readiness?.readiness && !readiness.readiness.textIndexReady && (
                  <p className={styles.errorBox}>Search-driven modules are blocked until the MongoDB Search index is queryable.</p>
                )}

                {readiness?.indexes?.search?.length > 0 && (
                  <div className={styles.indexList} style={{ marginTop: 10 }}>
                    {readiness.indexes.search.map((entry) => (
                      <div className={styles.indexItem} key={entry.name}>
                        <strong>{entry.name}</strong>
                        <span>{entry.type} · {entry.status} · queryable: {String(entry.queryable)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {readiness?.indexes?.btreeSource?.length > 0 && (
                  <div className={styles.indexList}>
                    {readiness.indexes.btreeSource.map((name) => (
                      <div className={styles.indexItem} key={"source-" + name}>
                        <strong>{name}</strong>
                        <span>source btree index</span>
                      </div>
                    ))}
                  </div>
                )}

                {readiness?.indexes?.btreeProjection?.length > 0 && (
                  <div className={styles.indexList}>
                    {readiness.indexes.btreeProjection.map((name) => (
                      <div className={styles.indexItem} key={"term-" + name}>
                        <strong>{name}</strong>
                        <span>term sidecar btree index</span>
                      </div>
                    ))}
                  </div>
                )}

                {SHOW_OPS_DIAGNOSTICS && (
                  <>
                    {readiness?.capabilities?.supportsEffectiveTime && !readiness?.indexes?.sourceHasEffectiveTimeIndex && (
                      <p className={styles.errorBox}>Source index missing: create <code>{"{ effectiveTime: 1, active: 1 }"}</code> for fast release diff.</p>
                    )}

                    {readiness?.capabilities?.supportsReleaseId && !readiness?.indexes?.sourceHasReleaseIdIndex && (
                      <p className={styles.errorBox}>Source index missing: create <code>{"{ releaseId: 1, active: 1 }"}</code> for fast release-to-release diff.</p>
                    )}

                    {readiness?.readiness && !readiness.readiness.releaseMetadataReady && (
                      <p className={styles.errorBox}>Release metadata missing: stamp a real <code>releaseId</code> and <code>releaseDate</code> before presenting release maintenance.</p>
                    )}

                    {readiness?.readiness && !readiness.readiness.termSidecarModelReady && (
                      <p className={styles.errorBox}>Term sidecar hardening missing: build the lookup btree index and rebuild terms with <code>semanticTagKey</code>.</p>
                    )}

                    {readiness?.readiness && !readiness.readiness.relationshipAttributeReady && (
                      <p className={styles.errorBox}>Attribute ECL support missing: rerun <code>model:harden</code> to populate <code>relationshipAttributeKeys</code>, then rebuild indexes.</p>
                    )}

                    {readiness?.readiness && !readiness.readiness.descendantClosureRetired && (
                      <p className={styles.errorBox}>Canonical model still stores <code>inferredDescendantIds</code>. Retire it and serve descendants from the ancestor multikey index.</p>
                    )}

                    {readiness?.readiness && !readiness.readiness.sctidStringNormalized && (
                      <p className={styles.errorBox}>Some canonical SCTIDs are still numeric. Normalize concept, hierarchy, relationship, and description identifiers to strings to avoid silent query misses.</p>
                    )}
                  </>
                )}

                {readiness?.indexes?.searchIndexError && <p className={styles.errorBox}>{readiness.indexes.searchIndexError}</p>}
                {readinessCall.error && <p className={styles.errorBox}>{readinessCall.error}</p>}
                <ReleaseDiffPanel call={releaseDiffCall} onRun={runReleaseDiff} />
              </div>
            </div>

          </div>

          {/* ── Insight ── */}
          <div className={styles.studioInsight}>
            <div className={styles.studioInsightBullet} />
            <p className={styles.studioInsightText}>
              <strong>One MongoDB deployment, one document model, no external terminology dependencies.</strong> MongoDB Search replaces a separate search engine. Bounded ancestor arrays replace most runtime graph traversal for common subsumption queries, while descendant expansion is served by an indexed query rather than unbounded stored arrays. MongoDB Vector Search supports semantic discovery on the same term sidecar.
            </p>
          </div>

        </div>
      )}

      {/* ============================================================
          TAB: LICENSING (Overview subtab; also on the standalone model tab)
          ============================================================ */}
      {(activeTab === "model" || (activeTab === "foundations" && overviewSub === "licensing")) && (
        <div className={styles.studioShell}>
          <div style={OV.licenseBox}>
            <div style={OV.licenseTitle}>SNOMED CT licensing &amp; attribution</div>
            <p style={OV.licenseText}>
              SNOMED and SNOMED CT are registered trademarks of the International Health Terminology Standards
              Development Organisation (SNOMED International / IHTSDO). This project is not affiliated with or endorsed
              by SNOMED International.
            </p>
            <p style={OV.licenseText}>
              This public demo includes only a small sample dataset. SNOMED CT requires proper licensing. Organizations
              that hold the required license for their country or territory can run the import and transformation
              scripts against their own authorized release files.
            </p>
            <p style={OV.licenseText}>
              Licensing terms vary by country and use case; per SNOMED International&apos;s published licensing policy,
              use within Member territories is generally covered by the national license, while affiliate use elsewhere
              may require licensing through the Member Licensing and Distribution Service. Confirm your obligations with
              SNOMED International or your national release centre — do not rely on this note as legal guidance.
            </p>
            <p style={{ ...OV.licenseText, marginBottom: 0 }}>
              The repository provides the MongoDB data model and transformation pattern — not SNOMED CT content. Do not
              publish or redistribute a full SNOMED CT release in a public repository unless the license terms explicitly
              allow it.
            </p>
          </div>
        </div>
      )}

        </section>
      </div>
    </main>
  );
}

// ── Reference architecture diagram (Overview → Architecture subtab) ──
function ArchitectureDiagram() {
  const VIOLET = "#8F4FBF";
  const BLUE = "#016BF8";
  const card = (border) => ({ border: `1.5px solid ${border}`, borderRadius: 10, background: "#fff", padding: "12px 14px", flex: 1, minWidth: 0 });
  const cardTitle = { fontSize: 12.5, fontWeight: 800, color: OV_INK, marginBottom: 4 };
  const cardBody = { fontSize: 11.5, lineHeight: 1.45, color: "#5C6C75" };
  const tag = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" };
  const chip = { display: "inline-block", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, background: "#F1F4F6", borderRadius: 6, padding: "1px 6px", color: OV_INK };
  const mql = { display: "inline-block", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5, fontWeight: 600, background: "#E3FCEC", color: OV_GREEN, borderRadius: 6, padding: "1px 6px", marginRight: 4, marginTop: 5 };
  const dnArrow = (leftColor, rightColor) => (
    <div style={{ display: "flex", gap: 10, margin: "8px 0" }}>
      <div style={{ flex: 1, textAlign: "center", color: leftColor, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>↓</div>
      <div style={{ flex: 1, textAlign: "center", color: rightColor, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>↓</div>
    </div>
  );
  const badge = (glyph, iconSize, box, color) => (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: box, height: box, borderRadius: 9, background: `${color}18`, flexShrink: 0 }}>
      <Icon glyph={glyph} size={iconSize} fill={color} />
    </span>
  );
  const stageHead = (glyph, text, color) => (
    <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 8 }}>
      {badge(glyph, 22, 40, color)}
      <span style={{ ...tag, color }}>{text}</span>
    </div>
  );
  const cardHead = (glyph, node, color = OV_GREEN) => (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
      {badge(glyph, 20, 32, color)}
      <div style={{ ...cardTitle, marginBottom: 0 }}>{node}</div>
    </div>
  );
  // A capability row inside the MongoDB core: icon + name + what it does + MQL op.
  const capRow = (glyph, name, desc, op) => (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0" }}>
      <span style={{ marginTop: 1, flexShrink: 0 }}><Icon glyph={glyph} size={16} fill={OV_GREEN} /></span>
      <div style={{ fontSize: 11.5, color: "#5C6C75", lineHeight: 1.4 }}>
        <strong style={{ color: OV_INK }}>{name}</strong> — {desc} {op ? <span style={mql}>{op}</span> : null}
      </div>
    </div>
  );

  return (
    <div className={styles.studioShell}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.11em", textTransform: "uppercase", color: OV_GREEN }}>Reference architecture</span>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: OV_INK, margin: "6px 0 8px", letterSpacing: "-0.02em" }}>One MongoDB deployment, two workflows</h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#4A5A64", margin: "0 0 18px" }}>
          Both product stories run on the same MongoDB core. <strong>Navigate</strong> searches the terminology
          directly — no LLM. <strong>Ground a Note</strong> adds an optional LLM up front to decide what to look up. Either
          way, MongoDB retrieves and <em>owns every code</em> — one cluster covers storage, lexical + semantic search,
          hierarchy/ECL, grounding, and evaluation, with no external search engine, graph database, or vector store.
        </p>

        {/* Two entry workflows */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ ...card(BLUE), background: "#F2F8FF" }}>
            {stageHead("MagnifyingGlass", "Navigate · no LLM", BLUE)}
            <div style={cardBody}>A term, synonym, translation, or SNOMED id → <strong>hybrid search</strong> (MongoDB Search + Vector Search, rank fusion, optional rerank). Pure logical + semantic retrieval. &nbsp;→&nbsp; <span style={chip}>POST /api/navigator-search</span></div>
          </div>
          <div style={{ ...card(VIOLET), background: "#FBF9FE" }}>
            {stageHead("Sparkle", "Ground a note · LLM", VIOLET)}
            <div style={cardBody}>A clinical note → LLM returns an <strong>evidence graph</strong> (mention + assertion/subject/section). It decides what to look up and <strong>never emits codes</strong>. Provider-neutral. &nbsp;→&nbsp; <span style={chip}>POST /api/nlp-map</span></div>
          </div>
        </div>
        {dnArrow(BLUE, VIOLET)}

        {/* Shared MongoDB core */}
        <div style={{ border: `2px solid ${OV_GREEN}`, borderRadius: 12, background: "#F3FCF7", padding: "12px 14px" }}>
          {stageHead("Database", "MongoDB — retrieval & hierarchy (owns every code)", OV_GREEN)}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            <div style={card(OV_BORDER)}>
              {cardHead("CurlyBraces", <span style={chip}>snomed_concepts</span>)}
              <div style={cardBody}>Canonical documents — descriptions, relationships, parents/children, and precomputed <strong>ancestor arrays</strong>.</div>
              {capRow("Diagram3", "Hierarchy & subsumption / ECL", "match a scalar against the ancestor multikey index — no graph traversal", "find({ inferredAncestorIds })")}
            </div>
            <div style={card(OV_BORDER)}>
              {cardHead("MagnifyingGlass", <><span style={chip}>snomed_terms</span> · sidecar</>)}
              <div style={cardBody}>One term-level projection (EN + ES) driving three retrieval modes inside MongoDB:</div>
              {capRow("MagnifyingGlass", "MongoDB Search", "lexical / filtered text match on terms & synonyms", "$search")}
              {capRow("Sparkle", "MongoDB Vector Search", "semantic nearest-neighbour on term embeddings", "$vectorSearch")}
              {capRow("NumberedList", "Rank fusion + rerank", "blend both rankings, then reorder by relevance (Voyage)", "$rankFusion")}
            </div>
          </div>
        </div>
        {dnArrow(BLUE, VIOLET)}

        {/* Two outcomes */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={card(BLUE)}>
            {cardHead("Diagram", "Navigate → explore", BLUE)}
            <div style={cardBody}>Inspect a concept, walk the <strong>hierarchy</strong>, expand <strong>ECL value sets</strong>, view release history — read-only exploration. &nbsp;→&nbsp; <span style={chip}>hierarchy</span> <span style={chip}>ecl</span> <span style={chip}>concept-history</span></div>
          </div>
          <div style={card(VIOLET)}>
            {cardHead("Person", "Ground → confirm & store", VIOLET)}
            <div style={cardBody}>A reviewer accepts / swaps / adds codings, persisted to <span style={chip}>grounded_notes</span> with ancestor paths → corpus queries by concept or ancestor. &nbsp;→&nbsp; <span style={chip}>POST /api/coding-confirm</span></div>
          </div>
        </div>

        {/* Data at rest + evaluation */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <div style={{ ...card(OV_BORDER), background: "#fbfdfc" }}>
            {cardHead("Note", <span style={chip}>grounded_notes</span>)}
            <div style={cardBody}>Reviewer-confirmed codings + evidence + ancestor paths. Corpus-wide subsumption search: <span style={mql}>$elemMatch on codings.ancestorIds</span></div>
          </div>
          <div style={{ ...card(OV_BORDER), background: "#fbfdfc" }}>
            {cardHead("Favorite", <span style={chip}>gold_notes</span>)}
            <div style={cardBody}>Benchmark fixtures authored from real groundings; the Benchmark tab grades models against them.</div>
          </div>
          <div style={{ ...card(OV_BORDER), background: "#fbfdfc" }}>
            {cardHead("Charts", <span style={chip}>snomed-usage-events</span>)}
            <div style={cardBody}>Lightweight search / grounding telemetry (optional).</div>
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: "#889397", margin: "14px 0 0" }}>The full API surface is in the API tab; the Benchmark tab compares extraction models on the grounding path.</p>
      </div>
    </div>
  );
}
