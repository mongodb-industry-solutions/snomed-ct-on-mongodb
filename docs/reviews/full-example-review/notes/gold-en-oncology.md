# Breast oncology (EN)

Reviewed 12 November 2026. Set: benchmark. 3 mentions; every row manually annotated.

Expected encounter problem: **Carcinoma of breast**. Automatic principal: **unset**. Principal review: **unresolved**.

No active comorbidities. Metastatic carcinoma is absent by the stated evidence.

All three top proposals add unsupported specificity or change the action: primary carcinoma, metastasis to breast and podiatry referral. General carcinoma-of-breast is already an alternative. Gold facts omit the tumor-board plan.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Assessment: Carcinoma of breast.
No evidence of metastatic carcinoma.
Plan: Refer to tumor board.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Carcinoma of breast | breast carcinoma | 1306293004 · Primary carcinoma of breast | review | **reject** — Generic breast carcinoma does not specify a primary tumor subtype. The displayed carcinoma-of-breast alternative is suitable. Review candidate 254838004. |
| 2 | metastatic carcinoma | metastatic carcinoma | 1264495000 · Metastatic carcinoma to breast | review | **reject** — General absence of metastatic carcinoma does not specify metastasis to breast. |
| 3 | Refer to tumor board | tumor board referral | 306161009 · Referral to community podiatry service | review | **reject** — Tumor-board referral is not community podiatry or physiotherapy. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/.codex/worktrees/grounding-validation/snomed-ct-on-mongodb/docs/reviews/full-example-review/benchmark-runs/gold-en-oncology-hybrid.json>)
