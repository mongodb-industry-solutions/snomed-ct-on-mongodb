import {
  buildNativeHybridFusionPipeline,
  buildNavigatorSearchPipeline,
  buildNavigatorVectorFilter,
  buildVectorSearchPipeline,
} from "@/lib/pipelines";
import { rerankNavigatorResults } from "@/lib/search-normalization";
import { rerankDocuments } from "@/lib/voyage-rerank";
import { redactLargeConceptScopes } from "@/lib/pipeline-redact";

// Hybrid concept search: run lexical (MongoDB Search) and semantic (vector) in
// parallel, fuse them with reciprocal rank fusion (RRF), then optionally reorder
// the fused pool with the Voyage cross-encoder reranker. Each engine contributes
// what it is good at — lexical nails exact/synonym/SCTID hits, vector rescues
// natural-language phrasing that shares no tokens with official SNOMED terms —
// and rerank breaks ties with true query↔term semantic relevance.
//
// Results are deduplicated to one row per concept (the SNOMED term collection is
// term-level, so a concept can match via several descriptions); the best matched
// term per concept is kept. Every result carries provenance so the UI can show
// which engine(s) found it and how rerank moved it.

// Native stages the deployment rejected outright (unknown stage, tier limit)
// are cached by stage and rerank mode. Native requests fail explicitly rather
// than silently running multiple queries in an app-side fallback.
const disabledNativeFusionStages = new Map();
const nativeFusionCooldownUntil = new Map();
const NATIVE_TIMEOUT_COOLDOWN_MS = 60_000;

const FUSION_MODES = ["rankFusion", "scoreFusion", "appRrf"];
// MongoDB's $rankFusion uses a fixed RRF constant (see its scoreDetails text:
// "sum of (weight * (1 / (60 + rank)))"); only the app-side path honours rrfK.
const NATIVE_RRF_K = 60;

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// Merge per-request tuning (from the UI / API caller) over the env defaults.
// Every knob is clamped to the same range the env parser allows, so a request
// can't ask for more work than an operator could configure.
export function resolveHybridTuning(baseConfig, overrides) {
  const o = overrides && typeof overrides === "object" ? overrides : {};
  const fusionMode = o.fusionMode ? normalizeFusionMode(o.fusionMode) : normalizeFusionMode(baseConfig.fusionMode);
  let lexicalWeight = clampNumber(o.lexicalWeight, baseConfig.lexicalWeight, 0, 1);
  let semanticWeight = clampNumber(o.semanticWeight, baseConfig.semanticWeight, 0, 1);
  if (lexicalWeight + semanticWeight <= 0) {
    // All-zero weights would score every concept 0; keep the defaults instead.
    lexicalWeight = baseConfig.lexicalWeight;
    semanticWeight = baseConfig.semanticWeight;
  }
  return {
    ...baseConfig,
    fusionMode,
    lexicalWeight,
    semanticWeight,
    rrfK: clampNumber(o.rrfK, baseConfig.rrfK, 1, 1000),
    candidatePool: clampNumber(o.candidatePool, baseConfig.candidatePool, 5, 200),
    rerankEnabled: typeof o.rerank === "boolean" ? o.rerank : baseConfig.rerankEnabled !== false,
    rerankPool: clampNumber(o.rerankPool, baseConfig.rerankPool, 5, 200)
  };
}

export function describeHybridTuning(config) {
  return {
    fusionModes: FUSION_MODES,
    fusionMode: normalizeFusionMode(config.fusionMode),
    lexicalWeight: config.lexicalWeight,
    semanticWeight: config.semanticWeight,
    rrfK: config.rrfK,
    candidatePool: config.candidatePool,
    rerank: config.rerankEnabled !== false,
    rerankMode: config.rerankMode || "voyage",
    rerankModel: config.rerankModel || "rerank-2.5",
    rerankPool: config.rerankPool
  };
}

// Execution trace: when the caller passes a `trace` array, every step that
// actually runs is appended to it in order — MongoDB aggregations with the
// exact pipeline sent (large concept scopes summarized), and the app-side steps
// between them. Nothing is reconstructed after the fact, so the trace shows
// what ran, including fallbacks and failures.
export function traceStep(trace, step) {
  if (!Array.isArray(trace)) return;
  trace.push({
    ...step,
    ...(step.pipeline ? { pipeline: redactLargeConceptScopes(step.pipeline) } : {})
  });
}

export async function tracedAggregate(collection, pipeline, options, trace, meta) {
  const t0 = Date.now();
  try {
    const rows = await collection.aggregate(pipeline, options).toArray();
    traceStep(trace, { kind: "mongodb", ...meta, pipeline, options: options || null, outcome: "ok", rows: rows.length, ms: Date.now() - t0 });
    return rows;
  } catch (error) {
    traceStep(trace, {
      kind: "mongodb", ...meta, pipeline, options: options || null,
      outcome: isTimeoutError(error) ? "timeout" : "error",
      error: shortError(error), rows: 0, ms: Date.now() - t0
    });
    throw error;
  }
}

function dedupeByConcept(rows) {
  // Keep the first (highest-ranked) row per conceptId, preserving engine order.
  const seen = new Map();
  for (const row of rows) {
    const id = String(row?.conceptId || "");
    if (!id || seen.has(id)) continue;
    seen.set(id, row);
  }
  return Array.from(seen.values());
}

// Weighted reciprocal rank fusion: score = Σ weight / (k + rank) across the
// engines a concept appears in — the same formula $rankFusion applies natively.
// Concepts found by both engines naturally float up.
function reciprocalRankFusion({ lexical, vector, k, weights }) {
  const table = new Map();
  const add = (rows, engine, weight) => {
    rows.forEach((row, index) => {
      const id = String(row?.conceptId || "");
      if (!id) return;
      const entry = table.get(id) || {
        conceptId: id,
        rrf: 0,
        engines: new Set(),
        lexical: null,
        vector: null,
        lexicalRank: null,
        vectorRank: null
      };
      entry.rrf += weight / (k + index + 1);
      entry.engines.add(engine);
      entry[engine] = row;
      entry[`${engine}Rank`] = index + 1;
      table.set(id, entry);
    });
  };
  add(lexical, "lexical", weights.lexical);
  add(vector, "vector", weights.semantic);
  return Array.from(table.values()).sort((a, b) => b.rrf - a.rrf);
}

// Merge the per-engine field views into one result row. Lexical carries the
// tiered matchReason/matchedText; vector carries the semantic score. Prefer
// lexical's richer fields when present.
function mergeRow(entry) {
  const lex = entry.lexical || {};
  const vec = entry.vector || {};
  const base = entry.lexical || entry.vector || {};
  const engines = Array.from(entry.engines);
  return {
    conceptId: entry.conceptId,
    term: base.term || base.displayTerm || vec.term || entry.conceptId,
    displayTerm: base.displayTerm,
    preferredTerm: base.preferredTerm || vec.preferredTerm,
    fsn: base.fsn || vec.fsn,
    synonyms: base.synonyms || vec.synonyms || [],
    descriptionId: base.descriptionId || vec.descriptionId,
    ancestorIds: base.ancestorIds || vec.ancestorIds || [],
    active: base.active !== false && vec.active !== false,
    conceptActive:base.conceptActive??vec.conceptActive,
    releaseId:base.releaseId||vec.releaseId,
    semanticTag: base.semanticTag || vec.semanticTag,
    languageCode: base.languageCode || vec.languageCode,
    // Lexical match explanation (present when lexical found it).
    matchedText: lex.matchedText || null,
    matchReason: lex.matchReason || (engines.length === 1 && engines[0] === "vector" ? "Semantic" : null),
    matchTier: lex.matchTier ?? null,
    // Provenance + scores for the UI.
    foundBy: engines,
    lexicalRank: entry.lexicalRank,
    vectorRank: entry.vectorRank,
    vectorScore: typeof vec.score === "number" ? vec.score : null,
    rrfScore: entry.rrf
  };
}

// One shape for "why is this concept here", whichever fusion path produced it:
// each engine's rank (null = that engine did not return it), its weight, and
// the share of the fused score it contributed.
function rrfBreakdown({ lexicalRank, vectorRank, weights, k, score }) {
  const part = (rank, weight) => ({
    rank: rank ?? null,
    weight,
    contribution: rank ? weight / (k + rank) : 0
  });
  return {
    method: "rrf",
    k,
    score,
    lexical: part(lexicalRank, weights.lexical),
    semantic: part(vectorRank, weights.semantic)
  };
}

function breakdownFromScoreDetails(scoreDetails, fusionStage) {
  const details = Array.isArray(scoreDetails?.details) ? scoreDetails.details : [];
  const pick = (name) => details.find((d) => String(d?.inputPipelineName || "").toLowerCase() === name) || null;
  const lex = pick("lexical");
  const sem = pick("semantic");
  // $rankFusion reports rank 0 for "not returned by this pipeline".
  const rankOf = (d) => (Number(d?.rank) > 0 ? Number(d.rank) : null);
  if (fusionStage === "rankFusion") {
    const b = rrfBreakdown({
      lexicalRank: rankOf(lex),
      vectorRank: rankOf(sem),
      weights: { lexical: Number(lex?.weight ?? 0), semantic: Number(sem?.weight ?? 0) },
      k: NATIVE_RRF_K,
      score: typeof scoreDetails?.value === "number" ? scoreDetails.value : null
    });
    b.lexical.rawScore = typeof lex?.value === "number" ? lex.value : null;
    b.semantic.rawScore = typeof sem?.value === "number" ? sem.value : null;
    return b;
  }
  const part = (d) => ({
    rank: rankOf(d),
    weight: Number(d?.weight ?? 0),
    rawScore: typeof d?.value === "number" ? d.value : null,
    contribution: null
  });
  return {
    method: "score",
    score: typeof scoreDetails?.value === "number" ? scoreDetails.value : null,
    lexical: part(lex),
    semantic: part(sem)
  };
}

function fusionAlgorithm({ engine, hybridConfig, reranked, fallbackReason }) {
  const weights = { lexical: hybridConfig.lexicalWeight, semantic: hybridConfig.semanticWeight };
  const isScore = engine === "mongodb-scoreFusion";
  const k = engine === "mongodb-rankFusion" ? NATIVE_RRF_K : hybridConfig.rrfK;
  return {
    engine,
    method: isScore ? "score fusion" : "weighted reciprocal rank fusion",
    formula: isScore
      ? "score = Σ weight × sigmoid(engine score)"
      : `score = Σ weight / (${k} + rank)`,
    weights,
    k: isScore ? null : k,
    kConfigurable: engine === "app-rrf",
    candidatePool: hybridConfig.candidatePool,
    rerank: {
      requested: hybridConfig.rerankEnabled !== false,
      applied: Boolean(reranked),
      pool: hybridConfig.rerankPool,
      mode: hybridConfig.rerankMode || "voyage"
    },
    fallbackReason: fallbackReason || null
  };
}

// Build the short document string handed to the reranker for one concept.
function rerankText(row) {
  const parts = [row.term];
  if (row.semanticTag) parts.push(`(${row.semanticTag})`);
  if (row.fsn && row.fsn !== row.term) parts.push(`— ${row.fsn}`);
  return parts.filter(Boolean).join(" ");
}

function normalizeFusionMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "apprrf" || normalized === "app-rrf" || normalized === "legacy") return "appRrf";
  if (normalized === "scorefusion" || normalized === "score-fusion") return "scoreFusion";
  return "rankFusion";
}

function isUnsupportedNativeFusionError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("rankfusion") ||
    message.includes("scorefusion") ||
    message.includes("unrecognized pipeline stage") ||
    message.includes("unknown top level operator") ||
    message.includes("not allowed in this tier") ||
    message.includes("not supported") ||
    message.includes("requires") ||
    message.includes("exceeded time limit") ||
    message.includes("maxtimems")
  );
}

function isTimeoutError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("exceeded time limit") || message.includes("maxtimems");
}

function formatWeights(config) {
  const pct = (w) => Math.round((w / (config.lexicalWeight + config.semanticWeight)) * 100);
  return `(lexical ${config.lexicalWeight} ≈ ${pct(config.lexicalWeight)}%, semantic ${config.semanticWeight} ≈ ${pct(config.semanticWeight)}%)`;
}

function rerankNote(reranked, config) {
  if (reranked) return "Voyage reranker re-reads the top concepts against the full query and reorders them by true clinical relevance — when it runs, it sets the final order; fusion decides which candidates reach it.";
  if (config.rerankEnabled === false) return "Reranking switched off — the fused ranking is returned as-is.";
  if (config.rerankMode === "native") return "Voyage reranking runs through $rerank inside the MongoDB aggregation.";
  return "Voyage reranker unavailable — the fused ranking is returned as-is.";
}

function shortError(error) {
  const message = String(error?.message || error || "Native fusion failed");
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

function enginesFromScoreDetails(scoreDetails) {
  const details = Array.isArray(scoreDetails?.details) ? scoreDetails.details : [];
  const engines = new Set();
  for (const item of details) {
    const name = String(item?.inputPipelineName || "").toLowerCase();
    const rank = item?.rank;
    if (!name || rank === "N/A" || rank === 0 || rank === null || rank === undefined) continue;
    if (name.includes("semantic") || name.includes("vector")) engines.add("vector");
    if (name.includes("lexical") || name.includes("search")) engines.add("lexical");
  }
  return Array.from(engines);
}

function normalizeNativeFusionRows(rows, fusionStage) {
  return rows.map((row) => {
    const foundBy = enginesFromScoreDetails(row.scoreDetails);
    const engines = foundBy.length > 0 ? foundBy : row.exactDescriptionMatch ? ["exact"] : [];
    const fusion = breakdownFromScoreDetails(row.scoreDetails, fusionStage);
    return {
      ...row,
      foundBy: engines,
      fusion,
      lexicalRank: fusion.lexical.rank,
      vectorRank: fusion.semantic.rank,
      matchReason: row.exactDescriptionMatch ? "Exact description" : engines.length === 1 && engines[0] === "vector" ? "Semantic" : "Fusion",
      fusionScore: typeof row.fusionScore === "number" ? row.fusionScore : null,
      ...(fusionStage === "rankFusion" ? { rrfScore: typeof row.fusionScore === "number" ? row.fusionScore : null } : {})
    };
  });
}

async function applyOptionalRerank({ query, rows, rerankPool, limit, enabled = true, trace }) {
  const pool = rows.slice(0, rerankPool);
  const t0 = Date.now();
  const ranking = enabled && pool.length > 0
    ? await rerankDocuments({
        query,
        documents: pool.map(rerankText),
        topK: limit
      })
    : null;
  traceStep(trace, {
    kind: "app",
    role: "voyage-rerank",
    label: "Voyage rerank (cross-encoder)",
    outcome: !enabled ? "skipped" : ranking ? "ok" : "unavailable",
    detail: !enabled
      ? "Switched off in the session tuning — fusion order is kept."
      : ranking
        ? `Re-scored the top ${pool.length} fused concepts against the query text; kept the best ${Math.min(limit, ranking.length)}.`
        : "Reranker unavailable (no key, timeout or error) — fusion order is kept.",
    input: { query, documents: pool.slice(0, 8).map(rerankText), totalDocuments: pool.length, topK: limit },
    rows: ranking ? Math.min(limit, ranking.length) : Math.min(limit, rows.length),
    ms: Date.now() - t0
  });

  if (!ranking) {
    return {
      results: rows.map((r, i) => ({ ...r, fusedRank: i + 1, rerankScore: null })).slice(0, limit),
      reranked: false,
      rerankPoolSize: enabled ? pool.length : 0
    };
  }

  const ordered = ranking
    .map(({ index, relevanceScore }) => {
      const row = pool[index];
      return row ? { ...row, fusedRank: index + 1, rerankScore: relevanceScore } : null;
    })
    .filter(Boolean);

  if (ordered.length < limit) {
    const usedIds = new Set(ordered.map((r) => r.conceptId));
    rows.forEach((row, i) => {
      if (ordered.length >= limit || usedIds.has(row.conceptId)) return;
      ordered.push({ ...row, fusedRank: i + 1, rerankScore: null });
    });
  }

  return {
    results: ordered.slice(0, limit),
    reranked: true,
    rerankPoolSize: pool.length
  };
}

async function tryNativeFusionSearch({
  collection,
  query,
  vectorQuery=query,
  languageCode,
  effectiveReleaseId,
  areaConceptId,
  conceptIdScope,
  textIndex,
  searchConfig,
  hybridConfig,
  limit,
  trace
}) {
  const fusionStage = normalizeFusionMode(hybridConfig.fusionMode);
  const capabilityKey = `${fusionStage}:${hybridConfig.rerankEnabled !== false ? hybridConfig.rerankMode || "voyage" : "none"}`;
  if (fusionStage === "appRrf") {
    return null;
  }
  if (disabledNativeFusionStages.has(capabilityKey)) return { fallbackReason: disabledNativeFusionStages.get(capabilityKey), attemptedStage: fusionStage };
  if ((nativeFusionCooldownUntil.get(capabilityKey) || 0) > Date.now()) {
    const fallbackReason = `${fusionStage} timed out recently; retrying natively after a short cooldown.`;
    traceStep(trace, { kind: "app", role: "native-fusion-skipped", label: `$${fusionStage} skipped`, outcome: "skipped", detail: fallbackReason });
    return { fallbackReason, attemptedStage: fusionStage };
  }

  const pipeline = buildNativeHybridFusionPipeline({
    query,
    vectorQuery,
    limit: hybridConfig.rerankEnabled !== false && hybridConfig.rerankMode === "native" ? limit : hybridConfig.rerankPool,
    candidatePool: hybridConfig.candidatePool,
    fusionStage,
    textIndex,
    vectorIndex: searchConfig.vectorIndex,
    vectorPath: searchConfig.vectorPath,
    vectorMode: searchConfig.vectorMode,
    vectorModel: searchConfig.vectorModel,
    languageCode,
    releaseId: effectiveReleaseId,
    areaConceptId,
    conceptIdScope,
    weights: { lexical: hybridConfig.lexicalWeight, semantic: hybridConfig.semanticWeight },
    includeExactMatches: hybridConfig.includeExactMatches !== false,
    nativeRerank: hybridConfig.rerankEnabled !== false && hybridConfig.rerankMode === "native"
      ? { model: hybridConfig.rerankModel || "rerank-2.5", numDocsToRerank: hybridConfig.rerankPool } : null
  });

  try {
    const raw = await tracedAggregate(collection, pipeline, {
      maxTimeMS: hybridConfig.nativeFusionMaxTimeMs
    }, trace, {
      role: `native-${fusionStage}`,
      label: `Hybrid search — $${fusionStage} (lexical + vector in one aggregation)`,
      params: {
        weights: { lexical: hybridConfig.lexicalWeight, semantic: hybridConfig.semanticWeight },
        candidatePool: hybridConfig.candidatePool,
        k: fusionStage === "rankFusion" ? NATIVE_RRF_K : null
      }
    });
    const fused = normalizeNativeFusionRows(raw, fusionStage);
    const nativeReranked = hybridConfig.rerankEnabled !== false && hybridConfig.rerankMode === "native";
    const reranked = nativeReranked ? { results: fused, reranked: true, rerankPoolSize: hybridConfig.rerankPool }
      : await applyOptionalRerank({
      query:vectorQuery,
      rows: fused,
      rerankPool: hybridConfig.rerankPool,
      limit,
      enabled: hybridConfig.rerankEnabled !== false && hybridConfig.rerankMode !== "native",
      trace
    });
    const engine = `mongodb-${fusionStage}`;

    return {
      results: reranked.results,
      reranked: reranked.reranked,
      stats: {
        engine,
        nativeFusion: true,
        rerankMode: nativeReranked ? "native" : reranked.reranked ? "voyage" : "none",
        retrieved: raw.length,
        fusedCount: fused.length,
        rerankPool: reranked.rerankPoolSize
      },
      queryPlan: {
        engine,
        algorithm: fusionAlgorithm({ engine, hybridConfig, reranked: reranked.reranked }),
        description: fusionStage === "scoreFusion"
          ? "Hybrid search in one MongoDB aggregation: a keyword search and a meaning-based search run together, and $scoreFusion blends their relevance scores so the best of both wins."
          : "Hybrid search in one MongoDB aggregation: a keyword search and a meaning-based search run together, and $rankFusion blends their rankings so the best of both wins.",
        mql: pipeline,
        postProcessing: [
          "MongoDB Search (keywords) and MongoDB Vector Search (meaning) are the scored inputs. Rank fusion also includes the indexed canonical-description lookup unless explicitly disabled — one MongoDB round-trip.",
          fusionStage === "scoreFusion"
            ? `$scoreFusion sigmoid-normalizes each engine's relevance score and blends them ${formatWeights(hybridConfig)}, so concepts strong on either signal — or both — surface first.`
            : `$rankFusion scores each concept Σ weight / (60 + rank) ${formatWeights(hybridConfig)}, so a concept ranked well by either engine rises to the top.`,
          nativeReranked ? "Voyage $rerank reorders candidates inside this same aggregation." : rerankNote(reranked.reranked, hybridConfig)
        ]
      }
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      nativeFusionCooldownUntil.set(capabilityKey, Date.now() + NATIVE_TIMEOUT_COOLDOWN_MS);
    } else if (isUnsupportedNativeFusionError(error)) {
      disabledNativeFusionStages.set(capabilityKey, shortError(error));
    }
    return {
      fallbackReason: shortError(error),
      attemptedStage: fusionStage
    };
  }
}

export async function runHybridSearch({
  collection,
  query,
  vectorQuery=query,
  languageCode,
  effectiveReleaseId,
  areaConceptId,
  conceptIdScope,
  textIndex,
  searchConfig,
  hybridConfig,
  limit,
  trace
}) {
  if (!["native", "voyage"].includes(hybridConfig.rerankMode || "voyage")) {
    throw Object.assign(new Error("HYBRID_RERANK_MODE must be native or voyage."), { code: "INVALID_RERANK_MODE", status: 400 });
  }
  const { candidatePool, rrfK, rerankPool } = hybridConfig;
  const weights = { lexical: hybridConfig.lexicalWeight, semantic: hybridConfig.semanticWeight };
  const native = await tryNativeFusionSearch({
    collection,
    query,
    vectorQuery,
    languageCode,
    effectiveReleaseId,
    areaConceptId,
    conceptIdScope,
    textIndex,
    searchConfig,
    hybridConfig,
    limit,
    trace
  });

  if (native?.results) {
    return native;
  }
  if (normalizeFusionMode(hybridConfig.fusionMode) !== "appRrf") {
    throw Object.assign(new Error(native?.fallbackReason || `Native $${hybridConfig.fusionMode} is unavailable on this deployment.`),
      { code: "NATIVE_FUSION_UNAVAILABLE", status: 503 });
  }
  if (hybridConfig.rerankMode === "native" && hybridConfig.rerankEnabled !== false) {
    throw Object.assign(new Error("Native $rerank requires a native fusion pipeline. Select rankFusion or scoreFusion."),
      { code: "NATIVE_RERANK_REQUIRES_NATIVE_FUSION", status: 400 });
  }

  // --- Lexical branch: reuse the existing tiered navigator pipeline + reranker.
  const lexicalPipeline = buildNavigatorSearchPipeline({
    query,
    limit: candidatePool,
    indexName: textIndex,
    languageCode,
    releaseId: effectiveReleaseId,
    areaConceptId,
    conceptIdScope
  });

  // --- Vector branch: auto-embedded semantic ANN over the term text, with a
  // language filter and metadata-tag exclusion so junk concepts never surface.
  const vectorFilter = buildNavigatorVectorFilter({
    languageCode,
    releaseId: effectiveReleaseId,
    conceptIdScope
  });
  const vectorPipeline = buildVectorSearchPipeline({
    query:vectorQuery,
    limit: candidatePool,
    indexName: searchConfig.vectorIndex,
    vectorPath: searchConfig.vectorPath,
    vectorMode: searchConfig.vectorMode,
    vectorModel: searchConfig.vectorModel,
    filter: vectorFilter
  });

  const [lexicalRaw, vectorRaw] = await Promise.all([
    tracedAggregate(collection, lexicalPipeline, undefined, trace, {
      role: "app-rrf-lexical",
      label: "Lexical input — MongoDB Search",
      params: { candidatePool,query }
    }).catch(() => []),
    tracedAggregate(collection, vectorPipeline, undefined, trace, {
      role: "app-rrf-vector",
      label: "Semantic input — MongoDB Vector Search",
      params: { candidatePool,query:vectorQuery }
    }).catch(() => [])
  ]);

  // Apply the lexical tiered rerank (gives matchReason/matchedText), then dedupe
  // both lists to one row per concept before fusing.
  const lexical = dedupeByConcept(
    rerankNavigatorResults({ query, results: lexicalRaw, limit: candidatePool })
  );
  const vector = dedupeByConcept(vectorRaw);

  traceStep(trace, {
    kind: "app",
    role: "app-rrf-fusion",
    label: "Weighted reciprocal rank fusion (in the app)",
    outcome: "ok",
    detail: `Deduplicated each list to one row per concept (${lexical.length} lexical, ${vector.length} semantic), then scored every concept Σ weight / (${rrfK} + rank) with lexical ${weights.lexical}, semantic ${weights.semantic}.`,
    params: { weights, k: rrfK },
    ...(native?.fallbackReason ? { fallbackReason: native.fallbackReason } : {})
  });
  const fused = reciprocalRankFusion({ lexical, vector, k: rrfK, weights }).map((entry) => ({
    ...mergeRow(entry),
    fusion: rrfBreakdown({
      lexicalRank: entry.lexicalRank,
      vectorRank: entry.vectorRank,
      weights,
      k: rrfK,
      score: entry.rrf
    })
  }));

  // --- Rerank the fused pool with Voyage (graceful: null => keep RRF order).
  const rerankedResult = await applyOptionalRerank({
    query:vectorQuery,
    rows: fused,
    rerankPool,
    limit,
    enabled: hybridConfig.rerankEnabled !== false,
    trace
  });

  return {
    results: rerankedResult.results,
    reranked: rerankedResult.reranked,
    stats: {
      engine: "app-rrf",
      nativeFusion: false,
      ...(native?.fallbackReason ? {
        fallbackFrom: native.attemptedStage,
        fallbackReason: native.fallbackReason
      } : {}),
      lexicalCount: lexical.length,
      vectorCount: vector.length,
      fusedCount: fused.length,
      rerankPool: rerankedResult.rerankPoolSize
    },
    queryPlan: {
      engine: "app-rrf",
      algorithm: fusionAlgorithm({
        engine: "app-rrf",
        hybridConfig,
        reranked: rerankedResult.reranked,
        fallbackReason: native?.fallbackReason
      }),
      description: native?.fallbackReason
        ? "Hybrid search: a keyword search and a meaning-based search run in parallel, then their two rankings are blended so the best of both wins. (MongoDB-native fusion was attempted first, then the route fell back to blending the rankings in the application.)"
        : "Hybrid search: a keyword search and a meaning-based search run in parallel, then their two rankings are blended so the best of both wins.",
      fallbackReason: native?.fallbackReason || null,
      mql: {
        lexicalPipeline,
        semanticPipeline: vectorPipeline
      },
      postProcessing: [
        "MongoDB Search (keywords): finds concepts whose terms literally contain the words typed — exact and fast, best when the wording is already close to SNOMED.",
        "MongoDB Vector Search (meaning): finds concepts that mean the same thing even when they share no words (e.g. \"heart attack\" → \"Myocardial infarction\").",
        "Keep one row per concept in each branch — a single concept can match through several of its synonyms.",
        `Blend the two rankings with weighted reciprocal rank fusion, Σ weight / (${rrfK} + rank) ${formatWeights(hybridConfig)}: a concept ranked highly by either engine — or by both — rises to the top.`,
        rerankNote(rerankedResult.reranked, hybridConfig)
      ]
    }
  };
}
