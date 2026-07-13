import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSemanticsConfig } from "@/lib/config";
import { validateEclExpression } from "@/lib/ecl";
import { resolveSemanticScope } from "@/lib/semantic-scope";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";

export const runtime = "nodejs";

const ACTIVE_VALUES = new Set([true, 1, "1", "true", "TRUE", "True"]);
const DESC_TYPE_FSN = "900000000000003001";

function normalizeActive(value) {
  return ACTIVE_VALUES.has(value);
}

function descriptionScore(desc, languageCode) {
  const lang = String(desc?.languageCode || "").toLowerCase();
  const typeId = String(desc?.typeId || "");
  const term = String(desc?.term || "").trim();
  if (!term || !normalizeActive(desc?.active)) return -1;

  let score = 0;
  if (lang === String(languageCode || "es").toLowerCase()) score += 100;
  if (typeId === DESC_TYPE_FSN) score += 8;
  if (desc?.acceptabilityMap && typeof desc.acceptabilityMap === "object") {
    if (Object.values(desc.acceptabilityMap).some((value) => String(value) === "900000000000548007")) {
      score += 20;
    }
  }
  score -= Math.min(term.length / 100, 2);
  return score;
}

function pickPreferredTermFromDescriptions(descriptions, languageCode = "es") {
  const rows = Array.isArray(descriptions) ? descriptions : [];
  let best = null;
  let bestScore = -Infinity;
  for (const desc of rows) {
    const score = descriptionScore(desc, languageCode);
    if (score > bestScore) {
      bestScore = score;
      best = desc;
    }
  }
  return String(best?.term || "").trim();
}

function pickFsnFromDescriptions(descriptions, languageCode = "es") {
  const rows = Array.isArray(descriptions) ? descriptions : [];
  const normalizedLanguage = String(languageCode || "es").toLowerCase();
  const fsnByLanguage = rows.find((desc) => normalizeActive(desc?.active) && String(desc?.typeId || "") === DESC_TYPE_FSN && String(desc?.languageCode || "").toLowerCase() === normalizedLanguage);
  const fsnFallback = rows.find((desc) => normalizeActive(desc?.active) && String(desc?.typeId || "") === DESC_TYPE_FSN);
  return String(fsnByLanguage?.term || fsnFallback?.term || "").trim();
}

function extractSemanticTag(fsn) {
  const match = String(fsn || "").match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : null;
}

async function enrichConcepts({ conceptIds, releaseId, languageCode }) {
  if (!Array.isArray(conceptIds) || conceptIds.length === 0) return [];
  const { sourceCollection } = getMongoConfig();
  const source = await getCollection(sourceCollection);
  const docs = await source.find(
    {
      conceptId: { $in: conceptIds },
      ...(releaseId ? { releaseId } : {})
    },
    {
      projection: {
        _id: 0,
        conceptId: 1,
        active: 1,
        effectiveTime: 1,
        definitionStatusId: 1,
        inferredParentIds: 1,
        descriptions: 1
      }
    }
  ).toArray();

  const byId = new Map(docs.map((doc) => [String(doc.conceptId), doc]));
  return conceptIds.map((conceptId) => {
    const doc = byId.get(String(conceptId));
    if (!doc) {
      return { conceptId: String(conceptId), term: `Concept #${conceptId}` };
    }
    const term = pickPreferredTermFromDescriptions(doc.descriptions, languageCode) || `Concept #${conceptId}`;
    const fsn = pickFsnFromDescriptions(doc.descriptions, languageCode) || null;
    return {
      conceptId: String(doc.conceptId),
      term,
      fsn,
      semanticTag: extractSemanticTag(fsn),
      active: normalizeActive(doc.active),
      effectiveTime: doc.effectiveTime || null,
      definitionStatusId: doc.definitionStatusId || null,
      parentCount: Array.isArray(doc.inferredParentIds) ? doc.inferredParentIds.length : 0
    };
  });
}


export async function POST(request) {
  const startedAt = process.hrtime.bigint();

  try {
    const body = await parseJson(request);
    const mode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "validate";
    const expr = typeof body.expr === "string" ? body.expr.trim() : "";

    if (!expr) {
      return fail("expr is required", 400);
    }

    if (mode === "validate") {
      const validation = validateEclExpression(expr);
      if (!validation.ok) {
        return fail(validation.error || "Invalid ECL expression", 400);
      }

      return ok({
        ok: true,
        pattern: "ecl-validate",
        expr,
        ast: validation.ast,
        stats: {
          latencyMs: elapsedMs(startedAt)
        }
      });
    }

    const releaseIdInput = typeof body.releaseId === "string" ? body.releaseId.trim() : "";
    const languageCode = typeof body.languageCode === "string" ? body.languageCode : "es";
    const forceScopeRefresh = body.forceScopeRefresh === true;
    const returnLimit = Math.min(Math.max(Number(body.limit) || 400, 1), 5000);

    const { releaseId: defaultReleaseId } = getSemanticsConfig();
    const { conceptIdScope, scope } = await resolveSemanticScope({
      ecl: expr,
      releaseIdInput,
      forceRefresh: forceScopeRefresh
    });
    const effectiveReleaseId = scope?.releaseId || releaseIdInput || defaultReleaseId || "latest";
    const conceptIds = conceptIdScope.slice(0, returnLimit);
    const concepts = await enrichConcepts({
      conceptIds,
      releaseId: effectiveReleaseId,
      languageCode
    });

    return ok({
      ok: true,
      pattern: "ecl-expand",
      expr,
      scope,
      stats: {
        totalExpanded: scope?.expandedCount || conceptIdScope.length,
        appliedScopeCount: scope?.appliedScopeCount || conceptIdScope.length,
        returned: Math.min(conceptIdScope.length, returnLimit),
        truncated: Boolean(scope?.truncated) || conceptIdScope.length > returnLimit,
        scopeExpansionMs: scope?.timings?.expansionMs || 0,
        scopeCacheWarm: scope?.cache?.warm ?? null,
        latencyMs: elapsedMs(startedAt)
      },
      conceptIds,
      concepts
    });
  } catch (error) {
    return fail("ECL request failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
