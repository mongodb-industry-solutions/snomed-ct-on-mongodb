import { getCollection } from "@/lib/mongo";
import { getMongoConfig } from "@/lib/config";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { elapsedMs, fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sidebar counters. estimatedDocumentCount reads collection metadata, so this stays
// O(1) regardless of collection size — unlike the readiness probes it replaces, which
// scanned the whole canonical collection on every page load just to render a number.
export async function GET() {
  const startedAt = process.hrtime.bigint();

  try {
    const { dbName, sourceCollection, projectionCollection } = getMongoConfig();
    const [source, projection] = await Promise.all([
      getCollection(sourceCollection),
      getCollection(projectionCollection)
    ]);
    const [sourceCount, projectionCount] = await Promise.all([
      source.estimatedDocumentCount(),
      projection.estimatedDocumentCount()
    ]);

    return ok({
      ok: true,
      pattern: "collection-stats",
      dbName,
      sourceCollection,
      projectionCollection,
      counts: {
        sourceCount,
        projectionCount
      },
      stats: {
        latencyMs: elapsedMs(startedAt)
      }
    });
  } catch (error) {
    return fail("Collection stats failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
