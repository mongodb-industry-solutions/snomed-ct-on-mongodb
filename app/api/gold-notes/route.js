import { getAllGoldNotes, saveGoldNote, deleteGoldNote } from "@/lib/gold-store";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { ok, fail, parseJson, elapsedMs } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Maintain the benchmark's gold-note set: list (built-in + custom), save a
// reviewer-authored gold record from a real grounding, or delete a custom one.

export async function GET() {
  const startedAt = process.hrtime.bigint();
  try {
    const goldNotes = await getAllGoldNotes();
    return ok({ ok: true, goldNotes, latencyMs: elapsedMs(startedAt) });
  } catch (error) {
    return fail("List gold notes failed", 500, { ...buildMongoErrorPayload(error), latencyMs: elapsedMs(startedAt) });
  }
}

export async function POST(request) {
  const startedAt = process.hrtime.bigint();
  try {
    const body = await parseJson(request);
    const saved = await saveGoldNote(body?.entry || body);
    return ok({ ok: true, saved, latencyMs: elapsedMs(startedAt) });
  } catch (error) {
    return fail(error?.message || "Save gold note failed", 400, { latencyMs: elapsedMs(startedAt) });
  }
}

export async function DELETE(request) {
  const startedAt = process.hrtime.bigint();
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return fail("id is required", 400);
    const removed = await deleteGoldNote(id);
    return ok({ ok: true, removed, latencyMs: elapsedMs(startedAt) });
  } catch (error) {
    return fail("Delete gold note failed", 500, { ...buildMongoErrorPayload(error), latencyMs: elapsedMs(startedAt) });
  }
}
