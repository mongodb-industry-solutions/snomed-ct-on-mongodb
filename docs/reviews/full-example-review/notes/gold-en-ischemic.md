# Ischemic heart disease, procedure & meds (EN)

Reviewed 12 November 2026. Set: benchmark. 8 mentions; every row manually annotated.

Expected encounter problem: **Coronary artery disease**. Automatic principal: **Coronary artery disease**. Principal review: **supported**.

Stable angina and T2DM are in history; active comorbidity status needs source-context review. Paternal MI is family history.

Diagnostic coronary angiography retrieves angioplasty/PCI, an unacceptable procedure substitution. Future aspirin and atorvastatin starts are supported without strength/combination inference.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
History: Stable angina and type 2 diabetes mellitus. Father had myocardial infarction.
Assessment: Coronary artery disease.
Procedure: Coronary angiography performed today.
Plan: Start aspirin and atorvastatin. No evidence of active bleeding.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Stable angina | stable angina | 233819005 · Stable angina | accepted | **partial** — Stable angina is documented in history; the adjective stable does not itself establish current treatment or persistence. |
| 2 | type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **partial** — T2DM appears only in history without explicit current activity. Automatic active comorbidity status requires review. |
| 3 | Father had myocardial infarction | myocardial infarction | 22298006 · Myocardial infarction | accepted | **supported** — Father's MI is family history, not personal MI. |
| 4 | Coronary artery disease | coronary artery disease | 53741008 · Coronary artery disease | accepted | **supported** — CAD is the active assessment diagnosis and a reasonable principal proposal. |
| 5 | Coronary angiography performed today | coronary angiography | 1366525009 · Imaging guided percutaneous transluminal angioplasty of anterior descending branch of left coronary artery with contrast | review | **reject** — Diagnostic coronary angiography is not angioplasty/PCI and does not specify the LAD or another vessel. |
| 6 | aspirin | aspirin | 387458008 · Aspirin | accepted | **supported** — Aspirin is a future start, with no dose specified. |
| 7 | atorvastatin | atorvastatin | 373444002 · Atorvastatin | accepted | **supported** — Atorvastatin is a future start, without strength or combination ingredients. |
| 8 | active bleeding | active bleeding | 131148009 · Bleeding | review | **supported** — No evidence of active bleeding supports a negative generic bleeding finding. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/.codex/worktrees/grounding-validation/snomed-ct-on-mongodb/docs/reviews/full-example-review/benchmark-runs/gold-en-ischemic-hybrid.json>)
