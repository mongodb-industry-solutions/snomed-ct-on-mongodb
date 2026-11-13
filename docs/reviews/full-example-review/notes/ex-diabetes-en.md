# Diabetes follow-up (EN)

Reviewed 12 November 2026. Set: applied. 24 mentions; every row manually annotated.

Expected encounter problem: **Type 2 diabetes mellitus**. Automatic principal: **Type 2 diabetes mellitus**. Principal review: **supported**.

Hypertension is current. Hyperlipidemia activity is unspecified. Nephropathy and neuropathy interpretation remain provisional; albuminuria and numbness are findings.

Reject poor diabetic control for denied hypoglycemia symptoms and eye surgery for ophthalmology review. Correct the later diabetes-relation anchor and date the negative retinopathy evidence.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Reason for visit: Follow-up for type 2 diabetes mellitus.
History of present illness: The patient has had type 2 diabetes mellitus for 12 years. Recent laboratory results showed increased urine albumin. The patient reports intermittent numbness in both feet but denies foot ulcers. No symptoms of hypoglycemia were reported.
Assessment:
1. Type 2 diabetes mellitus with suspected diabetic nephropathy.
2. Peripheral neuropathy symptoms, likely related to diabetes.
3. No evidence of diabetic retinopathy on ophthalmology review last month.
4. Hypertension, controlled.
Past medical history: Hyperlipidemia. No history of type 1 diabetes mellitus or diabetic ketoacidosis.
Family history: Father with type 2 diabetes mellitus.
Plan: Continue metformin. Start SGLT2 inhibitor if renal function remains stable. Repeat urine albumin-creatinine ratio in 3 months. Refer to podiatry for foot risk assessment.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Follow-up | follow-up visit | Uncoded | abstain | **context** — Follow-up is encounter context, not a disease. |
| 2 | type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **supported** — T2DM is the documented encounter problem. |
| 3 | type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **supported** — T2DM occurrence retains the 12-year duration. |
| 4 | increased urine albumin | increased urine albumin | 274769005 · Albuminuria | review | **supported** — Albuminuria matches increased urine albumin; it does not establish nephropathy or hypertensive renal disease. |
| 5 | intermittent numbness in both feet | numbness | 44077006 · Numbness | accepted | **supported** — Numbness is the documented symptom; bilateral feet and intermittent course remain in source attributes. |
| 6 | foot ulcers | foot ulcers | 95345008 · Ulcer of foot | review | **supported** — Ulcer of foot is a suitable candidate with a negative assertion; singular/plural variation needs no disease inference. |
| 7 | symptoms of hypoglycemia | symptoms of hypoglycemia | 268519009 · Diabetic - poor control | review | **reject** — Absence of reported hypoglycemia symptoms cannot map to absence of poor diabetic control. It also cannot establish a normal glucose concentration. |
| 8 | Type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **supported** — T2DM is confirmed in the assessment independently of the suspected renal complication. |
| 9 | suspected diabetic nephropathy | diabetic nephropathy | 127013003 · Diabetic nephropathy | accepted | **supported** — Diabetic nephropathy terminology is suitable, but clinical assertion must remain suspected. |
| 10 | Peripheral neuropathy symptoms | peripheral neuropathy symptoms | 44077006 · Loss of sensation | review | **partial** — Numbness is only a broader symptom proposal. Preserve the peripheral-neuropathy interpretation and its likely diabetic relationship without confirming a disorder. |
| 11 | diabetes | diabetes mellitus | 73211009 · Diabetes mellitus | accepted | **partial** — The generic diabetes mention is anchored to the word inside the earlier T2DM assessment, rather than the later causal phrase 'related to diabetes'. Exact text containment did not verify the intended occurrence or relation. |
| 12 | diabetic retinopathy | diabetic retinopathy | 4855003 · Diabetic retinopathy | accepted | **partial** — The absence is evidence from last month's ophthalmology review, not an undated guarantee of current retinopathy absence. |
| 13 | ophthalmology review | ophthalmology review | 83816004 · Operative procedure on the orbit and eyeball | review | **reject** — An ophthalmology review does not establish an operation on the eye or orbit. |
| 14 | Hypertension | hypertension | 38341003 · Hypertension | accepted | **supported** — Generic hypertension, controlled; no systolic/diastolic compound or renal etiology is documented. |
| 15 | Hyperlipidemia | hyperlipidemia | 55822004 · Hyperlipidemia | accepted | **supported** — Hyperlipidemia is correctly retained with unspecified current activity. |
| 16 | type 1 diabetes mellitus | type 1 diabetes mellitus | 46635009 · Type 1 diabetes mellitus | accepted | **supported** — No history of T1DM is a negative history, not an active problem. |
| 17 | diabetic ketoacidosis | diabetic ketoacidosis | 420422005 · Diabetic ketoacidosis | accepted | **supported** — No history of DKA is a negative history. |
| 18 | Father with type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **partial** — Father's T2DM and family relationship are supported; the father's current disease activity is not stated. |
| 19 | metformin | metformin | 372567009 · Metformin | accepted | **supported** — Continue metformin at ingredient level; no formulation or dose may be invented. |
| 20 | SGLT2 inhibitor | sodium-glucose cotransporter 2 inhibitor | 703673007 · Sodium glucose cotransporter subtype 2 inhibitor | review | **supported** — SGLT2 inhibitor class candidate is suitable and the future initiation remains conditional on stable renal function. |
| 21 | renal function remains stable | stable renal function | Uncoded | abstain | **context** — Stable renal function is a future treatment prerequisite, not an observed normal renal result. |
| 22 | urine albumin-creatinine ratio | urine albumin-creatinine ratio | 271075006 · Urine albumin/creatinine ratio | accepted | **supported** — Urine ACR measurement is a repeat test planned in three months. |
| 23 | Refer to podiatry | podiatry referral | 306160005 · Referral to podiatry service | review | **supported** — Generic podiatry referral matches the plan; hospital/private/community variants are not documented. |
| 24 | foot risk assessment | foot risk assessment | 394683006 · Diabetic foot risk assessment | review | **supported** — Diabetic foot risk assessment is compatible with this T2DM follow-up plan and remains future. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-diabetes-en-hybrid.json>)
