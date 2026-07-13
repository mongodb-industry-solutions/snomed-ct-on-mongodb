import { buildSearchQueryVariants, normalizeSearchText } from "@/lib/search-normalization";

function escRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ACTIVE_DESC_VALUES = [true, 1, "1", "true", "TRUE", "True"];
const PREFERRED_TYPE_ID = "900000000000013009";

function activeDescriptionsExpression(descriptionsExpr) {
  return {
    $filter: {
      input: { $ifNull: [descriptionsExpr, []] },
      as: "desc",
      cond: { $in: ["$$desc.active", ACTIVE_DESC_VALUES] }
    }
  };
}

function termsForLanguageExpression(activeDescriptionsExpr, languageCode, preferredOnly = false) {
  const condition = preferredOnly
    ? {
        $and: [
          { $eq: ["$$desc.languageCode", languageCode] },
          { $eq: ["$$desc.typeId", PREFERRED_TYPE_ID] }
        ]
      }
    : { $eq: ["$$desc.languageCode", languageCode] };

  return {
    $map: {
      input: {
        $filter: {
          input: activeDescriptionsExpr,
          as: "desc",
          cond: condition
        }
      },
      as: "desc",
      in: "$$desc.term"
    }
  };
}

function firstTermExpression({ languageCode = "es", descriptionsExpr = "$descriptions" } = {}) {
  return {
    $let: {
      vars: {
        activeDescriptions: activeDescriptionsExpression(descriptionsExpr)
      },
      in: {
        $ifNull: [
          { $first: termsForLanguageExpression("$$activeDescriptions", languageCode) },
          { $first: termsForLanguageExpression("$$activeDescriptions", "en") },
          {
            $first: {
              $map: {
                input: "$$activeDescriptions",
                as: "desc",
                in: "$$desc.term"
              }
            }
          }
        ]
      }
    }
  };
}

function preferredTermExpression({ languageCode = "es", descriptionsExpr = "$descriptions" } = {}) {
  return {
    $let: {
      vars: {
        activeDescriptions: activeDescriptionsExpression(descriptionsExpr)
      },
      in: {
        $ifNull: [
          { $first: termsForLanguageExpression("$$activeDescriptions", languageCode, true) },
          { $first: termsForLanguageExpression("$$activeDescriptions", languageCode) },
          { $first: termsForLanguageExpression("$$activeDescriptions", "en", true) },
          { $first: termsForLanguageExpression("$$activeDescriptions", "en") },
          {
            $first: {
              $map: {
                input: "$$activeDescriptions",
                as: "desc",
                in: "$$desc.term"
              }
            }
          }
        ]
      }
    }
  };
}

export function buildMatchPipeline({ query, languageCode, limit }) {
  const safeRegex = escRegex(query.trim());

  return [
    { $match: { active: { $in: [true, 1, "1"] } } },
    { $unwind: "$descriptions" },
    {
      $match: {
        "descriptions.active": { $in: [true, 1, "1"] },
        "descriptions.languageCode": languageCode,
        "descriptions.term": { $regex: safeRegex, $options: "i" }
      }
    },
    {
      $group: {
        _id: "$conceptId",
        matchedDescriptions: { $sum: 1 },
        term: firstTermExpression({ languageCode }),
        memberOfRefsetIds: { $first: "$memberOfRefsetIds" },
        effectiveTime: { $first: "$effectiveTime" }
      }
    },
    {
      $addFields: {
        refsetCount: {
          $size: { $ifNull: ["$memberOfRefsetIds", []] }
        }
      }
    },
    { $sort: { matchedDescriptions: -1, term: 1 } },
    {
      $facet: {
        results: [
          { $limit: limit },
          {
            $project: {
              _id: 0,
              conceptId: "$_id",
              term: 1,
              matchedDescriptions: 1,
              refsetCount: 1,
              effectiveTime: 1
            }
          }
        ],
        stats: [{ $count: "totalHits" }]
      }
    }
  ];
}

export function buildLookupPipeline({ conceptId, limit, collectionName, releaseId, languageCode = "es" }) {
  const releaseMatch = releaseId ? { releaseId } : {};

  return [
    { $match: { conceptId, ...releaseMatch } },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        releaseId: 1,
        relationships: {
          $slice: [{ $ifNull: ["$relationships", []] }, limit]
        }
      }
    },
    { $unwind: "$relationships" },
    {
      $lookup: {
        from: collectionName,
        let: { destinationId: "$relationships.destinationId", releaseId: "$releaseId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$conceptId", "$$destinationId"] },
                  ...(releaseId ? [{ $eq: ["$releaseId", "$$releaseId"] }] : [])
                ]
              }
            }
          },
          {
            $project: {
              _id: 0,
              conceptId: 1,
              term: firstTermExpression({ languageCode })
            }
          },
          { $limit: 1 }
        ],
        as: "destination"
      }
    },
    {
      $lookup: {
        from: collectionName,
        let: { typeId: "$relationships.typeId", releaseId: "$releaseId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$conceptId", "$$typeId"] },
                  ...(releaseId ? [{ $eq: ["$releaseId", "$$releaseId"] }] : [])
                ]
              }
            }
          },
          {
            $project: {
              _id: 0,
              conceptId: 1,
              term: firstTermExpression({ languageCode })
            }
          },
          { $limit: 1 }
        ],
        as: "type"
      }
    },
    {
      $project: {
        sourceId: "$conceptId",
        destinationId: "$relationships.destinationId",
        destinationTerm: { $first: "$destination.term" },
        typeId: "$relationships.typeId",
        typeLabel: { $first: "$type.term" },
        group: "$relationships.relationshipGroup"
      }
    },
    { $limit: limit }
  ];
}

export function buildGraphLookupPipeline({
  conceptId,
  direction,
  maxDepth,
  limit,
  collectionName,
  languageCode = "es",
  releaseId
}) {
  const edgeField = direction === "descendants" ? "inferredChildIds" : "inferredParentIds";
  const releaseMatch = releaseId ? { releaseId } : {};

  return [
    { $match: { conceptId, ...releaseMatch } },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        sourceTerm: firstTermExpression({ languageCode, descriptionsExpr: "$descriptions" }),
        seedNodes: {
          $map: {
            input: { $ifNull: [`$${edgeField}`, []] },
            as: "id",
            in: { $toString: "$$id" }
          }
        }
      }
    },
    {
      $graphLookup: {
        from: collectionName,
        startWith: "$seedNodes",
        connectFromField: edgeField,
        connectToField: "conceptId",
        as: "neighbors",
        maxDepth,
        depthField: "depth",
        restrictSearchWithMatch: {
          ...releaseMatch,
          active: { $in: [true, 1, "1"] }
        }
      }
    },
    {
      $project: {
        conceptId: 1,
        sourceTerm: 1,
        neighbors: {
          $slice: [
            {
              $map: {
                input: "$neighbors",
                as: "n",
                in: {
                  conceptId: "$$n.conceptId",
                  term: firstTermExpression({
                    languageCode,
                    descriptionsExpr: "$$n.descriptions"
                  }),
                  depth: "$$n.depth",
                  effectiveTime: "$$n.effectiveTime",
                  inferredParentIds: {
                    $slice: [
                      {
                        $map: {
                          input: { $ifNull: ["$$n.inferredParentIds", []] },
                          as: "pid",
                          in: { $toString: "$$pid" }
                        }
                      },
                      24
                    ]
                  },
                  inferredChildIds: {
                    $slice: [
                      {
                        $map: {
                          input: { $ifNull: ["$$n.inferredChildIds", []] },
                          as: "cid",
                          in: { $toString: "$$cid" }
                        }
                      },
                      24
                    ]
                  }
                }
              }
            },
            limit
          ]
        }
      }
    }
  ];
}

export function buildMongoSearchPipeline({ query, limit, indexName, releaseId, languageCode }) {
  const filters = [{ equals: { path: "active", value: true } }];
  if (languageCode) {
    filters.push({ in: { path: "languageCode", value: [languageCode] } });
  }
  if (releaseId) {
    filters.push({ in: { path: "releaseId", value: [releaseId] } });
  }

  return [
    {
      $search: {
        index: indexName,
        compound: {
          must: [
            {
              text: {
                query,
                path: ["displayTerm", "fsn", "conceptId"]
              }
            }
          ],
          filter: filters
        }
      }
    },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        descriptionId: 1,
        term: { $ifNull: ["$term", "$displayTerm"] },
        matchedTerm: { $ifNull: ["$matchedTerm", { $ifNull: ["$term", "$displayTerm"] }] },
        displayTerm: 1,
        preferredTerm: { $ifNull: ["$preferredTerm", "$displayTerm"] },
        fsn: 1,
        languageCode: 1,
        semanticTag: 1,
        termType: 1,
        score: { $meta: "searchScore" }
      }
    },
    { $limit: limit }
  ];
}

export function buildVectorSearchPipeline({
  query,
  queryVector,
  limit,
  indexName,
  vectorPath,
  vectorMode = "manual",
  vectorModel,
  filter
}) {
  const usesAutoEmbedding = String(vectorMode || "").toLowerCase() === "autoembed";
  return [
    {
      $vectorSearch: {
        index: indexName,
        path: vectorPath,
        ...(usesAutoEmbedding
          ? {
              query,
              ...(vectorModel ? { model: vectorModel } : {})
            }
          : { queryVector }),
        ...((filter && typeof filter === "object") ? { filter } : {}),
        numCandidates: Math.max(limit * 25, 200),
        limit
      }
    },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        descriptionId: 1,
        term: { $ifNull: ["$term", "$displayTerm"] },
        matchedTerm: { $ifNull: ["$matchedTerm", { $ifNull: ["$term", "$displayTerm"] }] },
        displayTerm: 1,
        preferredTerm: { $ifNull: ["$preferredTerm", "$displayTerm"] },
        fsn: 1,
        languageCode: 1,
        semanticTag: 1,
        termType: 1,
        topRoots: 1,
        areaTags: 1,
        score: { $meta: "vectorSearchScore" }
      }
    }
  ];
}

// SNOMED model/metadata and non-clinical structural tags that should never
// surface in clinical search, note grounding, or grounded-note corpus queries. Excluded at
// query time (semanticTag is a token field in the MongoDB Search index), so no
// reindex is required. EN + ES surface forms are both listed because the
// projection stores the tag in the document's own language.
export const EXCLUDED_SEMANTIC_TAGS = [
  "attribute", "atributo",
  "foundation metadata concept", "metadato fundacional",
  "core metadata concept", "metadato del núcleo",
  "OWL metadata concept", "concepto de metadatos de OWL",
  "namespace concept", "espacio de nombres",
  "link assertion", "relación asertiva",
  "linkage concept", "concepto de enlace",
  "navigational concept", "concepto para navegación",
  "special concept", "concepto especial",
  "metadata", "metadato",
  "foundational metadata",
  "SNOMED RT+CTV3"
];

function buildNavigatorFilters({
  languageCode,
  releaseId,
  areaConceptId,
  conceptIdScope
}) {
  const filters = [{ equals: { path: "active", value: true } }];

  // Drop model/metadata and non-clinical structural concepts from every search.
  filters.push({
    compound: {
      mustNot: [{ in: { path: "semanticTag", value: EXCLUDED_SEMANTIC_TAGS } }]
    }
  });

  if (languageCode) {
    filters.push({ in: { path: "languageCode", value: [languageCode] } });
  }
  if (releaseId) {
    filters.push({ in: { path: "releaseId", value: [releaseId] } });
  }
  const hasExpandedScope = Array.isArray(conceptIdScope) && conceptIdScope.length > 0;
  if (areaConceptId && !hasExpandedScope) {
    filters.push({
      compound: {
        should: [
          { in: { path: "topRoots", value: [areaConceptId] } },
          { in: { path: "areaTags", value: [areaConceptId] } },
          { in: { path: "conceptId", value: [areaConceptId] } }
        ],
        minimumShouldMatch: 1
      }
    });
  }
  if (hasExpandedScope) {
    filters.push({ in: { path: "conceptId", value: conceptIdScope } });
  }

  return filters;
}

export function buildNavigatorVectorFilter({
  languageCode,
  releaseId,
  conceptIdScope
}) {
  return {
    ...(languageCode ? { languageCode } : {}),
    ...(releaseId ? { releaseId } : {}),
    ...(Array.isArray(conceptIdScope) && conceptIdScope.length > 0 ? { conceptId: { $in: conceptIdScope } } : {}),
    semanticTag: { $nin: EXCLUDED_SEMANTIC_TAGS }
  };
}

function buildAutocompleteClause({ query, path, boost, fuzzy }) {
  return {
    autocomplete: {
      query,
      path,
      tokenOrder: "sequential",
      ...(fuzzy ? { fuzzy } : {}),
      score: { boost: { value: boost } }
    }
  };
}

function buildNavigatorSearchClauses(normalizedQuery) {
  const phraseQueries = buildSearchQueryVariants(normalizedQuery);
  const tokenTerms = phraseQueries
    .flatMap((phrase) => normalizeSearchText(phrase).split(/\s+/))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const textQueries = Array.from(new Set([normalizedQuery, ...phraseQueries, ...tokenTerms])).slice(0, 6);
  const should = [];
  const queryLength = normalizedQuery.length;

  if (!normalizedQuery) {
    return { should };
  }

  if (queryLength <= 2) {
    should.push(
      buildAutocompleteClause({
        query: normalizedQuery,
        path: "normalizedDisplay",
        boost: 11
      })
    );
    return { should };
  }

  if (queryLength === 3) {
    should.push(
      buildAutocompleteClause({
        query: normalizedQuery,
        path: "normalizedDisplay",
        boost: 10,
        fuzzy: {
          maxEdits: 1,
          prefixLength: 2
        }
      })
    );
    return { should };
  }

  // Sequential autocomplete. Fuzzy edge-gram matching across multiple tokens is
  // costly and rarely needed once a query has several words, so keep typo
  // tolerance only for single-token queries.
  const isMultiWord = normalizedQuery.trim().split(/\s+/).length > 1;
  should.push(
    buildAutocompleteClause({
      query: normalizedQuery,
      path: "normalizedDisplay",
      boost: 9,
      ...(isMultiWord ? {} : { fuzzy: { maxEdits: 1, prefixLength: 2 } })
    })
  );

  // Exact-phrase boosts on the two highest-value paths. The fsn path is dropped
  // and variants capped at 2 to bound clause fan-out on multi-word queries;
  // matches on fsn are still covered by the broad text clause below.
  phraseQueries.slice(0, 2).forEach((phraseQuery, index) => {
    should.push({
      phrase: {
        query: phraseQuery,
        path: "displayTerm",
        slop: 0,
        score: { boost: { value: Math.max(18 - index * 2, 10) } }
      }
    });

    should.push({
      phrase: {
        query: phraseQuery,
        path: "synonyms",
        slop: 0,
        score: { boost: { value: Math.max(15 - index * 2, 8) } }
      }
    });
  });

  // Broad recall booster. Fuzzy expansion across many tokens and three paths is
  // the dominant cost on multi-word queries; typo tolerance is already covered by
  // the fuzzy autocomplete on normalizedDisplay above, so keep this clause exact.
  should.push({
    text: {
      query: textQueries,
      matchCriteria: "any",
      path: ["displayTerm", "fsn", "synonyms"],
      score: { boost: { value: 4 } }
    }
  });

  return { should };
}

export function buildNavigatorSuggestPipeline({
  query,
  limit,
  indexName,
  languageCode,
  releaseId,
  areaConceptId,
  conceptIdScope
}) {
  const normalizedQuery = query.trim();
  const queryVariants = buildSearchQueryVariants(normalizedQuery);
  const isConceptIdQuery = /^\d{4,}$/.test(normalizedQuery);
  const filters = buildNavigatorFilters({
    languageCode,
    releaseId,
    areaConceptId,
    conceptIdScope
  });
  const should = [];
  const queryLength = normalizedQuery.length;

  if (queryLength > 0) {
    if (queryLength <= 2) {
      should.push(
        buildAutocompleteClause({
          query: normalizedQuery,
          path: "normalizedDisplay",
          boost: 11
        })
      );
    } else if (queryLength === 3) {
      should.push(
        buildAutocompleteClause({
          query: normalizedQuery,
          path: "normalizedDisplay",
          boost: 10,
          fuzzy: {
            maxEdits: 1,
            prefixLength: 2
          }
        })
      );
    } else {
      queryVariants.slice(0, 2).forEach((variant, index) => {
        should.push(
          buildAutocompleteClause({
            query: variant,
            path: "normalizedDisplay",
            boost: index === 0 ? 9 : 7,
            fuzzy: {
              maxEdits: 1,
              prefixLength: 2
            }
          })
        );
      });
    }
  }

  if (isConceptIdQuery) {
    should.push({ in: { path: "conceptId", value: [normalizedQuery] } });
  }

  return [
    {
      $search: {
        index: indexName,
        compound: {
          should,
          minimumShouldMatch: 1,
          filter: filters
        }
      }
    },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        descriptionId: 1,
        term: { $ifNull: ["$term", "$displayTerm"] },
        matchedTerm: { $ifNull: ["$matchedTerm", { $ifNull: ["$term", "$displayTerm"] }] },
        displayTerm: 1,
        preferredTerm: { $ifNull: ["$preferredTerm", "$displayTerm"] },
        fsn: 1,
        active: { $ifNull: ["$active", true] },
        languageCode: 1,
        semanticTag: 1,
        termType: 1,
        typeId: 1,
        preferred: { $ifNull: ["$preferred", "$isPreferred"] },
        isPreferred: { $ifNull: ["$isPreferred", false] },
        termRank: { $ifNull: ["$termRank", 0] },
        score: { $meta: "searchScore" }
      }
    },
    {
      $sort: {
        score: -1,
        isPreferred: -1,
        termRank: -1,
        term: 1
      }
    },
    { $limit: limit }
  ];
}

export function buildNavigatorSearchPipeline({
  query,
  limit,
  indexName,
  languageCode,
  releaseId,
  areaConceptId,
  conceptIdScope,
  includeScoreDetails = false
}) {
  const normalizedQuery = query.trim();
  const isConceptIdQuery = /^\d{4,}$/.test(normalizedQuery);
  const filters = buildNavigatorFilters({
    languageCode,
    releaseId,
    areaConceptId,
    conceptIdScope
  });
  const { should } = buildNavigatorSearchClauses(normalizedQuery);

  if (isConceptIdQuery) {
    should.push({ in: { path: "conceptId", value: [normalizedQuery] } });
  }

  return [
    {
      $search: {
        index: indexName,
        ...(includeScoreDetails ? { scoreDetails: true } : {}),
        highlight: {
          path: ["displayTerm", "fsn", "synonyms"]
        },
        compound: {
          should,
          minimumShouldMatch: 1,
          filter: filters
        }
      }
    },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        descriptionId: 1,
        term: { $ifNull: ["$term", "$displayTerm"] },
        matchedTerm: { $ifNull: ["$matchedTerm", { $ifNull: ["$term", "$displayTerm"] }] },
        displayTerm: 1,
        preferredTerm: { $ifNull: ["$preferredTerm", "$displayTerm"] },
        fsn: 1,
        active: { $ifNull: ["$active", true] },
        languageCode: 1,
        semanticTag: 1,
        termType: 1,
        typeId: 1,
        ancestorIds: 1,
        preferred: { $ifNull: ["$preferred", "$isPreferred"] },
        isPreferred: { $ifNull: ["$isPreferred", false] },
        termRank: { $ifNull: ["$termRank", 0] },
        highlights: { $meta: "searchHighlights" },
        score: { $meta: "searchScore" },
        ...(includeScoreDetails ? { scoreDetails: { $meta: "searchScoreDetails" } } : {})
      }
    },
    {
      $sort: {
        score: -1,
        conceptId: 1
      }
    },
    { $limit: limit }
  ];
}

export function buildNativeHybridFusionPipeline({
  query,
  limit,
  candidatePool,
  fusionStage = "rankFusion",
  textIndex,
  vectorIndex,
  vectorPath,
  vectorMode = "manual",
  vectorModel,
  queryVector,
  languageCode,
  releaseId,
  areaConceptId,
  conceptIdScope,
  weights = { lexical: 0.55, semantic: 0.45 }
}) {
  const normalizedQuery = query.trim();
  const isConceptIdQuery = /^\d{4,}$/.test(normalizedQuery);
  const lexicalFilters = buildNavigatorFilters({
    languageCode,
    releaseId,
    areaConceptId,
    conceptIdScope
  });
  const { should } = buildNavigatorSearchClauses(normalizedQuery);

  if (isConceptIdQuery) {
    should.push({ in: { path: "conceptId", value: [normalizedQuery] } });
  }

  const usesAutoEmbedding = String(vectorMode || "").toLowerCase() === "autoembed";
  const semanticFilter = buildNavigatorVectorFilter({
    languageCode,
    releaseId,
    conceptIdScope
  });
  const semanticLimit = Math.max(candidatePool, limit);
  const lexicalPipeline = [
    {
      $search: {
        index: textIndex,
        compound: {
          should,
          minimumShouldMatch: 1,
          filter: lexicalFilters
        }
      }
    },
    { $limit: semanticLimit }
  ];
  const semanticPipeline = [
    {
      $vectorSearch: {
        index: vectorIndex,
        path: vectorPath,
        ...(usesAutoEmbedding
          ? {
              query,
              ...(vectorModel ? { model: vectorModel } : {})
            }
          : { queryVector }),
        filter: semanticFilter,
        numCandidates: Math.max(semanticLimit * 25, 200),
        limit: semanticLimit
      }
    }
  ];

  const useScoreFusion = fusionStage === "scoreFusion";
  const fusionOperator = useScoreFusion ? "$scoreFusion" : "$rankFusion";
  const scoreDetailsMeta = "scoreDetails";
  const fusionBody = useScoreFusion
    ? {
        input: {
          pipelines: {
            lexical: lexicalPipeline,
            semantic: semanticPipeline
          },
          normalization: "sigmoid"
        },
        combination: {
          weights
        },
        scoreDetails: true
      }
    : {
        input: {
          pipelines: {
            lexical: lexicalPipeline,
            semantic: semanticPipeline
          }
        },
        combination: {
          weights
        },
        scoreDetails: true
      };

  return [
    { [fusionOperator]: fusionBody },
    { $addFields: { scoreDetails: { $meta: scoreDetailsMeta } } },
    { $addFields: { fusionScore: { $ifNull: ["$scoreDetails.value", 0] } } },
    {
      $sort: {
        fusionScore: -1,
        isPreferred: -1,
        termRank: -1,
        conceptId: 1,
        descriptionId: 1
      }
    },
    {
      $group: {
        _id: "$conceptId",
        doc: { $first: "$$ROOT" }
      }
    },
    { $replaceRoot: { newRoot: "$doc" } },
    {
      $sort: {
        fusionScore: -1,
        isPreferred: -1,
        termRank: -1,
        conceptId: 1
      }
    },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        descriptionId: 1,
        term: { $ifNull: ["$term", "$displayTerm"] },
        matchedTerm: { $ifNull: ["$matchedTerm", { $ifNull: ["$term", "$displayTerm"] }] },
        displayTerm: 1,
        preferredTerm: { $ifNull: ["$preferredTerm", "$displayTerm"] },
        fsn: 1,
        active: { $ifNull: ["$active", true] },
        languageCode: 1,
        semanticTag: 1,
        termType: 1,
        typeId: 1,
        preferred: { $ifNull: ["$preferred", "$isPreferred"] },
        isPreferred: { $ifNull: ["$isPreferred", false] },
        termRank: { $ifNull: ["$termRank", 0] },
        topRoots: 1,
        areaTags: 1,
        fusionScore: 1,
        scoreDetails: 1
      }
    }
  ];
}

export function buildConcept360Pipeline({
  conceptId,
  childLimit,
  collectionName,
  languageCode = "es",
  releaseId
}) {
  const releaseMatch = releaseId ? { releaseId } : {};
  const termProjection = {
    _id: 0,
    conceptId: 1,
    term: firstTermExpression({ languageCode }),
    effectiveTime: 1,
    releaseId: 1
  };

  return [
    { $match: { conceptId, ...releaseMatch } },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        releaseId: 1,
        effectiveTime: 1,
        moduleId: 1,
        definitionStatusId: 1,
        memberOfRefsetIds: { $slice: [{ $ifNull: ["$memberOfRefsetIds", []] }, 25] },
        descriptions: {
          $slice: [
            {
              $filter: {
                input: { $ifNull: ["$descriptions", []] },
                as: "d",
                cond: { $in: ["$$d.active", ACTIVE_DESC_VALUES] }
              }
            },
            40
          ]
        },
        relationships: { $slice: [{ $ifNull: ["$relationships", []] }, 40] },
        inferredParentIds: { $slice: [{ $ifNull: ["$inferredParentIds", []] }, 20] },
        inferredChildIds: { $slice: [{ $ifNull: ["$inferredChildIds", []] }, childLimit] },
        inferredAncestorIds: { $slice: [{ $ifNull: ["$inferredAncestorIds", []] }, 40] }
      }
    },
    {
      $lookup: {
        from: collectionName,
        let: { parentIds: "$inferredParentIds", releaseId: "$releaseId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$conceptId", "$$parentIds"] },
                  ...(releaseId ? [{ $eq: ["$releaseId", "$$releaseId"] }] : [])
                ]
              }
            }
          },
          { $project: termProjection },
          { $sort: { term: 1 } }
        ],
        as: "parents"
      }
    },
    {
      $lookup: {
        from: collectionName,
        let: { childIds: "$inferredChildIds", releaseId: "$releaseId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$conceptId", "$$childIds"] },
                  ...(releaseId ? [{ $eq: ["$releaseId", "$$releaseId"] }] : [])
                ]
              }
            }
          },
          { $project: termProjection },
          { $sort: { term: 1 } }
        ],
        as: "children"
      }
    },
    {
      $addFields: {
        preferredTerm: preferredTermExpression({ languageCode, descriptionsExpr: "$descriptions" })
      }
    },
    {
      $project: {
        conceptId: 1,
        releaseId: 1,
        preferredTerm: 1,
        effectiveTime: 1,
        moduleId: 1,
        definitionStatusId: 1,
        memberOfRefsetIds: 1,
        descriptionCount: { $size: "$descriptions" },
        relationshipCount: { $size: "$relationships" },
        parentCount: { $size: "$parents" },
        childCount: { $size: "$children" },
        parents: 1,
        children: 1,
        relationshipPreview: {
          $slice: [
            {
              $map: {
                input: "$relationships",
                as: "r",
                in: {
                  destinationId: "$$r.destinationId",
                  typeId: "$$r.typeId",
                  group: "$$r.relationshipGroup"
                }
              }
            },
            25
          ]
        }
      }
    }
  ];
}
