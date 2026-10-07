// Records the canonical collection's migration state so /api/readiness can
// report it without scanning.
//
// The measurement here is deliberately the expensive one: "does ANY document
// have field X" cannot be answered from a sample, and a full scan is acceptable
// when an operator has explicitly asked for it. That is the whole reason the
// work moved out of the request path — see lib/model-state.js.
//
// Run it after any migration, or once against an existing deployment whose
// scripts predate this file. Until it runs, readiness reports "unknown".

import "./loadEnv.mjs";
import { MongoClient, ServerApiVersion } from "mongodb";
import { getMongoConfig, getSearchConfig, getSemanticsConfig } from "../lib/config.js";
import { stampModelState } from "../lib/model-state.js";

function env(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function envBoolean(name, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function run() {
  const uri = env("MONGODB_URI");
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  // Read the runtime's own config rather than re-deriving it. The vector path
  // default depends on the vector mode (embedText for autoEmbed,
  // embedding_voyage_4_lite_256 for manual) and both MONGODB_* and ATLAS_*
  // aliases are honoured; duplicating those rules here let the record describe
  // paths the runtime does not use, which readiness then reported as stale.
  const {
    dbName,
    sourceCollection: sourceCollectionName,
    projectionCollection: projectionCollectionName,
    modelStateCollection: stateCollectionName
  } = getMongoConfig();
  const { vectorPath, manualVectorPath } = getSearchConfig();
  const { releaseId } = getSemanticsConfig();
  const dryRun = envBoolean("STAMP_DRY_RUN", false);

  const client = new MongoClient(uri, {
    appName: "snomed-ct-on-mongodb:stamp-model-state",
    serverApi: {
      version: ServerApiVersion.v1,
      strict: false,
      deprecationErrors: true
    }
  });

  await client.connect();

  try {
    const db = client.db(dbName);

    if (dryRun) {
      console.log("STAMP_DRY_RUN=true — measuring only, nothing will be written.\n");
    }

    console.log(`Measuring ${dbName}.${sourceCollectionName} and ${dbName}.${projectionCollectionName}`);
    console.log("A negative answer requires a full scan, so this can take minutes.\n");

    const { sourceFacts, projectionFacts, sourceMs, projectionMs } = await stampModelState(db, {
      sourceCollection: sourceCollectionName,
      projectionCollection: projectionCollectionName,
      stateCollection: stateCollectionName,
      releaseId,
      manualVectorPath,
      vectorPath,
      recordedBy: "scripts/stampModelState.mjs",
      dryRun
    });

    console.log(`source (${seconds(sourceMs)}):`);
    console.log(JSON.stringify(sourceFacts, null, 2));
    console.log(`\nprojection (${seconds(projectionMs)}):`);
    console.log(JSON.stringify(projectionFacts, null, 2));

    if (dryRun) {
      console.log("\nNothing written.");
    } else {
      console.log(`\nRecorded model state in ${dbName}.${stateCollectionName}.`);
      console.log('/api/readiness will now report these facts instead of "unknown".');
    }
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error("Model state stamp failed:", error?.message || error);
  process.exit(1);
});
