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

## 5. Proposing the principal diagnosis and comorbidities — a recommended practice

A note rarely mentions one condition. A discharge summary can name a dozen: the reason for admission, chronic conditions, symptoms, things ruled out, a parent's illness. A coder must name **one principal diagnosis**, the condition chiefly responsible for the encounter, plus the **comorbidities** that also need coding. That choice drives billing groupers (DRGs), quality measures, registries and cohort queries, so getting it wrong costs money, distorts reporting and puts patients in the wrong cohort.

The demo proposes both and the reviewer confirms. Every step below is a good practice any SNOMED-based coding pipeline can adopt:

| Practice | What it does | Why it matters |
|---|---|---|
| **1. Read the note's structure** | A condition written under *Assessment* or *Discharge diagnoses* weighs more than one under *History*, *Plan* or *Family history*. This works in English and Spanish, and with sections the LLM labels itself. | Where the clinician writes a diagnosis is the strongest signal of what the encounter was about. |
| **2. Respect clinical status** | Only a condition that is *present* can be the principal. Negated and family-history mentions are excluded. Past and suspected conditions are listed separately and start unticked. | A ruled-out pneumonia or a resolved condition is never coded as an active problem by default. |
| **3. Use the SNOMED hierarchy** | When the note mentions "heart failure" and "decompensated chronic heart failure", they are one problem, coded at the most specific concept, not two competing codes. | Fewer duplicate and redundant codes, and the code says as much as the note does. |
| **4. Separate diagnoses from symptoms** | Findings such as "shortness of breath" or "cough" are shown as *presenting symptoms*, not comorbidities. A symptom only leads when no disorder is documented. | Symptoms explained by the diagnosis aren't coded on top of it. |
| **5. Make disagreement visible** | The scoring rules and the optional LLM review each propose a principal. When they differ, the reviewer sees both. The LLM can only choose from candidates MongoDB retrieved. | The reviewer decides with full information. Neither component silently overrides the other. |
| **6. Measure it** | Each gold note records the coder's principal and comorbidities. The benchmark reports principal accuracy (top-1 and top-3) and comorbidity precision and recall. | Every rule change can be checked against a coder's answer instead of tuned by eye. |

**Why MongoDB makes practice 3 cheap.** Every concept document already carries its precomputed ancestor list, the same one that powers subsumption queries (§4). Checking whether one coded concept is a kind of another is an in-memory set lookup on data the grounding step already retrieved. It needs no graph traversal and no extra query.

### What it changed, measured

On the demo's 7 gold notes, with the same grounding results scored by the previous and the new logic (default LLM extraction):

| Measure | Before | After |
|---|---|---|
| Principal diagnosis, exact code | 43% | 57% |
| Comorbidity precision (proposed comorbidities that are correct) | 37% | 62% |
| Comorbidity recall (expected comorbidities that are proposed) | 71% | 86% |

Treat these as directional. Seven notes is a demo set, not a clinical validation. Almost every remaining miss happens before scoring: the right concept was never retrieved from the demo's scoped dataset. For example, "diabetic nephropathy" retrieved *Diabetic microangiopathy*. More scoring rules won't fix that; better retrieval and a fuller terminology release will. That is why the benchmark measures retrieval and diagnosis as separate axes.

> **Business value:** fewer wrong principal diagnoses and fewer redundant or inactive codes reach the reviewer. Review is faster and the stored coding is more trustworthy. Because the logic is transparent and measured, a governance team can see *why* each proposal was made and check it against their own gold notes.

---

## 6. Value drivers (the talk track)

- **Lower TCO & complexity** — consolidate four data stores into one; eliminate the sync pipelines and the specialized ops for each.
- **Faster time-to-value** — the reference pattern and working demo shorten the path from "SNOMED is on our roadmap" to a running terminology service.
- **Governed, audit-ready AI** — a concrete answer to "how do you use LLMs without hallucinating clinical codes": retrieval-bounded candidates + reviewer confirmation, with MongoDB as the authority.
- **Interoperability that scales** — standard SNOMED identifiers plus fast subsumption make data exchangeable, queryable by meaning, and analytics-ready.
- **Developer velocity** — one query language and one driver across storage, search, hierarchy, and semantics; the document model matches how developers already think about a concept.

---

## 7. Where it fits

This is a **terminology + clinical-coding service** that sits behind, and feeds, the systems that need standardized clinical meaning:

- **EHR / clinical documentation** — type-ahead, problem-list coding, note grounding.
- **Interoperability layers (FHIR, HL7)** — a code authority for `CodeableConcept` population and value-set expansion.
- **Analytics, quality & population health** — subsumption-based cohorts and reporting.
- **Payer / risk / coding operations** — governed conversion of narrative into coded, auditable data.

It is a **reference blueprint**, not a turnkey product — deliberately, so architects can adapt it to their platform and controls.

---

## 8. What it is *not* (set expectations honestly)

- **Not a licensed SNOMED distribution.** SNOMED and SNOMED CT are registered trademarks of SNOMED International (IHTSDO). You must obtain the license for your country/use case and load your own release; the demo ships no terminology content.
- **Not production-hardened.** Before any production or PHI-bearing deployment, address authentication/authorization, multi-tenant isolation, PHI handling and BAA terms with any LLM gateway, reviewer audit logging, index sizing/cost, and shared caching. See **Production Boundaries** in the [README](../README.md).
- **Not an autonomous auto-coder.** By design, no code is stored without candidate retrieval from MongoDB and reviewer confirmation.

---

## 9. Suggested demo flow (10–15 minutes)

1. **Overview** — frame the problem and the "four stores → one" consolidation.
2. **Navigation** — search "heart failure" three ways (lexical / semantic / hybrid); open a concept; show the hierarchy and "everything under" as one indexed query.
3. **Ground a Note** — paste a note; show extraction with negation/context; show that candidates come from MongoDB and a reviewer confirms; store the coding. Use the cardio-renal example to show the principal diagnosis (§5): the decompensated heart failure from the assessment is proposed as principal, the "heart failure" from the history is folded into it, hypertension and chronic kidney disease appear as comorbidities, and the suspected pneumonia sits in its own unticked group. Expect a few wrong concepts from the demo's scoped dataset (e.g. "shortness of breath" may retrieve an unrelated rare disorder). Use them to show why the reviewer confirms every code and why the benchmark measures retrieval separately.
4. **Query by meaning** — find the stored note by SNOMED ancestor.
5. **Benchmark** — compare two models on quality, cost, and latency.
6. **Close** — recap the value drivers in §6 and point to Production Boundaries for the "what's next for us" conversation.
