# SNOMED CT Data Model Hardening Plan

This plan consolidates the current model review and the external Claude opinion. The conclusion is that the architecture is directionally strong: one canonical concept collection plus one term-level search sidecar is the right operational shape for this demo. The improvements below harden that model so we can present it as a serious MongoDB blueprint for SNOMED CT navigation, coding search, and grounding support.

## Target Architecture

Keep the current two-model split:

- `snomed_concepts` (`snomed-irbd`): canonical concept documents. One document per SNOMED concept and release, with descriptions, relationships, parents, children, bounded ancestor closure, RF2 provenance, and release metadata.
- `snomed_terms` (`snomed-term-search`): derived term-level sidecar. One document per active description term, language, and release, denormalized for MongoDB Search, MongoDB Vector Search, label lookup, scope filters, and coder-facing search results.

Telemetry and grounded notes remain separate application collections because they are not terminology source data.

## Why This Is The Right MongoDB Shape

MongoDB is strongest here because operational terminology lookup is read-heavy and document-shaped:

- Concept display needs descriptions, relationships, hierarchy neighbors, and provenance together.
- Search results are term-level, not concept-level, so the sidecar should be one document per description term.
- Subsumption and ECL descendant expansion are hot paths; a multikey index over `inferredAncestorIds` turns descendant expansion into a normal indexed query.
- MongoDB Search and MongoDB Vector Search live beside the data, avoiding a separate Elasticsearch plus vector database plus graph database stack.

The model should not pretend to be a description-logic classifier or research graph analytics engine. Its sweet spot is operational coding, navigation, scoped search, grounding candidates, and release-aware terminology APIs.

## Hardening Changes

### 1. Retire `inferredDescendantIds`

`inferredDescendantIds` is an unbounded inverse closure. Root concepts can accumulate hundreds of thousands of descendant IDs and approach MongoDB's 16 MB BSON document limit as releases grow.

Target:

- Do not build new dependencies on `inferredDescendantIds`.
- Remove it from canonical documents with `npm run model:harden` and `NORMALIZE_APPLY=true` only after dry-run review.
- Expand descendants with:

```javascript
db.snomed_concepts.find({
  releaseId: "20260601",
  active: true,
  inferredAncestorIds: "404684003"
})
```

Status in code:

- `scripts/buildProjection.mjs` now resolves branch scopes from `inferredAncestorIds`, not stored descendant arrays.
- `/api/readiness` reports `descendantClosureRetired`.
- The Data Model UI exposes this as "No descendant closure".

### 2. Normalize SCTIDs To Strings

SNOMED CT IDs are identifiers, not quantities. They should be strings everywhere. Mixed numeric/string IDs cause silent query misses, and some SCTIDs exceed safe JavaScript integer precision.

Target:

- `conceptId`, hierarchy arrays, relationship IDs, description IDs, description `conceptId` references, module IDs, definition status IDs, and refset IDs should be strings.
- Query compatibility can temporarily support numeric arrays where legacy source docs exist, but the data model target is string-only.

Status in code:

- The term sidecar already writes IDs as strings.
- `npm run model:harden` dry-runs source normalization, and when applied normalizes core identifiers and removes `inferredDescendantIds`.
- `/api/readiness` reports `sctidStringNormalized`.

### 3. Stamp Real Release Metadata

`releaseId: "latest"` is useful during early demos but weak for release maintenance. Professional terminology work needs a real release identity and a timestamp.

Target fields:

- `releaseId`: official release identifier, for example `20260601`.
- `releaseDate`: machine-queryable date parsed from release ID or `RELEASE_DATE`.
- `releaseAppliedAt`: when the release metadata was applied to the cluster.
- `releaseLabel`: optional human-readable label.

Status in code:

- `scripts/stampReleaseId.mjs` now stamps `releaseId`, `releaseDate`, `releaseAppliedAt`, and `releaseLabel`.
- The broken retired ancestor-index reference was removed.
- `/api/readiness` reports `releaseMetadataReady`.
- The Data Model UI exposes release metadata readiness and shows release timestamps in the example model.
- Runtime defaults now use `20260601` unless overridden with `SNOMED_RELEASE_ID` or `RELEASE_ID_TARGET`.

### 4. Strengthen The Term Sidecar

The sidecar is term-level, not concept-level. Its physical name should remain `snomed-term-search` or equivalent, configured only with `MONGODB_TERM_SEARCH_COLLECTION`.

Target:

- Keep one sidecar, one document per active description term x language x release.
- Add denormalized concept fields needed by search and result cards:
  - `definitionStatusId`
  - `moduleId`
  - `effectiveTime`
  - `releaseDate`
  - `semanticTagKey`
- Add btree lookup indexes for non-Search paths:
  - `{ releaseId: 1, languageCode: 1, conceptId: 1, preferred: -1, termRank: -1 }`
  - `{ releaseId: 1, languageCode: 1, descriptionId: 1 }`
  - `{ releaseId: 1, languageCode: 1, semanticTagKey: 1, termRank: -1 }`

Status in code:

- `scripts/buildProjection.mjs` now emits the new sidecar fields.
- `scripts/buildPlatformIndexes.mjs` builds the sidecar btree indexes and updates MongoDB Search/Vector filter fields.
- `/api/readiness` reports `termSidecarModelReady`.

#### Footprint Discipline

The term sidecar should not be a second canonical concept store. It should contain only fields that support search, filtering, ranking, vector text, or immediate result rendering.

Keep in the sidecar:

- Term identity and result rendering: `_id`, `releaseId`, `conceptId`, `descriptionId`, `languageCode`, `term`, `preferredTerm`, `fsn`, `semanticTag`.
- Search/ranking fields: `normalizedDisplay`, `synonyms`, `preferred`, `termRank`, `termType`, `typeId`, `active`, `conceptActive`.
- Scope/filter fields: `semanticTagKey`, `topRoots`, `areaTags`, and, when arbitrary ancestor filtering is required, `ancestorIds`.
- Release/provenance fields used by filters or result cards: `releaseDate`, `definitionStatusId`, `moduleId`, `effectiveTime`.
- Vector text: `embedText`.

Do not duplicate a nested `concept` snapshot inside each term document. It repeats canonical fields and ancestor arrays already available either at the top level of the sidecar or in `snomed-irbd`. A 2,000-document sample showed an average term document size of about 3.37 KB, with the nested `concept` snapshot averaging about 1.14 KB. Removing it is the clearest low-risk footprint improvement.

Future cleanup candidates, after route compatibility is confirmed:

- Collapse aliases such as `matchedTerm` / `displayTerm` into `term`.
- Collapse `isPreferred` into `preferred`.
- Drop RF2 acceptability details from the sidecar if they are not displayed or filtered; keep them canonical-only.
- Consider an ultra-lean profile that removes full `ancestorIds` from the sidecar and relies on canonical ECL expansion to produce `conceptId` scopes. Keep `ancestorIds` if direct MongoDB Search / Vector Search filtering by arbitrary ancestor is part of the demo story.

### 5. Add Relationship Attribute Keys For Refined ECL

Raw RF2 relationships remain in `relationships[]`, but professional coding often needs attribute-refinement queries such as:

```text
<< 404684003 : 363698007 = << 80891009
```

meaning "clinical findings whose finding site is a heart structure".

Target:

- Add `relationshipAttributeKeys[]` to canonical concept documents.
- Store each active relationship as `typeId|destinationId`, for example `363698007|80891009`.
- Build a multikey index:

```javascript
{ releaseId: 1, relationshipAttributeKeys: 1, active: 1, conceptId: 1 }
```

Status in code:

- `npm run model:harden` now populates `relationshipAttributeKeys`.
- `npm run indexes:build` now creates `release_relationship_attribute_active`.
- `/api/readiness` reports `relationshipAttributeReady`.
- The ECL engine now supports a practical refinement subset:
  - `focus : attribute = target`
  - descendant targets such as `attribute = << target`
  - multiple attributes with `AND` or comma
  - set logic around refined expressions with `AND`, `OR`, and `MINUS`

### 6. Make The Benefits Visible In The Demo

The demo must show why the model is good, not just silently use it.

Status in code:

- Data Model UI now explains bounded ancestor closure and descendant-by-index query.
- Runtime readiness now shows:
  - Projection populated
  - Search index ready
  - Ancestor lookup ready
  - Release metadata
  - Sidecar lookup indexed
  - Attribute ECL indexed
  - No descendant closure
  - SCTIDs as strings
  - Hardened model
  - Architecture ready

## Recommended Execution Order

Run these against a backup or disposable staging copy first.

1. Build indexes:

```bash
npm run indexes:build
```

2. Dry-run source model normalization:

```bash
npm run model:harden
```

3. If the dry-run counters are expected, apply source hardening:

```bash
NORMALIZE_APPLY=true npm run model:harden
```

4. Build or refresh indexes:

```bash
npm run indexes:build
```

5. Stamp real release metadata. For the Spain extension release in the current workspace, a plausible target is `20260601`; confirm the exact edition/version policy before running:

```bash
RELEASE_ID_TARGET=20260601 RELEASE_ID_OVERWRITE=true npm run releaseid:stamp
```

6. Rebuild the term sidecar for the demo scope or full scope:

```bash
SNOMED_RELEASE_ID=20260601 TERM_PROJECTION_SCOPE=demo TERM_PROJECTION_REPLACE_RELEASE=true npm run terms:rebuild
```

7. Re-check the app:

```bash
npm run build
```

Then open the Data Model panel and run "Check readiness".

## Comparison Positioning

### MongoDB Strengths

- One concept document gives fast display with no RF2 join fan-out.
- `inferredAncestorIds` is a closure-table equivalent with a multikey index.
- Term-level sidecar matches how humans search: terms, synonyms, languages, FSNs.
- MongoDB Search and Vector Search avoid extra operational systems.
- Aggregation supports facets, diagnostics, release checks, and model readiness.

### MongoDB Weaknesses

- Derived sidecar and closure arrays require rebuild discipline per release.
- It is not a DL classifier and should not replace official SNOMED classification tooling.
- Arbitrary graph analytics and shortest-path exploration are not the natural hot path.
- Relationship attribute queries need additional indexing if they become first-class.

### Relational Comparison

Relational storage matches RF2's normalized files and is excellent for integrity, but operational SNOMED navigation usually requires a closure table plus a search engine plus often a vector system. MongoDB is stronger when the product needs one operational serving model for display, search, scope, and grounding candidates.

### Neo4j Comparison

Neo4j is elegant for live graph traversal and ad-hoc path analytics. For this demo's hot paths, MongoDB's ancestor closure is faster and simpler: descendant expansion is an indexed lookup. Neo4j would still need stronger external lexical/semantic search for professional coding UX.

## Remaining Backlog

- Add release diff UI once more than one real release is loaded.
- Add value-set/candidate comparison UX for professional coding: candidate comparison, semantic-tag filters, preferred-only toggles, inactivation/replacement display, refset/member context, and richer guided ECL authoring.
- Add automated regression checks that call `/api/readiness` and fail if hardened model checks regress on staging.
