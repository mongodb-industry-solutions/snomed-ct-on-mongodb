import { getCollection } from "@/lib/mongo";
import { getMongoConfig } from "@/lib/config";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { elapsedMs, fail, ok } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const start = process.hrtime.bigint();

  try {
    const { sourceCollection, dbName, authSource } = getMongoConfig();
    const collection = await getCollection(sourceCollection);
    const sample = await collection.find({}, { projection: { _id: 0, conceptId: 1 } }).limit(1).toArray();

    return ok({
      ok: true,
      dbName,
      authSource: authSource || "(uri-default)",
      sourceCollection,
      sampleSize: sample.length,
      latencyMs: elapsedMs(start)
    });
  } catch (error) {
    return fail("Database connection failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(start)
    });
  }
}
