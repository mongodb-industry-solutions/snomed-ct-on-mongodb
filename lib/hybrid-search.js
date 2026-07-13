import {
  buildNativeHybridFusionPipeline,
  buildNavigatorSearchPipeline,
  buildNavigatorVectorFilter,
  buildVectorSearchPipeline,
} from "@/lib/pipelines";
import { rerankNavigatorResults } from "@/lib/search-normalization";
import { rerankDocuments } from "@/lib/voyage-rerank";

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

const disabledNativeFusionStages = new Set();

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

// Reciprocal rank fusion: score = Σ 1 / (k + rank) across engines a concept
// appears in. Concepts found by both engines naturally float up.
function reciprocalRankFusion({ lexical, vector, k }) {
  const table = new Map();
  const add = (rows, engine) => {
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
      entry.rrf += 1 / (k + index + 1);
      entry.engines.add(engine);
      entry[engine] = row;
      entry[`${engine}Rank`] = index + 1;
      table.set(id, entry);
    });
  };
  add(lexical, "lexical");
  add(vector, "vector");
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
    const engines = foundBy.length > 0 ? foundBy : ["lexical", "vector"];
    return {
      ...row,
      foundBy: engines,
      matchReason: engines.length === 1 && engines[0] === "vector" ? "Semantic" : "Fusion",
      fusionScore: typeof row.fusionScore === "number" ? row.fusionScore : null,
      ...(fusionStage === "rankFusion" ? { rrfScore: typeof row.fusionScore === "number" ? row.fusionScore : null } : {})
    };
  });
}

async function applyOptionalRerank({ query, rows, rerankPool, limit }) {
  const pool = rows.slice(0, rerankPool);
  const ranking = await rerankDocuments({
    query,
    documents: pool.map(rerankText),
    topK: limit
  });

  if (!ranking) {
    return {
      results: rows.map((r) => ({ ...r, rerankScore: null })).slice(0, limit),
      reranked: false,
      rerankPoolSize: pool.length
    };
  }

  const ordered = ranking
    .map(({ index, relevanceScore }) => {
      const row = pool[index];
      return row ? { ...row, rerankScore: relevanceScore } : null;
    })
    .filter(Boolean);

  if (ordered.length < limit) {
    const usedIds = new Set(ordered.map((r) => r.conceptId));
    for (const row of rows) {
      if (ordered.length >= limit) break;
      if (!usedIds.has(row.conceptId)) ordered.push({ ...row, rerankScore: null });
    }
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
  languageCode,
  effectiveReleaseId,
  areaConceptId,
  conceptIdScope,
  textIndex,
  searchConfig,
  hybridConfig,
  limit
}) {
  const fusionStage = normalizeFusionMode(hybridConfig.fusionMode);
  if (fusionStage === "appRrf" || disabledNativeFusionStages.has(fusionStage)) {
    return null;
  }

  const pipeline = buildNativeHybridFusionPipeline({
    query,
    limit: hybridConfig.rerankPool,
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
    conceptIdScope
  });

  try {
    const raw = await collection.aggregate(pipeline, {
      maxTimeMS: hybridConfig.nativeFusionMaxTimeMs
    }).toArray();
    const fused = normalizeNativeFusionRows(raw, fusionStage);
    const reranked = await applyOptionalRerank({
      query,
      rows: fused,
      rerankPool: hybridConfig.rerankPool,
      limit
    });

    return {
      results: reranked.results,
      reranked: reranked.reranked,
      stats: {
        engine: `mongodb-${fusionStage}`,
        nativeFusion: true,
        retrieved: raw.length,
        fusedCount: fused.length,
        rerankPool: reranked.rerankPoolSize
      },
      queryPlan: {
        engine: `mongodb-${fusionStage}`,
        description: fusionStage === "scoreFusion"
          ? "Hybrid search in one MongoDB aggregation: a keyword search and a meaning-based search run together, and $scoreFusion blends their relevance scores so the best of both wins."
          : "Hybrid search in one MongoDB aggregation: a keyword search and a meaning-based search run together, and $rankFusion blends their rankings so the best of both wins.",
        mql: pipeline,
        postProcessing: [
          "MongoDB Search (keywords) and MongoDB Vector Search (meaning) run as the two inputs to the fusion stage — one round-trip, no separate calls to blend.",
          fusionStage === "scoreFusion"
            ? "$scoreFusion combines their normalized relevance scores so concepts strong on either signal — or both — surface first."
            : "$rankFusion combines their rank positions so a concept ranked well by either engine rises to the top.",
          reranked.reranked
            ? "Voyage reranker re-reads the top concepts against the full query and reorders them by true clinical relevance."
            : "Native fusion order returned directly; Voyage rerank was not available."
        ]
      }
    };
  } catch (error) {
    if (isUnsupportedNativeFusionError(error)) {
      disabledNativeFusionStages.add(fusionStage);
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
  languageCode,
  effectiveReleaseId,
  areaConceptId,
  conceptIdScope,
  textIndex,
  searchConfig,
  hybridConfig,
  limit
}) {
  const { candidatePool, rrfK, rerankPool } = hybridConfig;
  const native = await tryNativeFusionSearch({
    collection,
    query,
    languageCode,
    effectiveReleaseId,
    areaConceptId,
    conceptIdScope,
    textIndex,
    searchConfig,
    hybridConfig,
    limit
  });

  if (native?.results) {
    return native;
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
    query,
    limit: candidatePool,
    indexName: searchConfig.vectorIndex,
    vectorPath: searchConfig.vectorPath,
    vectorMode: searchConfig.vectorMode,
    vectorModel: searchConfig.vectorModel,
    filter: vectorFilter
  });

  const [lexicalRaw, vectorRaw] = await Promise.all([
    collection.aggregate(lexicalPipeline).toArray().catch(() => []),
    collection.aggregate(vectorPipeline).toArray().catch(() => [])
  ]);

  // Apply the lexical tiered rerank (gives matchReason/matchedText), then dedupe
  // both lists to one row per concept before fusing.
  const lexical = dedupeByConcept(
    rerankNavigatorResults({ query, results: lexicalRaw, limit: candidatePool })
  );
  const vector = dedupeByConcept(vectorRaw);

  const fused = reciprocalRankFusion({ lexical, vector, k: rrfK }).map(mergeRow);

  // --- Rerank the fused pool with Voyage (graceful: null => keep RRF order).
  const rerankedResult = await applyOptionalRerank({ query, rows: fused, rerankPool, limit });

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
        `Blend the two rankings with reciprocal rank fusion (k=${rrfK}): a concept ranked highly by either engine — or by both — rises to the top, with no manual weighting to tune.`,
        rerankedResult.reranked
          ? "Voyage reranker re-reads the top concepts against the full query and reorders them by true clinical relevance, breaking ties the rankings couldn't."
          : "Voyage reranker unavailable — the fused ranking is returned as-is."
      ]
    }
  };
}
