# Grounding accuracy improvements

The original diabetes output was incorrect: peripheral neuropathy should not replace the documented diabetes follow-up as the encounter problem; numbness does not establish foot ischemia; urine albumin does not establish hypertension with albuminuria; and an albumin/creatinine test is not an albumin infusion. An exact-looking synonym or a high similarity score cannot justify these substitutions.

The changes address extraction, retrieval, source entailment, diagnosis selection and output separately. They do not install example-specific phrase-to-code overrides.

## Verified database scope

For release **20260601**, `snomed-irbd` contains **550,426 concepts**, of which **399,045 are active**. The source total and the active total are different measurements. `snomed-term-search` originally contained **129,536 description documents representing 25,064 distinct concepts**. Its document count is not a concept count.

Two additive expansions now bring the projection to **132,788 documents / 25,619 distinct active concepts**. Of those documents, **131,347 are active FSN/synonym descriptions eligible for search**. The final expansion discovered 247 additional concepts and projected their 1,365 description rows from canonical source data. Existing collections and indexes were preserved; no manual embedding vectors were inserted. The coverage audit found zero orphaned/inactive projected concepts, and both configured Atlas text/vector indexes were READY and queryable.

The projection still represents only **6.42% of active canonical concepts**. It cannot support full-terminology recall. Expanding it on these examples improves their coverage but makes them development data, not a held-out test of general accuracy.

## Implementation

1. **Extraction:** text and context only, without SNOMED identifiers. Occurrence-level source passages preserve every character and retain the full note as context. Every passage must succeed. Exact source sentences and offsets disambiguate repeated patient/family mentions. Missing anchors, failed passages and fallback extraction remain explicit. Denial does not fabricate a resolved disease history.
2. **Retrieval:** hybrid is the default. Exact descriptions, lexical Search and Vector Search are constrained by release, language, active concept and active FSN/synonym description. Lexical search uses the mention; vectors and reranking also use its source sentence. Candidates retain release identity, descriptions and ancestry. Explicitly linked acute/chronic descriptions in the same sentence can share independently retrieved candidates, with provenance retained; unrelated conditions cannot share pools. No shortened synonym is labelled an exact match merely because it contains highlighted words.
3. **Mapping:** a separate source-entailment check chooses from retrieved identifiers only. It compares FSNs, qualifiers, semantic kind, uncertainty, specimen, result polarity and action state. Unsupported candidates abstain; missing defining qualifiers and uncertain symptom interpretations require review. A negative-result code cannot combine with an absent assertion to reverse the finding. Gateway failures cannot silently become accepted mappings.
4. **Encounter diagnosis:** source position and clinical certainty lead selection. An unresolved encounter condition cannot promote an unrelated comorbidity. A separately accepted occurrence of the same documented condition can support selection. Symptoms, observations, suspected diagnoses, negatives, historical/background conditions and relatives remain distinct. Explicitly linked acute/chronic descriptions require grouping review when the hierarchy cannot establish redundancy.
5. **Review/output:** extraction graph shows evidence without codes; grounding graph shows SNOMED identifiers and candidate status. Unmapped source facts remain visible with manual terminology search. Repeated facts retain their qualifiers and all source evidence. A redundant current ancestor hidden by an accepted descendant is excluded from saved output, retaining its evidence. Measurements, family relationships, clinical activity, sites, stages, medication instructions and relative time survive structured output. Discussion alone does not create an order; future/conditional actions remain draft proposals. FHIR output remains a preview requiring profile validation before production interoperability use.
6. **Evaluation:** all 16 applied and benchmark examples are runnable with frozen extraction and real hybrid queries. Execution failures, missing coverage, extraction, accepted mapping and diagnosis correctness are separate measures. Exact code recall is the headline; hierarchy proximity and recall within the projected subset are diagnostics. Removing concepts cannot improve the end-to-end denominator. Reference corrections belong in evaluation fixtures only.

## Manual review of all example notes

These are source-based review expectations, not production mapping rules or a clinician-adjudicated gold standard. Exact candidate/review results are in the recorded runs; unresolved facts remain reviewable.

| Example | Encounter interpretation | Details that must survive |
|---|---|---|
| Diabetes follow-up, EN | Type 2 diabetes; controlled hypertension is an active comorbidity. | Suspected nephropathy; neuropathy symptoms with uncertain diabetic attribution; urine albumin finding and planned ACR test; no reported hypoglycemia symptoms does not exclude asymptomatic hypoglycemia; hyperlipidemia activity unspecified; father with diabetes; metformin continuation and conditional SGLT2 class. |
| Diabetes follow-up, ES | Type 2 diabetes; controlled hypertension. | Suspected nephropathy and neuropathy interpretation; symptoms separate; persistent albuminuria; family relationship; considering SGLT2 initiation remains discussion rather than an order. |
| Heart failure discharge, EN | Acute decompensation on chronic reduced-EF heart failure. | AF, CKD stage 3 and hypertension; chronic HF description requires grouping with the acute episode; admission saturation/congestion separate from discharge activity; completed IV versus continued oral furosemide; transient renal worsening does not itself establish AKI. |
| Heart failure discharge, ES | Same acute/chronic reduced-EF episode. | Preserve reduced EF, CKD stage, rate control and admission timing; a generic HF code can omit defining subtype; oral and IV therapy and future renal tests remain separate. |
| Full cardiology discharge | Acute decompensation with documented chronic systolic background. | AF, CAD, type 2 diabetes and CKD are discharge diagnoses; hypertension appears only in background history; CAD/IHD descriptions need grouping review; ruled-out MI/PE and completed PCI are separate. |
| Breast oncology discharge | Invasive ductal carcinoma of the left breast. | Histology and laterality; completed left lumpectomy and sentinel biopsy; ER/PgR/HER2 results individually; negative margins and sentinel-node result remain specimen-limited; no new radiotherapy/endocrine order from discussion. |
| Stroke discharge | Acute ischemic stroke in the left MCA territory. | A generic stroke candidate missing territory/acuity requires review, leaving principal selection unresolved; paroxysmal AF active; embolic attribution suspected; hemorrhage exclusion; completed imaging/thrombolysis and future anticoagulation/referrals. |
| Chest pain, EN | Chest pain is the encounter problem while the cause remains unconfirmed. | Pain resolved before arrival; absence of current pain does not erase the presenting encounter; possible unstable angina and unconfirmed MI remain provisional; normal first troponin is not infarction exclusion; serial testing and observation are planned. |
| Chest pain, ES | Same provisional encounter interpretation. | Resolved pain, normal findings, exact negative scope and planned serial testing; no double negation from a code that already means no pathological findings. |
| Benchmark diabetes, EN | Confirmed diabetic nephropathy is the first assessment diagnosis; type 2 diabetes also documented. | Negative retinopathy, mother with diabetes, existing metformin continuation and planned urine albumin measurement. |
| Benchmark diabetes, ES | Explicit consultation reason names type 2 diabetes; nephropathy is confirmed in assessment. | Principal reference requires setting-specific adjudication rather than assuming identical ordering to EN; same family, negation and plan distinctions. |
| Benchmark oncology | Breast carcinoma is confirmed. | Carcinoma wording differs from an unspecified malignant breast neoplasm; metastatic carcinoma negation cannot imply a particular metastatic site; tumor-board referral is not therapy. |
| Benchmark cardiology | Acute MI is the first confirmed assessment diagnosis; heart failure is separately documented as a complication. | Do not require a compound code to preserve separately coded conditions; AF activity unspecified; chest pain absent. |
| Benchmark cardiorenal | Acute decompensated HF on known HF, with CKD and hypertension. | Do not invent congestive subtype, CKD stage or cause; pneumonia suspected; chest X-ray, IV furosemide and admission planned; chronic-congestive principal reference is not a valid exact target for this note. |
| Benchmark ischemic | CAD is the confirmed assessment diagnosis. | Stable angina/diabetes history needs activity review; father's MI is family history; coronary angiography is diagnostic, not angioplasty; aspirin/atorvastatin planned; absent generic bleeding must not become a specific bleeding disorder. |
| Benchmark respiratory | Acute COPD exacerbation is the assessment diagnosis. | Cough/wheezing remain symptoms; COPD background grouped with exacerbation; no signs of pneumonia; ex-smoker context; planned nebulized salbutamol and prednisolone without an invented combination product. |

## Validation evidence

The original full review covers all 16 notes and 297 mapping proposals in `docs/reviews/full-example-review/`. Fresh extraction/retrieval evidence is recorded under `artifacts/accuracy-improvement/fresh/`; frozen-input comparison evidence is retained separately under `artifacts/accuracy-improvement/frozen/`. Failed runs are retained, not relabelled as successful.

Production build and regression checks are recorded in the final validation results below. Contract checks verify source anchors, mention counts, active canonical membership, release metadata, source-supported acceptance, clinical roles and actual lexical/vector branch outcomes. Passing these checks establishes execution and representation contracts; it does not establish a clinical accuracy percentage.

## Best practice beyond these examples

Use a release-pinned, versioned projection selected from intended clinical use cases and independently audited for concept/language coverage. Apply changes additively, wait for index readiness, and compare candidate recall before changing acceptance thresholds. A full active-description projection needs storage capacity planning; a compact projection requires an explicit unresolved state.

Have clinical reviewers adjudicate occurrence-level facts and final diagnosis grouping, including subject, assertion, time, site, stage, causality and workflow. Reserve an untouched set of notes for evaluation after projection/prompt tuning. Measure candidate recall, precision of accepted mappings, qualifier preservation and principal/comorbidity correctness separately. Calibrate any probability claim against those labels; retrieval scores and a second LLM opinion are not calibrated confidence.

The configured model is preserved. [OpenAI's official reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning) recommends medium as the starting balance for GPT-5.5. Lower reasoning settings should be tested on the same held-out clinical tasks before changing defaults. Bounded passages and semantic batches provide operational limits without assuming that a faster setting preserves clinical accuracy.

## Final results

All **16 notes / 300 mentions** completed fresh LLM extraction and real hybrid grounding. All **300 source anchors** are valid. Canonical validation checked **1,216 unique retrieved identifiers**, with **zero contract issues**, **zero query timeouts**, **zero semantic verification failures**, and **296 successful branches for each of lexical and vector retrieval**. There are **231 accepted mappings, 40 review mappings and 29 abstentions**; acceptance is terminology equivalence, not clinical confirmation. **74 regression tests and the production build pass**.

The complete 16-note run was supplemented by targeted regressions. Linked-condition pooling affected the two HF discharge notes and the full cardiology report; all three were rerun with the new pool. Unchanged semantic inputs were retained. Diagnosis selection was replayed over every frozen result with `source-priority-v4`, matching all final captured principals. Actual per-file policy versions and targeted reruns are retained in the manifest.

The diagnostic comparison against the prior manual review found **no recurrence of the 59 previously rejected top proposals** at overlapping source spans with the same experiencer/assertion. This is a regression check on development examples, not a held-out clinical accuracy score.

| Example | Final principal proposal | Accepted / review / abstain |
|---|---|---|
| ex-chestpain-en | Chest pain · #29857009 | 22 / 3 / 1 |
| ex-chestpain-es | dolor torácico · #29857009 | 21 / 3 / 3 |
| ex-diabetes-en | Type 2 diabetes mellitus · #44054006 | 17 / 2 / 4 |
| ex-diabetes-es | diabetes mellitus tipo 2 · #44054006 | 20 / 2 / 3 |
| ex-full-report-en | Acute on chronic systolic heart failure (disorder) · #443253003 | 17 / 2 / 0 |
| ex-hf-en | Acute on chronic systolic heart failure · #443253003 | 26 / 8 / 1 |
| ex-hf-es | insuficiencia cardíaca sistólica crónica reagudizada · #443253003 | 25 / 8 / 3 |
| ex-oncology-en | Infiltrating duct carcinoma of left breast · #1306575001 | 19 / 5 / 6 |
| ex-stroke-en | Unresolved — review | 24 / 2 / 6 |
| gold-en-cardio-renal | Unresolved — review | 10 / 2 / 0 |
| gold-en-cardiology | Acute myocardial infarction · #57054005 | 4 / 0 / 0 |
| gold-en-diabetes | Diabetic nephropathy · #127013003 | 6 / 0 / 0 |
| gold-en-ischemic | Coronary artery disease · #53741008 | 7 / 1 / 0 |
| gold-en-oncology | Carcinoma of breast · #254838004 | 1 / 1 / 1 |
| gold-en-respiratory | Acute exacerbation of chronic obstructive pulmonary disease · #195951007 | 6 / 1 / 1 |
| gold-es-diabetes | diabetes mellitus tipo 2 · #44054006 | 6 / 0 / 0 |

The acute stroke territory and the cardiorenal note remain unresolved for principal mapping. CAD/IHD grouping and broader procedure/referral descriptions still require clinical review. The underlying source facts remain available; no patient codings were saved during validation.

Evidence: [canonical checks](reviews/accuracy-improvement/validation-checks.json), [diagnosis replay](reviews/accuracy-improvement/diagnosis-replay.json), [capture manifest](reviews/accuracy-improvement/manifest.json), [prior full manual review](FULL_EXAMPLE_REVIEW.md). Raw captures remain local under the ignored `artifacts/` directory.
