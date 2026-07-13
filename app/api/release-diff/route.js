import { getMongoConfig } from "@/lib/config";
import { elapsedMs, fail, ok } from "@/lib/http";
import { getCollection } from "@/lib/mongo";
import { buildMongoErrorPayload } from "@/lib/mongo-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(value) {
  return String(value || "").trim();
}

function normalizeActive(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "TRUE" || value === "True";
}

function sortReleaseIds(values) {
  return values
    .map(normalize)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
}

function describeChange(fromDoc, toDoc) {
  const changes = [];
  if (normalizeActive(fromDoc?.active) !== normalizeActive(toDoc?.active)) changes.push("active");
  if (normalize(fromDoc?.definitionStatusId) !== normalize(toDoc?.definitionStatusId)) changes.push("definitionStatus");
  if (normalize(fromDoc?.moduleId) !== normalize(toDoc?.moduleId)) changes.push("module");
  return changes;
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
    const releases = sortReleaseIds(await source.distinct("releaseId", { releaseId: { $exists: true, $nin: ["", null] } }));

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

    const [fromDocs, toDocs] = await Promise.all([
      source.find(
        { releaseId: fromReleaseId },
        { projection: { _id: 0, conceptId: 1, active: 1, definitionStatusId: 1, moduleId: 1, effectiveTime: 1 } }
      ).toArray(),
      source.find(
        { releaseId: toReleaseId },
        { projection: { _id: 0, conceptId: 1, active: 1, definitionStatusId: 1, moduleId: 1, effectiveTime: 1 } }
      ).toArray()
    ]);

    const fromById = new Map(fromDocs.map((doc) => [normalize(doc.conceptId), doc]));
    const toById = new Map(toDocs.map((doc) => [normalize(doc.conceptId), doc]));
    const added = [];
    const retired = [];
    const changed = [];

    for (const [conceptId, toDoc] of toById) {
      const fromDoc = fromById.get(conceptId);
      if (!fromDoc) {
        if (added.length < limit) added.push({ conceptId, active: normalizeActive(toDoc.active), effectiveTime: toDoc.effectiveTime || null });
        continue;
      }
      const changes = describeChange(fromDoc, toDoc);
      if (changes.length > 0 && changed.length < limit) {
        changed.push({
          conceptId,
          changes,
          from: {
            active: normalizeActive(fromDoc.active),
            definitionStatusId: normalize(fromDoc.definitionStatusId) || null,
            moduleId: normalize(fromDoc.moduleId) || null,
            effectiveTime: fromDoc.effectiveTime || null
          },
          to: {
            active: normalizeActive(toDoc.active),
            definitionStatusId: normalize(toDoc.definitionStatusId) || null,
            moduleId: normalize(toDoc.moduleId) || null,
            effectiveTime: toDoc.effectiveTime || null
          }
        });
      }
    }

    for (const [conceptId, fromDoc] of fromById) {
      if (!toById.has(conceptId) && retired.length < limit) {
        retired.push({ conceptId, active: normalizeActive(fromDoc.active), effectiveTime: fromDoc.effectiveTime || null });
      }
    }

    const fromIds = new Set(fromById.keys());
    const toIds = new Set(toById.keys());
    let addedCount = 0;
    let retiredCount = 0;
    let carriedCount = 0;
    let changedCount = 0;

    for (const [conceptId, toDoc] of toById) {
      const fromDoc = fromById.get(conceptId);
      if (!fromDoc) addedCount += 1;
      else {
        carriedCount += 1;
        if (describeChange(fromDoc, toDoc).length > 0) changedCount += 1;
      }
    }
    for (const conceptId of fromIds) {
      if (!toIds.has(conceptId)) retiredCount += 1;
    }

    return ok({
      ok: true,
      pattern: "release-diff",
      ready: true,
      releases,
      fromReleaseId,
      toReleaseId,
      counts: {
        fromConcepts: fromDocs.length,
        toConcepts: toDocs.length,
        carried: carriedCount,
        added: addedCount,
        retired: retiredCount,
        changed: changedCount
      },
      samples: {
        added,
        retired,
        changed
      },
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
