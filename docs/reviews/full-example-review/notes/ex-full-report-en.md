# Cardiology discharge — full multi-section (EN)

Reviewed 12 November 2026. Set: applied. 19 mentions; every row manually annotated.

Expected encounter problem: **Acute decompensated heart failure**. Automatic principal: **unset**. Principal review: **unresolved**.

AF, CAD, T2DM and CKD are current discharge diagnoses. Chronic systolic HF belongs to the acute-on-chronic problem. Essential hypertension appears only in PMH. Review IHD/CAD duplication.

No gross unrelated top mapping, but acute HF remains too broad for automatic acceptance. Completed PCI and aspirin are supported. Family MI/breast cancer remain separate.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Cardiology discharge summary
Reason for admission: acute decompensated heart failure.
History of present illness: acute decompensated heart failure on a background of chronic systolic heart failure and ischemic heart disease.
Past medical history: coronary artery disease, type 2 diabetes mellitus, essential hypertension, and chronic kidney disease.
Family history: father with myocardial infarction; mother with breast cancer.
Procedures during admission: percutaneous coronary intervention.
Discharge diagnoses:
1. Acute decompensated heart failure.
2. Atrial fibrillation.
3. Coronary artery disease.
4. Type 2 diabetes mellitus.
5. Chronic kidney disease.
6. Acute myocardial infarction ruled out.
7. Pulmonary embolism excluded.
Medications on discharge: aspirin.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | acute decompensated heart failure | acute decompensated heart failure | 195111005 · Decompensated cardiac failure | review | **partial** — Acute decompensated HF is the admission reason; top candidate loses explicit acuity. |
| 2 | acute decompensated heart failure | acute decompensated heart failure | 195111005 · Decompensated cardiac failure | review | **partial** — Acute HF on chronic systolic background needs linked acute/chronic information, not an undocumented etiology. |
| 3 | chronic systolic heart failure | chronic systolic heart failure | 441481004 · Chronic systolic heart failure | accepted | **supported** — Chronic systolic HF is documented; relate it to the acute episode rather than count independent duplicate HF problems. |
| 4 | ischemic heart disease | ischemic heart disease | 414545008 · Ischemic heart disease | accepted | **partial** — Ischemic heart disease is documented, but this and later CAD may describe one ischemic disease problem. Evidence should be consolidated after review. |
| 5 | coronary artery disease | coronary artery disease | 53741008 · Coronary artery disease | accepted | **supported** — PMH CAD with unspecified activity in this occurrence; later discharge diagnosis establishes current evidence. |
| 6 | type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **supported** — PMH T2DM with unspecified activity here; later discharge diagnosis current. |
| 7 | essential hypertension | essential hypertension | 59621000 · Essential hypertension | accepted | **supported** — Essential hypertension appears only in PMH; retain unspecified current activity. |
| 8 | chronic kidney disease | chronic kidney disease | 709044004 · Chronic kidney disease | accepted | **supported** — PMH CKD has no stage; do not invent a stage or transplant/dialysis status. |
| 9 | father with myocardial infarction | myocardial infarction | 22298006 · Myocardial infarction | accepted | **supported** — Father's MI is family history, not a patient MI; relationship remains available in source attributes. |
| 10 | mother with breast cancer | breast cancer | 254837009 · Breast cancer | accepted | **partial** — Mother's breast cancer is family evidence; current activity of the relative's cancer is not stated. |
| 11 | percutaneous coronary intervention | percutaneous coronary intervention | 415070008 · Percutaneous coronary intervention | accepted | **supported** — PCI was performed during admission; no specific coronary vessel, stent, or graft procedure is documented. |
| 12 | Acute decompensated heart failure | acute decompensated heart failure | 195111005 · Decompensated cardiac failure | review | **partial** — Acute decompensated HF remains the first discharge diagnosis even when the code mapping is under review. |
| 13 | Atrial fibrillation | atrial fibrillation | 49436004 · Atrial fibrillation | accepted | **supported** — AF is a current comorbidity, not principal. |
| 14 | Coronary artery disease | coronary artery disease | 53741008 · Coronary artery disease | accepted | **supported** — CAD is a current comorbidity without multi-vessel/left-main specificity. |
| 15 | Type 2 diabetes mellitus | type 2 diabetes mellitus | 44054006 · Type 2 diabetes mellitus | accepted | **supported** — T2DM is a current comorbidity, not principal. |
| 16 | Chronic kidney disease | chronic kidney disease | 709044004 · Chronic kidney disease | accepted | **supported** — Current CKD, stage unspecified. |
| 17 | Acute myocardial infarction ruled out | acute myocardial infarction | 57054005 · Acute myocardial infarction | accepted | **supported** — AMI explicitly ruled out. |
| 18 | Pulmonary embolism excluded | pulmonary embolism | 59282003 · Pulmonary embolism | accepted | **supported** — Pulmonary embolism excluded. |
| 19 | aspirin | aspirin | 387458008 · Aspirin | accepted | **supported** — Aspirin on discharge is current medication at ingredient level; no dose implied. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-full-report-en-hybrid.json>)
