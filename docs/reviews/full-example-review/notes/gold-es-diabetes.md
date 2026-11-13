# Diabetes con complicaciones (ES)

Reviewed 12 November 2026. Set: benchmark. 6 mentions; every row manually annotated.

Expected encounter problem: **T2DM stated under Motivo; nephropathy confirmed in evaluation**. Automatic principal: **diabetes mellitus tipo 2**. Principal review: **ambiguous**.

Both T2DM and nephropathy are confirmed. The source does not unambiguously justify the benchmark's nephropathy principal over its stated T2DM encounter context.

Do not force the English gold principal onto a differently worded Spanish note. Continue metformin is continuation; urinary albumin is not necessarily an ACR test.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Motivo: Paciente con diabetes mellitus tipo 2.
Evaluación: Nefropatía diabética. Sin evidencia de retinopatía diabética en el control actual.
Antecedentes familiares: Madre con diabetes tipo 2.
Plan: Continuar metformina y repetir albúmina en orina.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | diabetes mellitus tipo 2 | diabetes mellitus tipo 2 | 44054006 · diabetes mellitus tipo 2 | accepted | **supported** — T2DM is explicitly in Motivo, the stated encounter context. |
| 2 | Nefropatía diabética | nefropatía diabética | 127013003 · nefropatía diabética | accepted | **supported** — Diabetic nephropathy is confirmed in evaluation. Whether it supersedes the stated T2DM encounter reason requires adjudication; do not force the gold principal label. |
| 3 | retinopatía diabética | retinopatía diabética | 4855003 · retinopatía diabética | accepted | **supported** — No retinopathy evidence in the current review remains negative. |
| 4 | Madre con diabetes tipo 2 | diabetes mellitus tipo 2 | 44054006 · diabetes mellitus tipo 2 | accepted | **supported** — Mother's T2DM is family history with activity unspecified. |
| 5 | metformina | metformina | 372567009 · metformina | accepted | **supported** — Continuar metformina is continuation, not a newly planned medication. |
| 6 | albúmina en orina | albúmina en orina | 271075006 · medición urinaria del índice albúmina/creatinina | review | **reject** — Repeating urinary albumin does not specify urinary albumin/creatinine ratio; retain the actual requested analyte. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/.codex/worktrees/grounding-validation/snomed-ct-on-mongodb/docs/reviews/full-example-review/benchmark-runs/gold-es-diabetes-hybrid.json>)
