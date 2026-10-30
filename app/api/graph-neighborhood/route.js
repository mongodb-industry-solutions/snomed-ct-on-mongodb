import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSemanticsConfig } from "@/lib/config";
import { buildGraphLookupPipeline } from "@/lib/pipelines";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request) {
  const startedAt = process.hrtime.bigint();
  try {
    const body = await parseJson(request);
    const conceptId = String(body.conceptId || "").trim();
    if (!/^\d{6,18}$/.test(conceptId)) return fail("A valid SNOMED concept is required.", 400);
    const levels = Math.min(Math.max(Number(body.levels) || 2, 1), 5);
    const { sourceCollection } = getMongoConfig();
    const { releaseId } = getSemanticsConfig();
    const effectiveReleaseId = body.releaseId || releaseId;
    const pipeline = buildGraphLookupPipeline({ conceptId, direction: "ancestors", maxDepth: levels - 1,
      limit: 100, collectionName: sourceCollection, languageCode: body.languageCode === "es" ? "es" : "en", releaseId: effectiveReleaseId });
    const source = await getCollection(sourceCollection);
    const [result] = await source.aggregate(pipeline, { maxTimeMS: 12000, allowDiskUse: true }).toArray();
    if (!result) return fail("Concept not found in this release.", 404);
    return ok({ ok: true, pattern: "graph-lookup", direction: "ancestors", levels, releaseId: effectiveReleaseId,
      result, pipeline, latencyMs: elapsedMs(startedAt) });
  } catch (error) { return fail("Could not expand the concept's ancestors.", 500, { detail: error.message }); }
}
