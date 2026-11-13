# Breast oncology discharge (EN)

Reviewed 12 November 2026. Set: applied. 29 mentions; every row manually annotated.

Expected encounter problem: **Confirmed invasive ductal carcinoma of the left breast**. Automatic principal: **unset**. Principal review: **unresolved**.

No other confirmed active disease is documented. Postoperative pain and receptor/margin/node results are findings; maternal breast cancer is family history.

Left infiltrating duct carcinoma is a suitable existing candidate. Reject metastatic-to-breast for negative node/general metastasis evidence, tramadol for analgesia, podiatry for tumor board, reconstruction for follow-up, and hormone replacement for endocrine-therapy discussion. Preserve completed breast surgery and discussion-only adjuvant plans.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Oncology discharge summary
Reason for admission: Elective surgery for biopsy-proven invasive ductal carcinoma of the left breast.
Clinical background: The patient was diagnosed with invasive ductal carcinoma of the left breast after abnormal screening mammography and core needle biopsy. Estrogen receptor was positive, progesterone receptor was positive, and HER2 was negative. There was no clinical evidence of distant metastatic disease before surgery. Family history is significant for mother with breast cancer at age 52.
Procedure performed: Left breast lumpectomy with sentinel lymph node biopsy.
Hospital course: The procedure was uncomplicated. Postoperative pain was controlled with oral analgesia. No wound infection was observed. Final pathology confirmed invasive ductal carcinoma with negative surgical margins. One sentinel lymph node was negative for metastatic carcinoma.
Discharge assessment:
1. Invasive ductal carcinoma of the left breast, status post lumpectomy.
2. No evidence of metastatic carcinoma.
3. Family history of breast cancer.
4. Postoperative wound infection not present.
Plan: Refer to multidisciplinary tumor board. Arrange oncology follow-up for adjuvant radiotherapy and endocrine therapy discussion. Review final pathology in clinic.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Elective surgery | surgery | 387713003 · Surgery | accepted | **partial** — Elective surgery was planned at admission and subsequently completed. Without a linked event, the isolated planned-surgery result could produce a stale future proposal. |
| 2 | biopsy-proven invasive ductal carcinoma of the left breast | invasive ductal carcinoma of the left breast | 1306575001 · Infiltrating duct carcinoma of left breast | review | **supported** — Left-breast infiltrating duct carcinoma is a suitable nonliteral candidate. Malignancy is biopsy confirmed; quadrant-specific alternatives are unsupported. Review candidate 1306575001. |
| 3 | invasive ductal carcinoma of the left breast | invasive ductal carcinoma of the left breast | 1306575001 · Infiltrating duct carcinoma of left breast | review | **supported** — Confirmed left-breast invasive duct carcinoma is appropriately proposed, with diagnostic basis retained. Review candidate 1306575001. |
| 4 | abnormal screening mammography | abnormal screening mammography | 71651007 · Mammography | review | **partial** — Mammography is relevant but loses screening purpose and abnormal result from its code; retain result and consider the source-derived screening candidate. |
| 5 | core needle biopsy | core needle biopsy | 9911007 · Core needle biopsy | accepted | **partial** — Core needle biopsy is a correct broad concept, but breast specificity is available from the surrounding source and a displayed breast-biopsy alternative. Review candidate 44578009. |
| 6 | Estrogen receptor was positive | estrogen receptor positivity | Uncoded | abstain | **unresolved** — ER-positive tumor finding is clinically meaningful and has no adequate coded proposal. |
| 7 | progesterone receptor was positive | progesterone receptor positivity | Uncoded | abstain | **unresolved** — PR-positive tumor finding is clinically meaningful and has no adequate coded proposal. |
| 8 | HER2 was negative | HER2 positivity | Uncoded | abstain | **partial** — The mapper abstains safely, but extracting HER2 negativity as absence of HER2 positivity can collapse negative/equivocal/unknown test states. Preserve the observed negative result explicitly. |
| 9 | no clinical evidence of distant metastatic disease | distant metastatic disease | 405843009 · Widespread metastatic malignant neoplastic disease | review | **reject** — No evidence of distant metastasis does not establish absence specifically of widespread metastatic disease; disease extent and evidence time differ. |
| 10 | mother with breast cancer at age 52 | breast cancer | 254837009 · Breast cancer | accepted | **supported** — Mother's breast cancer at 52 is family history; relationship and age retained. |
| 11 | Left breast lumpectomy | lumpectomy | 392022002 · Lumpectomy | accepted | **partial** — Generic excision-of-mass code loses breast specificity despite exact 'lumpectomy' matching. Breast lumpectomy is a displayed better candidate; retain left side. Review candidate 392021009. |
| 12 | sentinel lymph node biopsy | sentinel lymph node biopsy | 396487001 · Sentinel lymph node biopsy | accepted | **supported** — Completed sentinel lymph node biopsy is supported; axillary/internal-mammary node site is not specified. |
| 13 | Postoperative pain | postoperative pain | 213299007 · Postoperative pain | accepted | **supported** — Controlled postoperative pain is a postoperative finding, not proof it is entirely absent. |
| 14 | oral analgesia | oral analgesic | 780674004 · Tramadol only product in oral dose form | review | **reject** — Oral analgesia does not establish tramadol, an opioid combination, paracetamol, or dose. |
| 15 | No wound infection | wound infection | 76844004 · Wound infection | accepted | **supported** — No wound infection was observed postoperatively. |
| 16 | Final pathology | final pathology | 372440000 · Status of distal surgical margin involvement by neoplasm in excised tissue specimen | review | **reject** — Final pathology is a report/test context, not a distal surgical-margin observable. |
| 17 | invasive ductal carcinoma | invasive ductal carcinoma | 408643008 · Infiltrating duct carcinoma of breast | review | **supported** — Pathology-confirmed breast infiltrating duct carcinoma is a suitable broader occurrence; consolidate left-site evidence from related occurrences. |
| 18 | negative surgical margins | surgical margin involvement | 384695008 · Extent of surgical margin involvement by malignant neoplasm | review | **supported** — Margin involvement observable with negative result is reasonable; do not infer a named margin or numeric width. |
| 19 | negative for metastatic carcinoma | metastatic carcinoma | 1264495000 · Metastatic carcinoma to breast | review | **reject** — A sentinel node negative for metastatic carcinoma cannot map to metastatic carcinoma to breast. Preserve specimen-limited negative evidence. |
| 20 | Invasive ductal carcinoma of the left breast | invasive ductal carcinoma of the left breast | 1306575001 · Infiltrating duct carcinoma of left breast | review | **supported** — Confirmed left-breast malignancy remains the encounter diagnosis after lumpectomy; surgery does not prove resolution. Review candidate 1306575001. |
| 21 | lumpectomy | lumpectomy | 392022002 · Lumpectomy | accepted | **partial** — Post-lumpectomy is a completed event; generic excision-of-mass code needs breast/site linkage, not a second independent procedure. Review candidate 392021009. |
| 22 | No evidence of metastatic carcinoma | metastatic carcinoma | 1264495000 · Metastatic carcinoma to breast | review | **reject** — General negative metastatic-carcinoma assessment does not specify metastasis to breast. |
| 23 | Family history of breast cancer | breast cancer | 254837009 · Breast cancer | accepted | **supported** — Family breast-cancer history is separate from patient malignancy; link this repeat to the mother only when source relation is preserved. |
| 24 | Postoperative wound infection not present | postoperative wound infection | 58126003 · Postoperative wound infection | accepted | **supported** — Postoperative wound infection explicitly absent. |
| 25 | Refer to multidisciplinary tumor board | multidisciplinary tumor board referral | 306171006 · Referral to community physiotherapy service | review | **reject** — Tumor-board referral is not community physiotherapy or podiatry referral. |
| 26 | oncology follow-up | oncology follow-up | 172953009 · Reconstruction of pharynx with stomach pull-up | review | **reject** — Oncology follow-up is not pharyngeal reconstruction with stomach pull-up. |
| 27 | adjuvant radiotherapy | adjuvant radiotherapy | 169335009 · External beam radiotherapy with surgery and chemotherapy | review | **reject** — Discussion of adjuvant radiotherapy does not establish an external-beam regimen combined with surgery and chemotherapy, or a treatment order. |
| 28 | endocrine therapy | endocrine therapy | 786200007 · Esterified estrogen and methyltestosterone only product in oral dose form | review | **reject** — Discussion of endocrine cancer therapy does not establish estrogen/methyltestosterone replacement or a particular drug. Discussion must not become a medication proposal. |
| 29 | Review final pathology | final pathology review | 1359839002 · Status of radial surgical margin tumour involvement | review | **reject** — Reviewing final pathology in clinic is not a radial margin tumor-status measurement. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-oncology-en-hybrid.json>)
