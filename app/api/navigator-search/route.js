import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSearchConfig, getSemanticsConfig, getHybridSearchConfig } from "@/lib/config";
import { resolveSemanticScope } from "@/lib/semantic-scope";
import { redactLargeConceptScopes, redactLargeConceptScopesInObject } from "@/lib/pipeline-redact";
import { buildNavigatorSearchPipeline, buildNavigatorVectorFilter, buildVectorSearchPipeline } from "@/lib/pipelines";
import { ensureSearchIndexReady } from "@/lib/search-readiness";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { rerankNavigatorResults } from "@/lib/search-normalization";
import { runHybridSearch } from "@/lib/hybrid-search";
import { emitUsageEventSafe } from "@/lib/usage-events";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";

const SEARCH_MODES = new Set(["lexical", "vector", "hybrid"]);

export const runtime = "nodejs";

export async function POST(request) {
  const startedAt = process.hrtime.bigint();

  try {
    const body = await parseJson(request);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const languageCode = typeof body.languageCode === "string" ? body.languageCode : "es";
    const areaConceptId = typeof body.areaConceptId === "string" ? body.areaConceptId.trim() : "";
    const ecl = typeof body.ecl === "string" ? body.ecl.trim() : "";
    const releaseIdInput = typeof body.releaseId === "string" ? body.releaseId.trim() : "";
    const forceScopeRefresh = body.forceScopeRefresh === true;
    const mode = SEARCH_MODES.has(body.mode) ? body.mode : "lexical";
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
    const retrievalLimit = Math.min(Math.max(limit * 8, limit), 200);

    if (!query) {
      return fail("query is required", 400);
    }

    const { projectionCollection } = getMongoConfig();
    const { textIndex } = getSearchConfig();
    const { releaseId: defaultReleaseId } = getSemanticsConfig();
    const collection = await getCollection(projectionCollection);

    const searchReadiness = await ensureSearchIndexReady({
      collection,
      indexName: textIndex
    });
    if (!searchReadiness.ok) {
      return fail(searchReadiness.message, searchReadiness.status, {
        code: searchReadiness.code,
        index: searchReadiness.details,
        latencyMs: elapsedMs(startedAt)
      });
    }

    const { conceptIdScope, scope } = await resolveSemanticScope({
      areaConceptId,
      ecl,
      releaseIdInput,
      forceRefresh: forceScopeRefresh
    });

    const effectiveReleaseId = scope?.releaseId || releaseIdInput || defaultReleaseId || "latest";

    const searchConfig = getSearchConfig();
    let results = [];
    let strategy = "mongodb-search";
    let reranked = false;
    let modeStats = {};
    let pipeline = null;
    let queryPlan = null;

    if (mode === "hybrid") {
      strategy = "hybrid-fusion";
      const hybrid = await runHybridSearch({
        collection,
        query,
        languageCode,
        effectiveReleaseId,
        areaConceptId,
        conceptIdScope,
        textIndex,
        searchConfig,
        hybridConfig: getHybridSearchConfig(),
        limit
      });
      results = hybrid.results;
      reranked = hybrid.reranked;
      modeStats = hybrid.stats;
      queryPlan = hybrid.queryPlan || null;
      strategy = reranked ? `${hybrid.stats?.engine || "hybrid"}-rerank` : (hybrid.stats?.engine || strategy);
    } else if (mode === "vector") {
      strategy = "vector-search";
      pipeline = buildVectorSearchPipeline({
        query,
        limit,
        indexName: searchConfig.vectorIndex,
        vectorPath: searchConfig.vectorPath,
        vectorMode: searchConfig.vectorMode,
        vectorModel: searchConfig.vectorModel,
        filter: buildNavigatorVectorFilter({
          languageCode,
          releaseId: effectiveReleaseId,
          conceptIdScope
        })
      });
      const rawResults = await collection.aggregate(pipeline).toArray();
      const seen = new Set();
      results = rawResults
        .filter((r) => r?.conceptId && !seen.has(r.conceptId) && seen.add(r.conceptId))
        .slice(0, limit)
        .map((r) => ({ ...r, foundBy: ["vector"], matchReason: "Semantic", vectorScore: r.score }));
      modeStats = { retrieved: rawResults.length };
      queryPlan = {
        engine: "mongodb-vectorSearch",
        description: "Meaning-based search: finds the concepts semantically closest to the query, even when they share no words with it (e.g. \"heart attack\" → \"Myocardial infarction\").",
        mql: pipeline,
        postProcessing: [
          "MongoDB Vector Search compares the query's embedding against each concept's stored embedding and returns the nearest neighbours.",
          "Keep one row per concept (a concept can be reached through several of its synonyms)."
        ]
      };
    } else {
      pipeline = buildNavigatorSearchPipeline({
        query,
        limit: retrievalLimit,
        indexName: textIndex,
        languageCode,
        releaseId: effectiveReleaseId,
        areaConceptId,
        conceptIdScope
      });
      const rawResults = await collection.aggregate(pipeline).toArray();
      results = rerankNavigatorResults({ query, results: rawResults, limit }).map((r) => ({
        ...r,
        foundBy: ["lexical"]
      }));
      modeStats = { retrieved: rawResults.length };
      queryPlan = {
        engine: "mongodb-search",
        description: "Keyword search: finds concepts whose terms literally contain the words typed — exact and fast, best when the wording is already close to SNOMED.",
        mql: pipeline,
        postProcessing: [
          "MongoDB Search matches the query words against every concept term and synonym.",
          "An application rerank then promotes exact, preferred-term, and synonym matches so the most on-target concept leads."
        ]
      };
    }

    const latencyMs = elapsedMs(startedAt);

    await emitUsageEventSafe({
      eventType: "search.executed",
      source: "api/navigator-search",
      releaseId: effectiveReleaseId,
      languageCode,
      query,
      resultCount: results.length,
      durationMs: latencyMs,
      conceptIds: results.slice(0, 12).map((item) => item.conceptId),
      metadata: {
        mode,
        reranked,
        areaConceptId: areaConceptId || null,
        ecl: ecl || null,
        scopeMode: scope?.mode || "none",
        scopeCount: Array.isArray(conceptIdScope) ? conceptIdScope.length : 0
      }
    });

    return ok({
      ok: true,
      pattern: "navigator-search",
      collection: projectionCollection,
      mode,
      strategy,
      reranked,
      releaseId: effectiveReleaseId,
      scope,
      pipeline: pipeline ? redactLargeConceptScopes(pipeline) : null,
      queryPlan: queryPlan ? redactLargeConceptScopesInObject(queryPlan) : null,
      stats: {
        returned: results.length,
        ...modeStats,
        areaScoped: Boolean(areaConceptId),
        eclScoped: Boolean(ecl),
        scopeCount: Array.isArray(conceptIdScope) ? conceptIdScope.length : 0,
        scopeExpansionMs: scope?.timings?.expansionMs || 0,
        scopeCacheWarm: scope?.cache?.warm ?? null,
        latencyMs: elapsedMs(startedAt)
      },
      results
    });
  } catch (error) {
    return fail("Navigator search failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
