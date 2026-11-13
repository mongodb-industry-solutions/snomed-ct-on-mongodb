# Cardio-renal, ED workup (EN)

Reviewed 12 November 2026. Set: benchmark. 11 mentions; every row manually annotated.

Expected encounter problem: **Acute decompensated heart failure**. Automatic principal: **Shortness of breath**. Principal review: **incorrect**.

Hypertension on treatment is current. Known CKD activity needs adjudication. Pneumonia remains suspected pending imaging.

The principal is incorrectly dyspnea while the confirmed acute HF mapping remains under review. Admission for monitoring is incorrectly a device-assessment procedure. The gold chronic-decompensated-HF code should not acquire chronicity solely from 'known HF'.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Chief complaint: Shortness of breath.
History: Known heart failure and chronic kidney disease. Hypertension on treatment.
The patient denies chest pain and has no fever.
Assessment: Acute decompensated heart failure. Suspected pneumonia pending chest X-ray.
Plan: IV furosemide, admit for monitoring.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Shortness of breath | shortness of breath | 267036007 · Shortness of breath | accepted | **supported** — Dyspnea is a presenting symptom; it must not replace the confirmed main assessment condition as principal. |
| 2 | heart failure | heart failure | 84114007 · Heart failure | accepted | **supported** — Known HF is documented background; link it to the acute decompensated assessment without inventing etiology. |
| 3 | chronic kidney disease | chronic kidney disease | 709044004 · Chronic kidney disease | accepted | **partial** — Known CKD is documented in history, but current activity is not directly reaffirmed by this note. The automatic current comorbidity needs adjudication. |
| 4 | Hypertension | hypertension | 38341003 · Hypertension | accepted | **supported** — Hypertension on treatment supplies current activity evidence. |
| 5 | chest pain | chest pain | 29857009 · Chest pain | accepted | **supported** — Chest pain denied. |
| 6 | fever | fever | 386661006 · Fever | accepted | **supported** — Fever absent. |
| 7 | Acute decompensated heart failure | acute decompensated heart failure | 195111005 · Decompensated cardiac failure | review | **partial** — Relevant HF candidate loses acute course. The documented acute decompensation should retain principal priority while mapping is reviewed. |
| 8 | Suspected pneumonia | pneumonia | 233604007 · Pneumonia | accepted | **supported** — Pneumonia is suspected pending imaging, not confirmed. |
| 9 | chest X-ray | chest X-ray | 399208008 · Plain X-ray of chest | review | **supported** — Chest X-ray is pending/planned, not already performed. |
| 10 | IV furosemide | furosemide | 387475002 · Furosemide | accepted | **supported** — IV furosemide is a planned treatment at ingredient level with IV route retained. |
| 11 | admit for monitoring | admission for monitoring | 710839006 · Assessment of cardiac status using monitoring device | review | **reject** — Admission for monitoring is not a cardiac-device assessment procedure; do not infer a particular monitoring system or surgical admission. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/.codex/worktrees/grounding-validation/snomed-ct-on-mongodb/docs/reviews/full-example-review/benchmark-runs/gold-en-cardio-renal-hybrid.json>)
