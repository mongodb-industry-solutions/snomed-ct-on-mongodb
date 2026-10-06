import { getMongoConfig } from "@/lib/config";
import { elapsedMs, fail, ok } from "@/lib/http";
import { getCollection } from "@/lib/mongo";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { diffReleases, sortReleaseIds } from "@/lib/release-diff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(value) {
  return String(value || "").trim();
}

export async function GET(request) {
  const startedAt = process.hrtime.bigint();

  try {
    const { searchParams } = new URL(request.url);
    const requestedFrom = normalize(searchParams.get("from"));
    const requestedTo = normalize(searchParams.get("to"));
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 20, 1), 100);

    const { sourceCollection } = getMongoConfig();
    const source = await getCollection(sourceCollection);

    // Unfiltered distinct() over the indexed releaseId prefix resolves from the
    // index alone. sortReleaseIds already discards the null/empty values the old
    // $exists/$nin filter excluded, and that filter defeated the DISTINCT_SCAN plan.
    const releases = sortReleaseIds(await source.distinct("releaseId"));

    if (releases.length < 2) {
      return ok({
        ok: true,
        pattern: "release-diff",
        ready: false,
        releases,
        message: "Release diff requires at least two loaded releaseId values in the canonical SNOMED collection.",
        stats: {
          releaseCount: releases.length,
          latencyMs: elapsedMs(startedAt)
        }
      });
    }

    const toReleaseId = requestedTo || releases[0];
    const fromReleaseId = requestedFrom || releases.find((releaseId) => releaseId !== toReleaseId);

    if (!fromReleaseId || !toReleaseId || fromReleaseId === toReleaseId) {
      return fail("Release diff requires two different releases.", 400, {
        releases,
        latencyMs: elapsedMs(startedAt)
      });
    }

    const { counts, samples } = await diffReleases(source, { fromReleaseId, toReleaseId, limit });

    return ok({
      ok: true,
      pattern: "release-diff",
      ready: true,
      releases,
      fromReleaseId,
      toReleaseId,
      counts,
      samples,
      stats: {
        releaseCount: releases.length,
        latencyMs: elapsedMs(startedAt)
      }
    });
  } catch (error) {
    return fail("Release diff failed.", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
