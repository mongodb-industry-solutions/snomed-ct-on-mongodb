# Full clinical-note example review — 12 November 2026

This is the initial review before the subsequent algorithm corrections. See [the final improvement results](GROUNDING_ACCURACY_IMPROVEMENTS.md) and [the Grove/Nano review](GROVE_GATEWAY_MIGRATION.md) for later validation.

**The full example set does not yet pass clinical review.** I reviewed all **16 built-in clinical notes and 297 returned mentions**: the nine examples in Ground a Clinical Note and the seven separate benchmark notes. The live benchmark inventory contained no custom entries. The short MI/HF benchmark has supported proposals for all four of its mentions; the remaining notes have mapping, context, completeness, or reference issues.

The nine applied notes use the final, source-matched hybrid captures from earlier today, with the paired lexical runs inspected alongside them. All seven benchmark notes were newly extracted and grounded through the real application at `http://localhost:3015`, using hybrid retrieval. Their expected codes and principal labels were not sent to the grounder. This review created evaluation artifacts only: no production mappings were changed, no projections were added, and no patient codings or treatment actions were saved.

[Every example and its annotated mentions](./reviews/full-example-review/README.md) · [Structured review](./reviews/full-example-review/full-review.json). Raw benchmark captures and canonical source-query payloads remain in the ignored local review directory; the committed review records their conclusions.

## What the manual review found

| Review outcome | Mentions | Meaning |
|---|---:|---|
| Supported | 177 | Base proposal and source context are supported. Mapping approval, structured representation and coding-setting adjudication may still be needed. |
| Partial | 42 | Useful base concept, with lost specificity, time scope, occurrence provenance or clinical context. |
| Reject top proposal | 59 | Candidate adds undocumented meaning, changes the fact, or reverses its scope. |
| Unresolved | 13 | Clinically meaningful source fact has no adequate coded proposal. |
| Code-free context | 6 | Keep the temporal, conditional, causal or social-history evidence without inventing a diagnosis. |

These are counts of occurrences, including repeated mentions, negative findings, relatives and future plans. They are **not a clinical accuracy percentage**. The review examines every top proposal and displayed alternatives; membership checks cover the larger raw pools, but those checks are not manual semantic adjudication of every raw candidate.

Of the application's 170 accepted mappings, 143 have supported base meaning/context and **27 need contextual or specificity corrections**. The 59 rejected top proposals remain under application review or abstention; none was automatically accepted as a full-description mapping in these captures. That safeguard is useful, but a review label does not make an unrelated candidate a good search result. Thirty-four supported proposals also remain under review/abstention, showing that literal-only acceptance misses legitimate nonliteral equivalence.

## Principal diagnoses and comorbidities

Seven principal proposals agree with the source encounter topic, six are unset because mapping remains unresolved, two are incorrect, and one benchmark reference is ambiguous.

| Example | Source encounter problem | Actual automatic principal | Review |
|---|---|---|---|
| Diabetes follow-up EN | Type 2 diabetes mellitus | T2DM | Supported. Hypertension current; nephropathy and neuropathy interpretation provisional; hyperlipidemia activity unspecified. |
| Diabetes seguimiento ES | Diabetes mellitus tipo 2 | T2DM | Supported. Hypertension current; dyslipidemia activity unspecified; complications suspected. |
| HF discharge EN | Acute decompensated HF on chronic HFrEF | Unset | Acute/chronic and EF context must survive mapping. AF, CKD stage 3 and hypertension are current comorbidities. |
| HF discharge ES | Acute decompensated HF on chronic HFrEF | Unset | Same HF issue. Generic CKD loses documented stage 3. |
| Full cardiology discharge EN | Acute decompensated HF | Unset | AF, CAD, T2DM and CKD are current; review IHD/CAD duplication and the acute-on-chronic HF relationship. |
| Breast oncology discharge EN | Confirmed left-breast invasive duct carcinoma | Unset | Suitable left-sided carcinoma candidate exists. No other confirmed active disease; postoperative findings, family history and adjuvant discussion are separate. |
| Stroke discharge EN | Acute ischemic stroke, left MCA territory | Unset | Small-artery occlusion is not documented. Paroxysmal AF current; embolic attribution likely rather than confirmed. |
| Chest-pain ED EN | Presenting pain episode, resolved before arrival | Chest pain | Supported as encounter topic; must not become proof that pain is physically active now. Angina/MI unconfirmed. |
| Chest-pain ED ES | Presenting pain episode, resolved before arrival | Dolor torácico | Same time-scope requirement; background conditions are separate. |
| Benchmark diabetes EN | Confirmed nephropathy in assessment | Diabetic nephropathy | Reasonable main assessment diagnosis; T2DM current. The note does not give a separate explicit encounter reason. |
| Benchmark diabetes ES | T2DM under Motivo, nephropathy in evaluation | T2DM | Ambiguous reference: forcing the gold nephropathy principal would override the differently worded encounter context. |
| Benchmark oncology EN | Carcinoma of breast | Unset | Generic carcinoma alternative is present; primary-tumor specificity was added to top candidate. |
| Benchmark MI/HF EN | Acute MI complicated by HF | Acute MI | Supported; HF is a complication, AF activity unspecified, current pain denied. |
| Benchmark cardio-renal EN | Acute decompensated HF | **Shortness of breath** | **Incorrect.** Confirmed assessment condition remains under review but must not lose encounter priority to its symptom. |
| Benchmark ischemic EN | Coronary artery disease | CAD | Supported principal; current activity of history-only angina/T2DM still needs adjudication. |
| Benchmark respiratory EN | Acute exacerbation of COPD | **Productive cough** | **Incorrect despite an accepted COPD-exacerbation mapping.** Assessment priority is inconsistent for unnumbered diagnoses. |

These are source-text judgments. Principal coding can require setting-specific rules; no source label or hierarchical relation alone settles those rules.

## Coverage versus ranking errors

The source snapshot remains `20260601`: 550,426 total canonical concepts, 399,045 active, and 25,372 projected concepts represented by 131,423 description documents. Only 6.36% of active canonical concepts are projected. Total documents, active concepts, and language/description rows are different counts.

Read-only source probes verified the following general concepts are active in the canonical source but absent from active FSN/synonym search projections:

| Source concept | Identifier | Observed failure caused or worsened by the gap |
|---|---|---|
| Respiratory crackles | 48409008 | Crackles produce dyspnea or no coded finding. |
| Troponin measurement | 105000003 | Laboratory test produces cardiac monitoring or no match. Troponin result concepts also need independent coverage. |
| Urine albumin measurement | 271000000 | Simple urinary albumin plan acquires an unmentioned creatinine ratio. |
| Biochemical evaluation of blood urea/renal function | 269858003 | Renal blood testing becomes a urine ACR test. Suitability of the exact panel still needs review. |
| Analgesic class | 373265006 | Generic oral analgesia becomes tramadol. |
| Antihypertensive agent | 372586001 | Generic therapy becomes a named combination drug. |
| Salbutamol ingredient | 372897005 | Nebulized therapy becomes a dry-powder strength or combination product. |
| Prednisolone ingredient | 116601002 | Unspecified course becomes a solution concentration or eye preparation. |
| Coronary angiography | 33367005 | Diagnostic imaging becomes angioplasty/PCI. |
| Wheezing | 56018004 | Wheeze becomes dyspnea/cough. |
| Normal breath sounds | 48348007 | Normal pulmonary examination becomes heart sounds or remains uncoded. |
| Screening mammography | 24623002 | Screening intent is absent from the selected broad test code. |

These identifiers are **evaluation evidence from the database, not runtime substitutions or a hardcoded projection allowlist**. Future projection work should use a generic source-driven process with semantic and type review. The broad audit probes also retrieve unrelated terminology; their entire candidate set must not be projected blindly.

Other failures occur with suitable concepts **already projected**: unqualified HFrEF (703272007), CKD stage 3 (433144002), left-breast infiltrating duct carcinoma (1306575001), ischemic stroke (422504002), breast lumpectomy (392021009), cerebral IV thrombolysis (472191000119101), generic brain imaging (441986001), and generic podiatry referral (306160005). Data expansion alone will not fix them.

## Generic problems to correct

1. **Encounter priority must work for unnumbered assessments.** The benchmark respiratory note selects a chief-complaint symptom over a confirmed assessment diagnosis. The cardio-renal note falls back to dyspnea while its main condition needs mapping review. Source certainty and encounter priority must be retained independently of whether a code is easy to accept.

2. **Ranking must check semantic entailment and all source qualifiers.** Similarity alone promotes cardiomyopathy for HFrEF, small-artery occlusion for ischemic stroke, surgery for eye review, and angioplasty for angiography. Existing suitable alternatives are present. Stage 3 CKD loses specificity because the normalized search phrase omits the stage, even though the source span/attributes retain it. A full match to that shortened phrase must not outrank documented stage-specific evidence.

3. **Coarse semantic-tag filters cause both false exclusions and false proposals.** Right-sided weakness has an indexed SNOMED synonym on a disorder-tagged hemiparesis concept and is rejected by the symptom/finding-only filter. ER/PR-positive tumor concepts are also projected but excluded from observation-only result handling. This requires contextual/type adjudication; simply permitting every disorder for a symptom would reintroduce disease-inference errors.

4. **Negative scope, specimen, and time must be preserved.** No hypoglycemia symptoms is not normal biochemistry or good diabetic control. A negative sentinel node is not generalized absence of breast metastasis. No murmur must not become absence of normal heart sounds. Last month's retinopathy review, admission oxygenation, current pain denial and a resolved presenting episode have different scopes.

5. **Action states need event linking and a discussion state.** Planned surgery at admission and the later completed lumpectomy should represent the same event. Discussion of radiotherapy/endocrine treatment must not become an order, administration, or proof of a particular regimen. A conditional medication start must retain its prerequisite. Generic drug classes must not acquire molecules, routes, combinations, or doses absent from the note.

6. **Source containment is insufficient to prove the intended occurrence.** The English diabetes causal mention is anchored to the word inside an earlier T2DM phrase rather than 'related to diabetes'. The substring exists, so the earlier anchor contract passes, but the provenance and relationship are wrong.

7. **Output is not yet a complete structured clinical/FHIR representation.** Function-level probes found missing structured family relationships, accepted blood-pressure/LVEF measurements without an output resource, and resolved encounter pain serialized as active. The workbench's first-row deduplication also drops qualifiers from later occurrences, including diabetes duration. Attributes remain in notes in many cases, but that is not equivalent to properly coded Observation values, temporal status, relationships, or merged source evidence. These probes did not interact with the browser or save a bundle.

## The benchmark references also need review

The label “gold” does not make a reference clinically correct. I kept the existing files unchanged and recorded proposed corrections separately.

- Both short diabetes fixtures mark **continue metformin as planned**. The source supports medication continuation. Both omit the requested repeat urinary albumin test from their facts.
- The short oncology fixture omits the tumor-board referral. Several reference packs omit observations/procedures/temporal qualifiers, so a high score cannot establish extraction completeness.
- Spanish diabetes uses `Motivo`, whereas its English counterpart uses HPI. The expected principal labels assume equivalent encounter wording that the source does not establish.
- The cardio-renal reference assigns **decompensated chronic HF** from “known HF” without explicitly documented chronicity. That extra qualifier needs adjudication.
- The ischemic fixture promotes history-only angina/T2DM to active comorbidities; that assumption needs explicit review.
- The benchmark scoring accepts ancestors **or descendants** as a match. A descendant can add an unsupported cause, stage or site. Report hierarchy proximity separately from clinically equivalent mapping, and score assertion, qualifier retention, temporal context, and principal priority independently.

## Execution evidence and limits

All 16 hybrid runs have 297 anchored mentions, no truncation and no timed-out mentions. Traces show **292 successful lexical branches and 292 successful vector branches**, with no branch failures; context-only entries intentionally skip terminology retrieval. Candidate/source contract checks found zero issues in both sets: 1,213 distinct candidate codes for the applied notes and 351 for benchmark notes. These sets overlap and must not be added as a unique total.

The earlier paired lexical capture for the nine applied notes has 23 timed-out mentions. This review inspects it as partial retrieval evidence; it does not claim a controlled clinical-accuracy comparison between modes. The latest nine-note hybrid run includes the earlier semantic-order correction, while the paired lexical runs predate that final ordering change.

The earlier 48 regression tests and application build passed before this document review. Their contracts did not detect several errors documented here. No new production algorithm was introduced in this review. Browser visual QA remains unavailable; graph/output conclusions here use captures and source/serializer inspection. Full FHIR conformance validation and setting-specific clinical-coder adjudication remain separate work.

## Reproduce the additional runs and review artifacts

Run from the repository root:

```sh
node scripts/validateGroundingExamples.mjs --url http://localhost:3015 --notes docs/reviews/full-example-review/benchmark-inputs.json --output docs/reviews/full-example-review/benchmark-runs --modes hybrid --reuse-extraction
node scripts/checkGroundingRuns.mjs docs/reviews/full-example-review/benchmark-runs
node docs/reviews/full-example-review/audit-source.mjs
node docs/reviews/full-example-review/render-review.mjs --applied-runs /path/to/applied-hybrid-captures --paired-runs /path/to/paired-captures
node docs/reviews/full-example-review/audit-output.mjs
```

The source audit is read-only. The manually authored verdicts, recommended candidate identifiers and expected encounter topics remain evaluation data. Correct the generic behavior against these references, then rerun all 16 notes before declaring the full set clinically validated.
