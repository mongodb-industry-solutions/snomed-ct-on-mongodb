import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSearchConfig, getSemanticsConfig } from "@/lib/config";
import { getSemanticScopeCacheStats } from "@/lib/semantic-scope";
import {
  PROJECTION_STATE_ID,
  SOURCE_STATE_ID,
  readModelState,
  triAnd,
  triNot,
  triOr
} from "@/lib/model-state";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { elapsedMs, fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function compactSearchIndex(index) {
  const fields = Array.isArray(index?.latestDefinition?.fields)
    ? index.latestDefinition.fields
    : Array.isArray(index?.definition?.fields)
      ? index.definition.fields
      : [];
  return {
    name: index?.name,
    type: index?.type,
    status: index?.status,
    queryable: Boolean(index?.queryable),
    fieldTypes: fields.map((field) => `${field?.type || "unknown"}:${field?.path || ""}`).filter(Boolean)
  };
}

function searchIndexHasField(index, type, path) {
  const fields = Array.isArray(index?.latestDefinition?.fields)
    ? index.latestDefinition.fields
    : Array.isArray(index?.definition?.fields)
      ? index.definition.fields
      : [];
  return fields.some((field) => field?.type === type && field?.path === path);
}

function hasIndexField(indexes, fieldName) {
  return indexes.some((entry) => {
    const key = entry?.key || {};
    return Object.prototype.hasOwnProperty.call(key, fieldName);
  });
}

function hasIndexPrefix(indexes, expectedPrefix) {
  const expected = Object.entries(expectedPrefix);
  if (expected.length === 0) return false;

  return indexes.some((entry) => {
    const key = entry?.key || {};
    const actual = Object.entries(key).slice(0, expected.length);
    return expected.every(([field, direction], index) => {
      const [actualField, actualDirection] = actual[index] || [];
      return actualField === field && actualDirection === direction;
    });
  });
}

function isNamespaceMissingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return lowered.includes("namespace") && lowered.includes("not") && lowered.includes("exist");
}

async function safeEstimatedDocumentCount(collection) {
  try {
    return await collection.estimatedDocumentCount();
  } catch (error) {
    if (isNamespaceMissingError(error)) {
      return 0;
    }
    throw error;
  }
}

async function safeListBtreeIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (error) {
    if (isNamespaceMissingError(error)) {
      return [];
    }
    throw error;
  }
}

export async function GET() {
  const startedAt = process.hrtime.bigint();

  try {
    const {
      dbName,
      sourceCollection,
      projectionCollection,
      usageEventCollection,
      modelStateCollection
    } = getMongoConfig();
    const { textIndex, vectorIndex, vectorMode, vectorPath, manualVectorPath, vectorModel } = getSearchConfig();
    const { releaseId } = getSemanticsConfig();

    const source = await getCollection(sourceCollection);
    const projection = await getCollection(projectionCollection);
    const usageEvents = await getCollection(usageEventCollection);
    const modelState = await getCollection(modelStateCollection);

    const vectorPaths = { manualVectorPath, vectorPath };

    // Counts and index metadata are cheap. Collection-wide field facts come from
    // the recorded model state, never from a scan — see lib/model-state.js.
    const [
      sourceCount,
      projectionCount,
      sourceBtreeIndexes,
      projectionBtreeIndexes,
      usageEventDocs,
      sourceState,
      projectionState
    ] = await Promise.all([
      safeEstimatedDocumentCount(source),
      safeEstimatedDocumentCount(projection),
      safeListBtreeIndexes(source),
      safeListBtreeIndexes(projection),
      safeEstimatedDocumentCount(usageEvents),
      readModelState(modelState, { id: SOURCE_STATE_ID, collection: sourceCollection }),
      readModelState(modelState, {
        id: PROJECTION_STATE_ID,
        collection: projectionCollection,
        vectorPaths
      })
    ]);

    // A null facts object means nothing has been recorded. Every dependent value
    // must then read null (unknown) rather than false (not ready).
    const sf = sourceState.facts;
    const pf = projectionState.facts;

    const hasReleaseId = sf ? sf.hasReleaseId : null;
    const hasEffectiveTime = sf ? sf.hasEffectiveTime : null;
    const hasReleaseDate = sf ? sf.hasReleaseDate : null;
    const hasStoredDescendantClosure = sf ? sf.hasStoredDescendantClosure : null;
    const hasNumericAncestorIds = sf ? sf.hasNumericAncestorIds : null;
    const hasNumericParentIds = sf ? sf.hasNumericParentIds : null;
    const hasNumericChildIds = sf ? sf.hasNumericChildIds : null;
    const hasNumericDescriptionConceptIds = sf ? sf.hasNumericDescriptionConceptIds : null;
    const hasRelationshipAttributeKeys = sf ? sf.hasRelationshipAttributeKeys : null;

    const hasProjectionReleaseDate = pf ? pf.hasReleaseDate : null;
    const hasSemanticTagKey = pf ? pf.hasSemanticTagKey : null;
    const hasManualVectors = pf ? pf.hasManualVectors : null;
    const hasAutoEmbedVectors = pf ? pf.hasAutoEmbedVectors : null;

    let searchIndexes = [];
    let searchIndexError = "";

    try {
      searchIndexes = await projection.listSearchIndexes().toArray();
    } catch (error) {
      searchIndexError = error instanceof Error ? error.message : String(error);
    }

    const sourceHasEffectiveTimeIndex = hasIndexField(sourceBtreeIndexes, "effectiveTime");
    const sourceHasReleaseIdIndex = hasIndexField(sourceBtreeIndexes, "releaseId");
    const sourceHasAncestorIndex = hasIndexField(sourceBtreeIndexes, "inferredAncestorIds");
    const sourceHasRelationshipAttributeIndex = hasIndexField(sourceBtreeIndexes, "relationshipAttributeKeys");
    const projectionHasConceptLookupIndex = hasIndexPrefix(projectionBtreeIndexes, {
      releaseId: 1,
      languageCode: 1,
      conceptId: 1
    });

    const searchSummary = searchIndexes.map(compactSearchIndex);
    const rawVectorIndex = searchIndexes.find((entry) => entry.name === vectorIndex) || null;
    const textSummary = searchSummary.find((entry) => entry.name === textIndex) || null;
    const vectorSummary = searchSummary.find((entry) => entry.name === vectorIndex) || null;
    const semanticsScopeCache = getSemanticScopeCacheStats();

    const usesAutoEmbedding = String(vectorMode || "").toLowerCase() === "autoembed";
    const vectorContentPresent = usesAutoEmbedding ? hasAutoEmbedVectors : hasManualVectors;
    const vectorDefinitionMatchesMode = usesAutoEmbedding
      ? searchIndexHasField(rawVectorIndex, "autoEmbed", vectorPath)
      : searchIndexHasField(rawVectorIndex, "vector", vectorPath);
    const vectorReady = Boolean(vectorSummary?.queryable) && vectorDefinitionMatchesMode;

    const releaseMetadataReady = triAnd(hasReleaseId, hasReleaseDate, hasProjectionReleaseDate);
    const descendantClosureRetired = triNot(hasStoredDescendantClosure);
    const sctidStringNormalized = triNot(
      triOr(hasNumericAncestorIds, hasNumericParentIds, hasNumericChildIds, hasNumericDescriptionConceptIds)
    );
    const termSidecarModelReady = triAnd(projectionHasConceptLookupIndex, hasSemanticTagKey);
    const relationshipAttributeReady = triAnd(hasRelationshipAttributeKeys, sourceHasRelationshipAttributeIndex);
    const hardenedModelReady = triAnd(
      releaseMetadataReady,
      descendantClosureRetired,
      sctidStringNormalized,
      termSidecarModelReady,
      relationshipAttributeReady
    );

    // `!vectorContentPresent || vectorReady`: a queryable vector index satisfies
    // the clause whatever the content, so only the not-ready case can be unknown.
    const vectorClause = vectorReady ? true : triNot(vectorContentPresent);

    const readiness = {
      projectionPopulated: projectionCount > 0,
      textIndexReady: Boolean(textSummary?.queryable),
      vectorIndexReady: vectorReady,
      vectorDocsPresent: vectorContentPresent,
      ancestorLookupReady: sourceHasAncestorIndex,
      releaseDiffReady: triOr(hasReleaseId, hasEffectiveTime),
      releaseDiffIndexed: triOr(
        triAnd(hasReleaseId, sourceHasReleaseIdIndex),
        triAnd(hasEffectiveTime, sourceHasEffectiveTimeIndex)
      ),
      releaseMetadataReady,
      descendantClosureRetired,
      sctidStringNormalized,
      termSidecarModelReady,
      relationshipAttributeReady,
      hardenedModelReady,
      architectureReady: triAnd(
        projectionCount > 0,
        Boolean(textSummary?.queryable),
        sourceHasAncestorIndex,
        vectorClause
      )
    };

    const guidance = "Run `npm run model:stamp-state` to record the collection's migration state.";

    return ok({
      ok: true,
      pattern: "readiness-check",
      architecture: {
        dbName,
        sourceCollection,
        projectionCollection,
        usageEventCollection,
        modelStateCollection,
        releaseId,
        textIndex,
        vectorIndex,
        vectorMode,
        vectorPath,
        vectorModel,
        manualVectorPath
      },
      modelState: {
        // recorded:false means every dependent check reads null, i.e. unknown.
        source: {
          recorded: sourceState.recorded,
          recordedAt: sourceState.recordedAt,
          recordedBy: sourceState.recordedBy,
          releaseId: sourceState.releaseId,
          collection: sourceCollection,
          guidance: sourceState.recorded ? null : guidance
        },
        projection: {
          recorded: projectionState.recorded,
          recordedAt: projectionState.recordedAt,
          recordedBy: projectionState.recordedBy,
          collection: projectionCollection,
          staleVectorPaths: projectionState.stalePaths,
          guidance: projectionState.recorded ? null : guidance
        }
      },
      counts: {
        sourceCount,
        projectionCount,
        usageEventDocs
      },
      indexes: {
        btreeSource: sourceBtreeIndexes.map((index) => index.name),
        btreeProjection: projectionBtreeIndexes.map((index) => index.name),
        sourceHasEffectiveTimeIndex,
        sourceHasReleaseIdIndex,
        sourceHasAncestorIndex,
        sourceHasRelationshipAttributeIndex,
        projectionHasConceptLookupIndex,
        search: searchSummary,
        textIndex: textSummary,
        vectorIndex: vectorSummary,
        searchIndexError
      },
      capabilities: {
        supportsReleaseId: hasReleaseId,
        supportsEffectiveTime: hasEffectiveTime,
        supportsReleaseDate: hasReleaseDate,
        projectionHasReleaseDate: hasProjectionReleaseDate,
        projectionHasSemanticTagKey: hasSemanticTagKey,
        hasStoredDescendantClosure,
        hasNumericAncestorIds,
        hasNumericParentIds,
        hasNumericChildIds,
        hasNumericDescriptionConceptIds,
        hasRelationshipAttributeKeys,
        hasManualVectors,
        hasAutoEmbedVectors
      },
      caches: {
        semanticsScope: semanticsScopeCache
      },
      readiness,
      stats: {
        latencyMs: elapsedMs(startedAt)
      }
    });
  } catch (error) {
    return fail("Readiness check failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
