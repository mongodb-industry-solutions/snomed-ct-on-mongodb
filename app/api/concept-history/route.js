import { getMongoConfig } from "@/lib/config";
import { elapsedMs, fail, ok } from "@/lib/http";
import { getCollection } from "@/lib/mongo";
import { buildMongoErrorPayload } from "@/lib/mongo-error";

export const runtime = "nodejs";

const DESC_TYPE_FSN = "900000000000003001";
const DESC_TYPE_SYNONYM = "900000000000013009";
const ACCEPTABILITY_PREFERRED = "900000000000548007";

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeActive(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "TRUE" || value === "True";
}

function parseSemanticTag(term) {
  const normalized = String(term || "");
  const match = normalized.match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : null;
}

function descriptionScore(desc, languageCode) {
  if (!desc || !normalizeActive(desc.active)) return -1;

  const language = String(desc.languageCode || "").toLowerCase();
  const target = String(languageCode || "es").toLowerCase();
  const typeId = String(desc.typeId || "");
  const values = Object.values(desc.acceptabilityMap || {});
  const preferred = values.includes(ACCEPTABILITY_PREFERRED);

  let score = 0;
  if (language === target) score += 40;
  if (preferred) score += 20;
  if (typeId === DESC_TYPE_SYNONYM) score += 12;
  if (typeId === DESC_TYPE_FSN) score += 8;
  if (String(desc.term || "").length <= 28) score += 2;
  return score;
}

function pickPreferredTermFromDescriptions(descriptions, languageCode = "es") {
  const list = Array.isArray(descriptions) ? descriptions : [];
  let best = null;
  let bestScore = -1;

  for (const desc of list) {
    const score = descriptionScore(desc, languageCode);
    if (score > bestScore) {
      best = desc;
      bestScore = score;
    }
  }

  const fallback = list.find((entry) => normalizeActive(entry?.active) && entry?.term) || list.find((entry) => entry?.term);
  const term = String(best?.term || fallback?.term || "").trim();

  return {
    term,
    semanticTag: parseSemanticTag(term)
  };
}

function pickFsn(descriptions, languageCode = "es") {
  const list = Array.isArray(descriptions) ? descriptions : [];
  const normalizedLanguage = String(languageCode || "es").toLowerCase();
  const exact = list.find(
    (desc) =>
      normalizeActive(desc?.active) &&
      String(desc?.typeId || "") === DESC_TYPE_FSN &&
      String(desc?.languageCode || "").toLowerCase() === normalizedLanguage &&
      String(desc?.term || "").trim().length > 0
  );
  const fallback = list.find(
    (desc) => normalizeActive(desc?.active) && String(desc?.typeId || "") === DESC_TYPE_FSN && String(desc?.term || "").trim().length > 0
  );
  return String(exact?.term || fallback?.term || "").trim();
}

export async function GET(request) {
  const startedAt = process.hrtime.bigint();

  try {
    const { searchParams } = new URL(request.url);
    const conceptId = String(searchParams.get("conceptId") || "").trim();
    const languageCode = String(searchParams.get("languageCode") || "es").trim().toLowerCase() || "es";
    const limit = clamp(searchParams.get("limit"), 1, 30, 12);

    if (!conceptId) {
      return fail("conceptId is required", 400);
    }

    const { sourceCollection } = getMongoConfig();
    const source = await getCollection(sourceCollection);

    const docs = await source
      .find(
        { conceptId },
        {
          projection: {
            _id: 0,
            conceptId: 1,
            active: 1,
            effectiveTime: 1,
            moduleId: 1,
            definitionStatusId: 1,
            releaseId: 1,
            memberOfRefsetIds: 1,
            descriptions: 1,
            inferredParentIds: 1,
            inferredChildIds: 1
          }
        }
      )
      .sort({ releaseId: -1, effectiveTime: -1 })
      .limit(limit)
      .toArray();

    if (docs.length === 0) {
      return fail(`No release history was found for conceptId ${conceptId}`, 404, {
        latencyMs: elapsedMs(startedAt)
      });
    }

    const entries = docs.map((doc) => {
      const preferred = pickPreferredTermFromDescriptions(doc?.descriptions, languageCode);
      const fullySpecifiedName = pickFsn(doc?.descriptions, languageCode) || preferred.term || conceptId;

      return {
        conceptId: String(doc?.conceptId || conceptId).trim(),
        releaseId: String(doc?.releaseId || "").trim() || null,
        effectiveTime: doc?.effectiveTime || null,
        active: normalizeActive(doc?.active),
        preferredTerm: preferred.term || conceptId,
        semanticTag: preferred.semanticTag || parseSemanticTag(fullySpecifiedName) || null,
        fullySpecifiedName,
        definitionStatusId: doc?.definitionStatusId || null,
        moduleId: doc?.moduleId || null,
        parentCount: Array.isArray(doc?.inferredParentIds) ? doc.inferredParentIds.length : 0,
        childCount: Array.isArray(doc?.inferredChildIds) ? doc.inferredChildIds.length : 0,
        refsetCount: Array.isArray(doc?.memberOfRefsetIds) ? doc.memberOfRefsetIds.length : 0
      };
    });

    return ok({
      ok: true,
      conceptId,
      languageCode,
      entries,
      history: entries,
      stats: {
        returned: entries.length,
        latencyMs: elapsedMs(startedAt)
      }
    });
  } catch (error) {
    return fail("Could not load concept history.", 500, {
      latencyMs: elapsedMs(startedAt),
      ...buildMongoErrorPayload(error)
    });
  }
}
