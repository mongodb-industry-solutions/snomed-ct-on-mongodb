# Heart failure discharge (EN)

Reviewed 12 November 2026. Set: applied. 35 mentions; every row manually annotated.

Expected encounter problem: **Acute decompensated HF on chronic HF with reduced EF**. Automatic principal: **unset**. Principal review: **unresolved**.

Current AF, CKD stage 3, hypertension. Admission symptoms/findings are not necessarily persistent at discharge.

Reject cardiomyopathy inferred from HFrEF, dyspnea for crackles, edema reduction for edema, pulmonary reflex for congestion, ST elevation for troponin, and urine ACR for renal blood tests.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Discharge summary
Reason for admission: Progressive shortness of breath and ankle swelling for 5 days.
History of present illness: The patient was admitted with acute decompensated heart failure. On arrival, oxygen saturation was 89% on room air, with bilateral basal crackles and peripheral edema. Chest X-ray showed pulmonary congestion. Troponin was not elevated. There was no evidence of acute myocardial infarction.
Past medical history: Chronic heart failure with reduced ejection fraction, hypertension, chronic kidney disease stage 3, and atrial fibrillation. No previous stroke.
Hospital course: The patient was treated with intravenous furosemide with good diuresis and clinical improvement. Echocardiogram showed left ventricular ejection fraction of 35%. Atrial fibrillation remained rate controlled. Renal function worsened transiently during diuresis but returned near baseline before discharge.
Discharge assessment:
1. Acute decompensated heart failure on chronic heart failure with reduced ejection fraction.
2. Atrial fibrillation, rate controlled.
3. Chronic kidney disease stage 3.
4. Hypertension.
5. Acute myocardial infarction ruled out.
Discharge plan: Continue oral furosemide, beta blocker, ACE inhibitor, and anticoagulation. Heart failure clinic follow-up in 2 weeks. Repeat renal function blood test in 1 week.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Progressive shortness of breath | shortness of breath | 267036007 · Shortness of breath | accepted | **partial** — Dyspnea is correct but belongs to the presenting admission episode; current discharge persistence is not established. |
| 2 | ankle swelling | ankle swelling | 267039000 · Ankle swelling | accepted | **partial** — Ankle swelling is correct for the admission episode; do not automatically label it persistent at discharge. |
| 3 | acute decompensated heart failure | acute decompensated heart failure | 195111005 · Decompensated cardiac failure | review | **partial** — Decompensated heart failure is relevant but loses the explicitly acute course. Review acuity and the acute-on-chronic relationship. |
| 4 | oxygen saturation was 89% on room air | oxygen saturation | 103228002 · Hemoglobin saturation with oxygen | review | **supported** — Oxygen saturation observable is suitable; retain 89%, room air, and arrival time. It is not a normal saturation result. |
| 5 | bilateral basal crackles | basal crackles | 161941007 · Dyspnoea at rest | review | **reject** — Bibasal crackles are not dyspnea at rest. |
| 6 | peripheral edema | peripheral edema | 711384005 · Reduction of peripheral edema | review | **reject** — Peripheral edema on arrival is not reduction of edema. |
| 7 | Chest X-ray | chest X-ray | 399208008 · Plain X-ray of chest | review | **supported** — Plain chest radiography is appropriate; no projection/view is specified. |
| 8 | pulmonary congestion | pulmonary congestion | 55044005 · Pulmonary congestion reflex | review | **reject** — Radiographic pulmonary congestion is not the pulmonary congestion reflex. The venous-congestion alternative requires source-context review. |
| 9 | Troponin was not elevated | elevated troponin | 705008001 · Anterior ST segment elevation (finding) | review | **reject** — Troponin not elevated is a biomarker result, not absence of anterior ST elevation. |
| 10 | no evidence of acute myocardial infarction | acute myocardial infarction | 57054005 · Acute myocardial infarction | accepted | **supported** — No evidence of AMI is negative diagnostic evidence; retain admission timing. |
| 11 | Chronic heart failure with reduced ejection fraction | chronic heart failure with reduced ejection fraction | 703275009 · Heart failure with reduced ejection fraction due to cardiomyopathy | review | **reject** — HFrEF does not establish cardiomyopathy, valvular etiology, or coronary etiology. The unqualified HFrEF alternative avoids that inference. Review candidate 703272007. |
| 12 | hypertension | hypertension | 38341003 · Hypertension | accepted | **supported** — Hypertension in PMH has unspecified activity here; later discharge evidence establishes a separate current occurrence. |
| 13 | chronic kidney disease stage 3 | chronic kidney disease stage 3 | 433144002 · Chronic kidney disease stage 3 | accepted | **supported** — CKD stage 3 is retained exactly; do not select hypertension/diabetes-specific causes or stage 3a/3b. |
| 14 | atrial fibrillation | atrial fibrillation | 49436004 · Atrial fibrillation | accepted | **supported** — AF in PMH stays background here and is reaffirmed currently later. |
| 15 | No previous stroke | stroke | 230690007 · Stroke | accepted | **supported** — No previous stroke is a negative history. |
| 16 | intravenous furosemide | furosemide | 387475002 · Furosemide | accepted | **supported** — Prior IV furosemide, ingredient-level with route retained; oral dose alternatives are unsuitable. |
| 17 | good diuresis | diuresis | 162182005 · Diuresis | review | **supported** — Diuresis finding is suitable; retain good response and treatment timing. An observable is an alternative representation, not an independent diagnosis. |
| 18 | clinical improvement | clinical improvement | 711384005 · Reduction of peripheral edema | review | **reject** — General clinical improvement does not prove a specific reduction in peripheral edema. |
| 19 | Echocardiogram | echocardiogram | 40701008 · Echocardiogram | accepted | **supported** — Completed echocardiogram is supported. |
| 20 | left ventricular ejection fraction of 35% | left ventricular ejection fraction | 250908004 · Left ventricular ejection fraction | accepted | **supported** — LVEF observable is appropriate with 35% retained; no reference-limit measurement is documented. |
| 21 | Atrial fibrillation | atrial fibrillation | 49436004 · Atrial fibrillation | accepted | **supported** — AF remains current and rate controlled. |
| 22 | Renal function worsened transiently | worsening renal function | 60309003 · Diuresis, function | review | **reject** — Transient renal worsening is not diuresis function. Do not infer AKI without a diagnosis. |
| 23 | returned near baseline before discharge | renal function near baseline | 60309003 · Diuresis, function (observable entity) | review | **reject** — Renal function near baseline is not diuresis function and does not prove normal renal function. |
| 24 | Acute decompensated heart failure | acute decompensated heart failure | 195111005 · Decompensated cardiac failure | review | **partial** — The first discharge diagnosis is acute decompensated HF. Relevant decompensated-HF candidate loses acuity and needs structured acute-on-chronic representation. |
| 25 | chronic heart failure with reduced ejection fraction | chronic heart failure with reduced ejection fraction | 703275009 · Heart failure with reduced ejection fraction due to cardiomyopathy | review | **reject** — Current chronic HFrEF does not establish cardiomyopathy. Select/review unqualified HFrEF while retaining chronicity. Review candidate 703272007. |
| 26 | Atrial fibrillation | atrial fibrillation | 49436004 · Atrial fibrillation | accepted | **supported** — Rate-controlled AF is a current comorbidity. |
| 27 | Chronic kidney disease stage 3 | chronic kidney disease stage 3 | 433144002 · Chronic kidney disease stage 3 | accepted | **supported** — Stage 3 CKD is a current comorbidity without undocumented cause or 3a/3b subdivision. |
| 28 | Hypertension | hypertension | 38341003 · Hypertension | accepted | **supported** — Hypertension is a current discharge comorbidity. |
| 29 | Acute myocardial infarction ruled out | acute myocardial infarction | 57054005 · Acute myocardial infarction | accepted | **supported** — AMI explicitly ruled out, not confirmed. |
| 30 | oral furosemide | furosemide | 387475002 · Furosemide | accepted | **supported** — Continue oral furosemide; ingredient-level choice plus route avoids inventing tablet strength. |
| 31 | beta blocker | beta blocker | 373254001 · Beta blocker | accepted | **supported** — Continue beta-blocker class, no particular molecule or dose. |
| 32 | ACE inhibitor | angiotensin-converting enzyme inhibitor | 372733002 · Angiotensin-converting enzyme inhibitor | accepted | **supported** — Continue ACE inhibitor class, no particular molecule or dose. |
| 33 | anticoagulation | anticoagulation | 372862008 · Anticoagulant | review | **supported** — Anticoagulant class is a reasonable medication representation of continued anticoagulation; no agent is specified. |
| 34 | Heart failure clinic follow-up | heart failure clinic follow-up | 134378009 · Congestive heart failure monitoring (regime/therapy) | review | **partial** — HF monitoring is relevant but not equivalent to a clinic follow-up/referral in two weeks. |
| 35 | Repeat renal function blood test | renal function blood test | 271075006 · Urine albumin/creatinine ratio measurement (procedure) | review | **reject** — A renal function blood test is not a urine albumin/creatinine test; specimen and analyte differ. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-hf-en-hybrid.json>)
