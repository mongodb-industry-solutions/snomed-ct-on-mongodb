import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSearchConfig, getSemanticsConfig } from "@/lib/config";
import { resolveSemanticScope } from "@/lib/semantic-scope";
import { redactLargeConceptScopes } from "@/lib/pipeline-redact";
import { buildNavigatorSuggestPipeline } from "@/lib/pipelines";
import { ensureSearchIndexReady } from "@/lib/search-readiness";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { rerankNavigatorResults } from "@/lib/search-normalization";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";

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
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 25);
    const retrievalLimit = Math.min(Math.max(limit * 6, limit), 100);

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

    const pipeline = buildNavigatorSuggestPipeline({
      query,
      limit: retrievalLimit,
      indexName: textIndex,
      languageCode,
      releaseId: effectiveReleaseId,
      areaConceptId,
      conceptIdScope
    });

    const rawResults = await collection.aggregate(pipeline).toArray();
    const results = rerankNavigatorResults({
      query,
      results: rawResults,
      limit
    });

    return ok({
      ok: true,
      pattern: "navigator-suggest",
      collection: projectionCollection,
      strategy: "mongodb-suggest",
      releaseId: effectiveReleaseId,
      scope,
      pipeline: redactLargeConceptScopes(pipeline),
      stats: {
        returned: results.length,
        retrieved: rawResults.length,
        areaScoped: Boolean(areaConceptId),
        eclScoped: Boolean(ecl),
        scopeCount: Array.isArray(conceptIdScope) ? conceptIdScope.length : 0,
        latencyMs: elapsedMs(startedAt)
      },
      results
    });
  } catch (error) {
    return fail("Navigator suggest failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
