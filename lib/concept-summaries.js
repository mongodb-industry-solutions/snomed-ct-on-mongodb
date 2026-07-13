function normalize(value) {
  return String(value || "").trim();
}

export function normalizeConceptIds(values) {
  const set = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalize(value);
    if (normalized) {
      set.add(normalized);
    }
  }
  return Array.from(set);
}

function normalizeActive(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "TRUE";
}

function parseSemanticTag(term) {
  const normalizedTerm = normalize(term);
  const match = normalizedTerm.match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : null;
}

function descriptionScore(desc, languageCode) {
  if (!desc || !normalizeActive(desc.active)) {
    return -1;
  }

  const typeId = normalize(desc.typeId);
  const language = normalize(desc.languageCode).toLowerCase();
  const target = normalize(languageCode).toLowerCase();

  let score = 0;
  if (language === target) score += 20;
  if (typeId === "900000000000013009") score += 10; // Synonym
  if (typeId === "900000000000003001") score += 8; // FSN
  if (desc.acceptabilityMap && Object.keys(desc.acceptabilityMap).length > 0) score += 2;
  return score;
}

function pickSemanticTag(descriptions, displayTerm) {
  const fsnCandidates = descriptions
    .filter((desc) => normalize(desc?.typeId) === "900000000000003001")
    .sort((a, b) => (normalizeActive(b?.active) ? 1 : 0) - (normalizeActive(a?.active) ? 1 : 0));

  for (const desc of fsnCandidates) {
    const tag = parseSemanticTag(normalize(desc.term));
    if (tag) return tag;
  }
  return parseSemanticTag(displayTerm);
}

export function pickPreferredTerm(conceptDoc, languageCode = "en") {
  const descriptions = Array.isArray(conceptDoc?.descriptions) ? conceptDoc.descriptions : [];
  let best = null;
  let bestScore = -1;

  for (const desc of descriptions) {
    const score = descriptionScore(desc, languageCode);
    if (score > bestScore) {
      best = desc;
      bestScore = score;
    }
  }

  if (!best) {
    const firstTerm = descriptions.find((desc) => normalize(desc?.term));
    const fallback = normalize(firstTerm?.term) || normalize(conceptDoc?.conceptId);
    return {
      term: fallback,
      semanticTag: pickSemanticTag(descriptions, fallback)
    };
  }

  const term = normalize(best.term) || normalize(conceptDoc?.conceptId);
  return {
    term,
    semanticTag: pickSemanticTag(descriptions, term)
  };
}

async function fetchSummariesByFilter(sourceCollection, filter, projection, useHint = false) {
  if (useHint) {
    return sourceCollection.find(filter, { projection, hint: "release_concept" }).toArray();
  }
  return sourceCollection.find(filter, { projection }).toArray();
}

export async function fetchConceptSummaries({
  sourceCollection,
  conceptIds,
  languageCode = "en",
  releaseId
}) {
  const normalizedIds = normalizeConceptIds(conceptIds);
  if (normalizedIds.length === 0) {
    return [];
  }

  const projection = {
    _id: 0,
    conceptId: 1,
    active: 1,
    effectiveTime: 1,
    releaseId: 1,
    descriptions: 1,
    inferredAncestorIds: 1
  };

  const normalizedReleaseId = normalize(releaseId);

  let docs = [];
  if (normalizedReleaseId) {
    docs = await fetchSummariesByFilter(
      sourceCollection,
      { releaseId: normalizedReleaseId, conceptId: { $in: normalizedIds } },
      projection,
      true
    );

    if (docs.length === 0) {
      docs = await fetchSummariesByFilter(
        sourceCollection,
        { conceptId: { $in: normalizedIds } },
        projection,
        false
      );
    }
  } else {
    docs = await fetchSummariesByFilter(
      sourceCollection,
      { conceptId: { $in: normalizedIds } },
      projection,
      false
    );
  }

  const byId = new Map();
  for (const doc of docs) {
    const conceptId = normalize(doc.conceptId);
    if (!conceptId) continue;

    const preferred = pickPreferredTerm(doc, languageCode);
    const inferredAncestorIds = Array.isArray(doc.inferredAncestorIds)
      ? doc.inferredAncestorIds.map((value) => normalize(value)).filter(Boolean)
      : [];
    const ancestorIds = Array.from(new Set([conceptId, ...inferredAncestorIds]));
    byId.set(conceptId, {
      conceptId,
      term: preferred.term,
      semanticTag: preferred.semanticTag,
      active: normalizeActive(doc.active),
      effectiveTime: normalize(doc.effectiveTime) || null,
      releaseId: normalize(doc.releaseId) || null,
      ancestorIds
    });
  }

  return normalizedIds.map((conceptId) =>
    byId.get(conceptId) || {
      conceptId,
      term: conceptId,
      semanticTag: null,
      active: null,
      effectiveTime: null,
      releaseId: null,
      ancestorIds: [conceptId]
    }
  );
}
