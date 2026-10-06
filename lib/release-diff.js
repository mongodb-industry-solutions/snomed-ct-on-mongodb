// Release-to-release concept diff.
//
// This used to load both releases in full with `.toArray()` and build a Map of
// whole documents per side. On a ~550K-concept collection that meant roughly
// 1.1M documents held in Node memory per invocation. It now streams both
// cursors and keeps only the four comparison fields for the older release, so
// peak memory scales with the concept count rather than the document size, and
// the newer release is never materialised at all.
//
// Assumes one document per concept per release, which is the canonical
// collection's documented shape. Where a duplicate conceptId does occur, the
// first document in scan order wins — the previous implementation kept the last
// because it built a Map from a fully materialised array. Duplicates are never
// counted twice, so the totals stay internally consistent either way.

const DIFF_PROJECTION = {
  _id: 0,
  conceptId: 1,
  active: 1,
  definitionStatusId: 1,
  moduleId: 1,
  effectiveTime: 1
};

function normalize(value) {
  return String(value || "").trim();
}

function normalizeActive(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "TRUE" || value === "True";
}

export function describeChange(fromDoc, toDoc) {
  const changes = [];
  if (normalizeActive(fromDoc?.active) !== normalizeActive(toDoc?.active)) changes.push("active");
  if (normalize(fromDoc?.definitionStatusId) !== normalize(toDoc?.definitionStatusId)) changes.push("definitionStatus");
  if (normalize(fromDoc?.moduleId) !== normalize(toDoc?.moduleId)) changes.push("module");
  return changes;
}

export function sortReleaseIds(values) {
  return values
    .map(normalize)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
}

// Marks a concept from the older release that the newer release has already
// accounted for, so a duplicate document cannot be counted as a second match.
const MATCHED = Symbol("matched");

function describeSide(doc) {
  return {
    active: normalizeActive(doc?.active),
    definitionStatusId: normalize(doc?.definitionStatusId) || null,
    moduleId: normalize(doc?.moduleId) || null,
    effectiveTime: doc?.effectiveTime || null
  };
}

export async function diffReleases(source, { fromReleaseId, toReleaseId, limit }) {
  // Only the comparison fields are retained, keyed by conceptId.
  const fromById = new Map();
  let fromConcepts = 0;

  for await (const doc of source.find({ releaseId: fromReleaseId }, { projection: DIFF_PROJECTION })) {
    fromConcepts += 1;
    fromById.set(normalize(doc.conceptId), doc);
  }

  const added = [];
  const changed = [];
  // Bounded by the number of concepts new to the newer release, which is a small
  // fraction of a release. Keeps `added` a distinct-concept count if the newer
  // release happens to repeat a conceptId.
  const addedIds = new Set();
  let carriedCount = 0;
  let changedCount = 0;
  let matchedCount = 0;
  let toConcepts = 0;

  for await (const doc of source.find({ releaseId: toReleaseId }, { projection: DIFF_PROJECTION })) {
    toConcepts += 1;
    const conceptId = normalize(doc.conceptId);

    if (!fromById.has(conceptId)) {
      if (addedIds.has(conceptId)) continue;
      addedIds.add(conceptId);
      if (added.length < limit) {
        added.push({
          conceptId,
          active: normalizeActive(doc.active),
          effectiveTime: doc.effectiveTime || null
        });
      }
      continue;
    }

    const fromDoc = fromById.get(conceptId);
    if (fromDoc === MATCHED) {
      // Duplicate document for a concept this release has already accounted for.
      continue;
    }

    carriedCount += 1;
    matchedCount += 1;
    fromById.set(conceptId, MATCHED);

    const changes = describeChange(fromDoc, doc);
    if (changes.length > 0) {
      changedCount += 1;
      if (changed.length < limit) {
        changed.push({
          conceptId,
          changes,
          from: describeSide(fromDoc),
          to: describeSide(doc)
        });
      }
    }
  }

  // Anything the newer release never matched is retired.
  const retired = [];
  for (const [conceptId, fromDoc] of fromById) {
    if (fromDoc === MATCHED) continue;
    if (retired.length >= limit) break;
    retired.push({
      conceptId,
      active: normalizeActive(fromDoc.active),
      effectiveTime: fromDoc.effectiveTime || null
    });
  }

  return {
    counts: {
      fromConcepts,
      toConcepts,
      carried: carriedCount,
      added: addedIds.size,
      retired: fromById.size - matchedCount,
      changed: changedCount
    },
    samples: {
      added,
      retired,
      changed
    }
  };
}
