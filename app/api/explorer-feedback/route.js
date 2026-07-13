import { emitUsageEventSafe } from "@/lib/usage-events";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENT_TYPES = new Set([
  "explorer.search.submitted",
  "explorer.result.selected",
  "explorer.feedback.submitted",
  "explorer.workflow.handoff"
]);

function normalize(value) {
  return String(value || "").trim();
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function POST(request) {
  const startedAt = process.hrtime.bigint();

  try {
    const body = await parseJson(request);
    const eventType = normalize(body.eventType);

    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return fail("Unsupported explorer eventType", 400, {
        code: "unsupported-event-type",
        latencyMs: elapsedMs(startedAt)
      });
    }

    const conceptId = normalize(body.conceptId);
    const conceptIds = Array.isArray(body.conceptIds) ? body.conceptIds : conceptId ? [conceptId] : [];
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

    await emitUsageEventSafe({
      eventType,
      source: "api/explorer-feedback",
      tenantId: normalize(body.tenantId) || "demo-minister",
      actorId: normalize(body.actorId) || "explorer-user",
      releaseId: normalize(body.releaseId) || "latest",
      languageCode: normalize(body.languageCode) || null,
      conceptId: conceptId || null,
      conceptIds,
      query: normalize(body.query) || null,
      resultCount: toFiniteNumber(body.resultCount),
      durationMs: toFiniteNumber(body.durationMs),
      metadata
    });

    return ok({
      ok: true,
      pattern: "explorer-feedback",
      eventType,
      latencyMs: elapsedMs(startedAt)
    });
  } catch (error) {
    return fail("Explorer feedback failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
