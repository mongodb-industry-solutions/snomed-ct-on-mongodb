import "./loadEnv.mjs";
import { MongoClient, ServerApiVersion } from "mongodb";
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

function normalizeStringArray(field) {
  return {
    $map: {
      input: { $ifNull: [field, []] },
      as: "value",
      in: { $toString: "$$value" }
    }
  };
}

const TRUTHY_VALUES = [true, 1, "1", "true", "TRUE", "True"];

function normalizeDescriptions() {
  return {
    $map: {
      input: { $ifNull: ["$descriptions", []] },
      as: "description",
      in: {
        $mergeObjects: [
          "$$description",
          {
            id: { $toString: { $ifNull: ["$$description.id", "$$description.descriptionId"] } },
            descriptionId: { $toString: { $ifNull: ["$$description.descriptionId", "$$description.id"] } },
            conceptId: { $toString: { $ifNull: ["$$description.conceptId", "$conceptId"] } },
            moduleId: { $toString: "$$description.moduleId" },
            typeId: { $toString: "$$description.typeId" },
            caseSignificanceId: { $toString: "$$description.caseSignificanceId" },
            active: { $in: ["$$description.active", TRUTHY_VALUES] }
          }
        ]
      }
    }
  };
}

function normalizeRelationships() {
  return {
    $map: {
      input: { $ifNull: ["$relationships", []] },
      as: "relationship",
      in: {
        $mergeObjects: [
          "$$relationship",
          {
            id: { $toString: { $ifNull: ["$$relationship.id", "$$relationship.relationshipId"] } },
            relationshipId: { $toString: { $ifNull: ["$$relationship.relationshipId", "$$relationship.id"] } },
            sourceId: { $toString: "$$relationship.sourceId" },
            destinationId: { $toString: "$$relationship.destinationId" },
            typeId: { $toString: "$$relationship.typeId" },
            moduleId: { $toString: "$$relationship.moduleId" },
            characteristicTypeId: { $toString: "$$relationship.characteristicTypeId" },
            modifierId: { $toString: "$$relationship.modifierId" },
            active: { $in: ["$$relationship.active", TRUTHY_VALUES] }
          }
        ]
      }
    }
  };
}

function relationshipAttributeKeys() {
  const activeRelationships = {
    $filter: {
      input: { $ifNull: ["$relationships", []] },
      as: "relationship",
      cond: {
        $and: [
          { $in: ["$$relationship.active", TRUTHY_VALUES] },
          { $ne: [{ $ifNull: ["$$relationship.typeId", ""] }, ""] },
          { $ne: [{ $ifNull: ["$$relationship.destinationId", ""] }, ""] }
        ]
      }
    }
  };

  return {
    $setUnion: [
      {
        $map: {
          input: activeRelationships,
          as: "relationship",
          in: {
            $concat: [
              { $toString: "$$relationship.typeId" },
              "|",
              { $toString: "$$relationship.destinationId" }
            ]
          }
        }
      },
      []
    ]
  };
}

async function run() {
  const uri = env("MONGODB_URI");
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const dbName = env("MONGODB_DB", "terminology");
  const sourceCollectionName = env("MONGODB_COLLECTION", "snomed-irbd");
  const projectionCollectionName = env("MONGODB_TERM_SEARCH_COLLECTION", "snomed-term-search");
  const stateCollectionName = env("MONGODB_MODEL_STATE_COLLECTION", "snomed-model-state");
  const releaseId = env("SNOMED_RELEASE_ID", env("RELEASE_ID_TARGET"));
  const vectorPath = env("MONGODB_VECTOR_PATH", "embedText");
  const manualVectorPath = env("MONGODB_MANUAL_VECTOR_PATH", "embedding_voyage_4_lite_256");
  const apply = envBoolean("NORMALIZE_APPLY", false);

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

    console.log(`[1/3] Sampling current model from ${dbName}.${sourceCollectionName}`);
    const [
      descendantClosureDocs,
      numericAncestorDocs,
      numericParentDocs,
      numericChildDocs,
      numericDescriptionConceptDocs,
      missingRelationshipKeyDocs
    ] = await Promise.all([
      source.countDocuments({ inferredDescendantIds: { $exists: true } }),
      source.countDocuments({ inferredAncestorIds: { $type: "number" } }),
      source.countDocuments({ inferredParentIds: { $type: "number" } }),
      source.countDocuments({ inferredChildIds: { $type: "number" } }),
      source.countDocuments({ "descriptions.conceptId": { $type: "number" } }),
      source.countDocuments({
        relationships: { $exists: true, $ne: [] },
        relationshipAttributeKeys: { $exists: false }
      })
    ]);

    console.log(
      "Hardening counters:",
      JSON.stringify(
        {
          docsWithInferredDescendantIds: descendantClosureDocs,
          docsWithNumericAncestorIds: numericAncestorDocs,
          docsWithNumericParentIds: numericParentDocs,
          docsWithNumericChildIds: numericChildDocs,
          docsWithNumericDescriptionConceptIds: numericDescriptionConceptDocs,
          docsMissingRelationshipAttributeKeys: missingRelationshipKeyDocs
        },
        null,
        2
      )
    );

    const before = await source.aggregate([
      { $limit: 2000 },
      {
        $project: {
          conceptType: { $type: "$conceptId" },
          activeType: { $type: "$active" },
          parentTypes: {
            $setUnion: [
              {
                $map: {
                  input: { $ifNull: ["$inferredParentIds", []] },
                  as: "v",
                  in: { $type: "$$v" }
                }
              },
              []
            ]
          },
          childTypes: {
            $setUnion: [
              {
                $map: {
                  input: { $ifNull: ["$inferredChildIds", []] },
                  as: "v",
                  in: { $type: "$$v" }
                }
              },
              []
            ]
          },
          descendantPresent: {
            $cond: [{ $isArray: "$inferredDescendantIds" }, true, false]
          }
        }
      },
      {
        $group: {
          _id: null,
          conceptTypes: { $addToSet: "$conceptType" },
          activeTypes: { $addToSet: "$activeType" },
          parentTypeSets: { $addToSet: "$parentTypes" },
          childTypeSets: { $addToSet: "$childTypes" },
          descendantPresentValues: { $addToSet: "$descendantPresent" }
        }
      }
    ]).toArray();

    console.log("Before:", JSON.stringify(before[0] || {}, null, 2));

    const pipeline = [
      {
        $set: {
          conceptId: { $toString: "$conceptId" },
          moduleId: { $toString: "$moduleId" },
          definitionStatusId: { $toString: "$definitionStatusId" },
          active: { $in: ["$active", TRUTHY_VALUES] },
          inferredParentIds: normalizeStringArray("$inferredParentIds"),
          inferredChildIds: normalizeStringArray("$inferredChildIds"),
          inferredAncestorIds: normalizeStringArray("$inferredAncestorIds"),
          memberOfRefsetIds: normalizeStringArray("$memberOfRefsetIds"),
          descriptions: normalizeDescriptions(),
          relationships: normalizeRelationships(),
          relationshipAttributeKeys: relationshipAttributeKeys()
        }
      },
      {
        $unset: "inferredDescendantIds"
      }
    ];

    console.log(`[2/3] ${apply ? "Applying" : "Dry-run prepared"} normalization update pipeline`);

    if (apply) {
      const result = await source.updateMany({}, pipeline, { bypassDocumentValidation: true });
      console.log(
        JSON.stringify(
          {
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount
          },
          null,
          2
        )
      );
    } else {
      console.log("Dry-run only. Set NORMALIZE_APPLY=true to execute updateMany.");
    }

    // Re-record the collection's migration state so /api/readiness reports the
    // shape this run just produced rather than the previous one. Skipped on a
    // dry run, where nothing actually changed.
    if (apply) {
      console.log("[2b/3] Recording model state for /api/readiness");
      const { sourceFacts, projectionFacts } = await stampModelState(db, {
        sourceCollection: sourceCollectionName,
        projectionCollection: projectionCollectionName,
        stateCollection: stateCollectionName,
        releaseId,
        manualVectorPath,
        vectorPath,
        recordedBy: "scripts/normalizeSourceModel.mjs"
      });
      console.log(JSON.stringify({ source: sourceFacts, projection: projectionFacts }, null, 2));
    }

    console.log("[3/3] Sampling model after normalization logic");
    const after = await source.aggregate([
      {
        $project: {
          conceptType: { $type: { $toString: "$conceptId" } },
          activeType: { $type: { $in: ["$active", TRUTHY_VALUES] } },
          parentTypes: {
            $setUnion: [
              {
                $map: {
                  input: normalizeStringArray("$inferredParentIds"),
                  as: "v",
                  in: { $type: "$$v" }
                }
              },
              []
            ]
          },
          childTypes: {
            $setUnion: [
              {
                $map: {
                  input: normalizeStringArray("$inferredChildIds"),
                  as: "v",
                  in: { $type: "$$v" }
                }
              },
              []
            ]
          },
          descendantPresent: { $literal: false }
        }
      },
      { $limit: 2000 },
      {
        $group: {
          _id: null,
          conceptTypes: { $addToSet: "$conceptType" },
          activeTypes: { $addToSet: "$activeType" },
          parentTypeSets: { $addToSet: "$parentTypes" },
          childTypeSets: { $addToSet: "$childTypes" },
          descendantPresentValues: { $addToSet: "$descendantPresent" }
        }
      }
    ]).toArray();

    console.log("Expected after:", JSON.stringify(after[0] || {}, null, 2));
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error("Normalization failed:", error?.message || error);
  process.exit(1);
});
