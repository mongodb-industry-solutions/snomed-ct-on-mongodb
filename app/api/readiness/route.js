import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSearchConfig, getSemanticsConfig } from "@/lib/config";
import { getSemanticScopeCacheStats } from "@/lib/semantic-scope";
import { probeProjectionModel, probeSourceModel } from "@/lib/model-probe";
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
      usageEventCollection
    } = getMongoConfig();
    const { textIndex, vectorIndex, vectorMode, vectorPath, manualVectorPath, vectorModel } = getSearchConfig();
    const { releaseId } = getSemanticsConfig();

    const source = await getCollection(sourceCollection);
    const projection = await getCollection(projectionCollection);
    const usageEvents = await getCollection(usageEventCollection);

    const [
      sourceCount,
      projectionCount,
      sourceBtreeIndexes,
      projectionBtreeIndexes,
      usageEventDocs,
      sourceModel,
      projectionModel
    ] = await Promise.all([
      safeEstimatedDocumentCount(source),
      safeEstimatedDocumentCount(projection),
      safeListBtreeIndexes(source),
      safeListBtreeIndexes(projection),
      safeEstimatedDocumentCount(usageEvents),
      probeSourceModel(source),
      probeProjectionModel(projection, { manualVectorPath, vectorPath })
    ]);

    const {
      hasReleaseId,
      hasEffectiveTime,
      hasReleaseDate,
      hasStoredDescendantClosure,
      hasNumericAncestorIds,
      hasNumericParentIds,
      hasNumericChildIds,
      hasNumericDescriptionConceptIds,
      hasRelationshipAttributeKeys
    } = sourceModel;

    const {
      hasProjectionReleaseDate,
      hasSemanticTagKey,
      hasManualVectors,
      hasAutoEmbedVectors
    } = projectionModel;

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
    const releaseMetadataReady = hasReleaseId && hasReleaseDate && hasProjectionReleaseDate;
    const descendantClosureRetired = !hasStoredDescendantClosure;
    const sctidStringNormalized = !(
      hasNumericAncestorIds ||
      hasNumericParentIds ||
      hasNumericChildIds ||
      hasNumericDescriptionConceptIds
    );
    const termSidecarModelReady = projectionHasConceptLookupIndex && hasSemanticTagKey;
    const relationshipAttributeReady = hasRelationshipAttributeKeys && sourceHasRelationshipAttributeIndex;
    const hardenedModelReady =
      releaseMetadataReady &&
      descendantClosureRetired &&
      sctidStringNormalized &&
      termSidecarModelReady &&
      relationshipAttributeReady;

    const readiness = {
      projectionPopulated: projectionCount > 0,
      textIndexReady: Boolean(textSummary?.queryable),
      vectorIndexReady: vectorReady,
      vectorDocsPresent: vectorContentPresent,
      ancestorLookupReady: sourceHasAncestorIndex,
      releaseDiffReady: hasReleaseId || hasEffectiveTime,
      releaseDiffIndexed:
        (hasReleaseId && sourceHasReleaseIdIndex) ||
        (hasEffectiveTime && sourceHasEffectiveTimeIndex),
      releaseMetadataReady,
      descendantClosureRetired,
      sctidStringNormalized,
      termSidecarModelReady,
      relationshipAttributeReady,
      hardenedModelReady,
      architectureReady:
        projectionCount > 0 &&
        Boolean(textSummary?.queryable) &&
        sourceHasAncestorIndex &&
        (!vectorContentPresent || vectorReady)
    };

    return ok({
      ok: true,
      pattern: "readiness-check",
      architecture: {
        dbName,
        sourceCollection,
        projectionCollection,
        usageEventCollection,
        releaseId,
        textIndex,
        vectorIndex,
        vectorMode,
        vectorPath,
        vectorModel,
        manualVectorPath
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
