// Authoritative record of how far the canonical collection has been migrated.
//
// Readiness used to infer this by probing the concept collection for each field.
// That cannot be done cheaply and honestly at the same time: "does ANY of ~549K
// documents have field X" needs a full scan to answer, and a bounded sample can
// only ever prove the positive case. A sample that misses a sparse field reports
// a hardened collection as unmigrated; a sample that misses a legacy numeric
// array reports the reverse. Both directions are wrong in ways an operator would
// act on.
//
// So the migration scripts record what they did, readiness reads that record, and
// an unrecorded collection reports "unknown" rather than a guess. "Unknown" is a
// real answer here — it is the honest state of any deployment whose scripts have
// not been run since this was introduced.
//
// The measurement itself still exists (measureSourceModel / measureProjectionModel),
// but it is only ever called from scripts, where an operator has explicitly asked
// for it and a slow full scan is acceptable.

const STATE_VERSION = 1;

export const SOURCE_STATE_ID = "source";
export const PROJECTION_STATE_ID = "projection";

export function isNamespaceMissingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return lowered.includes("namespace") && lowered.includes("not") && lowered.includes("exist");
}

// Mirrors the filter the original readiness probes used. findOne stops at the
// first match, so this is fast when the answer is "yes" and scans the collection
// when it is "no" — which is exactly why it belongs in a script, not a request.
async function anyDocumentMatches(collection, filter) {
  try {
    return Boolean(await collection.findOne(filter, { projection: { _id: 1 } }));
  } catch (error) {
    if (isNamespaceMissingError(error)) {
      return false;
    }
    throw error;
  }
}

export async function measureSourceModel(collection) {
  return {
    hasReleaseId: await anyDocumentMatches(collection, { releaseId: { $exists: true } }),
    hasEffectiveTime: await anyDocumentMatches(collection, { effectiveTime: { $exists: true } }),
    hasReleaseDate: await anyDocumentMatches(collection, { releaseDate: { $exists: true } }),
    hasStoredDescendantClosure: await anyDocumentMatches(collection, { inferredDescendantIds: { $exists: true } }),
    hasNumericAncestorIds: await anyDocumentMatches(collection, { inferredAncestorIds: { $type: "number" } }),
    hasNumericParentIds: await anyDocumentMatches(collection, { inferredParentIds: { $type: "number" } }),
    hasNumericChildIds: await anyDocumentMatches(collection, { inferredChildIds: { $type: "number" } }),
    hasNumericDescriptionConceptIds: await anyDocumentMatches(collection, {
      "descriptions.conceptId": { $type: "number" }
    }),
    hasRelationshipAttributeKeys: await anyDocumentMatches(collection, {
      relationshipAttributeKeys: { $exists: true, $ne: [] }
    })
  };
}

export async function measureProjectionModel(collection, { manualVectorPath, vectorPath }) {
  return {
    hasReleaseDate: await anyDocumentMatches(collection, { releaseDate: { $exists: true } }),
    hasSemanticTagKey: await anyDocumentMatches(collection, { semanticTagKey: { $exists: true } }),
    hasManualVectors: manualVectorPath
      ? await anyDocumentMatches(collection, { [manualVectorPath]: { $exists: true } })
      : false,
    hasAutoEmbedVectors: vectorPath
      ? await anyDocumentMatches(collection, { [vectorPath]: { $exists: true, $type: "string", $ne: "" } })
      : false
  };
}

export async function writeModelState(stateCollection, { id, collection, facts, releaseId, recordedBy, vectorPaths }) {
  const now = new Date();
  await stateCollection.updateOne(
    { _id: id },
    {
      $set: {
        collection,
        version: STATE_VERSION,
        recordedAt: now,
        recordedBy: recordedBy || "unknown",
        releaseId: releaseId || null,
        ...(vectorPaths ? { vectorPaths } : {}),
        facts
      }
    },
    { upsert: true }
  );
  return now;
}

// Returns { recorded, recordedAt, recordedBy, releaseId, facts, stalePaths }.
// `facts` is null when nothing has been recorded, which the caller must surface
// as "unknown" rather than "not ready".
export async function readModelState(stateCollection, { id, collection, vectorPaths }) {
  let doc = null;
  try {
    doc = await stateCollection.findOne({ _id: id });
  } catch (error) {
    if (!isNamespaceMissingError(error)) throw error;
  }

  if (!doc || !doc.facts || doc.version !== STATE_VERSION || doc.collection !== collection) {
    return { recorded: false, recordedAt: null, recordedBy: null, releaseId: null, facts: null, stalePaths: false };
  }

  let facts = doc.facts;
  let stalePaths = false;

  // Vector fields are configurable. If the configured paths differ from the ones
  // measured, those two facts are no longer about the fields in play — report
  // them as unknown rather than as stale booleans.
  if (vectorPaths) {
    const recorded = doc.vectorPaths || {};
    const changed =
      (recorded.manualVectorPath || "") !== (vectorPaths.manualVectorPath || "") ||
      (recorded.vectorPath || "") !== (vectorPaths.vectorPath || "");
    if (changed) {
      stalePaths = true;
      facts = { ...facts, hasManualVectors: null, hasAutoEmbedVectors: null };
    }
  }

  return {
    recorded: true,
    recordedAt: doc.recordedAt || null,
    recordedBy: doc.recordedBy || null,
    releaseId: doc.releaseId || null,
    facts,
    stalePaths
  };
}

// Measures both collections and records the result. Shared by the standalone
// script and by the migration scripts, so a migration cannot leave the recorded
// state describing the previous shape.
export async function stampModelState(
  db,
  {
    sourceCollection,
    projectionCollection,
    stateCollection,
    releaseId,
    manualVectorPath,
    vectorPath,
    recordedBy,
    dryRun = false
  }
) {
  const sourceStarted = Date.now();
  const sourceFacts = await measureSourceModel(db.collection(sourceCollection));
  const sourceMs = Date.now() - sourceStarted;

  const projectionStarted = Date.now();
  const projectionFacts = await measureProjectionModel(db.collection(projectionCollection), {
    manualVectorPath,
    vectorPath
  });
  const projectionMs = Date.now() - projectionStarted;

  if (!dryRun) {
    const state = db.collection(stateCollection);

    await writeModelState(state, {
      id: SOURCE_STATE_ID,
      collection: sourceCollection,
      facts: sourceFacts,
      releaseId,
      recordedBy
    });
    await writeModelState(state, {
      id: PROJECTION_STATE_ID,
      collection: projectionCollection,
      facts: projectionFacts,
      releaseId,
      recordedBy,
      vectorPaths: { manualVectorPath, vectorPath }
    });
  }

  return { sourceFacts, projectionFacts, sourceMs, projectionMs };
}

// Tri-state boolean helpers. `null` means unknown, and propagates: a definite
// false anywhere wins, otherwise unknown beats true.
export function triAnd(...values) {
  if (values.some((value) => value === false)) return false;
  if (values.some((value) => value === null || value === undefined)) return null;
  return true;
}

export function triOr(...values) {
  if (values.some((value) => value === true)) return true;
  if (values.some((value) => value === null || value === undefined)) return null;
  return false;
}

export function triNot(value) {
  return value === null || value === undefined ? null : !value;
}
