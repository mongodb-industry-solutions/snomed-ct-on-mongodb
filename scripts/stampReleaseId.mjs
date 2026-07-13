import "./loadEnv.mjs";
import { MongoClient, ServerApiVersion } from "mongodb";

const DEFAULT_SNOMED_RELEASE_ID = "20260601";

function env(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function envBoolean(name, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function isSafeIndexConflict(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("already exists with a different name") ||
    message.includes("existing index has the same name as the requested index")
  );
}

function parseReleaseDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function createIndexSafe(collection, key, options) {
  try {
    await collection.createIndex(key, options);
  } catch (error) {
    if (!isSafeIndexConflict(error)) {
      throw error;
    }
  }
}

async function run() {
  const uri = env("MONGODB_URI");
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const releaseIdTarget = env("RELEASE_ID_TARGET", env("SNOMED_RELEASE_ID", DEFAULT_SNOMED_RELEASE_ID));
  if (!releaseIdTarget) {
    throw new Error("Missing RELEASE_ID_TARGET (or SNOMED_RELEASE_ID)");
  }

  const releaseDate = parseReleaseDate(env("RELEASE_DATE", releaseIdTarget));
  const releaseLabel = env("RELEASE_LABEL", releaseIdTarget);
  const overwrite = envBoolean("RELEASE_ID_OVERWRITE", false);
  const dbName = env("MONGODB_DB", "terminology");
  const sourceCollectionName = env("MONGODB_COLLECTION", "snomed-irbd");
  const projectionCollectionName = env("MONGODB_TERM_SEARCH_COLLECTION", "snomed-term-search");

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: false,
      deprecationErrors: true
    }
  });

  await client.connect();

  try {
    const db = client.db(dbName);
    const source = db.collection(sourceCollectionName);
    const projection = db.collection(projectionCollectionName);

    const filter = overwrite ? {} : { releaseId: { $exists: false } };
    const releasePatch = {
      releaseId: releaseIdTarget,
      releaseLabel,
      releaseAppliedAt: new Date()
    };
    if (releaseDate) {
      releasePatch.releaseDate = releaseDate;
    }

    const [sourceResult, projectionResult] = await Promise.all([
      source.updateMany(filter, { $set: releasePatch }),
      projection.updateMany(filter, { $set: releasePatch })
    ]);

    await createIndexSafe(source, { releaseId: 1, conceptId: 1 }, { name: "release_concept" });
    await createIndexSafe(source, { releaseId: 1, active: 1, conceptId: 1 }, {
      name: "release_active_concept",
      partialFilterExpression: { releaseId: { $exists: true } }
    });
    await createIndexSafe(projection, { releaseId: 1, languageCode: 1, conceptId: 1, preferred: -1, termRank: -1 }, {
      name: "release_language_concept_preferred",
      partialFilterExpression: { releaseId: { $exists: true }, languageCode: { $exists: true }, conceptId: { $exists: true } }
    });
    await createIndexSafe(projection, { releaseId: 1, languageCode: 1, descriptionId: 1 }, {
      name: "release_language_description",
      partialFilterExpression: { releaseId: { $exists: true }, languageCode: { $exists: true }, descriptionId: { $exists: true } }
    });

    console.log(JSON.stringify({
      ok: true,
      releaseIdTarget,
      releaseDate: releaseDate ? releaseDate.toISOString() : null,
      releaseLabel,
      overwrite,
      updated: {
        source: sourceResult.modifiedCount,
        projection: projectionResult.modifiedCount
      },
      note: "If you overwrote release identity, rebuild the term sidecar for strict consistency."
    }, null, 2));
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error("ReleaseId stamp failed:", error?.message || error);
  process.exit(1);
});
