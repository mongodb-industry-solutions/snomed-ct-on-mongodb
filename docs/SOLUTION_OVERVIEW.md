# SNOMED CT on MongoDB — Solution Overview

*A functional and business view of the reference architecture. For setup and API details, see the [README](../README.md).*

**Audience:** Solution Architects evaluating a recommended pattern for running SNOMED CT on MongoDB, and technical sales / pre-sales engineers who need a defensible business narrative and a working proof point.

---

## 1. The one-paragraph pitch

SNOMED CT is the world's most comprehensive clinical terminology, but it is hard to operationalize: its graph-like shape usually forces teams to run four different data stores at once (a relational DB for the raw release, a search engine for text lookup, a graph DB for the hierarchy, and a vector DB for semantic search). This solution collapses that stack onto **a single MongoDB platform**. Each clinical concept is stored as one self-contained document with its terms, relationships, and precomputed ancestor path, so terminology storage, lexical search, semantic search, hierarchy navigation, and clinical-note coding all run on one system — no external search engine, graph database, or vector store required. The demo proves the pattern end-to-end and shows how modern LLMs plug in **without ever being the source of truth for codes**.

---

## 2. The business problem

Healthcare runs on free text, but software runs on data. A clinician may write "heart failure," "cardiac failure," or "insuficiencia cardíaca" for the same idea. Until that meaning is pinned to a **standard, stable identifier**, care information cannot be reliably stored, exchanged, analyzed, billed, or governed.

Clinical coding solves this — and SNOMED CT is the global standard for doing it. But three things make SNOMED CT expensive to adopt:

| Challenge | What it costs the business |
|---|---|
| **Fragmented technology stack** | Multiple databases (relational + search + graph + vector) mean multiple licenses, skill sets, sync pipelines, and failure modes. Integration is where budgets and timelines die. |
| **Hierarchy & subsumption are hard** | "Is this a *kind of* heart disease?" / "give me *everything under* diabetes" require graph traversal that is slow and complex to keep correct at scale. |
| **The AI temptation** | It is tempting to let an LLM "just assign codes." That produces plausible-but-wrong codes, no audit trail, and unacceptable clinical and compliance risk. |

The result across the industry: interoperability projects that stall, terminology services that are costly to maintain, and AI pilots that can't survive a governance review.

---

## 3. What this solution demonstrates

The demo is organized as a workbench with distinct functional stories. Each maps directly to a business capability.

### A. Navigate & search terminology
Search a clinical term (e.g. "heart failure") using **lexical, semantic, or hybrid** retrieval, filter by language / semantic tag / hierarchy scope, and inspect any concept's parents, children, relationships, descendants, and release metadata as a graph, table, or value set.

> **Business value:** a single terminology service that powers type-ahead in an EHR, value-set authoring, and analytics filtering — without stitching together a search engine and a graph database.

### B. Ground a clinical note (governed AI coding)
Paste a clinical note and watch it extract clinical mentions, detect **negation, temporality, and subject context** (e.g. "*family history of* diabetes" is not the patient's active problem), retrieve **bounded SNOMED candidates from MongoDB**, and let a reviewer confirm the coding before anything is stored.

> **Business value:** turns unstructured notes into governed, coded data that keeps its ancestor path — so downstream systems can query by meaning. Critically, **MongoDB is the code authority; the LLM only decides *what to look up*, never what code to assign.** This is the difference between an AI pilot and an AI system that passes a compliance review.

### C. Query by meaning
Because stored codings retain their **ancestor paths**, you can retrieve "all notes coded to something under *heart disease*" with a single indexed subsumption query — not brittle exact-text matching.

> **Business value:** population queries, cohort building, and quality reporting become fast, indexed operations instead of text-scraping heuristics.

### D. Benchmark models
Compare LLM models side-by-side on coding **quality (recall + correct exclusion), token cost, and latency**, then promote the winner as the session model.

> **Business value:** an objective, defensible basis for the "which model, at what cost" conversation — instead of vibes.

---

## 4. Why MongoDB — the architectural argument

The central claim, and the thing to demo: **one document per concept, one platform for everything.**

- **The document *is* the concept.** Identity, descriptions (synonyms + translations), relationships, parents/children, and the full ancestor path live in one document. Displaying or reasoning about a concept needs **no joins**.
- **Subsumption becomes a lookup, not a traversal.** Because the ancestor path is precomputed and multikey-indexed on every document, "is X a kind of Y?" and "everything under Z" are single indexed queries. Descendants are resolved *from* the ancestor index rather than stored as giant inverse arrays.
- **One platform, three retrieval modes.** MongoDB Search (lexical), MongoDB Vector Search (semantic), and the aggregation pipeline all operate on the same data. **No external search engine, graph database, or vector store.**
- **AI-native, safely.** Vector search and LLM assistance are first-class, but bounded by MongoDB-retrieved candidates and human confirmation.

### The stack consolidation, at a glance

| Capability | Typical multi-vendor stack | This solution |
|---|---|---|
| Raw terminology storage | Relational DB | MongoDB |
| Text / term lookup | Search engine | MongoDB Search |
| Hierarchy & subsumption | Graph database | MongoDB (ancestor arrays + multikey index) |
| Semantic search | Vector database | MongoDB Vector Search |
| Coded clinical data | Another store + ETL | MongoDB (`grounded_notes`) |

**Four systems → one.** Fewer licenses, one operational model, no cross-store synchronization, one security and backup story.

---

## 5. Value drivers (the talk track)

- **Lower TCO & complexity** — consolidate four data stores into one; eliminate the sync pipelines and the specialized ops for each.
- **Faster time-to-value** — the reference pattern and working demo shorten the path from "SNOMED is on our roadmap" to a running terminology service.
- **Governed, audit-ready AI** — a concrete answer to "how do you use LLMs without hallucinating clinical codes": retrieval-bounded candidates + reviewer confirmation, with MongoDB as the authority.
- **Interoperability that scales** — standard SNOMED identifiers plus fast subsumption make data exchangeable, queryable by meaning, and analytics-ready.
- **Developer velocity** — one query language and one driver across storage, search, hierarchy, and semantics; the document model matches how developers already think about a concept.

---

## 6. Where it fits

This is a **terminology + clinical-coding service** that sits behind, and feeds, the systems that need standardized clinical meaning:

- **EHR / clinical documentation** — type-ahead, problem-list coding, note grounding.
- **Interoperability layers (FHIR, HL7)** — a code authority for `CodeableConcept` population and value-set expansion.
- **Analytics, quality & population health** — subsumption-based cohorts and reporting.
- **Payer / risk / coding operations** — governed conversion of narrative into coded, auditable data.

It is a **reference blueprint**, not a turnkey product — deliberately, so architects can adapt it to their platform and controls.

---

## 7. What it is *not* (set expectations honestly)

- **Not a licensed SNOMED distribution.** SNOMED and SNOMED CT are registered trademarks of SNOMED International (IHTSDO). You must obtain the license for your country/use case and load your own release; the demo ships no terminology content.
- **Not production-hardened.** Before any production or PHI-bearing deployment, address authentication/authorization, multi-tenant isolation, PHI handling and BAA terms with any LLM gateway, reviewer audit logging, index sizing/cost, and shared caching. See **Production Boundaries** in the [README](../README.md).
- **Not an autonomous auto-coder.** By design, no code is stored without candidate retrieval from MongoDB and reviewer confirmation.

---

## 8. Suggested demo flow (10–15 minutes)

1. **Overview** — frame the problem and the "four stores → one" consolidation.
2. **Navigation** — search "heart failure" three ways (lexical / semantic / hybrid); open a concept; show the hierarchy and "everything under" as one indexed query.
3. **Ground a Note** — paste a note; show extraction with negation/context; show that candidates come from MongoDB and a reviewer confirms; store the coding.
4. **Query by meaning** — find the stored note by SNOMED ancestor.
5. **Benchmark** — compare two models on quality, cost, and latency.
6. **Close** — recap the value drivers in §5 and point to Production Boundaries for the "what's next for us" conversation.
