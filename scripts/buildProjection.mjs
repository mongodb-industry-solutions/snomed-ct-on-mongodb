import "./loadEnv.mjs";
import { MongoClient, ServerApiVersion } from "mongodb";

// SNOMED model/metadata and non-clinical structural semantic tags to exclude from
// the search projection (EN + ES surface forms). Kept in sync with the runtime
// query filter in lib/pipelines.js (EXCLUDED_SEMANTIC_TAGS).
const EXCLUDED_SEMANTIC_TAGS = new Set([
  "attribute", "atributo",
  "foundation metadata concept", "metadato fundacional",
  "core metadata concept", "metadato del núcleo",
  "owl metadata concept", "concepto de metadatos de owl",
  "namespace concept", "espacio de nombres",
  "link assertion", "relación asertiva",
  "linkage concept", "concepto de enlace",
  "navigational concept", "concepto para navegación",
  "special concept", "concepto especial",
  "metadata", "metadato",
  "foundational metadata",
  "snomed rt+ctv3"
]);

function env(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function envBoolean(name, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return raw.toLowerCase() === "true";
}

function envNumber(name, fallback, min, max) {
  const parsed = Number(env(name, String(fallback)));
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(safe, min), max);
}

function envList(name) {
  return env(name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const ACTIVE_VALUES = new Set([true, 1, "1", "true", "TRUE", "True"]);
const PREFERRED_ACCEPTABILITY_ID = "900000000000548007";
const TYPE_FSN = "900000000000003001";
const TYPE_SYNONYM = "900000000000013009";

const DEFAULT_TOP_ROOT_IDS = [
  "123037004",
  "404684003",
  "71388002",
  "373873005",
  "272379006",
  "243796009",
  "260787004",
  "78621006",
  "362981000"
];

const ROOT_AREA_TAGS = {
  "123037004": "body-structure",
  "404684003": "clinical-finding",
  "71388002": "procedure",
  "373873005": "product",
  "272379006": "event",
  "243796009": "situation",
  "260787004": "physical-object",
  "78621006": "observable",
  "362981000": "qualifier"
};

const DEFAULT_EMBED_ELIGIBLE_ANCESTOR_IDS = [
  "404684003",
  "71388002",
  "363787002",
  "123037004",
  "373873005"
];
const DEFAULT_SNOMED_RELEASE_ID = "20260601";

function normalizeActive(value) {
  return ACTIVE_VALUES.has(value);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSemanticTag(value) {
  const term = String(value || "");
  const match = term.match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : null;
}

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, "-");
}

function parseReleaseDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function idLookupValues(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return [];

  const values = [normalized];
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && String(numeric) === normalized) {
    values.push(numeric);
  }
  return values;
}

function isPreferredDescription(description) {
  const map = description?.acceptabilityMap;
  if (!map || typeof map !== "object") return false;
  return Object.values(map).some((value) => String(value) === PREFERRED_ACCEPTABILITY_ID);
}

function sortDescriptions(a, b) {
  if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
  if (a.term.length !== b.term.length) return a.term.length - b.term.length;
  return a.term.localeCompare(b.term);
}

function compactDescription(description) {
  const term = String(description?.term || "").trim();
  if (!term) return null;

  const acceptabilityMap = description?.acceptabilityMap && typeof description.acceptabilityMap === "object"
    ? description.acceptabilityMap
    : {};

  return {
    descriptionId: String(description?.descriptionId || description?.id || "").trim(),
    term,
    normalized: normalizeText(term),
    preferred: isPreferredDescription(description),
    typeId: String(description?.typeId || ""),
    acceptabilityMap,
    acceptabilityIds: Array.from(new Set(Object.values(acceptabilityMap).map((value) => String(value)).filter(Boolean))),
    languageRefsetIds: Object.keys(acceptabilityMap).map((value) => String(value)).filter(Boolean),
    caseSignificanceId: String(description?.caseSignificanceId || "")
  };
}

function termTypeOf(typeId) {
  if (String(typeId || "") === TYPE_FSN) return "fsn";
  if (String(typeId || "") === TYPE_SYNONYM) return "synonym";
  return "description";
}

function projectionDocId({ releaseId, conceptId, description, languageCode, index }) {
  const descriptionId = String(description?.descriptionId || "").trim();
  if (descriptionId) {
    return `${releaseId}|${conceptId}|${descriptionId}|${languageCode}`;
  }
  return `${releaseId}|${conceptId}|${languageCode}|${index}|${description.normalized}`;
}

function buildLanguageProjections({ concept, languageCode, releaseId, maxSynonyms, topRootIds, embedEligibleAncestorIds }) {
  const descriptions = Array.isArray(concept?.descriptions) ? concept.descriptions : [];
  const filtered = descriptions
    .filter((desc) => normalizeActive(desc?.active) && String(desc?.languageCode || "").toLowerCase() === languageCode)
    .map(compactDescription)
    .filter(Boolean);

  if (filtered.length === 0) return [];

  const fsnCandidates = filtered.filter((desc) => desc.typeId === TYPE_FSN).sort(sortDescriptions);
  const synonymCandidates = filtered.filter((desc) => desc.typeId === TYPE_SYNONYM).sort(sortDescriptions);
  const allSorted = filtered.slice().sort(sortDescriptions);

  const preferredCandidate = synonymCandidates[0] || fsnCandidates[0] || allSorted[0] || null;
  const fsnCandidate = fsnCandidates[0] || preferredCandidate;
  const displayTerm = preferredCandidate?.term || String(concept?.conceptId || "").trim();
  const fsn = fsnCandidate?.term || displayTerm;
  const normalizedDisplay = normalizeText(displayTerm);
  const normalizedFsn = normalizeText(fsn);

  const dedupeSynonyms = new Set();
  const synonyms = [];
  for (const candidate of synonymCandidates) {
    const normalized = candidate.normalized || normalizeText(candidate.term);
    if (!normalized || normalized === normalizedDisplay || normalized === normalizedFsn || dedupeSynonyms.has(normalized)) {
      continue;
    }
    dedupeSynonyms.add(normalized);
    synonyms.push(candidate.term);
    if (synonyms.length >= maxSynonyms) break;
  }

  const inferredAncestorIds = Array.isArray(concept?.inferredAncestorIds)
    ? concept.inferredAncestorIds.map((value) => String(value)).filter(Boolean)
    : [];

  const rootSet = new Set(topRootIds);
  const topRoots = Array.from(new Set(inferredAncestorIds.filter((id) => rootSet.has(id)))).slice(0, 12);

  const semanticTag = parseSemanticTag(fsnCandidate?.term || displayTerm) || null;
  const semanticTagKey = semanticTag ? slugify(semanticTag) : "";
  const semanticArea = semanticTagKey;
  const areaTags = Array.from(
    new Set([
      ...topRoots.map((id) => ROOT_AREA_TAGS[id]).filter(Boolean),
      ...(semanticArea ? [semanticArea] : [])
    ])
  ).slice(0, 12);

  const distinctEmbedSynonyms = synonyms.slice(0, 3);
  const eligibleSet = new Set(embedEligibleAncestorIds || []);
  const embedText = inferredAncestorIds.some((id) => eligibleSet.has(id))
    ? [displayTerm, fsn, ...distinctEmbedSynonyms].filter(Boolean).join(" | ")
    : "";

  const conceptId = String(concept?.conceptId || "").trim();
  if (!conceptId) return [];

  // Skip SNOMED model/metadata and non-clinical structural concepts so they never
  // enter the search projection. Keeps the runtime query filter and the build in
  // sync (EN + ES surface forms).
  if (semanticTag && EXCLUDED_SEMANTIC_TAGS.has(semanticTag.toLowerCase())) {
    return [];
  }

  const parentIds = Array.isArray(concept?.inferredParentIds)
    ? concept.inferredParentIds.map((value) => String(value)).filter(Boolean)
    : [];
  const conceptActive = normalizeActive(concept?.active);
  const definitionStatusId = String(concept?.definitionStatusId || "");
  const moduleId = String(concept?.moduleId || "");
  const effectiveTime = String(concept?.effectiveTime || "");
  const releaseDate = parseReleaseDate(releaseId);

  return allSorted.map((description, index) => {
    const term = description.term;
    const normalizedTerm = description.normalized || normalizeText(term);
    const termType = termTypeOf(description.typeId);
    const descriptionEmbedText = inferredAncestorIds.some((id) => eligibleSet.has(id))
      ? [term, displayTerm, fsn, semanticTag].filter(Boolean).join(" | ")
      : embedText;

    const doc = {
      _id: projectionDocId({ releaseId, conceptId, description, languageCode, index }),
      releaseId,
      releaseDate,
      conceptId,
      descriptionId: description.descriptionId || null,
      languageCode,
      active: true,
      conceptActive,
      term,
      matchedTerm: term,
      displayTerm: term,
      preferredTerm: displayTerm,
      fsn,
      normalizedTerm,
      normalizedDisplay: normalizedTerm,
      termType,
      typeId: description.typeId,
      definitionStatusId,
      moduleId,
      effectiveTime,
      preferred: Boolean(description.preferred),
      isPreferred: Boolean(description.preferred),
      termRank:
        (description.preferred ? 30 : 0) +
        (description.typeId === TYPE_SYNONYM ? 20 : 0) +
        (description.typeId === TYPE_FSN ? 10 : 0) +
        (term.length <= 28 ? 4 : 0),
      parentIds,
      ancestorIds: inferredAncestorIds
    };

    if (description.acceptabilityIds.length > 0) doc.acceptabilityIds = description.acceptabilityIds;
    if (description.languageRefsetIds.length > 0) doc.languageRefsetIds = description.languageRefsetIds;
    if (description.caseSignificanceId) doc.caseSignificanceId = description.caseSignificanceId;
    if (semanticTag) doc.semanticTag = semanticTag;
    if (semanticTagKey) doc.semanticTagKey = semanticTagKey;
    if (synonyms.length > 0) doc.synonyms = synonyms;
    if (topRoots.length > 0) doc.topRoots = topRoots;
    if (areaTags.length > 0) doc.areaTags = areaTags;
    if (descriptionEmbedText) doc.embedText = descriptionEmbedText;

    return doc;
  });
}

function relationFields(relation) {
  switch (relation) {
    case "ancestors":
      return ["inferredAncestorIds", "inferredParentIds"];
    case "children":
      return ["inferredChildIds"];
    case "parents":
      return ["inferredParentIds"];
    case "self":
      return [];
    case "descendants":
    default:
      return ["inferredChildIds"];
  }
}

async function resolveScopedConceptIds({ source, areaConceptId, areaRelation, includeRoot, maxConceptIds, releaseId, includeAllReleases = false }) {
  if (!areaConceptId) return null;

  const normalizedAreaConceptId = String(areaConceptId || "").trim();
  const rootFilter = { conceptId: { $in: idLookupValues(normalizedAreaConceptId) } };
  if (!includeAllReleases && releaseId) {
    rootFilter.releaseId = releaseId;
  }

  const root = await source.findOne(
    rootFilter,
    {
      projection: {
        _id: 0,
        conceptId: 1,
        inferredAncestorIds: 1,
        inferredParentIds: 1,
        inferredChildIds: 1
      }
    }
  );

  if (!root) {
    const releaseExamples = await source
      .find(
        { conceptId: { $in: idLookupValues(normalizedAreaConceptId) } },
        { projection: { _id: 0, releaseId: 1, effectiveTime: 1 } }
      )
      .limit(5)
      .toArray();
    const availableReleases = Array.from(
      new Set(releaseExamples.map((doc) => String(doc?.releaseId || doc?.effectiveTime || "").trim()).filter(Boolean))
    );
    const releaseScope = !includeAllReleases && releaseId ? ` for releaseId '${releaseId}'` : "";
    const releaseHint = availableReleases.length > 0
      ? ` Available release values for this concept: ${availableReleases.join(", ")}. Set SNOMED_RELEASE_ID to the stamped release.`
      : "";
    throw new Error(`Area concept ${areaConceptId} was not found${releaseScope} in source collection.${releaseHint}`);
  }

  if (areaRelation === "descendants") {
    const set = new Set();
    if (includeRoot) set.add(String(root.conceptId || normalizedAreaConceptId));

    const filter = {
      active: { $in: Array.from(ACTIVE_VALUES) },
      inferredAncestorIds: { $in: idLookupValues(normalizedAreaConceptId) }
    };
    if (!includeAllReleases && releaseId) {
      filter.releaseId = releaseId;
    }

    const cursor = source.find(
      filter,
      {
        projection: { _id: 0, conceptId: 1 },
        batchSize: 1000
      }
    );

    for await (const doc of cursor) {
      if (doc?.conceptId == null) continue;
      set.add(String(doc.conceptId));
      if (set.size >= maxConceptIds) {
        return Array.from(set);
      }
    }

    return Array.from(set);
  }

  const set = new Set();
  if (includeRoot) set.add(String(root.conceptId || normalizedAreaConceptId));

  for (const field of relationFields(areaRelation)) {
    const values = root[field];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      set.add(String(value));
      if (set.size >= maxConceptIds) {
        return Array.from(set);
      }
    }
  }

  return Array.from(set);
}

async function resolveMultiAreaConceptIds({
  source,
  areaConceptIds,
  areaRelation,
  includeRoot,
  maxConceptIdsPerArea,
  maxTotalConceptIds,
  releaseId,
  includeAllReleases = false
}) {
  const scope = new Set();
  const summaries = [];

  for (const areaConceptId of areaConceptIds) {
    const areaIds = await resolveScopedConceptIds({
      source,
      areaConceptId,
      areaRelation,
      includeRoot,
      maxConceptIds: maxConceptIdsPerArea,
      releaseId,
      includeAllReleases
    });

    const before = scope.size;
    for (const conceptId of areaIds || []) {
      if (scope.size >= maxTotalConceptIds) break;
      scope.add(String(conceptId));
    }

    summaries.push({
      areaConceptId,
      expandedCount: Array.isArray(areaIds) ? areaIds.length : 0,
      addedCount: scope.size - before
    });

    if (scope.size >= maxTotalConceptIds) break;
  }

  return {
    conceptIds: Array.from(scope),
    summaries,
    truncated: areaConceptIds.length > 0 && scope.size >= maxTotalConceptIds
  };
}

async function embedBatch({ apiKey, model, outputDimension, texts }) {
  const response = await fetch("https://ai.mongodb.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: texts,
      input_type: "document",
      output_dimension: outputDimension,
      truncation: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  return payload?.data?.map((item) => item.embedding) || [];
}

async function run() {
  const uri = env("MONGODB_URI");
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const dbName = env("MONGODB_DB", "terminology");
  const sourceCollectionName = env("MONGODB_COLLECTION", "snomed-irbd");
  const projectionCollectionName = env("MONGODB_TERM_SEARCH_COLLECTION", "snomed-term-search");
  const vectorPath = env("MONGODB_MANUAL_VECTOR_PATH", env("ATLAS_MANUAL_VECTOR_PATH", "embedding_voyage_4_lite_256"));

  const projectionBuildEnabled = envBoolean("PROJECTION_BUILD_ENABLED", true);
  const projectionResetBeforeBuild = envBoolean("PROJECTION_RESET_BEFORE_BUILD", true);
  const projectionLanguageCodes = envList("PROJECTION_LANGUAGE_CODES");
  const projectionReleaseId = env("SNOMED_RELEASE_ID", DEFAULT_SNOMED_RELEASE_ID);
  const projectionIncludeAllReleases = envBoolean("PROJECTION_INCLUDE_ALL_RELEASES", false);
  const projectionTopRootIds = envList("PROJECTION_TOP_ROOT_IDS");
  const projectionConceptIds = envList("PROJECTION_CONCEPT_IDS");
  const projectionAreaConceptId = env("PROJECTION_AREA_CONCEPT_ID");
  const projectionAreaConceptIds = Array.from(new Set([
    ...envList("PROJECTION_AREA_CONCEPT_IDS"),
    ...(projectionAreaConceptId ? [projectionAreaConceptId] : [])
  ]));
  const projectionAreaRelation = env("PROJECTION_AREA_RELATION", "descendants");
  const projectionIncludeRoot = envBoolean("PROJECTION_INCLUDE_ROOT", true);
  const projectionMaxConceptIds = envNumber("PROJECTION_MAX_CONCEPT_IDS", 5000, 1, 250000);
  const projectionMaxTotalConceptIds = envNumber("PROJECTION_MAX_TOTAL_CONCEPT_IDS", 25000, 1, 250000);
  const projectionClearTermDocs = envBoolean("PROJECTION_CLEAR_TERM_DOCS", false);
  const projectionReplaceReleaseDocs = envBoolean("PROJECTION_REPLACE_RELEASE_DOCS", false);
  const maxSynonyms = envNumber("PROJECTION_MAX_SYNONYMS", 10, 3, 50);
  const writeBatchSize = envNumber("PROJECTION_WRITE_BATCH_SIZE", 1000, 100, 5000);

  const embedEnabled = envBoolean("EMBED_ENABLED", false);
  const embedDryRun = envBoolean("EMBED_DRY_RUN", true);
  const embedAreaConceptId = env("EMBED_AREA_CONCEPT_ID");
  const embedEligibleAncestorIds = envList("EMBED_ELIGIBLE_ANCESTOR_IDS");
  const embedAreaRelation = env("EMBED_AREA_RELATION", "descendants");
  const embedIncludeRoot = envBoolean("EMBED_INCLUDE_ROOT", true);
  const embedMaxConceptIds = envNumber("EMBED_MAX_CONCEPT_IDS", 3000, 1, 50000);
  const embedLanguageCodes = envList("EMBED_LANGUAGE_CODES");
  const voyageApiKey = env("VOYAGE_API_KEY");
  const voyageModel = env("VOYAGE_MODEL", "voyage-4-lite");
  const voyageOutputDimension = envNumber("VOYAGE_OUTPUT_DIMENSION", 256, 1, 3072);
  const vectorBatchSize = envNumber("VECTOR_BATCH_SIZE", 8, 1, 128);
  const maxVectorDocs = envNumber("MAX_VECTOR_DOCS", 300, 0, 5000000);

  const languageCodes = projectionLanguageCodes.length > 0 ? projectionLanguageCodes.map((code) => code.toLowerCase()) : ["en", "es"];
  const topRootIds = projectionTopRootIds.length > 0 ? projectionTopRootIds : DEFAULT_TOP_ROOT_IDS;
  const eligibleEmbedAncestorIds = embedEligibleAncestorIds.length > 0 ? embedEligibleAncestorIds : DEFAULT_EMBED_ELIGIBLE_ANCESTOR_IDS;

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

    if (projectionBuildEnabled) {
      console.log(`[1/3] Building term-level search projection ${dbName}.${projectionCollectionName}`);
      console.log(`Languages: ${languageCodes.join(", ")}`);
      console.log(`Top roots: ${topRootIds.join(", ")}`);
      console.log(`Max synonyms per concept-language doc: ${maxSynonyms}`);

      if (projectionResetBeforeBuild) {
        try {
          await projection.drop();
          console.log("Dropped existing projection collection for deterministic rebuild.");
        } catch (error) {
          if (error?.code !== 26 && error?.codeName !== "NamespaceNotFound") {
            throw error;
          }
        }
      }

      const hasReleaseId = await source.findOne({ releaseId: { $exists: true } }, { projection: { _id: 1 } }).then(Boolean);
      const sourceFilter = { active: { $in: Array.from(ACTIVE_VALUES) } };
      if (!projectionIncludeAllReleases && hasReleaseId) {
        sourceFilter.releaseId = projectionReleaseId;
      } else if (!projectionIncludeAllReleases && !hasReleaseId) {
        console.log("releaseId field not found in source docs; building projection from all active concepts.");
      }

      const scopedProjectionConceptIds = new Set(projectionConceptIds.map((id) => String(id)).filter(Boolean));
      if (projectionAreaConceptIds.length > 0) {
        const areaScope = await resolveMultiAreaConceptIds({
          source,
          areaConceptIds: projectionAreaConceptIds,
          areaRelation: projectionAreaRelation,
          includeRoot: projectionIncludeRoot,
          maxConceptIdsPerArea: projectionMaxConceptIds,
          maxTotalConceptIds: projectionMaxTotalConceptIds,
          releaseId: projectionReleaseId,
          includeAllReleases: projectionIncludeAllReleases
        });
        for (const summary of areaScope.summaries) {
          console.log(`Projection branch ${summary.areaConceptId}: ${summary.expandedCount} scoped, ${summary.addedCount} new`);
        }
        if (areaScope.truncated) {
          console.log(`Projection branch scope reached total cap: ${projectionMaxTotalConceptIds} concept ids`);
        }
        for (const conceptId of areaScope.conceptIds || []) {
          scopedProjectionConceptIds.add(String(conceptId));
        }
      }

      if (scopedProjectionConceptIds.size > 0) {
        sourceFilter.conceptId = { $in: Array.from(scopedProjectionConceptIds) };
        console.log(`Projection concept scope: ${scopedProjectionConceptIds.size} concept ids`);
      }

      if (projectionReplaceReleaseDocs && !projectionResetBeforeBuild) {
        const clearFilter = projectionIncludeAllReleases ? {} : { releaseId: projectionReleaseId };
        const cleared = await projection.deleteMany(clearFilter);
        console.log(`Replaced release sidecar docs: ${cleared.deletedCount}`);
      } else if (projectionClearTermDocs && !projectionResetBeforeBuild) {
        const clearFilter = { descriptionId: { $exists: true } };
        if (!projectionIncludeAllReleases && projectionReleaseId) {
          clearFilter.releaseId = projectionReleaseId;
        }
        const cleared = await projection.deleteMany(clearFilter);
        console.log(`Cleared existing term-level sidecar docs: ${cleared.deletedCount}`);
      }

      const cursor = source.find(
        sourceFilter,
        {
          projection: {
            _id: 0,
            conceptId: 1,
            releaseId: 1,
            active: 1,
            definitionStatusId: 1,
            moduleId: 1,
            effectiveTime: 1,
            descriptions: 1,
            inferredParentIds: 1,
            inferredAncestorIds: 1
          },
          batchSize: 500
        }
      );

      let conceptsSeen = 0;
      let docsWritten = 0;
      let batch = [];

      for await (const concept of cursor) {
        conceptsSeen += 1;
        const conceptReleaseId = String(concept?.releaseId || projectionReleaseId || "latest").trim() || "latest";

        for (const languageCode of languageCodes) {
          const projectedDocs = buildLanguageProjections({
            concept,
            languageCode,
            releaseId: conceptReleaseId,
            maxSynonyms,
            topRootIds,
            embedEligibleAncestorIds: eligibleEmbedAncestorIds
          });

          for (const projected of projectedDocs) {
            batch.push({
              replaceOne: {
                filter: { _id: projected._id },
                replacement: projected,
                upsert: true
              }
            });

            if (batch.length >= writeBatchSize) {
              const result = await projection.bulkWrite(batch, { ordered: false });
              docsWritten += (result.upsertedCount || 0) + (result.modifiedCount || 0);
              batch = [];
            }
          }
        }

        if (conceptsSeen % 10000 === 0) {
          console.log(`Processed ${conceptsSeen} concepts...`);
        }
      }

      if (batch.length > 0) {
        const result = await projection.bulkWrite(batch, { ordered: false });
        docsWritten += (result.upsertedCount || 0) + (result.modifiedCount || 0);
      }

      const projectionCount = await projection.estimatedDocumentCount();
      console.log(`Projection build complete. Concepts processed: ${conceptsSeen}. Documents in sidecar: ~${projectionCount}.`);
      if (!projectionIncludeAllReleases) {
        console.log(`Projection release scope: ${projectionReleaseId}`);
      }
      console.log(`Approx bulk upserts/updates applied: ${docsWritten}`);
    } else {
      const projectionCount = await projection.estimatedDocumentCount();
      console.log(`[1/3] PROJECTION_BUILD_ENABLED=false, using existing sidecar (~${projectionCount} docs).`);
    }

    if (!embedEnabled) {
      console.log("[2/3] EMBED_ENABLED=false, skipping embedding generation.");
      console.log("Done.");
      return;
    }

    if (!voyageApiKey && !embedDryRun) {
      throw new Error("VOYAGE_API_KEY is required when EMBED_ENABLED=true and EMBED_DRY_RUN=false");
    }

    const scopedConceptIds = await resolveScopedConceptIds({
      source,
      areaConceptId: embedAreaConceptId,
      areaRelation: embedAreaRelation,
      includeRoot: embedIncludeRoot,
      maxConceptIds: embedMaxConceptIds,
      releaseId: projectionReleaseId,
      includeAllReleases: projectionIncludeAllReleases
    });

    const embedFilter = {
      [vectorPath]: { $exists: false },
      embedText: { $exists: true, $type: "string", $ne: "" }
    };

    if (Array.isArray(scopedConceptIds) && scopedConceptIds.length > 0) {
      embedFilter.conceptId = { $in: scopedConceptIds };
      console.log(`Embedding scope: ${scopedConceptIds.length} concept ids from area ${embedAreaConceptId}`);
    }

    if (embedLanguageCodes.length > 0) {
      embedFilter.languageCode = { $in: embedLanguageCodes.map((code) => code.toLowerCase()) };
    }

    const estimatePipeline = [
      { $match: embedFilter },
      ...(maxVectorDocs > 0 ? [{ $limit: maxVectorDocs }] : []),
      { $project: { charCount: { $strLenCP: "$embedText" } } },
      {
        $group: {
          _id: null,
          docs: { $sum: 1 },
          totalChars: { $sum: "$charCount" }
        }
      }
    ];

    const estimate = await projection.aggregate(estimatePipeline).next();

    const estimatedDocs = estimate?.docs || 0;
    const estimatedTokens = Math.ceil((estimate?.totalChars || 0) / 4);

    console.log(`[2/3] Embedding candidates (capped): docs=${estimatedDocs}, approxTokens=${estimatedTokens}`);

    if (embedDryRun) {
      console.log("EMBED_DRY_RUN=true, no Voyage calls were made.");
      console.log("Done.");
      return;
    }

    const cursorBuilder = projection
      .find(embedFilter, { projection: { _id: 1, embedText: 1 } })
      .sort({ _id: 1 });

    const cursor = maxVectorDocs > 0
      ? cursorBuilder.limit(maxVectorDocs)
      : cursorBuilder;

    let processed = 0;

    while (true) {
      const head = await cursor.next();
      if (!head) break;

      const chunk = [head];
      while (chunk.length < vectorBatchSize) {
        const next = await cursor.next();
        if (!next) break;
        chunk.push(next);
      }

      const texts = chunk.map((doc) => String(doc.embedText || "").slice(0, 4000));
      const vectors = await embedBatch({
        apiKey: voyageApiKey,
        model: voyageModel,
        outputDimension: voyageOutputDimension,
        texts
      });

      const ops = chunk
        .map((doc, idx) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                [vectorPath]: vectors[idx],
                embeddingModel: voyageModel,
                embeddedAt: new Date()
              }
            }
          }
        }))
        .filter((op) => Array.isArray(op.updateOne.update.$set[vectorPath]));

      if (ops.length > 0) {
        await projection.bulkWrite(ops, { ordered: false });
      }

      processed += ops.length;
      console.log(`Embedded ${processed}/${estimatedDocs || "all"}`);
    }

    console.log("[3/3] Embedding generation complete.");
    console.log("Done.");
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
