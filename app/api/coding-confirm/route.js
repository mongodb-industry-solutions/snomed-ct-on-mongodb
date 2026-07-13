import { getCollection } from "@/lib/mongo";
import { getMongoConfig } from "@/lib/config";
import { fetchConceptSummaries } from "@/lib/concept-summaries";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Persist reviewer-confirmed SNOMED codings as a grounded clinical note.
// Each stored coding is stamped with its ancestor path (self + inferred
// ancestors) so the "query grounded data by ancestor" payoff is a real indexed
// $elemMatch over `grounded_notes.codings.ancestorIds`.

const GROUNDED_NOTES_COLLECTION = "grounded_notes";

export async function POST(request) {
  const startedAt = process.hrtime.bigint();
  try {
    const body = await parseJson(request);
    const text = typeof body.text === "string" ? body.text : "";
    const languageCode = typeof body.languageCode === "string" ? body.languageCode : "en";
    const tenantId = typeof body.tenantId === "string" && body.tenantId ? body.tenantId : "demo-hospital";
    const inputCodings = Array.isArray(body.codings) ? body.codings.slice(0, 50) : [];

    if (inputCodings.length === 0) {
      return fail("No confirmed codings to save.", 400, { code: "no-codings" });
    }

    const { sourceCollection } = getMongoConfig();
    const source = await getCollection(sourceCollection);
    const conceptIds = Array.from(new Set(inputCodings.map((c) => String(c.conceptId)).filter(Boolean)));
    const summaries = await fetchConceptSummaries({ sourceCollection: source, conceptIds, languageCode });
    const ancById = new Map(summaries.map((s) => [String(s.conceptId), Array.isArray(s.ancestorIds) ? s.ancestorIds : [String(s.conceptId)]]));

    const codings = inputCodings.map((c) => {
      const conceptId = String(c.conceptId);
      return {
        conceptId,
        system: "http://snomed.info/sct",
        display: c.display || conceptId,
        semanticTag: c.semanticTag || null,
        role: c.role || "secondary",
        target: c.target || "Condition.code",
        assertion: c.assertion || "present",
        subject: c.subject || "patient",
        status: "accepted",
        evidence: c.evidence || null,
        ancestorIds: ancById.get(conceptId) || [conceptId]
      };
    });

    const doc = {
      tenantId,
      languageCode,
      text,
      codings,
      recordedAt: new Date().toISOString(),
      createdAt: new Date()
    };

    const notes = await getCollection(GROUNDED_NOTES_COLLECTION);
    const result = await notes.insertOne(doc);
    // Best-effort index for the payoff query (idempotent).
    try {
      await notes.createIndex(
        { tenantId: 1, "codings.ancestorIds": 1, "codings.assertion": 1, "codings.subject": 1, "codings.status": 1 },
        { name: "tenant_coding_ancestors" }
      );
    } catch (_e) { /* index may already exist */ }

    return ok({
      ok: true,
      pattern: "coding-confirm",
      collection: GROUNDED_NOTES_COLLECTION,
      insertedId: String(result.insertedId),
      savedCodings: codings.length,
      sampleAncestorIds: codings[0]?.ancestorIds || [],
      latencyMs: elapsedMs(startedAt)
    });
  } catch (error) {
    return fail("Saving confirmed codings failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
