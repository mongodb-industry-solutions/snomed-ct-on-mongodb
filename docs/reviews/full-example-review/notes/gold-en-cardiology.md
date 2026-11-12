# Cardiology, secondary complication (EN)

Reviewed 12 November 2026. Set: benchmark. 4 mentions; every row manually annotated.

Expected encounter problem: **Acute myocardial infarction**. Automatic principal: **Acute myocardial infarction**. Principal review: **supported**.

HF is a current complication. AF history has unspecified activity. Current chest pain is denied.

All four returned base mappings and assertions are supported. Preserve the documented MI-to-HF complication relation. The benchmark MI fact uses a broader code/phrase than its acute principal, so hierarchy-only scores require care.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Assessment: Acute myocardial infarction complicated by heart failure.
History of atrial fibrillation.
Denies chest pain at present.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Acute myocardial infarction | acute myocardial infarction | 57054005 · Acute myocardial infarction | accepted | **supported** — Acute MI is confirmed and the principal proposal matches the assessment; no infarct territory or ST-elevation subtype is given. |
| 2 | heart failure | heart failure | 84114007 · Heart failure | accepted | **supported** — Heart failure is a documented complication of MI, not a particular systolic/HFrEF subtype. |
| 3 | atrial fibrillation | atrial fibrillation | 49436004 · Atrial fibrillation | accepted | **supported** — AF is historical/background with current activity unspecified, not an active comorbidity by this source alone. |
| 4 | chest pain | chest pain | 29857009 · Chest pain | accepted | **supported** — Current chest pain is denied despite confirmed MI; absence of pain does not refute infarction. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/.codex/worktrees/grounding-validation/snomed-ct-on-mongodb/docs/reviews/full-example-review/benchmark-runs/gold-en-cardiology-hybrid.json>)
