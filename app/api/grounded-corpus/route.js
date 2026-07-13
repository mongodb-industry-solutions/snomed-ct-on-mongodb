import { getCollection } from "@/lib/mongo";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Query grounded_notes by SNOMED ancestor path. This is not a patient cohort
// API; it demonstrates the operational payoff of storing confirmed codings
// with `codings.ancestorIds`.

const GROUNDED_NOTES_COLLECTION = "grounded_notes";

export async function POST(request) {
  const startedAt = process.hrtime.bigint();
  try {
    const body = await parseJson(request).catch(() => ({}));
    const conceptId = String(body?.conceptId || "").trim();
    const tenantId = typeof body?.tenantId === "string" && body.tenantId ? body.tenantId : "demo-hospital";
    if (!conceptId) return fail("conceptId is required", 400, { code: "no-concept" });

    const filter = {
      tenantId,
      codings: {
        $elemMatch: {
          ancestorIds: conceptId,
          assertion: "present",
          subject: "patient",
          status: "accepted"
        }
      }
    };

    const notes = await getCollection(GROUNDED_NOTES_COLLECTION);
    const [matchCount, totalCount, samples] = await Promise.all([
      notes.countDocuments(filter),
      notes.countDocuments({ tenantId }),
      notes.find(filter, {
        projection: {
          _id: 1,
          recordedAt: 1,
          text: 1,
          "codings.conceptId": 1,
          "codings.display": 1,
          "codings.role": 1,
          "codings.ancestorIds": 1
        }
      }).sort({ createdAt: -1 }).limit(5).toArray()
    ]);

    const sample = samples.map((note) => {
      const hit = (note.codings || []).find((coding) =>
        Array.isArray(coding.ancestorIds) && coding.ancestorIds.map(String).includes(conceptId)
      );
      return {
        id: String(note._id),
        recordedAt: note.recordedAt || null,
        snippet: (note.text || "").slice(0, 120),
        via: hit
          ? {
              conceptId: String(hit.conceptId),
              display: hit.display,
              role: hit.role,
              exact: String(hit.conceptId) === conceptId
            }
          : null
      };
    });

    return ok({
      ok: true,
      pattern: "grounded-corpus",
      conceptId,
      tenantId,
      matchCount,
      totalCount,
      sample,
      latencyMs: elapsedMs(startedAt)
    });
  } catch (error) {
    return fail("Grounded corpus query failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
