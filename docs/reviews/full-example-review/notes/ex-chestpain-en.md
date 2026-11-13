# Chest pain ED note (EN)

Reviewed 12 November 2026. Set: applied. 26 mentions; every row manually annotated.

Expected encounter problem: **Presenting chest-pain episode; pain resolved before arrival**. Automatic principal: **Chest pain**. Principal review: **supported**.

Hypertension and T2DM are background with activity unspecified. Angina and MI remain unconfirmed. Father’s MI is family history.

Separate encounter diagnosis from physical current-pain denial. Troponin and admission must not map to device monitoring. ECG, plain chest X-ray, aspirin and statin proposals are supported.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Emergency department note
Chief complaint: Chest pain.
History: The patient reports central chest discomfort lasting 20 minutes while walking upstairs. Pain resolved before arrival. The patient denies current chest pain, shortness of breath, syncope, or palpitations. Past medical history includes hypertension and type 2 diabetes mellitus. Father had myocardial infarction at age 60.
Examination: Blood pressure 158/92 mmHg. Heart sounds normal. Lungs clear.
Investigations: Initial ECG shows no ST elevation. First troponin is normal. Chest X-ray is normal.
Assessment: Chest pain, possible unstable angina. Acute myocardial infarction not confirmed at this time.
Plan: Repeat ECG and troponin in 3 hours. Admit to observation unit for cardiac monitoring. Continue aspirin and statin.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Chest pain | chest pain | 29857009 · Chest pain | accepted | **partial** — Chest pain is the encounter problem, but 'current' here is encounter scope; the later source explicitly denies pain at the time of examination. |
| 2 | central chest discomfort | chest discomfort | 279084009 · Chest discomfort | accepted | **supported** — Recent central chest discomfort retains 20-minute duration and exertional trigger; no confirmed angina inferred. |
| 3 | Pain resolved before arrival | chest pain | 29857009 · Chest pain | accepted | **supported** — Pain resolution before arrival is represented separately from the presenting episode. |
| 4 | current chest pain | chest pain | 29857009 · Chest pain | accepted | **supported** — Current chest pain explicitly denied. |
| 5 | shortness of breath | shortness of breath | 267036007 · Shortness of breath | accepted | **supported** — Current dyspnea denied. |
| 6 | syncope | syncope | 271594007 · Syncope | accepted | **supported** — Syncope denied. |
| 7 | palpitations | palpitations | 80313002 · Palpitations | accepted | **supported** — Palpitations denied. |
| 8 | hypertension | hypertension | 38341003 · Hypertension | accepted | **supported** — Hypertension is background with unspecified current activity, not the encounter reason. |
| 9 | type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **supported** — T2DM is background with unspecified current activity, not the encounter reason. |
| 10 | Father had myocardial infarction at age 60 | myocardial infarction | 22298006 · Myocardial infarction | accepted | **supported** — Father's MI at 60 is family history, not patient infarction. |
| 11 | Blood pressure 158/92 mmHg | blood pressure | 75367002 · Blood pressure | accepted | **supported** — Blood-pressure observable is appropriate with 158/92 mmHg retained; no secondary hypertension subtype inferred. |
| 12 | Heart sounds normal | normal heart sounds | 301132007 · Heart sounds normal | review | **supported** — Normal heart sounds is the documented examination finding. |
| 13 | Lungs clear | clear lungs | Uncoded | abstain | **unresolved** — Clear lungs is uncoded; do not replace it with a cardiac or oxygenation finding. |
| 14 | Initial ECG | electrocardiogram | 29303009 · Electrocardiogram | accepted | **supported** — Initial ECG completed, no specific monitoring implant procedure implied. |
| 15 | no ST elevation | ST elevation | 164931005 · ST elevation | accepted | **supported** — No ST elevation is an ECG result; it does not exclude every MI/ACS. |
| 16 | First troponin is normal | troponin test | 710839006 · Assessment of cardiac status using monitoring device | abstain | **reject** — Initial normal troponin is not a cardiac monitoring procedure; preserve biomarker result and sequence. |
| 17 | Chest X-ray is normal | chest X-ray | 399208008 · Plain X-ray of chest | review | **supported** — Completed plain chest X-ray with normal result retained; no specific view documented. |
| 18 | Chest pain | chest pain | 29857009 · Chest pain | accepted | **partial** — Assessment chest pain remains the encounter diagnosis despite current resolution; do not export it as proof pain is physically active now. |
| 19 | possible unstable angina | unstable angina | 4557003 · Unstable angina | accepted | **supported** — Unstable angina remains possible despite an exact terminology match. |
| 20 | Acute myocardial infarction not confirmed at this time | acute myocardial infarction | 57054005 · Acute myocardial infarction | accepted | **supported** — AMI not confirmed is unresolved/suspected, not established or definitively ruled out. |
| 21 | Repeat ECG | electrocardiogram | 29303009 · Electrocardiogram | accepted | **supported** — Repeat ECG is planned in three hours. |
| 22 | troponin | troponin test | 710839006 · Assessment of cardiac status using monitoring device | review | **reject** — Future troponin measurement is not cardiac-status monitoring. |
| 23 | Admit to observation unit | admission to observation unit | 710839006 · Assessment of cardiac status using monitoring device | review | **reject** — Admission to an observation unit is not a cardiac monitoring procedure; admission and monitoring are separate actions. |
| 24 | cardiac monitoring | cardiac monitoring | 710839006 · Assessment of cardiac status using monitoring device | review | **supported** — Future cardiac monitoring is reasonably represented at the general monitoring level; implant insertion/removal alternatives are unsupported. |
| 25 | aspirin | aspirin | 387458008 · Aspirin | accepted | **supported** — Continue aspirin at ingredient level with no invented strength. |
| 26 | statin | statin | 372912004 · Statin | accepted | **supported** — Continue statin class with no particular molecule/dose. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-chestpain-en-hybrid.json>)
