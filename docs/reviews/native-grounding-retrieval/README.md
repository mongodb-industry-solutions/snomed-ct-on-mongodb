# Native retrieval validation

Validated all 16 existing frozen Nano extractions against the pinned 20260601 release. This replay isolates retrieval and evidence verification; it does not re-evaluate extraction recall.

- MongoDB 8.0.37; both configured Search indexes ready and queryable.
- 270 mentions; 259 anchored/searchable mentions and 259 native fusion aggregations.
- Zero degraded runs, invalid final citations, or canonical/source contract issues (1065 canonical source concepts checked).
- 104 unit tests passed, including single-aggregation orchestration, native rerank placement, explicit unsupported-stage errors, citation repair and principal-diagnosis safeguards.
- 44 bilingual coded-note searches passed with zero false positives and false negatives against the synthetic corpus.
- Three controlled lexical comparisons preserved the concept sequence and scores after moving sort into Search.
- Shared native navigation with the exact-description input returned general hypertension (`38341003`) ahead of essential hypertension for the Spanish query, using database descriptions rather than a phrase-specific rule.

| Example | Mentions | Aggregations | Retrieval + Voyage (s) | Source verification (s) | Principal proposal |
|---|---:|---:|---:|---:|---|
| ex-chestpain-en | 28 | 26 | 8.7 | 13.9 | Chest pain |
| ex-chestpain-es | 22 | 22 | 7.1 | 12.5 | dolor torácico |
| ex-diabetes-en | 19 | 19 | 6.1 | 10.4 | Type 2 diabetes mellitus |
| ex-diabetes-es | 20 | 20 | 6.7 | 10.8 | diabetes mellitus tipo 2 |
| ex-full-report-en | 19 | 13 | 4.5 | 6.9 | Acute on chronic systolic heart failure (disorder) |
| ex-hf-en | 32 | 32 | 10.0 | 15.2 | Heart failure with reduced ejection fraction |
| ex-hf-es | 34 | 33 | 11.0 | 18.2 | Review required |
| ex-oncology-en | 27 | 27 | 8.6 | 15.2 | Infiltrating duct carcinoma of left breast |
| ex-stroke-en | 23 | 22 | 7.3 | 13.0 | Review required |
| gold-en-cardio-renal | 11 | 11 | 3.7 | 5.9 | Acute on chronic heart failure |
| gold-en-cardiology | 4 | 4 | 1.4 | 3.2 | Acute myocardial infarction |
| gold-en-diabetes | 6 | 6 | 1.9 | 2.7 | Diabetic nephropathy |
| gold-en-ischemic | 8 | 8 | 2.6 | 5.4 | Coronary artery disease |
| gold-en-oncology | 3 | 3 | 1.4 | 3.5 | Carcinoma of breast |
| gold-en-respiratory | 8 | 7 | 2.3 | 2.9 | Acute exacerbation of chronic obstructive pulmonary disease |
| gold-es-diabetes | 6 | 6 | 1.9 | 4.3 | diabetes mellitus tipo 2 |

The oncology baseline ran 101 MongoDB queries and took 100.3 seconds wall time. The final replay ran 27 aggregations and took 24.0 seconds, including 8.6 seconds of candidate retrieval/Voyage reranking and 15.2 seconds of LLM verification. The baseline and replay were separate local captures; these figures are not a production SLA or a controlled load benchmark.

The final diagnosis policy was also replayed over every captured result set. Some early captures predate that policy change; the rows in summary.json identify them. The subsequent stroke API replay used the final policy and left the principal unset rather than promoting atrial fibrillation when the leading stroke assessment was ungrounded.

Unanchored evidence and missing specific terminology remain reviewable. The English heart-failure proposal still needs clinical review of acute/chronic episode grouping. The LLM can also over-interpret familial disease wording or treat separately represented margin/status facts as missing qualifiers. These checks establish retrieval/evidence contracts, not a clinical accuracy percentage; keep the prior manual annotations as the clinical reference and review changed mappings.

The live cluster supports rankFusion, but rejects scoreFusion and rerank. The prepared MongoDB-native rerank path has unit coverage only. Activate it after MongoDB 9.0+ and Atlas Native Reranking are enabled, then repeat this release gate on that deployment.

Raw replay files remain in ignored artifacts/native-grounding-retrieval. No patient codings were saved. See [design and operator settings](../../NATIVE_GROUNDING_RETRIEVAL.md).
