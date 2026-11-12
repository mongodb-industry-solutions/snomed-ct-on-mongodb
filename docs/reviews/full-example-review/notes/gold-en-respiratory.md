# Respiratory, COPD exacerbation (EN)

Reviewed 12 November 2026. Set: benchmark. 8 mentions; every row manually annotated.

Expected encounter problem: **Acute exacerbation of COPD**. Automatic principal: **Productive cough**. Principal review: **incorrect**.

Cough/wheeze are symptoms; COPD background links to the exacerbation. Former smoking is social history. No examination signs of pneumonia is limited negative evidence.

Principal productive cough is wrong despite an accepted COPD-exacerbation mapping. Wheeze maps to dyspnea; nebulized salbutamol maps to a dry-powder dose and prednisolone to an unspecified concentration. Beta-2 antagonists are unsuitable salbutamol alternatives.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Chief complaint: Productive cough and wheezing for three days.
History: Chronic obstructive pulmonary disease. Ex-smoker.
Assessment: Acute exacerbation of COPD. No signs of pneumonia on examination.
Plan: Nebulized salbutamol and a course of prednisolone.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Productive cough | productive cough | 28743005 · Productive cough | accepted | **supported** — Productive cough is a presenting symptom, not the principal diagnosis once COPD exacerbation is confirmed. |
| 2 | wheezing | wheezing | 267036007 · Dyspnea | review | **reject** — Wheezing is not dyspnea or cough. |
| 3 | Chronic obstructive pulmonary disease | chronic obstructive pulmonary disease | 13645005 · Chronic obstructive pulmonary disease | accepted | **partial** — COPD background is documented; the later acute exacerbation supplies current disease evidence, which should be linked instead of separate duplicate COPD facts. |
| 4 | Ex-smoker | former smoker | Uncoded | abstain | **context** — Former smoking is captured as social-history context. Retain it as a risk factor; it is not an active smoking diagnosis. |
| 5 | Acute exacerbation of COPD | acute exacerbation of chronic obstructive pulmonary disease | 195951007 · Acute exacerbation of chronic obstructive pulmonary disease | accepted | **supported** — Acute COPD exacerbation is confirmed in assessment and should lead the encounter. The current principal cough proposal is incorrect. |
| 6 | No signs of pneumonia | pneumonia | 233604007 · Pneumonia | accepted | **partial** — No signs of pneumonia on examination is limited negative evidence, not definitive exclusion of pneumonia after a complete workup. |
| 7 | Nebulized salbutamol | salbutamol | 770299004 · Salbutamol (as salbutamol sulfate) 100 microgram/actuation powder for inhalation | review | **reject** — Nebulized salbutamol does not specify 100 microgram dry-powder inhaler or a combination drug. Beta-2 antagonists have the opposite pharmacologic action. |
| 8 | prednisolone | prednisolone | 416533002 · Prednisolone 3 mg/mL oral solution | review | **reject** — A course of prednisolone does not specify 3 mg/mL oral solution or an ophthalmic preparation. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/.codex/worktrees/grounding-validation/snomed-ct-on-mongodb/docs/reviews/full-example-review/benchmark-runs/gold-en-respiratory-hybrid.json>)
