# Semantic Interoperability — Deferred Demo Phase Plan

**Status: POSTPONED — planning only**

**Planning date:** 30 October 2026

**Scope:** the next clinical semantics phase in Kehrnel and Healthcare Data Lab, retaining the standalone SNOMED demo as a reference

**Implementation trigger:** an explicit request from the user to resume this phase. There is no scheduled start or automatic follow-up.

This document records a proposed design and delivery sequence. Collection names, schemas, screens and operations below are proposals, not available features. This planning task adds documentation only; it does not ingest FHIR resources, create mappings or fixtures, migrate clinical records, or change the running application.

The companion [Grounded Clinical Semantics Research and Delivery Roadmap](../../AI-Ready-Clinical-Semantics/docs/CLINICAL_SEMANTICS_RESEARCH_ROADMAP.md) explains how the MDT extraction project and this demo could lead to an architecture white paper and an evaluated research study, including Voyage versus biomedical resolver comparisons, independent annotations and publication evidence. Its implementation and experiments also remain postponed.

## 1. The intended outcome

Demonstrate that records written in different formats, languages and terminologies can be found through the same clinical query, with the original evidence and the reason for each match visible.

The next demonstration should connect a FHIR Condition using a local code, a legacy coded row, and a narrative note expressing the same clinical meaning. SNOMED provides the common clinical backbone. The source records retain their original codes and structure. A derived semantic context layer supplies the fields used for retrieval.

The core demonstration question is:

> “Find documented patient diabetes across these sources, include its subtypes, and let me narrow the scope or inspect how each source was interpreted.”

An encounter-level example then adds kidney disease documented in a separate resource. Later work introduces quantitative observations and the distinction between medication orders, reported use and administration.

Success means correct, explainable cross-source retrieval. A request can correctly return no results when its criteria are unsupported by the stored facts.

## 2. Existing foundation and planned extension

The existing demo already provides terminology navigation, lexical/vector grounding, bounded hierarchy exploration, reviewer-confirmed note codings, ancestor-based note retrieval, and natural-language query planning. Its documented corpus contains 512 synthetic notes across 32 profiles, with a fixed demo reference date of 29 October 2026. The mapping importer and translation endpoints provide a foundation for published mappings; availability of licensed mapping targets remains a separate dependency.

| Existing foundation | Proposed next-phase addition |
|---|---|
| Canonical concepts and a derived term search projection | A separate projection of clinical facts from heterogeneous source records |
| Notes with accepted codings and ancestor arrays | Source adapters for FHIR and legacy records, with resource/version provenance |
| Clinical assertion and subject handling | Independent polarity, certainty, subject, temporality and workflow state |
| Broad query scopes with optional refinement | Explicit record/encounter scope and cross-source match explanations |
| Embedded published mapping entries on concepts | A versioned mapping workflow for local codes and source-to-canonical normalization |
| Fixed synthetic reference date and optional Today mode | Consistent temporal semantics across the new synthetic source fixtures |

The current demo remains a reference proof-point application. The proposed home of the next Clinical Semantics Lab research experience is Healthcare Data Lab’s existing developer workbench. The separate, existing [Kehrnel runtime](../../kehrnel/README.md) already contains the [SNOMED MongoDB strategy](../../kehrnel/src/kehrnel/engine/strategies/snomedct/mongodb/README.md), FHIR operations and semantic execution contracts. Shared backend extensions should build on those components; `AI-Ready-Clinical-Semantics` is the planning workspace, not a second runtime project. The companion research roadmap specifies capability qualification, a thin source-to-result integration and the remaining contextual fact/query work. A wholesale rewrite is outside the first delivery slice. The companion [Platform and Demo Evolution decision](../../AI-Ready-Clinical-Semantics/docs/PLATFORM_AND_DEMO_EVOLUTION.md) recommends versioning/stabilizing the standalone reference, exposing implementation and research workflows in HDL, and adding Kehrnel preparation support for users with RF2 rather than prebuilt JSON.

The planned FHIR R4 Condition adapter requires qualification against Kehrnel’s current resource capabilities: its R4 catalogue is presently minimal Patient/Observation. Extend the required R4 slice or explicitly revise the adapter/research protocol for another supported release; do not assume the existing FHIR vector projection already implements code-grounded clinical facts.

## 3. Design decisions

### 3.1 Preserve the source and materialize its semantics

Keep each source resource, document or row with its identity and version. Store a smaller semantic projection linked to that source. A projection is rebuildable when terminology, mappings or extraction logic change.

Structured data should be interpreted through a source adapter before NLP is considered. A FHIR Condition already carries a code, patient reference and clinical status; NLP is useful for narrative and unresolved textual information.

### 3.2 Separate facts, interpretations and ancestry

One sentence may produce several facts. Each occurrence needs its own identity, evidence, context and relationships. Repeated mentions of the same code at different times or for different subjects must survive extraction.

Candidate codes represent possible interpretations. They remain proposals until accepted under the mapping or review policy. Accepted concepts retain their specific meaning; their ancestor IDs are a derived search key, not additional asserted diagnoses.

A broad query may select several supported concept families as alternatives. That query scope does not turn every grounding candidate into a stored fact. Sharing a parent or receiving a high vector score is insufficient to establish interchangeable meaning.

### 3.3 Keep clinical context independent from coding review

Represent these axes separately:

- **Polarity:** positive, negative or unknown.
- **Clinical certainty:** confirmed, suspected or unspecified.
- **Experiencer:** patient or an identified family member/other subject.
- **Temporality:** current, historical, planned or unknown, with effective dates where available.
- **Workflow state:** such as active/resolved condition, medication order, reported use, dispensing or administration.
- **Mapping/review state:** candidate, needs review, accepted or rejected.

Accepting a mapping to “pneumonia” does not confirm the diagnosis. A negative statement about a family member must retain both the family subject and negative polarity. Missing or unsupported context stays unknown; it is not converted into a positive patient finding.

### 3.4 Use each retrieval mechanism for its purpose

| Mechanism | Planned purpose |
|---|---|
| Accepted concept IDs and inferred ancestor arrays | Exact and family-based clinical retrieval |
| Embeddings, lexical search and reranking | Ground unfamiliar wording, propose candidates and rank eligible results |
| Source paths, including reversed openEHR paths | Locate the relevant structural field or clinical subtree and its evidence |
| Typed values and relationships | Support quantitative criteria, workflow distinctions and relationships between facts |

The [document-first openEHR pattern](https://www.mongodb.com/docs/atlas/architecture/current/solutions-library/openehr-persistance-layer/) supplies a useful source-preservation and search-projection pattern. Its paths express structural containment. SNOMED ancestry expresses concept subsumption. Both keys can coexist on a projected fact.

The initial plan uses ancestor arrays for SNOMED family matching. SNOMED concepts can have several parents, so concatenating complete hierarchy paths would introduce multiple path representations to maintain. A MongoDB wildcard index on document fields and an Atlas Search wildcard query on a path value are different mechanisms; neither supplies terminology reasoning by itself.

### 3.5 Retain other standard vocabularies

SNOMED is the clinical backbone, with original ICD/local codings preserved. Observation identities may remain LOINC, units UCUM, and medication identities an appropriate drug vocabulary. Store validated relationships to SNOMED when available. An unsupported conversion remains unresolved.

## 4. Mapping workflow

The mapping registry is a versioned dataset, separate from individual clinical record annotations. Approved mapping results may be embedded in a semantic projection for fast retrieval; that embedding records the exact registry version used.

1. **Register the source terminology.** Capture system URI, version, jurisdiction, owner and the documented meaning of each local code.
2. **Acquire or author the mapping set.** Import authorized published maps, or curate mappings for explicitly defined synthetic local demo codes. Mark synthetic mappings as demo-authored; they are not published ICD maps.
3. **Validate targets and direction.** Check that targets exist in the pinned terminology edition/release. Preserve equivalent, broader, narrower, related or unresolved relationships. Reverse lookup of a directional map remains candidate retrieval.
4. **Evaluate required context.** Retain map groups, priorities, rules and advice. Conditional or one-to-many results are unresolved until their conditions are evaluated. Multiple targets do not automatically become multiple clinical assertions.
5. **Review and approve a version.** A terminology/clinical curator accepts or rejects entries and records the decision. A declared, validated deterministic mapping can be reused for later records; per-record exceptions still require review.
6. **Publish an immutable mapping version.** Normalization records the mapping ID/version and equivalence relationship. A mapping update generates new projections and a before/after impact report.

Proposed entry fields include `mappingId`, source system/code/version, target system/code/version, direction, relationship, conditions, map group/priority, provenance, reviewer decision and effective interval.

**Initial scope:** curated synthetic local codes plus already-SNOMED-coded records. Published ICD mapping demonstrations are gated on obtaining the appropriate authorized, versioned dataset. The existing public service returned HTTP 423 during prior work; this plan assumes no unavailable map targets and proposes no fabricated substitutes.

## 5. Source ingestion and review workflow

| Source | Proposed interpretation | Context and controls |
|---|---|---|
| **FHIR R4 Condition** | Resolve `code.coding` through native terminology or the mapping registry; use text grounding for unresolved narrative | Preserve `subject`, `clinicalStatus`, `verificationStatus`, onset/abatement and source version. Resolved is different from negated; absent verification is unspecified. Refuted and entered-in-error records do not become active positive findings. |
| **Clinical note / DocumentReference / Composition narrative** | Extract supported mentions, context, attributes and relationships; retrieve bounded terminology candidates | Preserve sentence/span or section path, language and occurrence ID. Review code and context together. Plain-text fixtures are first; binary attachment extraction is later. |
| **Legacy coded row** | Apply a declared adapter and versioned local-code map | Capture row identity, patient/encounter identifiers, event date and source status. HL7 v2 adapters are later and use explicit segment semantics. |
| **FHIR Observation** | Preserve the observed concept, value, unit and components; add validated semantic links | Use effective time, method/specimen when relevant, and component grouping. Missing data is different from a negative finding. Numeric values use typed comparisons and validated unit rules. |
| **MedicationRequest / MedicationStatement / MedicationDispense / MedicationAdministration** | Represent order, reported use, dispensing and administration as distinct fact kinds | Preserve medication identity, intent/status, effective period, dose, route and frequency. An order does not establish that a patient took the medicine. Initial FHIR version is R4; R5 MedicationUsage requires a separate adapter decision. |
| **Procedure / ServiceRequest** | Represent a performed procedure separately from a requested/planned service | Preserve status, patient, time and indication. A request does not establish completion. |
| **FamilyMemberHistory** | Project the relative’s condition with its relationship to the patient | The disease belongs to the relative. Preserve relationship, polarity and time; do not create the patient’s active Condition. |
| **openEHR composition node** | Attach semantic facts to the preserved node and its structural path | Retain node identity, local subtree, positional metadata and reversed path. An AQL structural match does not establish a SNOMED clinical match. |

For each adapter, the processing sequence is source validation → identity resolution → context extraction → terminology resolution → review/acceptance → projection publication. Records with unresolved identity or unsupported semantics remain visible in a review queue and are excluded from default accepted-fact retrieval.

“Unknown” and conflicting source statements are preserved. A later positive note and an earlier negative note are separate time-stamped assertions; the layer does not silently synthesize a final diagnosis.

## 6. Proposed semantic projection

Start with one projection document per source resource/document/row version, containing a `facts[]` array. This preserves record-level AND/OR semantics and supports multiple facts in a note. Encounter queries explicitly combine matching facts across source records.

Proposed collection roles:

| Collection | Responsibility |
|---|---|
| `clinical_sources` | Original synthetic source artifacts, identity, version and import provenance |
| `terminology_mappings` | Versioned source-to-canonical mapping entries and decisions |
| `semantic_records` | Derived, queryable facts linked to the source and processing versions |
| `semantic_reviews` | Candidate decisions, exceptions and audit history |

These are proposed names, not created collections. Existing terminology collections remain the code authority. `grounded_notes` remains intact; an adapter may project its accepted codings when implementation resumes.

Each projected fact should carry:

- Stable fact/occurrence ID and kind: condition, finding, observation, medication order/use/administration, procedure or family-history fact.
- Accepted concept system/code/version and its release-scoped `ancestorIds`, including the concept itself where applicable.
- Independent polarity, certainty, subject, temporality and workflow state.
- Typed value/unit or relevant attributes, and links to related facts.
- Source resource ID/version, field path or text span, original coding and extraction method/version.
- Mapping ID/version/relationship and review state.

The record carries tenant, normalized patient and optional encounter identity, source identity/version, projection version, terminology release and synthetic demo reference metadata. Identity linkage is explicit in the fixtures; probabilistic patient matching is outside the first slice.

Diabetes plus kidney disease establishes co-occurrence. A query for diabetic nephropathy requires an appropriate combined concept or an evidenced relationship. Formal postcoordination requires terminology-service validation; general classification of arbitrary SNOMED expressions is deferred.

Candidate indexes include tenant/source/version identity, patient/encounter keys, effective time, and the shared fact path for ancestor/context lookup. Final compound indexes must be checked against MongoDB multikey constraints and measured on the selected schema. Numeric and structural-path indexes are added for demonstrated workloads. Vector indexes are optional retrieval aids, not acceptance tests for clinical criteria.

## 7. Natural-language search and tuning

1. **Choose the match unit.** Default record scope preserves the current note-search behavior. The first interoperability slice also supports explicitly selected encounter scope. Unrestricted longitudinal patient scope is later.
2. **Plan the request.** Produce a bounded, validated AND/OR/NOT tree, clinical context and time/value constraints. Rules handle recognized wording; the LLM handles freer wording. The server constructs the database query.
3. **Ground each condition.** Select supported concept families and descendants. Candidate ranking proposes a scope; acceptance rules determine the eligible meanings.
4. **Execute typed predicates.** All constraints describing one fact apply to the same array element. Different requested facts may use separate predicates on the same record, or explicitly grouped source records in encounter mode.
5. **Explain and refine.** Show the source, accepted code, exact/ancestor/mapping match, relevant context and evidence. Users can narrow concepts, disable descendants, alter certainty, include family/history, change match unit or adjust time.

Proposed default clinical policy is documented positive patient facts, including confirmed and unspecified certainty, with explicit suspected facts available when requested. A **Confirmed only** option excludes unspecified certainty. Mapping acceptance never upgrades clinical certainty.

“Without heart failure” excludes matching documented positive facts in the selected scope. “Documented absence of heart failure” requires an explicit negative fact. Suspected findings follow the query’s visible certainty policy. Related concepts outside a justified scope are optional refinements rather than silently accepted matches.

Record results count source records. Encounter results deduplicate encounters while preserving all supporting sources. Duplicate evidence for one patient does not imply several diagnoses. AND across unrelated encounters must not accidentally satisfy an encounter-level request.

Time filters name their meaning: encounter date, observation/medication effective time, or condition onset/active interval. FHIR `meta.lastUpdated` is a processing timestamp, not a clinical event date. A Condition’s encounter reference alone does not prove that its active period overlaps another event. Synthetic fixtures define explicit aligned times; the current Demo reference / Today controls remain visible.

## 8. The proposed next demo phase

### Phase 2A — Cross-source Conditions and notes

**Primary proof point:** the same query retrieves a local-coded FHIR Condition, a legacy row and a paraphrased narrative note, with source-specific explanations.

Planned deliverables:

1. A small, versioned synthetic fixture pack and an expected-fact manifest.
2. FHIR R4 Condition, plain-text note and legacy-row adapters.
3. A reviewed local-code mapping registry and candidate review workflow.
4. Source-linked semantic projections with independent clinical context and ancestor keys.
5. Record search plus explicitly selected encounter search.
6. An **Interoperability** experience in HDL’s developer workbench: source → extracted facts → mapping/review → normalized projection → query/results → evidence.
7. Quality checks covering positive matches, exclusions, ambiguity, provenance and source-version changes.

Suggested presentation flow:

1. Open three representations of diabetes using local terminology, legacy coding and English/Spanish narrative.
2. Show each source’s preserved code/text and its accepted normalization.
3. Search “diabetes” to retrieve specific subtypes across the sources.
4. Narrow to type 2 and show why a type 1 counterexample drops out.
5. Show family-only, negative and suspected counterexamples and tune the context.
6. Select encounter scope and combine diabetes with kidney disease from another resource in that encounter.
7. Inspect one source-resource update and its regenerated projection, keeping other evidence independent.

### Phase 2B — Typed observations and medication workflow

Add Observation quantities/components and validated units; medication order, reported-use and administration distinctions; Procedure/ServiceRequest and structured FamilyMemberHistory adapters. Demonstrate a quantitative predicate and a medication-state predicate with visible time semantics.

Medication facts in Phase 2A may be shown as extracted note annotations, but full medication cross-resource matching belongs to this slice. Missing drug mappings or unit rules remain visible dependencies.

### Phase 2C — Broader interoperability and reusable interfaces

Consider authorized published ICD mappings, openEHR node integration, HL7 v2 adapters, longitudinal patient queries with defined time overlap, and reusable `kehrnel` interfaces. Evaluate richer terminology expressions and classification through a compatible terminology service before exposing those queries.

All slices remain postponed. This sequence establishes dependencies, not delivery dates or authorization to begin.

## 9. Fixture and acceptance plan

| Scenario | Expected behavior |
|---|---|
| Local-coded Condition, legacy row and narrative describe diabetes | Broad record query finds all three; evidence identifies each mapping or grounding path |
| Type 1 and type 2 examples | Broad diabetes includes both; specific type 2 excludes type 1 |
| Family-only diabetes and negative patient diabetes | Neither satisfies a positive patient query; explicit family/negative queries find the appropriate fact |
| Suspected pneumonia with an accepted code mapping | Mapping is accepted while clinical certainty remains suspected; confirmed-only retrieval excludes it |
| Ambiguous local code or conditional map | Candidate review is visible; default accepted-fact results exclude the unresolved interpretation |
| Diabetes and renal disease in separate encounter-linked Conditions | Encounter AND succeeds only for the declared shared encounter; unrelated encounters do not combine |
| Source update, refutation, correction or deletion | Current-version projection is replaced/removed; stale source versions do not remain current matches; other independent sources remain intact |
| Medication ordered but not administered | Administration/use query does not match the order alone |
| Observation with a typed quantity and unit | Numeric comparison uses the intended observation and validated unit, retaining component/event binding |
| Passage of calendar time | Synthetic relative-date examples stay stable under Demo reference; Today follows the actual calendar |

Every core query should have a positive fixture and an excluded counterexample. Expected facts, scopes and source IDs are authored independently of the extraction output. Evaluation reports fact extraction, context preservation, grounding coverage, accepted-map quality, retrieval precision/recall, stale-projection handling, latency and reviewer corrections separately.

For the curated proof-point fixtures, acceptance requires all declared positive and negative expectations to pass. This is a demo gate, not a claim of clinical validation or general NLP completeness. Broader evaluation follows with additional examples and qualified review. No latency guarantee is set before measurement.

## 10. Lifecycle, dependencies and decisions for resumption

Source identity and version form the projection’s idempotency key. Source corrections invalidate the affected projection; deletes/refuted/entered-in-error states remove it from current eligible results. Historical source/projection versions may remain in an audit store. Terminology and mapping upgrades publish new versions, reproject affected records and report changes before the current view switches. Never assume that every source shares one evolving unversioned mapping.

Before implementation resumes, confirm:

- The Phase 2A scope and FHIR R4 profile/adapter contract.
- Fixture identity, encounter and clinical-time conventions.
- Local mapping definitions, terminology edition/release, reviewer role and availability of any published mapping products.
- Record versus encounter grouping and the documented/confirmed certainty policy.
- Projection/index sizing and compatibility with the existing demo.
- Whether a reusable library is wanted after the demo proof point.

Initial work uses synthetic source artifacts. Connections to live clinical systems, source-system writeback, probabilistic identity matching, automatic billing-code assignment and general terminology classification require separate future scope decisions.

## 11. Deferred delivery checklist

- [ ] Explicitly resume and confirm the first delivery slice.
- [ ] Define source contracts and the independent expected-fact fixture manifest.
- [ ] Validate and review the initial mapping version.
- [ ] Implement adapters and source-linked projections.
- [ ] Implement bounded record/encounter query execution and explanations.
- [ ] Integrate the Interoperability view and reviewer workflow.
- [ ] Run the declared acceptance scenarios and record measured results.
- [ ] Decide whether to proceed to observations, medications and broader adapters.

No checklist item is started by creating this document.

## References

- [Current demo setup, note search and mapping capabilities](../README.md)
- [Current solution overview](SOLUTION_OVERVIEW.md)
- [Current terminology model hardening plan](DATA_MODEL_HARDENING_PLAN.md)
- [Document-first openEHR persistence layer](https://www.mongodb.com/docs/atlas/architecture/current/solutions-library/openehr-persistance-layer/)
