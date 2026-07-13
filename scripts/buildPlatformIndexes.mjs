import "./loadEnv.mjs";
import { MongoClient, ServerApiVersion } from "mongodb";

function env(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function envAny(names, fallback = "") {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  return fallback;
}

function envBoolean(name, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return raw.toLowerCase() === "true";
}

function envBooleanAny(names, fallback = false) {
  for (const name of names) {
    const raw = env(name);
    if (raw) return raw.toLowerCase() === "true";
  }
  return fallback;
}

function envNumber(name, fallback, min, max) {
  const parsed = Number(env(name, String(fallback)));
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(safe, min), max);
}

function envNumberAny(names, fallback, min, max) {
  const parsed = Number(envAny(names, String(fallback)));
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(safe, min), max);
}

function envListAny(names) {
  return envAny(names)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSafeIndexConflict(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("already exists with a different name") ||
    lowered.includes("existing index has the same name as the requested index")
  );
}

async function ensureIndexes(collection, specs, label) {
  for (const spec of specs) {
    try {
      await collection.createIndex(spec.key, spec);
      console.log(`  + ${label}: ${spec.name}`);
    } catch (error) {
      if (isSafeIndexConflict(error)) {
        console.log(`  = ${label}: ${spec.name} (already satisfied with different existing name/options)`);
        continue;
      }
      throw error;
    }
  }
}

async function ensureSearchIndex({ collection, name, definition, type = "search", label }) {
  const existing = await collection.listSearchIndexes().toArray();
  const match = existing.find((entry) => entry?.name === name);

  if (!match) {
    await collection.createSearchIndexes([{ name, type, definition }]);
    console.log(`  + ${label}: ${name}`);
    return;
  }

  await collection.updateSearchIndex(name, definition);
  console.log(`  ~ ${label}: ${name} (updated)`);
}

async function run() {
  const uri = env("MONGODB_URI");
  if (!uri) throw new Error("Missing MONGODB_URI");

  const dbName = env("MONGODB_DB", "terminology");
  const sourceCollectionName = env("MONGODB_COLLECTION", "snomed-irbd");
  const projectionCollectionName = env("MONGODB_TERM_SEARCH_COLLECTION", "snomed-term-search");
  const usageEventCollectionName = env("MONGODB_USAGE_EVENT_COLLECTION", "snomed-usage-events");

  const textIndex = envAny(["MONGODB_SEARCH_INDEX", "ATLAS_SEARCH_INDEX"], "snomed_text_idx");
  const vectorIndex = envAny(["MONGODB_VECTOR_INDEX", "ATLAS_VECTOR_INDEX"], "snomed_voyage_idx");
  const vectorMode = envAny(["MONGODB_VECTOR_MODE", "ATLAS_VECTOR_MODE"], "autoEmbed").trim();
  const normalizedVectorMode = vectorMode.toLowerCase();
  const usesAutoEmbedding = normalizedVectorMode !== "manual";
  const vectorPath = envAny(["MONGODB_VECTOR_PATH", "ATLAS_VECTOR_PATH"], usesAutoEmbedding ? "embedText" : "embedding_voyage_4_lite_256");
  const buildSearchIndexes = envBooleanAny(["BUILD_MONGODB_SEARCH_INDEXES", "BUILD_ATLAS_SEARCH_INDEXES"], true);
  const buildVectorIndex = envBooleanAny(["BUILD_MONGODB_VECTOR_INDEX", "BUILD_ATLAS_VECTOR_INDEX"], true);
  const vectorDimensions = envNumberAny(["MONGODB_VECTOR_DIMENSIONS", "ATLAS_VECTOR_DIMENSIONS"], 256, 64, 4096);
  const vectorSimilarity = envAny(["MONGODB_VECTOR_SIMILARITY", "ATLAS_VECTOR_SIMILARITY"], "cosine");
  const vectorAutoEmbedModel = envAny(["MONGODB_VECTOR_AUTO_EMBED_MODEL", "ATLAS_VECTOR_AUTO_EMBED_MODEL"], "voyage-4");
  const vectorAutoEmbedModality = envAny(["MONGODB_VECTOR_AUTO_EMBED_MODALITY", "ATLAS_VECTOR_AUTO_EMBED_MODALITY"], "text");
  const vectorFilterPaths = envListAny(["MONGODB_VECTOR_FILTER_PATHS", "ATLAS_VECTOR_FILTER_PATHS"]);

  const defaultVectorFilterPaths = [
    "releaseId",
    "languageCode",
    "conceptId",
    "semanticTag",
    "semanticTagKey",
    "termType",
    "typeId",
    "definitionStatusId",
    "conceptActive",
    "preferred",
    "topRoots",
    "areaTags",
    "parentIds",
    "ancestorIds",
    "releaseDate"
  ];
  const effectiveVectorFilterPaths = vectorFilterPaths.length > 0
    ? vectorFilterPaths
    : defaultVectorFilterPaths;

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
    const usageEvents = db.collection(usageEventCollectionName);

    if (buildSearchIndexes) {
      console.log(`[1/4] Ensuring MongoDB Search indexes on ${dbName}.${projectionCollectionName}`);
      await ensureSearchIndex({
        collection: projection,
        name: textIndex,
        label: "search",
        type: "search",
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              term: {
                type: "string",
                analyzer: "lucene.standard",
                searchAnalyzer: "lucene.standard"
              },
              matchedTerm: {
                type: "string",
                analyzer: "lucene.standard",
                searchAnalyzer: "lucene.standard"
              },
              displayTerm: {
                type: "string",
                analyzer: "lucene.standard",
                searchAnalyzer: "lucene.standard"
              },
              preferredTerm: {
                type: "string",
                analyzer: "lucene.standard",
                searchAnalyzer: "lucene.standard"
              },
              fsn: {
                type: "string",
                analyzer: "lucene.standard",
                searchAnalyzer: "lucene.standard"
              },
              synonyms: {
                type: "string",
                analyzer: "lucene.standard",
                searchAnalyzer: "lucene.standard"
              },
              normalizedDisplay: {
                type: "autocomplete",
                tokenization: "edgeGram",
                minGrams: 2,
                maxGrams: 24,
                foldDiacritics: true
              },
              normalizedTerm: {
                type: "autocomplete",
                tokenization: "edgeGram",
                minGrams: 2,
                maxGrams: 24,
                foldDiacritics: true
              },
              conceptId: { type: "token" },
              descriptionId: { type: "token" },
              releaseId: { type: "token" },
              releaseDate: { type: "date" },
              languageCode: { type: "token" },
              semanticTag: { type: "token" },
              semanticTagKey: { type: "token" },
              termType: { type: "token" },
              typeId: { type: "token" },
              definitionStatusId: { type: "token" },
              moduleId: { type: "token" },
              effectiveTime: { type: "token" },
              parentIds: { type: "token" },
              ancestorIds: { type: "token" },
              active: { type: "boolean" },
              conceptActive: { type: "boolean" },
              preferred: { type: "boolean" },
              isPreferred: { type: "boolean" },
              termRank: { type: "number" },
              topRoots: { type: "token" },
              areaTags: { type: "token" }
            }
          }
        }
      });

      if (buildVectorIndex) {
        console.log(`  vector mode: ${usesAutoEmbedding ? "autoEmbed" : "manual"} (${vectorPath})`);
        const vectorFields = usesAutoEmbedding
          ? [
              {
                type: "autoEmbed",
                modality: vectorAutoEmbedModality,
                path: vectorPath,
                model: vectorAutoEmbedModel
              },
              ...effectiveVectorFilterPaths.map((path) => ({
                type: "filter",
                path
              }))
            ]
          : [
              {
                type: "vector",
                path: vectorPath,
                numDimensions: vectorDimensions,
                similarity: vectorSimilarity
              },
              ...effectiveVectorFilterPaths.map((path) => ({
                type: "filter",
                path
              }))
            ];

        await ensureSearchIndex({
          collection: projection,
          name: vectorIndex,
          label: "vector",
          type: "vectorSearch",
          definition: {
            fields: vectorFields
          }
        });
      }
    } else {
      console.log("[1/4] Skipping MongoDB Search index build (BUILD_MONGODB_SEARCH_INDEXES=false)");
    }

    console.log(`[2/4] Ensuring source indexes on ${dbName}.${sourceCollectionName}`);
    await ensureIndexes(
      source,
      [
        { key: { conceptId: 1 }, name: "conceptId" },
        { key: { releaseId: 1, conceptId: 1 }, name: "release_concept" },
        {
          key: { releaseId: 1, active: 1, conceptId: 1 },
          name: "release_active_concept",
          partialFilterExpression: { releaseId: { $exists: true } }
        },
        { key: { effectiveTime: 1, active: 1 }, name: "effectiveTime_active" },
        {
          key: { releaseId: 1, active: 1 },
          name: "releaseId_active",
          partialFilterExpression: { releaseId: { $exists: true } }
        },
        {
          key: { releaseId: 1, inferredAncestorIds: 1, active: 1 },
          name: "release_inferredAncestor_active",
          partialFilterExpression: { releaseId: { $exists: true }, inferredAncestorIds: { $exists: true } }
        },
        {
          key: { releaseId: 1, relationshipAttributeKeys: 1, active: 1, conceptId: 1 },
          name: "release_relationship_attribute_active",
          partialFilterExpression: { releaseId: { $exists: true }, relationshipAttributeKeys: { $exists: true } }
        }
      ],
      "source"
    );

    console.log(`[3/4] Ensuring term sidecar btree indexes on ${dbName}.${projectionCollectionName}`);
    await ensureIndexes(
      projection,
      [
        {
          key: { releaseId: 1, languageCode: 1, conceptId: 1, preferred: -1, termRank: -1 },
          name: "release_language_concept_preferred",
          partialFilterExpression: { releaseId: { $exists: true }, languageCode: { $exists: true }, conceptId: { $exists: true } }
        },
        {
          key: { releaseId: 1, languageCode: 1, descriptionId: 1 },
          name: "release_language_description",
          partialFilterExpression: { releaseId: { $exists: true }, languageCode: { $exists: true }, descriptionId: { $exists: true } }
        },
        {
          key: { releaseId: 1, languageCode: 1, semanticTagKey: 1, termRank: -1 },
          name: "release_language_semantic_rank",
          partialFilterExpression: { releaseId: { $exists: true }, languageCode: { $exists: true }, semanticTagKey: { $exists: true } }
        }
      ],
      "term"
    );

    console.log(`[4/4] Ensuring usage telemetry indexes on ${dbName}.${usageEventCollectionName}`);
    await ensureIndexes(
      usageEvents,
      [
        { key: { at: -1 }, name: "at_desc" },
        { key: { tenantId: 1, at: -1 }, name: "tenant_at" },
        { key: { eventType: 1, at: -1 }, name: "event_at" },
        { key: { conceptId: 1, at: -1 }, name: "concept_at", partialFilterExpression: { conceptId: { $exists: true } } },
        { key: { queryHash: 1, at: -1 }, name: "query_at", partialFilterExpression: { queryHash: { $exists: true } } }
      ],
      "usage"
    );

    console.log("Done.");
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error("Platform index build failed:", error?.message || error);
  process.exit(1);
});
