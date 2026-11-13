# Diabetes with complications (EN)

Reviewed 12 November 2026. Set: benchmark. 6 mentions; every row manually annotated.

Expected encounter problem: **Diabetic nephropathy as the main assessment diagnosis**. Automatic principal: **Diabetic nephropathy**. Principal review: **supported**.

T2DM is a current background condition. Retinopathy negative on current review; maternal T2DM is family history.

Five base proposals are supported. Repeat urine albumin must not acquire a creatinine ratio. The gold label for continue metformin should represent continuation, and the source reference omits the repeat laboratory plan.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
HPI: Patient with type 2 diabetes mellitus.
Assessment: Diabetic nephropathy. No evidence of diabetic retinopathy on current review.
Family history: Mother with type 2 diabetes.
Plan: Continue metformin and repeat urine albumin.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **supported** — Current T2DM in HPI is supported; HPI is not a resolved past condition. |
| 2 | Diabetic nephropathy | diabetic nephropathy | 127013003 · Diabetic nephropathy | accepted | **supported** — Diabetic nephropathy is a confirmed assessment diagnosis here, unlike the suspected complication in the longer follow-up example. |
| 3 | diabetic retinopathy | diabetic retinopathy | 4855003 · Diabetic retinopathy | accepted | **supported** — No retinopathy evidence on the current review is a negative finding at that review. |
| 4 | Mother with type 2 diabetes | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **supported** — Mother's T2DM is family history with relative activity unspecified. |
| 5 | metformin | metformin | 372567009 · Metformin | accepted | **supported** — Continue metformin means continuation of existing therapy; the built-in gold assertion 'planned' is incorrect for a new-start interpretation. |
| 6 | repeat urine albumin | urine albumin | 271075006 · Urine albumin/creatinine ratio measurement | review | **reject** — Repeat urine albumin does not specify an albumin/creatinine ratio; the mapper adds an unmentioned creatinine denominator. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/.codex/worktrees/grounding-validation/snomed-ct-on-mongodb/docs/reviews/full-example-review/benchmark-runs/gold-en-diabetes-hybrid.json>)
