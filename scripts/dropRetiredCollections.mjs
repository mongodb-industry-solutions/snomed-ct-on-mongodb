import "./loadEnv.mjs";
import { MongoClient, ServerApiVersion } from "mongodb";

const RETIRED_COLLECTIONS = [
  "snomed-anc-index",
  "snomed-bindings",
  "snomed-coding-runs",
  "snomed-mapping-items",
  "snomed-mapping-sets",
  "snomed-patient-events",
  "snomed-refset-view",
  "snomed-refsets"
];

function env(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function hasApplyFlag() {
  return process.argv.includes("--apply");
}

async function getCollectionSummary(db, name) {
  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) {
    return {
      name,
      exists: false,
      documents: 0,
      indexes: 0
    };
  }

  const collection = db.collection(name);
  const [documents, indexes] = await Promise.all([
    collection.estimatedDocumentCount(),
    collection.indexes().then((rows) => rows.length)
  ]);

  return {
    name,
    exists: true,
    documents,
    indexes
  };
}

async function run() {
  const uri = env("MONGODB_URI");
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const dbName = env("MONGODB_DB", "terminology");
  const apply = hasApplyFlag();
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
    const summaries = [];

    for (const name of RETIRED_COLLECTIONS) {
      const summary = await getCollectionSummary(db, name);
      summaries.push(summary);

      if (apply && summary.exists) {
        await db.collection(name).drop();
        summary.dropped = true;
      } else {
        summary.dropped = false;
      }
    }

    console.log(JSON.stringify({
      ok: true,
      dbName,
      mode: apply ? "apply" : "dry-run",
      retiredCollections: summaries,
      nextStep: apply
        ? "Retired collections dropped."
        : "Review the list, then run: npm run collections:retire -- --apply"
    }, null, 2));
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error("Retired collection cleanup failed:", error?.message || error);
  process.exit(1);
});
